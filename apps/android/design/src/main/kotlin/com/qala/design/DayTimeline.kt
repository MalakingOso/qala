package com.qala.design

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/*
 * Today's day timeline (DECISIONS S48): the same stages as the day rail, drawn as dots on the film. There are two versions of the
 * one list: a vertical list that is there while the sheet is closed, and a row that takes over as it comes up and then docks
 * into the day card. Each is told by its caller whether it is the one on show ([active]); only that one is a button for TalkBack
 * and for a finger, and the other is not in the semantics tree at all.
 */

private val VideoTeal = Color(0xFF2DD4BF)
private val VideoEmber = Color(0xFFE0652B)
private val VideoLine = Color(0xFF7D7770)
private val VideoLater = Color(0xFF8C8378)
private val VideoLaterBorder = Color(0xFFC3BEB6)
private val VideoTime = Color(0xFFC9C4BD)
private val CardLaterBorder = Color(0xFFB8AD9C)
private val Halo = Color(0x59E0652B)

/** What a stage's time reads on the timeline: when a done stage was done, "now" on the stage the day is on, nothing for a later one (nothing is scheduled). */
fun RailStage.timelineTime(): String? = when {
    state == StageDotState.Done -> doneTime
    state == StageDotState.Now && !interlude -> "now"
    else -> null
}

