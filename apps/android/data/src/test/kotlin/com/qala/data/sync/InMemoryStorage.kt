package com.qala.data.sync

import com.qala.data.db.OutboxEntity
import kotlinx.serialization.json.JsonElement

/**
 * A [Transactor] and [RecordStorage] in memory, for testing RecordWriter on the JVM. A transaction that
 * throws rolls every write back, like Room's does. Records are plain field maps; a record created by a
 * partial write has just those fields.
 */
class InMemoryStorage : Transactor {
    val records = LinkedHashMap<Pair<RecordType, String>, LinkedHashMap<String, JsonElement>>()
    val clocks = LinkedHashMap<Pair<String, String>, Hlc>()
    val outbox = ArrayList<OutboxEntity>()
    val meta = LinkedHashMap<String, String>()

    /** Throws from [appendOutbox] once this many rows were appended in a transaction, to test rollback. */
    var failOutboxAfter: Int? = null
    private var appendedInTx = 0

    private class Snapshot(
        val records: Map<Pair<RecordType, String>, Map<String, JsonElement>>,
        val clocks: Map<Pair<String, String>, Hlc>,
        val outbox: List<OutboxEntity>,
        val meta: Map<String, String>,
    )

    private fun snapshot() = Snapshot(
        records.mapValues { LinkedHashMap(it.value) }, LinkedHashMap(clocks), ArrayList(outbox), LinkedHashMap(meta),
    )

    private fun restore(s: Snapshot) {
        records.clear(); s.records.forEach { (k, v) -> records[k] = LinkedHashMap(v) }
        clocks.clear(); clocks.putAll(s.clocks)
        outbox.clear(); outbox.addAll(s.outbox)
        meta.clear(); meta.putAll(s.meta)
    }

    override suspend fun <T> inTransaction(block: suspend RecordStorage.() -> T): T {
        val before = snapshot()
        appendedInTx = 0
        return try {
            Tx().block()
        } catch (e: Throwable) {
            restore(before)
            throw e
        }
    }

    private inner class Tx : RecordStorage {
        override suspend fun readFields(type: RecordType, id: String): Map<String, JsonElement>? =
            records[type to id]?.let { LinkedHashMap(it) }

        override suspend fun writeFields(type: RecordType, id: String, fields: Map<String, JsonElement>) {
            records.getOrPut(type to id) { LinkedHashMap() }.putAll(fields)
        }

        override suspend fun clock(recordId: String, field: String): Hlc? = clocks[recordId to field]

        override suspend fun putClock(recordId: String, field: String, hlc: Hlc) {
            clocks[recordId to field] = hlc
        }

        override suspend fun appendOutbox(row: OutboxEntity) {
            val limit = failOutboxAfter
            if (limit != null && appendedInTx >= limit) error("disk full")
            appendedInTx += 1
            outbox += row.copy(seq = (outbox.size + 1).toLong())
        }

        override suspend fun meta(key: String): String? = meta[key]

        override suspend fun putMeta(key: String, value: String) {
            meta[key] = value
        }
    }
}
