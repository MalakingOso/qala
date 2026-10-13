package com.qala.data.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import uniffi.qala_ffi.runFinishDayScript as ffiRunFinishDayScript
import uniffi.qala_ffi.runUpdateScriptForEntry as ffiRunUpdateScriptForEntry

/*
 * The two per-exercise LS++ script calls the lifting screens use, next to `nextEntry` and `finishDay` in
 * QalaCoreEngine.kt. Entries, programs and settings stay LS++'s own JSON and go back in untouched.
 */

private fun lifting(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): String =
    buildJsonObject {
        put("v", QalaCore.API_VERSION)
        build()
    }.toString()

private val EmptyStatsJson: JsonObject = buildJsonObject {
    put("weight", buildJsonObject {})
    put("percentage", buildJsonObject {})
    put("length", buildJsonObject {})
}

/**
 * Runs the update script of one exercise after the set at [setIndex] (0-based) of [entry] was completed, and returns
 * the entry the script left: the same sets when the exercise has no update script or the set is not completed, else
 * its sets with whatever the script changed (later weights and reps, a changed number of sets). [entry] must carry the
 * completed set as `isCompleted`, `completedReps` and `completedWeight`. A script error surfaces as
 * `QalaException.Evaluation`.
 */
fun QalaCore.runUpdateScript(
    program: JsonObject,
    day: Int,
    exerciseKey: String,
    entry: JsonObject,
    setIndex: Int,
    settings: JsonObject,
    otherStates: JsonObject = JsonObject(emptyMap()),
    uidSeed: Long = 0,
): JsonObject = unwrap(
    ffiRunUpdateScriptForEntry(
        lifting {
            put("program", program)
            put("day", day)
            put("exerciseKey", exerciseKey)
            put("entry", entry)
            put("otherStates", otherStates)
            put("setIndex", setIndex)
            put("stats", EmptyStatsJson)
            put("settings", settings)
            put("uidSeed", uidSeed)
        },
    ),
).jsonObject

/**
 * Runs the finish-day script of one exercise without folding anything back into the program, so a screen can read what
 * the exercise's progression would do. Returns the TS `IEither`: `{success: true, data: {state, updates, bindings}}`,
 * or `{success: false, error}` when the script fails. The program itself is advanced by [finishDay], which runs every
 * exercise of the day.
 */
fun QalaCore.runFinishDayScript(
    program: JsonObject,
    day: Int,
    exerciseKey: String,
    entry: JsonObject,
    settings: JsonObject,
): JsonObject = unwrap(
    ffiRunFinishDayScript(
        lifting {
            put("program", program)
            put("day", day)
            put("exerciseKey", exerciseKey)
            put("entry", entry)
            put("stats", EmptyStatsJson)
            put("settings", settings)
        },
    ),
).jsonObject
