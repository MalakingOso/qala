package com.qala.app.workout

import com.qala.data.core.PlatePairs
import com.qala.data.model.PlateSettings
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The plate hints through the host build of the Rust plate math, on the default pounds inventory and the 45 lb bar. */
class PlateHintsTest {
    @Test
    fun aTwoFortyFiveSetOnTheBarIsTwoFortyFivesAndATen() {
        val hint = PlateMath.hint(245.0)!!
        assertEquals(listOf(45.0, 45.0, 10.0), hint.perSide)
        assertEquals("per side 45 · 45 · 10", hint.shorthand)
        assertEquals(245.0, hint.total, 0.0)
    }

    @Test
    fun theBarAloneAndAFortyFiveAreTheirOwnWords() {
        assertEquals("bar", PlateMath.hint(45.0)!!.shorthand)
        assertEquals(emptyList<Double>(), PlateMath.hint(45.0)!!.perSide)
        assertEquals("per side 45", PlateMath.hint(135.0)!!.shorthand)
    }

    @Test
    fun aWeightThePlatesCannotMakeShowsWhatTheyDoMake() {
        val hint = PlateMath.hint(207.5)!!
        assertTrue("207.5 is between two loads: ${hint.total}", hint.total != 207.5)
        assertEquals("a tie goes to the lighter load", 205.0, hint.total, 0.0)
        assertEquals("per side 45 · 35 · loads 205", plateLine(207.5, hint))
        assertEquals("a weight that loads is just its plates", "per side 45 · 45 · 10", plateLine(245.0, PlateMath.hint(245.0)!!))
    }

    @Test
    fun theLoadsNoteIsThereOnlyWhenThePlatesFallShort() {
        assertEquals("loads 205", plateLoadsNote(207.5, 205.0))
        assertEquals("loads 197.5", plateLoadsNote(200.0, 197.5))
        assertEquals(null, plateLoadsNote(205.0, 205.0))
        assertEquals("a bodyweight set, or no answer yet, has nothing to say", null, plateLoadsNote(null, 205.0))
        assertEquals(null, plateLoadsNote(207.5, null))
    }

    @Test
    fun theChangeBetweenSetsNamesWhatToTakeOffAndPutOn() {
        val now = PlateMath.hint(245.0)!!.perSide
        assertEquals("no change", PlateMath.change(now, 245.0)!!.instruction)
        val heavier = PlateMath.change(now, 255.0)!!
        assertTrue(heavier.instruction, heavier.instruction.contains("add") && heavier.instruction.endsWith("each side"))
        assertEquals(255.0, heavier.load.total, 0.0)
        val lighter = PlateMath.change(now, 235.0)!!
        assertTrue(lighter.instruction, lighter.instruction.contains("take off"))
        assertEquals(235.0, lighter.load.total, 0.0)
    }

    @Test
    fun theChangeReadsAsASentence() {
        assertEquals("Same as last set, leave the plates on.", plateChangeLine("no change"))
        assertEquals("Take off 5, add 25 each side.", plateChangeLine("take off 5, add 25 each side"))
    }

    @Test
    fun hintsAreForPoundsOnABarbellOnly() {
        assertTrue(PlateMath.applies(WeightUnit.Lb, barbell = true))
        assertFalse(PlateMath.applies(WeightUnit.Kg, barbell = true))
        assertFalse(PlateMath.applies(WeightUnit.Lb, barbell = false))
        assertNotNull(PlateMath.hint(100.0))
    }

    // ---- the hints read the saved bar and inventory ----

    @Test
    fun withNoTensTheHintUsesFivesAndStillAddsUp() {
        val no10s = PlateSettings().withPairs(10.0, PlatePairs.Count(0.0))
        val hint = PlateMath.hint(245.0, no10s)!!
        assertEquals(listOf(45.0, 45.0, 5.0, 5.0), hint.perSide)
        assertEquals("per side 45 · 45 · 5 · 5", hint.shorthand)
        assertEquals(245.0, hint.total, 0.0)
        assertEquals("the same weight on the default inventory is unchanged", "per side 45 · 45 · 10", PlateMath.hint(245.0)!!.shorthand)
    }

