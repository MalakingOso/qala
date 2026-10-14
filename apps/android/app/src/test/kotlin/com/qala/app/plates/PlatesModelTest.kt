package com.qala.app.plates

import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.PlateLoad
import com.qala.data.core.PlatePairs
import com.qala.data.core.QalaCore
import com.qala.data.core.nearestLoadable
import com.qala.data.core.planPlates
import com.qala.data.model.PlateSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatesModelTest {
    private val default = PlateSettings()
    private val BarOptions = barOptions(default)

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

    // ---- the bar and the inventory come from Settings ----

    @Test
    fun theBarPickerOffersTheTwoFullBarsAndTheCurlBarAtItsSavedWeight() {
        assertEquals(listOf("45", "35", "EZ 25"), barOptions(PlateSettings()).map { it.label })
        assertEquals(listOf(45.0, 35.0, 25.0), barOptions(PlateSettings()).map { it.weight })
        val custom = barOptions(PlateSettings(ezBar = 18.0))
        assertEquals("EZ 18", custom.last().label)
        assertEquals(18.0, custom.last().weight, 0.0)
        assertTrue(custom.last().ez)
        assertTrue(custom.dropLast(1).none { it.ez })
    }

    @Test
    fun theCalculatorOpensOnTheSavedDefaultBarAndTheCurlBarIsAChoiceOfTheScreen() {
        val at45 = PlateSettings()
        val at35 = PlateSettings(defaultBar = 35.0)
        assertEquals(0, selectedBarIndex(barOptions(at45), at45, ez = false))
        assertEquals("a default bar of 35 is the second cell", 1, selectedBarIndex(barOptions(at35), at35, ez = false))
        assertEquals(35.0, barOptions(at35)[selectedBarIndex(barOptions(at35), at35, ez = false)].weight, 0.0)
        assertEquals(2, selectedBarIndex(barOptions(at35), at35, ez = true))
    }

    @Test
    fun aDefaultBarThePickerDoesNotOfferGetsACellOfItsOwn() {
        val odd = PlateSettings(defaultBar = 40.0)
        val options = barOptions(odd)
        assertEquals(listOf("45", "35", "40", "EZ 25"), options.map { it.label })
        assertEquals(40.0, options[selectedBarIndex(options, odd, ez = false)].weight, 0.0)
    }

    private fun plan(target: Double, setup: PlateSettings, bar: Double = setup.defaultBar) =
        QalaCore.planPlates(target, bar, setup.plates).nearestLoadable()!!

    @Test
    fun withTheDefaultInventory245On45IsTwoFortyFivesAndATen() {
        assertEquals(listOf(45.0, 45.0, 10.0), plan(245.0, PlateSettings()).perSide)
    }

    @Test
    fun withNoTensTheCalculatorReachesForFivesInstead() {
        val no10s = PlateSettings().withPairs(10.0, PlatePairs.Count(0.0))
        val load = plan(245.0, no10s)
        assertTrue("no 10s on the bar: ${load.perSide}", 10.0 !in load.perSide)
        assertEquals(245.0, load.total, 0.0)
        assertEquals(listOf(45.0, 45.0, 5.0, 5.0), load.perSide)
    }

    @Test
    fun aPairOfFiftyFivesIsUsedOnceTheyAreSwitchedOn() {
        assertTrue(55.0 !in plan(245.0, PlateSettings()).perSide)
        val with55 = PlateSettings().with55(1.0)
        assertEquals("245 becomes 55 and 45 a side", listOf(55.0, 45.0), plan(245.0, with55).perSide)
        assertEquals(245.0, plan(245.0, with55).total, 0.0)
        assertEquals("one pair means one 55 a side", listOf(55.0, 45.0, 10.0), plan(265.0, with55).perSide)
        assertEquals("two pairs reach for two", listOf(55.0, 55.0), plan(265.0, with55.with55(2.0)).perSide)
    }

    @Test
    fun theLighterBarTakesTheTargetAndTheSummaryAndCaptionNameIt() {
        val at35 = PlateSettings(defaultBar = 35.0)
        val options = barOptions(at35)
        val bar = options[selectedBarIndex(options, at35, ez = false)]
        val load = plan(245.0, at35)
        assertEquals(35.0, load.barWeight, 0.0)
        assertEquals(105.0, load.perSideTotal, 0.0)
        assertEquals("35 bar + 2 × 105 = 245", calcSummary(bar, load, 245.0).main)
        assertEquals("35 lb bar, no plates.", calcCaption(bar, emptyList(), 0.0))
    }

    @Test
    fun theCurlBarPlansOnItsSavedWeight() {
        val ez = PlateSettings(ezBar = 18.0)
        val bar = barOptions(ez).last()
        val load = plan(98.0, ez, bar.weight)
        assertEquals(18.0, load.barWeight, 0.0)
        assertEquals("18 EZ bar + 2 × 40 = 98", calcSummary(bar, load, 98.0).main)
    }

    @Test
    fun theLayoutAndTheFacesTakeTheColoursOfTheSavedInventory() {
        val black = PlateSettings(plates = listOf(com.qala.data.core.PlateEntry(45.0, PlatePairs.Enough, "black")) + DefaultLbPlates.drop(1)).plates
        assertEquals("charcoal", colorName(45.0, black))
        assertEquals("plate_45_charcoal.webp", plateSprite("plate", 45.0, black)?.file)
        val red55 = PlateSettings().with55(1.0).plates
        assertEquals("red", colorName(55.0, red55))
        assertEquals("face_55_red.webp", plateSprite("face", 55.0, red55)?.file)
        assertTrue(plateLayout(listOf(55.0, 45.0), ez = false, width = 350f, inventory = red55).draws.any { it.sprite.file == "plate_55_red.webp" })
    }
}
