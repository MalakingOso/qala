package com.qala.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs

/**
 * The lifting flow's look over the frosted still (DECISIONS S49): colours that do not follow the theme, because the wash behind them
 * is the same in Light and Dark. White text, an ember for the one thing that is happening, a teal for what is done, dark glass
 * for controls and a near-opaque card for anything that has to be read at length.
 */
object Wash {
    /** Under the wash image, so a decode that is late never flashes light. */
    val Ground = Color(0xFF140A04)
    val Ember = Color(0xFFFB923C)
    val EmberInk = Color(0xFF1B0E05)
    val Teal = Color(0xFF2DD4BF)
    val TealInk = Color(0xFF0B1B19)
    val Text = Color.White
    val Text2 = Color.White.copy(alpha = 0.92f)
    val Line = Color.White.copy(alpha = 0.34f)
    val GlassFill = Color(24, 14, 8, 128)
    val GlassBorder = Color.White.copy(alpha = 0.24f)
    val NodeFill = Color(24, 14, 8, 153)
    val NodeRing = Color.White.copy(alpha = 0.7f)
    val CardShadow = QalaShadow(dx = 2.dp, dy = 4.dp, color = Color(0, 0, 0, 71), ringWidth = 0.dp, ringColor = Color.Transparent)

    /** text-shadow: 0 2px 10px rgba(0,0,0,.5), what keeps white text readable over the lightest part of the wash. */
    val TextShadow = Shadow(Color(0x80000000), Offset(0f, 2f), 10f)
    val Kicker = QalaType.groupLabel.copy(shadow = TextShadow)
    val Title = QalaType.stageTitle.copy(fontSize = 30.sp, lineHeight = 34.sp, shadow = TextShadow)
    val Body = QalaType.log.copy(fontSize = 12.5.sp, lineHeight = 18.sp, shadow = TextShadow)
    val Small = QalaType.log.copy(fontSize = 12.sp, lineHeight = 16.sp, shadow = TextShadow)
}

/**
 * A translucent dark control for the wash: a flat fill and a hairline, 8 dp radius. Square (44 dp) with only an [icon], else a pill with
 * a [label] and an optional icon. It carries no shadow, which would show through the glass, and no blur.
 */
@Composable
fun GlassButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    label: String? = null,
    description: String? = null,
    size: Dp = 44.dp,
    iconSize: Dp = 22.dp,
    enabled: Boolean = true,
) {
    val shape = RoundedCornerShape(QalaTokens.radiusLg)
    val square = label == null
    Row(
        modifier
            .alpha(if (enabled) 1f else 0.4f)
            .then(if (square) Modifier.size(size) else Modifier.height(size).widthIn(min = size))
            .background(Wash.GlassFill, shape)
            .border(1.dp, Wash.GlassBorder, shape)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = description ?: label, onClick = onClick)
            .padding(horizontal = if (square) 0.dp else 12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) QalaIcon(icon, if (square) description else null, size = iconSize, tint = Wash.Text)
        if (label != null) QalaText(label, style = QalaType.log.copy(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium), color = Wash.Text, maxLines = 1)
    }
}

/** A white card over the wash: 95% of the theme's surface, a hairline, an 8 dp radius and a hard shadow dark enough to read on the wash. */
@Composable
fun WashCard(modifier: Modifier = Modifier, contentPadding: Dp = 12.dp, content: @Composable ColumnScope.() -> Unit) {
    val c = Qala.colors
    Column(
        modifier
            .fillMaxWidth()
            .beamerSurface(c.bgSurface.copy(alpha = 0.95f), c.border, QalaTokens.radiusLg, Wash.CardShadow)
            .padding(QalaTokens.borderWidth + contentPadding),
        content = content,
    )
}

// ---- the rail ----

/** The rail's column: its line and nodes are centred 42 dp from the screen's edge, and the content starts at its right. */
val RailWidth = 80.dp
private val RailCentre = 42.dp

