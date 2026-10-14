package com.qala.app.settings

import com.qala.data.core.PlatePairs
import com.qala.data.model.EquipmentItem
import com.qala.data.model.OwnedEquipment
import com.qala.data.model.PlateSettings
import com.qala.data.model.SkipReason
import com.qala.data.model.WarmupSettings
import com.qala.data.model.WeightUnit
import com.qala.data.today.DayStatus
import com.qala.data.today.StatusSpan
import com.qala.design.QalaGear
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsModelTest {
    // ---- training status ----

    private fun range(reason: SkipReason, until: String?, muscle: String? = null, shifts: Boolean = false) =
        DayStatus(reason, StatusSpan.Range("2026-10-01", until), muscle, shifts = shifts)

    @Test
    fun withNothingOnTodayTheStatusIsActiveAndTrainingAsUsual() {
        val line = statusLine(null)
        assertEquals("Active.", line.text)
        assertEquals("training as usual", line.hint)
        assertNull(line.reason)
        assertFalse("nothing to set active", line.set)
    }

    @Test
    fun aSpanSaysWhatItIsAndUntilWhenAndWhetherThePlanShifts() {
        val sick = statusLine(range(SkipReason.Sick, "2026-10-09", shifts = true))
        assertEquals("Sick until Oct 9.", sick.text)
        assertEquals("plan shifts", sick.hint)
        assertEquals(SkipReason.Sick, sick.reason)
        assertTrue(sick.set)

        val vacation = statusLine(range(SkipReason.Vacation, null, shifts = true))
        assertEquals("On Vacation until you say so.", vacation.text)
        assertEquals("plan shifts", vacation.hint)

        val rest = statusLine(range(SkipReason.Break, "2026-10-04"))
        assertEquals("On a Break until Oct 4.", rest.text)
        assertEquals("a break holds the plan", "plan holds", rest.hint)
        assertEquals("plan holds", statusLine(range(SkipReason.Scheduling, null)).hint)
    }

    @Test
    fun aOneDaySkipSaysToday() {
        val line = statusLine(DayStatus(SkipReason.Break, StatusSpan.OneDay))
        assertEquals("On a Break today.", line.text)
        assertEquals("plan holds", line.hint)
        assertEquals("Sick today.", statusLine(DayStatus(SkipReason.Sick, StatusSpan.OneDay, shifts = true)).text)
    }

    @Test
    fun anInjuryNamesTheMuscleAndSaysToTrainAroundIt() {
        val day = statusLine(DayStatus(SkipReason.Injured, StatusSpan.OneDay, muscle = "quads"))
        assertEquals("Injured today: Quads.", day.text)
        assertEquals("train around it", day.hint)
        val span = statusLine(range(SkipReason.Injured, "2026-10-09", muscle = "frontdelts"))
        assertEquals("Injured: Front delts until Oct 9.", span.text)
        assertEquals("train around it", span.hint)
        assertEquals("an injury never shifts the plan, whatever the flag", "train around it", statusLine(range(SkipReason.Injured, null, muscle = "quads", shifts = true)).hint)
        assertEquals("Injured until you say so.", statusLine(range(SkipReason.Injured, null)).text)
    }

    // ---- units ----

    @Test
    fun theUnitPickerIsPoundsThenKilograms() {
        assertEquals(listOf(WeightUnit.Lb, WeightUnit.Kg), UnitChoices)
        assertEquals(listOf("lb", "kg"), UnitLabels)
        assertEquals(0, UnitChoices.indexOf(WeightUnit.Lb))
    }

    @Test
    fun distanceAndPaceFollowTheWeightUnitAsTheRestOfTheAppPairsThem() {
        assertEquals("mi · min/mi", distanceAndPace(WeightUnit.Lb))
        assertEquals("km · min/km", distanceAndPace(WeightUnit.Kg))
    }

    @Test
    fun kilogramsSayThatPlatesStayInPounds() {
        assertNull(kilogramPlatesNote(WeightUnit.Lb))
        assertEquals("Bars and plates are in pounds. Plate hints are off while the unit is kg.", kilogramPlatesNote(WeightUnit.Kg))
    }

    // ---- bars ----

    @Test
    fun theDefaultBarIsAPickBetween45And35() {
        assertEquals(listOf("45 lb", "35 lb"), DefaultBarLabels)
        assertEquals(0, defaultBarIndex(45.0))
        assertEquals(1, defaultBarIndex(35.0))
        assertNull("a bar the picker does not offer picks nothing", defaultBarIndex(40.0))
    }

    @Test
    fun theCurlBarStepsByTwoAndAHalfInsideItsRange() {
        assertEquals(27.5, stepEzBar(25.0, 1), 0.0)
        assertEquals(22.5, stepEzBar(25.0, -1), 0.0)
        assertEquals(10.0, stepEzBar(10.0, -1), 0.0)
        assertEquals(45.0, stepEzBar(45.0, 1), 0.0)
        assertTrue(canStepEzBar(25.0, -1) && canStepEzBar(25.0, 1))
        assertFalse(canStepEzBar(10.0, -1))
        assertFalse(canStepEzBar(45.0, 1))
        assertEquals("25 lb", barText(25.0))
        assertEquals("22.5 lb", barText(22.5))
    }

    // ---- plates ----

    @Test
    fun aPairCountStepsByOneFromNothingUpToTwelveAndThenToPlenty() {
        assertEquals(PlatePairs.Count(3.0), stepPairs(PlatePairs.Count(2.0), 1))
        assertEquals(PlatePairs.Count(1.0), stepPairs(PlatePairs.Count(2.0), -1))
        assertEquals("nothing is the floor", PlatePairs.Count(0.0), stepPairs(PlatePairs.Count(0.0), -1))
        assertEquals(PlatePairs.Count(12.0), stepPairs(PlatePairs.Count(11.0), 1))
        assertEquals("past twelve is plenty", PlatePairs.Enough, stepPairs(PlatePairs.Count(12.0), 1))
        assertEquals("and back down from plenty", PlatePairs.Count(12.0), stepPairs(PlatePairs.Enough, -1))
        assertEquals(PlatePairs.Enough, stepPairs(PlatePairs.Enough, 1))
        assertEquals("a half pair from another device steps from its floor", PlatePairs.Count(2.0), stepPairs(PlatePairs.Count(1.5), 1))
    }

    @Test
    fun theSteppersKnowWhereTheyStop() {
        assertFalse(canStepPairs(PlatePairs.Count(0.0), -1))
        assertTrue(canStepPairs(PlatePairs.Count(0.0), 1))
        assertTrue(canStepPairs(PlatePairs.Enough, -1))
        assertFalse(canStepPairs(PlatePairs.Enough, 1))
        assertTrue(canStepPairs(PlatePairs.Count(12.0), 1))
    }

    @Test
    fun theInventoryRowsAreTheDefaultPlatesWithoutThe55s() {
        val rows = plateRows(PlateSettings())
        assertEquals(listOf(45.0, 35.0, 25.0, 10.0, 5.0, 2.5, 1.25), rows.map { it.weight })
        assertEquals(listOf("45 lb", "35 lb", "25 lb", "10 lb", "5 lb", "2.5 lb", "1.25 lb"), rows.map { it.label })
        assertEquals("the 1.25s start at none", PlatePairs.Count(0.0), rows.last().pairs)
        assertFalse(rows.last().canLess)
        assertTrue(rows.last().canMore)
        assertTrue(rows.first().canLess)
        assertFalse("plenty has nowhere to go up", rows.first().canMore)
        assertTrue("the 55s have a row of their own", plateRows(PlateSettings().with55(2.0)).none { it.weight == 55.0 })
    }

    @Test
    fun steppingARowChangesThatPlateAndNothingElse() {
        val none10 = PlateSettings().stepped(10.0, -1)
        assertEquals("plenty steps down to twelve", PlatePairs.Count(12.0), none10.pairsOf(10.0))
        assertEquals(PlatePairs.Count(1.0), PlateSettings().stepped(1.25, 1).pairsOf(1.25))
        assertEquals(PlateSettings().plates.filter { it.weight != 10.0 }, none10.plates.filter { it.weight != 10.0 })
        assertEquals("a weight with no row is left alone", PlateSettings(), PlateSettings().stepped(99.0, 1))
    }

    @Test
    fun theFiftyFivesAreOffUntilSwitchedOnThenStepFromOnePair() {
        val off = PlateSettings()
        assertNull(pairs55(off))
        assertEquals("off for now", text55(off))
        assertFalse(canStep55(off, 1))
        assertEquals("a stepper on the 55s while they are off does nothing", off, off.stepped55(1))

        val on = off.with55(1.0)
        assertEquals(1.0, pairs55(on)!!, 0.0)
        assertEquals("1 pair", text55(on))
        assertFalse("one pair is the least: fewer is switching them off", canStep55(on, -1))
        assertEquals(on, on.stepped55(-1))
        assertTrue(canStep55(on, 1))
        val two = on.stepped55(1)
        assertEquals(2.0, pairs55(two)!!, 0.0)
        assertEquals("2 pairs", text55(two))
        assertEquals(1, two.plates.count { it.weight == 55.0 })
        assertEquals(12.0, pairs55(on.with55(12.0).stepped55(1))!!, 0.0)
        assertFalse("there is no plenty of 55s", canStep55(on.with55(12.0), 1))
    }

    // ---- equipment ----

    @Test
    fun theEquipmentRowsAreTheWebsFiveInTheWebsOrderWithTheOwnersRenders() {
        assertEquals(listOf("Foam roller", "Theragun", "Bike", "Rower", "Treadmill"), EquipmentRows.map { it.label })
        assertEquals(listOf(EquipmentItem.FoamRoller, EquipmentItem.Percussion, EquipmentItem.Bike, EquipmentItem.Rower, EquipmentItem.Treadmill), EquipmentRows.map { it.item })
        assertEquals(listOf(QalaGear.Roller, QalaGear.Theragun, null, null, QalaGear.Treadmill), EquipmentRows.map { it.gear })
        assertEquals("every item has a row", EquipmentItem.entries.toSet(), EquipmentRows.map { it.item }.toSet())
    }

    // ---- warm-up ----

    @Test
    fun withTheWarmupOnEveryRowCountsExceptTheTheragunPreferenceWhenThereIsNoTheragun() {
        val all = warmupRows(WarmupSettings(), OwnedEquipment())
        assertEquals(WarmupRows(softTissue = true, preferPercussion = true, time = true), all)
        val noGun = warmupRows(WarmupSettings(), OwnedEquipment(percussion = false))
        assertEquals(WarmupRows(softTissue = true, preferPercussion = false, time = true), noGun)
    }

    @Test
    fun theTheragunPreferenceMeansNothingWithoutSoftTissue() {
        assertEquals(WarmupRows(softTissue = true, preferPercussion = false, time = true), warmupRows(WarmupSettings(softTissue = false), OwnedEquipment()))
    }

    @Test
    fun withTheWarmupOffNothingBelowItDoesAnything() {
        assertEquals(WarmupRows(softTissue = false, preferPercussion = false, time = false), warmupRows(WarmupSettings(enabled = false), OwnedEquipment()))
    }

    @Test
    fun theWarmupTimeStepsByFiveBetweenFiveAndThirty() {
        assertEquals(20, stepWarmupMinutes(15, 1))
        assertEquals(10, stepWarmupMinutes(15, -1))
        assertEquals(5, stepWarmupMinutes(5, -1))
        assertEquals(30, stepWarmupMinutes(30, 1))
        assertEquals("a stored 12 goes to the next five", 15, stepWarmupMinutes(12, 1))
        assertEquals(10, stepWarmupMinutes(12, -1))
        assertEquals("a stored 3 starts the scale", 5, stepWarmupMinutes(3, 1))
        assertEquals(30, stepWarmupMinutes(60, -1))
        assertTrue(canStepWarmupMinutes(15, -1) && canStepWarmupMinutes(15, 1))
        assertFalse(canStepWarmupMinutes(5, -1))
        assertFalse(canStepWarmupMinutes(30, 1))
        assertEquals("15 min", minutesText(15))
    }
}
