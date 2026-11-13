package com.qala.app.workout

import com.qala.data.core.PlatePairs
import com.qala.data.model.GymSettings
import com.qala.data.model.OwnedEquipment
import com.qala.data.model.PlateSettings
import com.qala.data.model.WarmupSettings
import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WarmupTest {
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

    // ---- the warm-up is built from Settings ----

    private fun planFrom(gym: GymSettings, vararg ex: WarmupExercise, soreness: Map<String, Int> = emptyMap(), recovery: Double? = null) =
        planWarmup(warmupInput(ex.toList(), WeightUnit.Lb, soreness, recovery, gym))

    @Test
    fun theDefaultSettingsBuildExactlyTheWarmupThatWasHardCoded() {
        assertEquals(Equipment.Owner, OwnedEquipment().toEquipment())
        val hardCoded = planWarmup(WarmupInput(listOf(squat, bench, pulldown), WeightUnit.Lb, mapOf("quads" to 4), 8.0))
        val fromSettings = planFrom(GymSettings(), squat, bench, pulldown, soreness = mapOf("quads" to 4), recovery = 8.0)
        assertEquals(hardCoded, fromSettings)
        val input = warmupInput(listOf(squat), WeightUnit.Lb, emptyMap(), null, GymSettings())
        assertEquals(15, input.budgetMin)
        assertTrue(input.preferPercussion && input.softTissue && input.enabled)
        assertEquals(45.0, input.barWeight, 0.0)
    }

    @Test
    fun withoutATheragunEveryMuscleGetsTheFoamRoller() {
        val noGun = GymSettings(equipment = OwnedEquipment(percussion = false))
        val rows = planFrom(noGun, squat, bench, pulldown).block(BlockKind.SoftTissue)!!.items
        assertEquals(listOf("Quads", "Glutes", "Chest", "Triceps"), rows.map { it.title })
        assertTrue("no Theragun rows: ${rows.map { it.detail }}", rows.none { it.tool == SoftTissueTool.Percussion })
        assertTrue(rows.all { it.tool == SoftTissueTool.FoamRoller && !it.detail.contains("Theragun") })
        assertTrue("the same day with one has Theragun rows", plan(squat, bench, pulldown).block(BlockKind.SoftTissue)!!.items.any { it.tool == SoftTissueTool.Percussion })
    }

    @Test
    fun withoutARollerOnlyTheTheragunIsLeft() {
        val noRoller = GymSettings(equipment = OwnedEquipment(foamRoller = false), warmup = WarmupSettings(preferPercussion = false))
        val rows = planFrom(noRoller, squat, bench).block(BlockKind.SoftTissue)!!.items
        assertTrue(rows.all { it.tool == SoftTissueTool.Percussion })
    }

    @Test
    fun withNeitherToolThereIsNoSoftTissue() {
        val none = GymSettings(equipment = OwnedEquipment(foamRoller = false, percussion = false))
        assertNull(planFrom(none, squat, bench).block(BlockKind.SoftTissue))
    }

    @Test
    fun softTissueOffBuildsNoSoftTissueWhateverIsOwned() {
        val off = GymSettings(warmup = WarmupSettings(softTissue = false))
        val p = planFrom(off, squat, bench)
        assertNull(p.block(BlockKind.SoftTissue))
        assertNotNull(p.block(BlockKind.General))
        assertNotNull(p.block(BlockKind.Mobility))
    }

    @Test
    fun theTheragunPreferenceFollowsTheSetting() {
        val roller = planFrom(GymSettings(warmup = WarmupSettings(preferPercussion = false)), squat, bench).block(BlockKind.SoftTissue)!!.items
        assertEquals(SoftTissueTool.FoamRoller, roller.first { it.title == "Quads" }.tool)
        val gun = planFrom(GymSettings(), squat, bench).block(BlockKind.SoftTissue)!!.items
        assertEquals(SoftTissueTool.Percussion, gun.first { it.title == "Quads" }.tool)
    }

    @Test
    fun theCardioIsTheFirstMachineOwnedInTheOrderTheSettingsListThem() {
        fun cardio(owned: OwnedEquipment) = planFrom(GymSettings(equipment = owned), squat).block(BlockKind.General)!!.items.single().title
        assertEquals("Bike, easy pace", cardio(OwnedEquipment()))
        assertEquals("Rower, easy pace", cardio(OwnedEquipment(bike = false, rower = true)))
        assertEquals("Treadmill, easy walk or jog", cardio(OwnedEquipment(bike = false, treadmill = true)))
        assertEquals("a bike beats a rower", "Bike, easy pace", cardio(OwnedEquipment(bike = true, rower = true, treadmill = true)))
        assertEquals("a rower beats a treadmill", "Rower, easy pace", cardio(OwnedEquipment(bike = false, rower = true, treadmill = true)))
        assertEquals("Brisk walk, then bodyweight squats", cardio(OwnedEquipment(bike = false)))
    }

    @Test
    fun theTimeBudgetIsTheSavedMinutes() {
        val roomy = planFrom(GymSettings(warmup = WarmupSettings(minutes = 30)), squat, bench, pulldown)
        assertNotNull(roomy.block(BlockKind.SoftTissue))
        val tight = planFrom(GymSettings(warmup = WarmupSettings(minutes = 8)), squat, bench, pulldown)
        assertEquals("cut for time", tight.blocks.first { it.kind == BlockKind.SoftTissue }.skipReason)
        assertTrue(tight.minutes <= 8)
        val tiny = planFrom(GymSettings(warmup = WarmupSettings(minutes = 5)), squat, bench, pulldown)
        assertEquals(3, tiny.block(BlockKind.General)!!.minutes)
    }

    @Test
    fun buildAWarmupOffLeavesOnlyTheRampSets() {
        val off = planFrom(GymSettings(warmup = WarmupSettings(enabled = false)), squat, bench, pulldown)
        assertEquals(listOf(BlockKind.General, BlockKind.SoftTissue, BlockKind.Mobility), off.blocks.map { it.kind })
        assertTrue(off.blocks.all { it.skipReason == OffInSettings && it.items.isEmpty() && it.minutes == 0 })
        assertNull(off.block(BlockKind.General))
        assertEquals(0, off.minutes)
        assertEquals("the ramp sets are lifting time and stay", plan(squat, bench, pulldown).ramps, off.ramps)
        assertTrue(off.ramps[0].steps.isNotEmpty())
    }

    @Test
    fun theSavedBarIsWhatALightRampStepRoundsUpTo() {
        val light = exercise("curl", "Curl", ExerciseClass.Secondary, listOf("biceps"), 60.0, 150.0)
        val on45 = planFrom(GymSettings(), light).ramps.single().steps.single()
        assertTrue(on45.bar)
        assertEquals(45.0, on45.load, 0.0)
        val on35 = planFrom(GymSettings(plates = PlateSettings(defaultBar = 35.0)), light).ramps.single().steps.single()
        assertTrue(on35.bar)
        assertEquals(35.0, on35.load, 0.0)
        assertEquals(35.0, warmupInput(listOf(light), WeightUnit.Lb, emptyMap(), null, GymSettings(plates = PlateSettings(defaultBar = 35.0))).barWeight, 0.0)
        assertEquals("kilograms keep the 20 kg bar", 20.0, defaultBarWeight(WeightUnit.Kg, PlateSettings(defaultBar = 35.0)), 0.0)
    }

    @Test
    fun theRampRoundsOnTheSavedInventory() {
        val heavy = squat.copy(weight = 160.0)
        val default = planFrom(GymSettings(), heavy).ramps[0].steps.map { it.load }
        val no2_5 = PlateSettings().withPairs(2.5, PlatePairs.Count(0.0))
        val custom = planFrom(GymSettings(plates = no2_5), heavy).ramps[0].steps.map { it.load }
        assertEquals(70.0, default[0], 0.0)
        assertEquals("without 2.5s the loads step by 10, so 72 goes to 75", 75.0, custom[0], 0.0)
    }
}
