package com.qala.data.core

import com.qala.data.QalaJson
import com.qala.data.model.Availability
import com.qala.data.model.DayClass
import com.qala.data.model.DaySkip
import com.qala.data.model.SkipReason
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import uniffi.qala_ffi.buildEngineState as ffiBuildEngineState
import uniffi.qala_ffi.classifyDay as ffiClassifyDay
import uniffi.qala_ffi.exerciseMuscles as ffiExerciseMuscles
import uniffi.qala_ffi.injuredOn as ffiInjuredOn
import uniffi.qala_ffi.forceEvaluateText as ffiForceEvaluateText
import uniffi.qala_ffi.getDay as ffiGetDay
import uniffi.qala_ffi.nextHistoryEntry as ffiNextHistoryEntry
import uniffi.qala_ffi.qalaSettingsToLiftoscript as ffiQalaSettingsToLiftoscript
import uniffi.qala_ffi.reasonOn as ffiReasonOn
import uniffi.qala_ffi.readinessSummary as ffiReadinessSummary
import uniffi.qala_ffi.runAllFinishDayScripts as ffiRunAllFinishDayScripts
import uniffi.qala_ffi.shiftsPlan as ffiShiftsPlan
import uniffi.qala_ffi.weekLoad as ffiWeekLoad
import uniffi.qala_ffi.weightTrend as ffiWeightTrend

// ---- engine and derived numbers (qala-core) ----

fun QalaCore.buildEngineState(request: BuildEngineStateRequest): BuildEngineStateResult = call(
    BuildEngineStateRequest.serializer(), BuildEngineStateResult.serializer(), request, ::ffiBuildEngineState,
)

/** The decoded view of the fields of an engine state the app reads. */
fun QalaCore.stateView(state: JsonObject): EngineStateView =
    QalaJson.decodeFromJsonElement(EngineStateView.serializer(), state)

fun QalaCore.readinessSummary(request: ReadinessSummaryRequest): ReadinessSummary = call(
    ReadinessSummaryRequest.serializer(), ReadinessSummary.serializer(), request, ::ffiReadinessSummary,
)

fun QalaCore.weekLoad(request: WeekLoadRequest): WeekLoadResult = call(
    WeekLoadRequest.serializer(), WeekLoadResult.serializer(), request, ::ffiWeekLoad,
)

/** Null when there are fewer than three distinct weigh-in days in the last seven. */
fun QalaCore.weightTrend(request: WeightTrendRequest): WeightTrend? = call(
    WeightTrendRequest.serializer(), WeightTrend.serializer().nullable, request, ::ffiWeightTrend,
)

// ---- availability (qala-core availability.rs) ----

@Serializable
private data class DayRequest(
    val date: String,
    val availability: Availability = Availability(),
    val skips: List<DaySkip> = emptyList(),
)

@Serializable
private data class ShiftsRequest(val reason: SkipReason)

/** How the plan treats a local day: train as usual, rest in place, or pushed out. */
fun QalaCore.classifyDay(date: String, availability: Availability, skips: List<DaySkip>): DayClass = call(
    DayRequest.serializer(), DayClass.serializer(), DayRequest(date, availability, skips), ::ffiClassifyDay,
)

/** Why a day is off, or null when it trains. A one-day skip wins over the persistent status. */
fun QalaCore.reasonOn(date: String, availability: Availability, skips: List<DaySkip>): SkipReason? = call(
    DayRequest.serializer(), SkipReason.serializer().nullable, DayRequest(date, availability, skips), ::ffiReasonOn,
)

/** Whether the reason pushes the plan out (vacation and sick do; break, scheduling and injured do not). */
fun QalaCore.shiftsPlan(reason: SkipReason): Boolean = call(
    ShiftsRequest.serializer(), Boolean.serializer(), ShiftsRequest(reason), ::ffiShiftsPlan,
)

/** The muscle ids an injury guards on a local day (at most one: the skip's target wins, else the status target). */
fun QalaCore.injuredOn(date: String, availability: Availability, skips: List<DaySkip>): List<String> = call(
    DayRequest.serializer(), ListSerializer(String.serializer()), DayRequest(date, availability, skips), ::ffiInjuredOn,
)

// ---- muscles (qala-core muscles.rs) ----

@Serializable
private data class MusclesRequest(val exerciseIds: List<String>)

/** The engine muscle ids of each liftosaur exercise id; an id the library does not know maps to null. */
fun QalaCore.exerciseMuscles(exerciseIds: List<String>): Map<String, ExerciseMuscles?> =
    if (exerciseIds.isEmpty()) emptyMap() else call(
        MusclesRequest.serializer(),
        MapSerializer(String.serializer(), ExerciseMuscles.serializer().nullable),
        MusclesRequest(exerciseIds.distinct()),
        ::ffiExerciseMuscles,
    )

