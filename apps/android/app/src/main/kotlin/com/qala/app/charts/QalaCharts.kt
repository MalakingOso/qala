package com.qala.app.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.qala.app.run.paceText
import com.qala.app.run.unitM
import com.qala.data.core.RunPoint
import com.qala.data.model.WeightUnit
import com.qala.design.GlassCard
import com.qala.design.QalaShadow
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.Wash
import com.qala.design.beamerSurface
import com.qala.design.glassInk
import com.qala.design.glassMuted
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * The charts (DECISIONS S10, S51), all on Canvas in board 3's language: a white line over a teal fade, one baseline, no gridlines,
 * ember for now, and always a night ground behind them. Every colour here is fixed (white, teal and ember at alphas), so a chart
 * looks the same in Light and Dark and never reads the theme. Each is laid out in board units, which are dp, and its text is
 * measured, so a label can keep clear of a line, a dot and the edge. Every numeric chart sits in a [ChartCard], which gives it one
 * TalkBack sentence and a table view built from the same numbers (a chart has no accessible parts, so the sentence stands for it).
 */

/** Entries the text measurer keeps; the default 8 is fewer than a chart draws, so every frame would measure again. */
private const val MeasureCache = 64

private val Teal = Wash.Teal
private val Ember = Wash.ChartEmber

private fun white(alpha: Float = 1f) = Color.White.copy(alpha = alpha)

/** Chart text in the mono face, white at [alpha]: [Wash.ChartLabel] resized. */
private fun mono(size: Float, alpha: Float = 0.7f, weight: FontWeight = FontWeight.Normal) =
    Wash.ChartLabel.copy(fontSize = size.sp, lineHeight = (size * 1.2f).sp, fontWeight = weight, color = white(alpha))

/** Chart text in the UI face (a name under a point or a bar), white at [alpha]. */
private fun sans(size: Float, alpha: Float = 1f, weight: FontWeight = FontWeight.SemiBold) =
    QalaType.tabLabel.copy(fontSize = size.sp, lineHeight = (size * 1.2f).sp, fontWeight = weight, color = white(alpha))

/** [QalaText] in the colour the style carries, so the theme's ink never leaks into a chart. */
@Composable
private fun ChartText(text: String, style: TextStyle, modifier: Modifier = Modifier) =
    QalaText(text, modifier, style, style.color, maxLines = 1)

/** Draws [s] with its baseline at ([x], [y]) in board units, outside any scale so the type stays crisp, and returns its width in them. [at] is where x falls along the text: 0 start, 0.5 middle, 1 end. */
private fun DrawScope.label(m: TextMeasurer, s: String, x: Float, y: Float, style: TextStyle, at: Float = 0.5f): Float {
    val r = m.measure(s, style, softWrap = false, maxLines = 1)
    val w = r.size.width / density
    drawText(r, topLeft = Offset((x - at * w) * density, y * density - r.firstBaseline))
    return w
}

private fun DrawScope.textWidth(m: TextMeasurer, s: String, style: TextStyle) = m.measure(s, style, softWrap = false, maxLines = 1).size.width / density

/** Where a label centred on [x] and [width] wide sits inside 0 to [w] with 2 to spare: its anchor x, and how far along it that is. */
private fun clampLabel(x: Float, width: Float, w: Float): Pair<Float, Float> = when {
    x - width / 2 < 2f -> 2f to 0f
    x + width / 2 > w - 2f -> (w - 2f) to 1f
    else -> x to 0.5f
}

/** A number to one decimal, without a trailing ".0". */
private fun num(v: Double): String = (Math.round(v * 10) / 10.0).let { if (it == floor(it)) it.toLong().toString() else it.toString() }

// ---- the card ----

/** What a [ChartCard] sits on: its own night card, a glass card (the chart in the night panel), or straight on the wash. */
enum class ChartSurface { Night, Glass, Wash }

private val NightShadow = QalaShadow(dx = 2.dp, dy = 4.dp, color = Color.Black.copy(alpha = 0.3f), ringWidth = 0.dp, ringColor = Color.Transparent)
private val MetaStyle = QalaType.body.copy(fontSize = 12.sp, lineHeight = 16.sp)

