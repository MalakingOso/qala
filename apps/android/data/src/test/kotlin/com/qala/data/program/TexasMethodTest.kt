package com.qala.data.program

import com.qala.data.core.QalaCore
import com.qala.data.core.finishDay
import com.qala.data.core.loadableFor
import com.qala.data.model.PlateSettings
import com.qala.data.model.WeightUnit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Texas Method plan through the real LS++ evaluator and finish-day scripts, in pounds on the default plates. */
class TexasMethodTest {
    private val engine = ProgramEngine()
    private val plan = Builtins.TexasMethod
    private val entered = mapOf(
        "squat_barbell" to 300.0,
        "benchPress_barbell" to 225.0,
        "overheadPress_barbell" to 135.0,
        "deadlift_barbell" to 365.0,
        "powerClean_barbell" to 185.0,
    )
    private val start = StartingWeights.merge(plan, JsonObject(emptyMap()), entered, WeightUnit.Lb)!!

    private fun evaluate(text: String, data: JsonObject) = engine.evaluate(text, plan.programName, WeightUnit.Lb, data)

    private fun ids(p: EvaluatedProgram, day: Int) = engine.usedExercises(p, day).map { it.exerciseId }

    /** The weight LS++ prescribes for the first set of [exerciseId] on [day]. */
    private fun raw(p: EvaluatedProgram, day: Int, exerciseId: String): Double {
        val ex = engine.usedExercises(p, day).first { it.exerciseId == exerciseId }
        return engine.entryFor(p, day, ex).getValue("sets").jsonArray.first().jsonObject.getValue("weight").jsonObject.getValue("value").jsonPrimitive.double
    }

    /** What the app shows: [raw] at what the default plates can load. */
    private fun weight(p: EvaluatedProgram, day: Int, exerciseId: String) =
        QalaCore.loadableFor(raw(p, day, exerciseId), WeightUnit.Lb, "barbell", PlateSettings())

    /** Runs the finish-day scripts for [day] with every set done at [reps] (default: the target), as `LiftService.finish` does, and returns the next program and 1RMs. */
    private fun finish(
        p: EvaluatedProgram,
        data: JsonObject,
        day: Int,
        unit: WeightUnit = WeightUnit.Lb,
        reps: (Double) -> Double = { it },
    ): Pair<EvaluatedProgram, JsonObject> {
        val entries = engine.usedExercises(p, day).map { ex ->
            val entry = engine.entryFor(p, day, ex)
            val sets = entry.getValue("sets").jsonArray.map { set ->
                val s = set.jsonObject
                // The app logs the weight the plates can load (D33), which is below the program's when the plates cannot make it.
                val planned = s.getValue("weight").jsonObject.getValue("value").jsonPrimitive.double
                val logged = QalaCore.loadableFor(planned, unit, entry["exercise"]?.jsonObject?.get("equipment")?.jsonPrimitive?.contentOrNull, PlateSettings())
                val weight = JsonObject(s.getValue("weight").jsonObject + ("value" to JsonPrimitive(logged)))
                JsonObject(s + mapOf("isCompleted" to JsonPrimitive(true), "completedReps" to JsonPrimitive(reps(s.getValue("reps").jsonPrimitive.double)), "completedWeight" to weight))
            }
            JsonObject(entry + ("sets" to JsonArray(sets)))
        }
        val fd = QalaCore.finishDay(p.program, day, entries, p.settings)
        assertEquals(emptyList<String>(), fd.errors)
        val merged = JsonObject(data + fd.exerciseData)
        return engine.evaluate(fd.plannerText, plan.programName, unit, merged) to merged
    }

    @Test
    fun gzclpKeepsTheIdTheDebugSeedAlwaysGaveItsProgram() {
        assertEquals("1b28863a-d6e0-369b-901a-82d6d0120fc0", Builtins.Gzclp.id)
    }

