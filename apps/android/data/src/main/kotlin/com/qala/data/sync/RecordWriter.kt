package com.qala.data.sync

import com.qala.data.core.QalaCore
import com.qala.data.db.MetaKeys
import com.qala.data.db.OutboxEntity
import java.security.SecureRandom
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import uniffi.qala_ffi.QalaException

/** The clock operations RecordWriter needs. They run in Rust ([RustHlc]); tests may substitute their own. */
interface HlcOps {
    fun tick(hlc: Hlc, nowMs: Long): Hlc
    fun receive(local: Hlc, remote: Hlc, nowMs: Long, maxDriftMs: Long): Hlc
    fun mergeField(local: ClockedField<JsonElement>, remote: ClockedField<JsonElement>): ClockedField<JsonElement>
}

/** The Rust implementation, through [QalaCore]. */
object RustHlc : HlcOps {
    override fun tick(hlc: Hlc, nowMs: Long) = QalaCore.hlcTick(hlc, nowMs)
    override fun receive(local: Hlc, remote: Hlc, nowMs: Long, maxDriftMs: Long) =
        QalaCore.hlcReceive(local, remote, nowMs, maxDriftMs)

    override fun mergeField(local: ClockedField<JsonElement>, remote: ClockedField<JsonElement>) =
        QalaCore.hlcMergeField(local, remote)
}

/** One record to create or one set of fields to write: `fields` is field name to JSON value, in write order. */
data class RecordWrite(val type: RecordType, val id: String, val fields: Map<String, JsonElement>)

/** One field of one record as another device wrote it. */
data class RemoteChange(
    val type: RecordType,
    val recordId: String,
    val field: String,
    val value: JsonElement,
    val hlc: Hlc,
)

sealed interface ApplyResult {
    /** The remote write had the higher clock and is now the field's value. */
    data object Applied : ApplyResult

    /** The local write is newer or equal; nothing changed. */
    data object Stale : ApplyResult

    /** The change could not be applied: an unknown field, an invalid clock, or a clock too far ahead. */
    data class Rejected(val reason: String) : ApplyResult
}

/**
 * The only code that writes record tables (docs/archive/completed.md, M2 as built). One call is one
 * transaction: tick the HLC (Rust `hlc_tick` at `nowMs`), write the entity rows, upsert a `field_clock`
 * row for every field written, append one outbox row per field, and persist the new HLC to `meta`.
 * A call ticks once, so every field it writes carries the same clock; that is safe because clocks are
 * compared per field, and the node id keeps them unique across devices.
 *
 * An update touches only the fields it names. The outbox is drained by the future sync client in `seq`
 * order, which is the order written here: records in the order given, fields in map order (canonical order
 * for a record built by a repository, with `deleted` last).
 */