/**
 * A chart on a [surface]. [summary] is what TalkBack reads for the chart; [table] is the same numbers as rows, shown by the Table
 * button. [meta] is a quiet line under the title (the unit, the span). Night is the chart's own dark card with an upper-case
 * title; Glass is a glass card with a sentence-case title and the chart in its flush night panel; Wash draws the chart straight on
 * the wash under a white kicker. The table reads white on night and on the wash, and in ink on glass.
 */
@Composable
fun ChartCard(
    title: String,
    summary: String,
    table: List<Pair<String, String>>,
    modifier: Modifier = Modifier,
    surface: ChartSurface = ChartSurface.Night,
    meta: String? = null,
    chart: @Composable () -> Unit,
) {
    var asTable by remember { mutableStateOf(false) }
    val glass = surface == ChartSurface.Glass
    val ink = if (glass) glassInk() else Color.White
    val muted = if (glass) glassMuted() else white(0.72f)
    val chartBox: @Composable () -> Unit = { Box(Modifier.clearAndSetSemantics { contentDescription = summary }) { chart() } }
    if (glass) {
        GlassCard(
            modifier,
            header = {
                Column(Modifier.weight(1f)) {
                    QalaText(title, style = QalaType.cardTitle, color = ink)
                    if (meta != null) QalaText(meta, style = MetaStyle, color = muted)
                }
                TableToggle(title, asTable, ink) { asTable = !asTable }
            },
            body = if (asTable) { { TableRows(table, muted, ink) } } else null,
            panel = if (asTable) null else { { chartBox() } },
        )
    } else {
        val night = surface == ChartSurface.Night
        val card = if (night) Modifier.beamerSurface(Wash.Night, white(0.08f), 10.dp, NightShadow, 1.dp).padding(start = 13.dp, top = 15.dp, end = 13.dp, bottom = 11.dp) else Modifier
        Column(modifier.fillMaxWidth().then(card)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    QalaText(title.uppercase(), style = if (night) QalaType.groupLabel else Wash.Kicker, color = if (night) white(0.88f) else Wash.Text2)
                    if (meta != null) QalaText(meta, style = MetaStyle, color = muted)
                }
                TableToggle(title, asTable, Color.White) { asTable = !asTable }
            }
            Box(Modifier.padding(top = 8.dp)) { if (asTable) TableRows(table, muted, ink) else chartBox() }
        }
    }
}

/** The Table / Chart switch: underlined text in [color], at least 44 dp square to touch. */
@Composable
private fun TableToggle(title: String, asTable: Boolean, color: Color, onClick: () -> Unit) {
    Box(
        Modifier
            .widthIn(min = 44.dp)
            .heightIn(min = 44.dp)
            .semantics { contentDescription = if (asTable) "Show $title as a chart" else "Show $title as a table" }
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        QalaText(
            if (asTable) "Chart" else "Table",
            style = QalaType.button.copy(fontSize = 13.sp, lineHeight = 18.sp, textDecoration = TextDecoration.Underline),
            color = color,
            maxLines = 1,
        )
    }
}

@Composable
private fun TableRows(rows: List<Pair<String, String>>, label: Color, value: Color) {
    Column(Modifier.fillMaxWidth()) {
        rows.forEach { (l, v) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                QalaText(l, style = QalaType.log, color = label)
                QalaText(v, style = QalaType.log, color = value)
            }
        }
    }
}

// ---- the line ----

/** A dashed line across a [LineChart] at [value], named by [label] ("start 282", "avg 76"). */
class ChartReference(val value: Double, val label: String)

/**
 * The slopes of the monotone cubic through points at [x] and [y] (Fritsch and Carlson): it follows the data and never overshoots, so
 * a flat stretch stays flat and a peak is a point of the data.
 */
internal fun tangents(x: FloatArray, y: FloatArray): FloatArray {
    val n = x.size
    val m = FloatArray(n)
    if (n < 2) return m
    val d = FloatArray(n - 1) { (y[it + 1] - y[it]) / (x[it + 1] - x[it]) }
    m[0] = d[0]
    m[n - 1] = d[n - 2]
    for (i in 1 until n - 1) m[i] = if (d[i - 1] * d[i] <= 0f) 0f else (d[i - 1] + d[i]) / 2f
    for (i in 0 until n - 1) {
        if (d[i] == 0f) { m[i] = 0f; m[i + 1] = 0f; continue }
        val a = m[i] / d[i]
        val b = m[i + 1] / d[i]
        val s = a * a + b * b
        if (s > 9f) { val t = 3f / sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i] }
    }
    return m
}

