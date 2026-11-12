package com.qala.app.workout

import com.qala.app.today.muscleName
import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.PlateEntry
import com.qala.data.model.GymSettings
import com.qala.data.model.OwnedEquipment
import com.qala.data.model.PlateSettings
import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass

/*
 * The warm-up (DESIGN 7.4, PLAN 6.7, DECISIONS T6), ported from the deleted TS engine/warmup.ts: easy cardio, soft tissue
 * with the owner's tools, dynamic mobility, then ramp sets worked out from each exercise's working weight. What it is
 * built from (the tools owned, soft tissue, the Theragun preference, the time, the bar and the plates) is Settings,
 * passed in as [WarmupInput]. Pure: no Compose, no clock. Every weight it computes goes through [roundLoadable], so the
 * plates change the rounding in one place. Not ported yet: the recent-run rule (an easy run just before lifting covers
 * the cardio), which needs the run pipeline's effort rating (a run is rated steady until critical speed exists).
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

// ---- ramp sets ----

private class Tier(val min: Double, val steps: List<Triple<Int, Int, Int>>)    // percent of W, reps, rest in seconds

private val T0 = Tier(0.0, listOf(Triple(50, 10, 45)))
private val T1 = Tier(0.6, listOf(Triple(50, 8, 45), Triple(80, 4, 90)))
private val T2 = Tier(0.75, listOf(Triple(45, 6, 45), Triple(65, 4, 60), Triple(85, 2, 90)))
private val T3 = Tier(0.85, listOf(Triple(40, 5, 45), Triple(60, 3, 60), Triple(75, 2, 90), Triple(88, 1, 120)))
private val T4 = Tier(0.92, listOf(Triple(40, 5, 45), Triple(55, 3, 60), Triple(70, 2, 90), Triple(82, 1, 120), Triple(91, 1, 120)))

private fun tierFor(intensity: Double, isolation: Boolean): Tier = when {
    isolation || intensity < T1.min -> T0
    intensity < T2.min -> T1
    intensity < T3.min -> T2
    intensity < T4.min -> T3
    else -> T4
}

/** How hard the top set is: its share of the 1RM, or from the reps when there is none (inverse Epley, no reps in reserve). */
fun intensityOf(weight: Double, reference: Double?, reps: Double): Double =
    if (reference != null && reference > 0) weight / reference else 1.0 / (1.0 + reps / 30.0)

class RampInput(
    val weight: Double,
    val intensity: Double,
    val isolation: Boolean = false,
    /** The first exercise of the day for one of its muscles: an otherwise bare T0 gets one easy set. */
    val firstForMuscle: Boolean = false,
    /** A second lift whose muscles were already trained today: one set at 80%. */
    val alreadyTrainedSecondary: Boolean = false,
    /** Soreness 4 on the lift's muscles, or a low recovery score: one more step between the first two. */
    val extraStep: Boolean = false,
)

/**
 * Ramp sets for one exercise (PLAN 6.7): the tier from the intensity of the top set, each step a percent of the working
 * weight rounded to a loadable weight. A step under the empty bar becomes one "bar x 8", a step equal to the one before
 * it or to the working weight is dropped.
 */
fun rampSets(input: RampInput, unit: WeightUnit, bar: Double = defaultBarWeight(unit), plates: List<PlateEntry> = DefaultLbPlates): List<RampStep> {
    val work = roundLoadable(input.weight, unit, bar, plates)
    fun single(pct: Double, reps: Int, rest: Int): RampStep {
        val raw = input.weight * pct
        return if (raw < bar) RampStep(bar, reps, rest, bar = true) else RampStep(roundLoadable(raw, unit, bar, plates), reps, rest)
    }
    if (input.alreadyTrainedSecondary) return listOf(single(0.8, 4, 90))
    val tier = tierFor(input.intensity, input.isolation)
    if (tier === T0) return if (input.firstForMuscle) listOf(single(0.5, 10, 45)) else emptyList()
    val steps = ArrayList<RampStep>()
    for ((pct, reps, rest) in tier.steps) {
        val raw = input.weight * pct / 100.0
        if (raw < bar) {
            if (steps.none { it.bar }) steps += RampStep(bar, 8, 45, bar = true)
            continue
        }
        val load = roundLoadable(raw, unit, bar, plates)
        if (steps.lastOrNull()?.load == load) continue
        if (load >= work) continue
        steps += RampStep(load, reps, rest)
    }
    if (input.extraStep && steps.size >= 2) {
        val mid = roundLoadable((steps[0].load + steps[1].load) / 2, unit, bar, plates)
        if (mid != steps[0].load && mid != steps[1].load && mid < work) steps.add(1, RampStep(mid, 5, 60, extra = true))
    }
    return steps
}

