package com.qala.app.workout

import com.qala.data.core.AutoregDto
import com.qala.data.core.QalaCore
import com.qala.data.core.RestCode
import com.qala.data.core.RestFirstSet
import com.qala.data.core.RestRequest
import com.qala.data.core.RestRowDto
import com.qala.data.core.planRest
import com.qala.data.program.ExerciseClass
import kotlinx.serialization.Serializable

/*
 * How long to rest after a set (PLAN 6.6, DECISIONS D32). The plan is Rust (qala-core rest.rs): the base for the lift's class
 * and rep range, the lifter's learned pace, the effort of the set, a miss, a late set or rep drift, low readiness. It comes
 * back as numbers and reason codes, and this file words each row of the "Why" ledger. [RestTimer] is the clock that counts
 * the rest down, and stays here.
 */

/**
 * One line of the "Why" ledger: the base, then each adjustment in signed seconds. [seconds] is what counted under the cap. A row
 * that came after the cap has [seconds] 0 and [atMax] true: it is shown greyed, unsigned, as "at max", and is not summed.
 */
@Serializable
data class RestRow(val label: String, val seconds: Int, val atMax: Boolean = false)

/** A rest: the seconds to take, the ledger that adds up to them, and what a later look at this rest needs (D32). [autoreg] is what a grind asks of the load (S47). */
data class RestPlan(val seconds: Int, val base: Int, val adjust: Int, val rows: List<RestRow>, val grind: Boolean = false, val autoreg: AutoregDto? = null)

/** What the set just logged says about the rest after it, with what the day and the history add. */
data class RestInput(
    val cls: ExerciseClass,
    /** The reps the set asked for; at 6 or fewer the lift counts as strength work, above as hypertrophy. */
    val targetReps: Double,
    val loggedReps: Double,
    val loggedRpe: Double? = null,
    val targetRpe: Double? = null,
    /** 1-based number of the set just logged. */
    val setNumber: Int = 1,
    val amrap: Boolean = false,
    /** The program's own rest for the set, when it names one: it replaces the table's base. */
    val explicitBase: Int? = null,
    /** The load of this set and the exercise's first work set today, for rep drift. */
    val weight: Double? = null,
    val first: RestFirstSet? = null,
    /** What the day and the history say: soreness, recovery, local fatigue and past rests. See [RestContext]. */
    val context: RestContext = RestContext(),
    /** The bottom of the set's rep range (8 on 8-12): fewer reps than this is a miss. */
    val minReps: Double? = null,
    /** The set before this one in the exercise was a grind, and its load was already lowered today. */
    val prevGrind: Boolean = false,
    val lowered: Boolean = false,
)

/**
 * The rest after a set, from the Rust plan. Synchronous Rust, a few hundred microseconds: fine on the main thread, where a
 * logged set starts it.
 */
fun restPlan(input: RestInput): RestPlan {
    val c = input.context
    val plan = QalaCore.planRest(
        RestRequest(
            cls = input.cls.name.lowercase(),
            targetReps = input.targetReps,
            loggedReps = input.loggedReps,
            loggedRpe = input.loggedRpe,
            targetRpe = input.targetRpe,
            setNumber = input.setNumber,
            amrap = input.amrap,
            minReps = input.minReps,
            prevGrind = input.prevGrind,
            lowered = input.lowered,
            explicitBase = input.explicitBase,
            weight = input.weight,
            first = input.first,
            soreness = c.soreness,
            prs = c.prs,
            fatigueLocal = c.fatigueLocal,
            exerciseHistory = c.exercise,
            classHistory = c.cls,
        ),
    )
    return RestPlan(plan.seconds, plan.base, plan.adjust, plan.rows.map { RestRow(rowLabel(it), it.applied, atMax = it.applied == 0 && it.seconds > 0) }, plan.grind, plan.autoreg)
}

/** The words for one row of the ledger. */
fun rowLabel(row: RestRowDto): String {
    val v = row.value
    val o = row.other
    return when (row.code) {
        RestCode.BaseProgram -> "The program's rest"
        RestCode.BaseMainHeavy -> "Base for a heavy main lift"
        RestCode.BaseMain -> "Base for a main lift"
        RestCode.BaseSecond -> "Base for a second lift"
        RestCode.BaseIsolation -> "Base for an isolation lift"
        RestCode.Pace -> "Your pace, ${paceText(v ?: 1.0)} of the base"
        RestCode.Failure -> "Last set was a grind, RPE ${formatWeight(v ?: 0.0)}"
        RestCode.EffortHigh, RestCode.EffortLow -> "Last set at RPE ${formatWeight(v ?: 0.0)}, target ${formatWeight(o ?: 0.0)}"
        RestCode.RepsShort -> "Reps short of ${formatWeight(v ?: 0.0)}"
        RestCode.LateSet -> "Set ${(v ?: 0.0).toInt()} of a heavy lift"
        RestCode.Drift -> "Reps or effort slipped since the first set"
        RestCode.LowReadiness -> "Not fully recovered today"
        RestCode.Round -> "Rounded to the nearest 15 s"
        RestCode.Floor -> "Raised to the minimum, ${formatClock((v ?: 0.0).toInt())}"
    }
}

/** "84%": the learned pace as a share of the base. */
private fun paceText(multiplier: Double): String = "${Math.round(multiplier * 100)}%"

/**
 * A rest in progress: when it started and how long it is. The time left is a function of the clock, never a counter,
 * so a recomposition, a rotation or a trip to the workout and back loses nothing. Adding time lengthens the budget,
 * so the bar and the "of" figure move with it, as on the web.
 */
data class RestTimer(val startedAtMs: Long, val budgetSec: Int) {
    fun elapsedSec(nowMs: Long): Int = ((nowMs - startedAtMs) / 1000).toInt().coerceAtLeast(0)

    /** Whole seconds left, 0 once the time is up. */
    fun remainingSec(nowMs: Long): Int = (budgetSec - elapsedSec(nowMs)).coerceAtLeast(0)

    fun isUp(nowMs: Long): Boolean = remainingSec(nowMs) == 0

    /** The part of the budget still to go, 1 down to 0, for the bar. */
    fun fraction(nowMs: Long): Float = if (budgetSec <= 0) 0f else remainingSec(nowMs).toFloat() / budgetSec

    /** When the time is up, on the clock. */
    val endsAtMs: Long get() = startedAtMs + budgetSec * 1000L

    /** Whole seconds past the end, 0 until the time is up: a rest left running while the next set is being done. */
    fun overSec(nowMs: Long): Int = (elapsedSec(nowMs) - budgetSec).coerceAtLeast(0)

    /** The same rest [seconds] longer. */
    fun plus(seconds: Int): RestTimer = copy(budgetSec = budgetSec + seconds)
}