/** The value range a line is drawn over: room under the data for the baseline and a little over it, and a range even when every value is the same. */
internal fun yRange(values: List<Double>, reference: Double?): Pair<Double, Double> {
    val all = if (reference == null) values else values + reference
    val lo = all.min()
    val hi = all.max()
    val span = (hi - lo).takeIf { it > 0.0 } ?: max(1.0, abs(hi) * 0.05)
    return (lo - span * 0.5) to (hi + span * 0.1)
}

/** Which points of [n] get a name under them: all of them up to seven, else the first, the last and two between. */
internal fun labelIndices(n: Int): List<Int> =
    if (n <= 7) List(n) { it } else listOf(0, ((n - 1) / 3.0).roundToInt(), (2.0 * (n - 1) / 3).roundToInt(), n - 1)

private class Seg(val a: Offset, val c1: Offset, val c2: Offset, val b: Offset)

private fun segments(p: List<Offset>): List<Seg> {
    val m = tangents(FloatArray(p.size) { p[it].x }, FloatArray(p.size) { p[it].y })
    return List(p.size - 1) { i ->
        val dx = (p[i + 1].x - p[i].x) / 3f
        Seg(p[i], Offset(p[i].x + dx, p[i].y + m[i] * dx), Offset(p[i + 1].x - dx, p[i + 1].y - m[i + 1] * dx), p[i + 1])
    }
}

/** The curve through [s], closed down to [floor] and back when there is one (the fade under the line). */
private fun curvePath(s: List<Seg>, floor: Float? = null) = Path().apply {
    moveTo(s[0].a.x, s[0].a.y)
    s.forEach { cubicTo(it.c1.x, it.c1.y, it.c2.x, it.c2.y, it.b.x, it.b.y) }
    if (floor != null) { lineTo(s.last().b.x, floor); lineTo(s[0].a.x, floor); close() }
}

/** Points along the curve, for keeping a label off it. */
private fun samples(s: List<Seg>) = s.flatMap { g ->
    (0..12).map { k ->
        val t = k / 12f
        val u = 1f - t
        g.a * (u * u * u) + g.c1 * (3 * u * u * t) + g.c2 * (3 * u * t * t) + g.b * (t * t * t)
    }
}

private fun hits(box: Rect, pts: List<Offset>, pad: Float) = pts.any { it.x >= box.left - pad && it.x <= box.right + pad && it.y >= box.top - pad && it.y <= box.bottom + pad }

/**
 * A line over [values], named along the bottom by [labels] (one per value). The latest value is the ember dot with [nowLabel]
 * above it ("now 294" by default); a [reference] draws a dashed line with its label, which rides along it to the first spot clear
 * of the curve, the dots and the "now" label.
 */
