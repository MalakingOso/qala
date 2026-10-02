package com.qala.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.GlobalPositionAwareModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.platform.LocalDensity

/**
 * One card's side of the notch: it follows the card's position in the window and turns the rail band into the bite
 * for [beamerSurface]'s `notch` parameter, so a card is wired with two modifiers:
 *
 *     val notch = rememberCardNotch { railBand }                       // the Rect from DayRail's onBandChanged
 *     Modifier.trackNotch(notch).beamerSurface(..., notch = notch)    // same bounds: put them side by side
 *
 * The position is pushed in by the layout system after every layout pass, scrolling included, and draws are
 * invalidated from there, so a scroll frame redraws only the cards whose bite can change and the bite lands on the
 * frame it moves. The band is read in the draw phase, so a band that moves (the preview bar opening) is picked up
 * there. Nothing allocates per frame: the [Bite] is one instance, rewritten in place.
 */
@Stable
class CardNotch internal constructor(private val band: () -> Rect, private val density: Float) : () -> Bite? {
    private var left = 0f
    private var top = 0f
    private var width = 0f
    private var height = 0f
    private val bite = Bite()

    /** Records the card's window bounds; true when they changed and the card needs another draw. */
    internal fun place(left: Float, top: Float, width: Float, height: Float): Boolean {
        if (left == this.left && top == this.top && width == this.width && height == this.height) return false
        this.left = left
        this.top = top
        this.width = width
        this.height = height
        return true
    }

    override fun invoke(): Bite? {
        val b = band()
        return if (RailGeometry.biteInto(bite, left, top, left + width, top + height, b.top, b.bottom, b.right, density)) bite else null
    }
}

/** A [CardNotch] against the rail [band] (window coordinates, px). [band] is read in the draw phase. */
@Composable
fun rememberCardNotch(band: () -> Rect): CardNotch {
    val latest by rememberUpdatedState(band)
    val density = LocalDensity.current.density
    return remember(density) { CardNotch({ latest() }, density) }
}

/** Reports this layout node's window position to [notch]. Place it next to the `beamerSurface` it feeds. */
fun Modifier.trackNotch(notch: CardNotch): Modifier = this then TrackNotchElement(notch)

private data class TrackNotchElement(val notch: CardNotch) : ModifierNodeElement<TrackNotchNode>() {
    override fun create() = TrackNotchNode(notch)

    override fun update(node: TrackNotchNode) {
        node.notch = notch
    }
}

// A draw node only so the layout node's draw can be invalidated from the position callback; it draws nothing itself.
private class TrackNotchNode(var notch: CardNotch) : Modifier.Node(), GlobalPositionAwareModifierNode, DrawModifierNode {
    override fun onGloballyPositioned(coordinates: LayoutCoordinates) {
        val at = coordinates.positionInRoot()
        val size = coordinates.size
        if (notch.place(at.x, at.y, size.width.toFloat(), size.height.toFloat())) invalidateDraw()
    }

    override fun ContentDrawScope.draw() = drawContent()
}
