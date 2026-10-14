package com.qala.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.qala_ffi.QalaException
import uniffi.qala_ffi.dryRun
import uniffi.qala_ffi.formatPlanner
import uniffi.qala_ffi.lintPlanner
import uniffi.qala_ffi.qalaSettingsToLiftoscript
import uniffi.qala_ffi.unresolvedSets

/**
 * The dry run and editor tools of LS++ (dry run, unresolved sets, lint, format) called through UniFFI on the JVM, with
 * the host build of libqala_ffi. Each test proves that the generated binding exists, that a request and its envelope
 * cross the boundary, and that a bad request comes back as a [QalaException].
 */
class LsppToolsFfiTest {
    private fun result(envelope: String): JSONObject = JSONObject(envelope).getJSONObject("result")

    private fun settings(): JSONObject = result(
        qalaSettingsToLiftoscript("""{"v":1,"coreSettings":{"units":{"weight":"lb","distance":"mi"}}}"""),
    )

    @Test
    fun dryRunProgressesTheProgramAcrossSessions() {
        val text = "# Week 1\n## Day 1\nSquat / 3x5 100lb / progress: custom(increment: 5lb) {~\n  weights += state.increment\n~}\n"
        val request = JSONObject()
            .put("v", 1)
            .put("programText", text)
            .put("name", "t")
            .put("settings", settings())
            .put("sessions", 2)
        val out = result(dryRun(request.toString()))
        val sessions = out.getJSONArray("sessions")
        assertEquals(2, sessions.length())
        fun firstWeight(i: Int) = sessions.getJSONObject(i).getJSONArray("exercises").getJSONObject(0)
            .getJSONArray("sets").getJSONObject(0).getJSONObject("weight").getDouble("value")
        assertEquals(100.0, firstWeight(0), 0.0)
        assertEquals(105.0, firstWeight(1), 0.0)
        assertEquals(0, out.getInt("blankSets"))
        assertTrue(out.getString("finalText").contains("110lb"))
    }

    @Test
    fun dryRunRejectsARequestWithoutAProgram() {
        assertThrows(QalaException.InvalidInput::class.java) { dryRun("""{"v":1,"settings":{}}""") }
        assertThrows(QalaException.InvalidInput::class.java) { dryRun("{}") }
    }

    @Test
    fun unresolvedSetsListsTheBlankWeights() {
        val request = JSONObject()
            .put("v", 1)
            .put("programText", "# Week 1\n## Day 1\nSplit Squat / 2x8 ?+\nBench Press / 3x5 100lb\n")
            .put("settings", settings())
        val sets = JSONObject(unresolvedSets(request.toString())).getJSONArray("result")
        assertEquals(2, sets.length())
        val first = sets.getJSONObject(0)
        assertEquals("blank", first.getString("state"))
        assertEquals("Split Squat", first.getString("exerciseName"))
        assertEquals(0, first.getInt("setIndex"))
        assertEquals(1, sets.getJSONObject(1).getInt("setIndex"))
        assertThrows(QalaException.InvalidInput::class.java) { unresolvedSets("{}") }
    }

    @Test
    fun lintPlannerFlagsTooManySets() {
        val findings = JSONObject(lintPlanner("# Week 1\n## Day 1\nSquat / 31x5 100lb\n")).getJSONArray("result")
        assertEquals(1, findings.length())
        assertEquals("too-many-sets", findings.getJSONObject(0).getString("code"))
        assertEquals(3, findings.getJSONObject(0).getInt("line"))
        assertEquals(0, JSONObject(lintPlanner("# Week 1\n## Day 1\nSquat / 3x5 100lb\n")).getJSONArray("result").length())
    }

    @Test
    fun formatPlannerTidiesTextAndRefusesBrokenText() {
        val tidy = result(formatPlanner("Squat/3x5   100lb"))
        assertTrue(tidy.getBoolean("ok"))
        assertEquals("Squat / 3x5 100lb\n", tidy.getString("text"))
        assertTrue(tidy.getBoolean("changed"))
        assertFalse(result(formatPlanner("Squat / 3x5 100lb\n")).getBoolean("changed"))
        val refused = result(formatPlanner("Squat / 3x"))
        assertFalse(refused.getBoolean("ok"))
        assertEquals("syntax", refused.getString("reason"))
        assertEquals(1, refused.getJSONArray("diagnostics").getJSONObject(0).getInt("line"))
    }
}
