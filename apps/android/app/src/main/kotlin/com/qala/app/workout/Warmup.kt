package com.qala.app.workout

import com.qala.app.today.muscleName
import com.qala.data.core.CardioWhy
import com.qala.data.core.QalaCore
import com.qala.data.core.RampDto
import com.qala.data.core.TissueWhy
import com.qala.data.core.WarmupBlockDto
import com.qala.data.core.WarmupBlockKind
import com.qala.data.core.WarmupEquipmentDto
import com.qala.data.core.WarmupExerciseDto
import com.qala.data.core.WarmupItemDto
import com.qala.data.core.WarmupPlanDto
import com.qala.data.core.WarmupRequest
import com.qala.data.core.WarmupSkip
import com.qala.data.core.planWarmup
import com.qala.data.model.GymSettings
import com.qala.data.model.OwnedEquipment
import com.qala.data.model.PlateSettings
import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass

/*
 * The warm-up (DESIGN 7.4, PLAN 6.7, DECISIONS T6, D32): easy cardio, soft tissue with the owner's tools, dynamic mobility,
 * then ramp sets worked out from each exercise's working weight. The plan is Rust (qala-core warmup.rs); it comes back as
 * structure and numbers, and this file words every row. What it is built from (the tools owned, soft tissue, the Theragun
 * preference, the time, the bar and the plates) is Settings, passed in as [WarmupInput]. Not built yet: the recent-run rule
 * (an easy run just before lifting covers the cardio), which needs the run pipeline's effort rating.
 */

/**
 * What the warm-up is built around: the tools for soft tissue and the one machine for the cardio (null for none, which
 * is a brisk walk). [Owner] is what Settings holds until it is changed: a foam roller, a Theragun and a bike.
 */
data class Equipment(val foamRoller: Boolean, val percussion: Boolean, val cardio: String?) {
    companion object {
        val Owner = Equipment(foamRoller = true, percussion = true, cardio = "bike")
    }
}

/** The equipment Settings says is owned. The cardio is the first machine owned, in the order the page lists them: bike, rower, treadmill. */
fun OwnedEquipment.toEquipment(): Equipment = Equipment(
    foamRoller = foamRoller,
    percussion = percussion,
    cardio = when {
        bike -> "bike"
        rower -> "rower"
        treadmill -> "treadmill"
        else -> null
    },
)

/** The tools a soft-tissue row can name, which is also which Blender render it shows. */
enum class SoftTissueTool(val label: String) { FoamRoller("Foam roller"), Percussion("Theragun") }

/** One step of a ramp: [bar] means the empty bar, at [load]. */
data class RampStep(val load: Double, val reps: Int, val restSec: Int, val bar: Boolean = false, val extra: Boolean = false)

/** An exercise's ramp: the steps up to the first work set. */
data class Ramp(
    val exerciseId: String,
    val name: String,
    val workWeight: Double?,
    val workReps: String,
    val steps: List<RampStep>,
    /** Whether the lift is loaded with plates on a bar, so its steps get plate hints. */
    val barbell: Boolean = false,
)

/** What the warm-up reads about one exercise of the day. */
data class WarmupExercise(
    val exerciseId: String,
    val name: String,
    val cls: ExerciseClass,
    /** Engine muscle ids the exercise targets. */
    val muscles: List<String>,
    /** The top working weight of the day, null for bodyweight work (which gets no ramp). */
    val weight: Double?,
    /** The reps of that set, for the intensity guess when there is no 1RM. */
    val reps: Double,
    val repsLabel: String,
    /** The 1RM in the lifter's unit, when one is known. */
    val reference: Double?,
    /** False for a dumbbell, cable or machine lift: there is no empty bar to start from, so no step is rounded up to one. */
    val barbell: Boolean = true,
)

class WarmupInput(
    val exercises: List<WarmupExercise>,
    val unit: WeightUnit,
    /** Soreness the check-in recorded, by engine muscle id, 1 to 4. */
    val soreness: Map<String, Int> = emptyMap(),
    /** The check-in's recovery score, 0 to 10. */
    val recovery: Double? = null,
    val equipment: Equipment = Equipment.Owner,
    /** "Prefer Theragun where allowed" (PLAN 6.7); the owner likes it. */
    val preferPercussion: Boolean = true,
    /** The time for the first three blocks, in minutes (`warmup.minutes` in Settings). */
    val budgetMin: Int = 15,
    /** The bar and the inventory the ramp weights are rounded on. */
    val plates: PlateSettings = PlateSettings(),
    val barWeight: Double = defaultBarWeight(unit, plates),
    /** "Soft tissue" in Settings: off, the soft-tissue block is not built, whatever tools are owned. */
    val softTissue: Boolean = true,
    /** "Build a warm-up" in Settings: off, the cardio, soft tissue and mobility blocks are not built and only the ramp sets stay. */
    val enabled: Boolean = true,
)

/**
 * The warm-up's input with everything Settings holds applied: the tools and machine owned, the soft tissue and Theragun
 * choices, the time, and the bar and plates the ramp weights round on.
 */
