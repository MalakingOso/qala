package com.qala.data.db

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Relation

/*
 * One typed table per record type (docs/archive/completed.md, M2 as built). Ids are UUID strings, except the
 * records that have a natural identity: a skip is "skip-<date>", availability is the single row
 * "availability", a settings group is "settings-<group>". The prefixes keep every record id unique across
 * types, so field_clock can be keyed by (recordId, field) alone.
 *
 * Every table carries `deleted`: records are never removed, a delete is a clocked write of `true` and
 * repositories filter tombstones out. Instants are `...Ms` (UTC epoch ms) plus `offsetMin` (device offset
 * when written). JSON columns (`...Json`) hold the value of one clocked field that has structure.
 */

/** A lifting session. Immutable once created except `notes`; `entries` is one clocked field (see lift_entry). */
@Entity(tableName = "lift_session", indices = [Index("startedAtMs")])
data class LiftSessionEntity(
    @PrimaryKey val id: String,
    val startedAtMs: Long,
    val offsetMin: Int,
    /** 1-based LS++ program day (the `day` of get_day); null when the session was not run from a program day. */
    val programDayIndex: Int?,
    /** A "Mark done" placeholder with no sets (stub-stage records, M3). */
    val stub: Boolean,
    /**
     * Kotlin-side only, ignored by the Rust core: which stage a stub marks, [LiftStage.WARMUP] or
     * [LiftStage.LIFT]. Null on a real session, which implies both.
     */
    val stage: String?,
    val minutes: Double?,
    val srpe: Double?,
    val notes: String?,
    val deleted: Boolean,
)

/** Values of [LiftSessionEntity.stage]. */
object LiftStage {
    const val WARMUP = "warmup"
    const val LIFT = "lift"
}

/** An exercise of a session; the rows are a typed copy of the session's `entries` field, replaced as one unit. */
@Entity(
    tableName = "lift_entry",
    foreignKeys = [
        ForeignKey(
            entity = LiftSessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("sessionId"), Index("exerciseId")],
)
data class LiftEntryEntity(
    /** `<sessionId>/<position>`: stable, so replacing the entries rewrites the same ids. */
    @PrimaryKey val id: String,
    val sessionId: String,
    val position: Int,
    /** Liftosaur library id. */
    val exerciseId: String,
)

@Entity(
    tableName = "lift_set",
    foreignKeys = [
        ForeignKey(
            entity = LiftEntryEntity::class,
            parentColumns = ["id"],
            childColumns = ["entryId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("entryId")],
)
data class LiftSetEntity(
    /** `<entryId>/<position>`. */
    @PrimaryKey val id: String,
    val entryId: String,
    val position: Int,
    val weight: Double,
    /** `lb` or `kg`. */
    val unit: String,
    val reps: Double,
    val rpe: Double?,
    val targetRpe: Double?,
    val completed: Boolean,
    val warmup: Boolean,
    val tested1rm: Boolean,
    val jointPain: Boolean,
)

/** An entry with its sets, as Room reads it. */
data class LiftEntryWithSets(
    @Embedded val entry: LiftEntryEntity,
    @Relation(parentColumn = "id", entityColumn = "entryId") val sets: List<LiftSetEntity>,
)

/** A session with its entries and their sets: the unit the repositories hand out. */
data class LiftSessionWithEntries(
    @Embedded val session: LiftSessionEntity,
    @Relation(entity = LiftEntryEntity::class, parentColumn = "id", entityColumn = "sessionId")
    val entries: List<LiftEntryWithSets>,
)

/** A run, summary only. Raw fixes are a later table (A2). */
@Entity(tableName = "run_session", indices = [Index("startedAtMs")])
data class RunSessionEntity(
    @PrimaryKey val id: String,
    val startedAtMs: Long,
    val offsetMin: Int,
    val distanceM: Double,
    /** Null when the watch did not report it; the core falls back to elapsed time. */
    val movingSec: Double?,
    val elapsedSec: Double,
    val stub: Boolean,
    val srpe: Double?,
    val minutes: Double?,
    val hrTrimp: Double?,
    /** JSON array of `{grade, meters}`. */
    val gradeProfileJson: String?,
    val descentM: Double?,
    val notes: String?,
    val deleted: Boolean,
)

@Entity(tableName = "check_in", indices = [Index("atMs")])
data class CheckInEntity(
    @PrimaryKey val id: String,
    val atMs: Long,
    val offsetMin: Int,
    /** 0 to 10. */
    val recovery: Double,
    /** JSON object of engine muscle id to soreness 1..4. */
    val sorenessJson: String,
    val note: String?,
    val deleted: Boolean,
)

@Entity(tableName = "body_weight", indices = [Index("date")])
data class BodyWeightEntity(
    @PrimaryKey val id: String,
    /** Local `YYYY-MM-DD` key. */
    val date: String,
    val kg: Double,
    val deleted: Boolean,
)

/** One skipped calendar day. The id is `skip-<date>`, so two devices skipping a day converge on one record. */
@Entity(tableName = "day_skip", indices = [Index("date", unique = true)])
data class DaySkipEntity(
    @PrimaryKey val id: String,
    val date: String,
    /** A [com.qala.data.model.SkipReason] name in lowercase. */
    val reason: String,
    val muscle: String?,
    val note: String?,
    val deleted: Boolean,
)

/** The persistent training status. A single row with the id [AvailabilityIds.ROW]. */
@Entity(tableName = "availability")
data class AvailabilityEntity(
    @PrimaryKey val id: String,
    /** A [com.qala.data.model.AvailabilityStatus] name in lowercase. */
    val status: String,
    val since: String?,
    val until: String?,
    val muscle: String?,
    val note: String?,
    val deleted: Boolean,
)

object AvailabilityIds {
    const val ROW = "availability"
}

/**
 * One row per settings group, each leaf its own clocked field. `valuesJson` is a JSON object of leaf name
 * to value. Groups in use: [SettingsGroups].
 */
@Entity(tableName = "settings")
data class SettingsEntity(
    /** `settings-<group>`. */
    @PrimaryKey val id: String,
    val valuesJson: String,
    val deleted: Boolean,
)

@Entity(tableName = "program")
data class ProgramEntity(
    @PrimaryKey val id: String,
    val name: String,
    /** The program's LS++ text; its progression state lives inside it. One clocked field. */
    val text: String,
    val deleted: Boolean,
)

/** The clock of the last write to one field of one record. */
@Entity(tableName = "field_clock", primaryKeys = ["recordId", "field"])
data class FieldClockEntity(
    val recordId: String,
    val field: String,
    val wallMs: Long,
    val counter: Int,
    val nodeId: String,
)

/** One field write waiting for the sync client, drained in `seq` order. */
@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    /** A [com.qala.data.sync.RecordType] wire name. */
    val recordType: String,
    val recordId: String,
    val field: String,
    /** The field's value as JSON text. */
    val valueJson: String,
    /** The write's clock in its canonical string form, `{wallMs:013}-{counter:05}-{nodeId}`. */
    val hlc: String,
    val createdAtMs: Long,
)