/** The timeline as one button for TalkBack and for a finger: the rail's description, the stage being viewed, Open day stages, and the two stepping actions. */
private fun Modifier.timelineAccess(stages: List<RailStage>, viewing: Int, onOpenMenu: () -> Unit, onStep: (Int) -> Unit): Modifier = this
    .semantics(mergeDescendants = true) {
        contentDescription = railDescription(stages)
        if (viewing != nowIndex(stages)) stateDescription = "Viewing ${stages.getOrNull(viewing)?.label.orEmpty()}"
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
    .clickable(onClickLabel = "Open day stages", role = Role.Button, onClick = onOpenMenu)

private fun Modifier.timelineAccess(active: Boolean, stages: List<RailStage>, viewing: Int, onOpenMenu: () -> Unit, onStep: (Int) -> Unit): Modifier =
    if (active) timelineAccess(stages, viewing, onOpenMenu, onStep) else clearAndSetSemantics { }

/** The index the progress line runs to: the last stage that is done or now. */
private fun progressIndex(stages: List<RailStage>): Int = stages.indexOfLast { !it.interlude && (it.state == StageDotState.Done || it.state == StageDotState.Now) }.coerceAtLeast(0)

private fun dotRadius(stage: RailStage, scale: Float): Float = when {
    stage.state == StageDotState.Now -> 6.5f * scale
    stage.interlude -> 3.5f * scale
    else -> 5f * scale
}

// ---- vertical ----

private val RowPitch = 32.dp
private val LabelInset = 24.dp
private val VLabel = QalaType.button.copy(fontSize = 13.sp, lineHeight = 18.sp, shadow = Shadow(Color(0x73000000), Offset(0f, 2f), 8f))
private val VTime = QalaType.log.copy(fontSize = 10.5.sp, lineHeight = 14.sp)

/** The height of the vertical timeline for [count] stages. */
fun verticalTimelineHeight(count: Int): Dp = RowPitch * count

/** The vertical list on the film: a dot, a name and a time per stage, joined by a line that is teal as far as the day has got. */
@Composable
fun DayTimelineVertical(
    stages: List<RailStage>,
    viewing: Int,
    active: Boolean,
    onOpenMenu: () -> Unit,
    onStep: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val nowAt = nowIndex(stages)
    Column(
        modifier
            .timelineAccess(active, stages, viewing, onOpenMenu, onStep)
            .drawBehind {
                val pitch = RowPitch.toPx()
                val x = 5.dp.toPx()
                val y0 = 9.dp.toPx()
                val last = (stages.size - 1).coerceAtLeast(0)
                drawLine(Color.White.copy(alpha = 0.35f), Offset(x, y0), Offset(x, y0 + pitch * last), 2.dp.toPx())
                drawLine(VideoTeal, Offset(x, y0), Offset(x, y0 + pitch * progressIndex(stages)), 2.dp.toPx())
                stages.forEachIndexed { i, stage ->
                    val centre = Offset(x, y0 + pitch * i)
                    drawDot(stage, centre, 1f, stage.fillOnFilm(), stage.borderOnFilm(), i == viewing && viewing != nowAt)
                }
            },
    ) {
        stages.forEach { stage ->
            Row(Modifier.height(RowPitch)) {
                Spacer(Modifier.width(LabelInset))
                QalaText(stage.label, Modifier.height(18.dp), VLabel, Color.White, maxLines = 1)
                stage.timelineTime()?.let {
                    Spacer(Modifier.width(8.dp))
                    QalaText(it, Modifier.height(14.dp), VTime, Color.White.copy(alpha = 0.72f), maxLines = 1)
                }
            }
        }
    }
}

private fun RailStage.fillOnFilm(): Color = when (state) {
    StageDotState.Done -> VideoTeal
    StageDotState.Now -> VideoEmber
    StageDotState.Later -> Color.White.copy(alpha = 0.3f)
    StageDotState.Skipped -> Color.Transparent
}

private fun RailStage.borderOnFilm(): Color = when (state) {
    StageDotState.Done -> VideoTeal
    StageDotState.Now -> Color.White
    StageDotState.Later, StageDotState.Skipped -> Color.White.copy(alpha = 0.75f)
}

private fun DrawScope.drawDot(stage: RailStage, centre: Offset, scale: Float, fill: Color, border: Color, ringed: Boolean) {
    val r = dotRadius(stage, scale).dp.toPx()
    val stroke = 1.5.dp.toPx()
    if (stage.state == StageDotState.Now) drawCircle(Halo, r + 3.dp.toPx(), centre)
    if (ringed) drawCircle(border, r + 5.dp.toPx(), centre, style = Stroke(1.5.dp.toPx()))
    drawCircle(fill, r - stroke / 2, centre)
    drawCircle(border, r - stroke / 2, centre, style = Stroke(stroke))
}

// ---- row ----

private val RowLabel = QalaType.button.copy(fontSize = 10.sp, lineHeight = 14.sp, shadow = Shadow(Color(0x40000000), Offset(0f, 1f), 6f))
private val RowTime = QalaType.log.copy(fontSize = 9.sp, lineHeight = 12.sp)

/** The height of the row. */
val DayTimelineRowHeight = 42.dp

/**
 * The same stages as a row. [dock] (0 half, 1 full) moves the dots from the wide spread on the film to the narrower one inside
 * the day card, and [ink] (0 to 1) turns everything from the film's colours to the card's. Both are read when drawn and placed.
 */
@Composable
fun DayTimelineRow(
    stages: List<RailStage>,
    viewing: Int,
    active: Boolean,
    onOpenMenu: () -> Unit,
    onStep: (Int) -> Unit,
    dock: () -> Float,
    ink: () -> Float,
    modifier: Modifier = Modifier,
) {
    val c = Qala.colors
    val nowAt = nowIndex(stages)
    val progress = progressIndex(stages)
    Layout(
        content = {
            stages.forEachIndexed { i, stage ->
                QalaText(stage.label, { lerp(Color.White, c.fg, ink()) }, Modifier.layoutId("label$i"), RowLabel, maxLines = 1)
                stage.timelineTime()?.let { QalaText(it, { lerp(VideoTime, c.fgMuted, ink()) }, Modifier.layoutId("time$i"), RowTime, maxLines = 1) }
            }
        },
        modifier = modifier
            .timelineAccess(active, stages, viewing, onOpenMenu, onStep)
            .drawBehind {
                val e = ink()
                val line = lerp(VideoLine, c.border.compositeOver(c.bgSurface), e)
                val teal = lerp(VideoTeal, c.progressFill, e)
                val y = DotCentreY.toPx()
                val n = stages.size
                if (n > 1) {
                    drawLine(line, Offset(xAt(0, n, size.width, dock(), density), y), Offset(xAt(n - 1, n, size.width, dock(), density), y), 2.dp.toPx())
                    drawLine(teal, Offset(xAt(0, n, size.width, dock(), density), y), Offset(xAt(progress, n, size.width, dock(), density), y), 2.dp.toPx())
                }
                stages.forEachIndexed { i, stage ->
                    val ember = lerp(VideoEmber, c.accent, e)
                    val fill = when (stage.state) {
                        StageDotState.Done -> teal
                        StageDotState.Now -> ember
                        StageDotState.Later -> lerp(VideoLater, c.bgSurface, e)
                        StageDotState.Skipped -> Color.Transparent
                    }
                    val border = when (stage.state) {
                        StageDotState.Done -> teal
                        StageDotState.Now -> lerp(Color.White, c.accent, e)
                        StageDotState.Later, StageDotState.Skipped -> lerp(VideoLaterBorder, CardLaterBorder, e)
                    }
                    drawDot(stage, Offset(xAt(i, n, size.width, dock(), density), y), 1f, fill, border, i == viewing && viewing != nowAt)
                }
            },
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val n = stages.size
        val width = constraints.maxWidth
        // A label never gets wider than the room between two dots (at the narrower, docked spread), so a large font ellipsizes a name
        // instead of running it into its neighbour. The row's semantics carry the full names.
        val room = if (n > 1) ((width / density - 122f) / (n - 1) + 2f).coerceAtLeast(24f) * density else Float.MAX_VALUE
        val fit = loose.copy(maxWidth = minOf(loose.maxWidth.toFloat(), room).toInt())
        val placed = measurables.map { it.layoutId as String to it.measure(fit) }
        layout(width, DayTimelineRowHeight.roundToPx()) {
            val d = dock()
            placed.forEach { (id, p) ->
                val index = id.dropWhile { !it.isDigit() }.toInt()
                val x = xAt(index, n, width.toFloat(), d, density)
                val y = if (id.startsWith("label")) LabelY.roundToPx() else TimeY.roundToPx()
                p.place((x - p.width / 2f).roundToInt(), y)
            }
        }
    }
}

private val DotCentreY = 6.dp
private val LabelY = 14.dp
private val TimeY = 28.dp

/** Dot [i] of [n] at [dock] between the wide spread on the film (36 dp in from the start, 37 from the end) and the narrow one in the day card (61 dp each side). */
private fun xAt(i: Int, n: Int, width: Float, dock: Float, density: Float): Float {
    if (n <= 1) return width / 2f
    val t = i / (n - 1f)
    val half = (36f + (width / density - 73f) * t) * density
    val full = (61f + (width / density - 122f) * t) * density
    return half + (full - half) * dock
}
