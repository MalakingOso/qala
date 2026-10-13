package com.qala.app.workout

import com.qala.data.model.WeightUnit
import com.qala.data.program.LastSet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FormatTest {
    @Test
    fun weightsDropTheirTrailingZero() {
        assertEquals("150", formatWeight(150.0))
        assertEquals("152.5", formatWeight(152.5))
        assertEquals("82.5", formatWeight(82.5))
        assertEquals("0", formatWeight(0.0))
    }

    @Test
    fun theRepTargetShowsAnAmrapAsAPlusAndARangeAsTwoNumbers() {
        assertEquals("3", repsTarget(3.0, null, false))
        assertEquals("3+", repsTarget(3.0, null, true))
        assertEquals("8-12", repsTarget(12.0, 8.0, false))
        assertEquals("a range that is no range", "12", repsTarget(12.0, 12.0, false))
    }

    @Test
    fun theClockShowsMinutesAndPaddedSeconds() {
        assertEquals("0:00", formatClock(0))
        assertEquals("0:09", formatClock(9))
        assertEquals("3:45", formatClock(225))
        assertEquals("62:10", formatClock(3730))
        assertEquals("0:00", formatClock(-4))
        assertEquals("+0:30", formatSigned(30))
        assertEquals("−0:15", formatSigned(-15))
    }

    @Test
    fun lastTimeGroupsASteadyWeightAndShowsAChangedOne() {
        fun sets(vararg s: Pair<Double, Double>) = s.map { LastSet(it.first, WeightUnit.Lb, it.second) }
        assertEquals("150 lb: 3 3 3 3 4", lastTimeLine(sets(150.0 to 3.0, 150.0 to 3.0, 150.0 to 3.0, 150.0 to 3.0, 150.0 to 4.0)))
        assertEquals("145 lb: 3 3, 150 lb: 4", lastTimeLine(sets(145.0 to 3.0, 145.0 to 3.0, 150.0 to 4.0)))
        assertEquals("60 kg: 8", lastTimeLine(listOf(LastSet(60.0, WeightUnit.Kg, 8.0))))
        assertNull(lastTimeLine(emptyList()))
    }
}
