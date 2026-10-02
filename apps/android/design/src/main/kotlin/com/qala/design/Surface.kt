package com.qala.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The Beamer surface (DESIGN 1): a flat fill, a border drawn inside the box, and a hard offset shadow with no blur
 * and no elevation. The shadow is painted behind the box, so an opaque [fill] hides the part under it. Nothing here
 * clips, so the shadow may spill outside the layout bounds; leave room for it.
 *
 * [notch] is read in the draw phase, so state it reads (the rail band, a card's position) invalidates draw only. When
 * it returns a [Bite] the box gives up that rectangle at its start edge: fill, shadow and border are all built from one
 * path (the rounded rect minus the bite, with the bite's small inner radius), so the seam is the card's own border
 * and the shadow follows the notch (a ring, if the shadow has one, is stroked around the same path). With no bite, or
 * no [notch] at all (the default), the box is drawn exactly as before.
 */
fun Modifier.beamerSurface(
    fill: Color,
    border: Color,
    radius: Dp,
    shadow: QalaShadow? = null,
    borderWidth: Dp = QalaTokens.borderWidth,
    notch: (() -> Bite?)? = null,
): Modifier = if (notch == null) {
    drawBehind { drawBeamerBox(fill, border, radius, shadow, borderWidth) }
} else {
    this then NotchedSurfaceElement(fill, border, radius, shadow, borderWidth, notch)
}

private fun DrawScope.drawBeamerBox(fill: Color, border: Color, radius: Dp, shadow: QalaShadow?, borderWidth: Dp) {
    val corner = CornerRadius(radius.toPx())
    if (shadow != null) {
        val ring = shadow.ringWidth.toPx()
        if (ring > 0f) {      // CSS paints the second box-shadow layer (the ring) underneath the offset one
            drawRoundRect(
                color = shadow.ringColor,
                topLeft = Offset(-ring, -ring),
                size = Size(size.width + 2 * ring, size.height + 2 * ring),
                cornerRadius = CornerRadius(corner.x + ring),
            )
        }
        drawRoundRect(
            color = shadow.color,
            topLeft = Offset(shadow.dx.toPx(), shadow.dy.toPx()),
            size = size,
            cornerRadius = corner,
        )
    }
    drawRoundRect(color = fill, size = size, cornerRadius = corner)
    val w = borderWidth.toPx()
    if (w > 0f) {
        // CSS borders sit inside the box (box-sizing: border-box), so the stroke is inset by half its width.
        drawRoundRect(
            color = border,
            topLeft = Offset(w / 2, w / 2),
            size = Size(size.width - w, size.height - w),
            cornerRadius = CornerRadius((corner.x - w / 2).coerceAtLeast(0f)),
            style = Stroke(w),
        )
    }
}

private data class NotchedSurfaceElement(
    val fill: Color,
    val border: Color,
    val radius: Dp,
    val shadow: QalaShadow?,
    val borderWidth: Dp,
    val notch: () -> Bite?,
) : ModifierNodeElement<NotchedSurfaceNode>() {
    override fun create() = NotchedSurfaceNode(fill, border, radius, shadow, borderWidth, notch)

    override fun update(node: NotchedSurfaceNode) {
        node.fill = fill
        node.border = border
        node.radius = radius
        node.shadow = shadow
        node.borderWidth = borderWidth
        node.notch = notch
        node.invalidateDraw()
    }
}

/**
 * Owns the two paths (fill, and the border's half-width inset) so a frame allocates nothing: both are rewound and
 * rebuilt from the bite on every draw, which is a few dozen segments.
 */
private class NotchedSurfaceNode(
    var fill: Color,
    var border: Color,
    var radius: Dp,
    var shadow: QalaShadow?,
    var borderWidth: Dp,
    var notch: () -> Bite?,
) : Modifier.Node(), DrawModifierNode {
    private val fillPath = Path()
    private val borderPath = Path()
    private var stroke = Stroke(0f)

    override fun ContentDrawScope.draw() {
        val bite = notch()
        if (bite == null || !trace(bite)) {
            drawBeamerBox(fill, border, radius, shadow, borderWidth)
        } else {
            val w = borderWidth.toPx()
            shadow?.let {
                val ring = it.ringWidth.toPx()
                if (ring > 0f) drawPath(fillPath, it.ringColor, style = stroke(2 * ring))
                translate(it.dx.toPx(), it.dy.toPx()) { drawPath(fillPath, it.color) }
            }
            drawPath(fillPath, fill)
            if (w > 0f) drawPath(borderPath, border, style = stroke(w))
        }
        drawContent()
    }

    private fun stroke(width: Float): Stroke {
        if (stroke.width != width) stroke = Stroke(width)
        return stroke
    }

    /** Builds [fillPath] and [borderPath] for [bite]; false when the card is too narrow to hold one. */
    private fun DrawScope.trace(bite: Bite): Boolean {
        val w = borderWidth.toPx()
        val width = size.width
        val height = size.height
        val corner = radius.toPx()
        // A strip of card thinner than its own two borders is not drawable: take the bite to that edge instead.
        val openTop = bite.openTop || bite.top < 2 * w
        val openBottom = bite.openBottom || height - bite.bottom < 2 * w
        val top = if (openTop) 0f else bite.top
        val bottom = if (openBottom) height else bite.bottom
        if (bite.right + bite.radius + corner >= width) return false
        notchedOutline(fillPath, width, height, corner, top, bottom, bite.right, bite.radius, openTop, openBottom, 0f)
        notchedOutline(borderPath, width, height, corner, top, bottom, bite.right, bite.radius, openTop, openBottom, w / 2)
        return true
    }
}

// A circle quadrant as one cubic: the control points sit this fraction of the way from the ends to the corner.
private const val Kappa = 0.44771525f

/** A rounded corner at ([cx], [cy]) from ([sx], [sy]) to ([ex], [ey]): a line to the start, then the quadrant. */
private fun Path.corner(sx: Float, sy: Float, cx: Float, cy: Float, ex: Float, ey: Float) {
    lineTo(sx, sy)
    cubicTo(sx + Kappa * (cx - sx), sy + Kappa * (cy - sy), ex + Kappa * (cx - ex), ey + Kappa * (cy - ey), ex, ey)
}

/**
 * The card's outline minus the bite, clockwise from the top edge. [inset] shrinks the material by that much all
 * round (the bite grows by it), so the border path at half the border width, stroked at the full width, covers
 * exactly the layout bounds, as the plain box does. The bite's inner corners are concave on the card (radius
 * [bite radius] + inset); where the bite reaches the card's top or bottom edge, the corner is convex instead.
 */
private fun notchedOutline(
    path: Path,
    width: Float,
    height: Float,
    corner: Float,
    biteTop: Float,
    biteBottom: Float,
    biteRight: Float,
    biteRadius: Float,
    openTop: Boolean,
    openBottom: Boolean,
    inset: Float,
) {
    val x0 = inset
    val y0 = inset
    val x1 = width - inset
    val y1 = height - inset
    val rc = (corner - inset).coerceAtLeast(0f)                       // the card's own corners
    val bx = biteRight + inset                                        // the bite's end edge
    val bt = biteTop - inset
    val bb = biteBottom + inset
    val inner = biteRadius + inset                                    // concave corners of the bite
    val convex = (biteRadius - inset).coerceAtLeast(0f)               // corners where the bite meets a card edge
    val rtl = minOf(corner - inset, biteTop - 2 * inset).coerceAtLeast(0f)               // card corners left on the start edge
    val rbl = minOf(corner - inset, height - biteBottom - 2 * inset).coerceAtLeast(0f)

    path.rewind()
    if (openTop) path.moveTo(bx + convex, y0) else path.moveTo(x0 + rtl, y0)
    path.corner(x1 - rc, y0, x1, y0, x1, y0 + rc)
    path.corner(x1, y1 - rc, x1, y1, x1 - rc, y1)
    if (openBottom) {
        path.corner(bx + convex, y1, bx, y1, bx, y1 - convex)
    } else {
        path.corner(x0 + rbl, y1, x0, y1, x0, y1 - rbl)
        path.lineTo(x0, bb)
        path.corner(bx - inner, bb, bx, bb, bx, bb - inner)
    }
    if (openTop) {
        path.corner(bx, y0 + convex, bx, y0, bx + convex, y0)
    } else {
        path.corner(bx, bt + inner, bx, bt, bx - inner, bt)
        path.lineTo(x0, bt)
        path.corner(x0, y0 + rtl, x0, y0, x0 + rtl, y0)
    }
    path.close()
}

/**
 * A white surface with a 2 dp border and 6 dp radius. Flat at rest; [hero] carries the card shadow. [contentPadding] is
 * the space inside the border: 20 dp on a phone page, less where a control has to be wide (the check-in's strips).
 */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    hero: Boolean = false,
    contentPadding: Dp = 20.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Qala.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusMd, if (hero) c.shadowCard else null)
            .padding(QalaTokens.borderWidth + contentPadding),
        content = content,
    )
}

/** A bordered list: a recessed 48 dp header with a [title], then [GroupRow]s. */
@Composable
fun Group(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Qala.colors
    val border = QalaTokens.borderWidth
    Column(
        modifier = modifier
            .fillMaxWidth()
            .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusMd)
            .padding(border)                                      // overflow: hidden clips to the padding box
            .clip(RoundedCornerShape((QalaTokens.radiusMd - border).coerceAtLeast(0.dp))),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(c.bgRecessed)
                .defaultMinSize(minHeight = 48.dp)
                .drawBehind { drawRect(c.border, Offset(0f, size.height - border.toPx()), Size(size.width, border.toPx())) }
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp + border),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            GroupLabel(title)
        }
        content()
    }
}

/** A 56 dp row in a [Group], with a 1 dp divider unless it is the [last] one. */
@Composable
fun GroupRow(
    modifier: Modifier = Modifier,
    last: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    val c = Qala.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 56.dp)
            .drawBehind {
                if (!last) drawRect(c.border, Offset(0f, size.height - 1.dp.toPx()), Size(size.width, 1.dp.toPx()))
            }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.Start),
        content = content,
    )
}
