package com.qala.app.workout

import android.util.Log
import com.qala.data.IsoTime
import com.qala.data.QalaJson
import com.qala.data.model.WeightUnit
import com.qala.data.program.FinishOutcome
import com.qala.data.program.LiftService
import com.qala.data.program.oneRepMax
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.WorkoutDraftStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/** How a day opened. [NoDay] is a program that has no exercise on the day, or no program at all. */
enum class Opened { Ready, NoDay }

/** What a logged set asks of the screen: open Rest, offer to finish (it was the last set), or stay (a set edited after the fact). */
enum class AfterLog { Rest, Finish, Stay }

/**
 * The workout in progress, held for the life of the process (like the container's other long-lived state), so it
 * survives the screens: Workout to Rest and back, Back to Today and returning, a rotation. Each change is also written
 * to the draft store, so a killed process picks the workout up where it was. Nothing here touches Compose: the model is
 * [WorkoutState], this class is the I/O around it (the program, the update script, the finish).
 *
 * All of it is meant to be called from the main thread; the Rust and database work runs off it, on [env]'s dispatcher
 * or the container's scope, which outlives any screen: a finish started from a screen that is then left is not cancelled.
 */
class WorkoutStore(
    private val service: LiftService,
    private val drafts: WorkoutDraftStore,
    private val checkIns: CheckInRepository,
    private val env: RepoEnv,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<WorkoutState?>(null)

    /** The workout in progress, null before one is opened and after it is finished or discarded. */
    val state: StateFlow<WorkoutState?> = _state

    private val _plateHints = MutableStateFlow<Map<Double, PlateHint>>(emptyMap())

    /**
     * The plates for every weight a barbell set shows, by weight (pounds on a barbell only), filled in off the main
     * thread as weights appear: a stepper that lands on a new weight shows its plates a moment later.
     */
    val plateHints: StateFlow<Map<Double, PlateHint>> = _plateHints

    private val plateTried = HashSet<Double>()

    private val openLock = Mutex()
    private val scriptLock = Mutex()
    private val diskLock = Mutex()

    init {
        scope.launch {
            _state.collect { s -> if (s != null) fillPlateHints(s) }
        }
        // One writer for the draft. A write that is no longer the current state is skipped, so a late write never
        // brings back a draft that a finish has just cleared.
        scope.launch {
            _state.collect { s ->
                if (s != null) diskLock.withLock { if (_state.value == s) drafts.save(s.toJson()) }
            }
        }
    }

    /** Asks the plate math (Rust, so off the main thread) for each barbell weight in [s] it has not answered yet. */
    private suspend fun fillPlateHints(s: WorkoutState) {
        val missing = s.plateWeights().filter { it !in _plateHints.value && plateTried.add(it) }
        if (missing.isEmpty()) return
        val answers = withContext(env.work) { missing.mapNotNull { w -> PlateMath.hint(w)?.let { w to it } }.toMap() }
        if (answers.isNotEmpty()) _plateHints.update { it + answers }
    }

    /** True when a stored workout still stands for this day: the same program and day, started in the last [DraftHours] hours. */
    private fun WorkoutState.isFor(programId: String?, day: Int, nowMs: Long) =
        this.programId == programId && this.day == day && nowMs - startedAtMs in 0 until DraftHours * 3_600_000L

    /**
     * Makes the workout for program [day] the one in progress: the one already open, the draft of a killed process, or
     * a new one from the program's prescription. A draft of another day, an old one, or one whose session was already
     * saved is dropped.
     */
    suspend fun open(day: Int): Opened = openLock.withLock {
        val now = env.clock.nowMs()
        val programId = service.activeProgramId()
        _state.value?.let { if (it.isFor(programId, day, now)) return Opened.Ready }
        drafts.load()?.let(WorkoutState::fromJson)?.let { saved ->
            if (saved.isFor(programId, day, now) && !service.sessionExists(saved.sessionId)) {
                _state.value = saved
                return Opened.Ready
            }
        }
        val planned = service.plan(day) ?: return Opened.NoDay
        _state.value = WorkoutState.open(planned, env.ids.next(), now) { id -> planned.lastTime[id]?.let(::lastTimeLine) }
        Opened.Ready
    }

    private fun edit(change: (WorkoutState) -> WorkoutState) = _state.update { it?.let(change) }

    // ---- moving about and the logger ----

    fun show(exercise: Int, set: Int? = null) = edit { it.show(exercise, set) }
    fun prev() = edit { it.prev() }
    fun next() = edit { it.next() }
    fun pickSet(set: Int) = edit { it.pickSet(set) }
    fun stepWeight(direction: Int) = edit { it.stepWeight(direction) }
    fun stepReps(direction: Int) = edit { it.stepReps(direction) }
    fun pickRpe(rpe: Double) = edit { it.pickRpe(rpe) }
    fun toggleJointPain() = edit { it.toggleJointPain() }

    /**
     * Logs the selected set. The first logging of a set starts the rest after it (unless it was the last set of the
     * workout) and runs the program's update script, which may rewrite the sets still to come.
     */
    fun log(): AfterLog {
        val now = env.clock.nowMs()
        var result = AfterLog.Stay
        var logged: SetRef? = null
        _state.update { s ->
            result = AfterLog.Stay
            logged = null
            if (s == null) return@update s
            val l = s.log(now) ?: return@update s
            logged = l.ref
            when {
                !l.first -> l.state
                l.next == null -> l.state.also { result = AfterLog.Finish }
                else -> l.state.startRest(l.ref, l.next, now).also { result = AfterLog.Rest }
            }
        }
        logged?.let { runUpdateScript(it) }
        if (result == AfterLog.Rest) _state.value?.rest?.let { restPlates(it.logged, it.next) }
        return result
    }

    private fun runUpdateScript(ref: SetRef) {
        scope.launch {
            scriptLock.withLock {
                val s = _state.value ?: return@withLock
                val ex = s.exercises.getOrNull(ref.exercise) ?: return@withLock
                val entry = ex.completedEntry()
                val updated = withContext(env.work) { service.afterSet(s.day, ex.key, entry, ref.set) }
                if (updated != entry) _state.update { it?.withUpdatedEntry(ref.exercise, updated) }
            }
        }
    }

    /**
     * The plates for the set the rest is for, and how to get there from the set just done, put into the running rest. Both
     * need a barbell in pounds: moving to a dumbbell or a cable leaves them out, and the instruction needs the set before it
     * to have been on a bar too.
     */
    private fun restPlates(logged: SetRef, next: SetRef?) {
        if (next == null) return
        scope.launch {
            val s = _state.value ?: return@launch
            val nextEx = s.exercises.getOrNull(next.exercise) ?: return@launch
            val nextWeight = nextEx.sets.getOrNull(next.set)?.weight
            if (!nextEx.barbell || nextWeight == null) return@launch
            val answer = withContext(env.work) {
                val hint = PlateMath.hint(nextWeight) ?: return@withContext null
                val doneEx = s.exercises[logged.exercise]
                val doneWeight = doneEx.sets.getOrNull(logged.set)?.weight
                val change = if (doneEx.barbell && doneWeight != null) {
                    PlateMath.hint(doneWeight)?.let { PlateMath.change(it.perSide, nextWeight)?.instruction }
                } else {
                    null
                }
                Triple(hint.perSide, change, hint.total)
            }
            if (answer != null) _state.update { it?.withRestPlates(logged, answer.first, answer.second, answer.third) }
        }
    }

    // ---- rest ----

    fun addRest(seconds: Int) = edit { it.addRest(seconds) }
    fun endRest() = edit { it.endRest() }

    // ---- finishing ----

    /**
     * Saves the workout: the session with its sets and the program moved on, in one transaction (see
     * [LiftService.finish]). Then the draft is cleared. A failure leaves the draft, so Start workout on Today picks the
     * workout up again. Returns null when no workout is open or the save failed.
     */
    suspend fun finish(): FinishOutcome? {
        val s = _state.value ?: return null
        val outcome = try {
            service.finish(s.toLifted(env.clock.nowMs()))
        } catch (e: Exception) {
            Log.e("WorkoutStore", "saving the workout failed", e)
            return null
        }
        if (outcome.errors.isNotEmpty()) Log.w("WorkoutStore", "the program was not advanced: ${outcome.errors}")
        close()
        return outcome
    }

    /** Throws the workout in progress away without saving anything. */
    fun discard() {
        scope.launch { close() }
    }

    private suspend fun close() = diskLock.withLock {
        _state.value = null
        drafts.clear()
    }

    // ---- the warm-up ----

    /**
     * The warm-up for program [day]: the day's exercises, their working weights against the 1RMs, and today's
     * check-in (soreness and recovery). Null when the day has nothing to lift.
     */
    suspend fun warmup(day: Int, equipment: Equipment = Equipment.Owner): WarmupView? = withContext(env.work) {
        val planned = service.plan(day) ?: return@withContext null
        val nowMs = env.clock.nowMs()
        val today = IsoTime.localDateKey(nowMs, IsoTime.offsetMinAt(env.clock.zone, nowMs))
        val checkIn = checkIns.checkIns.first().lastOrNull { IsoTime.localDateKey(it.atMs, it.offsetMin) == today }
        val soreness = checkIn?.let { QalaJson.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), it.sorenessJson) }.orEmpty()
        val exercises = planned.plan.exercises.map { ex ->
            val top = ex.sets.withIndex().filter { it.value.weight != null }.maxWithOrNull(compareBy({ it.value.weight }, { it.index }))?.value
            WarmupExercise(
                exerciseId = ex.exerciseId,
                name = ex.name,
                cls = ex.cls,
                muscles = planned.muscles[ex.exerciseId]?.targets.orEmpty(),
                weight = top?.weight,
                reps = top?.reps ?: ex.sets.firstOrNull()?.reps ?: 5.0,
                repsLabel = top?.let { repsTarget(it) } ?: ex.sets.firstOrNull()?.let { repsTarget(it) }.orEmpty(),
                reference = oneRepMax(planned.exerciseData, ex, planned.unit),
                barbell = ex.equipment == "barbell",
            )
        }
        val plan = planWarmup(WarmupInput(exercises, planned.unit, soreness, checkIn?.recovery, equipment))
        val hints = plan.ramps.filter { it.barbell }.flatMap { r -> r.steps.filter { !it.bar }.map { it.load } }.distinct()
            .mapNotNull { w -> PlateMath.hint(w)?.let { w to it } }.toMap()
        WarmupView(
            dayName = planned.plan.dayName,
            programName = planned.plan.programName,
            unit = planned.unit,
            plan = plan,
            plateHints = hints,
        )
    }

    companion object {
        /** A stored workout older than this is a forgotten one, not a half-finished one. */
        const val DraftHours = 16
    }
}

/** The warm-up screen's content. */
class WarmupView(
    val dayName: String,
    val programName: String,
    val unit: WeightUnit,
    val plan: WarmupPlan,
    /** The plates for each ramp step of a barbell lift, by load. */
    val plateHints: Map<Double, PlateHint> = emptyMap(),
)
