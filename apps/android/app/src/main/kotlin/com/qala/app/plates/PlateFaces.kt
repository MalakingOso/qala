package com.qala.app.plates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.qala.app.workout.PlateHint
import com.qala.app.workout.PlateMath
import com.qala.data.core.PlateEntry
import com.qala.data.model.PlateSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The plates of one side as a row of small faces, heaviest first, next to a prescribed weight (Today, Plan, the ramp rows). Nothing
 * for an empty side: "bar only" has no plate to draw.
 */
@Composable
fun PlateFaces(perSide: List<Double>, inventory: List<PlateEntry>, modifier: Modifier = Modifier, height: Float = SmallFaceDp) {
    if (perSide.isEmpty()) return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        perSide.forEach { PlateFace(it, inventory, height) }
    }
}

/** The height of a face beside a figure or a line of text. */
const val SmallFaceDp = 16f

/**
 * The plates of one side for each of [weights], from the Rust plate math on [setup], worked out off the main thread (so a weight
 * is missing from the map for a moment). Empty while [enabled] is false: Settings hides plates, or the lift has none.
 */
@Composable
fun rememberPerSide(weights: List<Double>, setup: PlateSettings, enabled: Boolean): Map<Double, List<Double>> {
    val answers by produceState(emptyMap<Double, List<Double>>(), weights, setup, enabled) {
        value = if (!enabled || weights.isEmpty()) {
            emptyMap()
        } else {
            withContext(Dispatchers.Default) { weights.distinct().mapNotNull { w -> PlateMath.hint(w, setup)?.let { w to it.perSide } }.toMap() }
        }
    }
    return answers
}

/**
 * The plates of one side of [weight] and their shorthand ("45 · 45 · 10"), from the same Rust plate math, worked out off the main
 * thread. Null for a moment, and while [enabled] is false (Settings hides plates, or the lift has none).
 */
@Composable
fun rememberPlateHint(weight: Double?, setup: PlateSettings, enabled: Boolean): PlateHint? {
    val hint by produceState<PlateHint?>(null, weight, setup, enabled) {
        value = if (!enabled || weight == null) null else withContext(Dispatchers.Default) { PlateMath.hint(weight, setup) }
    }
    return hint
}
