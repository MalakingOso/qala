package com.qala.data.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The plate DTOs through the real Rust library (the host build): the cases are
 * the golden vectors from packages/core/plates_test.ts, so this proves the
 * Kotlin shapes against the same answers as the Rust port.
 */
class QalaCorePlatesTest {
    @Test
    fun twoFortyFiveOnA45Bar() {
        val plan = QalaCore.planPlates(245.0, 45.0, DefaultLbPlates)
        assertEquals(listOf(45.0, 45.0, 10.0), plan.exact?.perSide)
        assertEquals(245.0, plan.exact?.total ?: 0.0, 0.0)
        assertEquals("per side 45 · 45 · 10", QalaCore.platesShorthand(listOf(45.0, 45.0, 10.0)))
        assertEquals(245.0, QalaCore.roundWeight(243.0, 45.0, DefaultLbPlates), 0.0)
        assertEquals(240.0, QalaCore.roundWeight(242.0, 45.0, DefaultLbPlates), 0.0)
    }

    @Test
    fun onePairOf45sStillSolvesExactly() {
        // The TS case: one pair of 45s, everything else plenty (1.25s included).
        val plates = DefaultLbPlates.map {
            when (it.weight) {
                45.0 -> it.copy(pairs = PlatePairs.Count(1.0))
                1.25 -> it.copy(pairs = PlatePairs.Enough)
                else -> it
            }
        }
        val plan = QalaCore.planPlates(245.0, 45.0, plates)
        assertEquals(listOf(45.0, 35.0, 10.0, 10.0), plan.exact?.perSide)
    }

    @Test
    fun unreachableTargetsGiveNeighbours() {
        val only45 = listOf(PlateEntry(45.0, PlatePairs.Enough, "blue"))
        val plan = QalaCore.planPlates(200.0, 45.0, only45)
        assertNull(plan.exact)
        assertEquals(135.0, plan.below?.total ?: 0.0, 0.0)
        assertEquals(225.0, plan.above?.total ?: 0.0, 0.0)
        assertEquals(225.0, plan.nearestLoadable()?.total ?: 0.0, 0.0)
    }

    @Test
    fun changeInstructionsMatchTheGoldenWords() {
        assertEquals("take off 5, add 25 each side", QalaCore.describeChange(listOf(45.0, 5.0), listOf(45.0, 25.0)))
        assertEquals("no change", QalaCore.describeChange(listOf(45.0, 45.0, 10.0), listOf(45.0, 45.0, 10.0)))
        val next = QalaCore.chooseNextPlates(listOf(45.0, 25.0), 215.0, 45.0, DefaultLbPlates)
        assertEquals(listOf(45.0, 35.0, 5.0), next?.load?.perSide)
        assertEquals(1, next?.keptInner)
    }
}
