package com.qala.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.qala_ffi.apiVersion
import uniffi.qala_ffi.calibrate
import uniffi.qala_ffi.predictReadiness

/**
 * Calls the Rust core through UniFFI on the JVM, with the host build of libqala_ffi (see the
 * cargoHostBuild task in app/build.gradle.kts). Proves the binding, the JSON envelope and the readiness
 * path end to end. The on-device run of the same call is EngineFfiInstrumentedTest.
 */
class EngineFfiTest {
    @Test
    fun envelopeVersionMatches() {
        assertEquals(1u, apiVersion())
    }

    @Test
    fun readinessOnEmptyHistoryIsFullScore() {
        val state = JSONObject(calibrate("""{"v":1,"history":[]}""")).getJSONObject("result")
        val req = JSONObject()
            .put("v", 1)
            .put("state", state)
            .put("checkin", JSONObject().put("prs", 8).put("soreness", JSONObject()))
            .put("now", "2026-10-02T08:00:00-04:00")
        val result = JSONObject(predictReadiness(req.toString())).getJSONObject("result")
        assertEquals(1.0, result.getDouble("score"), 1e-9)
        assertTrue(result.getJSONArray("reasons").length() == 0)
    }
}