/**
 * The distinct primary muscles of a session's exercises, in first-seen order: what the check-in lists and what
 * readiness reads as the session's muscles. Targets only; synergists are left to the engine's own bookkeeping.
 */
fun QalaCore.sessionMuscles(exerciseIds: List<String>): List<String> {
    val byExercise = exerciseMuscles(exerciseIds)
    return exerciseIds.flatMap { byExercise[it]?.targets.orEmpty() }.distinct()
}

// ---- LS++ (qala-lspp-json) ----
// Programs, settings and history entries are LS++'s own large structures. They stay as JSON values and go
// back into the next call untouched; only the few fields the app reads are looked at.

/** The result of `run_all_finish_day_scripts`: the program with its states advanced, and its new text. */
data class FinishDayResult(
    val evaluatedProgram: JsonObject,
    /** The planner text with the new states folded back in: what gets stored as the program text. */
    val plannerText: String,
    /** 1-based day that follows the one just finished. */
    val nextDay: Int,
    val errors: List<String>,
)

private fun lspp(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): String =
    buildJsonObject {
        put("v", QalaCore.API_VERSION)
        build()
    }.toString()

private fun uids(builder: kotlinx.serialization.json.JsonObjectBuilder, seed: Long) {
    builder.put("uidSeed", seed)
}

/** LS++ `ISettings` for a unit pair (`lb`/`kg`, `mi`/`km`), before any 1RMs are added. */
fun QalaCore.liftoscriptSettings(weightUnit: String, distanceUnit: String): JsonObject {
    val request = lspp {
        put("coreSettings", buildJsonObject { put("units", buildJsonObject { put("weight", weightUnit); put("distance", distanceUnit) }) })
    }
    return unwrap(ffiQalaSettingsToLiftoscript(request)).jsonObject
}

/**
 * Evaluates LS++ program text into an evaluated program. Ids come from `uidSeed`, so one text, settings and
 * seed always give the same program.
 */
fun QalaCore.evaluateProgramText(text: String, name: String, settings: JsonObject, uidSeed: Long = 0): JsonObject {
    val request = lspp {
        put("programText", text)
        put("name", name)
        put("settings", settings)
        uids(this, uidSeed)
    }
    return unwrap(ffiForceEvaluateText(request)).jsonObject
}

/** The day view of an evaluated program (`{dayData, exercises}`), null when the program has no such day. */
fun QalaCore.programDay(program: JsonObject, day: Int): JsonObject? {
    val result = unwrap(ffiGetDay(lspp { put("program", program); put("day", day) }))
    return if (result is JsonNull) null else result.jsonObject
}

/** The history entry a program day prescribes for one exercise (its sets, with weights resolved). */
fun QalaCore.nextEntry(
    program: JsonObject,
    day: Int,
    exerciseKey: String,
    index: Int,
    settings: JsonObject,
    uidSeed: Long = 0,
): JsonObject = unwrap(
    ffiNextHistoryEntry(
        lspp {
            put("program", program)
            put("day", day)
            put("exerciseKey", exerciseKey)
            put("index", index)
            put("stats", EmptyStats)
            put("settings", settings)
            uids(this, uidSeed)
        },
    ),
).jsonObject

/** Runs the finish-day scripts of the completed [entries] for [day] and returns the advanced program. */
fun QalaCore.finishDay(
    program: JsonObject,
    day: Int,
    entries: List<JsonObject>,
    settings: JsonObject,
    uidSeed: Long = 0,
): FinishDayResult {
    val result = unwrap(
        ffiRunAllFinishDayScripts(
            lspp {
                put("program", program)
                put("day", day)
                put("entries", JsonArray(entries))
                put("stats", EmptyStats)
                put("settings", settings)
                uids(this, uidSeed)
            },
        ),
    ).jsonObject
    return FinishDayResult(
        evaluatedProgram = result.getValue("evaluatedProgram").jsonObject,
        plannerText = result.getValue("plannerText").jsonPrimitive.content,
        nextDay = result.getValue("nextDay").jsonPrimitive.int,
        errors = result.getValue("errors").jsonArray.map { it.jsonPrimitive.content },
    )
}

private val EmptyStats: JsonObject = buildJsonObject {
    put("weight", buildJsonObject {})
    put("percentage", buildJsonObject {})
    put("length", buildJsonObject {})
}

/** The number of days of an evaluated program, counted over its weeks. */
fun QalaCore.dayCount(program: JsonObject): Int =
    program.getValue("weeks").jsonArray.sumOf { it.jsonObject.getValue("days").jsonArray.size }

/** The heading a program gives a 1-based [day] counted over all its weeks ("Day 3"), null when there is no such day. */
fun QalaCore.dayName(program: JsonObject, day: Int): String? =
    program.getValue("weeks").jsonArray
        .flatMap { it.jsonObject.getValue("days").jsonArray }
        .getOrNull(day - 1)
        ?.jsonObject?.get("name")?.jsonPrimitive?.content
