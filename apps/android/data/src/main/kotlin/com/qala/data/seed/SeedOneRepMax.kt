package com.qala.data.seed

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The 1RMs the seed's program evaluates under, as LS++ `ISettings.exerciseData`. The values are the ones the
 * LS++ goldens use (`gzclp_settings`): squat 200, bench 150, overhead press 110, deadlift 250 lb. GZCLP's
 * percentage weights resolve against them on the first lap; after a session the finish-day script writes
 * explicit weights into the program text.
 */
object SeedOneRepMax {
    val ExerciseData: JsonObject = buildJsonObject {
        for ((key, lb) in listOf(
            "squat_barbell" to 200,
            "benchPress_barbell" to 150,
            "overheadPress_barbell" to 110,
            "deadlift_barbell" to 250,
        )) {
            put(key, buildJsonObject { put("rm1", buildJsonObject { put("value", lb); put("unit", "lb") }) })
        }
    }
}
