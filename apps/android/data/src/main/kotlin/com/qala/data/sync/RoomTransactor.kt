package com.qala.data.sync

import androidx.room.withTransaction
import com.qala.data.db.MetaEntity
import com.qala.data.db.OutboxEntity
import com.qala.data.db.QalaDatabase
import com.qala.data.model.childRows
import com.qala.data.model.entryRecords
import kotlinx.serialization.json.JsonElement

/** Room's [Transactor]: one `withTransaction` per [inTransaction] call, so a failure rolls every write back. */
class RoomTransactor(private val db: QalaDatabase) : Transactor {
    override suspend fun <T> inTransaction(block: suspend RecordStorage.() -> T): T =
        db.withTransaction { RoomRecordStorage(db).block() }
}

/** One table's load, save and field mapping, so the storage code below is written once. */
private class Table<E : Any>(
    val codec: FieldCodec<E>,
    val load: suspend (String) -> E?,
    val save: suspend (E) -> Unit,
) {
    suspend fun read(id: String): Map<String, JsonElement>? = load(id)?.let(codec::toFields)

    suspend fun write(id: String, fields: Map<String, JsonElement>) {
        var entity = load(id) ?: codec.blank(id)
        for ((field, value) in fields) entity = codec.withField(entity, field, value)
        save(entity)
    }
}

internal class RoomRecordStorage(private val db: QalaDatabase) : RecordStorage {
    private val tables: Map<RecordType, Table<*>> = mapOf(
        RecordType.LIFT_SESSION to liftSessions(),
        RecordType.RUN_SESSION to Table(RunSessionCodec, db.runSessionDao()::row, db.runSessionDao()::upsert),
        RecordType.CHECK_IN to Table(CheckInCodec, db.checkInDao()::row, db.checkInDao()::upsert),
        RecordType.BODY_WEIGHT to Table(BodyWeightCodec, db.bodyWeightDao()::row, db.bodyWeightDao()::upsert),
        RecordType.DAY_SKIP to Table(DaySkipCodec, db.daySkipDao()::row, db.daySkipDao()::upsert),
        RecordType.AVAILABILITY to Table(AvailabilityCodec, db.availabilityDao()::row, db.availabilityDao()::upsert),
        RecordType.SETTINGS to Table(SettingsCodec, db.settingsDao()::row, db.settingsDao()::upsert),
        RecordType.PROGRAM to Table(ProgramCodec, db.programDao()::row, db.programDao()::upsert),
    )

    /** A session and its typed child rows; the children are rewritten only when `entries` changed. */
    private fun liftSessions(): Table<LiftSessionBundle> {
        val dao = db.liftSessionDao()
        return Table(
            codec = LiftSessionCodec,
            load = { id -> dao.withEntries(id)?.let { LiftSessionBundle(it.session, it.entryRecords()) } },
            save = { bundle ->
                val before = dao.withEntries(bundle.session.id)?.entryRecords()
                dao.upsert(bundle.session)
                if (before != bundle.entries) {
                    dao.deleteEntries(bundle.session.id)
                    val (entryRows, setRows) = childRows(bundle.session.id, bundle.entries)
                    dao.insertEntries(entryRows)
                    dao.insertSets(setRows)
                }
            },
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun table(type: RecordType) = tables.getValue(type) as Table<Any>

    override suspend fun readFields(type: RecordType, id: String) = table(type).read(id)

    override suspend fun writeFields(type: RecordType, id: String, fields: Map<String, JsonElement>) =
        table(type).write(id, fields)

    override suspend fun clock(recordId: String, field: String): Hlc? =
        db.fieldClockDao().get(recordId, field)?.let { Hlc(it.wallMs, it.counter, it.nodeId) }

    override suspend fun putClock(recordId: String, field: String, hlc: Hlc) =
        db.fieldClockDao().upsert(
            com.qala.data.db.FieldClockEntity(recordId, field, hlc.wallMs, hlc.counter, hlc.nodeId),
        )

    override suspend fun appendOutbox(row: OutboxEntity) {
        db.outboxDao().insert(row)
    }

    override suspend fun meta(key: String): String? = db.metaDao().get(key)

    override suspend fun putMeta(key: String, value: String) = db.metaDao().put(MetaEntity(key, value))
}
