package com.qala.data.stats

import com.qala.data.core.DatedValue
import com.qala.data.core.EngineStateView
import com.qala.data.core.ExerciseMuscles
import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.LiftEntryEntity
import com.qala.data.db.LiftEntryWithSets
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftSetEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.engine.EngineInput
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.WeightUnit
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StatsTest {
    private val zone = ZoneId.of("America/New_York")
    private fun at(date: String, hour: Int = 9) = java.time.LocalDate.parse(date).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    private fun set(i: Int, completed: Boolean = true, warmup: Boolean = false) =
        LiftSetEntity("s/$i", "e", i, 100.0, "lb", 5.0, null, null, completed, warmup, false, false)

    private fun session(date: String, exercise: String, vararg sets: LiftSetEntity, stub: Boolean = false) = LiftSessionWithEntries(
        LiftSessionEntity("id-$date-$exercise", at(date), -300, 1, stub, null, null, null, null, false),
        listOf(LiftEntryWithSets(LiftEntryEntity("e", "id-$date-$exercise", 0, exercise), sets.toList())),
    )

    @Test
    fun setsByMuscleCountsCompletedWorkSetsOnceForEveryTargetFromTheWeekStart() {
        val muscles = mapOf("squat" to ExerciseMuscles(listOf("quads", "glutes")), "benchPress" to ExerciseMuscles(listOf("chest")))
        val sessions = listOf(
            session("2026-11-09", "squat", set(0), set(1), set(2, warmup = true), set(3, completed = false)),    // Monday: two work sets
            session("2026-11-10", "benchPress", set(0), set(1), set(2)),
            session("2026-11-06", "squat", set(0)),                                                              // last week: not counted
            session("2026-11-11", "squat", set(0), stub = true),                                                 // a stub is not training
        )
        val counts = Stats.setsByMuscle(sessions, muscles, fromDate = "2026-11-09")
        assertEquals(listOf("chest" to 3, "glutes" to 2, "quads" to 2), counts)
    }

    @Test
    fun weeklyRunMetresAreByWeekOldestFirstWithEmptyWeeksAsZero() {
        fun run(date: String, m: Double, stub: Boolean = false) = RunSessionEntity("r-$date", at(date), -300, m, null, 0.0, stub, null, null, null, null, null, null, false)
        val weeks = Stats.weeklyRunM(listOf(run("2026-11-10", 5000.0), run("2026-11-12", 3000.0), run("2026-11-02", 4000.0), run("2026-11-11", 9999.0, stub = true)), today = "2026-11-13", weeks = 3)
        assertEquals(listOf("2026-10-26" to 0.0, "2026-11-02" to 4000.0, "2026-11-09" to 8000.0), weeks)
    }

    @Test
    fun theStrengthLineIsTheLastObservationsOfEachMainLiftInTheEnginesOrder() {
        val obs = (1..20).map { DatedValue("2026-10-%02d".format(it), 200.0 + it) }
        val snapshot = EngineSnapshot(stateView = EngineStateView(updated = "", mainLifts = listOf("squat", "benchPress", "deadlift"), e1rmObs = mapOf("squat" to obs, "deadlift" to emptyList(), "benchPress" to obs.take(3))))
        val lifts = Stats.lifts(snapshot, limit = 12)
        assertEquals(listOf("Squat", "Bench Press"), lifts.map { it.name })
        assertEquals(12, lifts[0].points.size)
        assertEquals(220.0, lifts[0].points.last().value, 0.0)
        assertEquals(3, lifts[1].points.size)
    }

    @Test
    fun weighInsComeOutInTheLiftersUnitOldestFirst() {
        val input = EngineInput(weights = listOf(BodyWeightEntity("b2", "2026-11-02", 80.0, false), BodyWeightEntity("b1", "2026-11-01", 81.0, false), BodyWeightEntity("b3", "2026-11-03", 70.0, true)))
        val lb = Stats.weights(input, WeightUnit.Lb)
        assertEquals(listOf("2026-11-01", "2026-11-02"), lb.map { it.date })
        assertEquals(81.0 * 2.2046226218, lb[0].value, 1e-9)
        assertEquals(80.0, Stats.weights(input, WeightUnit.Kg)[1].value, 0.0)
    }

    @Test
    fun readinessIsOneScoreFromZeroToHundredForEachOfTheLastSevenDays() {
        val now = ZonedDateTime.of(2026, 11, 13, 12, 0, 0, 0, zone).toInstant().toEpochMilli()
        val input = EngineInput(checkIns = listOf(CheckInEntity("c1", at("2026-11-12", 7), -300, 8.0, "{}", null, false)))
        val series = Stats.readiness(input, "2026-11-13", zone, now)
        assertEquals((7 downTo 1).map { java.time.LocalDate.parse("2026-11-13").minusDays(it - 1L).toString() }, series.map { it.date })
        assertTrue(series.all { it.value in 0.0..100.0 })
    }
}
