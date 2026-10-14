package com.qala.app.workout

import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass
import com.qala.data.program.LiftedExercise
import com.qala.data.program.LiftedSession
import com.qala.data.program.LoggedSet
import com.qala.data.program.PlannedDay
import com.qala.data.program.PlannedSet
import com.qala.data.program.completeEntry
import com.qala.data.program.plannedSets
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/*
 * The workout in progress as plain data (DESIGN 7.5, DECISIONS U5 and U18): the day's exercises with their sets, which
 * set each is on, the numbers in the steppers, what has been logged and the rest running. Every change is a function
 * from one immutable state to the next, so logging, Prev and Next, the update script's rewrite of the sets to come and
 * the finished session are unit tested on the JVM with no Compose, no Rust and no clock. The whole state is JSON, which
 * is how a half-logged workout survives a killed process (WorkoutDraftStore).
 */

/** One set of an exercise. [weight] and [reps] are what the steppers show: the target until the set is logged, then what was done. */
@Serializable
data class SetState(
    /** Null for a set with no weight (bodyweight work). */
    val weight: Double?,
    val reps: Double,
    val targetWeight: Double? = weight,
    val targetReps: Double = reps,
    val minReps: Double? = null,
    val amrap: Boolean = false,
    val targetRpe: Double? = null,
    /** The program's rest after this set, in seconds. */
    val timerSec: Int? = null,
    /** The RPE picked on the strip; null until one is. */
    val rpe: Double? = null,
    val done: Boolean = false,
    val jointPain: Boolean = false,
    val loggedAtMs: Long? = null,
) {
    /** The prescription this set came from, for telling an edit of the numbers from a rewrite by the program. */
    fun sameTarget(other: PlannedSet): Boolean =
        targetWeight == other.weight && targetReps == other.reps && minReps == other.minReps && amrap == other.amrap &&
            targetRpe == other.rpe && timerSec == other.timerSec

    fun asLogged(): LoggedSet? = if (done) LoggedSet(weight, reps, rpe, jointPain) else null

    companion object {
        fun of(p: PlannedSet) = SetState(p.weight, p.reps, p.weight, p.reps, p.minReps, p.amrap, p.rpe, p.timerSec)
    }
}

/** One exercise of the day. [entry] is the LS++ history entry the scripts want back; [selected] is the set the logger shows. */
@Serializable
data class ExerciseState(
    val key: String,
    val exerciseId: String,
    val name: String,
    val unit: WeightUnit,
    val cls: ExerciseClass,
    val entry: JsonObject,
    val sets: List<SetState>,
    val selected: Int = 0,
    /** Last time's work sets on one line, null when this exercise has not been lifted before. */
    val lastTime: String? = null,
    /** `barbell`, `dumbbell`, `cable`... as the LS++ entry names it; null when it does not say (an older draft). */
    val equipment: String? = null,
) {
    /** Whether the lift is loaded with plates on a bar, which is what plate hints are for. */
    val barbell: Boolean get() = PlateMath.applies(unit, equipment == "barbell")

    val doneCount: Int get() = sets.count { it.done }
    val complete: Boolean get() = sets.isNotEmpty() && sets.all { it.done }

    /** The set to do next: the first one not done, or the last one when all are. */
    val firstOpen: Int get() = sets.indexOfFirst { !it.done }.takeIf { it >= 0 } ?: (sets.size - 1).coerceAtLeast(0)

    /** The entry with the sets done so far marked completed: what the update and finish-day scripts read. */
    fun completedEntry(): JsonObject = completeEntry(entry, sets.map { it.asLogged() }, unit)
}

/** A set of an exercise, by position. */
@Serializable
data class SetRef(val exercise: Int, val set: Int)

/** The rest running after a set. [next] is the set it is resting for, null when the workout is done. */
@Serializable
data class RestState(
    val logged: SetRef,
    val next: SetRef?,
    val startedAtMs: Long,
    val seconds: Int,
    /** The "Why" ledger: base first, then each adjustment, in signed seconds. */
    val rows: List<RestRow>,
    /** The plates for each side of the next set, heaviest first, once the plate math has answered; null for a lift with no plates. */
    val perSide: List<Double>? = null,
    /** What to take off and put on to get there from the set just done ("take off 5, add 25 each side"), when both are plate-loaded. */
    val plateInstruction: String? = null,
    /** What those plates add up to, bar included: it differs from the next set's weight when that weight cannot be loaded exactly. */
    val plateTotal: Double? = null,
) {
    val timer: RestTimer get() = RestTimer(startedAtMs, seconds)
    fun plus(extra: Int): RestState = copy(seconds = seconds + extra)
}

