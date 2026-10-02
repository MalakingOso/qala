package com.qala.data.db

import androidx.room.Database
import androidx.room.RoomDatabase

/** The phone's local store. Version 1; the schema is exported to data/schemas so migrations can be tested later. */
@Database(
    entities = [MetaEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class QalaDatabase : RoomDatabase() {
    abstract fun metaDao(): MetaDao
}
