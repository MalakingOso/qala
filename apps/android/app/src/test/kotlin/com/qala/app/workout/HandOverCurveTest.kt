package com.qala.app.workout

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HandOverCurveTest {
    @Test
    fun theVeilIsAbsentAtBothEndsAndWholeAtTheSwap() {
        assertEquals(0f, HandOverCurve.veil(0f), 1e-6f)
        assertEquals(1f, HandOverCurve.veil(HandOverCurve.Swap), 1e-6f)
        assertEquals(0f, HandOverCurve.veil(1f), 1e-6f)
    }

    @Test
    fun theVeilRisesToTheSwapAndFallsAfterIt() {
        val up = (0..10).map { HandOverCurve.veil(it / 20f) }
        val down = (10..20).map { HandOverCurve.veil(it / 20f) }
        assertTrue(up.zipWithNext().all { (a, b) -> b >= a })
        assertTrue(down.zipWithNext().all { (a, b) -> b <= a })
        assertEquals(0.5f, HandOverCurve.veil(0.25f), 1e-6f)          // the middle of the first half
        assertEquals(0.5f, HandOverCurve.veil(0.75f), 1e-6f)          // and of the second
    }

    @Test
    fun theIncomingContentIsUntouchedBeforeTheSwapThenFadesInFromNothing() {
        assertEquals(1f, HandOverCurve.content(0f), 1e-6f)
        assertEquals(1f, HandOverCurve.content(0.49f), 1e-6f)
        assertEquals(0f, HandOverCurve.content(HandOverCurve.Swap), 1e-6f)
        assertEquals(1f, HandOverCurve.content(1f), 1e-6f)
        val rise = (10..20).map { HandOverCurve.content(it / 20f) }
        assertTrue(rise.zipWithNext().all { (a, b) -> b >= a })
    }

    @Test
    fun theVeilHidesTheOutgoingScreenCompletelyWhenTheContentStillShowsItself() {
        // At the swap the veil is whole, so the screen that is replaced is never visible with the new one's content at 0.
        assertEquals(1f, HandOverCurve.veil(HandOverCurve.Swap), 1e-6f)
        assertEquals(0f, HandOverCurve.content(HandOverCurve.Swap), 1e-6f)
    }
}
