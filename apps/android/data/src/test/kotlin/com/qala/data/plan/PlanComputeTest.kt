package com.qala.data.plan

import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftEntryEntity
import com.qala.data.db.LiftEntryWithSets
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftSetEntity
import com.qala.data.db.ProgramEntity
import com.qala.data.engine.EngineCompute
import com.qala.data.engine.EngineInput
import com.qala.data.model.Availability
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.RunPlan
import com.qala.data.model.RunPlanDay
import com.qala.data.model.SettingsRecord
import com.qala.data.model.SkipReason
import com.qala.data.model.wire
import com.qala.data.seed.GzclpProgram
import com.qala.data.seed.SeedOneRepMax
import com.qala.data.sync.DaySkipIds
import com.qala.data.today.DayKind
import com.qala.data.today.StatusSpan
import com.qala.data.today.lift
import com.qala.data.today.run
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Plan screen's weeks against the engine's own, through the host library. The calendar: 2026-10-05 is a Monday, the
 * default training days are Mon, Wed, Fri, Sat, and the GZCLP program has four days.
 */
class PlanComputeTest {
    private val zone = ZoneId.of("America/New_York")      // EDT in October: the -240 offset the fixtures use
    private val plan = PlanCompute()
    private val program = ProgramEntity("p", GzclpProgram.NAME, GzclpProgram.TEXT, false)

    private fun ms(date: String, hour: Int = 12) = LocalDate.parse(date).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    private fun input(
        sessions: List<LiftSessionWithEntries> = emptyList(),
        skips: List<DaySkipEntity> = emptyList(),
        availability: Availability = Availability(),
        settings: SettingsRecord = SettingsRecord(),
        runPlan: RunPlan = RunPlan(listOf(RunPlanDay(1, 6437.0), RunPlanDay(3, 6437.0))),
        withProgram: Boolean = true,
    ) = EngineInput(
        liftSessions = sessions,
        skips = skips,
        availability = availability,
        settings = settings,
        runPlan = runPlan,
        exerciseData = SeedOneRepMax.ExerciseData,
        program = if (withProgram) program else null,
    )

    /** A squat session of [sets] sets of five at [weight] lb on [date], as Room would hand it out. */
    private fun squat(date: String, day: Int, sets: Int = 3, weight: Double = 150.0): LiftSessionWithEntries {
        val session = lift(date, day)
        val entry = LiftEntryEntity("${session.id}/0", session.id, 0, "squat")
        val rows = (0 until sets).map { LiftSetEntity("${entry.id}/$it", entry.id, it, weight, "lb", 5.0, null, null, completed = true, warmup = false, tested1rm = false, jointPain = false) }
        return LiftSessionWithEntries(session, listOf(LiftEntryWithSets(entry, rows)))
    }

    private fun skip(date: String, reason: SkipReason, note: String? = null) =
        DaySkipEntity(DaySkipIds.of(date), date, reason.wire(), null, note, deleted = false)

    private val prevSat = "2026-10-03"
    private val mon = "2026-10-05"
    private val wed = "2026-10-07"
    private val fri = "2026-10-09"

    // ---- the same week Today shows ----

    @Test
    fun thisWeekIsTheEngineSnapshotsWeekDayForDay() {
        val withHistory = input(
            sessions = listOf(squat(prevSat, 4), squat(mon, 1)),
            skips = listOf(skip("2026-10-08", SkipReason.Break)),
        )
        for (case in listOf(input(), withHistory)) {
            val snapshot = EngineCompute().compute(case, ms(wed), zone)
            val planned = plan.week(case, ms(wed), zone, 0)
            assertEquals(snapshot.week!!.days, planned.days.map { it.day })
            assertEquals(snapshot.week.weekStart, planned.weekStart)
            assertEquals(snapshot.date, planned.today)
        }
    }

    @Test
    fun theSnapshotCarriesTheRecordsItWasBuiltFrom() {
        val case = input()
        assertEquals(case, EngineCompute().compute(case, ms(wed), zone).input)
    }

    // ---- what a day holds ----

    @Test
    fun aLoggedDayShowsWhatWasLiftedAndALaterOneWhatTheProgramPrescribes() {
        val week = plan.week(input(sessions = listOf(squat(prevSat, 4), squat(mon, 1, sets = 3, weight = 140.0))), ms(wed), zone, 0)
        val done = week.days[0].lift!!
        assertEquals(LiftSource.LOGGED, done.source)
        assertEquals("Day 1", done.dayName)
        assertEquals("Squat", done.mainExerciseName)
        assertEquals("only the logged exercise, with the logged sets", listOf("Squat"), done.exercises.map { it.name })
        assertEquals(List(3) { 140.0 }, done.exercises.single().sets.map { it.weight })
        assertEquals(List(3) { 5.0 }, done.exercises.single().sets.map { it.reps })
        assertNotNull(done.doneAtMs)
        assertNull("no note was left", done.notes)

        val next = week.days[2].lift!!
        assertEquals(LiftSource.PLANNED, next.source)
        assertEquals(2, next.programDay)
        assertEquals(listOf("Overhead Press", "Deadlift", "Bent Over Row"), next.exercises.map { it.name })
    }

