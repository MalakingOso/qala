package com.qala.data.today

import com.qala.data.model.RunPlan
import com.qala.data.model.RunPlanDay
import com.qala.data.model.RunZone
import com.qala.data.model.SkipReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which program day each date gets, and how skips move it. 2026-10-05 is a Monday; the program has four days. */
class ScheduleTest {
    private val mon = "2026-10-05"
    private val wed = "2026-10-07"
    private val fri = "2026-10-09"
    private val prevSat = "2026-10-03"

    private fun schedule(lifts: List<com.qala.data.db.LiftSessionEntity> = emptyList(), rules: DayRules = FakeRules(), dayCount: Int = 4) =
        Schedule(DefaultWeekdays, dayCount, lifts, rules)

    @Test
    fun theDayAfterTheLastLoggedLiftIsNext() {
        val s = schedule(listOf(lift(prevSat, day = 2)))
        assertEquals(3, s.pointerAt(mon))
        assertEquals(3, s.pointerAt(wed))
        assertEquals(1, schedule().pointerAt(mon))
        assertEquals("the rotation wraps", 1, schedule(listOf(lift(prevSat, day = 4))).pointerAt(mon))
        assertEquals("a single-day program repeats", 1, schedule(listOf(lift(prevSat, day = 1)), dayCount = 1).pointerAt(mon))
    }

    @Test
    fun theLatestLiftBeforeTheDateDecidesNotTheLastOneWritten() {
        val s = schedule(listOf(lift("2026-10-01", day = 1, id = "a"), lift(prevSat, day = 3, id = "b"), lift(wed, day = 4, id = "c")))
        assertEquals(4, s.pointerAt(mon)) // after day 3
        assertEquals(4, s.pointerAt(wed)) // the lift on Wednesday itself is not before Wednesday
        assertEquals(1, s.pointerAt(fri)) // after day 4
    }

    // ---- sequence after a skip ----

    private fun afterSkip(reason: SkipReason?) =
        schedule(
            listOf(lift(prevSat, day = 2)),
            FakeRules(if (reason == null) emptyMap() else mapOf(mon to reason)),
        ).pointerAt(wed)

    @Test
    fun aShiftingSkipLeavesTheNextProgramDayAlone() {
        assertEquals(3, afterSkip(null))
        assertEquals("sick pushes the lift out", 3, afterSkip(SkipReason.Sick))
        assertEquals("vacation pushes the lift out", 3, afterSkip(SkipReason.Vacation))
    }

    @Test
    fun aNonShiftingSkipSpendsItsSlot() {
        assertEquals("break rests in place", 4, afterSkip(SkipReason.Break))
        assertEquals("a scheduling conflict rests in place", 4, afterSkip(SkipReason.Scheduling))
        assertEquals("an injured day rests in place", 4, afterSkip(SkipReason.Injured))
    }

    @Test
    fun onlySkipsOnTrainingWeekdaysSpendASlot() {
        val s = schedule(listOf(lift(prevSat, day = 2)), FakeRules(mapOf("2026-10-04" to SkipReason.Break, "2026-10-06" to SkipReason.Break)))
        assertEquals("Sunday and Tuesday are not training days", 3, s.pointerAt(wed))
    }

    @Test
    fun severalSpentSlotsAddUp() {
        val rules = FakeRules(mapOf(mon to SkipReason.Break, wed to SkipReason.Scheduling))
        assertEquals(1, schedule(listOf(lift(prevSat, day = 2)), rules).pointerAt(fri)) // 3 +2 slots = 5 -> 1
    }

    @Test
    fun aLiftLoggedBeforeASkipResetsTheCount() {
        val rules = FakeRules(mapOf(mon to SkipReason.Break))
        val s = schedule(listOf(lift(prevSat, day = 2), lift(wed, day = 3)), rules)
        assertEquals("slots before the last lift no longer count", 4, s.pointerAt(fri))
    }

    // ---- the planned week ----

    private val runPlan = RunPlan(listOf(RunPlanDay(1, 6437.0), RunPlanDay(3, 6437.0)))

    private fun week(
        today: String,
        lifts: List<com.qala.data.db.LiftSessionEntity> = emptyList(),
        rules: DayRules = FakeRules(),
        runs: List<com.qala.data.db.RunSessionEntity> = emptyList(),
    ) = schedule(lifts, rules).week(today, runPlan, runs)

