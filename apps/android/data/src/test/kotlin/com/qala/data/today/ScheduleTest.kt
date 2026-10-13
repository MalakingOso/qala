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
    }

    @Test
    fun anInjuredDayTrainsAroundTheMuscleSoItIsNeitherShiftedNorSpent() {
        assertEquals("the rotation moves on as for any lift day", 3, afterSkip(SkipReason.Injured))
        val w = week(mon, lifts = listOf(lift(prevSat, day = 4)), rules = FakeRules(mapOf(mon to SkipReason.Injured)))
        assertEquals(listOf(1, null, 2, null, 3, 4, null), w.days.map { it.programDay })
        assertEquals(DayKind.LIFT, w.days[0].kind)
        assertNull("it is a lift day, not a skipped one", w.days[0].reason)
    }

    @Test
    fun anInjuredRunDayStillHasItsRun() {
        val s = schedule(rules = FakeRules(mapOf("2026-10-06" to SkipReason.Injured)))
        assertEquals("2026-10-06", s.nextRun("2026-10-06", runPlan, emptyList())!!.date)
        assertEquals(DayKind.RUN, week(wed, rules = FakeRules(mapOf("2026-10-06" to SkipReason.Injured))).days[1].kind)
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

    // ---- any week (the Plan screen) ----

    private val nextMon = "2026-10-12"
    private val nextWed = "2026-10-14"
    private val nextFri = "2026-10-16"

    private fun weekOn(
        weekStart: String,
        today: String,
        lifts: List<com.qala.data.db.LiftSessionEntity> = emptyList(),
        rules: DayRules = FakeRules(),
        weekdays: Set<Int> = DefaultWeekdays,
    ) = Schedule(weekdays, 4, lifts, rules).weekOn(weekStart, today, runPlan, emptyList())

    @Test
    fun thisWeekFromTheProjectionIsTheWeekTodayShows() {
        // Wednesday, Monday lifted as day 1, Tuesday's run due: the week the strip and rail already read.
        val lifts = listOf(lift(prevSat, day = 4), lift(mon, day = 1))
        val rules = FakeRules(mapOf("2026-10-08" to SkipReason.Vacation))
        assertEquals(week(wed, lifts, rules).days, weekOn(mon, wed, lifts, rules).days)
        assertEquals("any date of the week names it", week(wed, lifts, rules).days, weekOn(fri, wed, lifts, rules).days)
    }

    @Test
    fun aLaterWeekPicksTheRotationUpWhereThisWeekLeavesIt() {
        // Monday lifted as day 1, so this week plans day 2 Wed, 3 Fri, 4 Sat and next Monday is day 1 again.
        val lifts = listOf(lift(prevSat, day = 4), lift(mon, day = 1))
        val next = weekOn(nextMon, wed, lifts)
        assertEquals(listOf(1, null, 2, null, 3, 4, null), next.days.map { it.programDay })
        assertEquals(nextMon, next.weekStart)
        assertTrue("nothing is logged in a week that has not happened", next.days.none { it.logged })
        val after = weekOn("2026-10-19", wed, lifts)
        assertEquals("the rotation of four days comes round to the same place", listOf(1, null, 2, null, 3, 4, null), after.days.map { it.programDay })
    }

    @Test
    fun aMissedLiftThisWeekIsDoneAgainBeforeTheNextWeekMovesOn() {
        // Monday was missed: Wednesday repeats day 1, so next Monday is day 4.
        val lifts = listOf(lift(prevSat, day = 4))
        assertEquals(listOf(1, null, 1, null, 2, 3, null), week(wed, lifts).days.map { it.programDay })
        assertEquals(listOf(4, null, 1, null, 2, 3, null), weekOn(nextMon, wed, lifts).days.map { it.programDay })
    }

    @Test
    fun anEarlierWeekIsWhatTheRecordsSayAndAMissedDayStaysMissed() {
        // Last week (Sep 28 to Oct 4): Monday lifted day 1, Wednesday nothing logged, Friday lifted day 2 (the repeat of Wednesday's).
        val lifts = listOf(lift("2026-09-26", day = 4), lift("2026-09-28", day = 1), lift("2026-10-02", day = 2))
        val last = weekOn("2026-09-28", wed, lifts)
        assertEquals(listOf(1, null, 2, null, 2, 3, null), last.days.map { it.programDay })
        assertEquals(listOf(true, false, false, false, true, false, false), last.days.map { it.logged })
        assertEquals("a past training day with nothing logged is not planned again", DayKind.LIFT, last.days[2].kind)
    }

    @Test
    fun aVacationWednesdayMovesItsLiftToFridayAndNextMondayFollowsOnFromThere() {
        // Day 1 lifted Monday. Wednesday is on vacation: it shifts, so Friday takes day 2, Saturday 3, next Monday 4.
        val lifts = listOf(lift(prevSat, day = 4), lift(mon, day = 1))
        val rules = FakeRules(mapOf(wed to SkipReason.Vacation))
        val thisWeek = weekOn(mon, wed, lifts, rules)
        assertEquals(listOf(1, null, null, null, 2, 3, null), thisWeek.days.map { it.programDay })
        assertEquals(SkipReason.Vacation, thisWeek.days[2].reason)
        assertEquals(listOf(4, null, 1, null, 2, 3, null), weekOn(nextMon, wed, lifts, rules).days.map { it.programDay })
    }

    @Test
    fun aSchedulingWednesdayAdvancesPastItsSlotWhereAVacationOneDoesNot() {
        val lifts = listOf(lift(prevSat, day = 4), lift(mon, day = 1))
        val rules = FakeRules(mapOf(wed to SkipReason.Scheduling))
        val thisWeek = weekOn(mon, wed, lifts, rules)
        assertEquals("Wednesday's day 2 is spent, so Friday takes 3 and Saturday 4", listOf(1, null, null, null, 3, 4, null), thisWeek.days.map { it.programDay })
        assertEquals(listOf(1, null, 2, null, 3, 4, null), weekOn(nextMon, wed, lifts, rules).days.map { it.programDay })
    }

    @Test
    fun aStatusThatRunsIntoNextWeekShiftsNextWeeksLiftsOutToo() {
        // Sick from Friday through next Wednesday: both Friday and Saturday this week and Monday and Wednesday next shift out.
        val rules = FakeRules(
            mapOf(fri to SkipReason.Sick, "2026-10-10" to SkipReason.Sick, nextMon to SkipReason.Sick, nextWed to SkipReason.Sick),
        )
        val lifts = listOf(lift(prevSat, day = 4), lift(mon, day = 1), lift(wed, day = 2))
        val next = weekOn(nextMon, wed, lifts, rules)
        assertEquals(listOf(null, null, null, null, 3, 4, null), next.days.map { it.programDay })
        assertEquals(SkipReason.Sick, next.days[0].reason)
        assertEquals(SkipReason.Sick, next.days[2].reason)
        assertEquals("the first lift out of the status takes the day it was waiting on", nextFri, next.days[4].date)
    }

    @Test
    fun theTrainingWeekdaysDecideWhichDatesLift() {
        val monWedFriSat = weekOn(mon, wed)
        assertEquals(listOf(DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.LIFT, DayKind.REST), monWedFriSat.days.map { it.kind })
        val tueThuSun = weekOn(mon, mon, weekdays = setOf(1, 3, 6))
        assertEquals(listOf(DayKind.REST, DayKind.LIFT, DayKind.REST, DayKind.LIFT, DayKind.REST, DayKind.REST, DayKind.LIFT), tueThuSun.days.map { it.kind })
        assertEquals("the rotation still starts at day 1", listOf(null, 1, null, 2, null, null, 3), tueThuSun.days.map { it.programDay })
        assertEquals("a later week follows the same weekdays", listOf(null, 4, null, 1, null, null, 2), weekOn(nextMon, mon, weekdays = setOf(1, 3, 6)).days.map { it.programDay })
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
