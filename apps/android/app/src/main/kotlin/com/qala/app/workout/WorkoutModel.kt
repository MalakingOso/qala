package com.qala.app.workout

import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass
import com.qala.data.core.AutoregAction
import com.qala.data.core.AutoregWhy
import com.qala.data.core.RestFirstSet
import com.qala.data.program.LiftExercise
import com.qala.data.program.LiftedExercise
import com.qala.data.program.LiftedSession
import com.qala.data.program.LoggedRest
import com.qala.data.program.LoggedSet
import com.qala.data.program.PlannedDay
import com.qala.data.program.PlannedSet
import com.qala.data.program.completeEntry
import com.qala.data.program.jsonNumber
import com.qala.data.program.plannedSets
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

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
    /** The rest that followed this set, filled in when it ends (D32): seconds taken, the plan's base, its adjustments, the rest asked for. */
    val restTakenSec: Int? = null,
    val restBaseSec: Int? = null,
    val restAdjustSec: Int? = null,
    val restPlannedSec: Int? = null,
    /** The first logging judged this set a grind (RPE 9.5 or more, or reps under the range): what "two in a row" reads (S47). */
    val grind: Boolean = false,
    /** Dropped by the autoregulation after a grind: it stays in the list (the scripts are positional) but is not part of the workout. */
    val skipped: Boolean = false,
    /** Its [weight] was lowered after a grind; [targetWeight] stays the program's, so the scripts compare with what they asked for. */
    val adjusted: Boolean = false,
) {
    /** Still to do: neither done nor dropped. */
    val open: Boolean get() = !done && !skipped

    /** The prescription this set came from, for telling an edit of the numbers from a rewrite by the program. */
    fun sameTarget(other: PlannedSet): Boolean =
        targetWeight == other.weight && targetReps == other.reps && minReps == other.minReps && amrap == other.amrap &&
            targetRpe == other.rpe && timerSec == other.timerSec

    /** [miss] marks a set done at a lowered load as a miss for the finish-day scripts; the stored history keeps the real reps. */
    fun asLogged(miss: Boolean = false): LoggedSet? = if (done) LoggedSet(weight, reps, rpe, jointPain, rest(), asMiss = miss && adjusted) else null

    private fun rest(): LoggedRest? =
        if (restTakenSec != null && restBaseSec != null && restPlannedSec != null) LoggedRest(restTakenSec, restBaseSec, restAdjustSec ?: 0, restPlannedSec) else null

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
    /** The warm-up ramp up to the first work set, shown above the sets. Ticking a row starts its short rest; none of it is logged. */
    val ramps: List<RampSetState> = emptyList(),
    /** The seconds rested between ramp sets: warm-up time, not lifting or resting time, in the split. */
    val rampRestSec: Int = 0,
    /** A grind lowered or dropped sets of this exercise: the finish-day scripts count it as a miss (S47). */
    val autoregulated: Boolean = false,
) {
    /** Whether the lift is loaded with plates on a bar, which is what plate hints are for. */
    val barbell: Boolean get() = PlateMath.applies(unit, equipment == "barbell")

    val doneCount: Int get() = sets.count { it.done }

    /** The sets that are part of the workout: all but the ones a grind dropped. */
    val setCount: Int get() = sets.count { !it.skipped }
    val complete: Boolean get() = setCount > 0 && sets.all { it.done || it.skipped }

    /** The set to do next: the first one still open, or the last one that counts when none is. */
    val firstOpen: Int get() = sets.indexOfFirst { it.open }.takeIf { it >= 0 } ?: sets.indexOfLast { !it.skipped }.coerceAtLeast(0)

    /**
     * The entry with each set's weight at the number the lifter was shown (the program's weight rounded to the plates, D33).
     * Scripts compare what was lifted with what was planned (`completedWeights > weights` in the Westside autoreg), so the
     * two have to be the same number when the lifter loaded what the screen said.
     */
    fun scriptEntry(): JsonObject {
        val planned = entry["sets"]?.jsonArray.orEmpty().mapIndexed { i, el ->
            val set = el.jsonObject
            val target = sets.getOrNull(i)?.targetWeight
            val weight = set["weight"] as? JsonObject
            if (target == null || weight == null) el else JsonObject(set + ("weight" to JsonObject(weight + ("value" to jsonNumber(target)))))
        }
        return JsonObject(entry + ("sets" to JsonArray(planned)))
    }

    /** The entry with the sets done so far marked completed: what the update and finish-day scripts read. */
    fun completedEntry(): JsonObject = completeEntry(scriptEntry(), sets.map { it.asLogged() }, unit)
}

