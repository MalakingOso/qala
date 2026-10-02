package com.qala.data.engine

import com.qala.data.IsoTime
import com.qala.data.core.ExerciseMuscles
import com.qala.data.db.LiftSessionWithEntries

/** How far back "last trained" looks. Past it the check-in has nothing to say about a muscle. */
const val LastTrainedDays = 14

/**
 * The local day each muscle was last trained, from real lift sessions (a "Mark done" stub has no sets, so it trained
 * nothing) in the [LastTrainedDays] up to [today]. A muscle is trained by an exercise that targets it; [byExercise] is
 * the `exercise_muscles` answer for the exercises involved. Muscles not trained in the window are absent.
 */
fun lastTrained(sessions: List<LiftSessionWithEntries>, today: String, byExercise: Map<String, ExerciseMuscles?>): Map<String, String> {
    val from = IsoTime.addDays(today, -LastTrainedDays.toLong())
    val out = HashMap<String, String>()
    for (s in sessions) {
        if (s.session.stub) continue
        val date = IsoTime.localDateKey(s.session.startedAtMs, s.session.offsetMin)
        if (date < from || date > today) continue
        for (entry in s.entries) {
            for (muscle in byExercise[entry.entry.exerciseId]?.targets.orEmpty()) {
                if ((out[muscle] ?: "") < date) out[muscle] = date
            }
        }
    }
    return out
}

/** The exercise ids of the sessions [lastTrained] will read, so the caller asks the core about those and no others. */
fun recentExerciseIds(sessions: List<LiftSessionWithEntries>, today: String): List<String> {
    val from = IsoTime.addDays(today, -LastTrainedDays.toLong())
    return sessions
        .filter { !it.session.stub && IsoTime.localDateKey(it.session.startedAtMs, it.session.offsetMin) in from..today }
        .flatMap { s -> s.entries.map { it.entry.exerciseId } }
        .distinct()
}