/** What the rest screen says it is resting from: "Back squat, set 2 logged, 150 lb x 3 at RPE 9". */
data class RestLogged(val exerciseName: String, val setNumber: Int, val weight: Double?, val reps: Double, val unit: WeightUnit, val rpe: Double?)

/** The set a rest is for. [newExercise] is true when the next set is the first of another exercise. */
data class RestNext(
    val exerciseName: String,
    val newExercise: Boolean,
    val setNumber: Int,
    val setCount: Int,
    val weight: Double?,
    val unit: WeightUnit,
    val reps: String,
    /** The same exercise at the same weight as the set just done: the plates stay on. */
    val sameWeight: Boolean,
)

/** What logging a set did: the state after, the set that was logged, and whether it was a first logging (which opens Rest). */
data class Logged(val state: WorkoutState, val ref: SetRef, val first: Boolean, val next: SetRef?)

/** What a logged set asks of the screen. */
enum class AfterLog {
    /** Open Rest: the first logging of a set that is not the last, with automatic rest on. */
    Rest,

    /** Offer to finish: it was the last set. */
    Finish,

    /** Stay where the logger is: a set edited after the fact. */
    Stay,

    /** The logger has moved on to the next set and no Rest opens, because automatic rest is off in Settings. */
    Next,
}

/** The workout after a logging, and what the screen does about it. */
data class Settled(val state: WorkoutState, val after: AfterLog)

/**
 * Decides what a logging opens. A first logging of a set that is not the last starts the rest after it (the length and
 * the ledger from [restPlan], counted from [nowMs]) when [autoRest] is on, and leaves Rest unopened when it is off; the
 * last set offers to finish either way, and a set edited after the fact stays where it is.
 */
fun Logged.settle(nowMs: Long, autoRest: Boolean): Settled = when {
    !first -> Settled(state, AfterLog.Stay)
    next == null -> Settled(state, AfterLog.Finish)
    autoRest -> Settled(state.startRest(ref, next, nowMs), AfterLog.Rest)
    else -> Settled(state, AfterLog.Next)
}

