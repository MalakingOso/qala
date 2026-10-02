package com.qala.app.settings

import com.qala.data.model.SettingsRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WeekdayModelTest {
    private val default = SettingsRecord.DefaultTrainingWeekdays

    @Test
    fun theDefaultIsMondayWednesdayFridayAndSaturday() {
        assertEquals(listOf(0, 2, 4, 5), default)
        assertEquals("4 days a week: Mon, Wed, Fri, Sat", weekdaySummary(default))
        assertEquals(listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), WeekdayLabels)
        assertEquals("Monday", WeekdayNames[0])
        assertEquals("Sunday", WeekdayNames[6])
    }

    @Test
    fun aTapFlipsOneDayAndKeepsTheListSorted() {
        assertEquals(listOf(0, 1, 2, 4, 5), toggleWeekday(default, 1))
        assertEquals(listOf(0, 2, 5), toggleWeekday(default, 4))
        assertEquals(listOf(0, 2, 4, 5, 6), toggleWeekday(default, 6))
    }

    @Test
    fun theCellsMapToTheWeekdayIndexTheSettingStores() {
        // 0 is Monday, 6 is Sunday: the cell's position is the value `trainingWeekdays` and the schedule read.
        for (cell in 0..6) assertEquals(listOf(cell), toggleWeekday(emptyList(), cell))
    }

    @Test
    fun theLastDayCannotBeTurnedOff() {
        assertEquals(listOf(5), toggleWeekday(listOf(5), 5))
        assertEquals("the screen says why", "Keep at least one training day.", weekdayWarning(listOf(5)))
        assertNull(weekdayWarning(default))
        assertEquals("1 day a week: Sat", weekdaySummary(listOf(5)))
    }

    @Test
    fun aDayOutsideTheWeekIsIgnored() {
        assertEquals(default, toggleWeekday(default, 7))
        assertEquals(default, toggleWeekday(default, -1))
    }

    @Test
    fun aListWithRepeatsReadsOnceEach() {
        assertEquals(listOf(0, 2), toggleWeekday(listOf(0, 0, 2, 4), 4))
        assertEquals("2 days a week", weekdayCount(listOf(0, 0, 2)))
    }
}
