package com.qala.app.skip

import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.SkipReason
import com.qala.data.today.DayStatus
import com.qala.data.today.StatusSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SkipModelTest {
    private val today = "2026-10-07"      // a Wednesday

    private fun shifts(r: SkipReason) = r == SkipReason.Vacation || r == SkipReason.Sick
    private fun says(reason: SkipReason, span: SkipSpan = SkipSpan.Day, muscle: String? = null) = whatHappens(reason, muscle, span, shifts(reason))

    // ---- the live "what happens" line ----

    @Test
    fun breakAndSchedulingRestInPlace() {
        assertEquals("Today rests. Your plan stays where it is.", says(SkipReason.Break))
        assertEquals("Today rests. Your plan stays where it is.", says(SkipReason.Scheduling))
        assertEquals("The next 3 days rest. Your plan stays where it is.", says(SkipReason.Break, SkipSpan.Three))
        assertEquals("The next 7 days rest. Your plan stays where it is.", says(SkipReason.Scheduling, SkipSpan.Seven))
        assertEquals("Days rest until you say so. Your plan stays where it is.", says(SkipReason.Break, SkipSpan.Open))
    }

    @Test
    fun vacationAndSickShiftThePlanOut() {
        assertEquals("Away from training today. Your plan shifts out by the days you are gone.", says(SkipReason.Vacation))
        assertEquals("Away from training for 7 days. Your plan shifts out by the days you are gone.", says(SkipReason.Vacation, SkipSpan.Seven))
        assertEquals("Resting to get well today. Your plan shifts out, so nothing is lost.", says(SkipReason.Sick))
        assertEquals("Resting to get well until you say so. Your plan shifts out, so nothing is lost.", says(SkipReason.Sick, SkipSpan.Open))
    }

    @Test
    fun anInjuryTrainsAroundTheMuscleAndNamesIt() {
        assertEquals(
            "Direct quads work pauses for 7 days and lifts that lean on it run at half volume. Everything else stays.",
            says(SkipReason.Injured, SkipSpan.Seven, "quads"),
        )
        assertEquals(
            "Direct front delts work pauses today and lifts that lean on it run at half volume. Everything else stays.",
            says(SkipReason.Injured, SkipSpan.Day, "frontdelts"),
        )
        assertTrue("before a muscle is picked it still reads", says(SkipReason.Injured).startsWith("Direct work for the muscle you pick pauses today"))
    }

    @Test
    fun theRulesAnswerDecidesNotTheReasonsName() {
        // The core says which reasons shift; the copy follows it for any reason that is not an injury.
        assertEquals("Training pauses today. Your plan shifts out, so nothing is lost.", whatHappens(SkipReason.Break, null, SkipSpan.Day, shifts = true))
    }

    @Test
    fun noCopyCountsAgainstTheUser() {
        val all = SkipReasons.flatMap { r -> SkipSpan.entries.map { says(r, it, "quads") } }
        for (line in all) {
            assertFalse(line, line.contains("miss", ignoreCase = true) || line.contains("!") || line.contains("—") || line.contains("lost progress"))
        }
    }

    // ---- the draft ----

    @Test
    fun aFreshDraftIsABreakForThisDayOnly() {
        val d = SkipDraft()
        assertEquals(SkipReason.Break, d.reason)
        assertEquals(SkipSpan.Day, d.span)
        assertTrue(d.valid)
    }

    @Test
    fun anInjuryNeedsAMuscleAndLeavingInjuredForgetsIt() {
        val injured = SkipDraft().withReason(SkipReason.Injured)
        assertFalse(injured.valid)
        assertEquals("Pick a muscle first", confirmLabel(injured, SkipMode.New))
        val picked = injured.withMuscle("calves")
        assertTrue(picked.valid)
        assertEquals("calves", picked.muscle)
        assertEquals("a muscle belongs to an injury only", null, picked.withReason(SkipReason.Sick).muscle)
        assertEquals("calves", picked.withReason(SkipReason.Injured).muscle)
    }

    @Test
    fun theConfirmButtonNamesTheLengthOrJustSavesAChange() {
        assertEquals(
            listOf("Skip today", "Skip 3 days", "Skip 7 days", "Skip until I say so"),
            SkipSpan.entries.map { confirmLabel(SkipDraft(span = it), SkipMode.New) },
        )
        assertEquals("Save change", confirmLabel(SkipDraft(span = SkipSpan.Seven), SkipMode.Change))
        assertEquals("Keep training", dismissLabel(SkipMode.New))
        assertEquals("Cancel", dismissLabel(SkipMode.Change))
    }

    @Test
    fun theInjuryPickerOffersOnlyMusclesTheEngineCanGuard() {
        assertEquals(15, InjuryMuscles.size)
        assertEquals(InjuryMuscles.size, InjuryMuscles.toSet().size)
        assertFalse("back and shoulders are not engine muscles that anything maps to", "back" in InjuryMuscles || "shoulders" in InjuryMuscles)
    }

    // ---- what the sheet opens with ----

    private fun status(reason: SkipReason, span: StatusSpan, muscle: String? = null, note: String? = null) = DayStatus(reason, span, muscle, note, shifts(reason))

    @Test
    fun withNothingOnTheDayTheSheetIsANewSkip() {
        val r = skipRequest(today, null)
        assertEquals(SkipMode.New, r.mode)
        assertEquals("Skip today", r.title)
        assertEquals("Wednesday, Oct 7", r.dayLine)
        assertEquals(SkipDraft(), r.draft)
    }

    @Test
    fun withAStatusOnTheDayTheSheetChangesItAndStartsFromIt() {
        val r = skipRequest(today, status(SkipReason.Injured, StatusSpan.Range("2026-10-06", "2026-10-12"), "quads", "left knee"))
        assertEquals(SkipMode.Change, r.mode)
        assertEquals("Change status", r.title)
        assertEquals(SkipDraft(SkipReason.Injured, "quads", SkipSpan.Seven, "left knee"), r.draft)
    }

    @Test
    fun theSpanIsReadBackFromWhatIsLeft() {
        fun spanOf(s: StatusSpan) = initialDraft(status(SkipReason.Break, s), today).span
        assertEquals(SkipSpan.Day, spanOf(StatusSpan.OneDay))
        assertEquals(SkipSpan.Open, spanOf(StatusSpan.Range("2026-10-01", null)))
        assertEquals("ends today", SkipSpan.Day, spanOf(StatusSpan.Range("2026-10-05", "2026-10-07")))
        assertEquals(SkipSpan.Three, spanOf(StatusSpan.Range("2026-10-07", "2026-10-09")))
        assertEquals(SkipSpan.Seven, spanOf(StatusSpan.Range("2026-10-07", "2026-10-13")))
        assertEquals(SkipSpan.Seven, spanOf(StatusSpan.Range("2026-10-07", "2026-10-20")))
    }

    // ---- the writes for Confirm ----

    @Test
    fun oneDayIsADaySkipWithATrimmedNote() {
        val d = SkipDraft(SkipReason.Sick, note = "  flu  ")
        assertEquals(listOf<SkipWrite>(SkipWrite.SkipDay(today, SkipReason.Sick, null, "flu")), confirmWrites(d, today, null))
        assertEquals(null, (confirmWrites(d.withNote("  "), today, null).single() as SkipWrite.SkipDay).note)
    }

    @Test
    fun aSpanSetsTheStatusFromTodayAndAnOpenOneHasNoEnd() {
        assertEquals(
            listOf<SkipWrite>(SkipWrite.SetStatus(AvailabilityStatus.Vacation, today, "2026-10-09", null, null)),
            confirmWrites(SkipDraft(SkipReason.Vacation, span = SkipSpan.Three), today, null),
        )
        assertEquals(
            listOf<SkipWrite>(SkipWrite.SetStatus(AvailabilityStatus.Sick, today, "2026-10-13", null, null)),
            confirmWrites(SkipDraft(SkipReason.Sick, span = SkipSpan.Seven), today, null),
        )
        assertEquals(
            listOf<SkipWrite>(SkipWrite.SetStatus(AvailabilityStatus.Break, today, null, null, null)),
            confirmWrites(SkipDraft(SkipReason.Break, span = SkipSpan.Open), today, null),
        )
    }

    @Test
    fun anInjurySpanCarriesItsMuscleAndOtherReasonsDropIt() {
        val writes = confirmWrites(SkipDraft(SkipReason.Injured, "quads", SkipSpan.Seven, "knee"), today, null)
        assertEquals(listOf<SkipWrite>(SkipWrite.SetStatus(AvailabilityStatus.Injured, today, "2026-10-13", "quads", "knee")), writes)
        assertEquals(null, (confirmWrites(SkipDraft(SkipReason.Break, "quads", SkipSpan.Day), today, null).single() as SkipWrite.SkipDay).muscle)
    }

    @Test
    fun anInjuryWithNoMuscleCannotBeConfirmed() {
        assertThrows(IllegalArgumentException::class.java) { confirmWrites(SkipDraft(SkipReason.Injured), today, null) }
    }

    @Test
    fun aSpanOverAOneDaySkipUndoesTheSkipFirstSoTheSpanShows() {
        // reason_on lets a one-day skip win over the status, so the old skip would hide the new span.
        val writes = confirmWrites(SkipDraft(SkipReason.Sick, span = SkipSpan.Three), today, status(SkipReason.Break, StatusSpan.OneDay))
        assertEquals(SkipWrite.UndoSkip(today), writes[0])
        assertTrue(writes[1] is SkipWrite.SetStatus)
        assertEquals(2, writes.size)
    }

    @Test
    fun changingASpanThatKeepsItsReasonKeepsItsStart() {
        val existing = status(SkipReason.Sick, StatusSpan.Range("2026-10-05", null))
        val writes = confirmWrites(SkipDraft(SkipReason.Sick, span = SkipSpan.Three), today, existing)
        assertEquals(listOf<SkipWrite>(SkipWrite.SetStatus(AvailabilityStatus.Sick, "2026-10-05", "2026-10-09", null, null)), writes)
        val other = confirmWrites(SkipDraft(SkipReason.Break, span = SkipSpan.Three), today, existing)
        assertEquals("a new reason starts today", today, (other.single() as SkipWrite.SetStatus).since)
    }

    @Test
    fun shorteningASpanToThisDayEndsItYesterdayOrClearsItWhenItBeganToday() {
        val running = status(SkipReason.Sick, StatusSpan.Range("2026-10-05", null), note = "flu")
        assertEquals(
            listOf(SkipWrite.SetStatus(AvailabilityStatus.Sick, "2026-10-05", "2026-10-06", null, "flu"), SkipWrite.SkipDay(today, SkipReason.Break, null, null)),
            confirmWrites(SkipDraft(SkipReason.Break), today, running),
        )
        val fresh = status(SkipReason.Sick, StatusSpan.Range(today, "2026-10-09"))
        assertEquals(
            listOf(SkipWrite.ClearStatus, SkipWrite.SkipDay(today, SkipReason.Break, null, null)),
            confirmWrites(SkipDraft(SkipReason.Break), today, fresh),
        )
    }

    @Test
    fun changingAOneDaySkipRewritesTheSameDay() {
        val writes = confirmWrites(SkipDraft(SkipReason.Scheduling), today, status(SkipReason.Break, StatusSpan.OneDay))
        assertEquals(listOf<SkipWrite>(SkipWrite.SkipDay(today, SkipReason.Scheduling, null, null)), writes)
    }

    // ---- Undo ----

    @Test
    fun undoingAOneDaySkipUndoesIt() {
        assertEquals(listOf<SkipWrite>(SkipWrite.UndoSkip(today)), undoWrites(status(SkipReason.Sick, StatusSpan.OneDay), today))
    }

    @Test
    fun undoingASpanThatBeganTodayClearsIt() {
        assertEquals(listOf<SkipWrite>(SkipWrite.ClearStatus), undoWrites(status(SkipReason.Sick, StatusSpan.Range(today, null)), today))
    }

    @Test
    fun endingASpanThatBeganEarlierKeepsTheDaysAlreadyMarked() {
        val ended = undoWrites(status(SkipReason.Injured, StatusSpan.Range("2026-10-05", "2026-10-12"), "quads", "knee"), today)
        assertEquals(listOf<SkipWrite>(SkipWrite.SetStatus(AvailabilityStatus.Injured, "2026-10-05", "2026-10-06", "quads", "knee")), ended)
    }

    // ---- the span line ----

    @Test
    fun theSpanLineSaysSinceAndUntil() {
        assertEquals("Today only", spanLine(status(SkipReason.Sick, StatusSpan.OneDay), today))
        assertEquals("Until you say so", spanLine(status(SkipReason.Sick, StatusSpan.Range(today, null)), today))
        assertEquals("Since Monday, until you say so", spanLine(status(SkipReason.Sick, StatusSpan.Range("2026-10-05", null)), today))
        assertEquals("Until Sunday", spanLine(status(SkipReason.Vacation, StatusSpan.Range(today, "2026-10-11")), today))
        assertEquals("Until Oct 20", spanLine(status(SkipReason.Vacation, StatusSpan.Range(today, "2026-10-20")), today))
        assertEquals("Since yesterday, until tomorrow", spanLine(status(SkipReason.Break, StatusSpan.Range("2026-10-06", "2026-10-08")), today))
    }
}
