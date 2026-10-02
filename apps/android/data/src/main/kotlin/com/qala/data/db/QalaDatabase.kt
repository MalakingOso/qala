package com.qala.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/** The phone's local store. Version 1; the schema is exported to data/schemas so migrations can be tested later. */
@Database(
    entities = [
        LiftSessionEntity::class,
        LiftEntryEntity::class,
        LiftSetEntity::class,
        RunSessionEntity::class,
        CheckInEntity::class,
        BodyWeightEntity::class,
        DaySkipEntity::class,
        AvailabilityEntity::class,
        SettingsEntity::class,
        ProgramEntity::class,
        FieldClockEntity::class,
        OutboxEntity::class,
        MetaEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class QalaDatabase : RoomDatabase() {
    abstract fun liftSessionDao(): LiftSessionDao
    abstract fun runSessionDao(): RunSessionDao
    abstract fun checkInDao(): CheckInDao
    abstract fun bodyWeightDao(): BodyWeightDao
    abstract fun daySkipDao(): DaySkipDao
    abstract fun availabilityDao(): AvailabilityDao
    abstract fun settingsDao(): SettingsDao
    abstract fun programDao(): ProgramDao
    abstract fun fieldClockDao(): FieldClockDao
    abstract fun outboxDao(): OutboxDao
    abstract fun metaDao(): MetaDao

    companion object {
        const val FILE_NAME = "qala.db"

        fun open(context: Context, name: String = FILE_NAME): QalaDatabase =
            Room.databaseBuilder(context.applicationContext, QalaDatabase::class.java, name).build()

        /** A throwaway database for tests; queries may run on the calling thread. */
        fun inMemory(context: Context): QalaDatabase =
            Room.inMemoryDatabaseBuilder(context.applicationContext, QalaDatabase::class.java).build()
    }
}
