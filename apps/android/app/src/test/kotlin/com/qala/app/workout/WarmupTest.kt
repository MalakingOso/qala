package com.qala.app.workout

import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WarmupTest {
    private fun ramp(weight: Double, reference: Double?, reps: Double = 5.0, unit: WeightUnit = WeightUnit.Lb, isolation: Boolean = false, first: Boolean = true, trained: Boolean = false, extra: Boolean = false) =
        rampSets(RampInput(weight, intensityOf(weight, reference, reps), isolation, first, trained, extra), unit)

    private fun loads(steps: List<RampStep>) = steps.map { it.load }

    // ---- rounding ----

    @Test
    fun poundsOnABarRoundThroughTheRustPlateMathWithTiesGoingBelow() {
        assertEquals(100.0, roundLoadable(101.25, WeightUnit.Lb), 0.0)
        assertEquals("a tie goes to the lighter load", 120.0, roundLoadable(122.5, WeightUnit.Lb), 0.0)
        assertEquals(65.0, roundLoadable(67.5, WeightUnit.Lb), 0.0)
        assertEquals(70.0, roundLoadable(68.0, WeightUnit.Lb), 0.0)
        assertEquals("never under the bar", 45.0, roundLoadable(30.0, WeightUnit.Lb), 0.0)
        assertEquals("a different bar is a parameter, not a constant", 35.0, roundLoadable(20.0, WeightUnit.Lb, barWeight = 35.0), 0.0)
        assertEquals(215.0, roundLoadable(213.0, WeightUnit.Lb), 0.0)
    }

    @Test
    fun kilogramsAndLiftsWithNoBarStayOnThePlaceholder() {
        assertEquals(42.5, roundLoadable(42.4, WeightUnit.Kg), 0.0)
        assertEquals(20.0, roundLoadable(8.0, WeightUnit.Kg), 0.0)
        assertEquals("the placeholder rounds halves up", 70.0, roundLoadable(67.5, WeightUnit.Lb, barWeight = 0.0), 0.0)
        assertEquals(40.0, roundLoadable(40.0, WeightUnit.Lb, barWeight = 0.0), 0.0)
        assertEquals(45.0, defaultBarWeight(WeightUnit.Lb), 0.0)
        assertEquals(20.0, defaultBarWeight(WeightUnit.Kg), 0.0)
    }

    // ---- ramp sets: the worked examples of the research file ----

    @Test
    fun aStrengthSquatOf225At265RampsToOneHundredOneFortyFiveAndOneNinety() {
        val steps = ramp(225.0, 265.0)
        assertEquals(listOf(100.0, 145.0, 190.0), loads(steps))
        assertEquals(listOf(6, 4, 2), steps.map { it.reps })
        assertEquals(listOf(45, 60, 90), steps.map { it.restSec })
    }

    @Test
    fun aBenchOf240At250GetsTheFullFiveStepRamp() {
        val steps = ramp(240.0, 250.0, reps = 1.0)
        assertEquals(listOf(95.0, 130.0, 170.0, 195.0, 220.0), loads(steps))
        assertEquals(listOf(5, 3, 2, 1, 1), steps.map { it.reps })
        assertEquals(listOf(45, 60, 90, 120, 120), steps.map { it.restSec })
    }

    @Test
    fun anOverheadPressOf95At125StartsWithTheBar() {
        val steps = ramp(95.0, 125.0, reps = 8.0)
        assertEquals(listOf(45.0, 60.0, 80.0), loads(steps))
        assertTrue(steps[0].bar)
        assertEquals(8, steps[0].reps)
        assertEquals(listOf(8, 4, 2), steps.map { it.reps })
        assertFalse(steps[1].bar)
    }

    @Test
    fun aLightLiftNeedsNoRampUnlessItIsTheFirstForItsMuscle() {
        assertEquals(emptyList<RampStep>(), ramp(80.0, 200.0, first = false))
        val one = ramp(80.0, 200.0, first = true).single()
        assertEquals("half of 80 is under the bar, so it is the bar", RampStep(45.0, 10, 45, bar = true), one)
        assertEquals(listOf(RampStep(80.0, 10, 45)), ramp(160.0, 400.0, first = true))
    }

    @Test
    fun anIsolationLiftIsNeverRampedHeavy() {
        val one = ramp(150.0, 160.0, isolation = true)
        assertEquals(1, one.size)
        assertEquals(10, one.single().reps)
    }

    @Test
    fun aSecondLiftOnMusclesAlreadyWarmGetsOneSetAtEightyPercent() {
        val one = ramp(150.0, 200.0, trained = true)
        assertEquals(listOf(120.0), loads(one))
        assertEquals(4, one.single().reps)
    }

    @Test
    fun soreMusclesOrALowRecoveryInsertAnExtraStepBetweenTheFirstTwo() {
        val plain = ramp(225.0, 265.0)
        val extra = ramp(225.0, 265.0, extra = true)
        assertEquals("the mean of 100 and 145 is 122.5, a tie, so the lighter 120", listOf(100.0, 120.0, 145.0, 190.0), loads(extra))
        assertEquals(5, extra[1].reps)
        assertTrue(extra[1].extra)
        assertEquals(plain.size + 1, extra.size)
    }

    @Test
    fun withNoOneRepMaxTheIntensityComesFromTheReps() {
        assertEquals(1.0 / (1 + 5 / 30.0), intensityOf(225.0, null, 5.0), 1e-9)
        assertEquals(225.0 / 265.0, intensityOf(225.0, 265.0, 5.0), 1e-9)
        assertEquals("a zero 1RM is no 1RM", 1.0 / (1 + 5 / 30.0), intensityOf(225.0, 0.0, 5.0), 1e-9)
    }

    @Test
    fun aStepEqualToTheOneBeforeItOrToTheWorkingWeightIsDropped() {
        // 50 lb at T4: 40% = 20 (bar), 55% = 27.5 (bar, merged), 70% = 35 (bar, merged), 82% = 41 (bar), 91% = 45.5 -> 45 = work weight 50? no, 45 < 50.
        val steps = ramp(50.0, 52.0, reps = 1.0)
        assertEquals(listOf(45.0), loads(steps))
        assertTrue(steps.single().bar)
    }

    @Test
    fun kilogramRampsRoundToTheKilogramPlatesAndStartFromTwentyKilos() {
        val steps = ramp(100.0, 120.0, unit = WeightUnit.Kg)
        assertEquals(listOf(45.0, 65.0, 85.0), loads(steps))
        val light = ramp(40.0, 50.0, unit = WeightUnit.Kg)
        assertTrue(light.first().bar)
        assertEquals(20.0, light.first().load, 0.0)
    }

    // ---- the plan ----

    private fun exercise(id: String, name: String, cls: ExerciseClass, muscles: List<String>, weight: Double?, reference: Double?, reps: Double = 3.0, barbell: Boolean = true) =
        WarmupExercise(id, name, cls, muscles, weight, reps, "$reps".removeSuffix(".0"), reference, barbell)

    private val squat = exercise("squat", "Squat", ExerciseClass.Main, listOf("quads", "glutes"), 150.0, 200.0)
    private val bench = exercise("benchPress", "Bench Press", ExerciseClass.Main, listOf("chest", "triceps"), 100.0, 150.0, reps = 10.0)
    private val pulldown = exercise("latPulldown", "Lat Pulldown", ExerciseClass.Isolation, listOf("lats"), 80.0, null, reps = 15.0, barbell = false)

    private fun plan(vararg ex: WarmupExercise, soreness: Map<String, Int> = emptyMap(), recovery: Double? = null, budget: Int = 15, equipment: Equipment = Equipment.Owner) =
        planWarmup(WarmupInput(ex.toList(), WeightUnit.Lb, soreness, recovery, equipment, budgetMin = budget))

    @Test
    fun aDayHasEasyCardioSoftTissueMobilityAndARampPerExercise() {
        val p = plan(squat, bench, pulldown)
        assertEquals(listOf(BlockKind.General, BlockKind.SoftTissue, BlockKind.Mobility), p.blocks.map { it.kind })
        assertEquals(listOf("Squat", "Bench Press", "Lat Pulldown"), p.ramps.map { it.name })
        assertFalse("150 of 200 is 75%, not heavy", p.heavy)
        assertEquals("5 min of bike", 5, p.block(BlockKind.General)!!.minutes)
        assertEquals("Bike, easy pace", p.block(BlockKind.General)!!.items.single().title)
        assertTrue(p.minutes <= 15)
    }

    @Test
    fun aHeavyTopSetLengthensTheCardioAndSaysWhy() {
        val heavy = squat.copy(weight = 180.0)
        val p = plan(heavy, bench)
        assertTrue(p.heavy)
        assertEquals(10, p.block(BlockKind.General)!!.minutes)
        assertTrue(p.block(BlockKind.General)!!.items.single().detail.contains("90% of your max"))
    }

    @Test
    fun softTissueGoesToTheMusclesOfTheFirstTwoLiftsWithTheOwnersTools() {
        val rows = plan(squat, bench, pulldown).block(BlockKind.SoftTissue)!!.items
        assertEquals(listOf("Quads", "Glutes", "Chest", "Triceps"), rows.map { it.title })
        assertEquals("the owner prefers the Theragun, and it is allowed on all four", listOf(SoftTissueTool.Percussion, SoftTissueTool.Percussion, SoftTissueTool.Percussion, SoftTissueTool.Percussion), rows.map { it.tool })
        assertTrue(rows.all { it.detail.contains("Theragun") })
    }

    @Test
    fun aSoreMuscleGetsTheRollerForTwoMinutesAndNeverTheTheragun() {
        val p = plan(squat, bench, soreness = mapOf("quads" to 4))
        val quads = p.block(BlockKind.SoftTissue)!!.items.first { it.title == "Quads" }
        assertEquals(SoftTissueTool.FoamRoller, quads.tool)
        assertEquals("Foam roller · 2:00 a side · sore (4)*", quads.detail)
    }

    @Test
    fun withoutAPreferenceTheRollerDoesTheWork() {
        val p = planWarmup(WarmupInput(listOf(squat, bench), WeightUnit.Lb, preferPercussion = false))
        val rows = p.block(BlockKind.SoftTissue)!!.items
        assertEquals(SoftTissueTool.FoamRoller, rows.first { it.title == "Quads" }.tool)
        assertEquals("the chest is never rolled", SoftTissueTool.Percussion, rows.first { it.title == "Chest" }.tool)
    }

    @Test
    fun noToolsMeansNoSoftTissueBlock() {
        val p = plan(squat, bench, equipment = Equipment(foamRoller = false, percussion = false, cardio = null))
        assertNull(p.block(BlockKind.SoftTissue))
        assertEquals("Brisk walk, then bodyweight squats", p.block(BlockKind.General)!!.items.single().title)
    }

    @Test
    fun mobilityIsTwoDrillsForUpToThreeMuscleGroups() {
        val p = plan(squat, bench, pulldown)
        val mobility = p.block(BlockKind.Mobility)!!
        assertEquals(3, mobility.minutes)
        assertEquals(listOf("Bodyweight squats", "Walking lunges", "Incline push-ups", "Scapular push-ups", "Band pull-aparts", "Scapular pulls"), mobility.items.map { it.title })
    }

    @Test
    fun overTheBudgetTheSoftTissueIsCutFirstThenTheMobilityThenTheCardio() {
        val tight = plan(squat, bench, pulldown, budget = 8)
        assertEquals("cut for time", tight.blocks.first { it.kind == BlockKind.SoftTissue }.skipReason)
        assertNull(tight.block(BlockKind.SoftTissue))
        assertTrue(tight.minutes <= 8)

        val tighter = plan(squat, bench, pulldown, budget = 5)
        assertEquals(1, tighter.block(BlockKind.Mobility)!!.items.size)
        assertEquals(3, tighter.block(BlockKind.General)!!.minutes)
        assertEquals("the ramp sets are never cut", 3, tighter.ramps.size)
        assertNotNull(tighter.ramps.first().steps.firstOrNull())
    }

    @Test
    fun theRampsComeFromEachExercisesOwnWorkingWeight() {
        val p = plan(squat, bench, pulldown)
        val squatRamp = p.ramps[0].steps
        // 150 of a 200 max is 75%: tier 2 (45%, 65%, 85%) is 67.5, 97.5 and 127.5, each a tie that rounds down to a loadable weight.
        assertEquals(listOf(65.0, 95.0, 125.0), squatRamp.map { it.load })
        assertEquals(150.0, p.ramps[0].workWeight!!, 0.0)
        assertEquals("3", p.ramps[0].workReps)
        assertEquals(listOf(true, true, false), p.ramps.map { it.barbell })
        // The bench shares no muscle with the squat, and 100 of 150 is 67%: tier 1.
        assertEquals(listOf(50.0, 80.0), p.ramps[1].steps.map { it.load })
        // The pulldown is an isolation lift on a new muscle: one easy set, with no bar to round up to.
        assertEquals(listOf(40.0), p.ramps[2].steps.map { it.load })
        assertFalse(p.ramps[2].steps.single().bar)
    }

    @Test
    fun aBodyweightExerciseHasNoRamp() {
        val dips = exercise("chestDip", "Chest Dip", ExerciseClass.Secondary, listOf("chest", "triceps"), null, null, reps = 8.0)
        val p = plan(squat, dips)
        assertTrue(p.ramps[1].steps.isEmpty())
        assertNull(p.ramps[1].workWeight)
    }

    @Test
    fun aLowRecoveryScoreAddsTheExtraRampStep() {
        val normal = plan(squat, recovery = 8.0).ramps[0].steps
        val low = plan(squat, recovery = 4.0).ramps[0].steps
        assertEquals(normal.size + 1, low.size)
        assertTrue(low[1].extra)
    }
}
