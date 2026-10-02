package com.qala.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/**
 * The one JSON configuration for the Rust boundary and the record fields. Requests carry their defaults
 * (`"v": 1`, `stub: false`) so the core sees complete records; nulls are left out, which is how serde's
 * `skip_serializing_if = "Option::is_none"` writes them; results may carry fields this client does not know.
 */
val QalaJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

// Small readers for field values: a JSON null or a missing value reads as null, a wrong type throws.

internal fun String?.toJson(): JsonElement = if (this == null) JsonNull else JsonPrimitive(this)
internal fun Double?.toJson(): JsonElement = if (this == null) JsonNull else JsonPrimitive(this)
internal fun Int?.toJson(): JsonElement = if (this == null) JsonNull else JsonPrimitive(this)
internal fun Long.toJson(): JsonElement = JsonPrimitive(this)
internal fun Boolean.toJson(): JsonElement = JsonPrimitive(this)

private fun JsonElement.primitiveOrNull(): JsonPrimitive? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }

internal fun JsonElement.stringOrNull(): String? = primitiveOrNull()?.let {
    require(it.isString) { "expected a JSON string, got $it" }
    it.content
}

internal fun JsonElement.doubleOrNull(): Double? = primitiveOrNull()?.let {
    it.doubleOrNull ?: error("expected a JSON number, got $it")
}

internal fun JsonElement.intOrNull(): Int? = primitiveOrNull()?.let {
    it.intOrNull ?: error("expected a JSON integer, got $it")
}

internal fun JsonElement.longOrNull(): Long? = primitiveOrNull()?.let {
    it.longOrNull ?: error("expected a JSON integer, got $it")
}

internal fun JsonElement.boolOrNull(): Boolean? = primitiveOrNull()?.let {
    it.booleanOrNull ?: error("expected a JSON boolean, got $it")
}

internal fun JsonElement.string(): String = stringOrNull() ?: error("expected a JSON string, got null")
internal fun JsonElement.double(): Double = doubleOrNull() ?: error("expected a JSON number, got null")
internal fun JsonElement.int(): Int = intOrNull() ?: error("expected a JSON integer, got null")
internal fun JsonElement.long(): Long = longOrNull() ?: error("expected a JSON integer, got null")
internal fun JsonElement.bool(): Boolean = boolOrNull() ?: error("expected a JSON boolean, got null")
