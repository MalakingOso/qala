package com.qala.design

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.android.awaitFrame
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// Motion tokens (docs/HANDOFF-rail-refresh.md): open 260 ms expo-out, close 200 ms ease-in, rows 25 ms apart from 40 ms.
private const val OpenMs = 260
private const val CloseMs = 200
private const val RowDelayMs = 40f
private const val RowStaggerMs = 25f
private const val RowFadeMs = 160f
private const val RowSlideMs = 200f
private val MenuEase = CubicBezierEasing(0.25f, 1f, 0.5f, 1f)

private val PanelWidth = 252.dp
private val RowSlide = 12.dp

/** Milliseconds, in the rows' own clock, until the last of [count] rows has finished sliding in. */
private fun rowsDuration(count: Int) = RowDelayMs + RowStaggerMs * (count - 1).coerceAtLeast(0) + RowSlideMs

/**
 * The day menu: a 252 dp panel that slides in from the start edge over a scrim, with a header, one row per stage and
 * Back to now pinned at the foot. Compose it once, over the whole screen (the scrim covers what it is placed over),
 * and drive it with [open]. The caller owns [viewing] and the open state; every way out ends in [onClose]:
 * the scrim, the close button, the system Back (a [BackHandler] inside this component, so it composes after, and
 * wins over, a shell-level one), a swipe left on the panel, and picking a row or Back to now, which call
 * [onSelect] first. Back to now selects [nowIndex] and is enabled only while [viewing] is something else.
 *
 * A row shows its stage's number (a check when Done), its label and, for a Done stage, its time. The viewed row is
 * inverted. Interlude rows are quieter: a smaller node and muted text.
 *
 * Motion: open 260 ms on `cubic-bezier(.25, 1, .5, 1)`, close 200 ms ease-in, rows staggered 25 ms apart from 40 ms.
 * Every frame is read in `offset`, `graphicsLayer` and `drawBehind` lambdas, so none recomposes. All of it is
 * frozen when system animations are off (see [animationsEnabled]): the menu appears and disappears instantly.
 *
 * For TalkBack the panel is a pane named [title], and the viewed row is spoken as "viewing". Focus moves to the viewed
 * row when the menu opens, but Compose only grants focus to a clickable outside touch mode, so that part serves
 * keyboard and switch access; a touch user (TalkBack included) starts at the pane.
 */
