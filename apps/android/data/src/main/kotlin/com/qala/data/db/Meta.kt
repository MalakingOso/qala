package com.qala.data.db

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * Install-level key/value rows that never sync: the node id, the last issued clock, the seed marker.
 * Keys are the constants in [MetaKeys].
 */
@Entity(tableName = "meta")
data class MetaEntity(
    @PrimaryKey val key: String,
    val value: String,
)

object MetaKeys {
    /** Random 128-bit hex, generated once per install, never derived from device data. */
    const val NODE_ID = "nodeId"

    /** The last issued HLC in its string form, so a restart never goes backwards. */
    const val HLC = "hlc"

    /** Set once the debug seed has run, so a relaunch does not seed twice. */
    const val DEBUG_SEEDED = "debugSeeded"
}

@Dao
interface MetaDao {
    @Query("SELECT value FROM meta WHERE `key` = :key")
    suspend fun get(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(row: MetaEntity)
}
