package com.qala.data.program

import com.qala.data.core.QalaCore
import com.qala.data.core.dayName
import com.qala.data.core.finishDay
import com.qala.data.core.FinishDayResult
import com.qala.data.core.runUpdateScript
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.model.WeightUnit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * What a program day asks of the lifter, as typed values, and the other way round: what was lifted, as the completed
 * entries LS++'s scripts read. The LS++ entry itself stays a JsonObject beside the typed view, because the update and
 * finish-day scripts want it back whole. Everything here is plain Kotlin and JSON, so it is tested on the JVM; the
 * functions that call the scripts are the only ones that reach Rust.
 */

/** How a lift counts for rest and warm-up (PLAN 6.6, 6.7): a main lift, another compound, or a single-muscle isolation. */
enum class ExerciseClass { Main, Secondary, Isolation }

/** One set the program prescribes. [weight] is null for bodyweight work; [reps] is the target, [minReps] the floor of a range. */
data class PlannedSet(
    val weight: Double?,
    val unit: WeightUnit,
    val reps: Double,
    val minReps: Double?,
    val amrap: Boolean,
    /** The target RPE, when the program names one. */
    val rpe: Double?,
    /** The program's own rest after this set, in seconds. */
    val timerSec: Int?,
)

/** One exercise of a program day: its sets as prescribed, and the LS++ entry they came from. */
data class LiftExercise(
    /** The program exercise key (`t1-squat_barbell`), as the scripts want it. */
    val key: String,
    /** Liftosaur library id. */
    val exerciseId: String,
    val name: String,
    /** Position among the day's used exercises. */
    val index: Int,
    /** `barbell`, `dumbbell`, ... as the entry names it. */
    val equipment: String?,
    val sets: List<PlannedSet>,
    val entry: JsonObject,
    val cls: ExerciseClass = ExerciseClass.Secondary,
) {
    /** The key LS++ files this exercise's 1RM under in `exerciseData` (`squat_barbell`). */
    val oneRepMaxKey: String get() = "${exerciseId}_${equipment ?: "bodyweight"}"
}

/** A program day ready to lift. */
data class LiftPlan(
    /** 1-based program day. */
    val day: Int,
    val dayName: String,
    /** The program's name without `.md`. */
    val programName: String,
    val exercises: List<LiftExercise>,
)

/** One set as the lifter did it. [weight] is null for bodyweight work. */
data class LoggedSet(
    val weight: Double?,
    val reps: Double,
    val rpe: Double? = null,
    val jointPain: Boolean = false,
)