class RecordWriter(
    private val transactor: Transactor,
    private val ops: HlcOps = RustHlc,
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val newNodeId: () -> String = { randomNodeId() },
    private val rustDispatcher: CoroutineDispatcher = Dispatchers.Default,
) {
    /**
     * Creates each record, or writes the named fields of one that exists (so a re-skip of a day or a settings
     * leaf is the same call). A new record also gets `deleted = false` unless the fields say otherwise.
     * All of it is one transaction with one clock tick.
     */
    suspend fun write(vararg writes: RecordWrite) = write(writes.toList())

    suspend fun write(writes: List<RecordWrite>) {
        for (w in writes) require(w.fields.isNotEmpty()) { "no fields for ${w.type.wire} ${w.id}" }
        writes.forEach(::validate)
        clocked { hlc, createdAtMs ->
            for (w in writes) {
                val isNew = readFields(w.type, w.id) == null
                val fields = if (isNew && DELETED !in w.fields) w.fields + (DELETED to JsonPrimitive(false)) else w.fields
                writeRecord(w.type, w.id, fields, hlc, createdAtMs)
            }
        }
    }

    suspend fun put(type: RecordType, id: String, fields: Map<String, JsonElement>) =
        write(RecordWrite(type, id, fields))

    /** Writes only the named fields of an existing record; [IllegalStateException] when it does not exist. */
    suspend fun update(type: RecordType, id: String, fields: Map<String, JsonElement>) {
        val w = RecordWrite(type, id, fields)
        require(fields.isNotEmpty()) { "no fields for ${type.wire} $id" }
        validate(w)
        clocked { hlc, createdAtMs ->
            checkNotNull(readFields(type, id)) { "no ${type.wire} record $id" }
            writeRecord(type, id, fields, hlc, createdAtMs)
        }
    }

    /** A delete is a clocked write of `deleted = true`; the record stays so the delete can sync. */
    suspend fun delete(type: RecordType, id: String) = update(type, id, mapOf(DELETED to JsonPrimitive(true)))

    /** A later write of `deleted = false`. */
    suspend fun restore(type: RecordType, id: String) = update(type, id, mapOf(DELETED to JsonPrimitive(false)))

    /**
     * Merges one field written on another device: the higher clock wins (`hlc_merge_field`, equal clocks keep
     * the local value). The local clock also moves past the remote one (`hlc_receive`, one day of drift
     * allowed), and nothing goes to the outbox: a remote write is not sent back. Unit tested; nothing calls
     * it until the sync endpoint exists.
     */
    suspend fun applyRemote(change: RemoteChange): ApplyResult = transactor.inTransaction {
        val known = knownFields(change.type)
        if (known != null && change.field !in known) {
            return@inTransaction ApplyResult.Rejected("unknown ${change.type.wire} field ${change.field}")
        }
        val node = nodeId()
        val last = meta(MetaKeys.HLC)?.let(::parseStored) ?: Hlc.zero(node)
        val received = try {
            withContext(rustDispatcher) { ops.receive(last, change.hlc, nowMs(), MAX_DRIFT_MS) }
        } catch (e: QalaException) {
            return@inTransaction ApplyResult.Rejected(e.message ?: "invalid clock")
        }
        putMeta(MetaKeys.HLC, received.toString())

        val local = clock(change.recordId, change.field)
        val winner: ClockedField<JsonElement>? = if (local == null) {
            ClockedField(change.value, change.hlc)
        } else {
            val localValue = readFields(change.type, change.recordId)?.get(change.field) ?: JsonNull
            val merged = withContext(rustDispatcher) {
                ops.mergeField(ClockedField(localValue, local), ClockedField(change.value, change.hlc))
            }
            if (merged.hlc == change.hlc && change.hlc != local) merged else null
        }
        if (winner == null) return@inTransaction ApplyResult.Stale
        writeFields(change.type, change.recordId, mapOf(change.field to winner.value))
        putClock(change.recordId, change.field, winner.hlc)
        ApplyResult.Applied
    }

    // ---- internals ----

    private fun validate(w: RecordWrite) {
        val known = knownFields(w.type) ?: return
        val unknown = w.fields.keys.filter { it !in known }
        require(unknown.isEmpty()) { "${w.type.wire} has no field ${unknown.joinToString()}" }
    }

    /** Opens the transaction, issues the one clock for this call and persists it afterwards. */
    private suspend fun clocked(block: suspend RecordStorage.(Hlc, Long) -> Unit) {
        transactor.inTransaction {
            val node = nodeId()
            val last = meta(MetaKeys.HLC)?.let(::parseStored) ?: Hlc.zero(node)
            val now = nowMs()
            val hlc = withContext(rustDispatcher) { ops.tick(last, now) }
            this.block(hlc, now)
            putMeta(MetaKeys.HLC, hlc.toString())
        }
    }

    private suspend fun RecordStorage.nodeId(): String =
        meta(MetaKeys.NODE_ID) ?: newNodeId().also { putMeta(MetaKeys.NODE_ID, it) }

    private suspend fun RecordStorage.writeRecord(
        type: RecordType,
        id: String,
        fields: Map<String, JsonElement>,
        hlc: Hlc,
        createdAtMs: Long,
    ) {
        writeFields(type, id, fields)
        for ((field, value) in fields) {
            putClock(id, field, hlc)
            appendOutbox(
                OutboxEntity(
                    recordType = type.wire,
                    recordId = id,
                    field = field,
                    valueJson = value.toString(),
                    hlc = hlc.toString(),
                    createdAtMs = createdAtMs,
                ),
            )
        }
    }

    private fun parseStored(text: String): Hlc = checkNotNull(Hlc.parse(text)) { "corrupt stored clock: $text" }

    companion object {
        /** A remote clock more than a day ahead of this device's is refused (docs/rust-core.md, Clock skew). */
        const val MAX_DRIFT_MS: Long = 24L * 60 * 60 * 1000

        /** Random 128-bit hex, never derived from device data. */
        fun randomNodeId(): String {
            val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}
