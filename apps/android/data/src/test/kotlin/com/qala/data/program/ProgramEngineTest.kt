package com.qala.data.program

import com.qala.data.TestRepo
import com.qala.data.model.WeightUnit
import com.qala.data.seed.GzclpProgram
import com.qala.data.seed.SeedOneRepMax
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
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
    fun evaluationIsCachedAndDeterministic() {
        val again = engine.evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)
        assertSame(gzclp, again)
        val fresh = ProgramEngine().evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)
        assertEquals(gzclp.program, fresh.program)
        val kg = engine.evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Kg, JsonObject(emptyMap()))
        assertEquals(4, kg.dayCount)
    }
}
