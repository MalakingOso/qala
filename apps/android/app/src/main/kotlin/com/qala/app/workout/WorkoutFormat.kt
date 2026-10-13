package com.qala.app.workout

import com.qala.data.model.WeightUnit
import com.qala.data.program.LastSet
import com.qala.data.program.PlannedSet
import kotlin.math.roundToInt

/** "150", "152.5": a weight without a trailing ".0". */
fun formatWeight(weight: Double): String =
    if (weight == Math.rint(weight)) weight.toLong().toString() else "%.1f".format(java.util.Locale.US, weight).trimEnd('0').trimEnd('.')

fun unitLabel(unit: WeightUnit): String = if (unit == WeightUnit.Kg) "kg" else "lb"

private fun formatReps(reps: Double): String = formatWeight(reps)

/** The reps a set asks for: "3", "3+" for an as-many-as-possible set, "8-12" for a range. */
fun repsTarget(reps: Double, minReps: Double?, amrap: Boolean): String = when {
    amrap -> formatReps(reps) + "+"
    minReps != null && minReps < reps -> formatReps(minReps) + "-" + formatReps(reps)
    else -> formatReps(reps)
}

fun repsTarget(set: PlannedSet): String = repsTarget(set.reps, set.minReps, set.amrap)

/** "1:05", "12:40": seconds as a clock. An hour or more counts on in minutes ("62:10"), as a workout clock does. */
fun formatClock(totalSeconds: Int): String {
    val s = totalSeconds.coerceAtLeast(0)
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

/** "+0:30", "-0:15": a signed number of seconds for the rest ledger, with a real minus sign. */
fun formatSigned(seconds: Int): String = (if (seconds < 0) "−" else "+") + formatClock(kotlin.math.abs(seconds))

/**
 * Last time's work sets on one line: "150 lb: 3 3 3 3 4" when the weight held, "150 lb 3, 155 lb 3" when it moved.
 * Null for an exercise never lifted.
 */
fun lastTimeLine(sets: List<LastSet>): String? {
    if (sets.isEmpty()) return null
    val unit = unitLabel(sets.first().unit)
    val runs = ArrayList<Pair<Double, MutableList<Double>>>()
    for (s in sets) {
        val run = runs.lastOrNull()
        if (run != null && run.first == s.weight) run.second += s.reps else runs += s.weight to mutableListOf(s.reps)
    }
    return runs.joinToString(", ") { (w, reps) -> "${formatWeight(w)} $unit: ${reps.joinToString(" ") { formatReps(it) }}" }
}

/** Minutes of wall time as "47 min", the way the Today hero names a duration. */
fun formatMinutes(ms: Long): String = "${(ms / 60_000.0).roundToInt()} min"
