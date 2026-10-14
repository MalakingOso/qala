package com.qala.data.model

import com.qala.data.QalaJson
import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.PlateEntry
import com.qala.data.core.PlatePairs
import com.qala.data.repo.SettingsGroups
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The lifting settings as typed values: what a never-written store reads as, what the leaves change, and what a damaged leaf does. */
class GymSettingsTest {
    private fun read(vararg groups: Pair<String, JsonObject>) = GymSettings.from(mapOf(*groups))

    @Test
    fun anEmptyStoreReadsAsWhatTheAppDidBeforeTheseWereSettings() {
        val g = read()
        assertEquals(45.0, g.plates.defaultBar, 0.0)
        assertEquals(25.0, g.plates.ezBar, 0.0)
        assertEquals("the plate set the calculator and the hints always used", DefaultLbPlates, g.plates.plates)
        assertEquals(OwnedEquipment(foamRoller = true, percussion = true, bike = true, rower = false, treadmill = false), g.equipment)
        assertEquals(WarmupSettings(enabled = true, softTissue = true, preferPercussion = true, minutes = 15), g.warmup)
        assertEquals(RestSettings(auto = true, showPlates = true), g.rest)
        assertEquals(GymSettings(), g)
        assertFalse("the 55s are off until switched on", g.plates.uses55)
    }

    @Test
    fun everyLeafOfEveryGroupIsRead() {
        val inventory = listOf(PlateEntry(55.0, PlatePairs.Count(1.0), "red"), PlateEntry(45.0, PlatePairs.Count(2.0), "blue"), PlateEntry(10.0, PlatePairs.Enough, "white"))
        val g = read(
            SettingsGroups.PLATES to buildJsonObject {
                put("defaultBar", 35.0)
                put("ezBar", 18.0)
                put("plates", QalaJson.encodeToJsonElement(ListSerializer(PlateEntry.serializer()), inventory))
            },
            SettingsGroups.EQUIPMENT to buildJsonObject {
                put("foamRoller", false); put("percussion", false); put("bike", false); put("rower", true); put("treadmill", true)
            },
            SettingsGroups.WARMUP to buildJsonObject {
                put("enabled", false); put("softTissue", false); put("preferPercussion", false); put("minutes", 10)
            },
            SettingsGroups.REST to buildJsonObject { put("auto", false); put("showPlates", false) },
        )
        assertEquals(35.0, g.plates.defaultBar, 0.0)
        assertEquals(18.0, g.plates.ezBar, 0.0)
        assertEquals(inventory, g.plates.plates)
        assertTrue(g.plates.uses55)
        assertEquals(OwnedEquipment(foamRoller = false, percussion = false, bike = false, rower = true, treadmill = true), g.equipment)
        assertEquals(WarmupSettings(enabled = false, softTissue = false, preferPercussion = false, minutes = 10), g.warmup)
        assertEquals(RestSettings(auto = false, showPlates = false), g.rest)
    }

    @Test
    fun aLeafNeverWrittenTakesItsOwnDefaultAndLeavesTheOthersAlone() {
        val g = read(SettingsGroups.WARMUP to buildJsonObject { put("minutes", 20) }, SettingsGroups.REST to buildJsonObject { put("auto", false) })
        assertEquals(WarmupSettings(minutes = 20), g.warmup)
        assertEquals(RestSettings(auto = false, showPlates = true), g.rest)
    }

    @Test
    fun aLeafOfTheWrongShapeReadsAsItsDefaultAndNothingElseChanges() {
        val g = read(
            SettingsGroups.PLATES to buildJsonObject {
                put("defaultBar", "heavy")
                put("ezBar", 20.0)
                put("plates", JsonPrimitive(7))
            },
            SettingsGroups.WARMUP to buildJsonObject { put("enabled", "yes"); put("minutes", 12) },
        )
        assertEquals(45.0, g.plates.defaultBar, 0.0)
        assertEquals(20.0, g.plates.ezBar, 0.0)
        assertEquals(DefaultLbPlates, g.plates.plates)
        assertTrue(g.warmup.enabled)
        assertEquals(12, g.warmup.minutes)
    }

