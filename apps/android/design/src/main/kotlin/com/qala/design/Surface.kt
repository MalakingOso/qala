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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The Beamer surface (DESIGN 1): a flat fill, a border drawn inside the box, and a hard offset shadow with no blur
 * and no elevation. The shadow is painted behind the box, so an opaque [fill] hides the part under it. Nothing here
 * clips, so the shadow may spill outside the layout bounds; leave room for it.
 */
fun Modifier.beamerSurface(
    fill: Color,
    border: Color,
    radius: Dp,
    shadow: QalaShadow? = null,
    borderWidth: Dp = QalaTokens.borderWidth,
): Modifier = drawBehind {
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

/** A white surface with a 2 dp border and 6 dp radius. Flat at rest; [hero] carries the card shadow. */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    hero: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = Qala.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusMd, if (hero) c.shadowCard else null)
            .padding(QalaTokens.borderWidth + 20.dp),
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
