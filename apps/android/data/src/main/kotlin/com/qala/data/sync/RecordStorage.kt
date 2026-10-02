package com.qala.data.sync

import com.qala.data.db.OutboxEntity
import kotlinx.serialization.json.JsonElement

/**
 * Everything RecordWriter needs from storage, inside one transaction. Room implements it ([RoomTransactor]);
 * the unit tests implement it in memory, so the clock, outbox and ordering rules are tested on the JVM.
 */
interface RecordStorage {
    /** The record's current field values, or null when the record does not exist (a tombstone still exists). */
    suspend fun readFields(type: RecordType, id: String): Map<String, JsonElement>?

    /**
     * Writes the named fields of a record, creating it (every other field at its zero value) when it does
     * not exist. Touches nothing else.
     */
    suspend fun writeFields(type: RecordType, id: String, fields: Map<String, JsonElement>)

    /** The clock of the last write to one field, or null when the field was never written. */
    suspend fun clock(recordId: String, field: String): Hlc?

    suspend fun putClock(recordId: String, field: String, hlc: Hlc)

    suspend fun appendOutbox(row: OutboxEntity)

    suspend fun meta(key: String): String?

    suspend fun putMeta(key: String, value: String)
}

/** Runs [block] atomically: either every write inside it lands, or none does. */
interface Transactor {
    suspend fun <T> inTransaction(block: suspend RecordStorage.() -> T): T
}