    @Test
    fun aWeekLaysTheRotationOverTheTrainingDaysAndTheRunsOverTheRest() {
        val w = week(wed, lifts = listOf(lift(prevSat, day = 4), lift(mon, day = 1)))
        assertEquals(
            listOf(DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.LIFT, DayKind.REST),
            w.days.map { it.kind },
        )
        assertEquals(listOf(1, null, 2, null, 3, 4, null), w.days.map { it.programDay })
        assertEquals(listOf("2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"), w.days.map { it.date })
        assertEquals(listOf(true, false, false, false, false, false, false), w.days.map { it.logged })
        assertEquals(6437.0, w.days[1].run!!.distanceM, 0.0)
        assertEquals(wed, w.on(wed)!!.date)
    }

    @Test
    fun aMissedPastLiftIsPlannedAgainOnTheNextTrainingDay() {
        // Monday was missed (nothing logged, no skip): Wednesday does Monday's day again.
        val w = week(wed, lifts = listOf(lift(prevSat, day = 4)))
        assertEquals(listOf(1, null, 1, null, 2, 3, null), w.days.map { it.programDay })
    }

    @Test
    fun aShiftingSkipPushesTheWeekOut() {
        val w = week(wed, lifts = listOf(lift(prevSat, day = 4)), rules = FakeRules(mapOf(mon to SkipReason.Sick)))
        assertEquals(listOf(null, null, 1, null, 2, 3, null), w.days.map { it.programDay })
        assertEquals(DayKind.REST, w.days[0].kind)
        assertEquals(SkipReason.Sick, w.days[0].reason)
    }

    @Test
    fun aNonShiftingSkipLeavesAHoleInTheRotation() {
        val w = week(wed, lifts = listOf(lift(prevSat, day = 4)), rules = FakeRules(mapOf(mon to SkipReason.Break)))
        assertEquals(listOf(null, null, 2, null, 3, 4, null), w.days.map { it.programDay })
    }

    @Test
    fun aSkippedRunDayHasNoRun() {
        val w = week(wed, rules = FakeRules(mapOf("2026-10-06" to SkipReason.Sick)))
        assertEquals(DayKind.REST, w.days[1].kind)
        assertNull(w.days[1].run)
        assertEquals(DayKind.RUN, w.days[3].kind)
    }

    @Test
    fun aLoggedRunMarksItsDay() {
        val w = week(wed, runs = listOf(run("2026-10-06")))
        assertTrue(w.days[1].logged)
        assertFalse(w.days[3].logged)
    }

    @Test
    fun aLiftOnTheRunDayKeepsTheLift() {
        val both = Schedule(setOf(0, 1), 4, emptyList(), FakeRules()).week(mon, RunPlan(listOf(RunPlanDay(1, 5000.0))), emptyList())
        assertEquals(DayKind.LIFT, both.days[1].kind)
        assertNull("the planned-week input takes one kind per day", both.days[1].run)
    }

    // ---- next run ----

    @Test
    fun theNextRunIsTodaysUntilItIsLoggedThenTheNextPlannedDay() {
        val s = schedule()
        assertEquals("2026-10-06", s.nextRun("2026-10-06", runPlan, emptyList())!!.date)
        assertEquals("2026-10-08", s.nextRun("2026-10-06", runPlan, listOf(run("2026-10-06")))!!.date)
        assertEquals("2026-10-08", s.nextRun("2026-10-07", runPlan, emptyList())!!.date)
        assertEquals("wraps into next week", "2026-10-13", s.nextRun("2026-10-09", runPlan, emptyList())!!.date)
        assertNull(s.nextRun(mon, RunPlan(), emptyList()))
    }

    @Test
    fun aSkippedRunDayIsPassedOver() {
        val s = schedule(rules = FakeRules(mapOf("2026-10-06" to SkipReason.Sick)))
        assertEquals("2026-10-08", s.nextRun("2026-10-06", runPlan, emptyList())!!.date)
        assertEquals(RunZone.Easy, s.nextRun("2026-10-06", runPlan, emptyList())!!.plan.zone)
    }
}