    @Test
    fun aBarOrATimeOutsideItsRangeIsNotTrusted() {
        val g = read(
            SettingsGroups.PLATES to buildJsonObject { put("defaultBar", 0.0); put("ezBar", 400.0) },
            SettingsGroups.WARMUP to buildJsonObject { put("minutes", 600) },
        )
        assertEquals(45.0, g.plates.defaultBar, 0.0)
        assertEquals(25.0, g.plates.ezBar, 0.0)
        assertEquals("a time past the range is held at its end", 60, g.warmup.minutes)
    }

    @Test
    fun theInventoryRoundTripsPlentyAndCountsAsTheCoreSpellsThem() {
        val inventory = listOf(PlateEntry(45.0, PlatePairs.Enough, "blue"), PlateEntry(25.0, PlatePairs.Count(1.0), "green"), PlateEntry(10.0, PlatePairs.Count(0.0), "white"))
        val json = QalaJson.encodeToJsonElement(ListSerializer(PlateEntry.serializer()), inventory)
        assertEquals("\"enough\"", (json as kotlinx.serialization.json.JsonArray)[0].let { (it as JsonObject)["pairs"].toString() })
        val back = read(SettingsGroups.PLATES to buildJsonObject { put("plates", json) }).plates.plates
        assertEquals(inventory, back)
    }

    // ---- the 55 row and the pair counts ----

    @Test
    fun the55sComeInHeaviestFirstWithOnePairAndBumperRed() {
        val on = PlateSettings().with55(1.0)
        assertTrue(on.uses55)
        assertEquals(listOf(55.0, 45.0, 35.0, 25.0, 10.0, 5.0, 2.5, 1.25), on.plates.map { it.weight })
        assertEquals(PlatePairs.Count(1.0), on.pairsOf(55.0))
        assertEquals("red", on.plates.first().color)
        assertEquals("the rest of the inventory is untouched", DefaultLbPlates, on.plates.drop(1))
    }

    @Test
    fun the55sKeepTheirColourAndHaveASingleRowWhenTheCountMoves() {
        val custom = PlateSettings(plates = listOf(PlateEntry(55.0, PlatePairs.Count(1.0), "black")) + DefaultLbPlates)
        val more = custom.with55(3.0)
        assertEquals(1, more.plates.count { it.weight == 55.0 })
        assertEquals(PlatePairs.Count(3.0), more.pairsOf(55.0))
        assertEquals("black", more.plates.first().color)
    }

    @Test
    fun switchingThe55sOffDropsTheRowAndNothingElse() {
        val off = PlateSettings().with55(2.0).with55(null)
        assertFalse(off.uses55)
        assertNull(off.pairsOf(55.0))
        assertEquals(DefaultLbPlates, off.plates)
    }

    @Test
    fun aPairCountChangesOnlyItsOwnRowAndAWeightWithNoRowIsLeftAlone() {
        val none = PlateSettings().withPairs(10.0, PlatePairs.Count(0.0))
        assertEquals(PlatePairs.Count(0.0), none.pairsOf(10.0))
        assertEquals(PlatePairs.Enough, none.pairsOf(45.0))
        assertEquals(none, none.withPairs(99.0, PlatePairs.Count(4.0)))
    }

    // ---- equipment ----

    @Test
    fun eachPieceOfEquipmentFlipsAloneAndOwnsReadsItBack() {
        for (item in EquipmentItem.entries) {
            val flipped = OwnedEquipment().with(item, !OwnedEquipment().owns(item))
            assertEquals("$item reads back flipped", !OwnedEquipment().owns(item), flipped.owns(item))
            for (other in EquipmentItem.entries - item) assertEquals("$other is untouched", OwnedEquipment().owns(other), flipped.owns(other))
        }
        assertEquals(listOf("foamRoller", "percussion", "bike", "rower", "treadmill"), EquipmentItem.entries.map { it.leaf })
    }
}