/** The ledger line of a ramp rest. */
const val WarmupRestLabel = "Rest between warm-up sets"

/** How many presses of the weight stepper either way get their plates worked out ahead of the press. */
const val StepperReach = 6

/** One step of the warm-up ramp as the workout carries it: [done] once it was ticked. [bar] means the empty bar. */
@Serializable
data class RampSetState(val load: Double, val reps: Int, val restSec: Int, val bar: Boolean = false, val extra: Boolean = false, val done: Boolean = false)

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
    /** The plan's base and the sum of its adjustments, kept for the learned pace once the rest has ended (D32). */
    val base: Int = 0,
    val adjust: Int = 0,
    /** The plates for each side of the next set, heaviest first, once the plate math has answered; null for a lift with no plates. */
    val perSide: List<Double>? = null,
    /** What to take off and put on to get there from the set just done ("take off 5, add 25 each side"), when both are plate-loaded. */
    val plateInstruction: String? = null,
    /** What those plates add up to, bar included: it differs from the next set's weight when that weight cannot be loaded exactly. */
    val plateTotal: Double? = null,
    /** The ramp step this rest follows, when it is a warm-up rest: [logged] then only names the exercise. */
    val ramp: Int? = null,
    /** What the autoregulation did after the set just logged, for the ledger to say (S47). */
    val autoreg: AutoregNote? = null,
) {
    val timer: RestTimer get() = RestTimer(startedAtMs, seconds)
    val endsAtMs: Long get() = startedAtMs + seconds * 1000L
    fun plus(extra: Int): RestState = copy(seconds = seconds + extra)
}

/** What a grind changed: the load of the [sets] still to do went down by [percent] (to [weight] on the next of them) or they were dropped. */
@Serializable
data class AutoregNote(val action: AutoregAction, val percent: Int, val why: AutoregWhy, val sets: Int, val weight: Double? = null)

/** What the rest screen says it is resting from: "Back squat, set 2 logged, 150 lb x 3 at RPE 9". [warmup] is a ramp step, which has no RPE. */
data class RestLogged(val exerciseName: String, val setNumber: Int, val weight: Double?, val reps: Double, val unit: WeightUnit, val rpe: Double?, val warmup: Boolean = false)

/** What the rest-end notification says is next: "Back squat, set 3"; the end of the workout when there is no set after. */
fun WorkoutState.restAlarmText(): String = restNext()?.let { "Next: ${it.exerciseName}, set ${it.setNumber}" } ?: "That was the last set"

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

/**
 * What logging a set did: the state after, the set that was logged, whether it was a first logging (which opens Rest), the
 * set to do next, and what the rest plan and the autoregulation said about it ([plan] is null for a set edited after the fact).
 */
data class Logged(val state: WorkoutState, val ref: SetRef, val first: Boolean, val next: SetRef?, val plan: RestPlan? = null, val autoreg: AutoregNote? = null)

/** What a logged set asks of the screen. */
enum class AfterLog {
    /** Open Rest: the first logging of a set that is not the last, with automatic rest on. */
    Rest,

    /** Offer to finish: it was the last set. */
    Finish,

    /** Stay where the logger is. */
    Stay,

    /** The logger has moved on to the next set and no Rest opens, because automatic rest is off in Settings. */
    Next,

    /** A set edited after the fact was saved: its row says "Saved" for a moment, and then the logger goes back to the set that was open. */
    Saved,
}

/** The workout after a logging, and what the screen does about it. */
data class Settled(val state: WorkoutState, val after: AfterLog)

/**
 * Decides what a logging opens. A first logging of a set that is not the last starts the rest after it (the length and
 * the ledger from the plan [log] made, counted from [nowMs]) when [autoRest] is on, and leaves Rest unopened when it is off;
 * the last set offers to finish either way, and a set edited after the fact is saved (the logger goes back to the set that
 * was open once its row has said "Saved").
 */
