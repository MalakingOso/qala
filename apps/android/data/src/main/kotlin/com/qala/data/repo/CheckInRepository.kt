package com.qala.data.repo

import com.qala.data.IsoTime
import com.qala.data.QalaJson
import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.QalaDatabase
import com.qala.data.sync.BodyWeightCodec
import com.qala.data.sync.CheckInCodec
import com.qala.data.sync.RecordType
import com.qala.data.sync.RecordWriter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/** Morning check-ins: recovery 0 to 10 and soreness 1 to 4 per engine muscle id. */
class CheckInRepository(
    private val db: QalaDatabase,
    private val writer: RecordWriter,
    private val env: RepoEnv = RepoEnv(),
) {
    /** Non-deleted check-ins, oldest first. */
    val checkIns: Flow<List<CheckInEntity>> = db.checkInDao().observeAll()

    suspend fun save(
        recovery: Double,
        soreness: Map<String, Int> = emptyMap(),
        note: String? = null,
        atMs: Long = env.clock.nowMs(),
        id: String? = null,
    ): String = withContext(env.work) {
        require(recovery in 0.0..10.0) { "recovery is 0 to 10" }
        require(soreness.values.all { it in 1..4 }) { "soreness is 1 to 4" }
        val checkInId = id ?: env.ids.next()
        val row = CheckInEntity(
            id = checkInId,
            atMs = atMs,
            offsetMin = IsoTime.offsetMinAt(env.clock.zone, atMs),
            recovery = recovery,
            sorenessJson = QalaJson.encodeToString(MapSerializer(String.serializer(), Int.serializer()), soreness),
            note = note,
            deleted = false,
        )
        writer.put(RecordType.CHECK_IN, checkInId, CheckInCodec.toFields(row))
        checkInId
    }

    suspend fun delete(id: String) = writer.delete(RecordType.CHECK_IN, id)

    suspend fun restore(id: String) = writer.restore(RecordType.CHECK_IN, id)
}

/** Body weights in kilograms, one record per weigh-in dated by the local day. */
class BodyWeightRepository(
    private val db: QalaDatabase,
    private val writer: RecordWriter,
    private val env: RepoEnv = RepoEnv(),
) {
    /** Non-deleted weights, oldest date first. */
    val weights: Flow<List<BodyWeightEntity>> = db.bodyWeightDao().observeAll()

    suspend fun log(date: String, kg: Double, id: String? = null): String = withContext(env.work) {
        require(kg.isFinite() && kg > 0) { "weight must be positive" }
        val weightId = id ?: env.ids.next()
        writer.put(RecordType.BODY_WEIGHT, weightId, BodyWeightCodec.toFields(BodyWeightEntity(weightId, date, kg, false)))
        weightId
    }

    suspend fun delete(id: String) = writer.delete(RecordType.BODY_WEIGHT, id)
}