    @Test
    fun aPairOfFiftyFivesShowsUpInTheHintOnceTheyAreOn() {
        val hint = PlateMath.hint(245.0, PlateSettings().with55(1.0))!!
        assertEquals("per side 55 · 45", hint.shorthand)
        assertEquals(245.0, hint.total, 0.0)
    }

    @Test
    fun theLighterBarChangesWhatGoesOnForTheSameWeight() {
        val lighter = PlateSettings(defaultBar = 35.0)
        val hint = PlateMath.hint(245.0, lighter)!!
        assertEquals("a 35 lb bar leaves 105 a side", 105.0, hint.perSide.sum(), 0.0)
        assertEquals(245.0, hint.total, 0.0)
        assertEquals("the bare 35 lb bar is just the bar", "bar", PlateMath.hint(35.0, lighter)!!.shorthand)
        assertEquals(emptyList<Double>(), PlateMath.hint(35.0, lighter)!!.perSide)
        assertEquals("on the 45 lb bar a 35 lb set has nothing to put on it", "bar", PlateMath.hint(35.0)!!.shorthand)
    }

    @Test
    fun theChangeBetweenSetsUsesTheSavedInventoryToo() {
        val no10s = PlateSettings().withPairs(10.0, PlatePairs.Count(0.0))
        val now = PlateMath.hint(245.0, no10s)!!.perSide
        val next = PlateMath.change(now, 255.0, no10s)!!
        assertEquals(255.0, next.load.total, 0.0)
        assertTrue("no 10s to put on: ${next.load.perSide}", 10.0 !in next.load.perSide)
        assertTrue(next.instruction, next.instruction.contains("add"))
    }

    // ---- show plates ----

    private val hints = mapOf(245.0 to PlateMath.hint(245.0)!!, 207.5 to PlateMath.hint(207.5)!!)

    @Test
    fun aSetRowShowsItsPlatesOnlyWhenPlatesAreOnAndTheLiftHasAnyAndTheMathHasAnswered() {
        assertEquals("per side 45 · 45 · 10", setPlateLine(show = true, barbell = true, weight = 245.0, hints = hints))
        assertEquals("per side 45 · 35 · loads 205", setPlateLine(true, true, 207.5, hints))
        assertNull("off in Settings", setPlateLine(show = false, barbell = true, weight = 245.0, hints = hints))
        assertNull("a dumbbell or a cable has no plates", setPlateLine(true, barbell = false, weight = 245.0, hints = hints))
        assertNull("a bodyweight set has no weight", setPlateLine(true, true, null, hints))
        assertNull("no answer for this weight yet", setPlateLine(true, true, 300.0, hints))
    }

    private val rest = RestState(
        logged = SetRef(0, 0), next = SetRef(0, 1), startedAtMs = 0L, seconds = 180, rows = emptyList(),
        perSide = listOf(45.0, 45.0, 10.0), plateInstruction = "take off 5, add 25 each side", plateTotal = 245.0,
    )
    private val next = RestNext("Squat", newExercise = false, setNumber = 2, setCount = 5, weight = 245.0, unit = WeightUnit.Lb, reps = "3", sameWeight = false)

    @Test
    fun restSaysWhatGoesOnEachSideAndHowToGetThereWhenPlatesAreOn() {
        val view = restPlatesView(show = true, rest = rest, next = next)!!
        assertEquals(listOf(45.0, 45.0, 10.0), view.perSide)
        assertNull("245 loads exactly", view.loadsNote)
        assertEquals("Take off 5, add 25 each side.", view.changeLine)
        assertEquals("loads 205", restPlatesView(true, rest.copy(plateTotal = 205.0), next.copy(weight = 207.5))!!.loadsNote)
        val same = restPlatesView(true, rest.copy(plateInstruction = null), next.copy(sameWeight = true))!!
        assertEquals("Same as last set, leave the plates on.", same.changeLine)
        assertNull("another weight with no instruction has nothing to say", restPlatesView(true, rest.copy(plateInstruction = null), next)!!.changeLine)
    }

    @Test
    fun restHidesEveryPlateLineWhenPlatesAreOff() {
        assertNull(restPlatesView(show = false, rest = rest, next = next))
        assertNull(restPlatesView(show = false, rest = rest.copy(plateInstruction = null), next = next.copy(sameWeight = true)))
    }
}