/** The size of a node: the open one is the big one. */
fun railDotSize(state: StageDotState): Dp = when (state) {
    StageDotState.Now -> 40.dp
    StageDotState.Done -> 24.dp
    else -> 28.dp
}

/**
 * One node of [FlowRail]. [text] (a number) or [icon] sits in it; a done node always shows a check. [description] is what TalkBack
 * says for it, and [label] the short name under it.
 */
class FlowNode(
    val state: StageDotState,
    val description: String,
    val text: String? = null,
    val icon: ImageVector? = null,
    val label: String? = null,
)

/** A round node: ember when it is the open one, teal when done, dark glass with a white ring when still to come. */
@Composable
fun RailDot(state: StageDotState, modifier: Modifier = Modifier, text: String? = null, icon: ImageVector? = null) {
    val d = railDotSize(state)
    val fill = when (state) {
        StageDotState.Now -> Wash.Ember
        StageDotState.Done -> Wash.Teal
        else -> Wash.NodeFill
    }
    val ring = when (state) {
        StageDotState.Now -> Wash.Ember
        StageDotState.Done -> Wash.Teal
        else -> Wash.NodeRing
    }
    val ink = when (state) {
        StageDotState.Now -> Wash.EmberInk
        StageDotState.Done -> Wash.TealInk
        else -> Wash.Text
    }
    Box(
        modifier
            .size(d)
            .clearAndSetSemantics { }          // the node around it says what it is; its glyph is not a text of its own
            .drawBehind {
                if (state == StageDotState.Now) drawCircle(Color(0, 0, 0, 115), center = center + Offset(2.dp.toPx(), 4.dp.toPx()))
                drawCircle(fill)
                drawCircle(ring, radius = size.minDimension / 2 - 1.dp.toPx(), style = Stroke(2.dp.toPx()))
            },
        contentAlignment = Alignment.Center,
    ) {
        when {
            state == StageDotState.Done -> QalaIcon(QalaIcons.Check, null, size = 13.dp, tint = ink)
            icon != null -> QalaIcon(icon, null, size = if (state == StageDotState.Now) 20.dp else 14.dp, tint = ink)
            text != null -> QalaText(text, style = QalaType.log.copy(fontSize = if (state == StageDotState.Now) 15.sp else 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium), color = ink, maxLines = 1)
        }
    }
}

/** The short name under a node: 10 sp, centred in 68 dp, two lines at most, and no part of what TalkBack reads (the node describes itself). */
@Composable
private fun RailLabel(label: String, modifier: Modifier) {
    QalaText(
        label,
        modifier.width(68.dp).clearAndSetSemantics { },
        QalaType.log.copy(fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.Medium, shadow = Shadow(Color(0x99000000), Offset(0f, 1f), 6f)),
        Wash.Text2,
        TextAlign.Center,
        maxLines = 2,
    )
}

private fun DrawScope.railLine(x: Dp, from: Float, to: Float, color: Color) {
    if (to <= from) return
    drawRoundRect(color, Offset(x.toPx() - 1.dp.toPx(), from), Size(2.dp.toPx(), to - from), CornerRadius(1.dp.toPx()))
}

private fun lineColor(upper: StageDotState?) = if (upper == StageDotState.Done) Wash.Teal else Wash.Line

/** The shortest slot a node gets: a node, its two-line label and a little air. */
private val MinSlot = 72.dp

/**
 * Today's vertical day timeline, reused as the way through the workout (S49): a line down the left edge with one node per stop, the
 * open one big and in ember. Each node is a whole slot of the rail's height, so the tap target is never under 44 dp; [onPick] is the
 * index tapped. A vertical drag on the rail calls [onStep] with -1 or +1 (the stop before or after the open one). With no [onPick] the
 * rail is a display and nothing on it is tappable. The slots share the height evenly and the rail scrolls when they no longer fit.
 */
