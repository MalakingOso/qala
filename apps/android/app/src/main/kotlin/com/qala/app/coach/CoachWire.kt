package com.qala.app.coach

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * The wire contract of POST /api/coach/ask, mirrored from server/coach.ts (its header comment is the spec). The files in
 * testdata/golden/coach are the same bodies the server's tests produce; CoachWireTest builds and parses them here, so
 * a change on either side fails until both agree.
 */

/** Who spoke. The wire names are the web page's: "you" and "coach". */
@Serializable
enum class Who {
    @SerialName("you") You,
    @SerialName("coach") Coach,
}

@Serializable
data class WireTurn(val who: Who, val text: String)

/** Today's engine numbers for the lift the coach may adjust. [unit] is "lb" or "kg". */
@Serializable
data class WireLift(
    val title: String,
    val weight: Double,
    val unit: String,
    val sets: Int,
    val reps: Int,
    val rpe: Double? = null,
)

/** A fact the athlete accepted. The phone has none yet (there is no memory record), so [CoachRequestContext.memory] stays empty. */
@Serializable
data class WireMemory(val date: String, val source: String, val text: String)

@Serializable
data class CoachRequestContext(
    val today: String? = null,
    val checkIn: String? = null,
    val lift: WireLift? = null,
    val memory: List<WireMemory> = emptyList(),
)

@Serializable
data class CoachRequest(
    val message: String,
    val thread: List<WireTurn> = emptyList(),
    val context: CoachRequestContext? = null,
)

@Serializable
enum class ReplyStatus {
    @SerialName("ok") Ok,
    @SerialName("declined") Declined,
}

@Serializable
enum class SuggestionStatus {
    @SerialName("accepted") Accepted,
    @SerialName("clamped") Clamped,
}

/** What the coach may move, as the server enforces it, so the card prints the real limits. */
@Serializable
data class CoachLimits(val weightPctMin: Double, val weightPctMax: Double, val setsMin: Int, val setsMax: Int)

@Serializable
data class CoachNumbers(val weight: Double, val unit: String, val sets: Int, val reps: Int, val rpe: Double? = null)

@Serializable
data class CoachSuggestion(
    val title: String,
    val engine: CoachNumbers,
    val coach: CoachNumbers,
    val weightPct: Double,
    val setsDelta: Int,
    val reason: String,
    val status: SuggestionStatus,
)

@Serializable
data class CoachResponse(
    val status: ReplyStatus,
    val reply: String,
    val limits: CoachLimits,
    val suggestion: CoachSuggestion? = null,
)

/** Why the coach could not answer. Each has its own words on the screen, none of them blocks anything else. */
enum class Why {
    /** No connection, a timeout, or a server that is not there (a proxy's 502, 503 or 504 without the degraded body). */
    Unreachable,

    /** The server answered 502 with `degraded: true`: the model is down, slow or sent something unusable. */
    Degraded,

    /** 401: the request carried no identity, which is what the emulator does (nothing injects the Tailscale header). */
    NotRecognised,

    /** Any other status, or a 200 the app could not read. */
    Failed,
}

sealed interface CoachResult {
    class Answer(val response: CoachResponse) : CoachResult
    class Unavailable(val why: Why, val detail: String? = null) : CoachResult
}

/** The one place the coach is asked. A fake stands in for it in tests and in the debug demo. */
interface CoachClient {
    /** Never throws except for cancellation: every failure comes back as [CoachResult.Unavailable]. */
    suspend fun ask(request: CoachRequest): CoachResult
}

/** Encodes without defaults and nulls (the server treats a missing field as absent) and ignores fields it does not know. */
val CoachJson: Json = Json {
    encodeDefaults = false
    explicitNulls = false
    ignoreUnknownKeys = true
}

/** What came back for [status] and [body]; pure, so every branch is tested with canned JSON. */
fun parseCoachResult(status: Int, body: String): CoachResult = when {
    status == 200 -> try {
        CoachResult.Answer(CoachJson.decodeFromString<CoachResponse>(body))
    } catch (e: SerializationException) {
        CoachResult.Unavailable(Why.Failed, "the reply could not be read")
    } catch (e: IllegalArgumentException) {
        CoachResult.Unavailable(Why.Failed, "the reply could not be read")
    }
    status == 401 -> CoachResult.Unavailable(Why.NotRecognised, errorOf(body))
    status == 502 && degradedBody(body) != null -> CoachResult.Unavailable(Why.Degraded, degradedBody(body))
    status == 502 || status == 503 || status == 504 -> CoachResult.Unavailable(Why.Unreachable, "the server answered $status")
    else -> CoachResult.Unavailable(Why.Failed, errorOf(body) ?: "the server answered $status")
}

private fun bodyObject(body: String): JsonObject? =
    try {
        CoachJson.parseToJsonElement(body) as? JsonObject
    } catch (e: SerializationException) {
        null
    }

private fun errorOf(body: String): String? = (bodyObject(body)?.get("error") as? JsonPrimitive)?.contentOrNull

/** The server's `error` text when the body is the degraded shape `{ degraded: true, error }`, null for any other body. */
private fun degradedBody(body: String): String? {
    val obj = bodyObject(body) ?: return null
    if ((obj["degraded"] as? JsonPrimitive)?.booleanOrNull != true) return null
    return (obj["error"] as? JsonPrimitive)?.contentOrNull ?: "the coach is unavailable"
}
