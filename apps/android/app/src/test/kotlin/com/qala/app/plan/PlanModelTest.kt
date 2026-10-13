package com.qala.app.plan

import com.qala.app.today.CtaIcon
import com.qala.app.today.TodayModel
import com.qala.app.today.fullSnapshot
import com.qala.app.today.liftPlan
import com.qala.data.today.StageId
import com.qala.app.today.Destination
import com.qala.data.IsoTime
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.plan.PlanBounds
import com.qala.data.plan.PlanRun
import com.qala.data.today.DayKind
import com.qala.data.today.DayStatus
import com.qala.data.today.StatusSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanModelTest {
    // ---- the week and its arrows ----

    @Test
    fun theWeekIsNamedByHowFarItIsFromThisOne() {
        assertEquals("This week", weekLabel(0))
        assertEquals("Next week", weekLabel(1))
        assertEquals("Last week", weekLabel(-1))
        assertEquals("In 3 weeks", weekLabel(3))
        assertEquals("2 weeks ago", weekLabel(-2))
    }

    @Test
    fun theSwitcherNamesTheWeekAndItsDates() {
        val bar = model().week
        assertEquals("This week", bar.label)
        assertEquals("Oct 5 to Oct 11", bar.range)
        assertTrue(bar.onThisWeek)
        val across = model(week(days = (0..6).map { planDay(IsoTime.addDays("2026-10-26", it.toLong())) }, offset = 3), PlanNav(offset = 3))
        assertEquals("Oct 26 to Nov 1", across.week.range)
        assertEquals("In 3 weeks", across.week.label)
        assertFalse(across.week.onThisWeek)
    }

    @Test
    fun theArrowsMoveOneWeekAndStopAtTheEnds() {
        val nav = PlanNav(offset = 0, day = 2)
        assertEquals(1, nav.next(Bounds).offset)
        assertEquals(-1, nav.previous(Bounds).offset)
        assertEquals(-3, PlanNav(offset = -3).previous(Bounds).offset)
        assertEquals(8, PlanNav(offset = 8).next(Bounds).offset)
        val first = model(nav = PlanNav(offset = -3))
        assertFalse("no week before the first one", first.week.canPrevious)
        assertTrue(first.week.canNext)
        val last = model(nav = PlanNav(offset = 8))
        assertTrue(last.week.canPrevious)
        assertFalse("no week after the last one", last.week.canNext)
        assertFalse("a user with no history has no earlier week", model(bounds = PlanBounds(0, 8)).week.canPrevious)
    }

    @Test
    fun changingWeekKeepsTheWeekdayAndBackToThisWeekGoesToToday() {
        var nav = PlanNav(offset = 0, day = 4)
        nav = nav.next(Bounds).next(Bounds)
        assertEquals(2, nav.offset)
        assertEquals("Friday stays selected", 4, nav.day)
        assertEquals(PlanNav(offset = 0, day = 2), nav.thisWeek(todayWeekday = 2))
        assertEquals("the view stays too", PlanView.EverySet, PlanNav(day = 1, view = PlanView.EverySet).next(Bounds).view)
    }

    @Test
    fun aSavedWeekOutsideTheReachComesBackInside() {
        assertEquals(-3, PlanNav(offset = -9).within(Bounds).offset)
        assertEquals(8, PlanNav(offset = 20).within(Bounds).offset)
        assertEquals(2, PlanNav(offset = 2).within(Bounds).offset)
    }

    // ---- the day tabs ----

    @Test
    fun thereIsATabForEachDayWithItsDateAndGlyph() {
        val tabs = model().tabs
        assertEquals(listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), tabs.map { it.name })
        assertEquals(listOf("5", "6", "7", "8", "9", "10", "11"), tabs.map { it.date })
        assertEquals(
            listOf(TabGlyph.Check, TabGlyph.Check, TabGlyph.Lift, TabGlyph.Run, TabGlyph.Lift, TabGlyph.Lift, TabGlyph.Rest),
            tabs.map { it.glyph },
        )
    }

    @Test
    fun aTabIsDoneTodayLaterOrAtRest() {
        val tabs = model().tabs
        assertEquals(
            listOf(TabState.Done, TabState.Done, TabState.Today, TabState.Later, TabState.Later, TabState.Later, TabState.Rest),
            tabs.map { it.state },
        )
        assertEquals(listOf(false, false, true, false, false, false, false), tabs.map { it.today })
    }

    @Test
    fun theSelectedTabIsTheOneTheNavSaysAndClampsToTheWeek() {
        assertEquals(listOf(false, false, true, false, false, false, false), model(nav = PlanNav(day = 2)).tabs.map { it.selected })
        assertEquals(6, model(nav = PlanNav(day = 6)).selectedDay)
        assertEquals("a day past the week lands on the last", 6, model(nav = PlanNav(day = 9)).selectedDay)
    }

    @Test
    fun aTabSaysWhatItIsToAScreenReader() {
        val tabs = model().tabs
        assertEquals("Monday 5, Day 1, done", tabs[0].description)
        assertEquals("Tuesday 6, run day, done", tabs[1].description)
        assertEquals("Wednesday 7, Day 2, today", tabs[2].description)
        assertEquals("Friday 9, Day 3", tabs[4].description)
        assertEquals("Sunday 11, rest day", tabs[6].description)
    }

    @Test
    fun aPastDayWithNothingLoggedIsNotLoggedNotSkipped() {
        val days = defaultDays().toMutableList().also { it[0] = planDay(date(0), DayKind.LIFT, 1, planned(1)) }
        val tab = model(week(days = days)).tabs[0]
        assertEquals(TabState.NotLogged, tab.state)
        assertEquals(TabGlyph.Lift, tab.glyph)
        assertEquals("Monday 5, Day 1, not logged", tab.description)
        assertEquals("Monday, Oct 5 · not logged", model(week(days = days), PlanNav(day = 0)).card.eyebrow)
    }

    @Test
    fun aSkippedDayTabCarriesItsReason() {
        val days = defaultDays().toMutableList().also {
            it[2] = planDay(date(2), reason = SkipReason.Sick, status = DayStatus(SkipReason.Sick, StatusSpan.OneDay, shifts = true), training = true)
        }
        val tab = model(week(days = days)).tabs[2]
        assertEquals(TabState.Skipped, tab.state)
        assertEquals(SkipReason.Sick, tab.reason)
        assertEquals("Wednesday 7, skipped, sick, today", tab.description)
    }

    // ---- a rest day ----

    @Test
    fun aRestDayHasNoButtonNoViewsAndSaysSo() {
        val card = model(nav = PlanNav(day = 6)).card
        assertEquals("Sunday, Oct 11 · rest day", card.eyebrow)
        assertEquals("Rest day", card.title)
        assertNull(card.cta)
        assertTrue(card.views.isEmpty())
        assertTrue(card.exercises.isEmpty())
        assertFalse(card.hero)
        assertEquals(listOf("Nothing is planned. Eat well, drink water and take a walk."), card.lines)
    }

    @Test
    fun aRestDayThatIsTodayStillOffersNothingToStart() {
        val days = defaultDays().toMutableList().also { it[2] = planDay(date(2)) }
        val card = model(week(days = days), PlanNav(day = 2)).card
        assertEquals("Wednesday, Oct 7 · today · rest day", card.eyebrow)
        assertNull(card.cta)
        assertTrue(card.hero)
    }

    // ---- a lift day ----

    @Test
    fun aLiftDayShowsItsOwnExercisesAndHowMuchIsInIt() {
        val card = model(nav = PlanNav(day = 4)).card
        assertEquals("Friday, Oct 9", card.eyebrow)
        assertEquals("Day 3", card.title)
        assertEquals("Squat day", card.subtitle)
        assertEquals("3 exercises · 11 sets", card.detail)
        assertEquals(listOf("Squat", "Bench Press", "Lat Pulldown"), card.exercises.map { it.name })
        assertEquals("4 × 3, 1 × 3+ @ 150 lb", card.exercises[0].scheme)
        assertEquals("3 × 5 @ 110 lb", card.exercises[1].scheme)
        assertEquals(List(5) { "150 lb × 3" }.dropLast(1) + "150 lb × 3+", card.exercises[0].sets)
        assertEquals(PlanView.Overview, card.view)
    }

    @Test
    fun theViewsAreTheOverviewEverySetAndTheWarmUpsWhenThereAreAny() {
        assertEquals(listOf(PlanView.Overview, PlanView.EverySet, PlanView.WarmUp), model(nav = PlanNav(day = 4)).card.views)
        val noWarmups = defaultDays().toMutableList().also {
            it[4] = planDay(date(4), DayKind.LIFT, 3, planned(3, listOf(exercise("Bench Press", sets(3)))))
        }
        assertEquals(listOf(PlanView.Overview, PlanView.EverySet), model(week(days = noWarmups), PlanNav(day = 4)).card.views)
        assertEquals("a view the day lacks falls back to the overview", PlanView.Overview, model(week(days = noWarmups), PlanNav(day = 4, view = PlanView.WarmUp)).card.view)
        assertEquals(PlanView.EverySet, model(nav = PlanNav(day = 4, view = PlanView.EverySet)).card.view)
    }

    @Test
    fun theWarmUpViewListsTheWarmUpSets() {
        val card = model(nav = PlanNav(day = 4, view = PlanView.WarmUp)).card
        assertEquals(PlanView.WarmUp, card.view)
        assertEquals(listOf("45 lb × 5", "45 lb × 5", "45 lb × 5"), card.exercises[0].warmups)
    }

    @Test
    fun aLaterDaysLoadsAreMarkedAsTheyStandNow() {
        assertNotNull(model(nav = PlanNav(day = 4)).card.footnote)
        assertNull("today's own loads are today's", model(nav = PlanNav(day = 2)).card.footnote)
    }

    @Test
    fun aDoneDayShowsWhatWasLiftedAndWhen() {
        val card = model(nav = PlanNav(day = 0)).card
        assertEquals("Monday, Oct 5 · done", card.eyebrow)
        assertEquals("Day 1", card.title)
        assertEquals("Done at 7:12 am · 1 exercise · 3 sets · 62 min", card.detail)
        assertEquals("3 × 5 @ 140 lb", card.exercises.single().scheme)
        assertNull("what was done has no later loads to caveat", card.footnote)
        assertNull("done work has nothing to start", card.cta)
        assertEquals("See what you did", card.secondary!!.label)
        assertEquals(Destination.History, card.secondary!!.to)
        assertFalse("the quiet button, never the ember one", card.secondary!!.primary)
        assertTrue(model(nav = PlanNav(day = 0), use24h = true).card.detail!!.startsWith("Done at 07:12 · "))
    }

    @Test
    fun theNoteLeftOnASessionShowsOnItsDay() {
        val noted = planDay(date(0), DayKind.LIFT, 1, loggedLift(1, date(0), listOf(exercise("Squat", sets(3))), notes = "Left knee tight"), logged = true)
        val days = defaultDays().toMutableList().also { it[0] = noted }
        assertEquals("Left knee tight", model(week(days = days), PlanNav(day = 0)).card.note)
        assertNull(model(nav = PlanNav(day = 0)).card.note)
    }

    @Test
    fun aMarkedDoneStubSaysNoSetsWereLogged() {
        val stub = planDay(date(0), DayKind.LIFT, 1, loggedLift(1, date(0), emptyList(), minutes = null, stub = true), logged = true)
        val card = model(week(days = defaultDays().toMutableList().also { it[0] = stub }), PlanNav(day = 0)).card
        assertEquals("Done at 7:12 am · no sets logged", card.detail)
        assertTrue(card.exercises.isEmpty())
        assertTrue(card.views.isEmpty())
        assertTrue("a stub is not an empty program day", card.lines.isEmpty())
    }

    @Test
    fun anInjuryKeepsTheLiftAndSaysWhatIsAdjusted() {
        val days = defaultDays().toMutableList().also { it[2] = planDay(date(2), DayKind.LIFT, 2, planned(2), injured = listOf("quads")) }
        val card = model(week(days = days), PlanNav(day = 2)).card
        assertEquals(listOf("Adjusted around your quads. Direct work for it is off."), card.lines)
        assertEquals("Start workout", card.cta!!.label)
    }

    // ---- the one Start button ----

    @Test
    fun startWorkoutIsOnTodayOnAnUnloggedLiftDayAndGoesToTheWorkout() {
        val cta = model(nav = PlanNav(day = 2)).card.cta!!
        assertEquals("Start workout", cta.label)
        assertEquals(Destination.Workout, cta.to)
        assertEquals(CtaIcon.Dumbbell, cta.icon)
        assertTrue(model(nav = PlanNav(day = 2)).card.hero)
    }

    // ---- the stage order: Plan's button on today is Today's ----

    @Test
    fun withCheckInStillAheadPlanOffersCheckInNotTheLift() {
        val card = model(next = checkInNext).card
        assertEquals("Check in", card.cta!!.label)
        assertEquals(Destination.CheckIn, card.cta!!.to)
        assertEquals(CtaIcon.CircleCheck, card.cta!!.icon)
        assertTrue(card.cta!!.primary)
        assertEquals("Check-in comes before the lift.", card.ctaNote)
        assertNull(card.secondary)
    }

    @Test
    fun withTheWarmUpAheadPlanOffersTheWarmUp() {
        val card = model(next = warmUpNext).card
        assertEquals("Start warm-up", card.cta!!.label)
        assertEquals(Destination.WarmUp, card.cta!!.to)
        assertEquals("Warm-up comes before the lift.", card.ctaNote)
    }

    @Test
    fun startWorkoutHasNoNoteWhenTheLiftIsNext() {
        assertNull(model(next = liftNext).card.ctaNote)
    }

    @Test
    fun beforeTodayHasLoadedThereIsNoButton() {
        assertNull(model(next = null).card.cta)
    }

    @Test
    fun otherDaysNeverTakeTodaysButton() {
        for (next in listOf(checkInNext, warmUpNext, liftNext, runNext)) {
            for (d in listOf(0, 1, 3, 4, 5, 6)) assertNull("$d with ${next.stage}", model(nav = PlanNav(day = d), next = next).card.cta)
        }
    }

    @Test
    fun todaysNextIsReadFromTodayItself() {
        fun nextOf(done: Map<StageId, Int>, skipped: Set<StageId> = emptySet()): TodayNext? {
            val plan = liftPlan(done = done, skipped = skipped)
            return todayNext(TodayModel(fullSnapshot(plan), plan, false))
        }
        assertEquals(listOf(StageId.CHECK_IN, "Check in"), nextOf(emptyMap()).let { listOf(it!!.stage, it.cta.label) })
        assertEquals(listOf(StageId.WARM_UP, "Start warm-up"), nextOf(mapOf(StageId.CHECK_IN to 7)).let { listOf(it!!.stage, it.cta.label) })
        val lift = nextOf(mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7))!!
        assertEquals(listOf(StageId.LIFT, "Start workout", Destination.Workout), listOf(lift.stage, lift.cta.label, lift.cta.to))
        assertEquals("a skipped check-in and warm-up put the lift next too", StageId.LIFT, nextOf(emptyMap(), setOf(StageId.CHECK_IN, StageId.WARM_UP))!!.stage)
        val run = nextOf(mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7, StageId.LIFT to 8))!!
        assertEquals(StageId.RUN, run.stage)
        val all = liftPlan(done = mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7, StageId.LIFT to 8, StageId.RUN to 18))
        assertNull("a finished day has no next stage", todayNext(TodayModel(fullSnapshot(all), all, false)))
    }

    @Test
    fun noOtherDayOffersAStartAndNoOtherWeekEither() {
        for (d in listOf(0, 1, 3, 4, 5, 6)) assertNull("day $d", model(nav = PlanNav(day = d)).card.cta)
        // Next week's Wednesday is a lift day too, but it is not today: the date decides, not the weekday.
        val ahead = week(offset = 1, days = (0..6).map { planDay(IsoTime.addDays("2026-10-12", it.toLong()), DayKind.LIFT, 1, planned(1)) })
        assertNull(model(ahead, PlanNav(offset = 1, day = 2)).card.cta)
    }

    @Test
    fun aTodayThatIsOnlyARunStartsTheRun() {
        val days = defaultDays().toMutableList().also {
            it[2] = planDay(date(2), DayKind.RUN, run = PlanRun(easyRun.copy(dayOfWeek = 2), logged = false))
        }
        val card = model(week(days = days), PlanNav(day = 2)).card
        assertEquals("Easy run", card.title)
        assertEquals("4.0 mi · conversational pace", card.subtitle)
        assertEquals("Start run", card.cta!!.label)
        assertEquals(Destination.Run, card.cta.to)
    }

    @Test
    fun aRunDayThatIsDoneHasNothingToStartAndLeadsToHistory() {
        val days = defaultDays().toMutableList().also {
            it[2] = planDay(date(2), DayKind.RUN, run = PlanRun(easyRun.copy(dayOfWeek = 2), logged = true), logged = true)
        }
        val card = model(week(days = days), PlanNav(day = 2)).card
        assertNull(card.cta)
        assertEquals(Destination.History, card.secondary!!.to)
    }

    @Test
    fun aDayNotYetDoneHasNoHistoryLink() {
        assertNull(model(nav = PlanNav(day = 2)).card.secondary)
        assertNull(model(nav = PlanNav(day = 4)).card.secondary)
        assertNull(model(nav = PlanNav(day = 6)).card.secondary)
    }

    @Test
    fun aLiftDayWithARunStartsTheLiftFirstThenTheRun() {
        val run = PlanRun(easyRun.copy(dayOfWeek = 2), logged = false)
        val before = defaultDays().toMutableList().also { it[2] = planDay(date(2), DayKind.LIFT, 2, planned(2), run = run) }
        val card = model(week(days = before), PlanNav(day = 2)).card
        assertEquals("Start workout", card.cta!!.label)
        assertEquals("Easy run", card.run!!.title)
        assertEquals("4.0 mi · conversational pace", card.run.line)
        // With the lift logged, the run is what is left.
        val lifted = defaultDays().toMutableList().also {
            it[2] = planDay(date(2), DayKind.LIFT, 2, loggedLift(2, date(2), listOf(exercise("Squat", sets(3)))), run = run, logged = true)
        }
        // With the lift logged Today is on the run, so the run is Plan's button; and it never repeats a button Today does not offer.
        val after = model(week(days = lifted), PlanNav(day = 2), next = runNext).card
        assertEquals("Start run", after.cta!!.label)
        assertEquals("See what you did", after.secondary!!.label)
        assertNull(model(week(days = lifted), PlanNav(day = 2), next = null).card.cta)
    }

    @Test
    fun withKilogramsTheRunIsInKilometres() {
        val days = defaultDays().toMutableList().also {
            it[2] = planDay(date(2), DayKind.RUN, run = PlanRun(easyRun.copy(dayOfWeek = 2), logged = false))
        }
        assertEquals("6.4 km · conversational pace", model(week(days = days, unit = WeightUnit.Kg), PlanNav(day = 2)).card.subtitle)
    }

    // ---- a skipped day ----

    private fun skippedWeek(status: DayStatus, movesTo: String?, day: Int = 2): com.qala.data.plan.PlanWeekData {
        val days = defaultDays().toMutableList()
        days[day] = planDay(date(day), reason = status.reason, status = status, movesTo = movesTo, training = true)
        return week(days = days)
    }

    @Test
    fun aSkippedDayShowsItsReasonAndNoStartEvenOnToday() {
        val card = model(skippedWeek(vacationStatus("Cabin"), movesTo = date(4)), PlanNav(day = 2)).card
        assertEquals("Wednesday, Oct 7 · skipped, vacation · shifts the plan", card.eyebrow)
        assertEquals("On vacation", card.title)
        assertEquals(SkipReason.Vacation, card.reason)
        assertEquals("Today only", card.subtitle)
        assertEquals("Cabin", card.note)
        assertNull(card.cta)
        assertTrue(card.exercises.isEmpty())
    }

    @Test
    fun aShiftedDayNamesWhereItsLiftWent() {
        val card = model(skippedWeek(vacationStatus(), movesTo = date(4)), PlanNav(day = 2)).card
        assertEquals(listOf("Away from training. The plan shifts out.", "The lift moves to Friday."), card.lines)
        // A day already past says it in the past tense.
        val past = model(skippedWeek(vacationStatus(), movesTo = date(4), day = 0).let { w -> week(days = w.days, today = date(5)) }, PlanNav(day = 0)).card
        assertEquals("The lift moved to yesterday.", past.lines.last())
    }

    @Test
    fun aStatusWithNoEndSaysTheLiftWaits() {
        val open = vacationStatus(span = StatusSpan.Range(since = date(2), until = null))
        val card = model(skippedWeek(open, movesTo = null), PlanNav(day = 2)).card
        assertEquals("Until you say so", card.subtitle)
        assertEquals("The lift moves out until the status ends.", card.lines.last())
    }

    @Test
    fun aStatusThatRunsToADateSaysHowLong() {
        val sick = DayStatus(SkipReason.Sick, StatusSpan.Range(since = date(0), until = date(5)), shifts = true)
        val card = model(skippedWeek(sick, movesTo = date(7)), PlanNav(day = 2)).card
        assertEquals("Sick", card.title)
        assertEquals("Since Monday, until Saturday", card.subtitle)
        assertEquals("Resting to get well. The plan shifts out.", card.lines.first())
    }

    @Test
    fun aDayThatIsNotTodayIsAOneDaySkip() {
        val card = model(skippedWeek(vacationStatus(), movesTo = date(4), day = 3), PlanNav(day = 3)).card
        assertEquals("This day only", card.subtitle)
        assertFalse(card.hero)
    }

    @Test
    fun aBreakRestsInPlaceAndSaysTheLiftIsNotMoved() {
        val card = model(skippedWeek(breakStatus(), movesTo = null), PlanNav(day = 2)).card
        assertEquals("Wednesday, Oct 7 · skipped, break", card.eyebrow)
        assertEquals("On a break", card.title)
        assertEquals(listOf("Taking a few days off to recover. The plan holds."), card.lines)
    }

    @Test
    fun aSkippedRestDayHasNothingToMove() {
        val days = defaultDays().toMutableList().also {
            it[6] = planDay(date(6), reason = SkipReason.Vacation, status = vacationStatus(), training = false)
        }
        val card = model(week(days = days), PlanNav(day = 6)).card
        assertEquals(listOf("Away from training. The plan shifts out."), card.lines)
    }

    // ---- the week summary ----

    @Test
    fun theSummaryCountsWhatTheWeekHoldsAndHowItWent() {
        val s = model().summary
        assertEquals("This week", s.title)
        assertEquals("4 lifts · 2 runs", s.holds)
        assertEquals("2 done", s.went)
    }

    @Test
    fun aVacationSplitsTheWeekIntoSkippedAndShiftedAndLeavesNothingAgainstTheUser() {
        val days = defaultDays().toMutableList()
        days[2] = planDay(date(2), reason = SkipReason.Vacation, status = vacationStatus(), movesTo = date(4), training = true)
        days[3] = planDay(date(3), reason = SkipReason.Vacation, status = vacationStatus(), run = PlanRun(easyRun.copy(dayOfWeek = 3), logged = false, off = true), training = false)
        days[5] = planDay(date(5), reason = SkipReason.Break, status = breakStatus(), training = true)
        val s = model(week(days = days)).summary
        assertEquals("2 done · 1 skipped · 2 shifted", s.went)
        assertEquals("a skipped day holds no lift, and the run that went with it is not counted", "2 lifts · 1 run", s.holds)
    }

    @Test
    fun aVacationOverARestDayIsNotACountedShift() {
        val days = defaultDays().toMutableList()
        days[6] = planDay(date(6), reason = SkipReason.Vacation, status = vacationStatus(), training = false)
        assertEquals("2 done", model(week(days = days)).summary.went)
    }

    @Test
    fun aWeekWithNothingLoggedSaysSo() {
        val ahead = week(offset = 1, days = (0..6).map { planDay("2026-10-${12 + it}", if (it % 2 == 0) DayKind.LIFT else DayKind.REST, 1, if (it % 2 == 0) planned(1) else null) })
        val s = model(ahead, PlanNav(offset = 1)).summary
        assertEquals("Next week", s.title)
        assertEquals("Nothing logged yet", s.went)
        assertEquals("4 lifts · 0 runs", s.holds)
    }

    // ---- block context and the empty states ----

    @Test
    fun theHeadNamesTheProgramAndItsRotation() {
        assertEquals("gzclp · 4-day rotation", model().eyebrow)
        assertEquals("No program yet", model(week(programName = null, dayCount = 0)).eyebrow)
    }

    @Test
    fun withNoProgramALiftDayIsThereButHasNothingToList() {
        val days = defaultDays().toMutableList().also { it[2] = planDay(date(2), DayKind.LIFT, 1) }
        val card = model(week(programName = null, dayCount = 0, days = days), PlanNav(day = 2)).card
        assertEquals("Lift day", card.title)
        assertEquals(listOf("No program yet. Once one is added, each lift day lists its exercises here."), card.lines)
        assertNull("nothing to start with no program", card.cta)
        assertTrue(card.views.isEmpty())
    }

    @Test
    fun aProgramDayWithNothingPrescribedSaysThatInstead() {
        val days = defaultDays().toMutableList().also { it[2] = planDay(date(2), DayKind.LIFT, 1) }
        assertEquals(listOf("The program has nothing prescribed for this day."), model(week(days = days), PlanNav(day = 2)).card.lines)
    }

    // ---- the training weekdays ----

    @Test
    fun theTabsFollowWhichWeekdaysTrain() {
        val tueThuSun = (0..6).map { i ->
            if (i in listOf(1, 3, 6)) planDay(date(i), DayKind.LIFT, i / 2 + 1, planned(i / 2 + 1)) else planDay(date(i))
        }
        val tabs = model(week(days = tueThuSun), PlanNav(day = 1)).tabs
        assertEquals(
            listOf(TabGlyph.Rest, TabGlyph.Lift, TabGlyph.Rest, TabGlyph.Lift, TabGlyph.Rest, TabGlyph.Rest, TabGlyph.Lift),
            tabs.map { it.glyph },
        )
    }

    // ---- sets ----

    @Test
    fun consecutiveIdenticalSetsRunTogether() {
        assertEquals("3 × 5 @ 100 lb", setScheme(sets(3, 5.0, 100.0)))
        assertEquals("4 × 3, 1 × 3+ @ 150 lb", setScheme(sets(5, 3.0, 150.0, last = ps(150.0, 3.0, amrap = true))))
        assertEquals("No sets", setScheme(emptyList()))
    }

    @Test
    fun setsAtDifferentWeightsEachCarryTheirOwn() {
        val ramp = listOf(ps(100.0, 5.0), ps(120.0, 5.0), ps(120.0, 5.0))
        assertEquals("1 × 5 @ 100 lb, 2 × 5 @ 120 lb", setScheme(ramp))
    }

    @Test
    fun workWithNoLoadReadsInReps() {
        assertEquals("3 × 8", setScheme(sets(3, 8.0, null)))
        assertEquals("12 reps", setScheme(sets(1, 12.0, null)))
        assertEquals("12 reps", setText(ps(null, 12.0)))
    }

    @Test
    fun aRepRangeShowsItsBottomAndTop() {
        val set = ps(60.0, 12.0, WeightUnit.Kg, minReps = 8.0)
        assertEquals("60 kg × 8-12", setText(set))
        assertEquals("3 × 8-12 @ 60 kg", setScheme(List(3) { set }))
        assertEquals("57.5 kg × 5", setText(ps(57.5, 5.0, WeightUnit.Kg)))
    }

    @Test
    fun aWeekWithNoTrainingDaysIsAllRestAndCountsNothing() {
        val noLifts = (0..6).map { planDay(date(it)) }
        assertTrue(model(week(days = noLifts)).tabs.all { it.glyph == TabGlyph.Rest })
        assertEquals("0 lifts · 0 runs", model(week(days = noLifts)).summary.holds)
    }
}
