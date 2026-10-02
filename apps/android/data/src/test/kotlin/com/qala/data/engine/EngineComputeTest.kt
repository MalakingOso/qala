package com.qala.data.engine

import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.ProgramEntity
import com.qala.data.model.Availability
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.RunPlan
import com.qala.data.model.RunPlanDay
import com.qala.data.model.RunZone
import com.qala.data.model.SettingsRecord
import com.qala.data.model.WeightUnit
import com.qala.data.seed.GzclpProgram
import com.qala.data.seed.SeedOneRepMax
import com.qala.data.today.DayKind
import com.qala.data.today.StageId
import com.qala.data.today.checkIn
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The snapshot for inputs the seed does not cover: an empty app, a status, a program with no history, the zone. */
class EngineComputeTest {
    private val zone = ZoneId.of("America/New_York")
    private val compute = EngineCompute()

    private fun ms(date: String, hour: Int, minute: Int = 0) =
        LocalDate.parse(date).atTime(hour, minute).atZone(zone).toInstant().toEpochMilli()

    @Test
    fun anEmptyAppHasAnEmptyButCompleteSnapshot() {
        val snapshot = compute.compute(EngineInput(), ms("2026-10-05", 12), zone) // a Monday
        assertTrue(snapshot.loaded)
        assertNull(snapshot.error)
        assertEquals("2026-10-05", snapshot.date)
        assertEquals(0.0, snapshot.stateView!!.fatigueSystemic, 0.0)
        assertTrue(snapshot.stateView.fitness.isEmpty())
        assertNull("no check-ins, no average", snapshot.readiness!!.average28d)
        assertEquals(1.0, snapshot.readiness.today.score, 1e-9)
        assertNull(snapshot.weightTrend)
        assertEquals(List(7) { 0.0 }, snapshot.weekLoad!!.planned)
        assertEquals(List(7) { 0.0 }, snapshot.weekLoad.done)
        assertNull(snapshot.nextRun)
        assertNull("no program, no hero", snapshot.liftHero)
        assertNull(snapshot.latestWeight)
        val plan = snapshot.today!!
        assertTrue("Monday is a training day even with no program", plan.liftDay)
        assertNull("but there is no program day to lift", plan.programDay)
        assertEquals(6, plan.stages.size)
    }

    @Test
    fun aProgramWithNoHistoryStartsAtDayOneAndPlansTheWeek() {
        val input = EngineInput(
            program = ProgramEntity("p", GzclpProgram.NAME, GzclpProgram.TEXT, false),
            exerciseData = SeedOneRepMax.ExerciseData,
            runPlan = RunPlan(listOf(RunPlanDay(1, 6437.0, RunZone.Steady))),
        )
        val snapshot = compute.compute(input, ms("2026-10-05", 12), zone)
        assertEquals(1, snapshot.today!!.programDay)
        val hero = snapshot.liftHero!!
        assertEquals("Day 1", hero.dayName)
        assertEquals("Squat", hero.exerciseName)
        assertEquals(WeightUnit.Lb, snapshot.unit)
        assertEquals(listOf(1, null, 2, null, 3, 4, null), snapshot.week!!.days.map { it.programDay })
        val planned = snapshot.weekLoad!!.planned
        assertTrue(planned[0] > 0 && planned[2] > 0 && planned[4] > 0 && planned[5] > 0)
        assertTrue("a planned run on Tuesday", planned[1] > 0)
        assertEquals(0.0, planned[6], 0.0)
        assertEquals(List(7) { 0.0 }, snapshot.weekLoad.done)
        assertEquals("2026-10-06", snapshot.nextRun!!.date)
    }

    @Test
    fun theLatestWeighInIsKeptWhileTheTrendWaitsForMoreOfThem() {
        val input = EngineInput(
            weights = listOf(BodyWeightEntity("w1", "2026-10-02", 81.0, false), BodyWeightEntity("w2", "2026-10-03", 80.5, false)),
            settings = SettingsRecord(unit = WeightUnit.Kg),
        )
        val snapshot = compute.compute(input, ms("2026-10-05", 12), zone)
        assertNull("two weigh-in days are not enough for a trend", snapshot.weightTrend)
        assertEquals(LatestWeight("2026-10-03", 80.5), snapshot.latestWeight)
        assertEquals(WeightUnit.Kg, snapshot.unit)
    }

    @Test
    fun noHeroOnARestDay() {
        val input = EngineInput(
            program = ProgramEntity("p", GzclpProgram.NAME, GzclpProgram.TEXT, false),
            exerciseData = SeedOneRepMax.ExerciseData,
        )
        assertNull(compute.compute(input, ms("2026-10-06", 12), zone).liftHero) // a Tuesday
    }

    @Test
    fun aStatusThatCoversTodayMakesItARestDay() {
        val input = EngineInput(availability = Availability(AvailabilityStatus.Sick, since = "2026-10-05"))
        val snapshot = compute.compute(input, ms("2026-10-05", 12), zone)
        assertFalse(snapshot.today!!.liftDay)
        assertEquals(com.qala.data.model.SkipReason.Sick, snapshot.today.skipReason)
        assertEquals(DayKind.REST, snapshot.week!!.days[0].kind)
        assertEquals(listOf(StageId.CHECK_IN, StageId.RECOVER, StageId.WIND_DOWN), snapshot.today.stages.map { it.id })
    }

    @Test
    fun todayIsTheLocalDayNotTheUtcOne() {
        // 22:30 on Monday in New York is 02:30 UTC on Tuesday.
        val late = compute.compute(EngineInput(), ms("2026-10-05", 22, 30), zone)
        assertEquals("2026-10-05", late.date)
        assertTrue(late.today!!.liftDay)
        val utc = compute.compute(EngineInput(), ms("2026-10-05", 22, 30), ZoneId.of("UTC"))
        assertEquals("2026-10-06", utc.date)
    }

    @Test
    fun aCheckInTodayIsSeenByTheReadinessAndTheStages() {
        val input = EngineInput(checkIns = listOf(checkIn("2026-10-05", hour = 8)))
        val snapshot = compute.compute(input, ms("2026-10-05", 12), zone)
        assertTrue(snapshot.readiness!!.checkedInToday)
        assertEquals(StageId.WARM_UP, snapshot.today!!.now)
        assertNotNull(snapshot.readiness.average28d)
    }
}