fun Logged.settle(nowMs: Long, autoRest: Boolean, contexts: Map<String, RestContext> = emptyMap()): Settled = when {
    !first -> Settled(state, AfterLog.Saved)
    next == null -> Settled(state, AfterLog.Finish)
    autoRest -> Settled(state.startRest(ref, next, nowMs, contexts[state.exercises[ref.exercise].key] ?: RestContext(), plan, autoreg), AfterLog.Rest)
    else -> Settled(state, AfterLog.Next)
}

/** The seconds rested between ramp sets, over all exercises: warm-up time in the split, not lifting time. */
fun WorkoutState.rampRestSeconds(): Int = exercises.sumOf { it.rampRestSec }

@Serializable
data class WorkoutState(
    /** Minted when the workout opens, so saving it twice writes one session. */
    val sessionId: String,
    val programId: String?,
    val programName: String,
    /** The 1-based program day. */
    val day: Int,
    val dayName: String,
    /** When the lifting began: the workout's own clock, the header's "in" time and the lifting slice start here. */
    val startedAtMs: Long,
    val exercises: List<ExerciseState>,
    /** The exercise the pager is on. */
    val current: Int = 0,
    val rest: RestState? = null,
    /** False while the draft only holds a warm-up in progress; [startedAtMs] is then the placeholder the draft was opened at. */
    val liftStarted: Boolean = true,
    /** When the warm-up's first action happened, and the minutes it took once the lifting began (null when it was not measured). */
    val warmupStartedAtMs: Long? = null,
    val warmupSec: Int? = null,
    /** The cardio countdown: when it was started, and its length in seconds (null until the warm-up has set one). */
    val cardioStartedAtMs: Long? = null,
    val cardioSec: Int? = null,
    /** Ids of the soft-tissue and mobility rows ticked on the warm-up. */
    val warmupTicked: List<String> = emptyList(),
    /** A set already done whose numbers were changed since: leaving it counts as Save. */
    val dirty: SetRef? = null,
) {
    val exercise: ExerciseState get() = exercises[current]
    val loggedSets: Int get() = exercises.sumOf { it.doneCount }
    val totalSets: Int get() = exercises.sumOf { it.setCount }
    val allDone: Boolean get() = totalSets > 0 && loggedSets == totalSets

    /** The name of the exercise before the current one, null at the first: the Prev button's label. */
    val prevName: String? get() = exercises.getOrNull(current - 1)?.name

    /** The name of the exercise after the current one, null at the last: the Next button's label. */
    val nextName: String? get() = exercises.getOrNull(current + 1)?.name

    /** The cardio countdown as a clock, null until it was started. */
    val cardio: RestTimer? get() = cardioStartedAtMs?.let { RestTimer(it, cardioSec ?: 0) }

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
        val changed = copy(exercises = exercises.replace(current, ex.copy(sets = ex.sets.replace(i, change(ex.sets[i])))))
        // Changing the numbers of a set already done leaves it unsaved until Save, or until the lifter moves off it.
        return if (ex.sets[i].done && changed != this) changed.copy(dirty = SetRef(current, i)) else changed
    }

    /** The set that was edited after it was done and not saved yet, if it is still that one's turn to be saved. */
    fun unsaved(): SetRef? = dirty?.takeIf { exercises.getOrNull(it.exercise)?.sets?.getOrNull(it.set)?.done == true }

    /** The edit of a done set kept: the same state without the unsaved mark. */
    fun saved(): WorkoutState = if (dirty == null) this else copy(dirty = null)

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
     * Logs the selected set of the current exercise. A set logged for the first time is judged by the rest plan (a grind
     * is remembered on the set, and with [autoreg] on may lower or drop the sets still to come, S47), then moves the logger
     * on to the next set (which is [Logged.next], possibly in another exercise) and is what opens Rest. Logging a set that
     * was already done saves the changed numbers and goes back to the set that was open.
     * [lowered] rounds a load of an exercise down to what the plates (or the dumbbells) can make.
     */
    fun log(nowMs: Long, context: RestContext = RestContext(), autoreg: Boolean = false, lowered: (ExerciseState, Double) -> Double = { _, w -> w }): Logged? {
        val ex = exercise
        val i = ex.selected
        val set = ex.sets.getOrNull(i) ?: return null
        val first = !set.done
        val ref = SetRef(current, i)
        // Logging the next set is the end of a rest that is still running: its numbers are kept before the new set is marked done.
        val rested = if (first) endRest(nowMs) else this
        val marked = rested.copy(
            exercises = rested.exercises.replace(current, ex.copy(sets = rested.exercises[current].sets.replace(i, set.copy(done = true, loggedAtMs = set.loggedAtMs ?: nowMs)))),
            dirty = null,
        )
        // A saved edit stays on its row while "Saved" shows; [Logged.next] is the set the logger goes back to once it has (the store moves it).
        if (!first) return Logged(marked, ref, first = false, next = marked.nextActive(ref))
        val plan = marked.restPlanFor(ref, context)
        val judged = marked.mapSet(ref) { it.copy(grind = plan.grind) }
        val change = if (autoreg) plan.autoreg?.let { judged.autoregulate(ref, it, lowered) } else null
        val done = change?.first ?: judged
        val next = done.nextOpen(ref)
        return Logged(if (next != null) done.show(next.exercise, next.set) else done, ref, first = true, next = next, plan = plan, autoreg = change?.second)
    }

    private fun mapSet(ref: SetRef, change: (SetState) -> SetState): WorkoutState {
        val ex = exercises[ref.exercise]
        return copy(exercises = exercises.replace(ref.exercise, ex.copy(sets = ex.sets.replace(ref.set, change(ex.sets[ref.set])))))
    }

    /** The rest plan after the set at [ref], which must be done: its numbers, the exercise's first set and the day's context. */
    private fun restPlanFor(ref: SetRef, context: RestContext): RestPlan {
        val ex = exercises[ref.exercise]
        val set = ex.sets[ref.set]
        val first = ex.sets.firstOrNull()?.takeIf { ref.set > 0 && it.done }?.let { RestFirstSet(it.reps, it.rpe, it.weight) }
        val before = ex.sets.take(ref.set).lastOrNull { it.done }
        return restPlan(
            RestInput(
                ex.cls, set.targetReps, set.reps, set.rpe, set.targetRpe, ref.set + 1, set.amrap, set.timerSec, set.weight, first, context,
                minReps = set.minReps, prevGrind = before?.grind == true, lowered = ex.autoregulated,
            ),
        )
    }

    /**
     * Applies what a grind asks of the sets still to do in the exercise of [ref]: their weights down by the plan's percent,
     * rounded down to loadable plates by [lowered], or all of them dropped. Null when nothing was left to change.
     */
    private fun autoregulate(ref: SetRef, action: com.qala.data.core.AutoregDto, lowered: (ExerciseState, Double) -> Double): Pair<WorkoutState, AutoregNote>? {
        val ex = exercises[ref.exercise]
        val left = ex.sets.indices.filter { it > ref.set && ex.sets[it].open } + ex.sets.indices.filter { it < ref.set && ex.sets[it].open }
        if (left.isEmpty()) return null
        val sets = ex.sets.mapIndexed { i, s ->
            when {
                i !in left -> s
                action.action == AutoregAction.DropRemaining -> s.copy(skipped = true)
                s.weight == null -> s
                else -> lowered(ex, s.weight * (100 - action.percent) / 100.0).let { w -> if (w < s.weight) s.copy(weight = w, adjusted = true) else s }
            }
        }
        val changed = sets.zip(ex.sets).any { (a, b) -> a != b }
        if (!changed) return null
        val shown = sets.getOrNull(left.first())?.weight
        val note = AutoregNote(action.action, action.percent, action.why, left.size, shown.takeIf { action.action == AutoregAction.Lower })
        return copy(exercises = exercises.replace(ref.exercise, ex.copy(sets = sets, autoregulated = true))) to note
    }

    /** The set to go back to after a set was edited and saved: the first one still open in its exercise, else the next one anywhere; null when all are done. */
    private fun nextActive(from: SetRef): SetRef? {
        val here = exercises[from.exercise]
        here.sets.indexOfFirst { it.open }.takeIf { it >= 0 }?.let { return SetRef(from.exercise, it) }
        return nextOpen(from)
    }

    /**
     * The set to do after [from]: the next one still open in that exercise, else one that was skipped before it, else the
     * first open set of the following exercises in order (wrapping round to those before). Null when every set is done.
     */
    fun nextOpen(from: SetRef): SetRef? {
        val here = exercises[from.exercise]
        here.sets.indices.firstOrNull { it > from.set && here.sets[it].open }?.let { return SetRef(from.exercise, it) }
        here.sets.indices.firstOrNull { here.sets[it].open }?.let { return SetRef(from.exercise, it) }
        for (step in 1 until exercises.size) {
            val e = (from.exercise + step) % exercises.size
            val open = exercises[e].sets.indexOfFirst { it.open }
            if (open >= 0) return SetRef(e, open)
        }
        return null
    }

    // ---- rest ----

    /**
     * Starts the rest after the set at [ref]: its length and ledger from [plan] (worked out here when the caller has none,
     * as a rest started by hand has not), counted from [nowMs]. [next] is the set it rests for; [note] is what the
     * autoregulation did, for the ledger to say.
     */
    fun startRest(ref: SetRef, next: SetRef?, nowMs: Long, context: RestContext = RestContext(), plan: RestPlan? = null, note: AutoregNote? = null): WorkoutState {
        val p = plan ?: restPlanFor(ref, context)
        return copy(rest = RestState(ref, next, nowMs, p.seconds, p.rows, p.base, p.adjust, autoreg = note))
    }

    /**
     * Starts the short rest after ramp step [step] of [exercise], which is ticked. It runs on the same timer as a work set's
     * rest and leads to the exercise's first open set. A rest already running is ended first, its numbers kept.
     */
    fun tickRamp(exercise: Int, step: Int, nowMs: Long): WorkoutState {
        val ex = exercises.getOrNull(exercise) ?: return this
        val ramp = ex.ramps.getOrNull(step) ?: return this
        val ended = endRest(nowMs)
        val ticked = ex.ramps.replace(step, ramp.copy(done = !ramp.done))
        val state = ended.copy(exercises = ended.exercises.replace(exercise, ended.exercises[exercise].copy(ramps = ticked)))
        // Un-ticking a step only takes the tick back; ticking one starts its rest.
        if (ramp.done || ramp.restSec <= 0) return state
        val first = ex.firstOpen.takeIf { ex.sets.getOrNull(it)?.open == true }
        return state.copy(rest = RestState(SetRef(exercise, 0), first?.let { SetRef(exercise, it) }, nowMs, ramp.restSec, listOf(RestRow(WarmupRestLabel, ramp.restSec)), ramp = step))
    }

    /**
     * Ends the rest. With [nowMs] the numbers of the rest (what was taken against what was asked) are kept on the set it
     * followed, which is what the learned pace reads later (D32); a ramp rest adds what it took to the exercise's warm-up time.
     */
    fun endRest(nowMs: Long? = null): WorkoutState {
        val r = rest ?: return this
        if (nowMs == null) return copy(rest = null)
        val ex = exercises.getOrNull(r.logged.exercise) ?: return copy(rest = null)
        val taken = ((nowMs - r.startedAtMs) / 1000).toInt().coerceAtLeast(0)
        if (r.ramp != null) return copy(exercises = exercises.replace(r.logged.exercise, ex.copy(rampRestSec = ex.rampRestSec + taken)), rest = null)
        val set = ex.sets.getOrNull(r.logged.set) ?: return copy(rest = null)
        val noted = set.copy(restTakenSec = taken, restBaseSec = r.base, restAdjustSec = r.adjust, restPlannedSec = r.seconds)
        return copy(exercises = exercises.replace(r.logged.exercise, ex.copy(sets = ex.sets.replace(r.logged.set, noted))), rest = null)
    }

    /** The rest budget with [seconds] added. */
    fun addRest(seconds: Int): WorkoutState = copy(rest = rest?.plus(seconds))

    /** "Back squat, set 2 logged": what the rest screen says it is resting from; null with no rest. */
    fun restLogged(): RestLogged? {
        val r = rest ?: return null
        val ex = exercises[r.logged.exercise]
        if (r.ramp != null) {
            val step = ex.ramps[r.ramp]
            return RestLogged(ex.name, r.ramp + 1, step.load.takeIf { !step.bar }, step.reps.toDouble(), ex.unit, null, warmup = true)
        }
        val set = ex.sets[r.logged.set]
        return RestLogged(ex.name, r.logged.set + 1, set.weight, set.reps, ex.unit, set.rpe)
    }

    /** The set the rest is for; null with no rest or when the workout is done. */
    fun restNext(): RestNext? {
        val r = rest ?: return null
        val next = r.next ?: return null
        val ex = exercises[next.exercise]
        val set = ex.sets[next.set]
        val sameWeight = r.ramp == null && next.exercise == r.logged.exercise && set.weight == exercises[r.logged.exercise].sets[r.logged.set].weight
        return RestNext(
            exerciseName = ex.name,
            newExercise = next.exercise != r.logged.exercise,
            setNumber = next.set + 1,
            setCount = ex.setCount,
            weight = set.weight,
            unit = ex.unit,
            reps = repsTarget(set.reps, set.minReps, set.amrap),
            sameWeight = sameWeight,
        )
    }

    // ---- plates ----

    /**
     * The distinct weights that get plate hints: pounds on a barbell, for every set and ramp step, and for the weights the
     * stepper of the open set can reach in a few presses either way, so the plates are already there when it lands.
     */
    fun plateWeights(reach: Int = StepperReach): List<Double> = exercises.filter { it.barbell }.flatMap { ex ->
        val steps = weightStep(ex.unit)
        val set = ex.sets.mapNotNull { it.weight }
        val ramp = ex.ramps.filter { !it.bar }.map { it.load }
        val window = ex.sets.getOrNull(ex.selected)?.weight?.let { w -> (-reach..reach).map { (w + it * steps).coerceAtLeast(0.0) } }.orEmpty()
        set + ramp + window
    }.distinct()

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
        val plan = restPlan(RestInput(ex.cls, set.targetReps, set.reps, set.rpe, set.targetRpe, ref.set + 1, set.amrap, set.timerSec, minReps = set.minReps))
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
     * numbers the lifter may have changed on it, stay as they are. [planned] is the entry's sets when the caller has
     * already rounded their weights to the plates (the default reads them as the script wrote them).
     */
    fun withUpdatedEntry(exercise: Int, entry: JsonObject, planned: List<PlannedSet>? = null): WorkoutState {
        val ex = exercises.getOrNull(exercise) ?: return this
        val planned = planned ?: plannedSets(entry, ex.unit)
        val sets = planned.mapIndexed { i, p ->
            val old = ex.sets.getOrNull(i)
            when {
                old != null && (old.done || old.skipped || old.adjusted) -> old        // work done, dropped or lowered by a grind is not the script's to rewrite
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

    /**
     * The workout as the finish saves it. The warm-up's slice is the time its screen took plus the rests between ramp sets,
     * which come out of the lifting slice, so the three slices still add up to the workout's time.
     */
    fun toLifted(finishedAtMs: Long): LiftedSession {
        val ramp = rampRestSeconds()
        val warmup = if (warmupSec == null && ramp == 0) null else (warmupSec ?: 0) + ramp
        return LiftedSession(
            sessionId = sessionId,
            programId = programId,
            day = day,
            startedAtMs = startedAtMs,
            finishedAtMs = finishedAtMs,
            warmupSec = warmup,
            restSec = restSeconds(),
            liftSec = (((finishedAtMs - startedAtMs).coerceAtLeast(0) / 1000).toInt() - restSeconds() - ramp).coerceAtLeast(0),
            exercises = exercises.map { ex ->
                // A lowered set counts as a miss for the finish-day scripts; the history keeps what was lifted.
                LiftedExercise(ex.exerciseId, ex.key, ex.scriptEntry(), ex.sets.map { PlannedSet(it.targetWeight, ex.unit, it.targetReps, it.minReps, it.amrap, it.targetRpe, it.timerSec) }, ex.sets.map { it.asLogged(miss = ex.autoregulated) })
            },
        )
    }

    // ---- the warm-up ----

    /** The warm-up's first action: the draft was opened for it, so it starts the warm-up's clock. */
    fun warmupStarted(nowMs: Long): WorkoutState = if (warmupStartedAtMs != null || liftStarted) this else copy(warmupStartedAtMs = nowMs)

    /** Starts the cardio countdown at [budgetSec]; one already running is left as it is. */
    fun startCardio(nowMs: Long, budgetSec: Int): WorkoutState =
        if (cardioStartedAtMs != null) this else copy(cardioStartedAtMs = nowMs, cardioSec = budgetSec.coerceAtLeast(MinCardioSec))

    /** Adds [seconds] (or takes them off) to a running countdown, never under a minute. */
    fun addCardio(seconds: Int): WorkoutState = if (cardioStartedAtMs == null) this else copy(cardioSec = ((cardioSec ?: 0) + seconds).coerceAtLeast(MinCardioSec))

    /** Ticks a soft-tissue or mobility row, or takes the tick back. */
    fun flipWarmup(id: String): WorkoutState = copy(warmupTicked = if (id in warmupTicked) warmupTicked - id else warmupTicked + id)

    /**
     * The lifting begins: the workout's clock starts now and the warm-up's time is what passed since its first action. A
     * workout already lifting is left alone.
     */
    fun beginLift(nowMs: Long, longestWarmupSec: Int): WorkoutState {
        if (liftStarted) return this
        val measured = warmupStartedAtMs?.let { ((nowMs - it) / 1000).toInt() }?.takeIf { it in 1..longestWarmupSec }
        return copy(liftStarted = true, startedAtMs = nowMs, warmupSec = measured)
    }

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

        /**
         * A new workout over [day]'s exercises, every set at its prescription, on the first exercise. [prescribed] gives an
         * exercise's sets when they are not the program's own numbers (rounded to the plates the lifter has).
         */
        fun open(
            day: PlannedDay,
            sessionId: String,
            startedAtMs: Long,
            prescribed: (LiftExercise) -> List<PlannedSet> = { it.sets },
            ramps: (LiftExercise) -> List<RampSetState> = { emptyList() },
            forWarmup: Boolean = false,
            lastTime: (String) -> String? = { null },
        ): WorkoutState = WorkoutState(
            sessionId = sessionId,
            programId = day.programId,
            programName = day.plan.programName,
            day = day.plan.day,
            dayName = day.plan.dayName,
            startedAtMs = startedAtMs,
            liftStarted = !forWarmup,
            warmupStartedAtMs = if (forWarmup) startedAtMs else null,
            exercises = day.plan.exercises.map { ex ->
                ExerciseState(
                    key = ex.key,
                    exerciseId = ex.exerciseId,
                    name = ex.name,
                    unit = day.unit,
                    cls = ex.cls,
                    entry = ex.entry,
                    sets = prescribed(ex).map { SetState.of(it) },
                    lastTime = lastTime(ex.exerciseId),
                    equipment = ex.equipment,
                    ramps = ramps(ex),
                )
            },
        )
    }
}

/** The shortest the cardio countdown goes: a minute. */
const val MinCardioSec = 60

private fun <T> List<T>.replace(index: Int, item: T): List<T> = mapIndexed { i, old -> if (i == index) item else old }

/**
 * What the ongoing workout notification says (S45). While a rest runs it counts down to [countDownToMs] and names the set it
 * is resting for; otherwise it counts up from [countUpFromMs], the start of the lifting (of the warm-up before it), with the set the
 * logger is on. A rest left running past its end counts as no rest: the notification is back to counting up.
 */
data class WorkoutNotice(val title: String, val text: String, val countDownToMs: Long?, val countUpFromMs: Long)

fun WorkoutState.notice(nowMs: Long): WorkoutNotice {
    val r = rest
    val from = if (liftStarted) startedAtMs else warmupStartedAtMs ?: startedAtMs
    if (r != null && nowMs < r.endsAtMs) {
        val next = restNext()
        val text = next?.let { "Next: ${setLine(it.exerciseName, it.setNumber, it.weight, it.unit)}" } ?: "That was the last set"
        return WorkoutNotice("Rest", text, r.endsAtMs, from)
    }
    val ex = exercise
    val set = selectedSet
    return WorkoutNotice(if (liftStarted) "Workout" else "Warm-up", setLine(ex.name, ex.selected + 1, set?.weight, ex.unit), null, from)
}

/** "Squat set 3 @ 225 lb": a set as the notification names it. */
private fun setLine(name: String, number: Int, weight: Double?, unit: WeightUnit): String =
    "$name set $number" + (weight?.let { " @ ${formatWeight(it)} ${unitLabel(unit)}" } ?: "")