private fun JsonElement?.double(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
private fun JsonElement?.bool(): Boolean? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.booleanOrNull
private fun JsonElement?.obj(): JsonObject? = this as? JsonObject

private fun weightUnitOf(weight: JsonObject?, fallback: WeightUnit): WeightUnit = when (weight?.get("unit")?.jsonPrimitive?.content) {
    "kg" -> WeightUnit.Kg
    "lb" -> WeightUnit.Lb
    else -> fallback
}

/** The working sets of an LS++ history entry, in order. Weights in `%` have already been resolved by the evaluator. */
fun plannedSets(entry: JsonObject, fallbackUnit: WeightUnit = WeightUnit.Lb): List<PlannedSet> =
    entry["sets"]?.jsonArray.orEmpty().map { it.jsonObject }.map { set ->
        val weight = set["weight"].obj()
        PlannedSet(
            weight = weight?.get("value").double(),
            unit = weightUnitOf(weight, fallbackUnit),
            reps = set["reps"].double() ?: 0.0,
            minReps = set["minReps"].double(),
            amrap = set["isAmrap"].bool() == true,
            rpe = set["rpe"].double(),
            timerSec = set["timer"].double()?.toInt(),
        )
    }

private fun number(v: Double): JsonPrimitive = if (v == Math.rint(v) && Math.abs(v) < 1e9) JsonPrimitive(v.toLong()) else JsonPrimitive(v)

/**
 * The entry with the sets in [logged] marked completed, as the scripts read them: `isCompleted`, `completedReps`,
 * `completedWeight` (the set's own unit, else [fallbackUnit]) and `completedRpe` when one was picked. [logged] is
 * aligned with the entry's sets and null for a set that was not done; those stay as the program wrote them. Sets past
 * the end of [logged] are left alone.
 */
fun completeEntry(entry: JsonObject, logged: List<LoggedSet?>, fallbackUnit: WeightUnit = WeightUnit.Lb): JsonObject {
    val sets = entry["sets"]?.jsonArray.orEmpty().mapIndexed { i, element ->
        val set = element.jsonObject
        val done = logged.getOrNull(i) ?: return@mapIndexed set
        val unit = weightUnitOf(set["weight"].obj(), fallbackUnit)
        val extra = LinkedHashMap<String, JsonElement>()
        extra["isCompleted"] = JsonPrimitive(true)
        extra["completedReps"] = number(done.reps)
        val completedWeight = if (done.weight != null) {
            JsonObject(mapOf("value" to number(done.weight), "unit" to JsonPrimitive(unit.name.lowercase())))
        } else {
            set["weight"]
        }
        if (completedWeight != null) extra["completedWeight"] = completedWeight
        if (done.rpe != null) extra["completedRpe"] = number(done.rpe)
        JsonObject(set + extra)
    }
    return JsonObject(entry + ("sets" to JsonArray(sets)))
}

/** [logged] as the records a session stores: the sets that were done, in order, as completed work sets. */
fun liftEntryRecord(exerciseId: String, planned: List<PlannedSet>, logged: List<LoggedSet?>, unit: WeightUnit): LiftEntryRecord =
    LiftEntryRecord(
        exerciseId,
        logged.withIndex().mapNotNull { (i, set) ->
            set ?: return@mapNotNull null
            LiftSetRecord(
                weight = set.weight ?: 0.0,
                unit = planned.getOrNull(i)?.unit ?: unit,
                reps = set.reps,
                rpe = set.rpe,
                targetRpe = planned.getOrNull(i)?.rpe,
                completed = true,
                jointPain = set.jointPain,
            )
        },
    )

/** The weight a JSON `{value, unit}` holds, in [unit]. */
private fun weightIn(weight: JsonObject, unit: WeightUnit): Double? {
    val v = weight["value"].double() ?: return null
    val from = weightUnitOf(weight, unit)
    return when {
        from == unit -> v
        from == WeightUnit.Kg -> v * 2.2046226218
        else -> v / 2.2046226218
    }
}

/** The 1RM LS++ holds for [exercise] in [exerciseData], in [unit]; null when none is set. */
fun oneRepMax(exerciseData: JsonObject, exercise: LiftExercise, unit: WeightUnit): Double? =
    exerciseData[exercise.oneRepMaxKey].obj()?.get("rm1").obj()?.let { weightIn(it, unit) }

// ---- the script calls, on the program engine ----

/**
 * The day's exercises with their prescribed sets: for each used exercise its history entry from `next_history_entry`,
 * typed. Null when the day uses no exercise. [classOf] gives each exercise's [ExerciseClass] (the caller knows the main
 * lifts and the muscle table); the default is [ExerciseClass.Secondary].
 */
fun ProgramEngine.liftPlan(
    p: EvaluatedProgram,
    day: Int,
    programName: String,
    unit: WeightUnit,
    classOf: (exerciseId: String) -> ExerciseClass = { ExerciseClass.Secondary },
): LiftPlan? {
    val used = usedExercises(p, day)
    if (used.isEmpty()) return null
    val exercises = used.map { ex ->
        val entry = entryFor(p, day, ex)
        val type = entry["exercise"].obj()
        LiftExercise(
            key = ex.key,
            exerciseId = ex.exerciseId,
            name = type?.get("name")?.jsonPrimitive?.content ?: ex.exerciseId,
            index = ex.index,
            equipment = type?.get("equipment")?.jsonPrimitive?.content,
            sets = plannedSets(entry, unit),
            entry = entry,
            cls = classOf(ex.exerciseId),
        )
    }
    return LiftPlan(day, QalaCore.dayName(p.program, day) ?: "Day $day", programName.removeSuffix(".md"), exercises)
}

/** The entry after the update script ran for the set at [setIndex]; [entry] already has that set completed. */
fun ProgramEngine.afterSet(p: EvaluatedProgram, day: Int, exerciseKey: String, entry: JsonObject, setIndex: Int): JsonObject =
    QalaCore.runUpdateScript(p.program, day, exerciseKey, entry, setIndex, p.settings)

/** Runs the finish-day scripts of the day's completed [entries] and returns the advanced program. */
fun ProgramEngine.finishDay(p: EvaluatedProgram, day: Int, entries: List<JsonObject>): FinishDayResult =
    QalaCore.finishDay(p.program, day, entries, p.settings)
