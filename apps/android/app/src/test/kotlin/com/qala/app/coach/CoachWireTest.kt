package com.qala.app.coach

import java.io.File
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reads testdata/golden/coach, the bodies server/coach_test.ts checks the route against. Gradle runs unit tests in the module directory. */
object CoachFixtures {
    private val root = File("../../..").canonicalFile

    fun text(name: String): String = File(root, "testdata/golden/coach/$name").also { check(it.exists()) { "missing $name under $root" } }.readText()

    /** The request the fixture holds, as the app would build it. */
    val request = CoachRequest(
        message = "Why 245 on squat today?",
        thread = listOf(
            WireTurn(Who.You, "How is my recovery looking?"),
            WireTurn(Who.Coach, "Readiness is fine, but your quads are still sore from Friday."),
        ),
        context = CoachRequestContext(
            today = "Lower A",
            checkIn = "recovery 7, quads 4",
            lift = WireLift("Squat top set", 245.0, "lb", 4, 4, 8.0),
            memory = listOf(WireMemory("2026-09-12", "user", "Sleeps 6 h on weeknights.")),
        ),
    )
}

/** Numbers compare as numbers (245 and 245.0 are the same weight); everything else compares as written. */
private fun normalised(e: JsonElement): Any? = when (e) {
    is JsonObject -> e.mapValues { normalised(it.value) }
    is JsonArray -> e.map(::normalised)
    is JsonPrimitive -> if (e.isString) e.content else e.doubleOrNull ?: e.content
}

class CoachWireTest {
    private fun answer(status: Int, body: String) = parseCoachResult(status, body) as CoachResult.Answer
    private fun unavailable(status: Int, body: String) = parseCoachResult(status, body) as CoachResult.Unavailable

    @Test
    fun theRequestTheAppBuildsIsTheRequestTheServerTestsSend() {
        val encoded = CoachJson.parseToJsonElement(CoachJson.encodeToString(CoachFixtures.request))
        val fixture = CoachJson.parseToJsonElement(CoachFixtures.text("ask_request.json"))
        assertEquals(normalised(fixture), normalised(encoded))
        assertEquals(CoachFixtures.request, CoachJson.decodeFromString<CoachRequest>(CoachFixtures.text("ask_request.json")))
    }

    @Test
    fun aRequestWithNothingElseIsJustTheMessage() {
        val json = CoachJson.encodeToString(CoachRequest("How is my recovery?"))
        assertEquals("""{"message":"How is my recovery?"}""", json)
    }

    @Test
    fun theOkFixtureParsesWithItsSuggestionAndLimits() {
        val r = answer(200, CoachFixtures.text("ask_ok.json")).response
        assertEquals(ReplyStatus.Ok, r.status)
        assertTrue(r.reply.startsWith("The engine has 245"))
        assertEquals(CoachLimits(-10.0, 2.5, -2, 1), r.limits)
        val s = r.suggestion!!
        assertEquals("Squat top set", s.title)
        assertEquals(CoachNumbers(245.0, "lb", 4, 4, 8.0), s.engine)
        assertEquals(CoachNumbers(240.0, "lb", 4, 4, 8.0), s.coach)
        assertEquals(-2.0, s.weightPct, 0.0)
        assertEquals(0, s.setsDelta)
        assertEquals("Quads still sore (4). Small pullback, same reps.", s.reason)
        assertEquals(SuggestionStatus.Accepted, s.status)
    }

    @Test
    fun theDeclinedFixtureIsAnAnswerWithoutASuggestion() {
        val r = answer(200, CoachFixtures.text("ask_declined.json")).response
        assertEquals(ReplyStatus.Declined, r.status)
        assertNull(r.suggestion)
        assertTrue(r.reply.contains("training coach"))
    }

    @Test
    fun aClampedSuggestionKeepsItsStatus() {
        val body = CoachFixtures.text("ask_ok.json").replace("\"accepted\"", "\"clamped\"")
        assertEquals(SuggestionStatus.Clamped, answer(200, body).response.suggestion!!.status)
    }

    @Test
    fun theDegradedFixtureIsTheModelBeingDown() {
        val r = unavailable(502, CoachFixtures.text("ask_degraded.json"))
        assertEquals(Why.Degraded, r.why)
        assertEquals("fetch failed: connection refused", r.detail)
    }

    @Test
    fun theUnauthorizedFixtureIsThePhoneNotBeingRecognised() {
        val r = unavailable(401, CoachFixtures.text("ask_unauthorized.json"))
        assertEquals(Why.NotRecognised, r.why)
        assertEquals("missing Tailscale identity", r.detail)
    }

    @Test
    fun aProxyThatCannotReachTheServerIsUnreachableNotDegraded() {
        for (status in listOf(502, 503, 504)) {
            val r = unavailable(status, "<html>Bad Gateway</html>")
            assertEquals("status $status", Why.Unreachable, r.why)
        }
        // 502 with a JSON body that is not the degraded shape is still the proxy's.
        assertEquals(Why.Unreachable, unavailable(502, """{"error":"upstream"}""").why)
        assertEquals(Why.Unreachable, unavailable(502, """{"degraded":false,"error":"x"}""").why)
    }

    @Test
    fun otherStatusesAreFailedWithTheServersReasonWhenItGaveOne() {
        val r = unavailable(400, """{"error":"message is required"}""")
        assertEquals(Why.Failed, r.why)
        assertEquals("message is required", r.detail)
        assertEquals("the server answered 500", unavailable(500, "oops").detail)
        assertEquals(Why.Failed, unavailable(413, """{"error":"request body too large"}""").why)
    }

    @Test
    fun aReplyTheAppCannotReadIsFailedAndNeverAThrow() {
        val bad = listOf(
            "",
            "not json",
            "[]",
            "{}",
            """{"status":"weird","reply":"x","limits":{"weightPctMin":-10,"weightPctMax":2.5,"setsMin":-2,"setsMax":1}}""",
            """{"status":"ok","reply":7,"limits":{}}""",
            """{"status":"ok","reply":"x","limits":{"weightPctMin":-10,"weightPctMax":2.5,"setsMin":-2,"setsMax":1},"suggestion":{"title":"t"}}""",
        )
        for (body in bad) {
            val r = unavailable(200, body)
            assertEquals("body: $body", Why.Failed, r.why)
        }
    }

    @Test
    fun odd401And502BodiesDoNotThrow() {
        assertEquals(Why.NotRecognised, unavailable(401, "").why)
        assertNull(unavailable(401, "not json").detail)
        assertNull(unavailable(401, """{"error":{"code":1}}""").detail)
        val degraded = unavailable(502, """{"degraded":true,"error":{"code":1}}""")
        assertEquals(Why.Degraded, degraded.why)
        assertNotNull(degraded.detail)
        assertEquals(Why.Degraded, unavailable(502, """{"degraded":true}""").why)
    }

    @Test
    fun fieldsTheAppDoesNotKnowAreIgnored() {
        val body = CoachFixtures.text("ask_ok.json").replaceFirst("{", """{"extra":{"a":1},""")
        assertEquals(ReplyStatus.Ok, answer(200, body).response.status)
    }
}
