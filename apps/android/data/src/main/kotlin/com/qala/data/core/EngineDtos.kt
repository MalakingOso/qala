package com.qala.data.core

import com.qala.data.model.BodyWeightRecord
import com.qala.data.model.CheckInRecord
import com.qala.data.model.RunZone
import com.qala.data.model.SessionRecord
import com.qala.data.model.SettingsRecord
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonObject

/*
 * Request and result shapes of the qala-core calls, as in docs/PLAN-m1-rust-core.md "Final JSON shapes (as
 * built)". Requests do not carry `v`; QalaCore adds it. Where the plan's API table and the Rust code differ
 * the Rust code wins: `build_engine_state` and `readiness_summary` take check-ins as their own list, not
 * inside `records`.
 */

@Serializable
data class BuildEngineStateRequest(
    val records: List<SessionRecord>,
    val checkins: List<CheckInRecord>,
    val settings: SettingsRecord,
)

/** `state` is the TS-shaped engine state, kept whole so it can go back into Rust; [EngineStateView] reads it. */
@Serializable
data class BuildEngineStateResult(
    val state: JsonObject,
    /** `unknown exercise: <id>` for a library id the core does not know. */
    val warnings: List<String> = emptyList(),
)

/**
 * The fields of the engine state the app reads today. The state has more (Kalman filters, run logs, rest
 * profile); they stay in [BuildEngineStateResult.state] until a card needs them.
 */
@Serializable
data class EngineStateView(
    /** ISO timestamp of the last applied input, kept verbatim. */
    val updated: String,
    val mainLifts: List<String> = emptyList(),
    /** F_l per lift, tau 45 days. */
    val fitness: Map<String, Double> = emptyMap(),
    /** G_m per muscle. */
    val fatigueMuscle: Map<String, Double> = emptyMap(),
    /** D_m per muscle, tau 5 days. */
    val fatigueDamage: Map<String, Double> = emptyMap(),
    /** G_s, tau 10 days. */
    val fatigueSystemic: Double = 0.0,
    /** F_run, tau 42 days. */
    val fitnessRun: Double = 0.0,
)

@Serializable
data class ReadinessSummaryRequest(
    val records: List<SessionRecord>,
    val checkins: List<CheckInRecord>,
    val settings: SettingsRecord,
    /** ISO instant with offset. */
    val now: String,
    /** The caller's UTC offset in minutes, used to turn instants into local dates. */
    val offsetMin: Int,
    /** Muscles today's session trains; absent means the check-in's soreness keys. */
    val sessionMuscles: List<String>? = null,
)

@Serializable
data class Readiness(
    /** 0 to 1. */
    val score: Double,
    /** Null before enough history. */
    val prsZ: Double? = null,
    val prsFlag: Boolean,
    val soreBlockedMuscles: List<String> = emptyList(),
    val reasons: List<String> = emptyList(),
)

/** The day a muscle is ready: a local `YYYY-MM-DD`, or the cap when it is still loaded after 21 days. */
@Serializable
data class ReadyDate(val muscle: String, val date: String, val capped: Boolean)

@Serializable
data class ReadinessSummary(
    val today: Readiness,
    /** True when `today` used a check-in from today's local date, false for a fatigue-only estimate. */
    val checkedInToday: Boolean,
    /** Mean of the 28-day readiness scores of the check-ins; null when there are none. */
    @SerialName("average28d") val average28d: Double? = null,
    @SerialName("checkinCount28d") val checkinCount28d: Int = 0,
    /** Muscles not yet ready, sorted by date then muscle id. */
    val readyDates: List<ReadyDate> = emptyList(),
)

@Serializable
data class PlannedExercise(
    /** Liftosaur exercise id. */
    val exerciseId: String,
    val sets: Double,
    /** 8 when absent. */
    val targetRpe: Double? = null,
)

/** What is planned for one weekday, as `week_load` reads it. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
sealed interface PlannedDay {
    @Serializable
    @SerialName("rest")
    data object Rest : PlannedDay

    @Serializable
    @SerialName("lift")
    data class Lift(val exercises: List<PlannedExercise>) : PlannedDay

    @Serializable
    @SerialName("run")
    data class Run(val distanceM: Double, val zone: RunZone) : PlannedDay
}

@Serializable
data class WeekLoadRequest(
    /** Exactly seven entries, Monday first. */
    val planned: List<PlannedDay>,
    val records: List<SessionRecord>,
    val settings: SettingsRecord,
    /** A local `YYYY-MM-DD` Monday. */
    val weekStart: String,
)

/** Planned and done load per weekday (Monday first) in engine load units. */
@Serializable
data class WeekLoadResult(
    val planned: List<Double>,
    val done: List<Double>,
    val warnings: List<String> = emptyList(),
)

@Serializable
data class WeightTrendRequest(val weights: List<BodyWeightRecord>, val today: String)

@Serializable
enum class TrendDirection {
    @SerialName("up") Up,
    @SerialName("down") Down,
    @SerialName("flat") Flat,
}

/** Body weight trend. No verdict and no goal: show both numbers, never infer one from the other. */
@Serializable
data class WeightTrend(
    val latestKg: Double,
    @SerialName("avg7Kg") val avg7Kg: Double,
    @SerialName("prevAvg7Kg") val prevAvg7Kg: Double? = null,
    /** kg per week; absent when the previous window has no weights. */
    val deltaPerWeekKg: Double? = null,
    /** Today's rolling-mean move against yesterday's (flat under 0.05 kg), not the sign of [deltaPerWeekKg]. */
    val direction: TrendDirection,
    /** Consecutive days the 7-day mean has moved in [direction]; 0 when flat. */
    val runDays: Int,
)
