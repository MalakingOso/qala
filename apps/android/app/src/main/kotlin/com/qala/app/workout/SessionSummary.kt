package com.qala.app.workout

import com.qala.data.core.ExerciseMuscles
import com.qala.data.model.WeightUnit

/** A lift's best estimated one-rep max from this session's sets. */
data class LiftE1rm(val name: String, val e1rm: Double)

/**
 * What Session complete shows (DESIGN 7.5): the time split, the sets each muscle got and each lift's e1RM. Built from the workout
 * at the moment it is finished, so the screen has it while the save is still running (or has failed).
 */
data class SessionSummary(
    val dayName: String,
    val unit: WeightUnit,
    val elapsedSec: Int,
    val warmupSec: Int?,
    val liftSec: Int,
    val restSec: Int,
    val sets: Int,
    val setsByMuscle: List<Pair<String, Int>>,
    val e1rms: List<LiftE1rm>,
)

/** The seconds actually rested, as the rests were kept on the sets they followed. */
fun WorkoutState.restSeconds(): Int = exercises.sumOf { ex -> ex.sets.sumOf { if (it.done) it.restTakenSec ?: 0 else 0 } }

/** Epley, the engine's fallback shape: a single is itself, and sets past twelve reps say too little about a max. */
fun e1rmOf(weight: Double, reps: Double): Double? = when {
    weight <= 0 || reps < 1 || reps > 12 -> null
    reps <= 1.0 -> weight
    else -> weight * (1 + reps / 30.0)
}

/**
 * The summary of this workout finished at [finishedAtMs], with [warmupSec] the time the warm-up took when it was measured. The
 * lifting time is what is left of the workout once the rests are taken out, so the three parts never add up to more than it.
 */
fun WorkoutState.summary(finishedAtMs: Long, warmupSec: Int?, muscles: Map<String, ExerciseMuscles?>): SessionSummary {
    val elapsed = ((finishedAtMs - startedAtMs).coerceAtLeast(0) / 1000).toInt()
    val rest = restSeconds()
    val perMuscle = HashMap<String, Int>()
    for (ex in exercises) {
        if (ex.doneCount == 0) continue
        for (m in muscles[ex.exerciseId]?.targets.orEmpty()) perMuscle.merge(m, ex.doneCount, Int::plus)
    }
    val lifts = exercises.mapNotNull { ex ->
        val best = ex.sets.filter { it.done && it.weight != null }.mapNotNull { e1rmOf(it.weight!!, it.reps) }.maxOrNull()
        best?.let { LiftE1rm(ex.name, it) }
    }
    return SessionSummary(
        dayName = dayName,
        unit = exercises.firstOrNull()?.unit ?: WeightUnit.Lb,
        elapsedSec = elapsed,
        warmupSec = warmupSec,
        liftSec = (elapsed - rest).coerceAtLeast(0),
        restSec = rest,
        sets = loggedSets,
        setsByMuscle = perMuscle.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key }).map { it.key to it.value },
        e1rms = lifts,
    )
}