// ---- the plan ----

private val RollerBad = setOf("chest", "frontdelts", "uppertraps", "forearms", "pecs")

private class DrillRow(val match: List<String>, val drills: List<String>)

private val Mobility = listOf(
    DrillRow(listOf("quads", "glutes"), listOf("Bodyweight squats", "Walking lunges", "Front-to-back leg swings")),
    DrillRow(listOf("hamstrings", "lowerback"), listOf("Bodyweight good mornings", "Glute bridges", "Straight-leg kicks")),
    DrillRow(listOf("calves", "ankles"), listOf("Knee-to-wall ankle rocks", "Calf raises", "Low pogo hops")),
    DrillRow(listOf("chest", "frontdelts", "triceps"), listOf("Incline push-ups", "Scapular push-ups", "Band pass-throughs")),
    DrillRow(listOf("lats", "upperback", "biceps", "reardelts"), listOf("Band pull-aparts", "Scapular pulls", "Thoracic open-books")),
    DrillRow(listOf("sidedelts", "shoulders", "overhead"), listOf("Wall slides", "Band pass-throughs", "Prone Y-T-W")),
    DrillRow(listOf("abs", "trunk", "core"), listOf("Dead bugs", "Bird dogs")),
)

private fun mobilityRows(muscles: List<String>): List<List<String>> {
    val picked = ArrayList<DrillRow>()
    for (m in muscles) {
        if (picked.size >= 3) break
        val row = Mobility.firstOrNull { r -> r.match.any { m.contains(it) } }
        if (row != null && row !in picked) picked += row
    }
    if (picked.isEmpty()) return listOf(listOf("Bodyweight squats", "Walking lunges"))
    return picked.map { it.drills.take(2) }
}

private fun cardioTitle(mode: String?): Pair<String, String> = when (mode) {
    "bike" -> "Bike" to "easy pace"
    "rower" -> "Rower" to "easy pace"
    "treadmill" -> "Treadmill" to "easy walk or jog"
    else -> "Brisk walk" to "then bodyweight squats"
}

/** Why the blocks are missing when "Build a warm-up" is off. */
const val OffInSettings = "off in Settings"

/**
 * The whole warm-up for a day, built from [WarmupInput]. The cardio is 5 minutes, or 10 when the first main lift's top
 * set is heavy (at or over 85% of the 1RM). Soft tissue needs [WarmupInput.softTissue] on, a tool owned and time to
 * spare. Over the time budget ([WarmupInput.budgetMin]) the soft tissue goes first, then the mobility drops to one
 * drill, then the cardio to 3 minutes. The ramp sets are never cut, and are all there is when the warm-up is off in
 * Settings ([WarmupInput.enabled]).
 */
