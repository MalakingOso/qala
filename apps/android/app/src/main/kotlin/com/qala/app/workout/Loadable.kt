package com.qala.app.workout

import com.qala.data.model.WeightUnit
import kotlin.math.floor

/** The empty bar the plate math starts from: 45 lb or 20 kg. A setting once the plates work lands. */
fun defaultBarWeight(unit: WeightUnit): Double = if (unit == WeightUnit.Kg) 20.0 else 45.0

/** How far a weight stepper moves: the smallest pair of plates on each side, 5 lb or 2.5 kg. */
fun weightStep(unit: WeightUnit): Double = if (unit == WeightUnit.Kg) 2.5 else 5.0

/**
 * The weight a bar can be loaded to that is nearest [weight], never under the empty bar ([barWeight]). Halves round up.
 *
 * PLACEHOLDER. It rounds to the nearest 5 lb or 2.5 kg, which is right for the default plate set and wrong for anyone
 * with another one. The plates branch replaces the body with the Rust core (`QalaCore.roundWeight(target, bar, plates,
 * collar)` or `planPlates(...).nearestLoadable()?.total`); every weight the lifting flow computes (ramp sets today)
 * goes through this one function so nothing else changes then. The core is synchronous Rust, so the callers that need
 * it compute their weights off the main thread.
 */
fun roundLoadable(weight: Double, unit: WeightUnit, barWeight: Double = defaultBarWeight(unit)): Double {
    val step = weightStep(unit)
    return floor(weight / step + 0.5).times(step).coerceAtLeast(barWeight)
}
