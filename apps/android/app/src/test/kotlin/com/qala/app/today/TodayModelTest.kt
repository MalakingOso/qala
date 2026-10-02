package com.qala.app.today

import com.qala.data.core.ReadyDate
import com.qala.data.core.TrendDirection
import com.qala.data.core.WeightTrend
import com.qala.data.engine.EngineSnapshot
import com.qala.data.engine.LatestWeight
import com.qala.data.model.RunPlanDay
import com.qala.data.model.RunZone
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.program.TopSet
import com.qala.data.today.DayKind
import com.qala.data.today.NextRun
import com.qala.data.today.StageId
import com.qala.design.StageDotState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TodayModelTest {
    // ---- the rail ----

    @Test
    fun aLiftDayIsSixDotsAndARestDayThree() {
        assertEquals(6, railStages(liftPlan(), false).size)
        assertEquals(listOf("check-in", "recover", "wind-down"), railStages(restPlan(), false).map { it.id })
        assertEquals(listOf("check-in", "warm-up", "lift", "run", "recover", "wind-down"), railStages(liftPlan(), false).map { it.id })
    }

    @Test
    fun stateAndInterludeCarryOverFromTheDeriver() {
        val stages = railStages(liftPlan(done = mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7), skipped = emptySet()), false)
        assertEquals(
            listOf(StageDotState.Done, StageDotState.Done, StageDotState.Now, StageDotState.Later, StageDotState.Later, StageDotState.Later),
            stages.map { it.state },
        )
        assertEquals(listOf(false, false, false, false, true, true), stages.map { it.interlude })
        val skipped = railStages(liftPlan(done = mapOf(StageId.LIFT to 17), skipped = setOf(StageId.CHECK_IN, StageId.WARM_UP)), false)
        assertEquals(StageDotState.Skipped, skipped[0].state)
        assertEquals(StageDotState.Skipped, skipped[1].state)
    }

    @Test
    fun onlyADoneStageCarriesATimeAndItReadsAtTheRecordsOffset() {
        val plan = liftPlan(done = mapOf(StageId.CHECK_IN to 6, StageId.WARM_UP to 7))
        val stages = railStages(plan, use24h = false)
        assertEquals("6:00 am", stages[0].doneTime)
        assertEquals("7:00 am", stages[1].doneTime)
        assertNull(stages[2].doneTime)
        assertNull("a stage that is not done shows no time", stages[5].doneTime)
        assertEquals("06:00", railStages(plan, use24h = true)[0].doneTime)
    }

    @Test
    fun nowIsTheFirstActiveStageAndAllDonePointsAtTheEnd() {
        assertEquals(2, TodayModel(fullSnapshot(liftPlan(done = mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7))), liftPlan(done = mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7)), false).nowIndex)
        val all = liftPlan(done = mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7, StageId.LIFT to 8, StageId.RUN to 18))
        assertEquals(5, TodayModel(fullSnapshot(all), all, false).nowIndex)
    }

    @Test
    fun theViewedStageIsThePreviewedOneElseNow() {
        val stages = railStages(liftPlan(), false)
        assertEquals(0, viewingIndex(stages, 0, null))
        assertEquals(3, viewingIndex(stages, 0, "run"))
        assertEquals("a preview of a stage the day no longer has falls back to now", 0, viewingIndex(railStages(restPlan(), false), 0, "run"))
        assertNull(previewFor(stages, 0, 0))
        assertEquals("run", previewFor(stages, 0, 3))
        assertNull(previewFor(stages, 0, 9))
    }

    // ---- the head ----

    @Test
    fun theEyebrowNamesTheDayAndItsKind() {
        val lift = liftPlan()
        assertEquals("Wednesday · gzclp day 3", headEyebrow(fullSnapshot(lift), lift))
        val none = liftPlan(programDay = null)
        assertEquals("Wednesday · No program yet", headEyebrow(emptySnapshot(none), none))
        assertEquals("Tuesday · Rest day", headEyebrow(emptySnapshot(restPlan()), restPlan()))
        val sick = restPlan(date = "2026-10-07", reason = SkipReason.Sick)
        assertEquals("Wednesday · Rest day, sick", headEyebrow(emptySnapshot(sick), sick))
    }

    // ---- the hero, per stage ----

    private fun hero(snapshot: EngineSnapshot, viewing: Int, now: Int = viewing) =
        heroFor(snapshot, snapshot.today!!, viewing, now, use24h = false)

    @Test
    fun checkInAsksOnTheDayAndThanksAfter() {
        val ask = hero(fullSnapshot(), 0)
        assertEquals("Now · check-in", ask.kicker)
        assertEquals("How are you walking in?", ask.title)
        assertEquals(listOf("Check in to set today's loads."), ask.lines)
        assertEquals(Cta("Check in", Destination.CheckIn, CtaIcon.CircleCheck), ask.cta)
        assertTrue(ask.ctaEnabled)
        assertTrue(ask.now)

        val rest = restPlan()
        assertEquals("Rest day. Check in, then recover.", hero(fullSnapshot(rest, hero = null), 0).lines.single())
        val sick = restPlan(date = "2026-10-07", reason = SkipReason.Sick)
        assertEquals("Today is off (sick). Check in, then rest.", hero(fullSnapshot(sick, hero = null), 0).lines.single())

        val done = fullSnapshot(liftPlan(done = mapOf(StageId.CHECK_IN to 6)))
        val thanks = hero(done, 0, now = 1)
        assertEquals("Done · check-in", thanks.kicker)
        assertEquals("Checked in", thanks.title)
        assertEquals(listOf("Done at 6:00 am.", "Readiness 72 of 100, a little under your average."), thanks.lines)
        assertNull("nothing left to do on a done stage", thanks.cta)
        assertFalse(thanks.now)
    }

    @Test
    fun warmUpNeedsAProgram() {
        val snapshot = fullSnapshot(liftPlan(done = mapOf(StageId.CHECK_IN to 6)))
        val warm = hero(snapshot, 1)
        assertEquals("Warm-up", warm.title)
        assertEquals("Before bench press day", warm.subtitle)
        assertEquals(Cta("Start warm-up", Destination.WarmUp, CtaIcon.Flame), warm.cta)

        val bare = emptySnapshot(liftPlan(done = mapOf(StageId.CHECK_IN to 6), programDay = null))
        val none = hero(bare, 1)
        assertEquals(Cta("Open Plan", Destination.Plan), none.cta)
        assertTrue("No program yet" in none.lines.single())

        val finished = fullSnapshot(liftPlan(done = mapOf(StageId.CHECK_IN to 6, StageId.WARM_UP to 7)))
        assertEquals("Warm-up done", hero(finished, 1, now = 2).title)
        assertEquals("Done at 7:00 am.", hero(finished, 1, now = 2).lines.single())
    }

    @Test
    fun theLiftHeroShowsTheDayAndTheTopSet() {
        val snapshot = fullSnapshot(liftPlan(done = mapOf(StageId.CHECK_IN to 6, StageId.WARM_UP to 7)))
        val lift = hero(snapshot, 2)
        assertEquals("Now · lift", lift.kicker)
        assertEquals("Day 3", lift.title)
        assertEquals("Bench Press day", lift.subtitle)
        assertEquals("Your top set", lift.figure!!.label)
        assertEquals("112.5 lb × 3+", lift.figure!!.text)
        assertEquals("3 exercises · 11 sets", lift.detail)
        assertEquals(listOf("Readiness 72 of 100, a little under your average."), lift.lines)
        assertEquals(Cta("Start workout", Destination.Workout, CtaIcon.Dumbbell), lift.cta)
    }

    @Test
    fun aSetWithNoWeightShowsItsReps() {
        val snapshot = fullSnapshot(liftPlan(done = mapOf(StageId.CHECK_IN to 6, StageId.WARM_UP to 7)), hero = gzclpHero.copy(topSet = TopSet(null, WeightUnit.Lb, 12.0, false, 3)))
        assertEquals("12 reps", hero(snapshot, 2).figure!!.text)
        val kg = fullSnapshot(liftPlan(), hero = gzclpHero.copy(topSet = TopSet(60.0, WeightUnit.Kg, 5.0, false, 5)))
        assertEquals("60 kg × 5", hero(kg, 2, now = 0).figure!!.text)
    }

    @Test
    fun aPreviewIsReadOnlyButKeepsItsButton() {
        val snapshot = fullSnapshot()
        val preview = hero(snapshot, viewing = 3, now = 0)
        assertEquals("Preview · run", preview.kicker)
        assertNotNull(preview.cta)
        assertFalse(preview.ctaEnabled)
        assertFalse(preview.now)
        assertFalse(hero(snapshot, viewing = 2, now = 0).ctaEnabled)
        assertTrue(hero(snapshot, viewing = 0, now = 0).ctaEnabled)
    }

    @Test
    fun theRunHeroFollowsThePlan() {
        val planned = fullSnapshot(liftPlan(), next = NextRun("2026-10-07", easyRun))
        val today = hero(planned, 3, now = 3)
        assertEquals("Easy run", today.title)
        assertEquals("4.0 mi", today.figure!!.text)
        assertEquals(listOf("Conversational pace."), today.lines)
        assertEquals(Cta("Start run", Destination.Run, CtaIcon.SportShoe), today.cta)

        val later = hero(fullSnapshot(next = NextRun("2026-10-09", easyRun)), 3, now = 3)
        assertEquals("No run today", later.title)
        assertEquals("Your next run is Friday: easy run, 4.0 mi.", later.lines.single())

        val none = hero(fullSnapshot(next = null), 3, now = 3)
        assertEquals("No run planned", none.title)
        assertEquals("Start a run", none.cta!!.label)

        val km = hero(fullSnapshot(next = NextRun("2026-10-07", easyRun), unit = WeightUnit.Kg), 3, now = 3)
        assertEquals("6.4 km", km.figure!!.text)

        val ran = hero(fullSnapshot(liftPlan(done = mapOf(StageId.RUN to 7))), 3, now = 0)
        assertEquals("Run done", ran.title)
        assertNull(ran.cta)
    }

    @Test
    fun anInterludeHasStaticCopyAndLeadsToThePlan() {
        val lift = fullSnapshot()
        val recover = hero(lift, 4, now = 0)
        assertEquals("Recover", recover.title)
        assertEquals(HeroLayout.Interlude, recover.layout)
        assertTrue("easy run" in recover.lines.single())
        assertEquals(Destination.Plan, recover.cta!!.to)
        assertEquals("Rest day. Eat well, drink water and take a walk.", hero(fullSnapshot(restPlan(), hero = null), 1, now = 0).lines.single())

        assertEquals("Wind down", hero(lift, 5, now = 0).title)
        val finished = liftPlan(done = mapOf(StageId.CHECK_IN to 6, StageId.WARM_UP to 7, StageId.LIFT to 8, StageId.RUN to 18))
        val complete = hero(fullSnapshot(finished), 5, now = 5)
        assertEquals("Day complete", complete.title)
        assertEquals("Now · wind down", complete.kicker)
        assertTrue(complete.ctaEnabled)
    }

    @Test
    fun aSkippedStageSaysSoAndOffersNothing() {
        val snapshot = fullSnapshot(liftPlan(done = mapOf(StageId.LIFT to 17), skipped = setOf(StageId.CHECK_IN, StageId.WARM_UP)))
        val skipped = hero(snapshot, 0, now = 3)
        assertEquals("Skipped · check-in", skipped.kicker)
        assertEquals("Check-in skipped", skipped.title)
        assertNull(skipped.cta)
    }

    @Test
    fun everyStageOfEveryDayShapeHasAHero() {
        val shapes = listOf(fullSnapshot(), emptySnapshot(), emptySnapshot(restPlan()), fullSnapshot(restPlan(), hero = null))
        for (snapshot in shapes) {
            val plan = snapshot.today!!
            for (i in plan.stages.indices) {
                val h = hero(snapshot, i, now = 0)
                assertTrue(h.title.isNotBlank())
                assertTrue(h.kicker.isNotBlank())
            }
        }
    }

    // ---- readiness ----

    @Test
    fun readinessReadsAgainstTheAverage() {
        assertEquals("In line with your average", againstAverage(72, 74))
        assertEquals("A little under your average", againstAverage(72, 76))
        assertEquals("Well under your average", againstAverage(60, 76))
        assertEquals("A little above your average", againstAverage(80, 75))
        assertEquals("Well above your average", againstAverage(90, 75))
        assertEquals(72, scorePoints(0.724))
    }

    @Test
    fun readinessCardShowsTheScoreTheAverageAndTheReadyDates() {
        val r = readiness(ready = listOf(ReadyDate("quads", "2026-10-09", false)))
        val card = readinessCard(fullSnapshot(readiness = r))
        assertEquals("Readiness · 72 of 100", card.kicker)
        assertEquals("A little under your average", card.title)
        assertEquals(listOf("Your 28-day average is 76.", "Quads ready Friday, everything else is ready now."), card.lines)
        assertFalse(card.empty)
    }

    @Test
    fun withoutACheckInTodayTheScoreIsAnEstimate() {
        val card = readinessCard(fullSnapshot(readiness = readiness(checkedIn = false)))
        assertEquals("Readiness · estimate 72 of 100", card.kicker)
        assertTrue(card.lines.any { "estimate" in it })
    }

    @Test
    fun readyDatesAreSaidInPlainWords() {
        fun sentence(vararg dates: ReadyDate) = readyDatesSentence(readiness(ready = dates.toList()), "2026-10-07")
        assertEquals("Everything is ready now.", sentence())
        assertEquals("Quads ready Friday, everything else is ready now.", sentence(ReadyDate("quads", "2026-10-09", false)))
        assertEquals("Quads ready tomorrow, everything else is ready now.", sentence(ReadyDate("quads", "2026-10-08", false)))
        assertEquals(
            "Calves and glutes ready tomorrow; quads ready Sunday. Everything else is ready now.",
            sentence(ReadyDate("calves", "2026-10-08", false), ReadyDate("glutes", "2026-10-08", false), ReadyDate("quads", "2026-10-11", false)),
        )
        assertEquals(
            "Lower back still loaded after three weeks, everything else is ready now.",
            sentence(ReadyDate("lowerback", "2026-10-28", true)),
        )
    }

    // ---- next run ----

    @Test
    fun nextRunNamesTheDayTheDistanceAndTheEffort() {
        val card = nextRunCard(fullSnapshot(next = NextRun("2026-10-08", easyRun.copy(zone = RunZone.Hard, label = "Intervals", distanceM = 8046.7))))
        assertEquals("Next run · tomorrow", card.kicker)
        assertEquals("Intervals · 5.0 mi", card.title)
        assertEquals(listOf("Hard effort"), card.lines)
        assertEquals("Next run · today", nextRunCard(fullSnapshot(next = NextRun("2026-10-07", easyRun))).kicker)
        assertEquals("Next run · Oct 14", nextRunCard(fullSnapshot(next = NextRun("2026-10-14", easyRun))).kicker)
    }

    // ---- this week ----

    @Test
    fun theWeekIsSevenCellsMondayFirstWithTodayMarked() {
        val card = weekCard(fullSnapshot())
        assertEquals(listOf("M", "T", "W", "T", "F", "S", "S"), card.cells.map { it.letter })
        assertEquals(listOf(false, false, true, false, false, false, false), card.cells.map { it.today })
        assertEquals(listOf(34.0, 12.0, 34.0, 12.0, 34.0, 34.0, 0.0), card.cells.map { it.planned })
        assertEquals(listOf(34.0, 12.0, 0.0, 0.0, 0.0, 0.0, 0.0), card.cells.map { it.done })
        assertEquals("46 of 160 load done", card.title)
        assertEquals("Today: 34 planned, 0 done.", card.caption)
        assertEquals(DayKind.REST, card.cells[6].kind)
        assertFalse(card.empty)
    }

    @Test
    fun aRestDayTodaySaysSo() {
        val card = weekCard(fullSnapshot(restPlan("2026-10-11"), hero = null))
        assertEquals("Today is a rest day.", card.caption)
    }

    @Test
    fun anEmptyWeekNamesTheTrainingDaysAndPointsToSettings() {
        val card = weekCard(emptySnapshot())
        assertTrue(card.empty)
        assertEquals("Nothing planned", card.title)
        assertEquals("Your training days are Mon, Wed, Fri and Sat. Change them in Settings.", card.caption)
        assertEquals(Destination.Settings, card.action!!.to)
        assertEquals(listOf(true, false, true, false, true, true, false), card.cells.map { it.training })
    }

    // ---- body weight ----

    @Test
    fun weightShowsTheLatestTheAverageTheWeeklyMoveAndTheRun() {
        val card = weightCard(fullSnapshot())
        assertEquals("Body weight · today", card.kicker)
        assertEquals("176.6 lb", card.title)
        assertEquals(
            listOf("7-day average 177.3 lb.", "1.1 lb lower than the week before.", "The 7-day average is down 4 days running."),
            card.lines,
        )
        assertEquals("kilograms stay kilograms", "80.1 kg", weightCard(fullSnapshot(unit = WeightUnit.Kg)).title)
    }

    @Test
    fun theWeeklyMoveAndTheDirectionAreNeverReconciled() {
        // Lower than last week, yet today's step of the average is up: both are shown as they are.
        val trend = WeightTrend(80.1, 80.4, 80.9, -0.5, TrendDirection.Up, 1)
        val lines = weightCard(fullSnapshot(trend = trend)).lines
        assertTrue("lower than the week before" in lines[1])
        assertEquals("The 7-day average is up today.", lines[2])
        // Higher than last week, with the average falling.
        val other = weightCard(fullSnapshot(trend = WeightTrend(80.1, 80.4, 79.9, 0.5, TrendDirection.Down, 3))).lines
        assertTrue("higher than the week before" in other[1])
        assertEquals("The 7-day average is down 3 days running.", other[2])
    }

    @Test
    fun directionAndWeeklyMoveEdgeCases() {
        assertEquals("The 7-day average is flat today.", directionLine(TrendDirection.Flat, 0))
        assertEquals("The 7-day average is up 2 days running.", directionLine(TrendDirection.Up, 2))
        assertEquals("The 7-day average is down today.", directionLine(TrendDirection.Down, 1))
        assertEquals("Same as the week before.", weeklyDelta(WeightUnit.Lb, 0.01))
        assertEquals("2.2 lb higher than the week before.", weeklyDelta(WeightUnit.Lb, 1.0))
        assertEquals("1.0 kg lower than the week before.", weeklyDelta(WeightUnit.Kg, -1.0))
        val noPrevious = weightCard(fullSnapshot(trend = WeightTrend(80.1, 80.4, null, null, TrendDirection.Flat, 0)))
        assertEquals(listOf("7-day average 177.3 lb.", "The 7-day average is flat today."), noPrevious.lines)
    }

    @Test
    fun oneWeighInHasNoTrendYet() {
        val card = weightCard(fullSnapshot(trend = null, latest = LatestWeight("2026-10-05", 80.0)))
        assertEquals("Body weight · Monday", card.kicker)
        assertEquals("176.4 lb", card.title)
        assertEquals(listOf("The 7-day trend shows after three weigh-ins in a week."), card.lines)
    }

    // ---- empty states ----

    @Test
    fun aFreshInstallHasAPlainEmptyStateOnEveryCard() {
        val snapshot = emptySnapshot()
        val model = TodayModel(snapshot, snapshot.today!!, false)
        for (card in listOf(model.nextRun, model.readiness, model.weight)) {
            assertTrue(card.empty)
            assertTrue(card.title.isNotBlank())
            assertTrue(card.lines.isNotEmpty())
        }
        assertEquals("No run planned", model.nextRun.title)
        assertEquals("No score yet", model.readiness.title)
        assertEquals("No weigh-ins yet", model.weight.title)
        assertEquals(Destination.Plan, model.nextRun.action!!.to)
        assertEquals(Destination.Body, model.weight.action!!.to)
        assertTrue(model.week.empty)
        assertEquals(6, model.stages.size)
        assertEquals("The day still opens with a check-in", 0, model.nowIndex)
        assertEquals("How are you walking in?", model.hero(0).title)
    }

    @Test
    fun readinessWithNoCheckInsIsEmptyEvenThoughTheEngineGivesAScore() {
        // The engine answers 1.0 with no history; that is not a score to show.
        assertTrue(readinessCard(emptySnapshot()).empty)
        assertNull(readinessLine(emptySnapshot().readiness, checkedIn = false))
        assertNull(readinessLine(null, checkedIn = true))
    }

    @Test
    fun theScreenWaitsFailsOrShowsTheDay() {
        assertTrue(todayLoad(EngineSnapshot(), false) is TodayLoad.Loading)
        val failed = todayLoad(EngineSnapshot(loaded = true, error = "boom"), false)
        assertEquals("boom", (failed as TodayLoad.Failed).message)
        assertTrue("a build with no day is a failure, not an empty Today", todayLoad(EngineSnapshot(loaded = true), false) is TodayLoad.Failed)
        assertTrue(todayLoad(fullSnapshot(), false) is TodayLoad.Ready)
        assertTrue(todayLoad(emptySnapshot(), false) is TodayLoad.Ready)
    }
}