    @Test
    fun theNoteOnALoggedSessionComesThrough() {
        val noted = squat(mon, 1).let { it.copy(session = it.session.copy(notes = "  Left knee tight  ", minutes = 58.0)) }
        val lift = plan.week(input(sessions = listOf(squat(prevSat, 4), noted)), ms(wed), zone, 0).days[0].lift!!
        assertEquals("Left knee tight", lift.notes)
        assertEquals(58.0, lift.minutes!!, 0.0)
    }

    @Test
    fun aRunDayHasItsRunAndNoLift() {
        val week = plan.week(input(sessions = listOf(squat(mon, 1)), runPlan = RunPlan(listOf(RunPlanDay(1, 6437.0)))), ms(wed), zone, 0)
        val tue = week.days[1]
        assertEquals(DayKind.RUN, tue.day.kind)
        assertNull(tue.lift)
        assertEquals(6437.0, tue.run!!.plan.distanceM, 0.0)
        assertFalse(tue.run.logged)
        assertNull("a rest day with no run has neither", week.days[6].run)
    }

    @Test
    fun aRunOnASkippedDayGoesWithIt() {
        val week = plan.week(input(skips = listOf(skip("2026-10-06", SkipReason.Sick))), ms(mon), zone, 0)
        val tue = week.days[1]
        assertEquals(SkipReason.Sick, tue.day.reason)
        assertEquals("the run is still known, so the week can count what was skipped", 6437.0, tue.run!!.plan.distanceM, 0.0)
        assertTrue(tue.run.off)
        assertFalse(week.days[3].run!!.off)
        assertFalse("Tuesday is a run day, not a training weekday", tue.training)
    }

    @Test
    fun aRunLoggedOnItsDayIsMarked() {
        val withRun = input().copy(runs = listOf(run("2026-10-06")))
        assertTrue(plan.week(withRun, ms(wed), zone, 0).days[1].run!!.logged)
    }

    @Test
    fun aLiftDayKeepsItsRunWhenTheRunPlanSharesTheWeekday() {
        val both = plan.week(input(runPlan = RunPlan(listOf(RunPlanDay(0, 5000.0)))), ms(mon), zone, 0)
        assertEquals(DayKind.LIFT, both.days[0].day.kind)
        assertEquals(5000.0, both.days[0].run!!.plan.distanceM, 0.0)
    }

    @Test
    fun withNoProgramTheTrainingDaysAreThereButHoldNothing() {
        val week = plan.week(input(withProgram = false), ms(wed), zone, 0)
        assertEquals(DayKind.LIFT, week.days[0].day.kind)
        assertNull(week.days[0].lift)
        assertNull(week.programName)
        assertEquals(0, week.dayCount)
    }

    @Test
    fun theProgramNameLosesItsExtension() {
        val week = plan.week(input(), ms(wed), zone, 0)
        assertEquals("gzclp", week.programName)
        assertEquals(4, week.dayCount)
    }

    // ---- skips and the shift ----

    @Test
    fun aVacationDayCarriesItsReasonItsNoteAndWhereItsLiftWent() {
        // Monday lifts day 1; Wednesday is on vacation, so Friday takes day 2.
        val week = plan.week(input(skips = listOf(skip(wed, SkipReason.Vacation, "Cabin"))), ms(mon), zone, 0)
        val off = week.days[2]
        assertEquals(SkipReason.Vacation, off.day.reason)
        assertEquals(DayKind.REST, off.day.kind)
        assertTrue(off.training)
        assertEquals(StatusSpan.OneDay, off.status!!.span)
        assertTrue("vacation shifts the plan", off.status.shifts)
        assertEquals("Cabin", off.status.note)
        assertEquals(fri, off.movesTo)
        assertEquals(2, week.days[4].lift!!.programDay)
        assertNull("a day that trains has no status", week.days[0].status)
    }

    @Test
    fun aBreakRestsInPlaceAndMovesNothing() {
        val week = plan.week(input(skips = listOf(skip(wed, SkipReason.Break))), ms(mon), zone, 0)
        assertEquals(SkipReason.Break, week.days[2].day.reason)
        assertFalse(week.days[2].status!!.shifts)
        assertNull(week.days[2].movesTo)
        assertEquals("the slot is spent: Friday is day 3", 3, week.days[4].lift!!.programDay)
    }

