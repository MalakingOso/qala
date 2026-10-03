package com.qala.app.today

import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.SkipReason
import com.qala.data.today.DayKind
import com.qala.data.today.DayPlan
import com.qala.data.today.DayStatus
import com.qala.data.today.StageId
import com.qala.data.today.StatusSpan
import com.qala.data.today.WeekPlan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The status card, the "Feeling better?" rule, the Skip today action and the week card's skipped day. 2026-10-07 is a Wednesday. */
class StatusModelTest {
    private val today = "2026-10-07"

    private fun status(reason: SkipReason, span: StatusSpan = StatusSpan.OneDay, muscle: String? = null, note: String? = null) =
        DayStatus(reason, span, muscle, note, shifts = reason == SkipReason.Sick || reason == SkipReason.Vacation)

    // ---- the card's copy ----

    @Test
    fun noStatusIsNoCard() {
        assertNull(statusCard(null, today))
    }

    @Test
    fun eachReasonHasItsHeadAndASentenceThatSaysWhatHappens() {
        val cards = mapOf(
            SkipReason.Sick to ("Sick" to "Resting to get well. The plan shifts out."),
            SkipReason.Vacation to ("On vacation" to "Away from training. The plan shifts out."),
            SkipReason.Break to ("On a break" to "Taking a few days off to recover. The plan holds."),
            SkipReason.Scheduling to ("Scheduling" to "Could not fit it in today. The plan holds."),
            SkipReason.Injured to ("Injured: quads" to "Direct quads work is off. Related lifts run at half volume."),
        )
        for ((reason, expected) in cards) {
            val card = statusCard(status(reason, muscle = if (reason == SkipReason.Injured) "quads" else null), today)!!
            assertEquals(reason.name, expected, card.head to card.line)
        }
    }

    @Test
    fun anInjuryNamesTheMuscleInWordsNotIds() {
        val card = statusCard(status(SkipReason.Injured, muscle = "frontdelts"), today)!!
        assertEquals("Injured: front delts", card.head)
        assertTrue(card.line.startsWith("Direct front delts work is off"))
        assertEquals("Injured", statusCard(status(SkipReason.Injured), today)!!.head)
    }

    @Test
    fun theNoteComesThrough() {
        assertEquals("flu", statusCard(status(SkipReason.Sick, note = "flu"), today)!!.note)
        assertNull(statusCard(status(SkipReason.Sick), today)!!.note)
    }

    @Test
    fun theSpanLineSaysWhenItBeganAndEnds() {
        val card = statusCard(status(SkipReason.Vacation, StatusSpan.Range("2026-10-05", "2026-10-11")), today)!!
        assertEquals("Since Monday, until Sunday", card.whenLine)
        assertEquals("On vacation", card.head)
    }

    @Test
    fun undoNamesWhatItUndoes() {
        assertEquals("Undo today's skip, sick", statusCard(status(SkipReason.Sick), today)!!.undoDescription)
        assertEquals("Undo vacation status", statusCard(status(SkipReason.Vacation, StatusSpan.Range(today, null)), today)!!.undoDescription)
        assertTrue(statusCard(status(SkipReason.Sick), today)!!.oneDay)
        assertFalse(statusCard(status(SkipReason.Sick, StatusSpan.Range(today, null)), today)!!.oneDay)
    }

    @Test
    fun noCardCopyScoldsOrCounts() {
        for (reason in SkipReason.entries) {
            val card = statusCard(status(reason, muscle = if (reason == SkipReason.Injured) "quads" else null), today)!!
            val text = listOf(card.head, card.whenLine, card.line, card.undoDescription).joinToString(" ")
            assertFalse(text, text.contains("miss", ignoreCase = true) || text.contains("!") || text.contains("—"))
        }
    }

    // ---- "Feeling better?" ----

    @Test
    fun itAsksFromTheSecondSickDayOfASpan() {
        val dayOne = statusCard(status(SkipReason.Sick, StatusSpan.Range(today, null)), today)!!
        assertNull("day one never asks: the user just said they were sick", dayOne.ask)
        assertFalse(feelingBetterDue(dayOne, answeredThisSession = false))

        val dayTwo = statusCard(status(SkipReason.Sick, StatusSpan.Range("2026-10-06", null)), today)!!
        assertEquals("2026-10-06", dayTwo.ask!!.sickSince)
        assertTrue(feelingBetterDue(dayTwo, answeredThisSession = false))
        assertEquals("You marked yourself sick on Oct 6. Back to training?", dayTwo.ask!!.text)
    }

    @Test
    fun itAsksOncePerSession() {
        val card = statusCard(status(SkipReason.Sick, StatusSpan.Range("2026-10-01", "2026-10-09")), today)!!
        assertTrue(feelingBetterDue(card, answeredThisSession = false))
        assertFalse("answered, it does not come back in the same session", feelingBetterDue(card, answeredThisSession = true))
    }