fun warmupInput(exercises: List<WarmupExercise>, unit: WeightUnit, soreness: Map<String, Int>, recovery: Double?, gym: GymSettings): WarmupInput =
    WarmupInput(
        exercises = exercises,
        unit = unit,
        soreness = soreness,
        recovery = recovery,
        equipment = gym.equipment.toEquipment(),
        preferPercussion = gym.warmup.preferPercussion,
        budgetMin = gym.warmup.minutes,
        plates = gym.plates,
        softTissue = gym.warmup.softTissue,
        enabled = gym.warmup.enabled,
    )

enum class BlockKind { General, SoftTissue, Mobility }

/** One thing to do in a block. [tool] picks the render of a soft-tissue row. */
data class WarmupItem(val id: String, val title: String, val detail: String, val tool: SoftTissueTool? = null)

data class WarmupBlock(
    val kind: BlockKind,
    val items: List<WarmupItem>,
    val minutes: Int,
    val skipReason: String? = null,
) {
    val skipped: Boolean get() = skipReason != null
}

data class WarmupPlan(
    val blocks: List<WarmupBlock>,
    val ramps: List<Ramp>,
    /** The warm-up's length without the ramp sets, which count as lifting time. */
    val minutes: Int,
    /** Whether the first main lift's top set is at or over 85% of its 1RM, which lengthens the cardio. */
    val heavy: Boolean,
) {
    fun block(kind: BlockKind): WarmupBlock? = blocks.firstOrNull { it.kind == kind && !it.skipped }
}

// ---- the plan ----

/** Why the blocks are missing when "Build a warm-up" is off. */
const val OffInSettings = "off in Settings"

private const val CutForTime = "cut for time"

/** The warm-up for a day, from the Rust plan. Synchronous Rust: the store calls it off the main thread. */
fun planWarmup(input: WarmupInput): WarmupPlan {
    val request = WarmupRequest(
        exercises = input.exercises.map { e ->
            WarmupExerciseDto(e.exerciseId, e.cls.name.lowercase(), e.muscles, e.weight, e.reps, e.reference, e.barbell)
        },
        unit = input.unit,
        soreness = input.soreness,
        recovery = input.recovery,
        equipment = WarmupEquipmentDto(input.equipment.foamRoller, input.equipment.percussion, input.equipment.cardio),
        preferPercussion = input.preferPercussion,
        budgetMin = input.budgetMin,
        plates = input.plates.plates,
        barWeight = input.barWeight,
        softTissue = input.softTissue,
        enabled = input.enabled,
    )
    return QalaCore.planWarmup(request).toPlan(input)
}

private fun WarmupPlanDto.toPlan(input: WarmupInput): WarmupPlan = WarmupPlan(
    blocks = blocks.map { it.toBlock() },
    ramps = ramps.mapIndexed { i, r -> r.toRamp(input.exercises[i], input.unit) },
    minutes = minutes,
    heavy = heavy,
)

private fun WarmupBlockDto.toBlock() = WarmupBlock(
    kind = when (kind) {
        WarmupBlockKind.General -> BlockKind.General
        WarmupBlockKind.SoftTissue -> BlockKind.SoftTissue
        WarmupBlockKind.Mobility -> BlockKind.Mobility
    },
    items = items.map { it.toItem() },
    minutes = minutes,
    skipReason = when (skipReason) {
        null -> null
        WarmupSkip.OffInSettings -> OffInSettings
        WarmupSkip.CutForTime -> CutForTime
    },
)

private fun RampDto.toRamp(e: WarmupExercise, unit: WeightUnit) = Ramp(
    exerciseId = exerciseId,
    name = e.name,
    workWeight = workWeight,
    workReps = e.repsLabel,
    steps = steps.map { RampStep(it.load, it.reps, it.restSec, it.bar, it.extra) },
    barbell = PlateMath.applies(unit, e.barbell),
)

/** The words for one row. */
private fun WarmupItemDto.toItem(): WarmupItem = when (this) {
    is WarmupItemDto.Cardio -> {
        val (machine, pace) = cardioTitle(machine)
        WarmupItem(
            "cardio",
            "$machine, $pace",
            when (why) {
                CardioWhy.Heavy -> "$minutes min today because the top set is ${topPct ?: 0}% of your max."
                CardioWhy.Normal -> "$minutes min to raise your heart rate and warm the joints."
                CardioWhy.Short -> "$minutes min, short on time."
            },
        )
    }

    is WarmupItemDto.Tissue -> {
        val kit = if (tool == com.qala.data.core.SoftTissueTool.Percussion) SoftTissueTool.Percussion else SoftTissueTool.FoamRoller
        val time = formatClock(seconds) + if (kit == SoftTissueTool.FoamRoller) " a side" else ""
        val because = when (why) {
            TissueWhy.Sore -> "sore ($soreness)*"
            TissueWhy.Preference -> "your preference*"
            TissueWhy.FirstLifts -> "today's first lifts*"
            TissueWhy.Warms -> "warms the muscle*"
        }
        WarmupItem("tissue-$muscle", muscleName(muscle).replaceFirstChar { it.uppercase() }, "${kit.label} \u00B7 $time \u00B7 $because", kit)
    }

    is WarmupItemDto.Mobility -> WarmupItem("mobility-$row-$index", name, "10 reps")
}

private fun cardioTitle(mode: String?): Pair<String, String> = when (mode) {
    "bike" -> "Bike" to "easy pace"
    "rower" -> "Rower" to "easy pace"
    "treadmill" -> "Treadmill" to "easy walk or jog"
    else -> "Brisk walk" to "then bodyweight squats"
}
