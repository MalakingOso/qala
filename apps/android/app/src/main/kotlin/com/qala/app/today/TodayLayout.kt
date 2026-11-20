package com.qala.app.today

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.util.lerp
import com.qala.design.Qala
import com.qala.design.TabBarHeight
import kotlin.math.max
import kotlin.math.min

/** The layers of Today. Each is composed by the screen and placed here; the order they are placed in is the order they are drawn in. */
internal enum class Slot {
    Head, Icons, Sheet, Peek, List, Handle, Cards, DayLabel, Action, TimelineV, TimelineRow,
    Kicker, Title, Meta, Number, Unit, Plates, Caption,
}

/** A slot's content in a box the layout can find by id. */
@Composable
internal fun Layer(slot: Slot, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(modifier.layoutId(slot)) { content() }
}

/** A shape with no area: a layer clipped to it draws nothing and is not hit. */
private object NoTouch : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline = Outline.Rectangle(Rect.Zero)
}

/** The hero's three sizes, as the prototype scales them: closed is full size, half is smaller, and docked in the now card smaller still. */
private class Scales(val title: Float, val number: Float, val plates: Float)

private val Closed = Scales(1f, 1f, 1f)
private val AtHalf = Scales(0.867f, 0.667f, 0.86f)
private val Docked = Scales(0.8f, 0.583f, 0.8f)

/** What the cards need to be drawn, measured by the layout. Equal geometry is not a change, so a re-measure that moves nothing redraws nothing. */
@Immutable
private data class CardGeo(
    val rowTopHalf: Float,
    val rowHeight: Float,
    val nowTopHalf: Float,
    val nowHeightHalf: Float,
    val nowHeightFull: Float,
)

/**
 * The hero as a stack that rides on the sheet. Each part keeps its base size and is scaled from its own top left corner, so the
 * stack's height is the sum of the scaled heights, and the whole is positioned from a top edge that moves from where it rides at
 * closed (just above the action block), to under the timeline at half, to inside the now card at full.
 */
private class HeroGeo(
    val d: Float,
    val kickerH: Float,
    val titleH: Float,
    val metaH: Float,
    val numberH: Float,
    val numberW: Float,
    val platesH: Float,
    val platesW: Float,
    val captionH: Float,
    val captionW: Float,
    val hasMeta: Boolean,
    val hasFigure: Boolean,
    val hasPlates: Boolean,
    val atClosed: Scales,
) {
    var topClosed = 0f
    var topHalf = 0f
    private val g1 = 3f * d
    private val g2 = 2f * d
    private val g3 = 4f * d
    private val captionGap = 4f * d

    fun scale(q1: Float, a: Float, pick: (Scales) -> Float): Float = lerp(lerp(pick(atClosed), pick(AtHalf), q1), pick(Docked), a)

    fun top(t: Float, q1: Float, a: Float) = lerp(lerp(topClosed, topHalf, q1), t + 146f * d, a)
    fun yTitle(top: Float) = top + kickerH + g1
    fun yNumber(top: Float, st: Float) = yTitle(top) + titleH * st + (if (hasMeta) g2 + metaH else 0f) + g3
    fun yMeta(top: Float, st: Float) = yTitle(top) + titleH * st + g2

    fun rightColumn(sp: Float) = if (hasPlates) platesH * sp + captionGap + captionH else 0f
    fun platesY(yNumber: Float, sn: Float, sp: Float) = yNumber + max(0f, (numberH * sn - rightColumn(sp)) / 2f)
    fun captionY(platesY: Float, sp: Float) = platesY + platesH * sp + captionGap
    fun unitY(yNumber: Float, sn: Float) = yNumber + 0.6875f * numberH * sn

    fun height(s: Scales): Float {
        var h = kickerH + g1 + titleH * s.title
        if (hasMeta) h += g2 + metaH
        if (hasFigure) h += g3 + max(numberH * s.number, rightColumn(s.plates))
        return h
    }
}

