package com.qala.data.today

import com.qala.data.db.LiftStage
import com.qala.data.model.Availability
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.DaySkip
import com.qala.data.model.SkipReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StageDeriverTest {
    private val mon = "2026-10-05"
    private val tue = "2026-10-06"
    private val wed = "2026-10-07"
    private val sat = "2026-10-10"
    private val sun = "2026-10-11"

    private fun derive(
        today: String,
        records: DayRecords = DayRecords(),
        rules: DayRules = FakeRules(),
        dayCount: Int = 4,
        weekdays: Set<Int> = DefaultWeekdays,
    ) = StageDeriver.derive(TodayInput(today, weekdays, dayCount, records, rules))

    private fun TodayPlan.states() = stages.associate { it.id to it.state }

    // ---- shape ----

    @Test
    fun aRestDayHasThreeStagesAndNeverSix() {
        val plan = derive(tue)
        assertFalse(plan.liftDay)
        assertNull(plan.programDay)
        assertEquals(listOf(StageId.CHECK_IN, StageId.RECOVER, StageId.WIND_DOWN), plan.stages.map { it.id })
        assertEquals(StageId.CHECK_IN, plan.now)
        assertEquals(StageState.NOW, plan.stages[0].state)
        assertTrue(plan.stages.drop(1).all { it.state == StageState.LATER && it.passive })
        assertNull("rest because nothing is planned, not because of a skip", plan.skipReason)
    }

    @Test
    fun aLiftDayHasSixStagesInOrder() {
        val plan = derive(mon)
        assertTrue(plan.liftDay)
        assertEquals(
            listOf(StageId.CHECK_IN, StageId.WARM_UP, StageId.LIFT, StageId.RUN, StageId.RECOVER, StageId.WIND_DOWN),
            plan.stages.map { it.id },
        )
        assertEquals(StageId.CHECK_IN, plan.now)
        assertEquals(1, plan.programDay)
    }

    @Test
    fun theTrainingWeekdaysSettingDecidesWhichDaysLift() {
        assertFalse(derive(mon, weekdays = setOf(1, 3)).liftDay)
        assertTrue(derive(tue, weekdays = setOf(1, 3)).liftDay)
        assertFalse(derive(sat, weekdays = emptySet()).liftDay)
    }

    // ---- doneness ----

    @Test
    fun nowAdvancesAsStagesAreDoneAndSkipsThePassiveOnes() {
        var records = DayRecords(checkIns = listOf(checkIn(mon)))
        assertEquals(StageId.WARM_UP, derive(mon, records).now)

        records = DayRecords(checkIns = listOf(checkIn(mon)), liftSessions = listOf(warmup(mon)))
        assertEquals(StageId.LIFT, derive(mon, records).now)

        records = DayRecords(checkIns = listOf(checkIn(mon)), liftSessions = listOf(warmup(mon), liftStub(mon)))
        val plan = derive(mon, records)
        assertEquals(StageId.RUN, plan.now)
        assertEquals(StageState.DONE, plan.states().getValue(StageId.LIFT))

        records = DayRecords(
            checkIns = listOf(checkIn(mon)),
            liftSessions = listOf(warmup(mon), liftStub(mon)),
            runs = listOf(run(mon, stub = true)),
        )
        val finished = derive(mon, records)
        assertNull("the passive stages are never now", finished.now)
        assertEquals(
            listOf(StageState.DONE, StageState.DONE, StageState.DONE, StageState.DONE, StageState.LATER, StageState.LATER),
            finished.stages.map { it.state },
        )
    }

    @Test
    fun doneStagesCarryTheTimeOfTheirRecord() {
        val records = DayRecords(
            checkIns = listOf(checkIn(mon, hour = 8)),
            liftSessions = listOf(warmup(mon, hour = 16), liftStub(mon, hour = 17)),
        )
        val stages = derive(mon, records).stages.associateBy { it.id }
        assertEquals(at(mon, 8), stages.getValue(StageId.CHECK_IN).doneAtMs)
        assertEquals(at(mon, 16), stages.getValue(StageId.WARM_UP).doneAtMs)
        assertEquals(at(mon, 17), stages.getValue(StageId.LIFT).doneAtMs)
        assertEquals(OFFSET, stages.getValue(StageId.LIFT).doneOffsetMin)
        assertNull("later stages show no time", stages.getValue(StageId.RUN).doneAtMs)
        assertNull(stages.getValue(StageId.RECOVER).doneAtMs)
    }

    @Test
    fun aStubCountsLikeARealRecord() {
        val real = DayRecords(liftSessions = listOf(lift(mon, day = 1)))
        val stub = DayRecords(liftSessions = listOf(liftStub(mon, day = 1)))
        for (records in listOf(real, stub)) {
            val states = derive(mon, records).states()
            assertEquals(StageState.DONE, states.getValue(StageId.LIFT))
        }
        assertEquals(
            "a real session includes its warm-up; a lone lift stub does not",
            StageState.DONE to StageState.SKIPPED,
            derive(mon, real).states().getValue(StageId.WARM_UP) to derive(mon, stub).states().getValue(StageId.WARM_UP),
        )
    }

    @Test
    fun aStageLeftUndoneBeforeALaterOneIsSkipped() {
        val records = DayRecords(liftSessions = listOf(liftStub(mon)))
        val plan = derive(mon, records)
        assertEquals(StageState.SKIPPED, plan.states().getValue(StageId.CHECK_IN))
        assertEquals(StageState.SKIPPED, plan.states().getValue(StageId.WARM_UP))
        assertEquals(StageState.DONE, plan.states().getValue(StageId.LIFT))
        assertEquals(StageId.RUN, plan.now)
        assertEquals("the run is next", StageState.NOW, plan.states().getValue(StageId.RUN))
    }

    @Test
    fun aMorningRunBeforeTheLiftSkipsNothing() {
        // The run sits after the lift in the rail but is often done first; it must not mark the lift skipped.
        val plan = derive(mon, DayRecords(runs = listOf(run(mon))))
        assertEquals(
            listOf(StageState.NOW, StageState.LATER, StageState.LATER, StageState.DONE),
            plan.stages.take(4).map { it.state },
        )
        assertEquals(StageId.CHECK_IN, plan.now)
    }

    @Test
    fun yesterdaysRecordsDoNotCountToday() {
        val records = DayRecords(checkIns = listOf(checkIn(sun)), liftSessions = listOf(warmup(sun)), runs = listOf(run(sun)))
        val plan = derive(mon, records)
        assertEquals(StageId.CHECK_IN, plan.now)
        assertTrue(plan.stages.none { it.state == StageState.DONE })
    }

    @Test
    fun theLocalDayFollowsTheOffsetTheRecordWasWrittenAt() {
        // 23:30 local on Monday is already Tuesday in UTC; it is still Monday's check-in.
        val late = checkIn(mon, hour = 23)
        assertEquals(StageState.DONE, derive(mon, DayRecords(checkIns = listOf(late))).states().getValue(StageId.CHECK_IN))
        assertEquals(StageState.NOW, derive(tue, DayRecords(checkIns = listOf(late))).states().getValue(StageId.CHECK_IN))
    }

    @Test
    fun aRestDayCheckInIsDoneAndLeavesNothingNow() {
        val plan = derive(tue, DayRecords(checkIns = listOf(checkIn(tue))))
        assertEquals(StageState.DONE, plan.stages[0].state)
        assertNull(plan.now)
        assertEquals(3, plan.stages.size)
    }

    // ---- skips ----

    @Test
    fun aSkippedTrainingDayIsARestDayWithItsReason() {
        val plan = derive(mon, rules = FakeRules(mapOf(mon to SkipReason.Sick)))
        assertFalse(plan.liftDay)
        assertEquals(SkipReason.Sick, plan.skipReason)
        assertNull(plan.programDay)
        assertEquals(3, plan.stages.size)
    }

    @Test
    fun aSkipOnARestWeekdayIsNotReportedAsASkippedLiftDay() {
        val plan = derive(tue, rules = FakeRules(mapOf(tue to SkipReason.Sick)))
        assertFalse(plan.liftDay)
        assertNull(plan.skipReason)
    }

    @Test
    fun aLoggedLiftWinsOverASkipThatCoversItsDay() {
        val plan = derive(
            mon,
            DayRecords(liftSessions = listOf(liftStub(mon, day = 2))),
            FakeRules(mapOf(mon to SkipReason.Sick)),
        )
        assertTrue(plan.liftDay)
        assertEquals(2, plan.programDay)
        assertNull(plan.skipReason)
    }

    // ---- the day in the rotation ----

    @Test
    fun theFirstLiftIsDayOneAndTheRotationWraps() {
        assertEquals(1, derive(mon).programDay)
        assertEquals(2, derive(wed, DayRecords(liftSessions = listOf(liftStub(mon, day = 1)))).programDay)
        assertEquals("after the last day comes the first", 1, derive(sat, DayRecords(liftSessions = listOf(lift("2026-10-09", day = 4)))).programDay)
    }

    @Test
    fun aLiftLoggedTodayNamesItsOwnDayNotTheNextOne() {
        val plan = derive(wed, DayRecords(liftSessions = listOf(lift(wed, day = 3))))
        assertEquals(3, plan.programDay)
    }

    @Test
    fun aWarmUpStubAloneDoesNotAdvanceTheRotation() {
        val records = DayRecords(liftSessions = listOf(liftStub("2026-10-03", day = 2), warmup("2026-10-04", day = 3)))
        assertEquals(3, derive(mon, records).programDay)
    }

    @Test
    fun aMissedLiftIsDoneAgainNotSkippedOver() {
        // Day 2 was logged on Saturday; Monday passed with nothing logged and no skip, so Wednesday is still day 3
        // for the pointer after Saturday, and Monday's slot did not eat it.
        val records = DayRecords(liftSessions = listOf(lift("2026-10-03", day = 2)))
        assertEquals(3, derive(wed, records).programDay)
    }

    @Test
    fun withoutAProgramATrainingWeekdayTakesTheRestDayShape() {
        // Warm-up and lift have nothing to do, so a "now" would park on a stage that cannot be completed.
        val plan = derive(mon, dayCount = 0)
        assertFalse(plan.liftDay)
        assertNull(plan.programDay)
        assertEquals(listOf(StageId.CHECK_IN, StageId.RECOVER, StageId.WIND_DOWN), plan.stages.map { it.id })
        assertEquals(StageId.CHECK_IN, plan.now)
        assertTrue("the hero can say why", plan.noProgram)
        assertNull("it is not a skip", plan.skipReason)
        assertFalse("an ordinary rest day is not a missing program", derive(tue, dayCount = 0).noProgram)
        assertFalse(derive(mon).noProgram)
    }

    @Test
    fun aLiftAlreadyLoggedMakesItALiftDayEvenWithNoProgram() {
        val plan = derive(mon, DayRecords(liftSessions = listOf(liftStub(mon, day = null))), dayCount = 0)
        assertTrue(plan.liftDay)
        assertFalse(plan.noProgram)
    }

    @Test
    fun anInjuryDoesNotSkipTheDay() {
        val plan = derive(mon, rules = FakeRules(mapOf(mon to SkipReason.Injured)))
        assertTrue("an injured training day is still a lift day", plan.liftDay)
        assertNull(plan.skipReason)
        assertEquals(6, plan.stages.size)
    }

    @Test
    fun theRustRulesAgreeWithTheFakeOnASickStatus() {
        val availability = Availability(AvailabilityStatus.Sick, since = "2026-10-05", until = "2026-10-06")
        val rules = RustDayRules(availability, listOf(DaySkip("2026-10-09", SkipReason.Scheduling)))
        assertEquals(SkipReason.Sick, derive(mon, rules = rules).skipReason)
        assertTrue(derive(wed, rules = rules).liftDay)
        assertEquals(SkipReason.Scheduling, derive("2026-10-09", rules = rules).skipReason)
    }

    @Test
    fun aRealSessionStageIsNull() {
        assertNull(lift(mon).stage)
        assertEquals(LiftStage.LIFT, liftStub(mon).stage)
    }
}
