package com.qala.data.repo

import com.qala.data.IsoTime
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftStage
import com.qala.data.db.QalaDatabase
import com.qala.data.model.LiftEntryRecord
import com.qala.data.sync.LiftSessionBundle
import com.qala.data.sync.LiftSessionCodec
import com.qala.data.sync.RecordType
import com.qala.data.sync.RecordWriter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive

/** A session to record. Times are epoch ms; the offset is the device's at that instant. */
data class NewLiftSession(
    val startedAtMs: Long,
    /** 1-based LS++ program day this session ran, null when it was not run from a program day. */
    val programDayIndex: Int?,
    val entries: List<LiftEntryRecord>,
    val minutes: Double? = null,
    val srpe: Double? = null,
    val notes: String? = null,
    val id: String? = null,
)

/** Which stage a "Mark done" stub completes (docs/PLAN-m2-room-data.md, Stub-stage records). */
enum class StubStage(internal val column: String) {
    WARM_UP(LiftStage.WARMUP),
    LIFT(LiftStage.LIFT),
}

/** Lift sessions, as live reads of non-deleted rows and suspend writes through [RecordWriter]. */
class SessionRepository(
    private val db: QalaDatabase,
    private val writer: RecordWriter,
    private val env: RepoEnv = RepoEnv(),
) {
    /** Sessions with their entries and sets, oldest first. */
    val liftSessions: Flow<List<LiftSessionWithEntries>> = db.liftSessionDao().observeAll()

    /** Session rows alone (dates, flags, program day), for callers that do not need the sets. */
    val liftSessionRows: Flow<List<LiftSessionEntity>> = db.liftSessionDao().observeRows()

    /** Records a real session and returns its id. */
    suspend fun saveLiftSession(new: NewLiftSession): String = withContext(env.work) {
        val id = new.id ?: env.ids.next()
        write(id, new.startedAtMs, new.programDayIndex, stub = false, stage = null, new.entries, new.minutes, new.srpe, new.notes)
        id
    }

    /**
     * Writes the placeholder the Mark done button of a stub screen leaves (M3): `stub = true`, the program
     * day, a start time, no sets. The engine counts it as "day logged" for sequencing and adds no fatigue.
     */
    suspend fun markStageDone(stage: StubStage, programDayIndex: Int?, atMs: Long = env.clock.nowMs()): String =
        withContext(env.work) {
            val id = env.ids.next()
            write(id, atMs, programDayIndex, stub = true, stage = stage.column, emptyList(), null, null, null)
            id
        }

    suspend fun setNotes(id: String, notes: String?) = withContext(env.work) {
        writer.update(RecordType.LIFT_SESSION, id, mapOf("notes" to JsonPrimitive(notes)))
    }

    suspend fun delete(id: String) = writer.delete(RecordType.LIFT_SESSION, id)

    suspend fun restore(id: String) = writer.restore(RecordType.LIFT_SESSION, id)

    private suspend fun write(
        id: String,
        startedAtMs: Long,
        programDayIndex: Int?,
        stub: Boolean,
        stage: String?,
        entries: List<LiftEntryRecord>,
        minutes: Double?,
        srpe: Double?,
        notes: String?,
    ) {
        val offset = IsoTime.offsetMinAt(env.clock.zone, startedAtMs)
        val row = LiftSessionEntity(id, startedAtMs, offset, programDayIndex, stub, stage, minutes, srpe, notes, deleted = false)
        writer.put(RecordType.LIFT_SESSION, id, LiftSessionCodec.toFields(LiftSessionBundle(row, entries)))
    }
}
