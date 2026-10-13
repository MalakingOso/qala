package com.qala.app.workout

import com.qala.data.program.ExerciseClass
import kotlinx.serialization.Serializable
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/*
 * How long to rest after a set (PLAN 6.6, ported from packages/engine/rest.ts) and the clock that counts it down. Pure:
 * no Compose, no Rust, no clock of its own. The learning multiplier is not ported: it needs a store of past rests,
 * and every set rests as if the multiplier were 1. Rep drift and low readiness need history and the check-in, and
 * are left out too, so a rest is never shorter than the web's would be and sometimes 30 s shorter.
 */

/** One line of the "Why" ledger: the base, then each adjustment in signed seconds. */
@Serializable
data class RestRow(val label: String, val seconds: Int)

/** A rest: the seconds to take and the ledger that adds up to them. */
data class RestPlan(val seconds: Int, val base: Int, val rows: List<RestRow>)

/** What the set just logged says about the rest after it. */
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
)

private class Cell(val base: Int, val min: Int, val max: Int)

private fun cell(strength: Boolean, cls: ExerciseClass): Cell = when (cls) {
    ExerciseClass.Main -> if (strength) Cell(180, 120, 300) else Cell(150, 90, 240)
    ExerciseClass.Secondary -> if (strength) Cell(150, 90, 240) else Cell(120, 90, 180)
    ExerciseClass.Isolation -> Cell(90, 60, 150)
}

/** Seconds to the nearest 15, halves up. */
fun round15(seconds: Double): Int = (floor(seconds / 15.0 + 0.5) * 15).toInt()

private fun baseLabel(cls: ExerciseClass, strength: Boolean, explicit: Boolean): String = when {
    explicit -> "The program's rest"
    cls == ExerciseClass.Main -> if (strength) "Base for a heavy main lift" else "Base for a main lift"
    cls == ExerciseClass.Secondary -> "Base for a second lift"
    else -> "Base for an isolation lift"
}

/**
 * The rest after a set: the base for the lift's class and rep range (or the program's own), the effort of the set
 * against its target RPE (15 s per half point, up to +45 and down to -30), a failure or a miss, and the strain of a
 * late set on a heavy lift; rounded to 15 s and kept inside the class's range.
 */
fun restPlan(input: RestInput): RestPlan {
    val strength = input.targetReps <= 6
    val cell = cell(strength, input.cls)
    val base = input.explicitBase ?: cell.base
    val rows = ArrayList<RestRow>()
    rows += RestRow(baseLabel(input.cls, strength, input.explicitBase != null), base)
    var adjust = 0

    val rpe = input.loggedRpe
    val failed = rpe != null && (rpe >= 10.0 || (input.loggedReps < input.targetReps && !input.amrap && rpe >= 9.5))
    if (failed) {
        val a = if (input.cls == ExerciseClass.Isolation) 30 else 60
        adjust += a
        rows += RestRow("Last set was a grind, RPE ${formatWeight(rpe)}", a)
    } else if (rpe != null && input.targetRpe != null) {
        val e = min(45.0, max(-30.0, 30.0 * (rpe - input.targetRpe))).toInt()
        if (e != 0) {
            adjust += e
            rows += RestRow("Last set at RPE ${formatWeight(rpe)}, target ${formatWeight(input.targetRpe)}", e)
        }
    }
    if (!failed && !input.amrap && input.loggedReps < input.targetReps) {
        adjust += 30
        rows += RestRow("Reps short of ${formatWeight(input.targetReps)}", 30)
    }
    if (strength && input.cls == ExerciseClass.Main && input.setNumber >= 4) {
        adjust += 30
        rows += RestRow("Set ${input.setNumber} of a heavy lift", 30)
    }

    val raw = round15((base + adjust).toDouble())
    val seconds = raw.coerceIn(cell.min, cell.max)
    if (seconds != base + adjust) rows += RestRow("Rounded to 15 s, kept between ${formatClock(cell.min)} and ${formatClock(cell.max)}", seconds - (base + adjust))
    return RestPlan(seconds, base, rows)
}

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

    /** The same rest [seconds] longer. */
    fun plus(seconds: Int): RestTimer = copy(budgetSec = budgetSec + seconds)
}
