package com.qala.data.program

import com.qala.data.core.ExerciseMuscles
import com.qala.data.core.QalaCore
import com.qala.data.core.exerciseMuscles
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.ProgramEntity
import com.qala.data.model.WeightUnit
import com.qala.data.repo.NewLiftSession
import com.qala.data.repo.ProgramAdvance
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.SessionRepository
import com.qala.data.repo.SettingsRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import uniffi.qala_ffi.QalaException

/** What the lifter did last time on one exercise: one set of the most recent session that had it. */
data class LastSet(val weight: Double, val unit: WeightUnit, val reps: Double)

/** A program day with what the lifting screens need around it. Built once when a workout opens. */
class PlannedDay(
    val programId: String,
    val plan: LiftPlan,
    val unit: WeightUnit,
    val mainLifts: List<String>,
    /** LS++ `exerciseData`, the 1RMs percentage weights resolve against. */
    val exerciseData: JsonObject,
    /** Engine muscle ids by exercise id; null for an id the core does not know. */
    val muscles: Map<String, ExerciseMuscles?>,
    /** The working sets of the most recent session with each exercise, by exercise id; absent when never lifted. */
    val lastTime: Map<String, List<LastSet>>,
)

/** One exercise of a finished workout: the LS++ entry it came from and what was done, aligned with the entry's sets. */
class LiftedExercise(
    val exerciseId: String,
    val key: String,
    val entry: JsonObject,
    val planned: List<PlannedSet>,
    /** One per prescribed set; null for a set that was not done. */
    val sets: List<LoggedSet?>,
)

/** A workout to save. [sessionId] is minted when the workout opens, so saving it twice rewrites one session. */
class LiftedSession(
    val sessionId: String,
    val programId: String?,
    val day: Int,
    val startedAtMs: Long,
    val finishedAtMs: Long,
    val exercises: List<LiftedExercise>,
)

/**
 * The session as the repository stores it: every exercise with a done set, its sets in order as completed work sets.
 * Exercises nothing was done on are left out, as are the sets that were not logged. [minutes] is the wall time from
 * start to finish.
 */
fun LiftedSession.toNewLiftSession(unit: WeightUnit): NewLiftSession = NewLiftSession(
    startedAtMs = startedAtMs,
    programDayIndex = day,
    entries = exercises
        .filter { ex -> ex.sets.any { it != null } }
        .map { liftEntryRecord(it.exerciseId, it.planned, it.sets, unit) },
    minutes = Math.round((finishedAtMs - startedAtMs).coerceAtLeast(0) / 60_000.0).toDouble(),
    id = sessionId,
)

/** What a finish did. [errors] is what the finish-day scripts said went wrong; the program is then left as it was. */
data class FinishOutcome(
    val sessionId: String,
    /** True when this call wrote the session; false when it was already stored and nothing ran. */
    val saved: Boolean,
    /** True when the program's text moved on with the session. */
    val advanced: Boolean,
    /** The 1-based program day that follows, when the program advanced. */
    val nextDay: Int?,
    val errors: List<String> = emptyList(),
)

/**
 * The lifting flow's reads and writes around the program: the day to lift, the update script after a set, and the
 * finish that saves the session together with the program's next state. Rust and JSON work, so everything runs on
 * the environment's work dispatcher.
 */
