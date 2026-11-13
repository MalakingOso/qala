package com.qala.app.workout

import com.qala.data.core.RestObservation
import com.qala.data.db.LiftSessionWithEntries

/**
 * What the rest planner reads about the day and the history for one exercise (D32): the worst soreness on its target
 * muscles, today's recovery score, the engine's local fatigue for those muscles, and the rests taken before on this
 * exercise and on its class, oldest first (empty when "Learn from taps" is off).
 */
data class RestContext(
    val exercise: List<RestObservation> = emptyList(),
    val cls: List<RestObservation> = emptyList(),
    val soreness: Int? = null,
    val prs: Double? = null,
    val fatigueLocal: Double? = null,
)

/** A rest longer than this was not a rest, the lifter walked away; it teaches nothing. */
private const val LongestRestSec = 900

/**
 * Every rest in [history] that a later set can judge, oldest first, with the exercise it was taken on. A rest is stored on the
 * set it followed; the set after it (in the same exercise) says whether it was enough: it hit when its RPE came in within half a
 * point of the target, or when there was no RPE to judge by.
 */
fun restSamples(history: List<LiftSessionWithEntries>): List<Pair<String, RestObservation>> =
    history.filter { !it.session.stub && !it.session.deleted }.sortedBy { it.session.startedAtMs }.flatMap { s ->
        s.entries.sortedBy { it.entry.position }.flatMap { e ->
            e.sets.sortedBy { it.position }.filter { it.completed && !it.warmup }.zipWithNext().mapNotNull { (a, b) ->
                val taken = a.restTakenSec
                val base = a.restBaseSec
                val planned = a.restPlannedSec
                if (taken == null || base == null || planned == null || taken > LongestRestSec) {
                    null
                } else {
                    val rpe = b.rpe
                    val target = b.targetRpe
                    val hit = rpe == null || target == null || rpe <= target + 0.5
                    e.entry.exerciseId to RestObservation(taken.toDouble(), base.toDouble(), (a.restAdjustSec ?: 0).toDouble(), planned.toDouble(), hit)
                }
            }
        }
    }
