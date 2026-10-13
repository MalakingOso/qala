package com.qala.app.workout

import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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
}
