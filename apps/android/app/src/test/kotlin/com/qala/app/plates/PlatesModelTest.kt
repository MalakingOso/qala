package com.qala.app.plates

import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.PlateLoad
import com.qala.data.core.PlatePairs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatesModelTest {
    @Test
    fun steppingMovesByFiveAndNeverUnderTheBar() {
        assertEquals(250.0, stepTarget(245.0, 1, 45.0), 0.0)
        assertEquals(240.0, stepTarget(245.0, -1, 45.0), 0.0)
        assertEquals(45.0, stepTarget(50.0, -2, 45.0), 0.0)
        assertEquals(25.0, stepTarget(30.0, -2, EzBarWeight), 0.0)
    }

    @Test
    fun weightsPrintTheWayJsPrintsThem() {
        assertEquals("45", fmtWeight(45.0))
        assertEquals("2.5", fmtWeight(2.5))
        assertEquals("1.25", fmtWeight(1.25))
        assertEquals("0", fmtWeight(0.0))
    }

    @Test
    fun theSummaryNamesTheNearestLoadOnlyWhenItDiffers() {
        val bar = BarOptions[0]
        val exact = PlateLoad(listOf(45.0, 45.0, 10.0), 100.0, 245.0, 45.0, 0.0)
        assertEquals("45 bar + 2 × 100 = 245", calcSummary(bar, exact, 245.0).main)
        assertNull(calcSummary(bar, exact, 245.0).hint)
        val nearest = PlateLoad(listOf(45.0, 45.0, 10.0), 100.0, 245.0, 45.0, 0.0)
        assertEquals("nearest you can load to 243", calcSummary(bar, nearest, 243.0).hint)
        assertEquals("45 bar + 2 × 0 = —", calcSummary(bar, null, 245.0).main)
        val ezLoad = PlateLoad(listOf(45.0, 45.0, 10.0, 10.0), 110.0, 245.0, 25.0, 0.0)
        assertEquals("25 EZ bar + 2 × 110 = 245", calcSummary(BarOptions[2], ezLoad, 245.0).main)
    }

    @Test
    fun theCaptionListsEveryPlate() {
        assertEquals(
            "45 · 45 · 10 on each side, 100 lb a side, on a 45 lb bar",
            calcCaption(BarOptions[0], listOf(45.0, 45.0, 10.0), 100.0),
        )
        assertEquals("45 lb bar, no plates.", calcCaption(BarOptions[0], emptyList(), 0.0))
        assertEquals("EZ bar, no plates.", calcCaption(BarOptions[2], emptyList(), 0.0))
    }

    @Test
    fun pairCountsReadAsWords() {
        assertEquals("plenty", pairsText(PlatePairs.Enough))
        assertEquals("1 pair", pairsText(PlatePairs.Count(1.0)))
        assertEquals("0 pairs", pairsText(PlatePairs.Count(0.0)))
        assertEquals("3 pairs", pairsText(PlatePairs.Count(3.0)))
    }

    @Test
    fun spriteChoiceUsesTheInventoryColorThenFallsBack() {
        assertEquals("blue", colorName(45.0, DefaultLbPlates))
        assertEquals("silver", colorName(1.25, DefaultLbPlates))
        assertEquals("charcoal", colorName(99.0, DefaultLbPlates))
        assertEquals(45.0, sizeKey(45.0), 0.0)
        assertEquals(45.0, sizeKey(44.0), 0.0)
        assertEquals(2.5, sizeKey(2.5), 0.0)
        assertEquals("plate_45_blue.webp", plateSprite("plate", 45.0, DefaultLbPlates)?.file)
        assertEquals("face_45_blue.webp", plateSprite("face", 45.0, DefaultLbPlates)?.file)
    }

    @Test
    fun theLayoutStacksPlatesHeaviestFirstAndFitsTheCard() {
        val layout = plateLayout(listOf(45.0, 45.0, 10.0), ez = false, width = 350f)
        val plates = layout.draws.filter { it.sprite.file.startsWith("plate_") }
        assertEquals(3, plates.size)
        assertTrue("plates move toward the sleeve end", plates[0].left < plates[1].left && plates[1].left < plates[2].left)
        assertTrue("plates stay in the card (the shaft runs off the left edge, as on the web)", plates.all { it.left >= -1f && it.left + it.width <= 351f })
        assertEquals(listOf("45", "45"), layout.labels.map { it.text })
        assertTrue(layout.floor != null)
        val empty = plateLayout(emptyList(), ez = false, width = 350f)
        assertTrue(empty.labels.isEmpty())
        assertNull(empty.floor)
        assertTrue(plateLayout(listOf(45.0), ez = true, width = 350f).draws.any { it.sprite.file == "ez_back.webp" })
    }
}
