package com.qala.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.qala_ffi.apiVersion
import uniffi.qala_ffi.calibrate
import uniffi.qala_ffi.predictReadiness

/** Loads libqala_ffi.so from the APK on a device and runs readiness through it (M1 exit gate). */
@RunWith(AndroidJUnit4::class)
class EngineFfiInstrumentedTest {
    @Test
    fun readinessThroughTheNativeLibrary() {
        assertEquals(1u, apiVersion())
        val state = JSONObject(calibrate("""{"v":1,"history":[]}""")).getJSONObject("result")
        val req = JSONObject()
            .put("v", 1)
            .put("state", state)
            .put("checkin", JSONObject().put("prs", 8).put("soreness", JSONObject()))
            .put("now", "2026-10-02T08:00:00-04:00")
        val result = JSONObject(predictReadiness(req.toString())).getJSONObject("result")
        assertEquals(1.0, result.getDouble("score"), 1e-9)
    }
}
