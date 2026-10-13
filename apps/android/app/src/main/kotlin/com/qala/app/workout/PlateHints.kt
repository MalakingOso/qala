package com.qala.app.workout

import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.NextPlateChoice
import com.qala.data.core.QalaCore
import com.qala.data.core.chooseNextPlates
import com.qala.data.core.nearestLoadable
import com.qala.data.core.planPlates
import com.qala.data.core.platesShorthand
import com.qala.data.model.WeightUnit

/*
 * What goes on the bar, from the Rust plate math (qala-core plates.rs through QalaCorePlates.kt). The inventory is the
 * default pounds set (`DefaultLbPlates`) and the bar is 45 lb, because Android has no editable plate inventory yet, so
 * hints exist for pounds on a barbell only: a dumbbell, a cable and a machine have no plates, and kilograms have no
 * inventory. Every call is synchronous Rust: the store computes them off the main thread and the screens only read.
 */

/** The plates for one total. [perSide] is the nearest loadable load (heaviest first), [total] what it adds up to. */
data class PlateHint(val perSide: List<Double>, val shorthand: String, val total: Double)

object PlateMath {
    /** Whether a lift gets plate hints: pounds on a barbell. */
    fun applies(unit: WeightUnit, barbell: Boolean): Boolean = unit == WeightUnit.Lb && barbell

    /** The plates for [weight] on the bar, null when nothing is loadable. */
    fun hint(weight: Double, barWeight: Double = defaultBarWeight(WeightUnit.Lb)): PlateHint? {
        val load = QalaCore.planPlates(weight, barWeight, DefaultLbPlates).nearestLoadable() ?: return null
        return PlateHint(load.perSide, QalaCore.platesShorthand(load.perSide), load.total)
    }

    /** How to get from [currentPerSide] to [nextWeight] with the fewest plates moved; null when nothing is loadable. */
    fun change(currentPerSide: List<Double>, nextWeight: Double, barWeight: Double = defaultBarWeight(WeightUnit.Lb)): NextPlateChoice? =
        QalaCore.chooseNextPlates(currentPerSide, nextWeight, barWeight, DefaultLbPlates, 0.0)
}

/**
 * The line under a set row: "per side 45 · 45 · 10", and when the weight on the row is not one the plates can make,
 * what they do make ("per side 45 · 35 · loads 205"), so the row never promises a weight the bar will not carry.
 */
fun plateLine(weight: Double, hint: PlateHint): String =
    if (hint.total == weight) hint.shorthand else "${hint.shorthand} · loads ${formatWeight(hint.total)}"

/** The change between two sets as a sentence: "Take off 5, add 25 each side." and, for the same plates, the usual line. */
fun plateChangeLine(instruction: String): String =
    if (instruction == "no change") "Same as last set, leave the plates on." else instruction.replaceFirstChar { it.uppercase() } + "."
