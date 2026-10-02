package com.qala.data.repo

import com.qala.data.db.AvailabilityEntity
import com.qala.data.db.AvailabilityIds
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.QalaDatabase
import com.qala.data.model.Availability
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.SkipReason
import com.qala.data.model.toModel
import com.qala.data.model.wire
import com.qala.data.sync.AvailabilityCodec
import com.qala.data.sync.DaySkipCodec
import com.qala.data.sync.DaySkipIds
import com.qala.data.sync.RecordType
import com.qala.data.sync.RecordWriter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

/**
 * Skipped days and the persistent training status (DECISIONS U24). A skip is never a miss: it only
 * records why a day is off, and `shiftsPlan` decides whether the plan moves.
 */
class AvailabilityRepository(
    private val db: QalaDatabase,
    private val writer: RecordWriter,
    private val env: RepoEnv = RepoEnv(),
) {
    /** Non-deleted skips, earliest date first. */
    val skips: Flow<List<DaySkipEntity>> = db.daySkipDao().observeAll()

    /** The status row, or [Availability] with status active when none was written or it was cleared. */
    val status: Flow<Availability> = db.availabilityDao().observe().map { it?.toModel() ?: Availability() }

    /** Skips [date] (a local `YYYY-MM-DD`). Skipping the same day again, or after an undo, rewrites the one record. */
    suspend fun skip(date: String, reason: SkipReason, muscle: String? = null, note: String? = null) =
        withContext(env.work) {
            require(reason != SkipReason.Injured || muscle != null) { "an injury names a muscle" }
            val id = DaySkipIds.of(date)
            writer.put(RecordType.DAY_SKIP, id, DaySkipCodec.toFields(DaySkipEntity(id, date, reason.wire(), muscle, note, deleted = false)))
        }

    /** Undo: a clocked tombstone, so the undo syncs too. A day that was never skipped is left alone. */
    suspend fun undoSkip(date: String) = withContext(env.work) {
        val id = DaySkipIds.of(date)
        if (db.daySkipDao().row(id)?.deleted == false) writer.delete(RecordType.DAY_SKIP, id)
    }

    /** Sets the persistent status; `until` null leaves it open until cleared. */
    suspend fun setStatus(status: AvailabilityStatus, since: String, until: String? = null, muscle: String? = null, note: String? = null) =
        withContext(env.work) {
            require(status != AvailabilityStatus.Active) { "use clearStatus to go back to active" }
            require(status != AvailabilityStatus.Injured || muscle != null) { "an injury names a muscle" }
            write(AvailabilityEntity(AvailabilityIds.ROW, status.wire(), since, until, muscle, note, deleted = false))
        }

    suspend fun clearStatus() = withContext(env.work) {
        write(AvailabilityEntity(AvailabilityIds.ROW, "active", null, null, null, null, deleted = false))
    }

    private suspend fun write(row: AvailabilityEntity) =
        writer.put(RecordType.AVAILABILITY, row.id, AvailabilityCodec.toFields(row))
}