@Composable
fun LineChart(values: List<Double>, labels: List<String>, modifier: Modifier = Modifier, reference: ChartReference? = null, nowLabel: String? = null) {
    val measurer = rememberTextMeasurer(MeasureCache)
    Canvas(modifier.fillMaxWidth().height(170.dp)) {
        val n = values.size
        val w = size.width / density
        val h = size.height / density
        val x0 = 18f
        val x1 = w - 30f
        val yt = 36f
        val yb = h - 36f
        if (n == 0 || x1 <= x0 || yb <= yt) return@Canvas
        val (lo, hi) = yRange(values, reference?.value)
        fun y(v: Double) = (yb - (v - lo) / (hi - lo) * (yb - yt)).toFloat()
        val pts = List(n) { Offset(if (n == 1) (x0 + x1) / 2 else x0 + (x1 - x0) * it / (n - 1), y(values[it])) }
        val last = pts.last()
        val segs = if (n > 1) segments(pts) else emptyList()
        val ext = 12f
        val left = max(2f, x0 - ext)
        val right = min(w - 2f, x1 + ext)

        // The "now" label first, so the reference label can keep clear of it.
        val nowText = nowLabel ?: "now ${num(values.last())}"
        val nowStyle = mono(10.5f, 1f, FontWeight.Medium)
        val nowW = textWidth(measurer, nowText, nowStyle)
        val (nowX, nowAt) = clampLabel(last.x, nowW, w)
        val nowBox = Rect(nowX - nowAt * nowW, last.y - 30f, nowX - nowAt * nowW + nowW, last.y - 16f)

        // The reference label rides the dashed line from its right end, above it first and then below, to the first spot clear of
        // the curve, the dots and the "now" label. The line crosses the data in places, so the right end is not always free.
        val ry = reference?.let { y(it.value) } ?: 0f
        val refStyle = mono(9.5f, 0.8f)
        var refAt = Offset(x1 + ext - 2f, ry - 6f)
        if (reference != null) {
            val rw = textWidth(measurer, reference.label, refStyle)
            val curve = if (segs.isEmpty()) pts else samples(segs)
            fun free(xr: Float, below: Boolean): Offset? {
                val base = if (below) ry + 14f else ry - 6f
                val box = Rect(xr - rw, base - 10f, xr, base + 2f)
                return if (!hits(box, curve, 4f) && !hits(box, pts, 7f) && !box.overlaps(nowBox.inflate(4f))) Offset(xr, base) else null
            }
            var xr = x1 + ext - 2f
            var pick: Offset? = null
            while (pick == null && xr - rw >= left) { pick = free(xr, false) ?: free(xr, true); xr -= 6f }
            refAt = pick ?: refAt
        }

        scale(density, Offset.Zero) {
            drawLine(white(0.28f), Offset(left, yb), Offset(right, yb), strokeWidth = 1f)
            if (reference != null) drawLine(white(0.55f), Offset(left, ry), Offset(right, ry), strokeWidth = 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 4f)))
            if (n > 1) {
                drawPath(curvePath(segs, yb), Brush.verticalGradient(listOf(Teal.copy(alpha = 0.4f), Teal.copy(alpha = 0f)), startY = pts.minOf { it.y }, endY = yb))
                drawPath(curvePath(segs), Color.White, style = Stroke(2.6f, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            drawLine(white(0.5f), Offset(last.x, last.y - 15f), Offset(last.x, yb), strokeWidth = 1f)
            if (n <= 14) for (i in 0 until n - 1) drawCircle(Teal, 5f, pts[i])
            drawCircle(Ember, 8f, last)
            drawCircle(Color.White, 8f, last, style = Stroke(2f))
        }

        if (reference != null) label(measurer, reference.label, refAt.x, refAt.y, refStyle, 1f)
        label(measurer, nowText, nowX, last.y - 19f, nowStyle, nowAt)
        labelIndices(n).forEach { i ->
            val name = labels.getOrNull(i)?.takeIf { it.isNotEmpty() } ?: return@forEach
            val style = sans(10f, 1f, if (i == n - 1) FontWeight.Bold else FontWeight.SemiBold)
            val (lx, at) = clampLabel(pts[i].x, textWidth(measurer, name, style), w)
            label(measurer, name, lx, yb + 16f, style, at)
        }
    }
}

// ---- the bars ----

/**
 * Bars over [values] from one baseline, named by [labels]: rounded at the top, the value on the cap in mono, every bar named under
 * it. [highlightLast] makes the latest bar ember (this week among the weeks) and the rest teal.
 */
@Composable
fun ColumnChart(values: List<Double>, labels: List<String>, modifier: Modifier = Modifier, highlightLast: Boolean = false) {
    val measurer = rememberTextMeasurer(MeasureCache)
    Canvas(modifier.fillMaxWidth().height(140.dp)) {
        val n = values.size
        val w = size.width / density
        val h = size.height / density
        val yb = h - 26f
        val yt = 24f
        if (n == 0 || yb <= yt) return@Canvas
        val slot = (w - 28f) / n
        val bw = (slot - 10f).coerceIn(2f, 24f)
        val top = values.max().takeIf { it > 0.0 } ?: 1.0
        fun cx(i: Int) = 14f + slot * (i + 0.5f)
        fun bh(i: Int) = if (values[i] > 0.0) max(4f, (values[i] / top * (yb - yt)).toFloat()) else 0f
        fun current(i: Int) = highlightLast && i == n - 1

        scale(density, Offset.Zero) {
            drawLine(white(0.28f), Offset(6f, yb), Offset(w - 6f, yb), strokeWidth = 1f)
            for (i in 0 until n) {
                val height = bh(i)
                if (height <= 0f) continue
                val r = CornerRadius(min(4f, height / 2))
                val bar = Path().apply { addRoundRect(RoundRect(cx(i) - bw / 2, yb - height, cx(i) + bw / 2, yb, topLeftCornerRadius = r, topRightCornerRadius = r)) }
                drawPath(bar, if (current(i)) Ember else Teal)
            }
        }

        for (i in 0 until n) {
            label(measurer, num(values[i]), cx(i), yb - bh(i) - 6f, if (current(i)) mono(10f, 1f, FontWeight.Medium) else mono(10f, 0.88f))
            val name = labels.getOrNull(i) ?: continue
            label(measurer, name, cx(i), yb + 15f, sans(if (n > 6) 9.5f else 10f, if (current(i)) 1f else 0.85f, if (current(i)) FontWeight.Bold else FontWeight.SemiBold))
        }
    }
}

// ---- the rings ----

/** One slice of a [Donut]: its [value] sets the arc, [detail] is what the legend says beside its [label]. */
data class DonutSlice(val label: String, val value: Double, val color: Color, val detail: String)

private const val RingGap = 4f

/**
 * A segmented ring cut into [slices] by their values, from 12 o'clock, with [centre] (the total) and [caption] in the middle and a
 * legend beside it. The arcs have butt ends and a 4 degree gap between them. A slice of nothing is left out of the ring and the
 * legend. The slices carry their own colours, so a missing one never shifts the others'.
 */
@Composable
fun Donut(slices: List<DonutSlice>, centre: String, caption: String, modifier: Modifier = Modifier) {
    val shown = slices.filter { it.value > 0 }
    val total = shown.sumOf { it.value }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(128.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 16.dp.toPx()
                val topLeft = Offset(stroke / 2, stroke / 2)
                val arc = Size(size.width - stroke, size.height - stroke)
                if (total <= 0.0) {
                    drawArc(white(0.22f), 0f, 360f, false, topLeft, arc, style = Stroke(stroke))
                } else {
                    var start = -90f
                    shown.forEach { slice ->
                        val sweep = (slice.value / total * 360.0).toFloat()
                        if (sweep > RingGap) drawArc(slice.color, start + RingGap / 2, sweep - RingGap, false, topLeft, arc, style = Stroke(stroke))
                        start += sweep
                    }
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val fs = if (centre.length > 5) 22.sp else 26.sp
                ChartText(centre, QalaType.figure.copy(fontSize = fs, lineHeight = fs * 1.1f, color = Color.White))
                ChartText(caption, mono(9f))
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            shown.forEach { slice ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.padding(top = 3.dp).size(10.dp).background(slice.color, CircleShape))
                    Column {
                        ChartText(slice.label, sans(11f))
                        ChartText(slice.detail, mono(10f))
                    }
                }
            }
        }
    }
}

