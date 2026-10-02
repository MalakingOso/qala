package com.qala.design

import android.animation.ValueAnimator
import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp

/**
 * The rail chrome's own colours. They are not in tokens.css (it is generated from the web app, which has no rail),
 * so they live here, as the Light and Dark sets of mockups/m4-core.css (dark is option B, "lifted"). Anything that
 * does have a token (surface, fg, accent, the teal) is read from the palette instead.
 */
@Immutable
internal class RailColors(
    val stripTint: Color,
    val stripBorder: Color,
    val dotOff: Color,
    val dotOffBorder: Color,
    val dotRing: Color,
    val halo: Color,
    val nodeBorder: Color,
    val rowSelBg: Color,
    val rowSelBorder: Color,
    val rowSelFg: Color,
    val rowSelFg2: Color,
    val scrim: Color,
    val glass: Color,
    val onInk: Color,          // text on the ink and teal fills
) {
    companion object {
        val Light = RailColors(
            stripTint = Color(255, 255, 255, 158),                  // surface at .62
            stripBorder = Color(15, 21, 42, 61),
            dotOff = Color(0xFFDFE3EC),
            dotOffBorder = Color(15, 21, 42, 117),                  // .46, about 3:1 on the strip (the prototype's .2 is 1.7:1)
            dotRing = Color(0xFF94A0B8),
            halo = Color(255, 255, 255, 179),
            nodeBorder = Color(15, 21, 42, 77),
            rowSelBg = Color(0xFF0F152A),
            rowSelBorder = Color(0xFF0F152A),
            rowSelFg = Color.White,
            rowSelFg2 = Color(255, 255, 255, 191),
            scrim = Color(15, 21, 42, 56),                          // fg at .22
            glass = Color(255, 255, 255, 179),
            onInk = Color.White,
        )

        val Dark = RailColors(
            stripTint = Color(31, 42, 77, 184),                     // active surface at .72
            stripBorder = Color(232, 236, 246, 87),
            dotOff = Color(0xFF3A4466),
            dotOffBorder = Color(232, 236, 246, 128),
            dotRing = Color(0xFFAAB4CC),
            halo = Color(31, 42, 77, 242),
            nodeBorder = Color(232, 236, 246, 87),
            rowSelBg = Color(0xFF1F2A4D),
            rowSelBorder = Color(232, 236, 246, 153),
            rowSelFg = Color(0xFFE8ECF6),
            rowSelFg2 = Color(0xFFAAB4CC),
            scrim = Color(3, 6, 16, 153),                           // ink is light in dark, so the scrim is near-black
            glass = Color(31, 42, 77, 179),
            onInk = Color(0xFF0B1020),
        )
    }
}

@Composable
internal fun railColors(): RailColors = if (Qala.dark) RailColors.Dark else RailColors.Light

/** CSS `ease` and `ease-in`, for the motion the web prototype writes with those keywords. */
internal val EaseCss = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)
internal val EaseIn = CubicBezierEasing(0.42f, 0f, 1f, 1f)

/**
 * Whether the system is playing animations: false when the Animator duration scale is 0 (Developer options, or
 * Remove animations in Accessibility, which zeroes all three scales) or when battery saver has switched them off. It
 * reads [ValueAnimator.areAnimatorsEnabled] and `Settings.Global.ANIMATOR_DURATION_SCALE`, each time an animation is
 * about to start, so a toggle made while the screen is open takes effect on the next open.
 *
 * Compose already stretches animation durations by the duration scale (and finishes them at once at 0) for
 * animations started from composition, so a scale above 1 needs nothing here. This check is the explicit snap: the
 * rail's motion is frozen, not merely fast, when animations are off, whatever the Compose version does.
 */
internal fun animationsEnabled(context: Context): Boolean =
    ValueAnimator.areAnimatorsEnabled() &&
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f

/**
 * The glass: the one place the rail's and the preview bar's translucent fill is made, so a backdrop blur (Haze)
 * can replace it later without touching either. Today it is a tint only; native has no cheap backdrop blur.
 */
fun Modifier.glass(tint: Color, shape: Shape = RectangleShape): Modifier = background(tint, shape)

/**
 * The Beamer hard shadow for a translucent box: CSS paints box-shadow outside the border box only, so the shadow is
 * clipped away where the box is, and shows through nothing. (The opaque [beamerSurface] needs no clip.)
 */
internal fun Modifier.outsideShadow(shape: Shape, color: Color, dx: Dp, dy: Dp): Modifier = drawWithCache {
    val box = Path()
    when (val outline = shape.createOutline(size, layoutDirection, this)) {
        is Outline.Rectangle -> box.addRect(outline.rect)
        is Outline.Rounded -> box.addRoundRect(outline.roundRect)
        is Outline.Generic -> box.addPath(outline.path)
    }
    val offsetX = dx.toPx()
    val offsetY = dy.toPx()
    onDrawBehind {
        clipPath(box, ClipOp.Difference) {
            translate(offsetX, offsetY) { drawPath(box, color) }
        }
    }
}
