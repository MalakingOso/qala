package com.qala.design

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.systemGestureExclusion
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.hypot

private class LastBand {
    var rect = Rect.Zero
}

private val StripWidth = 28.dp
private val StripPad = 14.dp
private val StripBorder = 2.dp
private val StripCorner = 8.dp
private val DotGap = 9.dp
private val DotSize = 9.dp
private val DotNow = 11.dp
private val DotSoft = 7.dp

// Hit slop: the strip is 28 dp wide, the touch target 48 dp, and a little taller than the strip. The whole target is
// excluded from the system back gesture (200 dp tall at most per screen edge; six dots fit with room to spare).
private val HitEnd = 20.dp
private val HitVertical = 10.dp

// Gesture thresholds, from the working slice: 40 dp right opens the menu, every 32 dp up or down steps a stage.
private val OpenDistance = 40.dp
private val StepDistance = 32.dp

private fun dotSize(stage: RailStage): Dp = when {
    stage.state == StageDotState.Now -> DotNow
    stage.interlude -> DotSoft
    else -> DotSize
}

/** The strip's height for [stages]: the dots and the gaps between them, 14 dp of padding and the 2 dp borders. */
private fun stripHeight(stages: List<RailStage>): Dp {
    var content = DotGap * (stages.size - 1).coerceAtLeast(0)
    for (s in stages) content += dotSize(s)
    return content + StripPad * 2 + StripBorder * 2
}

/**
 * Today's day rail: a 28 dp strip of status dots hugging the start edge of the screen, one dot per stage. It is
 * fixed, never scrolls, and its height follows the stage count, so place it yourself (centred in the band between
 * the pinned head and the tab bar). It owns no state: [viewing] is the stage the screen is previewing, and the
 * caller moves it from [onStep].
 *
 * Dots: Done is solid teal, Now is a larger ember dot, Later an outline, Skipped a hollow ring, and an interlude
 * stage (recover, wind down) a smaller, softer dot. An ink ring marks [viewing]. The strip is tint-only glass
 * (see [glass]) with the card shadow.
 *
 * One pointer handler covers everything. A tap, or a swipe right of 40 dp, calls [onOpenMenu] (stronger haptic).
 * A vertical drag steps through the stages as a ratchet: [onStep] with +1 (swipe up, next) or -1 (swipe down,
 * previous) for every 32 dp of travel, with a haptic tick for each step that actually moves, and no step at the
 * ends of the list. The touch target is 48 dp wide and excluded from the system back gesture, so the swipe right
 * is the strip's, not Back's. For TalkBack the strip is one button that opens the menu, with the custom actions
 * "Next stage" and "Previous stage".
 *
 * [onBandChanged] reports the visible strip's rectangle in root coordinates (px) whenever it moves or resizes. Cards
 * turn it into their bite with [rememberCardNotch].
 */