@Composable
fun DayMenu(
    open: Boolean,
    title: String,
    stages: List<RailStage>,
    viewing: Int,
    nowIndex: Int,
    onSelect: (Int) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val rowsTotal = rowsDuration(stages.size)
    val panel = remember { Animatable(if (open) 1f else 0f) }                  // eased: 0 closed, 1 open
    val rowClock = remember { Animatable(if (open) rowsTotal else 0f) }       // linear ms on the rows' own clock
    var settled by remember { mutableStateOf(open) }                           // composed until the close animation ends
    val focus = remember { FocusRequester() }

    LaunchedEffect(open) {
        val animate = animationsEnabled(context)
        if (open) {
            settled = true
            if (animate) {
                coroutineScope {
                    launch { panel.animateTo(1f, tween(OpenMs, easing = MenuEase)) }
                    launch { rowClock.animateTo(rowsTotal, tween(rowsTotal.roundToInt(), easing = LinearEasing)) }
                }
            } else {
                panel.snapTo(1f)
                rowClock.snapTo(rowsTotal)
            }
        } else {
            if (animate) panel.animateTo(0f, tween(CloseMs, easing = EaseIn)) else panel.snapTo(0f)
            rowClock.snapTo(0f)
            settled = false
        }
    }
    LaunchedEffect(open) {
        if (open) {
            awaitFrame()                       // the viewed row has to be laid out before it can take focus
            try {
                focus.requestFocus()
            } catch (_: IllegalStateException) {
                // not attached: the menu closed again before the frame
            }
        }
    }

    // Registered while composed, enabled only while open: a later registration beats the shell's.
    BackHandler(enabled = open, onBack = onClose)

    if (!open && !settled) return

    val c = Qala.colors
    val rail = railColors()
    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = panel.value }
                .background(rail.scrim)
                .pointerInput(Unit) { detectTapGestures { onClose() } }
                .semantics {
                    role = Role.Button
                    contentDescription = "Close $title"
                    onClick { onClose(); true }
                },
        )
        Column(
            Modifier
                .offset { IntOffset((-1.05f * PanelWidth.roundToPx() * (1f - panel.value)).roundToInt(), 0) }
                .width(PanelWidth)
                .fillMaxHeight()
                .drawBehind {
                    val border = QalaTokens.borderWidth.toPx()
                    val shadow = 4.dp.toPx()                                   // CSS: box-shadow 4px 0 0 0
                    drawRect(c.shadowCard.color, Offset(size.width, 0f), Size(shadow, size.height))
                    drawRect(c.bgSurface, size = size)
                    drawRect(c.borderStrong, Offset(size.width - border, 0f), Size(border, size.height))
                }
                .pointerInput(Unit) { detectTapGestures { } }                 // a tap on the panel is not a tap on the scrim
                .pointerInput(Unit) {
                    var travelled = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { travelled = 0f },
                        onDragEnd = { if (travelled < -48.dp.toPx()) onClose() },
                    ) { _, delta -> travelled += delta }
                }
                .semantics {
                    paneTitle = title
                    isTraversalGroup = true
                }
                .windowInsetsPadding(WindowInsets.systemBars.only(WindowInsetsSides.Vertical))
                .padding(horizontal = 14.dp, vertical = 20.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(bottom = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                QalaText(
                    title,
                    Modifier.weight(1f),
                    QalaType.pageTitle.copy(fontSize = 21.sp, lineHeight = 24.sp),
                    c.fg,
                    maxLines = 1,
                )
                Box(
                    Modifier
                        .size(44.dp)
                        .clickable(role = Role.Button, onClickLabel = "Close", onClick = onClose),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .size(32.dp)
                            .border(QalaTokens.borderWidth, c.border, RoundedCornerShape(QalaTokens.radiusMd))
                            .background(c.bgSurface, RoundedCornerShape(QalaTokens.radiusMd)),
                        contentAlignment = Alignment.Center,
                    ) {
                        QalaIcon(QalaIcons.X, "Close", size = 14.dp, tint = c.fg)
                    }
                }
            }
            stages.forEachIndexed { i, stage ->
                StageRow(
                    index = i,
                    stage = stage,
                    selected = i == viewing,
                    colors = rail,
                    open = open,
                    panel = panel,
                    rowClock = rowClock,
                    focus = if (i == viewing) focus else null,
                    onClick = { onSelect(i); onClose() },
                )
            }
            Spacer(Modifier.weight(1f))
            val backEnabled = viewing != nowIndex
            Box(
                Modifier
                    .fillMaxWidth()
                    .alpha(if (backEnabled) 1f else 0.45f)
                    .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusMd, if (backEnabled) c.shadowCard else null)
                    .clickable(enabled = backEnabled, role = Role.Button) { onSelect(nowIndex); onClose() }
                    .heightIn(min = 48.dp)
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                QalaText("Back to now", style = QalaType.button.copy(fontSize = 13.5.sp), color = c.fg, maxLines = 1)
            }
        }
    }
}

/**
 * How far row [index] has come in, 0..1: staged by the rows' own clock while opening, and following the panel
 * while it closes (no delays, as in the prototype). Two functions, not an object, so a frame allocates nothing.
 */
private fun rowOpacity(open: Boolean, panel: Float, clockMs: Float, index: Int): Float =
    if (!open) panel else EaseCss.transform(((clockMs - RowDelayMs - RowStaggerMs * index) / RowFadeMs).coerceIn(0f, 1f))

