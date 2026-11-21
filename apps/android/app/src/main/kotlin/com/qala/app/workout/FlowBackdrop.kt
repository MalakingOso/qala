package com.qala.app.workout

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import com.qala.app.R
import com.qala.app.today.grainTile
import com.qala.design.Wash
import kotlin.math.max

/**
 * The stationary background of Warm-up, Workout and Rest (DECISIONS S49): one film frame blurred down to a warm wash of its own
 * colour (scripts/bake-flow-backdrop.py), a still image with a very light grain, so nothing moves behind the controls. The scrim keeps
 * the top, where the white head text sits, a little darker. It is drawn once at the root of the shell and is not part of any screen.
 */
@Composable
fun FlowBackdrop(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(Wash.Ground)) {
        Image(painterResource(R.drawable.flow_wash), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(
            Modifier.fillMaxSize().drawWithCache {
                val grain = ShaderBrush(ImageShader(grainTile(), TileMode.Repeated, TileMode.Repeated))
                val scrim = Brush.verticalGradient(
                    0f to Color(20, 10, 4, 77),
                    0.40f to Color(20, 10, 4, 46),
                    0.75f to Color(20, 10, 4, 20),
                    1f to Color(20, 10, 4, 0),
                )
                val density = this.density
                onDrawBehind {
                    drawRect(scrim)
                    // The film's grain tile, held still, at one dp per pixel: much quieter than on Today.
                    scale(density, density, Offset.Zero) {
                        drawRect(grain, Offset.Zero, Size(size.width / density, size.height / density), alpha = 0.07f)
                    }
                }
            },
        )
    }
}

/**
 * The shape of the hand-over from Today to the flow, as a function of its progress `p` in 0..1. The first half fades a softened still
 * (the veil) in over everything, until it hides Today and its live film; at the half the shell swaps screens under it; the second half
 * fades the veil out, to the finished wash, as the new screen's content comes in. Paint alpha only: nothing above Today's SurfaceView
 * may be an alpha, offscreen or blur layer.
 */
object HandOverCurve {
    const val Swap = 0.5f

    private fun smooth(t: Float): Float {
        val x = t.coerceIn(0f, 1f)
        return x * x * (3f - 2f * x)
    }

    /** How much of the softened still is over the screen. */
    fun veil(p: Float): Float = if (p < Swap) smooth(p / Swap) else 1f - smooth((p - Swap) / (1f - Swap))

    /** How much of the incoming screen's content shows: untouched (1) while the outgoing one is still there, then 0 at the swap up to 1. */
    fun content(p: Float): Float = if (p < Swap) 1f else smooth((p - Swap) / (1f - Swap))
}

/**
 * The hand-over's state. Idle is progress 1 with nothing running: no veil and the content at full opacity, which is what every other
 * way into the flow (a notification, the end of a rest, Back from All exercises) sees. [run] plays the two halves one after the other and
 * calls [swap] between them, so the swap happens while the veil is whole and not at a threshold of some animation. Progress is read only
 * in draw and layer lambdas, so a frame of it redraws a layer and recomposes nothing.
 */
@Stable
class HandOver {
    var progress by mutableFloatStateOf(1f)
        private set
    var running by mutableStateOf(false)
        private set

    /** Plays the hand-over: [swap] runs between the halves, with the veil whole, and decides for itself whether the shell is still where it started; the veil is lifted either way. */
    suspend fun run(halfMs: Int = HalfMs, swap: () -> Unit) {
        running = true
        progress = 0f
        try {
            animate(0f, HandOverCurve.Swap, animationSpec = tween(halfMs, easing = LinearEasing)) { v, _ -> progress = v }
            swap()
            animate(HandOverCurve.Swap, 1f, animationSpec = tween(halfMs, easing = LinearEasing)) { v, _ -> progress = v }
        } finally {
            progress = 1f
            running = false
        }
    }

    companion object {
        const val HalfMs = 325
    }
}

/** The softened still over everything while a hand-over runs. It also takes every touch, so a second tap or a tab cannot move the shell mid-flight. */
@Composable
fun HandOverVeil(handOver: HandOver, modifier: Modifier = Modifier) {
    if (!handOver.running) return
    val painter = painterResource(R.drawable.flow_mid)
    Box(
        modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) awaitPointerEvent().changes.forEach { it.consume() }
                }
            }
            .drawBehind {
                val alpha = HandOverCurve.veil(handOver.progress)
                if (alpha <= 0f) return@drawBehind
                // Crop, as the wash is drawn: the still fills the window and loses its overhang.
                val src = painter.intrinsicSize
                val k = max(size.width / src.width, size.height / src.height)
                val w = src.width * k
                val h = src.height * k
                translate((size.width - w) / 2f, (size.height - h) / 2f) {
                    with(painter) { draw(Size(w, h), alpha = alpha) }
                }
            },
    )
}