@Serializable
data class WorkoutState(
    /** Minted when the workout opens, so saving it twice writes one session. */
    val sessionId: String,
    val programId: String?,
    val programName: String,
    /** The 1-based program day. */
    val day: Int,
    val dayName: String,
    val startedAtMs: Long,
    val exercises: List<ExerciseState>,
    /** The exercise the pager is on. */
    val current: Int = 0,
    val rest: RestState? = null,
) {
    val exercise: ExerciseState get() = exercises[current]
    val loggedSets: Int get() = exercises.sumOf { it.doneCount }
    val totalSets: Int get() = exercises.sumOf { it.sets.size }
    val allDone: Boolean get() = totalSets > 0 && loggedSets == totalSets

    /** The name of the exercise before the current one, null at the first: the Prev button's label. */
    val prevName: String? get() = exercises.getOrNull(current - 1)?.name

    /** The name of the exercise after the current one, null at the last: the Next button's label. */
    val nextName: String? get() = exercises.getOrNull(current + 1)?.name

    // ---- moving about ----

    /** Shows exercise [exercise]; with [set] it also picks that set for the logger. */
    fun show(exercise: Int, set: Int? = null): WorkoutState {
        val i = exercise.coerceIn(0, exercises.lastIndex)
        val ex = exercises[i]
        return copy(
            current = i,
            exercises = exercises.replace(i, ex.copy(selected = (set ?: ex.selected).coerceIn(0, (ex.sets.size - 1).coerceAtLeast(0)))),
        )
    }

    fun prev(): WorkoutState = if (current > 0) show(current - 1) else this
    fun next(): WorkoutState = if (current < exercises.lastIndex) show(current + 1) else this

    /** Picks set [set] of the current exercise, done or not. */
    fun pickSet(set: Int): WorkoutState = show(current, set)

    // ---- the logger ----

    private fun editSelected(change: (SetState) -> SetState): WorkoutState {
        val ex = exercise
        val i = ex.selected
        if (i !in ex.sets.indices) return this
        return copy(exercises = exercises.replace(current, ex.copy(sets = ex.sets.replace(i, change(ex.sets[i])))))
    }

    /** Moves the weight of the selected set one step of the unit up ([direction] 1) or down (-1), never below zero. */
    fun stepWeight(direction: Int): WorkoutState = editSelected { s ->
        if (s.weight == null) s else s.copy(weight = (s.weight + direction * weightStep(exercise.unit)).coerceAtLeast(0.0))
    }

    /** Moves the reps of the selected set by one, never under one. */
    fun stepReps(direction: Int): WorkoutState = editSelected { it.copy(reps = (it.reps + direction).coerceAtLeast(1.0)) }

    /** Picks [rpe] on the strip; picking the one already picked clears it. */
    fun pickRpe(rpe: Double): WorkoutState = editSelected { it.copy(rpe = if (it.rpe == rpe) null else rpe) }

    fun toggleJointPain(): WorkoutState = editSelected { it.copy(jointPain = !it.jointPain) }

    /**
     * Logs the selected set of the current exercise. A set logged for the first time moves the logger on to the next set
     * (which is [Logged.next], possibly in another exercise) and is what opens Rest; logging a set that was already
     * done only saves the changed numbers and stays where it is.
     */
    fun log(nowMs: Long): Logged? {
        val ex = exercise
        val i = ex.selected
        val set = ex.sets.getOrNull(i) ?: return null
        val first = !set.done
        val ref = SetRef(current, i)
        val done = copy(exercises = exercises.replace(current, ex.copy(sets = ex.sets.replace(i, set.copy(done = true, loggedAtMs = set.loggedAtMs ?: nowMs)))))
        if (!first) return Logged(done, ref, first = false, next = null)
        val next = done.nextOpen(ref)
        return Logged(if (next != null) done.show(next.exercise, next.set) else done, ref, first = true, next = next)
    }

    /**
     * The set to do after [from]: the next one not done in that exercise, else one that was skipped before it, else the
     * first open set of the following exercises in order (wrapping round to those before). Null when every set is done.
     */
    fun nextOpen(from: SetRef): SetRef? {
        val here = exercises[from.exercise]
        here.sets.indices.firstOrNull { it > from.set && !here.sets[it].done }?.let { return SetRef(from.exercise, it) }
        here.sets.indices.firstOrNull { !here.sets[it].done }?.let { return SetRef(from.exercise, it) }
        for (step in 1 until exercises.size) {
            val e = (from.exercise + step) % exercises.size
            val open = exercises[e].sets.indexOfFirst { !it.done }
            if (open >= 0) return SetRef(e, open)
        }
        return null
    }

    // ---- rest ----

    /**
     * Starts the rest after the set at [ref]: its length and ledger from [restPlan], counted from [nowMs]. [next] is
     * the set it rests for.
     */
    fun startRest(ref: SetRef, next: SetRef?, nowMs: Long): WorkoutState {
        val ex = exercises[ref.exercise]
        val set = ex.sets[ref.set]
        val plan = restPlan(RestInput(ex.cls, set.targetReps, set.reps, set.rpe, set.targetRpe, ref.set + 1, set.amrap, set.timerSec))
        return copy(rest = RestState(ref, next, nowMs, plan.seconds, plan.rows))
    }

    fun endRest(): WorkoutState = copy(rest = null)

    /** The rest budget with [seconds] added. */
    fun addRest(seconds: Int): WorkoutState = copy(rest = rest?.plus(seconds))

    /** "Back squat, set 2 logged": what the rest screen says it is resting from; null with no rest. */
    fun restLogged(): RestLogged? {
        val r = rest ?: return null
        val ex = exercises[r.logged.exercise]
        val set = ex.sets[r.logged.set]
        return RestLogged(ex.name, r.logged.set + 1, set.weight, set.reps, ex.unit, set.rpe)
    }

    /** The set the rest is for; null with no rest or when the workout is done. */
    fun restNext(): RestNext? {
        val r = rest ?: return null
        val next = r.next ?: return null
        val ex = exercises[next.exercise]
        val set = ex.sets[next.set]
        val last = exercises[r.logged.exercise].sets[r.logged.set]
        return RestNext(
            exerciseName = ex.name,
            newExercise = next.exercise != r.logged.exercise,
            setNumber = next.set + 1,
            setCount = ex.sets.size,
            weight = set.weight,
            unit = ex.unit,
            reps = repsTarget(set.reps, set.minReps, set.amrap),
            sameWeight = next.exercise == r.logged.exercise && set.weight == last.weight,
        )
    }

    // ---- plates ----

    /** The distinct weights of the sets that get plate hints: pounds on a barbell. */
    fun plateWeights(): List<Double> = exercises.filter { it.barbell }.flatMap { ex -> ex.sets.mapNotNull { it.weight } }.distinct()

    /** Puts the plate answer into the rest after [logged], if that rest is still the one running. */
    fun withRestPlates(logged: SetRef, perSide: List<Double>?, instruction: String?, total: Double? = null): WorkoutState {
        val r = rest ?: return this
        return if (r.logged == logged) copy(rest = r.copy(perSide = perSide, plateInstruction = instruction, plateTotal = total)) else this
    }

    // ---- what the screen says around the logger ----

    /** The set the logger is on, null when the exercise has none. */
    val selectedSet: SetState? get() = exercise.sets.getOrNull(exercise.selected)

    /**
     * "Rest about 3:00, then set 4": the rest the selected set will earn at its current numbers (its RPE once picked
     * moves it) and what follows, for the line under the Log button. Null once the set is done. The last set of the
     * workout has no rest after it, and says so. With automatic rest off ([autoRest] false) no rest follows any set, so
     * the line only says what comes next.
     */
    fun restHint(autoRest: Boolean = true): String? {
        val set = selectedSet ?: return null
        if (set.done) return null
        val ref = SetRef(current, exercise.selected)
        val ex = exercise
        val afterLogging = copy(exercises = exercises.replace(current, ex.copy(sets = ex.sets.replace(ref.set, set.copy(done = true)))))
        val next = afterLogging.nextOpen(ref) ?: return "The last set, then you're done"
        val then = if (next.exercise == current) "set ${next.set + 1}" else exercises[next.exercise].name
        if (!autoRest) return "Then $then"
        val plan = restPlan(RestInput(ex.cls, set.targetReps, set.reps, set.rpe, set.targetRpe, ref.set + 1, set.amrap, set.timerSec))
        return "Rest about ${formatClock(plan.seconds)}, then $then"
    }

    /** The log button's words: "Log set 3", "Save set 3" for one already done, "Finish workout" when everything is done. */
    fun logLabel(): String {
        if (allDone && selectedSet?.done == true) return "Finish workout"
        val n = exercise.selected + 1
        return if (selectedSet?.done == true) "Save set $n" else "Log set $n"
    }

    // ---- the update script ----

    /**
     * Takes the entry the update script left for exercise [exercise]: the sets still to do follow it (a rewritten
     * weight, a changed number of sets), while a set already done and a set the script left as it was, with the
     * numbers the lifter may have changed on it, stay as they are.
     */
    fun withUpdatedEntry(exercise: Int, entry: JsonObject): WorkoutState {
        val ex = exercises.getOrNull(exercise) ?: return this
        val planned = plannedSets(entry, ex.unit)
        val sets = planned.mapIndexed { i, p ->
            val old = ex.sets.getOrNull(i)
            when {
                old != null && old.done -> old
                old != null && old.sameTarget(p) -> old
                else -> SetState.of(p)
            }
        }
        // Work already logged is never dropped, even when the script now asks for fewer sets than were done.
        val kept = sets + ex.sets.drop(planned.size).filter { it.done }
        val rewritten = ex.copy(entry = entry, sets = kept, selected = ex.selected.coerceIn(0, (kept.size - 1).coerceAtLeast(0)))
        return copy(exercises = exercises.replace(exercise, rewritten))
    }

    // ---- finishing ----

    /** The workout as the finish saves it. */
    fun toLifted(finishedAtMs: Long): LiftedSession = LiftedSession(
        sessionId = sessionId,
        programId = programId,
        day = day,
        startedAtMs = startedAtMs,
        finishedAtMs = finishedAtMs,
        exercises = exercises.map { ex ->
            LiftedExercise(ex.exerciseId, ex.key, ex.entry, ex.sets.map { PlannedSet(it.targetWeight, ex.unit, it.targetReps, it.minReps, it.amrap, it.targetRpe, it.timerSec) }, ex.sets.map { it.asLogged() })
        },
    )

    fun toJson(): String = DraftJson.encodeToString(serializer(), this)

    companion object {
        private val DraftJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        /** A draft read back; null when the text is not one (an older shape, a damaged row), which reads as no draft. */
        fun fromJson(text: String): WorkoutState? =
            try {
                DraftJson.decodeFromString(serializer(), text).takeIf { it.exercises.isNotEmpty() }
            } catch (e: Exception) {
                null
            }

        /** A new workout over [day]'s exercises, every set at its prescription, on the first exercise. */
        fun open(day: PlannedDay, sessionId: String, startedAtMs: Long, lastTime: (String) -> String? = { null }): WorkoutState = WorkoutState(
            sessionId = sessionId,
            programId = day.programId,
            programName = day.plan.programName,
            day = day.plan.day,
            dayName = day.plan.dayName,
            startedAtMs = startedAtMs,
            exercises = day.plan.exercises.map { ex ->
                ExerciseState(
                    key = ex.key,
                    exerciseId = ex.exerciseId,
                    name = ex.name,
                    unit = day.unit,
                    cls = ex.cls,
                    entry = ex.entry,
                    sets = ex.sets.map { SetState.of(it) },
                    lastTime = lastTime(ex.exerciseId),
                    equipment = ex.equipment,
                )
            },
        )
    }
}

private fun <T> List<T>.replace(index: Int, item: T): List<T> = mapIndexed { i, old -> if (i == index) item else old }