/**
 * Today's readiness as a ring, 0 to 100: a white track, a teal arc from 12 o'clock, the score in the middle with "of 100" beneath.
 * With an [average] (the 28-day one) a white tick crosses the track at that percent, named beside it, and the chart is wider to
 * make room for the name. It has a description and no table: it is one number.
 */
@Composable
fun ReadinessRing(score: Int?, modifier: Modifier = Modifier, average: Int? = null) {
    val measurer = rememberTextMeasurer(MeasureCache)
    val description = when {
        score == null -> "Readiness is not known yet"
        average == null -> "Readiness $score of 100"
        else -> "Readiness $score of 100, with a tick at the 28-day average $average"
    }
    Box(modifier.size(if (average != null) 240.dp else 148.dp, 150.dp).clearAndSetSemantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val cx = size.width / density / 2
            val cy = size.height / density / 2
            val r = 58f
            val sw = 12f
            val tick = Math.toRadians(-90.0 + (average ?: 0).coerceIn(0, 100) * 3.6)
            val ca = cos(tick).toFloat()
            val sa = sin(tick).toFloat()
            scale(density, Offset.Zero) {
                val topLeft = Offset(cx - r, cy - r)
                val arc = Size(2 * r, 2 * r)
                drawArc(white(0.22f), 0f, 360f, false, topLeft, arc, style = Stroke(sw))
                if (score != null) drawArc(Teal, -90f, 360f * score.coerceIn(0, 100) / 100f, false, topLeft, arc, style = Stroke(sw))
                if (average != null) {
                    val a = r - sw / 2 - 3
                    val b = r + sw / 2 + 3
                    drawLine(Color.White, Offset(cx + ca * a, cy + sa * a), Offset(cx + ca * b, cy + sa * b), strokeWidth = 3f)
                }
            }
            if (average != null) {
                val lr = r + sw / 2 + 10
                val side = abs(ca) < 0.3f
                label(measurer, "avg $average", cx + ca * lr, cy + sa * lr + if (side) (if (sa < 0) -2f else 10f) else 3f, mono(9.5f, 0.85f), if (side) 0.5f else if (ca > 0) 0f else 1f)
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            ChartText(score?.toString() ?: "—", QalaType.figure.copy(fontSize = 46.sp, lineHeight = 50.sp, color = Color.White))
            if (score != null) ChartText("of 100", mono(10f))
        }
    }
}