/**
 * Today's layers (DECISIONS S48). One custom layout holds all of them: the film's foreground (the head, the day timeline, the hero),
 * the sheet with its peek, list and handle, and the action block between them. Everything is measured once, here, and every layer is
 * then placed by a layer block that reads the drawer's [DrawerState.t], so a frame of the drag moves them all and recomposes
 * nothing. The three stops come from what was measured, not from constants: the hero rides just above the sheet, the day row sits
 * under the head, and the sheet comes to rest below the hero at half and under the head at full.
 *
 * The prototype's lerps are kept as they are. With q1 from closed to half, q2 from half to full, and a (the docking) a smoothstep of
 * q2, a hero part's value is `lerp(lerp(closed, half, q1), full, a)`.
 */
@Composable
internal fun TodayLayout(
    drawer: DrawerState,
    statusTop: Int,
    navBottom: Int,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val c = Qala.colors
    var cards by remember { mutableStateOf<CardGeo?>(null) }
    Layout(
        content = {
            content()
            Layer(Slot.Cards) {
                Box(
                    Modifier.fillMaxSize().drawBehind {
                        val g = cards ?: return@drawBehind
                        val q1 = drawer.q1
                        val q2 = drawer.q2
                        val a = drawer.docked
                        val t = drawer.t
                        val shown = smooth((q2 - 0.02f) / 0.3f)
                        if (shown <= 0f) return@drawBehind
                        val d = density
                        val x = lerp(12f * d, 16f * d, a)
                        val w = size.width - 2 * x
                        val radius = CornerRadius(10f * d)
                        // The day card: it grows from the row's own backdrop at half to the card the row docks into at full.
                        val dayTop = lerp(g.rowTopHalf - 10f * d, t + 16f * d, a)
                        val dayH = lerp(g.rowHeight + 24f * d, 104f * d, a)
                        drawRoundRect(Color(0x1A0F152A).copy(alpha = 0.10f * shown), Offset(x + 2f * d, dayTop + 4f * d), Size(w, dayH), radius)
                        drawRoundRect(c.bgSurface.copy(alpha = shown), Offset(x, dayTop), Size(w, dayH), radius)
                        drawRoundRect(c.border.copy(alpha = c.border.alpha * shown), Offset(x + d, dayTop + d), Size(w - 2 * d, dayH - 2 * d), radius, style = Stroke(2f * d))
                        // The now card, dark: the hero is white on it.
                        val nowTop = lerp(g.nowTopHalf, t + 132f * d, a)
                        val nowH = lerp(g.nowHeightHalf, g.nowHeightFull, a)
                        drawRoundRect(Color(0xFF1C120C).copy(alpha = shown), Offset(x, nowTop), Size(w, nowH), radius)
                    },
                )
            }
        },
        modifier = modifier,
    ) { measurables, constraints ->
        val w = constraints.maxWidth
        val h = constraints.maxHeight
        val d = density
        val dp = { v: Float -> v * d }
        val byId = measurables.associateBy { it.layoutId as Slot }
        fun measure(slot: Slot, maxWidth: Int = w, minWidth: Int = 0, maxHeight: Int = h): Placeable? =
            byId[slot]?.measure(Constraints(minWidth = minWidth, maxWidth = maxWidth, maxHeight = maxHeight))

        val side = dp(16f).toInt()
        val margin = dp(20f).toInt()
        val head = measure(Slot.Head)!!
        val icons = measure(Slot.Icons)
        val peek = measure(Slot.Peek, w - 2 * side)
        val vertical = measure(Slot.TimelineV, (w * 0.75f).toInt())
        val row = measure(Slot.TimelineRow, w, minWidth = w)
        val kicker = measure(Slot.Kicker, w - 2 * margin)!!
        val title = measure(Slot.Title, w - 2 * margin)!!
        val meta = measure(Slot.Meta, w - 2 * margin)
        val number = measure(Slot.Number)
        val unit = measure(Slot.Unit)
        val plates = measure(Slot.Plates)
        val caption = measure(Slot.Caption)
        val action = measure(Slot.Action, w - 2 * side, minWidth = w - 2 * side)!!
        val handle = measure(Slot.Handle, w, minWidth = w, maxHeight = dp(58f).toInt())!!
        val dayLabel = measure(Slot.DayLabel)

        val hero = fun(scalesAtClosed: Scales) = HeroGeo(
            d, kicker.height.toFloat(), title.height.toFloat(), (meta?.height ?: 0).toFloat(),
            (number?.height ?: 0).toFloat(), (number?.width ?: 0).toFloat(),
            (plates?.height ?: 0).toFloat(), (plates?.width ?: 0).toFloat(),
            (caption?.height ?: 0).toFloat(), (caption?.width ?: 0).toFloat(),
            meta != null, number != null, plates != null && caption != null, scalesAtClosed,
        )

        val tabBar = TabBarHeight.toPx() + navBottom
        val actionH = action.height.toFloat()
        val rowH = (row?.height ?: 0).toFloat()
        val rowTopHalf = head.height + dp(6f)
        val vertTop = head.height + dp(20f)
        val vertH = (vertical?.height ?: 0).toFloat()
        val tilesH = (peek?.height ?: 0).toFloat()
        val full = statusTop + dp(72f)

        // The closed stop, and whether everything that rides above it fits. Three tries, roomiest first: the vertical timeline with a full
        // hero, then only the row with a shorter peek, then the row with a compact hero.
        var mode = 0
        var closed = 0f
        var geo = hero(Closed)
        while (true) {
            val peekH = min(tilesH, dp(if (mode == 0) 110f else 76f))
            closed = h - tabBar - dp(22f) - peekH
            geo = hero(if (mode == 2) AtHalf else Closed)
            val heroTop = closed - dp(28f) - actionH - geo.height(if (mode == 2) AtHalf else Closed)
            val above = if (mode == 0) vertTop + vertH else rowTopHalf + rowH
            if (heroTop >= above + dp(8f) || mode == 2) {
                geo.topClosed = heroTop
                break
            }
            mode++
        }
        val rowOnly = mode != 0

        geo.topHalf = rowTopHalf + rowH + dp(12f)
        val heroHalfH = geo.height(AtHalf)
        val heroFullH = geo.height(Docked)
        var half = max(0.38f * h, geo.topHalf + heroHalfH + dp(14f))
        // The stops keep at least 96 dp between them, and both denominators of q1 and q2 stay at least 1.
        val lo = full + dp(96f)
        val hi = closed - dp(96f)
        half = if (lo <= hi) half.coerceIn(lo, hi) else (full + closed) / 2f
        val anchors = DrawerAnchors(full, half, closed, (w.toLong() shl 32) or h.toLong(), rowOnly)
        drawer.onAnchors(anchors)

        // The now card at half hugs the hero; docked it is the card under the day card. The action block goes under it.
        val nowTopHalf = geo.topHalf - dp(10f)
        val nowHeightHalf = heroHalfH + dp(18f)
        val nowHeightFull = heroFullH + dp(36f)
        val gapHalf = max(dp(12f), half + dp(22f) - (nowTopHalf + nowHeightHalf))
        val cardGeo = CardGeo(rowTopHalf, rowH, nowTopHalf, nowHeightHalf, nowHeightFull)
        if (cards != cardGeo) cards = cardGeo

        // The list takes what is left under the action block when the sheet is full, and keeps that size as the sheet moves.
        val actionBottomFull = full + dp(132f) + nowHeightFull + dp(12f) + actionH
        val listH = max(dp(120f), h - (actionBottomFull + dp(14f))).toInt()
        val list = byId[Slot.List]?.measure(Constraints.fixed(w - 2 * side, listH))
        val sheet = byId[Slot.Sheet]?.measure(Constraints.fixed(w, (h - full + 90f * d).toInt().coerceAtLeast(1)))
        val cardsLayer = byId[Slot.Cards]?.measure(Constraints.fixed(w, h))

        fun nowTop(t: Float, a: Float) = lerp(nowTopHalf, t + dp(132f), a)
        fun nowBottom(t: Float, a: Float) = nowTop(t, a) + lerp(nowHeightHalf, nowHeightFull, a)
        fun actionTop(t: Float, q1: Float, q2: Float, a: Float) =
            if (q2 > 0f) nowBottom(t, a) + lerp(gapHalf, dp(12f), a) else t + lerp(-(dp(14f) + actionH), dp(22f), q1)

        layout(w, h) {
            head.place(0, 0)
            sheet?.placeWithLayer(0, 0) { translationY = drawer.t }
            peek?.placeWithLayer(side, 0) {
                val q1 = drawer.q1
                translationY = drawer.t + dp(22f) + dp(34f) * q1
                alpha = 1f - smooth(q1 / 0.3f)
            }
            list?.placeWithLayer(side, 0) {
                val t = drawer.t
                val q1 = drawer.q1
                val q2 = drawer.q2
                translationY = actionTop(t, q1, q2, drawer.docked) + actionH + dp(14f)
                val shown = smooth((q1 - 0.35f) / 0.4f)
                alpha = shown
                // Invisible is not gone: while it is, clip it to nothing, which also takes it out of hit testing, so a touch on the peek
                // is a touch on the sheet and never on a button that cannot be seen. It stays in the semantics tree.
                clip = shown <= 0.02f
                shape = if (clip) NoTouch else RectangleShape
            }
            handle.placeWithLayer(0, 0) { translationY = drawer.t }
            cardsLayer?.place(0, 0)
            dayLabel?.placeWithLayer(0, 0) {
                translationX = dp(30f)
                translationY = lerp(rowTopHalf - dp(10f), drawer.t + dp(16f), drawer.docked) + dp(12f)       // the day card's own top
                alpha = smooth((drawer.q2 - 0.55f) / 0.35f)         // once the row has mostly docked into the card, not while it passes the label
            }
            action.placeWithLayer(side, 0) {
                translationY = actionTop(drawer.t, drawer.q1, drawer.q2, drawer.docked)
            }
            vertical?.placeWithLayer(margin, 0) {
                val q1 = drawer.q1
                translationY = vertTop - dp(24f) * q1
                alpha = if (rowOnly) 0f else 1f - smooth(q1 / 0.45f)
            }
            row?.placeWithLayer(0, 0) {
                val q1 = drawer.q1
                translationY = lerp(rowTopHalf + (if (rowOnly) 0f else (1f - q1) * dp(14f)), drawer.t + dp(54f), drawer.docked)
                alpha = if (rowOnly) 1f else smooth((q1 - 0.5f) / 0.5f)
            }
            // The hero. It is white, so it reads on the film and on the dark now card alike.
            fun heroPart(p: Placeable?, y: (t: Float, q1: Float, a: Float) -> Float, scale: (q1: Float, a: Float) -> Float, x: (a: Float, s: Float) -> Float) {
                p?.placeWithLayer(0, 0) {
                    val q1 = drawer.q1
                    val a = drawer.docked
                    val s = scale(q1, a)
                    transformOrigin = TransformOrigin(0f, 0f)
                    scaleX = s
                    scaleY = s
                    translationX = x(a, s)
                    translationY = y(drawer.t, q1, a)
                }
            }
            val left = { a: Float, _: Float -> lerp(dp(20f), dp(30f), a) }
            val one = { _: Float, _: Float -> 1f }
            val st = { q1: Float, a: Float -> geo.scale(q1, a) { it.title } }
            val sn = { q1: Float, a: Float -> geo.scale(q1, a) { it.number } }
            val sp = { q1: Float, a: Float -> geo.scale(q1, a) { it.plates } }
            val yNum = { t: Float, q1: Float, a: Float -> geo.yNumber(geo.top(t, q1, a), st(q1, a)) }
            val rightEdge = { a: Float -> w - lerp(dp(20f), dp(30f), a) }
            heroPart(kicker, { t, q1, a -> geo.top(t, q1, a) }, one, left)
            heroPart(title, { t, q1, a -> geo.yTitle(geo.top(t, q1, a)) }, st, left)
            heroPart(meta, { t, q1, a -> geo.yMeta(geo.top(t, q1, a), st(q1, a)) }, one, left)
            heroPart(number, yNum, sn, left)
            heroPart(unit, { t, q1, a -> geo.unitY(yNum(t, q1, a), sn(q1, a)) }, one) { a, _ ->
                lerp(dp(20f), dp(30f), a) + geo.numberW * sn(drawer.q1, a) + dp(8f)
            }
            heroPart(plates, { t, q1, a -> geo.platesY(yNum(t, q1, a), sn(q1, a), sp(q1, a)) }, sp) { a, s -> rightEdge(a) - geo.platesW * s }
            heroPart(caption, { t, q1, a -> geo.captionY(geo.platesY(yNum(t, q1, a), sn(q1, a), sp(q1, a)), sp(q1, a)) }, one) { a, _ -> rightEdge(a) - geo.captionW }
            icons?.place(w - icons.width - dp(8f).toInt(), statusTop + dp(2f).toInt())
        }
    }
}
