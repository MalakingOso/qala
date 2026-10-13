package com.qala.data.program

import com.qala.data.core.PlannedExercise
import com.qala.data.core.QalaCore
import com.qala.data.core.dayCount
import com.qala.data.core.dayName
import com.qala.data.core.evaluateProgramText
import com.qala.data.core.liftoscriptSettings
import com.qala.data.core.nextEntry
import com.qala.data.core.programDay
import com.qala.data.model.WeightUnit
import kotlinx.serialization.json.JsonArray
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

/**
 * The heaviest working set of a day's main lift. [weight] is null for a set with no weight (bodyweight work),
 * in [unit]; [sets] is how many working sets the exercise has; [amrap] marks an as-many-as-possible set.
 */
data class TopSet(val weight: Double?, val unit: WeightUnit, val reps: Double, val amrap: Boolean, val sets: Int)

/**
 * What the Today hero says about a lift day, read from the evaluated program: the day's heading, its main lift
 * and that lift's top set. [programName] is the program's name without a `.md` suffix.
 */
data class LiftHero(
    val programName: String,
    val dayName: String,
    val exerciseId: String,
    val exerciseName: String,
    val topSet: TopSet,
    /** Exercises the day uses, and their working sets in all. */
    val exerciseCount: Int,
    val setCount: Int,
)

/** An exercise of a program day: its name and the sets the program prescribes for it now. */
data class ExerciseOverview(
    val exerciseId: String,
    val name: String,
    val sets: List<PlannedSet>,
    val warmups: List<PlannedSet>,
)

/**
 * What a program day prescribes, for the Plan screen: the day's heading, which exercise leads it (the Today hero's main
 * lift) and every exercise with its sets. The weights are the ones the program holds now: LS++ moves them when a
 * session finishes, so a later day's loads can be higher by the time it comes round.
 */
data class DayOverview(
    val dayName: String,
    val mainExerciseId: String,
    val mainExerciseName: String,
    val exercises: List<ExerciseOverview>,
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
    fun usedExercises(p: EvaluatedProgram, day: Int): List<DayExercise> =
        usedViews(p, day).mapIndexed { index, e ->
            DayExercise(
                key = e.getValue("key").jsonPrimitive.content,
                exerciseId = e.getValue("exerciseType").jsonObject.getValue("id").jsonPrimitive.content,
                index = index,
            )
        }

    private fun usedViews(p: EvaluatedProgram, day: Int): List<JsonObject> {
        val view = QalaCore.programDay(p.program, day) ?: return emptyList()
        return view.getValue("exercises").jsonArray
            .map { it.jsonObject }
            .filter { it["notused"]?.jsonPrimitive?.booleanOrNull != true && it["exerciseType"].let { t -> t != null && t !is JsonNull } }
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

    /**
     * The day's heading, main lift and every used exercise with its prescribed working and warm-up sets. Null for a day the
     * program lacks or one that uses no exercise. [withSets] false leaves the sets empty and skips the per-exercise calls,
     * for a caller that only wants the names.
     */
    fun dayOverview(p: EvaluatedProgram, day: Int, mainLifts: List<String>, unit: WeightUnit, withSets: Boolean = true): DayOverview? {
        val views = usedViews(p, day)
        if (views.isEmpty()) return null
        val used = usedExercises(p, day)
        val main = mainIndex(used, mainLifts)
        val exercises = used.mapIndexed { i, ex ->
            val entry = if (withSets) entryFor(p, day, ex) else JsonObject(emptyMap())
            ExerciseOverview(
                exerciseId = ex.exerciseId,
                name = views[i].getValue("exerciseType").jsonObject.getValue("name").jsonPrimitive.content,
                sets = plannedSets(entry, unit),
                warmups = plannedSets(JsonObject(mapOf("sets" to (entry["warmupSets"] ?: JsonArray(emptyList())))), unit),
            )
        }
        return DayOverview(
            dayName = QalaCore.dayName(p.program, day) ?: "Day $day",
            mainExerciseId = used[main].exerciseId,
            mainExerciseName = exercises[main].name,
            exercises = exercises,
        )
    }

    private fun mainIndex(used: List<DayExercise>, mainLifts: List<String>): Int =
        used.indexOfFirst { it.exerciseId in mainLifts }.takeIf { it >= 0 } ?: 0

    private fun weightOf(set: JsonObject): Double? = (set["weight"] as? JsonObject)?.get("value")?.jsonPrimitive?.doubleOrNull

    private fun unitOf(set: JsonObject): WeightUnit =
        if ((set["weight"] as? JsonObject)?.get("unit")?.jsonPrimitive?.content == "kg") WeightUnit.Kg else WeightUnit.Lb

    /**
     * The Today hero for a lift day: the day's heading, the day's main lift (the first used exercise that is one of
     * [mainLifts], else the first used exercise) and its top set, the heaviest working set, the last one on a tie so
     * an as-many-as-possible set closing the sets is the one shown. Null when the day has no exercise with sets.
     */
    fun liftHero(p: EvaluatedProgram, day: Int, mainLifts: List<String>, programName: String): LiftHero? {
        val views = usedViews(p, day)
        if (views.isEmpty()) return null
        val used = usedExercises(p, day)
        val main = mainIndex(used, mainLifts)
        val entries = used.map { ex -> entryFor(p, day, ex).getValue("sets").jsonArray.map { it.jsonObject } }
        val sets = entries[main]
        if (sets.isEmpty()) return null
        val top = sets.withIndex().maxWithOrNull(compareBy<IndexedValue<JsonObject>> { weightOf(it.value) ?: Double.NEGATIVE_INFINITY }.thenBy { it.index })!!.value
        val unit = unitOf(top)
        return LiftHero(
            programName = programName.removeSuffix(".md"),
            dayName = QalaCore.dayName(p.program, day) ?: "Day $day",
            exerciseId = used[main].exerciseId,
            exerciseName = views[main].getValue("exerciseType").jsonObject.getValue("name").jsonPrimitive.content,
            topSet = TopSet(
                weight = weightOf(top),
                unit = unit,
                reps = top["reps"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                amrap = top["isAmrap"]?.jsonPrimitive?.booleanOrNull == true,
                sets = sets.size,
            ),
            exerciseCount = used.size,
            setCount = entries.sumOf { it.size },
        )
    }
}