// ---- the run series ----

/** One panel of the run series: what it plots and its value at each point (NaN where it has none). */
private class Series(val name: String, val values: FloatArray, val invert: Boolean, val read: (Float) -> String)

private class Panel(val series: Series, val yt: Float, val yb: Float, val line: Path, val fill: Path, val y: (Float) -> Float)

private const val RunPad = 14f
private const val PanelH = 50f
private const val PanelStep = 76f
private const val RunTop = 26f

/**
 * Pace, heart rate and elevation along a run as three stacked panels, each on its own scale (D13: a library would need every
 * point, and a 2 h run is 7,200). Each dp column keeps the minimum and maximum of the points it covers, so a spike survives the
 * thinning and a column with none is skipped. A crosshair starts at the middle of the run; touching or dragging moves it, and the
 * values under it are in each panel's header. Pace is drawn faster-is-higher. A panel with no data is left out.
 */
@Composable
fun RunSeries(points: List<RunPoint>, unit: WeightUnit, modifier: Modifier = Modifier) {
    val km = unit == WeightUnit.Kg
    val unitM = unitM(unit)
    val word = if (km) "km" else "mi"
    val series = remember(points, unit) {
        listOf(
            Series("Pace", FloatArray(points.size) { i -> points[i].speedMps.takeIf { it > 0.3 }?.let { (unitM / it).toFloat() } ?: Float.NaN }, true) { "${paceText(it / unitM, unit)} /$word" },
            Series("Heart rate", FloatArray(points.size) { points[it].hr?.toFloat() ?: Float.NaN }, false) { "${it.toInt()} bpm" },
            Series("Elevation", FloatArray(points.size) { points[it].ele?.toFloat() ?: Float.NaN }, false) { "${it.toInt()} m" },
        ).filter { s -> s.values.any { !it.isNaN() } }
    }
    // Each whole unit run, at the point where the run crosses it; a long run thins to about five.
    val ticks = remember(points, unit) {
        val total = (points.lastOrNull()?.distM ?: 0.0) / unitM
        val step = ceil(total / 5).toInt().coerceAtLeast(1)
        var i = 0
        (0..total.toInt() step step).map { mark ->
            while (i < points.size - 1 && points[i].distM < mark * unitM) i++
            (if (mark == 0) "0" else "$mark $word") to i / (points.size - 1f).coerceAtLeast(1f)
        }
    }
    var cursor by remember { mutableFloatStateOf(0.5f) }
    val measurer = rememberTextMeasurer(MeasureCache)
    if (points.size < 2 || series.isEmpty()) return
    val height = (RunTop + (series.size - 1) * PanelStep + 16f + PanelH + 26f).dp
    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val p = awaitPointerEvent().changes.firstOrNull()
                        if (p != null && p.pressed) cursor = ((p.position.x / density - RunPad) / (size.width / density - 2 * RunPad)).coerceIn(0f, 1f)
                    }
                }
            },
    ) {
        val n = points.size
        val w = size.width / density
        val x0 = RunPad
        val x1 = w - RunPad
        if (x1 <= x0) return@Canvas
        val cols = (x1 - x0).toInt().coerceAtLeast(2)
        val at = (cursor * (n - 1)).roundToInt().coerceIn(0, n - 1)
        val cx = x0 + (x1 - x0) * at / (n - 1)
        val lastBase = RunTop + (series.size - 1) * PanelStep + 16f + PanelH

        val panels = series.mapIndexed { k, s ->
            val yt = RunTop + k * PanelStep + 16f
            val yb = yt + PanelH
            val lo = FloatArray(cols) { Float.POSITIVE_INFINITY }
            val hi = FloatArray(cols) { Float.NEGATIVE_INFINITY }
            s.values.forEachIndexed { i, v ->
                if (v.isNaN()) return@forEachIndexed
                val c = (i.toLong() * (cols - 1) / (n - 1)).toInt()
                lo[c] = min(lo[c], v)
                hi[c] = max(hi[c], v)
            }
            val mn = lo.min()
            val mx = hi.max()
            val span = max(mx - mn, 1e-3f)
            val y = { v: Float -> ((v - mn) / span).let { f -> if (s.invert) yt + 4f + f * (PanelH - 8f) else yb - 4f - f * (PanelH - 8f) } }
            // A column with no point is skipped, so a run shorter than the screen is still one connected line; a column with several
            // goes down to its minimum and up to its maximum.
            val line = Path()
            var firstX = 0f
            var lastX = 0f
            var started = false
            for (c in 0 until cols) {
                if (lo[c] > hi[c]) continue
                val x = x0 + (x1 - x0) * c / (cols - 1)
                if (!started) { line.moveTo(x, y(lo[c])); firstX = x; started = true } else line.lineTo(x, y(lo[c]))
                if (hi[c] != lo[c]) line.lineTo(x, y(hi[c]))
                lastX = x
            }
            val fill = Path().apply { addPath(line); lineTo(lastX, yb); lineTo(firstX, yb); close() }
            Panel(s, yt, yb, line, fill, y)
        }

        scale(density, Offset.Zero) {
            panels.forEach { p ->
                drawLine(white(0.28f), Offset(x0 - 8f, p.yb), Offset(x1 + 8f, p.yb), strokeWidth = 1f)
                drawPath(p.fill, Brush.verticalGradient(listOf(Teal.copy(alpha = 0.3f), Teal.copy(alpha = 0f)), startY = p.yt, endY = p.yb))
                drawPath(p.line, Color.White, style = Stroke(2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            drawLine(white(0.5f), Offset(cx, RunTop - 4f), Offset(cx, lastBase), strokeWidth = 1f)
            panels.forEach { p ->
                val v = p.series.values[at]
                if (v.isNaN()) return@forEach
                drawCircle(Ember, 5.5f, Offset(cx, p.y(v)))
                drawCircle(Color.White, 5.5f, Offset(cx, p.y(v)), style = Stroke(2f))
            }
        }

        panels.forEach { p ->
            label(measurer, p.series.name.uppercase(), x0, p.yt - 6f, sans(9.5f, 0.85f).copy(letterSpacing = 0.09.em), 0f)
            val v = p.series.values[at]
            label(measurer, if (v.isNaN()) "—" else p.series.read(v), x1, p.yt - 6f, mono(10.5f, 1f, FontWeight.Medium), 1f)
        }
        val here = "${num(points[at].distM / unitM)} $word"
        clampLabel(cx, textWidth(measurer, here, mono(10f, 1f, FontWeight.Medium)), w).let { (x, a) -> label(measurer, here, x, RunTop - 10f, mono(10f, 1f, FontWeight.Medium), a) }
        ticks.forEach { (text, frac) ->
            clampLabel(x0 + (x1 - x0) * frac, textWidth(measurer, text, mono(9f)), w).let { (x, a) -> label(measurer, text, x, lastBase + 16f, mono(9f), a) }
        }
    }
}
