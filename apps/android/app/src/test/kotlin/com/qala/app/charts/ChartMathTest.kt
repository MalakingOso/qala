package com.qala.app.charts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartMathTest {
    @Test
    fun theCurveNeverLeavesTheRangeOfTheTwoPointsItJoins() {
        val x = floatArrayOf(0f, 1f, 2f, 3f, 4f, 5f)
        val y = floatArrayOf(3f, 3f, 9f, 4f, 4f, 20f)
        val m = tangents(x, y)
        for (i in 0 until x.size - 1) {
            // The control points sit a third of the way along, so with one unit between points they must stay between the two values.
            val lo = minOf(y[i], y[i + 1])
            val hi = maxOf(y[i], y[i + 1])
            assertTrue("segment $i first control", y[i] + m[i] / 3 in lo..hi)
            assertTrue("segment $i second control", y[i + 1] - m[i + 1] / 3 in lo..hi)
        }
    }

    @Test
    fun valuesThatAreAllTheSameStillGetARange() {
        val (lo, hi) = yRange(listOf(182.0, 182.0, 182.0), null)
        assertTrue(lo < 182.0 && hi > 182.0)
        val (zlo, zhi) = yRange(listOf(0.0), null)
        assertTrue(zlo < 0.0 && zhi > 0.0)
        assertEquals(listOf(0.0, 0.0), tangents(floatArrayOf(0f, 1f), floatArrayOf(5f, 5f)).map { it.toDouble() })
    }

    @Test
    fun aLongSeriesIsNamedAtFourPlacesAndAShortOneAtEvery() {
        assertEquals(listOf(0, 10, 19, 29), labelIndices(30))
        assertEquals(listOf(0, 1, 2, 3, 4, 5, 6), labelIndices(7))
        assertEquals(listOf(0), labelIndices(1))
        assertEquals(listOf(0, 2, 5, 7), labelIndices(8))
    }
}