private fun rowSlide(open: Boolean, panel: Float, clockMs: Float, index: Int): Float =
    if (!open) panel else MenuEase.transform(((clockMs - RowDelayMs - RowStaggerMs * index) / RowSlideMs).coerceIn(0f, 1f))

@Composable
private fun StageRow(
    index: Int,
    stage: RailStage,
    selected: Boolean,
    colors: RailColors,
    open: Boolean,
    panel: Animatable<Float, *>,
    rowClock: Animatable<Float, *>,
    focus: FocusRequester?,
    onClick: () -> Unit,
) {
    val c = Qala.colors
    val quiet = stage.interlude
    val label = if (selected) colors.rowSelFg else if (quiet) c.fgMuted else c.fg
    val sub = if (selected) colors.rowSelFg2 else c.fgMuted
    val shape = RoundedCornerShape(QalaTokens.radiusMd)
    val spoken = buildString {
        append(stage.label)
        if (stage.state == StageDotState.Done && stage.doneTime != null) append(", done at ").append(stage.doneTime)
        else append(", ").append(stage.state.name.lowercase())
        if (selected) append(", viewing")
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 2.dp)
            .graphicsLayer {
                alpha = rowOpacity(open, panel.value, rowClock.value, index)
                translationX = -RowSlide.toPx() * (1f - rowSlide(open, panel.value, rowClock.value, index))
            }
            .then(if (focus != null) Modifier.focusRequester(focus) else Modifier)
            .then(if (selected) Modifier.background(colors.rowSelBg, shape).border(QalaTokens.borderWidth, colors.rowSelBorder, shape) else Modifier)
            .selectable(
                selected = selected,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Button,
                onClick = onClick,
            )
            .semantics { contentDescription = spoken }
            .heightIn(min = 44.dp)
            .padding(horizontal = 6.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StageNode(index, stage, colors, quiet)
        Column {
            QalaText(stage.label, style = QalaType.bodyStrong.copy(fontSize = 13.5.sp, lineHeight = 17.sp, fontWeight = if (quiet) FontWeight.Medium else FontWeight.SemiBold), color = label, maxLines = 1)
            val note = when {
                stage.state == StageDotState.Done && stage.doneTime != null -> stage.doneTime
                stage.state == StageDotState.Skipped -> "Skipped"
                else -> null
            }
            if (note != null) {
                QalaText(note, style = QalaType.figureUnit.copy(fontSize = 11.sp, lineHeight = 14.sp), color = sub, maxLines = 1)
            }
        }
    }
}

/** The 28 dp node of a row: a check when Done, the stage number otherwise; ember for Now, a ring for Skipped. */
@Composable
private fun StageNode(index: Int, stage: RailStage, colors: RailColors, quiet: Boolean) {
    val c = Qala.colors
    val size = if (quiet) 22.dp else 28.dp
    val (fill, edge, ink) = when (stage.state) {
        StageDotState.Done -> Triple(c.progressFill, c.progressFill, colors.onInk)
        StageDotState.Now -> Triple(c.accent, c.accent, c.onAccent)
        StageDotState.Later -> Triple(c.bgSurface, colors.nodeBorder, c.fgMuted)
        StageDotState.Skipped -> Triple(Color.Transparent, colors.dotRing, c.fgMuted)
    }
    Box(
        Modifier
            .padding(horizontal = if (quiet) 3.dp else 0.dp)
            .size(size)
            .background(fill, CircleShape)
            .border(QalaTokens.borderWidth, edge, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (stage.state == StageDotState.Done) {
            QalaIcon(QalaIcons.Check, null, size = if (quiet) 11.dp else 14.dp, tint = ink)
        } else {
            QalaText((index + 1).toString(), style = QalaType.figureUnit.copy(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold), color = ink, maxLines = 1)
        }
    }
}