@Composable
fun FlowRail(
    nodes: List<FlowNode>,
    modifier: Modifier = Modifier,
    onPick: ((Int) -> Unit)? = null,
    onStep: ((Int) -> Unit)? = null,
) {
    val scroll = rememberScrollState()
    BoxWithConstraints(
        modifier
            .width(RailWidth)
            .then(
                if (onStep == null) Modifier else Modifier.pointerInput(onStep) {
                    var total = 0f
                    detectVerticalDragGestures(
                        onDragStart = { total = 0f },
                        onDragEnd = { if (abs(total) > 36.dp.toPx()) onStep(if (total > 0) 1 else -1) },
                        onDragCancel = { total = 0f },
                        onVerticalDrag = { _, dy -> total += dy },
                    )
                },
            ),
    ) {
        val slot = maxOf(MinSlot, if (nodes.isEmpty()) MinSlot else maxHeight / nodes.size)
        // Scrolling only when the slots no longer fit: a scroll modifier takes every vertical drag, even with nothing to scroll, and the step gesture would never see one.
        val overflow = MinSlot * nodes.size > maxHeight
        Column(if (overflow) Modifier.verticalScroll(scroll) else Modifier) {
            nodes.forEachIndexed { i, node ->
                val d = railDotSize(node.state)
                val centreY = slot * 0.42f
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(slot)
                        .drawBehind {
                            val cy = centreY.toPx()
                            val r = d.toPx() / 2
                            if (i > 0) railLine(RailCentre, 0f, cy - r + 2.dp.toPx(), lineColor(nodes[i - 1].state))
                            if (i < nodes.lastIndex) railLine(RailCentre, cy + r - 2.dp.toPx(), size.height, lineColor(node.state))
                        }
                        .then(
                            if (onPick == null) Modifier.semantics { contentDescription = node.description }
                            else Modifier
                                .clickable(role = Role.Tab, onClickLabel = node.description) { onPick(i) }
                                .semantics(mergeDescendants = true) {
                                    contentDescription = node.description
                                    selected = node.state == StageDotState.Now
                                },
                        ),
                ) {
                    RailDot(node.state, Modifier.offset(RailCentre - d / 2, centreY - d / 2), node.text, node.icon)
                    if (node.label != null) RailLabel(node.label, Modifier.offset(RailCentre - 34.dp, centreY + d / 2 + 3.dp))
                }
            }
        }
    }
}

/**
 * One step of a list that carries its own rail: a [RailWidth] column with the line and the node, then [content]. The node's centre is
 * [nodeY] below the top of the row, so it can sit beside a card's title, and the line runs through the whole row so the rows join. Pass
 * the state of the node above ([above], null for the first row) and of this one for the colour of each half of the line; [last] ends the line
 * at the node.
 */
@Composable
fun RailStepRow(
    state: StageDotState,
    above: StageDotState?,
    last: Boolean,
    modifier: Modifier = Modifier,
    nodeY: Dp = 16.dp,
    text: String? = null,
    icon: ImageVector? = null,
    label: String? = null,
    content: @Composable () -> Unit,
) {
    val d = railDotSize(state)
    Row(modifier.height(IntrinsicSize.Min)) {
        Box(
            Modifier
                .width(RailWidth)
                .fillMaxHeight()
                .drawBehind {
                    val cy = nodeY.toPx()
                    val r = d.toPx() / 2
                    if (above != null) railLine(RailCentre, 0f, cy - r + 2.dp.toPx(), lineColor(above))
                    if (!last) railLine(RailCentre, cy + r - 2.dp.toPx(), size.height, lineColor(state))
                },
        ) {
            RailDot(state, Modifier.offset(RailCentre - d / 2, nodeY - d / 2), text, icon)
            if (label != null) RailLabel(label, Modifier.offset(RailCentre - 34.dp, nodeY + d / 2 + 3.dp))
        }
        Box(Modifier.weight(1f)) { content() }
    }
}
