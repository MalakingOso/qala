package com.qala.design

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * The page frames of the three carriers (DECISIONS S51). A screen hands one of them its head, its scroll state and its content, and gets
 * the wash's scrim behind it, the head scrolling away with the content, 16 dp gutters, and room under the last row for the tab island.
 * The shell caps the width at ContentMaxWidth, so the frames do not.
 */

/**
 * The umber ramps over the frosted still that keep white text and charts readable on it. [Soft] is for screens where only cards and glass
 * controls sit on the wash (the lifting flow), [Board3] for heads over a sheet and for text or charts drawn straight on the wash, and
 * [Glass] for the Glass screens, where the wash stays visible between the cards.
 */
enum class WashScrim { Soft, Board3, Glass }

private val Umber = Color(20, 10, 4)

private fun WashScrim.stops(): Array<Pair<Float, Color>> {
    val ramp = when (this) {
        WashScrim.Soft -> listOf(0f to 0.3f, 0.4f to 0.18f, 0.75f to 0.08f, 1f to 0f)
        WashScrim.Board3 -> listOf(0f to 0.7f, 0.3f to 0.52f, 0.5f to 0.6f, 0.66f to 0.88f, 1f to 0.94f)
        WashScrim.Glass -> listOf(0f to 0.58f, 0.28f to 0.34f, 0.6f to 0.26f, 1f to 0.42f)
    }
    return ramp.map { (at, alpha) -> at to Umber.copy(alpha = alpha) }.toTypedArray()
}

/** The scrim of [kind] over the wash: an umber vertical gradient that fills its parent. The shell's backdrop paints none, so this is the only one. */
@Composable
fun WashScrimLayer(kind: WashScrim, modifier: Modifier = Modifier) {
    val brush = remember(kind) { Brush.verticalGradient(*kind.stops()) }
    Box(modifier.fillMaxSize().background(brush))
}

private val TabTitle = Wash.Title.copy(fontSize = 34.sp, lineHeight = 38.sp)

/**
 * The one head. A tab screen (no [onBack]) has the [eyebrow] over a 34 sp title and its [actions] at the right. A pushed screen starts with
 * a glass Back and uses the 30 sp title. White on the wash with a text shadow, the same in Light and Dark. The title is the heading
 * TalkBack jumps to.
 */
@Composable
fun ScreenHead(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        if (onBack != null) GlassButton(onBack, icon = QalaIcons.ChevronLeft, description = "Back")
        Column(Modifier.weight(1f).padding(top = 2.dp)) {
            if (eyebrow != null) QalaText(eyebrow.uppercase(), style = Wash.Kicker, color = Wash.Text2, maxLines = 1)
            QalaText(title, Modifier.semantics { heading() }, if (onBack == null) TabTitle else Wash.Title, Wash.Text, maxLines = 1)
        }
        actions()
    }
}

/** The head's own top and side padding: under the status bar, 12 dp down, 16 dp in from each edge. */
private fun Modifier.headPadding(): Modifier = statusBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp)

/** What a [pinned] slot sits in: the bottom of the page, full width, over the scrolling content. */
@Composable
private fun BoxScope.Pinned(pinned: (@Composable BoxScope.() -> Unit)?) {
    if (pinned != null) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), content = pinned)
}

/**
 * A screen of the Wash carrier: content straight on the wash under the [scrim], white cards only to read or fill in. [head] scrolls
 * with [content], which starts 16 dp under it and sits in 16 dp gutters, with [LocalBarClearance] and 16 dp under its last row so the tab
 * island floats over empty wash. [pinned] is drawn over the bottom of the page and does not scroll; it does not add to the scroll's
 * bottom padding, so a page with a tall pinned bar adds the room itself.
 */
@Composable
fun WashPage(
    scroll: ScrollState,
    scrim: WashScrim,
    head: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    pinned: (@Composable BoxScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(modifier.fillMaxSize()) {
        WashScrimLayer(scrim)
        Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Box(Modifier.headPadding()) { head() }
            Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = LocalBarClearance.current + 16.dp), content = content)
        }
        Pinned(pinned)
    }
}

