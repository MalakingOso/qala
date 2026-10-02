package com.qala.data.repo

import com.qala.data.db.ProgramEntity
import com.qala.data.db.QalaDatabase
import com.qala.data.sync.ProgramCodec
import com.qala.data.sync.RecordType
import com.qala.data.sync.RecordWriter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive

/**
 * Programs: a name and the LS++ text. The progression state lives inside the text, so advancing the program
 * after a session is a write of the text field. There is one program in use for now: [active] is the first by id.
 */
class ProgramRepository(
    private val db: QalaDatabase,
    private val writer: RecordWriter,
    private val env: RepoEnv = RepoEnv(),
) {
    val programs: Flow<List<ProgramEntity>> = db.programDao().observeAll()

    val active: Flow<ProgramEntity?> = programs.map { it.firstOrNull() }

    /** Creates the program or rewrites its name and text. */
    suspend fun save(id: String, name: String, text: String) = withContext(env.work) {
        writer.put(RecordType.PROGRAM, id, ProgramCodec.toFields(ProgramEntity(id, name, text, deleted = false)))
    }

    /** The text alone, for the finish-day write after a session. */
    suspend fun setText(id: String, text: String) = withContext(env.work) {
        writer.update(RecordType.PROGRAM, id, mapOf("text" to JsonPrimitive(text)))
    }

    suspend fun delete(id: String) = writer.delete(RecordType.PROGRAM, id)
}
