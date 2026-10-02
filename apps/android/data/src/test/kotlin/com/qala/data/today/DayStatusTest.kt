package com.qala.data.today

import com.qala.data.model.Availability
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.DaySkip
import com.qala.data.model.SkipReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DayStatusTest {
    private val today = "2026-10-05"
    private val sick = Availability(AvailabilityStatus.Sick, since = "2026-10-04", until = null, note = "flu")

    private fun of(
        reason: SkipReason?,
        availability: Availability = Availability(),
        skips: List<DaySkip> = emptyList(),
        injured: List<String> = emptyList(),
        shifts: Boolean = false,
    ) = DayStatuses.of(today, availability, skips, reason, injured, shifts)

    @Test
    fun noReasonIsNoStatus() {
        assertNull(of(null))
        assertNull(of(null, sick))
    }

    @Test
    fun aOneDaySkipIsTheSourceWhenThereIsOneForTheDay() {
        val status = of(SkipReason.Break, sick, listOf(DaySkip(today, SkipReason.Break, note = " rest ")))!!
        assertEquals(SkipReason.Break, status.reason)
        assertEquals(StatusSpan.OneDay, status.span)
        assertEquals("a skip for the day wins over the status", " rest ", status.note)
    }

    @Test
    fun aSkipForAnotherDayDoesNotCount() {
        val status = of(SkipReason.Sick, sick, listOf(DaySkip("2026-10-06", SkipReason.Break)), shifts = true)!!
        assertEquals(StatusSpan.Range("2026-10-04", null), status.span)
        assertEquals("flu", status.note)
        assertEquals(true, status.shifts)
    }

    @Test
    fun anInjuryNamesTheMuscleTheCoreFound() {
        val status = of(SkipReason.Injured, Availability(AvailabilityStatus.Injured, "2026-10-05", "2026-10-11", "quads"), injured = listOf("quads"))!!
        assertEquals("quads", status.muscle)
        assertEquals(StatusSpan.Range("2026-10-05", "2026-10-11"), status.span)
        assertNull("only an injury has a muscle", of(SkipReason.Sick, sick, injured = listOf("quads"))!!.muscle)
    }

    @Test
    fun aBlankNoteIsNoNote() {
        assertNull(of(SkipReason.Break, skips = listOf(DaySkip(today, SkipReason.Break, note = "  ")))!!.note)
    }

    @Test
    fun onlyASickSpanHasASickSince() {
        assertEquals("2026-10-04", of(SkipReason.Sick, sick)!!.sickSince)
        assertNull("a one-day skip never asks", of(SkipReason.Sick, skips = listOf(DaySkip(today, SkipReason.Sick)))!!.sickSince)
        assertNull(of(SkipReason.Vacation, Availability(AvailabilityStatus.Vacation, "2026-10-04"))!!.sickSince)
    }
}