class LiftService(
    private val programs: ProgramRepository,
    private val settings: SettingsRepository,
    private val sessions: SessionRepository,
    private val engine: ProgramEngine,
    private val env: RepoEnv = RepoEnv(),
) {
    private class Loaded(
        val program: ProgramEntity,
        val evaluated: EvaluatedProgram,
        val unit: WeightUnit,
        val mainLifts: List<String>,
        val exerciseData: JsonObject,
    )

    private suspend fun load(): Loaded? {
        val program = programs.active.first() ?: return null
        val s = settings.settings.first()
        val data = settings.exerciseData.first()
        return Loaded(program, engine.evaluate(program.text, program.name, s.unit, data), s.unit, s.mainLifts, data)
    }

    /** Whether a session with this id is stored, so a draft whose workout was already saved can be dropped. */
    suspend fun sessionExists(id: String): Boolean = sessions.exists(id)

    /** The active program's id, null with no program. */
    suspend fun activeProgramId(): String? = programs.active.first()?.id

    /** The 1-based [day] of the active program, ready to lift; null with no program or when the day uses no exercise. */
    suspend fun plan(day: Int): PlannedDay? = withContext(env.work) {
        val l = load() ?: return@withContext null
        val ids = engine.usedExercises(l.evaluated, day).map { it.exerciseId }
        val muscles = QalaCore.exerciseMuscles(ids)
        val plan = engine.liftPlan(l.evaluated, day, l.program.name, l.unit) { id ->
            val m = muscles[id]
            when {
                id in l.mainLifts -> ExerciseClass.Main
                m != null && m.targets.size <= 1 && m.synergists.isEmpty() -> ExerciseClass.Isolation
                else -> ExerciseClass.Secondary
            }
        } ?: return@withContext null
        val history = sessions.liftSessions.first()
        PlannedDay(
            programId = l.program.id,
            plan = plan,
            unit = l.unit,
            mainLifts = l.mainLifts,
            exerciseData = l.exerciseData,
            muscles = muscles,
            lastTime = ids.distinct().mapNotNull { id -> lastTime(history, id)?.let { id to it } }.toMap(),
        )
    }

    /**
     * The entry after the program's update script ran for the set at [setIndex]; [entry] has that set completed.
     * Returns [entry] unchanged when the program has gone, or the script failed (the lift goes on at the prescribed sets).
     */
    suspend fun afterSet(day: Int, exerciseKey: String, entry: JsonObject, setIndex: Int): JsonObject = withContext(env.work) {
        val l = load() ?: return@withContext entry
        try {
            engine.afterSet(l.evaluated, day, exerciseKey, entry, setIndex)
        } catch (e: QalaException) {
            entry
        }
    }

    /**
     * Saves [lifted] and moves the program on, in one transaction: the session with its sets, the finish-day scripts'
     * new program text and any 1RM they changed. A session already stored under the same id is left alone, so a
     * finish that landed before a crash is not run again. When the scripts fail, or the program is not the one the
     * workout was built from, the session is still saved and the program stays as it was; [FinishOutcome.errors] says why.
     */
    suspend fun finish(lifted: LiftedSession): FinishOutcome = withContext(env.work) {
        if (sessions.exists(lifted.sessionId)) return@withContext FinishOutcome(lifted.sessionId, saved = false, advanced = false, nextDay = null)
        val l = load()
        val errors = ArrayList<String>()
        var advance: ProgramAdvance? = null
        var nextDay: Int? = null
        if (l != null && lifted.programId != null && l.program.id == lifted.programId) {
            try {
                val entries = lifted.exercises
                    .filter { ex -> ex.sets.any { it != null } }
                    .map { completeEntry(it.entry, it.sets, l.unit) }
                val fd = engine.finishDay(l.evaluated, lifted.day, entries)
                errors += fd.errors
                if (fd.errors.isEmpty()) {
                    advance = ProgramAdvance(
                        programId = l.program.id,
                        text = fd.plannerText,
                        exerciseData = if (fd.exerciseData.isEmpty()) null else JsonObject(l.exerciseData + fd.exerciseData),
                    )
                    nextDay = fd.nextDay
                }
            } catch (e: QalaException) {
                errors += e.message ?: "the finish-day scripts failed"
            }
        }
        val id = sessions.saveLiftSession(lifted.toNewLiftSession(l?.unit ?: WeightUnit.Lb), advance)
        FinishOutcome(id, saved = true, advanced = advance != null, nextDay = nextDay, errors = errors)
    }

    private fun lastTime(history: List<LiftSessionWithEntries>, exerciseId: String): List<LastSet>? {
        for (s in history.asReversed()) {
            if (s.session.stub) continue
            val entry = s.entries.sortedBy { it.entry.position }.firstOrNull { it.entry.exerciseId == exerciseId } ?: continue
            val sets = entry.sets.filter { it.completed && !it.warmup }.sortedBy { it.position }
            if (sets.isNotEmpty()) return sets.map { LastSet(it.weight, if (it.unit == "kg") WeightUnit.Kg else WeightUnit.Lb, it.reps) }
        }
        return null
    }
}
