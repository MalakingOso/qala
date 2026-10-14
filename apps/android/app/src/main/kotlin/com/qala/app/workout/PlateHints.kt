package com.qala.app.workout

import com.qala.data.core.NextPlateChoice
import com.qala.data.core.QalaCore
import com.qala.data.core.chooseNextPlates
import com.qala.data.core.nearestLoadable
import com.qala.data.core.planPlates
import com.qala.data.core.platesShorthand
import com.qala.data.model.PlateSettings
import com.qala.data.model.WeightUnit

/*
 * What goes on the bar, from the Rust plate math (qala-core plates.rs through QalaCorePlates.kt), on the bar and the
 * inventory Settings holds ([PlateSettings]; its defaults are the 45 lb bar and the default pounds set). Hints exist for
 * pounds on a barbell only: a dumbbell, a cable and a machine have no plates, and kilograms have no inventory. Every call
 * is synchronous Rust: the store computes them off the main thread and the screens only read.
 */

/** The plates for one total. [perSide] is the nearest loadable load (heaviest first), [total] what it adds up to. */
data class PlateHint(val perSide: List<Double>, val shorthand: String, val total: Double)

object PlateMath {
    /** Whether a lift gets plate hints: pounds on a barbell. */
    fun applies(unit: WeightUnit, barbell: Boolean): Boolean = unit == WeightUnit.Lb && barbell

    /** The plates for [weight] on the default bar from [setup], null when nothing is loadable. */
    fun hint(weight: Double, setup: PlateSettings = PlateSettings()): PlateHint? {
        val load = QalaCore.planPlates(weight, setup.defaultBar, setup.plates).nearestLoadable() ?: return null
        return PlateHint(load.perSide, QalaCore.platesShorthand(load.perSide), load.total)
    }

    /** How to get from [currentPerSide] to [nextWeight] with the fewest plates moved; null when nothing is loadable. */
    fun change(currentPerSide: List<Double>, nextWeight: Double, setup: PlateSettings = PlateSettings()): NextPlateChoice? =
        QalaCore.chooseNextPlates(currentPerSide, nextWeight, setup.defaultBar, setup.plates, 0.0)
}

/**
 * The line under a set row: "per side 45 · 45 · 10", and when the weight on the row is not one the plates can make,
 * what they do make ("per side 45 · 35 · loads 205"), so the row never promises a weight the bar will not carry.
 */
fun plateLine(weight: Double, hint: PlateHint): String =
    plateLoadsNote(weight, hint.total)?.let { "${hint.shorthand} · $it" } ?: hint.shorthand

/** "loads 205" when [weight] is not a weight the plates can make and [total] is what they do make; null when they add up. */
fun plateLoadsNote(weight: Double?, total: Double?): String? =
    if (weight == null || total == null || total == weight) null else "loads ${formatWeight(total)}"

/** The change between two sets as a sentence: "Take off 5, add 25 each side." and, for the same plates, the usual line. */
fun plateChangeLine(instruction: String): String =
    if (instruction == "no change") "Same as last set, leave the plates on." else instruction.replaceFirstChar { it.uppercase() } + "."

/**
 * The line under a set row, or null: when plates are hidden in Settings ([show] false), when the lift has no plates
 * ([barbell] false) or no weight, or before the plate math has answered for this weight.
 */
fun setPlateLine(show: Boolean, barbell: Boolean, weight: Double?, hints: Map<Double, PlateHint>): String? =
    if (!show || !barbell || weight == null) null else hints[weight]?.let { plateLine(weight, it) }

/** What Rest says about the plates of the next set: what goes on each side, a note when the weight cannot be made, and the change from the set before. */
data class RestPlatesView(val perSide: List<Double>?, val loadsNote: String?, val changeLine: String?)

/** The Rest screen's plate lines for [next], or null when plates are hidden in Settings ([show] false). */
fun restPlatesView(show: Boolean, rest: RestState, next: RestNext): RestPlatesView? {
    if (!show) return null
    val change = when {
        rest.plateInstruction != null -> plateChangeLine(rest.plateInstruction)
        next.sameWeight && rest.perSide != null -> plateChangeLine("no change")
        else -> null
    }
    return RestPlatesView(rest.perSide, plateLoadsNote(next.weight, rest.plateTotal), change)
}
