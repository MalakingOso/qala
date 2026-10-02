package com.qala.design

import androidx.compose.ui.geometry.Rect
import kotlin.math.min

/**
 * The rectangle a card gives up around the day rail, in the card's own coordinates and the caller's unit (dp or
 * px, see [RailGeometry]). It is cut from the card's start edge: it spans x in 0..[right] and y in [top]..[bottom].
 *
 * When [openTop] is set the bite reaches the card's top edge, so the card has no start edge above it (likewise
 * [openBottom]). A bite is mutable so a card can reuse one instance for every frame; treat one you were handed
 * as read-only.
 */
class Bite {
    var right = 0f
        internal set
    var top = 0f
        internal set
    var bottom = 0f
        internal set

    /** Radius of the bite's inner corners: `min(8, height / 2 - 1)`. */
    var radius = 0f
        internal set
    var openTop = false
        internal set
    var openBottom = false
        internal set

    val height: Float get() = bottom - top

    fun toRect(): Rect = Rect(0f, top, right, bottom)
}

/**
 * Where a card must give way to the fixed day rail (mockups/rail-cutline.html, `paintSeam`). Pure arithmetic, so
 * it is unit tested without a device.
 *
 * Rects are in one coordinate space (the root window, in px, at runtime). [scale] converts the spec's dp numbers
 * into that unit: 1 for dp, the screen density for px.
 */
object RailGeometry {
    /** The bite reaches this far above and below the strip. */
    const val ClearanceDp = 8f

    /** The whitespace between the strip's end edge and the card. The strip is 28 dp wide, so the bite ends 36 dp in. */
    const val WhitespaceDp = 8f

    /** A bite shorter than this is not worth drawing: the card keeps its edge. */
    const val MinBiteDp = 10f

    /** The inner corners echo the strip's 8 dp corners, and shrink for a short bite. */
    const val MaxRadiusDp = 8f

    /** The bite for [card] against the strip's [band], in card-local coordinates, or null when it overlaps under 10 dp. */
    fun bite(card: Rect, band: Rect, scale: Float = 1f): Bite? {
        val out = Bite()
        return if (biteInto(out, card.left, card.top, card.right, card.bottom, band.top, band.bottom, band.right, scale)) out else null
    }

    /**
     * [bite] without allocating: fills [out] and returns whether there is a bite. The band is reduced to the three
     * numbers that matter: its [bandTop], [bandBottom] and the [bandRight] edge of the strip.
     */
    fun biteInto(
        out: Bite,
        cardLeft: Float,
        cardTop: Float,
        cardRight: Float,
        cardBottom: Float,
        bandTop: Float,
        bandBottom: Float,
        bandRight: Float,
        scale: Float = 1f,
    ): Boolean {
        if (bandBottom <= bandTop) return false      // an empty band is not laid out yet
        val clearance = ClearanceDp * scale
        val bandStart = bandTop - clearance
        val bandEnd = bandBottom + clearance
        val top = maxOf(cardTop, bandStart)
        val bottom = minOf(cardBottom, bandEnd)
        val height = bottom - top
        if (height < MinBiteDp * scale) return false
        val right = bandRight + WhitespaceDp * scale - cardLeft
        if (right <= 0f || right >= cardRight - cardLeft) return false     // the card does not reach the strip, or is all strip
        out.right = right
        out.top = top - cardTop
        out.bottom = bottom - cardTop
        out.radius = min(MaxRadiusDp * scale, height / 2f - scale)
        out.openTop = cardTop >= bandStart
        out.openBottom = cardBottom <= bandEnd
        return true
    }
}
