package com.qala.data.core

import com.qala.data.model.WeightUnit
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import uniffi.qala_ffi.planRest as ffiPlanRest
import uniffi.qala_ffi.planWarmup as ffiPlanWarmup

// ---- rest and warm-up planning (qala-core rest.rs and warmup.rs, DECISIONS D32) ----
// The plans carry structure, numbers and reason codes; the app words them. `class` is `main`, `secondary` or `isolation`.

/** One past rest, as the learned pace reads it. All seconds except [hit]. */
@Serializable
data class RestObservation(val taken: Double, val base: Double, val adjust: Double, val planned: Double, val hit: Boolean)

/** The exercise's first work set today, which later sets are compared with for rep drift. */
@Serializable
data class RestFirstSet(val reps: Double, val rpe: Double? = null, val weight: Double? = null)

@Serializable
data class RestRequest(
    @SerialName("class") val cls: String,
    val targetReps: Double,
    val loggedReps: Double,
    val loggedRpe: Double? = null,
    val targetRpe: Double? = null,
    val setNumber: Int = 1,
    val amrap: Boolean = false,
    val explicitBase: Int? = null,
    val weight: Double? = null,
    val first: RestFirstSet? = null,
    val soreness: Int? = null,
    val prs: Double? = null,
    val fatigueLocal: Double? = null,
    val exerciseHistory: List<RestObservation> = emptyList(),
    val classHistory: List<RestObservation> = emptyList(),
)

/** Why a row of the "Why" ledger is there; [RestRowDto.value] and [RestRowDto.other] carry the numbers its words need. */
@Serializable
enum class RestCode {
    @SerialName("REST_BASE_PROGRAM") BaseProgram,
    @SerialName("REST_BASE_MAIN_HEAVY") BaseMainHeavy,
    @SerialName("REST_BASE_MAIN") BaseMain,
    @SerialName("REST_BASE_SECOND") BaseSecond,
    @SerialName("REST_BASE_ISOLATION") BaseIsolation,
    @SerialName("REST_PACE") Pace,
    @SerialName("REST_FAILURE") Failure,
    @SerialName("REST_EFFORT_HIGH") EffortHigh,
    @SerialName("REST_EFFORT_LOW") EffortLow,
    @SerialName("REST_REPS_SHORT") RepsShort,
    @SerialName("REST_LATE_SET") LateSet,
    @SerialName("REST_DRIFT") Drift,
    @SerialName("REST_LOW_READINESS") LowReadiness,
    @SerialName("REST_ROUND") Round,
}

@Serializable
data class RestRowDto(val code: RestCode, val seconds: Int, val value: Double? = null, val other: Double? = null)

@Serializable
data class RestPlanDto(val seconds: Int, val base: Int, val adjust: Int, val multiplier: Double, val rows: List<RestRowDto>)

fun QalaCore.planRest(request: RestRequest): RestPlanDto =
    call(RestRequest.serializer(), RestPlanDto.serializer(), request, ::ffiPlanRest)

@Serializable
data class WarmupEquipmentDto(val foamRoller: Boolean, val percussion: Boolean, val cardio: String? = null)

@Serializable
data class WarmupExerciseDto(
    val exerciseId: String,
    @SerialName("class") val cls: String,
    val muscles: List<String>,
    val weight: Double? = null,
    val reps: Double,
    val reference: Double? = null,
    val barbell: Boolean,
)

@Serializable
data class WarmupRequest(
    val exercises: List<WarmupExerciseDto>,
    val unit: WeightUnit,
    val soreness: Map<String, Int> = emptyMap(),
    val recovery: Double? = null,
    val equipment: WarmupEquipmentDto,
    val preferPercussion: Boolean,
    val budgetMin: Int,
    val plates: List<PlateEntry>,
    val barWeight: Double,
    val softTissue: Boolean,
    val enabled: Boolean,
)

@Serializable
enum class WarmupBlockKind {
    @SerialName("general") General,
    @SerialName("softTissue") SoftTissue,
    @SerialName("mobility") Mobility,
}

@Serializable
enum class WarmupSkip {
    @SerialName("offInSettings") OffInSettings,
    @SerialName("cutForTime") CutForTime,
}

@Serializable
enum class CardioWhy {
    @SerialName("heavy") Heavy,
    @SerialName("normal") Normal,
    @SerialName("short") Short,
}

@Serializable
enum class SoftTissueTool {
    @SerialName("foamRoller") FoamRoller,
    @SerialName("percussion") Percussion,
}

@Serializable
enum class TissueWhy {
    @SerialName("sore") Sore,
    @SerialName("preference") Preference,
    @SerialName("firstLifts") FirstLifts,
    @SerialName("warms") Warms,
}

@Serializable
sealed interface WarmupItemDto {
    @Serializable @SerialName("cardio")
    data class Cardio(val machine: String? = null, val minutes: Int, val why: CardioWhy, val topPct: Int? = null) : WarmupItemDto

    @Serializable @SerialName("tissue")
    data class Tissue(val muscle: String, val tool: SoftTissueTool, val seconds: Int, val why: TissueWhy, val soreness: Int) : WarmupItemDto

    @Serializable @SerialName("mobility")
    data class Mobility(val row: Int, val index: Int, val name: String) : WarmupItemDto
}

@Serializable
data class WarmupBlockDto(val kind: WarmupBlockKind, val items: List<WarmupItemDto>, val minutes: Int, val skipReason: WarmupSkip? = null)

/** One step of a ramp: [bar] means the empty bar, at [load]. */
@Serializable
data class RampStepDto(val load: Double, val reps: Int, val restSec: Int, val bar: Boolean = false, val extra: Boolean = false)

@Serializable
data class RampDto(val exerciseId: String, val workWeight: Double? = null, val steps: List<RampStepDto>)

@Serializable
data class WarmupPlanDto(val blocks: List<WarmupBlockDto>, val ramps: List<RampDto>, val minutes: Int, val heavy: Boolean)

fun QalaCore.planWarmup(request: WarmupRequest): WarmupPlanDto =
    call(WarmupRequest.serializer(), WarmupPlanDto.serializer(), request, ::ffiPlanWarmup)
