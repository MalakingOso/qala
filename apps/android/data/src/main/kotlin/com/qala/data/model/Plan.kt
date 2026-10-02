package com.qala.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The effort zone of a planned run, as `week_load` reads it (easy 0.5, steady 1.0, hard 1.5). */
@Serializable
enum class RunZone {
    @SerialName("easy") Easy,
    @SerialName("steady") Steady,
    @SerialName("hard") Hard,
}

/** One planned run: a weekday (0 is Monday, like `trainingWeekdays`), a distance and a zone. */
@Serializable
data class RunPlanDay(
    val dayOfWeek: Int,
    val distanceM: Double,
    val zone: RunZone = RunZone.Easy,
    /** What the Next run card calls it. */
    val label: String = "Easy run",
)

/** The run plan: the weekdays that carry a run. The settings group `runPlan` holds it as the leaf `days`. */
@Serializable
data class RunPlan(val days: List<RunPlanDay> = emptyList()) {
    fun on(dayOfWeek: Int): RunPlanDay? = days.firstOrNull { it.dayOfWeek == dayOfWeek }
}
