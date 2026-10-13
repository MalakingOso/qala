package com.qala.data.repo

import com.qala.data.db.MetaEntity
import com.qala.data.db.MetaKeys
import com.qala.data.db.QalaDatabase
import kotlinx.coroutines.withContext

/**
 * Keeps the workout in progress across a killed process: one JSON text under [MetaKeys.WORKOUT_DRAFT] in the `meta`
 * table. The table is install-level state that never syncs, which is right for a half-logged workout: it is not a
 * record until the lift is saved, and it must not travel to another device. The app owns the text's shape.
 */
class WorkoutDraftStore(
    private val db: QalaDatabase,
    private val env: RepoEnv = RepoEnv(),
) {
    suspend fun load(): String? = withContext(env.work) {
        db.metaDao().get(MetaKeys.WORKOUT_DRAFT)?.takeIf { it.isNotEmpty() }
    }

    suspend fun save(json: String) = withContext(env.work) {
        db.metaDao().put(MetaEntity(MetaKeys.WORKOUT_DRAFT, json))
    }

    suspend fun clear() = withContext(env.work) {
        db.metaDao().remove(MetaKeys.WORKOUT_DRAFT)
    }
}
