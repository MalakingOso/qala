package com.qala.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/*
 * Record tables are written only by RecordWriter, so the `upsert` and insert functions here are internal to
 * the module's write path; the observe functions are what repositories expose. Reads of live data filter
 * tombstones (`deleted = 0`); the by-id reads include them so a restore can find the row.
 */

@Dao
interface LiftSessionDao {
    @Transaction
    @Query("SELECT * FROM lift_session WHERE deleted = 0 ORDER BY startedAtMs, id")
    fun observeAll(): Flow<List<LiftSessionWithEntries>>

    /** Session rows alone, for callers that only need dates and flags. */
    @Query("SELECT * FROM lift_session WHERE deleted = 0 ORDER BY startedAtMs, id")
    fun observeRows(): Flow<List<LiftSessionEntity>>

    @Query("SELECT * FROM lift_session WHERE id = :id")
    suspend fun row(id: String): LiftSessionEntity?

    @Transaction
    @Query("SELECT * FROM lift_session WHERE id = :id")
    suspend fun withEntries(id: String): LiftSessionWithEntries?

    @Upsert
    suspend fun upsert(session: LiftSessionEntity)

    @Query("DELETE FROM lift_entry WHERE sessionId = :sessionId")
    suspend fun deleteEntries(sessionId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEntries(entries: List<LiftEntryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSets(sets: List<LiftSetEntity>)
}

@Dao
interface RunSessionDao {
    @Query("SELECT * FROM run_session WHERE deleted = 0 ORDER BY startedAtMs, id")
    fun observeAll(): Flow<List<RunSessionEntity>>

    @Query("SELECT * FROM run_session WHERE id = :id")
    suspend fun row(id: String): RunSessionEntity?

    @Upsert
    suspend fun upsert(run: RunSessionEntity)
}

@Dao
interface CheckInDao {
    @Query("SELECT * FROM check_in WHERE deleted = 0 ORDER BY atMs, id")
    fun observeAll(): Flow<List<CheckInEntity>>

    @Query("SELECT * FROM check_in WHERE id = :id")
    suspend fun row(id: String): CheckInEntity?

    @Upsert
    suspend fun upsert(checkIn: CheckInEntity)
}

@Dao
interface BodyWeightDao {
    @Query("SELECT * FROM body_weight WHERE deleted = 0 ORDER BY date, id")
    fun observeAll(): Flow<List<BodyWeightEntity>>

    @Query("SELECT * FROM body_weight WHERE id = :id")
    suspend fun row(id: String): BodyWeightEntity?

    @Upsert
    suspend fun upsert(weight: BodyWeightEntity)
}

@Dao
interface DaySkipDao {
    @Query("SELECT * FROM day_skip WHERE deleted = 0 ORDER BY date")
    fun observeAll(): Flow<List<DaySkipEntity>>

    @Query("SELECT * FROM day_skip WHERE id = :id")
    suspend fun row(id: String): DaySkipEntity?

    @Upsert
    suspend fun upsert(skip: DaySkipEntity)
}

@Dao
interface AvailabilityDao {
    @Query("SELECT * FROM availability WHERE id = '${AvailabilityIds.ROW}' AND deleted = 0")
    fun observe(): Flow<AvailabilityEntity?>

    @Query("SELECT * FROM availability WHERE id = :id")
    suspend fun row(id: String): AvailabilityEntity?

    @Upsert
    suspend fun upsert(availability: AvailabilityEntity)
}

@Dao
interface SettingsDao {
    @Query("SELECT * FROM settings WHERE deleted = 0")
    fun observeAll(): Flow<List<SettingsEntity>>

    @Query("SELECT * FROM settings WHERE id = :id")
    suspend fun row(id: String): SettingsEntity?

    @Upsert
    suspend fun upsert(settings: SettingsEntity)
}

@Dao
interface ProgramDao {
    @Query("SELECT * FROM program WHERE deleted = 0 ORDER BY id")
    fun observeAll(): Flow<List<ProgramEntity>>

    @Query("SELECT * FROM program WHERE id = :id")
    suspend fun row(id: String): ProgramEntity?

    @Upsert
    suspend fun upsert(program: ProgramEntity)
}

@Dao
interface FieldClockDao {
    @Query("SELECT * FROM field_clock WHERE recordId = :recordId AND field = :field")
    suspend fun get(recordId: String, field: String): FieldClockEntity?

    @Query("SELECT * FROM field_clock WHERE recordId = :recordId ORDER BY field")
    suspend fun forRecord(recordId: String): List<FieldClockEntity>

    @Upsert
    suspend fun upsert(clock: FieldClockEntity)
}

@Dao
interface OutboxDao {
    @Insert
    suspend fun insert(row: OutboxEntity): Long

    /** The oldest rows first: the order the sync client sends them in. */
    @Query("SELECT * FROM outbox ORDER BY seq LIMIT :limit")
    suspend fun pending(limit: Int): List<OutboxEntity>

    @Query("SELECT COUNT(*) FROM outbox")
    suspend fun count(): Int

    /** Drops rows the server acknowledged. */
    @Query("DELETE FROM outbox WHERE seq <= :seq")
    suspend fun deleteThrough(seq: Long)
}
