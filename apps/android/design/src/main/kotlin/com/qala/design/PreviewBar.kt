package com.qala.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

private const val ExpandMs = 220
private val BarShape = RoundedCornerShape(QalaTokens.radiusMd)

/**
 * The bar under Today's pinned head while the screen previews a stage that is not now: "Previewing Run" and a Back to
 * now action. It is glass chrome (tint only, see [glass]) with the card shadow.
 *
 * [visible] expands the bar over 220 ms and collapses it the same way, by changing its height, so whatever sits
 * below it (the scrolling band) moves with it; the height and the fade are read in layout and draw, so the frames of
 * the animation recompose nothing. With system animations off it snaps. While it collapses it keeps the last
 * [label] it showed. Give it the head's horizontal padding through [modifier]; it brings its own gap above and
 * room below for the shadow.
 */
@Composable
fun PreviewBar(
    visible: Boolean,
    label: String,
    onBackToNow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val progress = remember { Animatable(if (visible) 1f else 0f) }
    var present by remember { mutableStateOf(visible) }          // composed from the open request until the collapse ends
    var kept by remember { mutableStateOf(label) }
    SideEffect { if (visible) kept = label }

    LaunchedEffect(visible) {
        val animate = animationsEnabled(context)
        if (visible) {
            present = true
            if (animate) progress.animateTo(1f, tween(ExpandMs, easing = EaseCss)) else progress.snapTo(1f)
        } else {
            if (animate) progress.animateTo(0f, tween(ExpandMs, easing = EaseCss)) else progress.snapTo(0f)
            present = false
        }
    }
    if (!present && !visible) return

    val c = Qala.colors
    val rail = railColors()
    Box(
        modifier
            .graphicsLayer {
                alpha = (progress.value / 0.82f).coerceIn(0f, 1f)           // the fade (.18 s) finishes just ahead of the height
                clip = progress.value < 1f                                   // clips to the animated height; a settled bar keeps its shadow
            }
            .layout { measurable, constraints ->
                val placeable = measurable.measure(constraints)
                val height = (placeable.height * progress.value).roundToInt()
                layout(placeable.width, height) { placeable.place(0, 0) }
            }
            .padding(top = 10.dp, bottom = 8.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .outsideShadow(BarShape, c.shadowCard.color, c.shadowCard.dx, c.shadowCard.dy)
                .glass(rail.glass, BarShape)
                .border(QalaTokens.borderWidth, c.border, BarShape)
                .heightIn(min = 48.dp)
                .padding(start = 12.dp, end = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            QalaText(
                "Previewing $kept",
                Modifier.weight(1f, fill = false).semantics { liveRegion = LiveRegionMode.Polite },
                QalaType.body.copy(fontSize = 12.5.sp, lineHeight = 18.sp),
                c.fg,
                maxLines = 1,
            )
            // The pill is 32 dp tall; its touch target is the full 48.
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.Button, onClick = onBackToNow)
                    .padding(horizontal = 4.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.background(c.fg, RoundedCornerShape(QalaTokens.radiusMd)).padding(horizontal = 12.dp, vertical = 7.dp)) {
                    QalaText("Back to now", style = QalaType.button.copy(fontSize = 12.sp, lineHeight = 18.sp), color = rail.onInk, maxLines = 1)
                }
            }
        }
    }
}