    @Test
    fun theTextIsSixDaysOfTheArticlesLifts() {
        val p = evaluate(plan.text, start)
        assertEquals(emptyList<Any>(), p.program.getValue("errors").jsonArray.toList())
        assertEquals(6, p.dayCount)
        assertEquals(listOf("squat", "benchPress", "deadlift"), ids(p, 1))
        assertEquals(listOf("squat", "overheadPress", "chinUp", "backExtension"), ids(p, 2))
        assertEquals(listOf("squat", "benchPress", "powerClean"), ids(p, 3))
        assertEquals(listOf("squat", "overheadPress", "deadlift"), ids(p, 4))
        assertEquals(listOf("squat", "benchPress", "chinUp", "backExtension"), ids(p, 5))
        assertEquals(listOf("squat", "overheadPress", "powerClean"), ids(p, 6))
    }

    @Test
    fun weekOneLandsOnTheWeightsThatWereEntered() {
        val p = evaluate(plan.text, start)
        assertEquals("Friday squat is the 5RM", 300.0, weight(p, 3, "squat"), 0.0)
        assertEquals("Monday squat is 90% of it", 270.0, weight(p, 1, "squat"), 0.0)
        assertEquals(225.0, weight(p, 3, "benchPress"), 0.0)
        assertEquals(135.0, weight(p, 6, "overheadPress"), 0.0)
        assertEquals("the deadlift's 1x5 and the clean's 5x3 start where they were", 365.0, weight(p, 1, "deadlift"), 0.0)
        assertEquals(185.0, weight(p, 3, "powerClean"), 0.0)
    }

    @Test
    fun aMadeFridayRaisesTheFiveRepMaxAndAMissedOneDoesNot() {
        var p = evaluate(plan.text, start)
        var data = start
        // Week A and B Fridays in turn: squat goes 300, 305, 310, 315, so it is the 5RM that moves by 5 lb each time.
        val squats = mutableListOf(weight(p, 3, "squat"))
        for (day in listOf(3, 6, 3, 6)) {
            val (next, merged) = finish(p, data, day)
            p = next
            data = merged
            squats += weight(p, 3, "squat")
        }
        assertEquals(listOf(300.0, 305.0, 310.0, 315.0, 320.0), squats)
        assertEquals("Monday follows the 5RM", 285.0, weight(p, 1, "squat"), 0.0)

        val (missed, same) = finish(p, data, 3, reps = { it - 1 })
        assertEquals(data, same)
        assertEquals(weight(p, 3, "squat"), weight(missed, 3, "squat"), 0.0)
    }

    @Test
    fun aRaiseThePlatesCannotLoadStillCounts() {
        // Bench goes up 2.5 lb a week, but the default plates load 5 lb steps, so 227.5 is logged as 225. The next raise
        // starts from the program's 227.5, not from what was on the bar.
        var p = evaluate(plan.text, start)
        var data = start
        val raws = mutableListOf(raw(p, 3, "benchPress"))
        repeat(4) {
            val (next, merged) = finish(p, data, 3)
            p = next
            data = merged
            raws += raw(p, 3, "benchPress")
        }
        assertEquals(listOf(225.0, 227.5, 230.0, 232.5, 235.0), raws)
    }

    @Test
    fun kilogramsMoveToo() {
        val kg = StartingWeights.merge(plan, JsonObject(emptyMap()), entered.mapValues { it.value / 2.2 }.mapValues { Math.round(it.value / 2.5) * 2.5 }, WeightUnit.Kg)!!
        var p = engine.evaluate(plan.text, plan.programName, WeightUnit.Kg, kg)
        var data = kg
        val raws = mutableListOf(raw(p, 3, "squat"))
        repeat(4) {
            val (next, merged) = finish(p, data, 3, WeightUnit.Kg)
            p = next
            data = merged
            raws += raw(p, 3, "squat")
        }
        assertTrue("every made Friday raises the squat: $raws", raws.zipWithNext().all { (a, b) -> b > a })
    }

    @Test
    fun theDeadliftAndTheCleanMoveOnTheirOwnSets() {
        val p = evaluate(plan.text, start)
        val (afterMonday, data) = finish(p, start, 1)
        assertEquals(370.0, weight(afterMonday, 1, "deadlift"), 0.0)
        assertEquals("squat is not raised on Monday", 300.0, weight(afterMonday, 3, "squat"), 0.0)
        assertEquals(start["squat_barbell"], data["squat_barbell"])

        val (afterFriday, _) = finish(p, start, 3)
        assertEquals(187.5, raw(afterFriday, 3, "powerClean"), 0.0)

        assertEquals("Wednesday moves nothing", start, finish(p, start, 2).second)
    }
}
