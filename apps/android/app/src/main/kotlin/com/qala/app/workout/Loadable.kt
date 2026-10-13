package com.qala.app.workout

import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.QalaCore
import com.qala.data.core.roundWeight
import com.qala.data.model.WeightUnit
import kotlin.math.floor

/** The empty bar the plate math starts from: 45 lb or 20 kg. A setting once the plates work lands. */
fun defaultBarWeight(unit: WeightUnit): Double = if (unit == WeightUnit.Kg) 20.0 else 45.0

/** How far a weight stepper moves: the smallest pair of plates on each side, 5 lb or 2.5 kg. */
fun weightStep(unit: WeightUnit): Double = if (unit == WeightUnit.Kg) 2.5 else 5.0

/**
 * The weight a bar can be loaded to that is nearest [weight], never under the empty bar ([barWeight]).
 *
 * Pounds on a bar go to the Rust plate math (`QalaCore.roundWeight`): the nearest total the default plate set can make,
 * ties going below, so 67.5 lb on the 45 lb bar is 65. Kilograms and lifts with no bar ([barWeight] of zero or less: a
 * cable stack, a dumbbell rack) stay on a placeholder, the nearest 5 lb or 2.5 kg with halves up, because the plate
 * inventory the core plans against is pounds only (`DefaultLbPlates`) and a stack has no plates. When the inventory is
 * editable and has kilograms, this is the one place to pass it.
 *
 * Every weight the lifting flow computes (the warm-up's ramp steps) goes through this one function. It is synchronous
 * Rust for pounds on a bar, so call it off the main thread.
 */
fun roundLoadable(weight: Double, unit: WeightUnit, barWeight: Double = defaultBarWeight(unit)): Double =
    if (unit == WeightUnit.Lb && barWeight > 0.0) {
        QalaCore.roundWeight(weight, barWeight, DefaultLbPlates)
    } else {
        val step = weightStep(unit)
        floor(weight / step + 0.5).times(step).coerceAtLeast(barWeight)
    }
