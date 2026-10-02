package com.qala.design

import androidx.compose.ui.geometry.Rect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** All in dp (scale 1). The strip is 28 x 120 at y 300..420, so the bite zone is y 292..428 and ends at x 36. */
class RailGeometryTest {
    private val band = Rect(0f, 300f, 28f, 420f)
    private val eps = 1e-4f

    private fun card(top: Float, bottom: Float, left: Float = 14f) = Rect(left, top, 376f, bottom)

    private fun bite(card: Rect, scale: Float = 1f, band: Rect = this.band) = RailGeometry.bite(card, band, scale)

    @Test fun noOverlapGivesNoBite() {
        assertNull(bite(card(100f, 250f)))        // well above
        assertNull(bite(card(500f, 700f)))        // well below
        assertNull(bite(card(100f, 292f)))        // ends exactly where the zone starts
        assertNull(bite(card(428f, 600f)))        // starts exactly where it ends
    }

    @Test fun overlapJustUnderTheThresholdGivesNoBite() {
        assertNull(bite(card(100f, 301.99f)))     // 9.99 dp into the zone
        assertNull(bite(card(418.01f, 600f)))
    }

    @Test fun overlapOfExactlyTenIsABite() {
        val b = assertNotNull(bite(card(100f, 302f)))
        assertEquals(10f, b.height, eps)
        assertNotNull(bite(card(418f, 600f)))
    }

    @Test fun partialOverlapFromAboveIsClippedToTheCardBottom() {
        val b = assertNotNull(bite(card(100f, 310f)))
        assertEquals(292f - 100f, b.top, eps)     // card-local
        assertEquals(310f - 100f, b.bottom, eps)
        assertFalse(b.openTop)
        assertTrue(b.openBottom)
    }

    @Test fun partialOverlapFromBelowIsClippedToTheCardTop() {
        val b = assertNotNull(bite(card(400f, 700f)))
        assertEquals(0f, b.top, eps)
        assertEquals(428f - 400f, b.bottom, eps)
        assertTrue(b.openTop)
        assertFalse(b.openBottom)
    }

    @Test fun aCardTallerThanTheBandGetsTheFullZone() {
        val b = assertNotNull(bite(card(0f, 800f)))
        assertEquals(292f, b.top, eps)
        assertEquals(428f, b.bottom, eps)
        assertEquals(8f, b.radius, eps)
        assertFalse(b.openTop)
        assertFalse(b.openBottom)
    }

    @Test fun aCardInsideTheBandIsCutOnItsWholeHeight() {
        val b = assertNotNull(bite(card(320f, 400f)))
        assertEquals(0f, b.top, eps)
        assertEquals(80f, b.bottom, eps)
        assertTrue(b.openTop)
        assertTrue(b.openBottom)
    }

    @Test fun theBandTouchingTheCardEdgesOpensThoseEnds() {
        // card top exactly at the zone start (the band, less its clearance): no card edge is left above the bite
        val top = assertNotNull(bite(card(292f, 700f)))
        assertEquals(0f, top.top, eps)
        assertTrue(top.openTop)
        assertFalse(top.openBottom)
        // card bottom exactly at the zone end
        val bottom = assertNotNull(bite(card(0f, 428f)))
        assertEquals(428f, bottom.bottom, eps)
        assertTrue(bottom.openBottom)
        assertFalse(bottom.openTop)
        // one dp inside the zone on both ends: both ends open; one dp outside: both closed
        val inside = assertNotNull(bite(card(293f, 427f)))
        assertTrue(inside.openTop && inside.openBottom)
        val outside = assertNotNull(bite(card(291f, 429f)))
        assertFalse(outside.openTop || outside.openBottom)
    }

    @Test fun theBiteEndsEightDpPastTheStrip() {
        val b = assertNotNull(bite(card(0f, 800f, left = 14f)))
        assertEquals(36f - 14f, b.right, eps)                       // card-local: 22 dp
        assertEquals(36f, b.right + 14f, eps)                       // root: strip 28 + 8 whitespace
        assertEquals(36f, assertNotNull(bite(card(0f, 800f, left = 0f))).right, eps)
    }

    @Test fun aCardStartingPastTheBiteIsLeftAlone() {
        assertNull(bite(card(0f, 800f, left = 36f)))
        assertNull(bite(card(0f, 800f, left = 60f)))
        assertNotNull(bite(card(0f, 800f, left = 35.5f)))
    }

    @Test fun radiusIsEightClampedToHalfTheHeightMinusOne() {
        fun radiusOfBiteHeight(h: Float) = assertNotNull(bite(card(300f - 8f + 0f, 300f - 8f + h, left = 14f))).radius
        // a card that starts at the zone's top edge and is h tall, so the bite height is h
        assertEquals(4f, radiusOfBiteHeight(10f), eps)       // the shortest bite there is
        assertEquals(5f, radiusOfBiteHeight(12f), eps)
        assertEquals(7.5f, radiusOfBiteHeight(17f), eps)
        assertEquals(8f, radiusOfBiteHeight(18f), eps)       // h/2 - 1 reaches 8 here
        assertEquals(8f, radiusOfBiteHeight(60f), eps)       // and then it stays at 8
    }

    @Test fun theRadiusIsNeverNegativeOrAboveEight() {
        for (h in 10..200) {
            val b = assertNotNull(bite(card(292f, 292f + h)))
            assertTrue("radius at h=$h", b.radius in 4f..8f)
            assertTrue("two corners fit at h=$h", 2 * b.radius <= b.height - 2f + eps)
        }
    }

    @Test fun anEmptyBandMakesNoBite() {
        assertNull(bite(card(0f, 800f), band = Rect.Zero))
        assertNull(bite(card(0f, 800f), band = Rect(0f, 300f, 28f, 300f)))
    }

    @Test fun pixelsScaleEveryConstantAndMatchDp() {
        val scale = 2.625f
        val bandPx = Rect(band.left * scale, band.top * scale, band.right * scale, band.bottom * scale)
        val cardDp = card(100f, 700f)
        val cardPx = Rect(cardDp.left * scale, cardDp.top * scale, cardDp.right * scale, cardDp.bottom * scale)
        val dp = assertNotNull(bite(cardDp))
        val px = assertNotNull(RailGeometry.bite(cardPx, bandPx, scale))
        assertEquals(dp.top * scale, px.top, 1e-2f)
        assertEquals(dp.bottom * scale, px.bottom, 1e-2f)
        assertEquals(dp.right * scale, px.right, 1e-2f)
        assertEquals(dp.radius * scale, px.radius, 1e-2f)
        // the 10 dp threshold scales too: 9.9 dp of overlap is no bite in px either
        assertNull(RailGeometry.bite(Rect(cardPx.left, 100f * scale, cardPx.right, 301.9f * scale), bandPx, scale))
    }

    @Test fun biteIntoMatchesBiteAndReusesItsOutput() {
        val out = Bite()
        assertTrue(RailGeometry.biteInto(out, 14f, 0f, 376f, 800f, 300f, 420f, 28f))
        val fresh = assertNotNull(bite(card(0f, 800f)))
        assertEquals(fresh.top, out.top, eps)
        assertEquals(fresh.right, out.right, eps)
        assertFalse(RailGeometry.biteInto(out, 14f, 0f, 376f, 100f, 300f, 420f, 28f))
    }

    private fun <T : Any> assertNotNull(value: T?): T {
        org.junit.Assert.assertNotNull(value)
        return value!!
    }
}
