package com.qala.app.today

import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Test

class TodayFormatTest {
    @Test
    fun aClockReadsAtTheRecordsOwnOffset() {
        val ms = at("2026-10-07", 7, 12, offsetMin = -240)
        assertEquals("7:12 am", formatClock(ms, -240, use24h = false))
        assertEquals("07:12", formatClock(ms, -240, use24h = true))
        // The same instant seen from India (UTC+5:30) is a different wall clock; a record made there keeps its own.
        assertEquals("4:42 pm", formatClock(ms, 330, use24h = false))
        assertEquals("16:42", formatClock(ms, 330, use24h = true))
    }

    @Test
    fun midnightAndNoonAreTwelve() {
        assertEquals("12:05 am", formatClock(at("2026-10-07", 0, 5), Offset, false))
        assertEquals("12:00 pm", formatClock(at("2026-10-07", 12), Offset, false))
        assertEquals("11:59 pm", formatClock(at("2026-10-07", 23, 59), Offset, false))
        assertEquals("00:05", formatClock(at("2026-10-07", 0, 5), Offset, true))
    }

    @Test
    fun daysAreSaidFromToday() {
        val today = "2026-10-07"
        assertEquals("today", dayWord(today, "2026-10-07"))
        assertEquals("tomorrow", dayWord(today, "2026-10-08"))
        assertEquals("yesterday", dayWord(today, "2026-10-06"))
        assertEquals("Sunday", dayWord(today, "2026-10-11"))
        assertEquals("Thursday", dayWord(today, "2026-10-01"))
        assertEquals("a week out is a date, not a weekday that could mean either", "Oct 14", dayWord(today, "2026-10-14"))
        assertEquals("Sep 29", dayWord(today, "2026-09-29"))
    }

    @Test
    fun namesAreEnglishWhateverTheDeviceLocale() {
        assertEquals("Wednesday", weekdayName("2026-10-07"))
        assertEquals("Oct 7", shortDate("2026-10-07"))
    }

    @Test
    fun numbersLoseTheirTrailingZeros() {
        assertEquals("150", trimNumber(150.0))
        assertEquals("112.5", trimNumber(112.5))
        assertEquals("3", trimNumber(3.0))
        assertEquals("1.25", trimNumber(1.25))
    }

    @Test
    fun weightsAndDistancesFollowTheUnit() {
        assertEquals("176.4", weightIn(WeightUnit.Lb, 80.0))
        assertEquals("80.0", weightIn(WeightUnit.Kg, 80.0))
        assertEquals("4.0", distanceIn(WeightUnit.Lb, 6437.4))
        assertEquals("6.4", distanceIn(WeightUnit.Kg, 6437.4))
        assertEquals("mi", distanceUnit(WeightUnit.Lb))
        assertEquals("km", distanceUnit(WeightUnit.Kg))
    }

    @Test
    fun loadIsWholeUnitsWithASeparator() {
        assertEquals("34", loadUnits(33.6))
        assertEquals("1,204", loadUnits(1203.9))
    }

    @Test
    fun musclesAreInPlainWords() {
        assertEquals("front delts", muscleName("frontdelts"))
        assertEquals("lower back", muscleName("lowerback"))
        assertEquals("quads", muscleName("quads"))
        assertEquals("an id the table lacks is shown as it is", "newmuscle", muscleName("newmuscle"))
        assertEquals("", joinWords(emptyList()))
        assertEquals("quads", joinWords(listOf("quads")))
        assertEquals("quads and glutes", joinWords(listOf("quads", "glutes")))
        assertEquals("quads, glutes and lats", joinWords(listOf("quads", "glutes", "lats")))
    }

    @Test
    fun everyReasonHasAWord() {
        assertEquals(listOf("break", "vacation", "sick", "injured", "scheduling"), SkipReason.entries.map { reasonWord(it) })
    }
}