    @Test
    fun itNeverAsksForAnythingButASickSpan() {
        assertNull(statusCard(status(SkipReason.Sick), today)!!.ask)                                         // a one-day skip
        assertNull(statusCard(status(SkipReason.Vacation, StatusSpan.Range("2026-10-01", null)), today)!!.ask)
        assertNull(statusCard(status(SkipReason.Injured, StatusSpan.Range("2026-10-01", null), "quads"), today)!!.ask)
        assertFalse(feelingBetterDue(null, answeredThisSession = false))
    }

    // ---- Skip today on the hero ----

    @Test
    fun aLiveStageOnAnUnskippedLiftDayOffersSkipToday() {
        val hero = TodayModel(fullSnapshot(), liftPlan(), false).hero(0)
        assertEquals("Skip today", hero.skip!!.label)
        assertEquals(Destination.Skip, hero.skip!!.to)
    }

    @Test
    fun noSkipOnAPreviewOnARestDayOnceCheckedInPastTheLiftOrWithAStatusOnTheDay() {
        val model = TodayModel(fullSnapshot(), liftPlan(), false)
        assertNull("a preview is read-only", model.hero(2).skip)
        assertNull("recover has nothing to skip", model.hero(4).skip)
        val rest = restPlan()
        assertNull("a rest day has nothing to skip", TodayModel(fullSnapshot(rest, hero = null), rest, false).hero(0).skip)
        val sick = fullSnapshot().copy(status = status(SkipReason.Injured, muscle = "quads"))
        assertNull("the card has Change", TodayModel(sick, liftPlan(), false).hero(0).skip)
        val done = liftPlan(done = mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7, StageId.LIFT to 8, StageId.RUN to 9))
        assertNull("nothing live is left", TodayModel(fullSnapshot(done), done, false).hero(5).skip)
    }

    @Test
    fun anInjuredLiftDayKeepsItsLiftAndSaysItIsAdjusted() {
        val snapshot = fullSnapshot().copy(status = status(SkipReason.Injured, muscle = "quads"), injured = listOf("quads"))
        val hero = TodayModel(snapshot, liftPlan(done = mapOf(StageId.CHECK_IN to 7, StageId.WARM_UP to 7)), false).hero(2)
        assertEquals(HeroLayout.Lift, hero.layout)
        assertTrue(hero.lines.first().startsWith("Adjusted around your quads"))
        assertNotNull(hero.cta)
    }

    // ---- the week card marks a skipped day ----

    private fun weekWithSkip(reason: SkipReason, shifts: Boolean): EngineSnapshot {
        val plan = restPlan(today, reason = reason)
        val days = (0..6).map { i ->
            val date = com.qala.data.IsoTime.addDays("2026-10-05", i.toLong())
            DayPlan(date, i, if (date == today) DayKind.REST else DayKind.LIFT, null, null, if (date == today) reason else null, false)
        }
        return fullSnapshot(plan, hero = null).copy(week = WeekPlan("2026-10-05", days), status = DayStatus(reason, StatusSpan.OneDay, null, null, shifts))
    }

    @Test
    fun aSkippedDayIsMarkedWithItsReasonAndTheCaptionSaysWhatHappens() {
        val sick = weekCard(weekWithSkip(SkipReason.Sick, shifts = true))
        val cell = sick.cells[2]
        assertEquals(SkipReason.Sick, cell.reason)
        assertTrue(cell.today)
        assertEquals("the days around it are not marked", listOf(null, null, SkipReason.Sick, null, null, null, null), sick.cells.map { it.reason })
        assertEquals("Today is skipped (sick). The plan shifts out.", sick.caption)
        assertEquals("Today is skipped (break). The plan holds.", weekCard(weekWithSkip(SkipReason.Break, shifts = false)).caption)
    }

    @Test
    fun aWeekWhollySkippedSaysSoInsteadOfSendingYouToSettings() {
        // A sick status over the whole week: every training day is off, but the days are set.
        val days = (0..6).map { i ->
            val date = com.qala.data.IsoTime.addDays("2026-10-05", i.toLong())
            DayPlan(date, i, DayKind.REST, null, null, if (i in setOf(0, 2, 4, 5)) SkipReason.Sick else null, false)
        }
        val snapshot = fullSnapshot(restPlan(today, reason = SkipReason.Sick), hero = null).copy(
            week = WeekPlan("2026-10-05", days),
            weekLoad = com.qala.data.core.WeekLoadResult(List(7) { 0.0 }, List(7) { 0.0 }),
            status = status(SkipReason.Sick, StatusSpan.Range("2026-10-05", null)),
        )
        val card = weekCard(snapshot)
        assertTrue(card.empty)
        assertEquals("This week is skipped (sick). The plan shifts out.", card.caption)
        assertNull("Settings cannot help: the training days are set", card.action)
    }

    @Test
    fun aRunPlanWhoseDaysAreAllOffIsPausedNotMissing() {
        val off = fullSnapshot(next = null).copy(hasRunPlan = true, status = status(SkipReason.Sick, StatusSpan.Range("2026-10-05", null)))
        val card = nextRunCard(off)
        assertEquals("Paused", card.title)
        assertFalse(card.empty)
        assertNull(card.action)
        assertTrue("with no plan at all it is still the empty state", nextRunCard(off.copy(hasRunPlan = false)).empty)
        assertTrue(nextRunCard(fullSnapshot(next = null)).empty)
    }
}
