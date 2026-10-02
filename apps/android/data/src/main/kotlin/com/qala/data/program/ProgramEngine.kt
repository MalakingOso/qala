package com.qala.data.program

import com.qala.data.core.PlannedExercise
import com.qala.data.core.QalaCore
import com.qala.data.core.dayCount
import com.qala.data.core.evaluateProgramText
import com.qala.data.core.liftoscriptSettings
import com.qala.data.core.nextEntry
import com.qala.data.core.programDay
import com.qala.data.model.WeightUnit
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** An evaluated program with the settings it was evaluated under; both go back into later LS++ calls untouched. */
class EvaluatedProgram(
    val program: JsonObject,
    val settings: JsonObject,
    /** Days over all weeks of the program: the length of the rotation. */
    val dayCount: Int,
)

/** One exercise a program day uses. [index] is its position among the day's used exercises, as `next_history_entry` wants it. */
data class DayExercise(val key: String, val exerciseId: String, val index: Int)

/**
 * LS++ evaluation for the app: program text in, days and exercises out. Evaluation is the expensive call, so
 * the last few results are kept by (text, unit, 1RMs). Everything here is Rust and JSON work: call it off the
 * main thread. A program text with errors still evaluates; its `errors` stay in [EvaluatedProgram.program].
 */
class ProgramEngine(private val uidSeed: Long = 0, private val cacheSize: Int = 4) {
    private data class Key(val text: String, val name: String, val unit: WeightUnit, val exerciseData: JsonObject)

    private val cache = object : LinkedHashMap<Key, EvaluatedProgram>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, EvaluatedProgram>) = size > cacheSize
    }

    /** LS++ settings for a unit and the 1RMs (`exerciseData`) that percentage weights resolve against. */
    fun settings(unit: WeightUnit, exerciseData: JsonObject): JsonObject {
        val base = QalaCore.liftoscriptSettings(unit.name.lowercase(), if (unit == WeightUnit.Kg) "km" else "mi")
        return JsonObject(base + ("exerciseData" to exerciseData))
    }

    fun evaluate(text: String, name: String, unit: WeightUnit, exerciseData: JsonObject): EvaluatedProgram {
        val key = Key(text, name, unit, exerciseData)
        synchronized(cache) { cache[key] }?.let { return it }
        val settings = settings(unit, exerciseData)
        val program = QalaCore.evaluateProgramText(text, name, settings, uidSeed)
        val evaluated = EvaluatedProgram(program, settings, QalaCore.dayCount(program))
        synchronized(cache) { cache[key] = evaluated }
        return evaluated
    }

    /** The exercises a day uses, in order: not marked unused, with a known exercise type. Empty for a missing day. */
    fun usedExercises(p: EvaluatedProgram, day: Int): List<DayExercise> {
        val view = QalaCore.programDay(p.program, day) ?: return emptyList()
        return view.getValue("exercises").jsonArray
            .map { it.jsonObject }
            .filter { it["notused"]?.jsonPrimitive?.booleanOrNull != true && it["exerciseType"].let { t -> t != null && t !is JsonNull } }
            .mapIndexed { index, e ->
                DayExercise(
                    key = e.getValue("key").jsonPrimitive.content,
                    exerciseId = e.getValue("exerciseType").jsonObject.getValue("id").jsonPrimitive.content,
                    index = index,
                )
            }
    }

    /** The history entry (working sets and warm-ups, weights resolved) a day prescribes for one exercise. */
    fun entryFor(p: EvaluatedProgram, day: Int, exercise: DayExercise): JsonObject =
        QalaCore.nextEntry(p.program, day, exercise.key, exercise.index, p.settings, uidSeed)

    /**
     * What a day plans, for the week load: per exercise its working-set count and, when the program
     * prescribes one, the target RPE of its first set.
     */
    fun planned(p: EvaluatedProgram, day: Int): List<PlannedExercise> =
        usedExercises(p, day).map { ex ->
            val sets = entryFor(p, day, ex).getValue("sets").jsonArray
            PlannedExercise(
                exerciseId = ex.exerciseId,
                sets = sets.size.toDouble(),
                targetRpe = (sets.firstOrNull()?.jsonObject?.get("rpe") as? JsonPrimitive)?.doubleOrNull,
            )
        }
}