/**
 * A screen of the Sheet carrier: the wash head, then Today's cream sheet carrying [content], on the [WashScrim.Board3] scrim. The sheet
 * starts 20 dp under the head and runs at least to the bottom of the screen, so a short page is still cream to the edge. Inside it are
 * 16 dp gutters, 26 dp of air at the top and [LocalBarClearance] and 16 dp under the last row. The theme decides the sheet's colour.
 */
@Composable
fun SheetPage(
    scroll: ScrollState,
    head: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    pinned: (@Composable BoxScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        // A scroll column measures its children without a height limit, so the sheet's minimum is the screen less what is above it.
        var headPx by remember { mutableIntStateOf(0) }
        val minSheet = (maxHeight - with(LocalDensity.current) { headPx.toDp() } - 20.dp).coerceAtLeast(0.dp)
        WashScrimLayer(WashScrim.Board3)
        Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Box(Modifier.onSizeChanged { headPx = it.height }.headPadding()) { head() }
            Spacer(Modifier.height(20.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = minSheet)
                    .sheetSurface(sheetColor())
                    .padding(start = 16.dp, end = 16.dp, top = 26.dp, bottom = LocalBarClearance.current + 16.dp),
                content = content,
            )
        }
        Pinned(pinned)
    }
}

/** A screen of the Glass carrier: [WashPage] on the [WashScrim.Glass] scrim, its cards 12 dp apart. */
@Composable
fun GlassPage(
    scroll: ScrollState,
    head: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    WashPage(scroll, WashScrim.Glass, head, modifier) { Column(verticalArrangement = Arrangement.spacedBy(12.dp), content = content) }
}

/** The shadow a sheet or a pinned bar throws upward: umber, fading out over 34 dp above the top edge. */
private fun DrawScope.sheetShadow(alpha: Float) {
    val reach = 34.dp.toPx()
    drawRect(Brush.verticalGradient(listOf(Color.Transparent, Umber.copy(alpha = alpha)), startY = -reach, endY = 0f), Offset(0f, -reach), Size(size.width, reach))
}

/**
 * Today's sheet paint: [fill] on a 20 dp rounded top, a white 2 dp edge along the top and round the corners, and a shadow above it
 * that deepens with [shadow] (0 to 1). [shadow] is read when drawn, so a drag moves it without recomposing. [fill] is [sheetColor], passed in
 * so this stays a plain modifier. The paint reaches above the bounds for the shadow, so nothing between here and the screen may clip.
 */
fun Modifier.sheetSurface(fill: Color, shadow: () -> Float = { 0.3f }): Modifier = drawBehind {
    val d = density
    val radius = 20f * d
    val s = shadow()
    if (s > 0f) sheetShadow(0.38f * s)
    drawRoundRect(fill, Offset.Zero, size, CornerRadius(radius))
    // The white edge along the top and round the corners.
    val inset = d
    val edge = Path().apply {
        moveTo(inset, radius + inset)
        arcTo(Rect(inset, inset, 2 * radius + inset, 2 * radius + inset), 180f, 90f, false)
        lineTo(size.width - radius - inset, inset)
        arcTo(Rect(size.width - 2 * radius - inset, inset, size.width - inset, 2 * radius + inset), 270f, 90f, false)
    }
    drawPath(edge, Color.White.copy(alpha = 0.7f), style = Stroke(2f * d))
}

/** A card on the cream sheet: a plain surface, the Beamer border and shadow, 14 dp inside and 12 dp of air under it. */
@Composable
fun SheetCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = Qala.colors
    val border = QalaTokens.borderWidth
    Column(
        modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp)
            .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusLg, c.shadowCard)
            .padding(border + 14.dp),
        content = content,
    )
}

/**
 * A bar pinned to the bottom of a screen (a composer, a Save bar): the sheet colour down to the very bottom edge and a soft shadow above
 * it, with its [content] in a row ending [LocalBarClearance] above the edge so the tab island floats over the bar's own colour. Put it in
 * a page's `pinned` slot.
 */
@Composable
fun PinnedBar(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val fill = sheetColor()
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind {
                sheetShadow(0.3f)
                drawRect(fill)
                drawRect(Color.White.copy(alpha = 0.7f), size = Size(size.width, 1.dp.toPx()))
            }
            .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = LocalBarClearance.current),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}