@Composable
fun DayRail(
    stages: List<RailStage>,
    viewing: Int,
    onStep: (delta: Int) -> Unit,
    onOpenMenu: () -> Unit,
    onBandChanged: (Rect) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Qala.colors
    val rail = railColors()
    val haptics = LocalHapticFeedback.current
    val latestStages by rememberUpdatedState(stages)
    val latestViewing by rememberUpdatedState(viewing)
    val latestStep by rememberUpdatedState(onStep)
    val latestOpen by rememberUpdatedState(onOpenMenu)
    val latestBand by rememberUpdatedState(onBandChanged)
    val shape = RoundedCornerShape(topEnd = StripCorner, bottomEnd = StripCorner)
    val teal = c.progressFill
    val ember = c.accent
    val ink = c.fg
    val lastBand = remember { LastBand() }

    Box(
        modifier
            .systemGestureExclusion()
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = railDescription(stages)
                if (viewing != nowIndex(stages)) stateDescription = "Viewing ${stages.getOrNull(viewing)?.label.orEmpty()}"
                onClick(label = "Open day stages") { onOpenMenu(); true }
                customActions = listOf(
                    CustomAccessibilityAction("Next stage") {
                        val next = nextStage(stages, viewing, +1)
                        if (next != viewing) onStep(+1)
                        next != viewing
                    },
                    CustomAccessibilityAction("Previous stage") {
                        val next = nextStage(stages, viewing, -1)
                        if (next != viewing) onStep(-1)
                        next != viewing
                    },
                )
            }
            .pointerInput(Unit) {
                val slop = viewConfiguration.touchSlop
                val openDistance = OpenDistance.toPx()
                val stepDistance = StepDistance.toPx()
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    var dx = 0f
                    var dy = 0f
                    var axis = 0            // 0 undecided, 1 horizontal, 2 vertical
                    var opened = false
                    var carry = 0f          // vertical travel not yet turned into a step
                    var at = latestViewing
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Main)
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) {
                            if (axis == 0 && !change.isConsumed) {      // a tap
                                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                                latestOpen()
                            }
                            break
                        }
                        if (axis == 0 && change.isConsumed) break
                        val move = change.positionChange()
                        dx += move.x
                        dy += move.y
                        var decided = false
                        if (axis == 0 && hypot(dx, dy) > slop) {
                            axis = if (abs(dx) > abs(dy)) 1 else 2
                            carry = -dy                                  // the travel up to the slop counts toward the first step
                            decided = true
                        }
                        if (axis == 1 && !opened && dx >= openDistance) {
                            opened = true
                            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                            latestOpen()
                        } else if (axis == 2) {
                            if (!decided) carry -= move.y                // up is positive: the next stage
                            while (abs(carry) >= stepDistance) {
                                val delta = if (carry > 0f) +1 else -1
                                carry -= delta * stepDistance
                                val next = nextStage(latestStages, at, delta)
                                if (next == at) {
                                    carry = 0f                           // at an end: no step, and no travel owed
                                } else {
                                    at = next
                                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                                    latestStep(delta)
                                }
                            }
                        }
                        if (axis != 0) change.consume()
                    }
                }
            }
            .padding(end = HitEnd, top = HitVertical, bottom = HitVertical)
            .onGloballyPositioned {
                val bounds = it.boundsInRoot()
                if (bounds != lastBand.rect) {
                    lastBand.rect = bounds
                    latestBand(bounds)
                }
            }
            .size(StripWidth, stripHeight(stages))
            .outsideShadow(shape, c.shadowCard.color, c.shadowCard.dx, c.shadowCard.dy)
            .glass(rail.stripTint, shape)
            .drawWithCache {
                val border = borderPath(size.width, size.height, StripBorder.toPx(), StripCorner.toPx())
                onDrawBehind {
                    drawStrip(border, rail, stages, viewing, teal, ember, ink)
                }
            },
    )
}

/** The strip's border: top, end and bottom, with the end corners rounded and no border on the start edge. */
private fun borderPath(width: Float, height: Float, border: Float, corner: Float): Path {
    val h = border / 2
    val r = corner - h
    val x1 = width - h
    return Path().apply {
        moveTo(0f, h)
        lineTo(x1 - r, h)
        cubicTo(x1 - r * 0.4477f, h, x1, h + r * 0.4477f, x1, h + r)
        lineTo(x1, height - h - r)
        cubicTo(x1, height - h - r * 0.4477f, x1 - r * 0.4477f, height - h, x1 - r, height - h)
        lineTo(0f, height - h)
    }
}

private fun DrawScope.drawStrip(
    borderPath: Path,
    rail: RailColors,
    stages: List<RailStage>,
    viewing: Int,
    teal: Color,
    ember: Color,
    ink: Color,
) {
    val border = StripBorder.toPx()
    drawPath(borderPath, rail.stripBorder, style = Stroke(border))
    val cx = (size.width - border) / 2           // dots centre in the box between the start edge and the end border
    var y = border + StripPad.toPx()
    stages.forEachIndexed { i, stage ->
        val d = dotSize(stage).toPx()
        val centre = Offset(cx, y + d / 2)
        val r = d / 2
        if (i == viewing) {
            // CSS: box-shadow 0 0 0 2px halo, 0 0 0 3.5px ink
            drawCircle(rail.halo, r + 2.dp.toPx(), centre)
            drawCircle(ink, r + 2.75.dp.toPx(), centre, style = Stroke(1.5.dp.toPx()))
        }
        when (stage.state) {
            StageDotState.Done -> drawCircle(teal, r, centre)
            StageDotState.Now -> drawCircle(ember, r, centre)
            StageDotState.Later -> {
                drawCircle(rail.dotOff, r, centre)
                drawCircle(rail.dotOffBorder, r - 0.5.dp.toPx(), centre, style = Stroke(1.dp.toPx()))
            }
            StageDotState.Skipped -> drawCircle(rail.dotRing, r - 1.dp.toPx(), centre, style = Stroke(2.dp.toPx()))
        }
        y += d + DotGap.toPx()
    }
}