    @Test
    fun aStatusThatCoversTheRestOfTheWeekMovesTheLiftPastIt() {
        // Sick from Wednesday to next Monday: Wednesday's lift moves out to next Wednesday.
        val sick = Availability(AvailabilityStatus.Sick, since = wed, until = "2026-10-12", note = "Flu")
        val week = plan.week(input(availability = sick), ms(mon), zone, 0)
        assertEquals(listOf(SkipReason.Sick, SkipReason.Sick, SkipReason.Sick, SkipReason.Sick), week.days.drop(2).take(4).map { it.day.reason })
        val wedOff = week.days[2]
        assertEquals(StatusSpan.Range(wed, "2026-10-12"), wedOff.status!!.span)
        assertEquals("2026-10-14", wedOff.movesTo)
        val next = plan.week(input(availability = sick), ms(mon), zone, 1)
        assertEquals(SkipReason.Sick, next.days[0].day.reason)
        assertEquals(2, next.days[2].lift!!.programDay)
    }

    @Test
    fun anOpenEndedStatusLeavesNothingToMoveTo() {
        val week = plan.week(input(availability = Availability(AvailabilityStatus.Sick, since = wed)), ms(mon), zone, 0)
        assertNull(week.days[2].movesTo)
    }

    @Test
    fun anInjuryKeepsTheDayAsALiftDayAroundTheMuscle() {
        val hurt = Availability(AvailabilityStatus.Injured, since = mon, muscle = "quads")
        val week = plan.week(input(availability = hurt), ms(mon), zone, 0)
        assertEquals(DayKind.LIFT, week.days[0].day.kind)
        assertNull(week.days[0].day.reason)
        assertNull(week.days[0].status)
        assertEquals(listOf("quads"), week.days[0].injured)
        assertEquals("a day with no injury behind it lists none", emptyList<String>(), plan.week(input(), ms(mon), zone, 0).days[0].injured)
    }

    // ---- the settings ----

    @Test
    fun theTrainingWeekdaySettingDecidesWhichDaysLift() {
        val default = plan.week(input(), ms(mon), zone, 0)
        assertEquals(listOf(true, false, true, false, true, true, false), default.days.map { it.day.kind == DayKind.LIFT })
        val tueThuSun = plan.week(input(settings = SettingsRecord(trainingWeekdays = listOf(1, 3, 6))), ms(mon), zone, 0)
        assertEquals(listOf(false, true, false, true, false, false, true), tueThuSun.days.map { it.day.kind == DayKind.LIFT })
        assertEquals(listOf(null, 1, null, 2, null, null, 3), tueThuSun.days.map { it.lift?.programDay })
    }

    // ---- other weeks ----

    @Test
    fun aLaterWeekIsLaidOutFromTheDaysOfThisOne() {
        val case = input(sessions = listOf(squat(prevSat, 4), squat(mon, 1)))
        val next = plan.week(case, ms(wed), zone, 1)
        assertEquals(1, next.offset)
        assertEquals("2026-10-12", next.weekStart)
        assertEquals(listOf(1, null, 2, null, 3, 4, null), next.days.map { it.day.programDay })
        assertTrue(next.days.mapNotNull { it.lift }.all { it.source == LiftSource.PLANNED })
        assertTrue(next.days.none { it.day.logged })
    }

    @Test
    fun anEarlierWeekIsWhatWasLogged() {
        val case = input(sessions = listOf(squat("2026-09-26", 4), squat("2026-09-28", 1), squat("2026-09-30", 2)))
        val last = plan.week(case, ms(wed), zone, -1)
        assertEquals("2026-09-28", last.weekStart)
        assertEquals(listOf(true, false, true, false, false, false, false), last.days.map { it.day.logged })
        assertEquals(LiftSource.LOGGED, last.days[0].lift!!.source)
        assertEquals("a training day nobody logged is still a lift day, not planned again", DayKind.LIFT, last.days[4].day.kind)
    }

    @Test
    fun theArrowsReachBackToTheFirstLiftAndAheadAFixedWindow() {
        assertEquals(PlanBounds(0, MaxWeeksAhead), plan.bounds(input(), ms(wed), zone))
        val threeWeeksBack = input(sessions = listOf(squat("2026-09-15", 1)))     // Tuesday of the week of Sep 14
        assertEquals(PlanBounds(-3, MaxWeeksAhead), plan.bounds(threeWeeksBack, ms(wed), zone))
        val longAgo = input(sessions = listOf(squat("2025-01-06", 1)))
        assertEquals(PlanBounds(-MaxWeeksBack, MaxWeeksAhead), plan.bounds(longAgo, ms(wed), zone))
    }
}
