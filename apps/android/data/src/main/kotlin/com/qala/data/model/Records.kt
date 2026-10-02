package com.qala.data.model

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

/*
 * The record shapes the Rust core reads (crates/qala-core/src/records.rs), as kotlinx.serialization DTOs.
 * Names, nesting and optionality mirror the serde types field for field, so a record serialized here is
 * exactly what build_engine_state, readiness_summary and the other calls expect. Instants are ISO 8601
 * strings with an explicit offset (see IsoTime); Room stores them as epoch ms plus an offset in minutes.
 * Rust has no `deleted` flag: callers drop tombstoned rows before building these.
 */

@Serializable
enum class WeightUnit {
    @SerialName("lb") Lb,
    @SerialName("kg") Kg,
}

/** One logged set. Weight is in `unit`; the adapter converts every set to the user's unit. */
@Serializable
data class LiftSetRecord(
    val weight: Double,
    val unit: WeightUnit,
    /** Half reps are allowed. */
    val reps: Double,
    /** Logged RPE on the RIR scale (10 is zero reps in reserve), half steps allowed. */
    val rpe: Double? = null,
    val targetRpe: Double? = null,
    /** A set that does not say it was completed does not count as work. */
    val completed: Boolean = false,
    val warmup: Boolean = false,
    /** Flagged test or meet attempt. Serialized as `tested1rm`, the Rust spelling. */
    val tested1rm: Boolean = false,
    val jointPain: Boolean = false,
)

/** One exercise of a lift session; `exerciseId` is a liftosaur library id (`squat`, `benchPress`). */
@Serializable
data class LiftEntryRecord(
    val exerciseId: String,
    val sets: List<LiftSetRecord> = emptyList(),
)

/** A stored session of either kind, tagged on `kind` (`"lift"` or `"run"`). */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
sealed interface SessionRecord {
    val id: String
    val startedAt: String
    val stub: Boolean
}

/** A lifting session. A `stub` session is a "Mark done" placeholder with no sets. */
@Serializable
@SerialName("lift")
data class LiftSessionRecord(
    override val id: String,
    override val startedAt: String,
    /** 1-based LS++ program day (the `day` argument of get_day), absent when unknown. */
    val programDayIndex: Int? = null,
    override val stub: Boolean = false,
    val minutes: Double? = null,
    /** Session RPE, CR-10. */
    val srpe: Double? = null,
    val entries: List<LiftEntryRecord> = emptyList(),
) : SessionRecord

/** A mean-grade segment of a run: grade as a fraction (0.05 is 5%), length in meters. */
@Serializable
data class GradeSegment(val grade: Double, val meters: Double)

/** A run. A stub run has no distance or times. */
@Serializable
@SerialName("run")
data class RunRecord(
    override val id: String,
    override val startedAt: String,
    val distanceM: Double = 0.0,
    val movingSec: Double? = null,
    val elapsedSec: Double = 0.0,
    override val stub: Boolean = false,
    val srpe: Double? = null,
    val minutes: Double? = null,
    val hrTrimp: Double? = null,
    val gradeProfile: List<GradeSegment>? = null,
    val descentM: Double? = null,
) : SessionRecord

/** A morning check-in. The engine's `Checkin.prs` is this record's `recovery`. */
@Serializable
data class CheckInRecord(
    val id: String,
    val at: String,
    /** 0 to 10. */
    val recovery: Double,
    /** Engine muscle id to soreness, 1 to 4. */
    val soreness: Map<String, Int> = emptyMap(),
    val note: String? = null,
)

@Serializable
data class BodyWeightRecord(
    val id: String,
    /** Local `YYYY-MM-DD` key. */
    val date: String,
    val kg: Double,
)

/** The settings the core reads. Missing fields take the Rust defaults, so these mirror them. */
@Serializable
data class SettingsRecord(
    val unit: WeightUnit = WeightUnit.Lb,
    /** Liftosaur ids of the lifts the engine tracks as main lifts. */
    val mainLifts: List<String> = DefaultMainLifts,
    /** 0 is Monday, 6 is Sunday. */
    val trainingWeekdays: List<Int> = DefaultTrainingWeekdays,
) {
    companion object {
        val DefaultMainLifts = listOf("squat", "benchPress", "deadlift", "overheadPress")

        /** Monday, Wednesday, Friday, Saturday. */
        val DefaultTrainingWeekdays = listOf(0, 2, 4, 5)
    }
}

/** Why a training day is off (`SkipReason` in availability.rs, lowercase on the wire). */
@Serializable
enum class SkipReason {
    @SerialName("break") Break,
    @SerialName("vacation") Vacation,
    @SerialName("sick") Sick,
    @SerialName("injured") Injured,
    @SerialName("scheduling") Scheduling,
}

/** `"active"` or a [SkipReason] (`AvailabilityStatus`). */
@Serializable
enum class AvailabilityStatus {
    @SerialName("active") Active,
    @SerialName("break") Break,
    @SerialName("vacation") Vacation,
    @SerialName("sick") Sick,
    @SerialName("injured") Injured,
    @SerialName("scheduling") Scheduling,
    ;

    /** The matching skip reason, null for [Active]. */
    val skipReason: SkipReason?
        get() = when (this) {
            Active -> null
            Break -> SkipReason.Break
            Vacation -> SkipReason.Vacation
            Sick -> SkipReason.Sick
            Injured -> SkipReason.Injured
            Scheduling -> SkipReason.Scheduling
        }
}

/** One skipped calendar day (`date` is `YYYY-MM-DD` in the user's timezone). */
@Serializable
data class DaySkip(
    val date: String,
    val reason: SkipReason,
    /** Injured target: a lowercase engine muscle id. */
    val muscle: String? = null,
    val note: String? = null,
)

/** Persistent training status; spans run from `since` through `until` inclusive, open when absent. */
@Serializable
data class Availability(
    val status: AvailabilityStatus = AvailabilityStatus.Active,
    val since: String? = null,
    val until: String? = null,
    val muscle: String? = null,
    val note: String? = null,
)

/** How the plan treats a day (`DayClass`): training as usual, a rest day in place, or pushed out. */
@Serializable
enum class DayClass {
    @SerialName("train") Train,
    @SerialName("rest") Rest,
    @SerialName("shift") Shift,
}
