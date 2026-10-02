package com.qala.data.core

import com.qala.data.QalaJson
import com.qala.data.sync.ClockedField
import com.qala.data.sync.Hlc
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.builtins.serializer
import uniffi.qala_ffi.QalaException
import uniffi.qala_ffi.hlcCompare
import uniffi.qala_ffi.hlcMergeField
import uniffi.qala_ffi.hlcReceive
import uniffi.qala_ffi.hlcTick

/**
 * The typed face of the UniFFI library: each function encodes a request DTO, calls the Rust export, checks
 * the `{"v":1,"result":...}` envelope and decodes the result. Calls are synchronous and cheap but still
 * Rust and JSON work, so callers run them off the main thread (the repositories use Dispatchers.Default).
 * A failure from Rust surfaces as [QalaException] (`InvalidInput`, `Evaluation`, `Internal`).
 */
object QalaCore {
    /** The request version this client speaks; checked against the library once at startup. */
    const val API_VERSION = 1

    @Serializable
    private data class Envelope(val v: Int, val result: JsonElement = JsonNull)

    /** Decodes the envelope of a Rust response and returns its `result`. */
    internal fun unwrap(response: String): JsonElement {
        val envelope = QalaJson.decodeFromString(Envelope.serializer(), response)
        check(envelope.v == API_VERSION) { "unexpected response version ${envelope.v}" }
        return envelope.result
    }

    /** Encodes [request] under `"v": 1` next to its own fields. */
    internal fun <T> request(serializer: KSerializer<T>, request: T): String {
        val body = QalaJson.encodeToJsonElement(serializer, request) as JsonObject
        return JsonObject(body + ("v" to JsonPrimitive(API_VERSION))).toString()
    }

    internal fun <Req, Res> call(
        requestSerializer: KSerializer<Req>,
        resultSerializer: KSerializer<Res>,
        req: Req,
        export: (String) -> String,
    ): Res = QalaJson.decodeFromJsonElement(resultSerializer, unwrap(export(request(requestSerializer, req))))

    /** True when the library speaks the envelope version this client expects. */
    fun libraryMatches(): Boolean = uniffi.qala_ffi.apiVersion() == API_VERSION.toUInt()

    // ---- hybrid logical clock (qala-core hlc.rs) ----

    @Serializable
    private data class TickRequest(val hlc: Hlc, val nowMs: Long)

    @Serializable
    private data class ReceiveRequest(val local: Hlc, val remote: Hlc, val nowMs: Long, val maxDriftMs: Long)

    @Serializable
    private data class CompareRequest(val a: Hlc, val b: Hlc)

    @Serializable
    private data class MergeRequest(val local: ClockedField<JsonElement>, val remote: ClockedField<JsonElement>)

    /** The clock for a local event at physical time [nowMs]: always greater than [hlc]. */
    fun hlcTick(hlc: Hlc, nowMs: Long): Hlc =
        call(TickRequest.serializer(), Hlc.serializer(), TickRequest(hlc, nowMs), ::hlcTick)

    /** The clock after receiving a write stamped [remote]; [QalaException.Evaluation] on drift past [maxDriftMs]. */
    fun hlcReceive(local: Hlc, remote: Hlc, nowMs: Long, maxDriftMs: Long): Hlc = call(
        ReceiveRequest.serializer(), Hlc.serializer(),
        ReceiveRequest(local, remote, nowMs, maxDriftMs), ::hlcReceive,
    )

    /** -1, 0 or 1. */
    fun hlcCompare(a: Hlc, b: Hlc): Int = call(
        CompareRequest.serializer(), Int.serializer(),
        CompareRequest(a, b), ::hlcCompare,
    )

    /** The winner of two copies of one field: the higher clock; equal clocks keep [local]. */
    fun hlcMergeField(local: ClockedField<JsonElement>, remote: ClockedField<JsonElement>): ClockedField<JsonElement> =
        call(
            MergeRequest.serializer(),
            ClockedField.serializer(JsonElement.serializer()),
            MergeRequest(local, remote), ::hlcMergeField,
        )

    /** An empty request body with only the version, for calls that take no fields. */
    internal fun versionOnly(): String = buildJsonObject { put("v", API_VERSION) }.toString()
}
