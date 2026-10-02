package com.qala.data.engine

import com.qala.data.core.ExerciseMuscles
import com.qala.data.db.LiftEntryEntity
import com.qala.data.db.LiftEntryWithSets
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.today.at
import org.junit.Assert.assertEquals
import org.junit.Test

class LastTrainedTest {
    private val today = "2026-10-09"
    private val byExercise = mapOf(
        "squat" to ExerciseMuscles(listOf("quads", "glutes")),
        "benchPress" to ExerciseMuscles(listOf("chest")),
        "mystery" to null,
    )

    private fun session(date: String, vararg exercises: String, stub: Boolean = false) = LiftSessionWithEntries(
        LiftSessionEntity("s-$date", at(date), -240, 1, stub, null, null, null, null, false),
        exercises.mapIndexed { i, e -> LiftEntryWithSets(LiftEntryEntity("s-$date/$i", "s-$date", i, e), emptyList()) },
    )

    @Test
    fun eachMuscleKeepsItsNewestDay() {
        val sessions = listOf(session("2026-10-05", "squat", "benchPress"), session("2026-10-07", "squat"))
        assertEquals(mapOf("quads" to "2026-10-07", "glutes" to "2026-10-07", "chest" to "2026-10-05"), lastTrained(sessions, today, byExercise))
    }

    @Test
    fun aStubTrainedNothingAndAnUnknownExerciseNamesNoMuscle() {
        val sessions = listOf(session("2026-10-07", "squat", stub = true), session("2026-10-08", "mystery"))
        assertEquals(emptyMap<String, String>(), lastTrained(sessions, today, byExercise))
        assertEquals(emptyList<String>(), recentExerciseIds(listOf(session("2026-10-07", "squat", stub = true)), today))
    }

    @Test
    fun onlyTheLastTwoWeeksCount() {
        val old = session("2026-09-20", "benchPress")                 // 19 days back
        val edge = session("2026-09-25", "squat")                     // 14 days back
        assertEquals(mapOf("quads" to "2026-09-25", "glutes" to "2026-09-25"), lastTrained(listOf(old, edge), today, byExercise))
        assertEquals(listOf("squat"), recentExerciseIds(listOf(old, edge), today))
    }

    @Test
    fun aSessionAfterTodayIsIgnored() {
        assertEquals(emptyMap<String, String>(), lastTrained(listOf(session("2026-10-10", "squat")), today, byExercise))
    }
}
