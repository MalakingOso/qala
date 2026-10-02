package com.qala.data.repo

import com.qala.data.IsoTime
import com.qala.data.QalaJson
import com.qala.data.db.QalaDatabase
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.GradeSegment
import com.qala.data.sync.RecordType
import com.qala.data.sync.RecordWriter
import com.qala.data.sync.RunSessionCodec
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer

/** A run summary to record. Raw GPS fixes are a later table (A2). */
data class NewRun(
    val startedAtMs: Long,
    val distanceM: Double = 0.0,
    val movingSec: Double? = null,
    val elapsedSec: Double = 0.0,
    val srpe: Double? = null,
    val minutes: Double? = null,
    val hrTrimp: Double? = null,
    val gradeProfile: List<GradeSegment>? = null,
    val descentM: Double? = null,
    val notes: String? = null,
    val id: String? = null,
)

/** Run summaries (distance, times, sRPE, grade profile, descent), as live reads and suspend writes. */
class RunRepository(
    private val db: QalaDatabase,
    private val writer: RecordWriter,
    private val env: RepoEnv = RepoEnv(),
) {
    /** Non-deleted runs, oldest first. */
    val runs: Flow<List<RunSessionEntity>> = db.runSessionDao().observeAll()

    suspend fun saveRun(new: NewRun): String = withContext(env.work) {
        write(new, stub = false)
    }

    /** The placeholder the Mark done button of the Run stub screen leaves: no distance, no times. */
    suspend fun markDone(atMs: Long = env.clock.nowMs()): String = withContext(env.work) {
        write(NewRun(startedAtMs = atMs), stub = true)
    }

    suspend fun delete(id: String) = writer.delete(RecordType.RUN_SESSION, id)

    suspend fun restore(id: String) = writer.restore(RecordType.RUN_SESSION, id)

    private suspend fun write(new: NewRun, stub: Boolean): String {
        val id = new.id ?: env.ids.next()
        val row = RunSessionEntity(
            id = id,
            startedAtMs = new.startedAtMs,
            offsetMin = IsoTime.offsetMinAt(env.clock.zone, new.startedAtMs),
            distanceM = new.distanceM,
            movingSec = new.movingSec,
            elapsedSec = new.elapsedSec,
            stub = stub,
            srpe = new.srpe,
            minutes = new.minutes,
            hrTrimp = new.hrTrimp,
            gradeProfileJson = new.gradeProfile?.let { QalaJson.encodeToString(ListSerializer(GradeSegment.serializer()), it) },
            descentM = new.descentM,
            notes = new.notes,
            deleted = false,
        )
        writer.put(RecordType.RUN_SESSION, id, RunSessionCodec.toFields(row))
        return id
    }
}