fun planWarmup(input: WarmupInput): WarmupPlan {
    val unit = input.unit
    val bar = input.barWeight
    val exercises = input.exercises
    val lead = exercises.firstOrNull { it.cls == ExerciseClass.Main } ?: exercises.firstOrNull()
    val topPct = lead?.weight?.let { w -> lead.reference?.takeIf { it > 0 }?.let { w / it } }
    val heavy = topPct != null && topPct >= 0.85
    val budget = input.budgetMin
    val blocks = ArrayList<WarmupBlock>()

    if (input.enabled) {
        // 1. General.
        val minutes = if (heavy) 10 else 5
        val (machine, pace) = cardioTitle(input.equipment.cardio)
        blocks += WarmupBlock(
            BlockKind.General,
            listOf(
                WarmupItem(
                    "cardio",
                    "$machine, $pace",
                    if (heavy) "$minutes min today because the top set is ${(topPct * 100).toInt()}% of your max." else "$minutes min to raise your heart rate and warm the joints.",
                ),
            ),
            minutes,
        )

        // 2. Soft tissue, when a tool is owned and there is time.
        val haveTool = input.equipment.foamRoller || input.equipment.percussion
        val trainedToday = exercises.flatMap { it.muscles }.distinct()
        val firstTwo = exercises.take(2).flatMap { it.muscles }.distinct()
        val sore = trainedToday.filter { (input.soreness[it] ?: 0) >= 3 }
        val targets = (firstTwo + sore).distinct().take(4)
        if (input.softTissue && haveTool && budget >= 8 && targets.isNotEmpty()) {
            val rows = targets.map { m ->
                val soreness = input.soreness[m] ?: 0
                val isSore = soreness >= 3
                val primeHeavy = heavy && m in firstTwo
                val rollerBad = m in RollerBad
                val tool = when {
                    isSore -> SoftTissueTool.FoamRoller                                   // never percussion on a sore muscle
                    primeHeavy && !rollerBad -> SoftTissueTool.FoamRoller
                    rollerBad && input.equipment.percussion -> SoftTissueTool.Percussion
                    input.preferPercussion && input.equipment.percussion && !primeHeavy -> SoftTissueTool.Percussion
                    input.equipment.foamRoller -> SoftTissueTool.FoamRoller
                    else -> SoftTissueTool.Percussion
                }
                val seconds = if (tool == SoftTissueTool.Percussion) 60 else if (isSore) 120 else 90
                val why = when {
                    isSore -> "sore ($soreness)*"
                    tool == SoftTissueTool.Percussion && input.preferPercussion -> "your preference*"
                    m in firstTwo -> "today's first lifts*"
                    else -> "warms the muscle*"
                }
                val time = formatClock(seconds) + if (tool == SoftTissueTool.FoamRoller) " a side" else ""
                WarmupItem("tissue-$m", muscleName(m).replaceFirstChar { it.uppercase() }, "${tool.label} \u00B7 $time \u00B7 $why", tool) to seconds
            }
            blocks += WarmupBlock(BlockKind.SoftTissue, rows.map { it.first }, kotlin.math.ceil(rows.sumOf { it.second } / 60.0).toInt())
        }

        // 3. Dynamic mobility: two drills of ten for up to three muscle groups.
        val drills = mobilityRows(trainedToday)
        blocks += WarmupBlock(
            BlockKind.Mobility,
            drills.flatMapIndexed { r, row -> row.mapIndexed { d, name -> WarmupItem("mobility-$r-$d", name, "10 reps") } },
            drills.size,
        )

        // Over budget: soft tissue first, then mobility to one drill, then the cardio to three minutes.
        var used = blocks.sumOf { it.minutes }
        if (used > budget) {
            blocks.indexOfFirst { it.kind == BlockKind.SoftTissue }.takeIf { it >= 0 }?.let { i ->
                used -= blocks[i].minutes
                blocks[i] = WarmupBlock(BlockKind.SoftTissue, emptyList(), 0, "cut for time")
            }
        }
        if (used > budget) {
            val i = blocks.indexOfFirst { it.kind == BlockKind.Mobility }
            blocks[i] = blocks[i].copy(items = blocks[i].items.take(1), minutes = 1)
            used = blocks.sumOf { it.minutes }
        }
        if (used > budget) {
            val i = blocks.indexOfFirst { it.kind == BlockKind.General }
            blocks[i] = WarmupBlock(BlockKind.General, listOf(WarmupItem("cardio", "$machine, $pace", "3 min, short on time.")), 3)
        }
    } else {
        // Off in Settings: no cardio, soft tissue or mobility. The ramp sets below are lifting time and stay.
        blocks += WarmupBlock(BlockKind.General, emptyList(), 0, OffInSettings)
        blocks += WarmupBlock(BlockKind.SoftTissue, emptyList(), 0, OffInSettings)
        blocks += WarmupBlock(BlockKind.Mobility, emptyList(), 0, OffInSettings)
    }

    // 4. Ramp sets, per exercise.
    val trained = HashSet<String>()
    val ramps = exercises.mapIndexed { idx, e ->
        val ramp = if (e.weight == null) {
            emptyList()
        } else {
            val intensity = intensityOf(e.weight, e.reference, e.reps)
            val alreadyTrained = idx > 0 && e.cls == ExerciseClass.Secondary && e.muscles.isNotEmpty() && e.muscles.all { it in trained }
            val extra = e.muscles.any { input.soreness[it] == 4 } || (input.recovery != null && input.recovery <= 4)
            val first = e.muscles.any { it !in trained }
            rampSets(RampInput(e.weight, intensity, e.cls == ExerciseClass.Isolation, first, alreadyTrained, extra), unit, if (e.barbell) bar else 0.0, input.plates.plates)
        }
        trained += e.muscles
        Ramp(e.exerciseId, e.name, e.weight, e.repsLabel, ramp, barbell = PlateMath.applies(unit, e.barbell))
    }
    return WarmupPlan(blocks, ramps, blocks.sumOf { it.minutes }, heavy)
}
