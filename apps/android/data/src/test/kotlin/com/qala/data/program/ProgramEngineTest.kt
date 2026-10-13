package com.qala.data.program

import com.qala.data.TestRepo
import com.qala.data.core.QalaCore
import com.qala.data.core.dayName
import com.qala.data.model.SettingsRecord
import com.qala.data.model.WeightUnit
import com.qala.data.seed.GzclpProgram
import com.qala.data.seed.SeedOneRepMax
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** LS++ evaluation through the host library, against the GZCLP program the seed uses. */
class ProgramEngineTest {
    private val engine = ProgramEngine()
    private val gzclp = engine.evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)

    @Test
    fun theEmbeddedTextIsTheGoldenText() {
        val doc = TestRepo.json("testdata/golden/liftoscript/builtins/gzclp.json").jsonObject
        val case = doc.getValue("cases").jsonArray.map { it.jsonObject }.first { it.getValue("fn").jsonPrimitive.content == "forceEvaluateText" }
        assertEquals(case.getValue("inputs").jsonObject.getValue("programText").jsonPrimitive.content, GzclpProgram.TEXT)
        assertEquals("gzclp.md", case.getValue("inputs").jsonObject.getValue("name").jsonPrimitive.content)
    }

    @Test
    fun gzclpRotatesOverFourDays() {
        assertEquals(4, gzclp.dayCount)
        assertEquals(emptyList<Any>(), gzclp.program.getValue("errors").jsonArray.toList())
    }

    @Test
    fun eachDayUsesItsThreeTiers() {
        fun ids(day: Int) = engine.usedExercises(gzclp, day).map { it.exerciseId }
        assertEquals(listOf("squat", "benchPress", "latPulldown"), ids(1))
        assertEquals(listOf("overheadPress", "deadlift", "bentOverRow"), ids(2))
        assertEquals(listOf("benchPress", "squat", "latPulldown"), ids(3))
        assertEquals(listOf("deadlift", "overheadPress", "bentOverRow"), ids(4))
        assertEquals(listOf(0, 1, 2), engine.usedExercises(gzclp, 1).map { it.index })
        assertEquals("t1-squat_barbell", engine.usedExercises(gzclp, 1).first().key)
        assertEquals(emptyList<DayExercise>(), engine.usedExercises(gzclp, 99))
    }

    @Test
    fun theEntryOfADayResolvesPercentagesAgainstTheOneRepMax() {
        val t1 = engine.entryFor(gzclp, 1, engine.usedExercises(gzclp, 1).first())
        val sets = t1.getValue("sets").jsonArray.map { it.jsonObject }
        assertEquals(5, sets.size)
        assertEquals(150.0, sets.first().getValue("weight").jsonObject.getValue("value").jsonPrimitive.content.toDouble(), 0.0)
        assertEquals("3", sets.first().getValue("reps").jsonPrimitive.content)
    }

    @Test
    fun plannedSetsFeedTheWeekLoad() {
        assertEquals(listOf(5.0, 3.0, 3.0), engine.planned(gzclp, 1).map { it.sets })
        assertEquals(listOf("squat", "benchPress", "latPulldown"), engine.planned(gzclp, 1).map { it.exerciseId })
        assertEquals(listOf(null, null, null), engine.planned(gzclp, 1).map { it.targetRpe })
    }

    @Test
    fun theHeroOfADayIsItsMainLiftsTopSet() {
        val hero = engine.liftHero(gzclp, 1, SettingsRecord.DefaultMainLifts, "gzclp.md")!!
        assertEquals("gzclp", hero.programName)
        assertEquals("Day 1", hero.dayName)
        assertEquals("squat", hero.exerciseId)
        assertEquals("Squat", hero.exerciseName)
        // Five sets of three at 150 lb, the last of them as many as possible: that set is the top one.
        assertEquals(TopSet(weight = 150.0, unit = WeightUnit.Lb, reps = 3.0, amrap = true, sets = 5), hero.topSet)
        assertEquals(3, hero.exerciseCount)
        assertEquals("T1 5 sets, T2 3, T3 3", 11, hero.setCount)
    }

    @Test
    fun theMainLiftIsTheFirstUsedExerciseThatIsOne() {
        assertEquals("benchPress", engine.liftHero(gzclp, 3, SettingsRecord.DefaultMainLifts, "gzclp.md")!!.exerciseId)
        assertEquals("Day 3", engine.liftHero(gzclp, 3, SettingsRecord.DefaultMainLifts, "gzclp.md")!!.dayName)
        // With nothing the user calls a main lift, the day's first exercise stands in.
        assertEquals("benchPress", engine.liftHero(gzclp, 3, emptyList(), "gzclp.md")!!.exerciseId)
        // Day 1 opens with a squat, but if only the bench is a main lift the bench is the day's lift.
        assertEquals("benchPress", engine.liftHero(gzclp, 1, listOf("benchPress"), "gzclp.md")!!.exerciseId)
    }

    @Test
    fun aDayOverviewListsEveryExerciseWithItsSets() {
        val day = engine.dayOverview(gzclp, 1, SettingsRecord.DefaultMainLifts, WeightUnit.Lb)!!
        assertEquals("Day 1", day.dayName)
        assertEquals("squat", day.mainExerciseId)
        assertEquals("Squat", day.mainExerciseName)
        assertEquals(listOf("Squat", "Bench Press", "Lat Pulldown"), day.exercises.map { it.name })
        assertEquals(listOf("squat", "benchPress", "latPulldown"), day.exercises.map { it.exerciseId })
        assertEquals("T1 5 sets, T2 3, T3 3", listOf(5, 3, 3), day.exercises.map { it.sets.size })
        val t1 = day.exercises.first().sets
        // Five sets of three at 150 lb, the last as many as possible.
        assertEquals(List(5) { 150.0 }, t1.map { it.weight })
        assertEquals(List(5) { 3.0 }, t1.map { it.reps })
        assertEquals(listOf(false, false, false, false, true), t1.map { it.amrap })
        assertEquals(WeightUnit.Lb, t1.first().unit)
        assertTrue("the squat warms up", day.exercises.first().warmups.isNotEmpty())
        // The hero reads the same entries, so its set count is the overview's.
        assertEquals(engine.liftHero(gzclp, 1, SettingsRecord.DefaultMainLifts, "gzclp.md")!!.setCount, day.exercises.sumOf { it.sets.size })
    }

    @Test
    fun theMainLiftOfAnOverviewIsTheHeros() {
        assertEquals("benchPress", engine.dayOverview(gzclp, 3, SettingsRecord.DefaultMainLifts, WeightUnit.Lb)!!.mainExerciseId)
        assertEquals("with no main lifts the first exercise leads", "benchPress", engine.dayOverview(gzclp, 3, emptyList(), WeightUnit.Lb)!!.mainExerciseId)
        assertEquals("benchPress", engine.dayOverview(gzclp, 1, listOf("benchPress"), WeightUnit.Lb)!!.mainExerciseId)
    }

    @Test
    fun anOverviewWithoutSetsIsJustTheNames() {
        val day = engine.dayOverview(gzclp, 2, SettingsRecord.DefaultMainLifts, WeightUnit.Lb, withSets = false)!!
        assertEquals(listOf("Overhead Press", "Deadlift", "Bent Over Row"), day.exercises.map { it.name })
        assertTrue(day.exercises.all { it.sets.isEmpty() && it.warmups.isEmpty() })
    }

    @Test
    fun aDayThatDoesNotExistHasNoOverview() {
        assertNull(engine.dayOverview(gzclp, 99, SettingsRecord.DefaultMainLifts, WeightUnit.Lb))
    }

    @Test
    fun aDayThatDoesNotExistHasNoHero() {
        assertNull(engine.liftHero(gzclp, 99, SettingsRecord.DefaultMainLifts, "gzclp.md"))
        assertNull(QalaCore.dayName(gzclp.program, 99))
        assertEquals("Day 4", QalaCore.dayName(gzclp.program, 4))
    }

    @Test
    fun evaluationIsCachedAndDeterministic() {
        val again = engine.evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)
        assertSame(gzclp, again)
        val fresh = ProgramEngine().evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)
        assertEquals(gzclp.program, fresh.program)
        val kg = engine.evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Kg, JsonObject(emptyMap()))
        assertEquals(4, kg.dayCount)
    }
}
