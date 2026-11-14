package com.qala.app.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.compose.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.compose.cartesian.data.columnSeries
import com.patrykandpatrick.vico.compose.cartesian.data.lineSeries
import com.patrykandpatrick.vico.compose.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.LineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.common.Fill
import com.patrykandpatrick.vico.compose.common.component.rememberLineComponent
import com.qala.app.run.paceText
import com.qala.data.core.RunPoint
import com.qala.data.model.WeightUnit
import com.qala.design.Card
import com.qala.design.GroupLabel
import com.qala.design.LinkButton
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaType

/*
 * The charts (DECISIONS S10, D13, D16): Vico for the ordinary ones, Canvas for the readiness ring and the run series. Every
 * numeric chart sits in a [ChartCard], which gives it one TalkBack sentence and a table view built from the same numbers (a
 * chart has no accessible parts, so the sentence stands for it), and every button is at least 44 dp.
 */

/** A chart in a card. [summary] is what TalkBack reads for the chart; [table] is the same numbers as rows, shown by the Table button. */
@Composable
fun ChartCard(title: String, summary: String, table: List<Pair<String, String>>, modifier: Modifier = Modifier, chart: @Composable () -> Unit) {
    var asTable by remember { mutableStateOf(false) }
    val c = Qala.colors
    Card(modifier, contentPadding = 16.dp) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            GroupLabel(title, Modifier.weight(1f))
            LinkButton(if (asTable) "Chart" else "Table", { asTable = !asTable }, Modifier.semantics { contentDescription = if (asTable) "Show $title as a chart" else "Show $title as a table" })
        }
        Box(Modifier.padding(top = 8.dp)) {
            if (asTable) {
                Column(Modifier.fillMaxWidth()) {
                    table.forEach { (label, value) ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            QalaText(label, style = QalaType.log, color = c.fgMuted)
                            QalaText(value, style = QalaType.log, color = c.fg)
                        }
                    }
                }
            } else {
                Box(Modifier.clearAndSetSemantics { contentDescription = summary }) { chart() }
            }
        }
    }
}

/** A line over [values], labelled along the bottom by [labels] (one per value). */
@Composable
fun LineChart(values: List<Double>, labels: List<String>, modifier: Modifier = Modifier) {
    val producer = remember { CartesianChartModelProducer() }
    LaunchedEffect(values) { producer.runTransaction { lineSeries { series(values) } } }
    val color = Qala.colors.accent
    CartesianChartHost(
        rememberCartesianChart(
            rememberLineCartesianLayer(LineCartesianLayer.LineProvider.series(LineCartesianLayer.Line(LineCartesianLayer.LineFill.single(Fill(color))))),
            startAxis = VerticalAxis.rememberStart(),
            bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = CartesianValueFormatter { _, x, _ -> labels.getOrElse(x.toInt()) { "" } }),
        ),
        producer,
        modifier.height(160.dp),
    )
}

/** Columns over [values], labelled by [labels]. */
@Composable
fun ColumnChart(values: List<Double>, labels: List<String>, modifier: Modifier = Modifier) {
    val producer = remember { CartesianChartModelProducer() }
    LaunchedEffect(values) { producer.runTransaction { columnSeries { series(values) } } }
    val color = Qala.colors.accent
    CartesianChartHost(
        rememberCartesianChart(
            rememberColumnCartesianLayer(ColumnCartesianLayer.ColumnProvider.series(rememberLineComponent(Fill(color), 14.dp))),
            startAxis = VerticalAxis.rememberStart(),
            bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = CartesianValueFormatter { _, x, _ -> labels.getOrElse(x.toInt()) { "" } }),
        ),
        producer,
        modifier.height(160.dp),
    )
}

/** Today's readiness as a ring, 0 to 100. It has a description and no table: it is one number. */
@Composable
fun ReadinessRing(score: Int?, modifier: Modifier = Modifier) {
    val c = Qala.colors
    val description = if (score == null) "Readiness is not known yet" else "Readiness $score of 100"
    Box(modifier.size(148.dp).clearAndSetSemantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(148.dp)) {
            val stroke = 14.dp.toPx()
            val inset = stroke / 2
            val arc = Size(size.width - stroke, size.height - stroke)
            drawArc(c.grid, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(stroke))
            if (score != null) drawArc(c.accent, -90f, 360f * score.coerceIn(0, 100) / 100f, false, Offset(inset, inset), arc, style = Stroke(stroke, cap = StrokeCap.Butt))
        }
        QalaText(score?.toString() ?: "—", style = QalaType.figure, color = c.fg)
    }
}

// ---- the run series ----

/** One row of the run series: what it plots and the value at each decimated column. */
private class Row(val label: String, val values: FloatArray, val format: (Float) -> String)

/**
 * Pace, heart rate and elevation along a run, drawn on a Canvas (D13: a library would need every point, and a 2 h run is 7,200).
 * Each pixel column keeps the minimum and maximum of the points it covers, so a spike survives the thinning; touching or dragging
 * puts one crosshair across all three rows with the values under it. Pace is drawn faster-is-higher.
 */
@Composable
fun RunSeries(points: List<RunPoint>, unit: WeightUnit, modifier: Modifier = Modifier) {
    val c = Qala.colors
    var cursor by remember { mutableStateOf<Float?>(null) }
    val unitM = if (unit == WeightUnit.Kg) 1000.0 else 1609.344
    val rows = remember(points, unit) {
        listOfNotNull(
            Row("Pace", FloatArray(points.size) { i -> points[i].speedMps.takeIf { it > 0.3 }?.let { (unitM / it).toFloat() } ?: Float.NaN }) { paceText(it / unitM, unit) },
            points.takeIf { p -> p.any { it.hr != null } }?.let { p -> Row("HR", FloatArray(p.size) { i -> p[i].hr?.toFloat() ?: Float.NaN }) { "${it.toInt()}" } },
            points.takeIf { p -> p.any { it.ele != null } }?.let { p -> Row("Elevation", FloatArray(p.size) { i -> p[i].ele?.toFloat() ?: Float.NaN }) { "${it.toInt()} m" } },
        )
    }
    if (points.size < 2 || rows.isEmpty()) return
    Column(modifier.fillMaxWidth()) {
        val at = cursor?.let { (it * (points.size - 1)).toInt().coerceIn(0, points.size - 1) }
        QalaText(
            if (at == null) "Touch the chart to read it" else rows.joinToString("  ·  ") { r -> r.values[at].let { v -> "${r.label} ${if (v.isNaN()) "—" else r.format(v)}" } },
            Modifier.padding(bottom = 6.dp),
            QalaType.log.copy(fontSize = 12.sp),
            c.fgMuted,
        )
        Canvas(
            Modifier
                .fillMaxWidth()
                .height((rows.size * 64).dp)
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent()
                            val p = e.changes.firstOrNull()
                            cursor = if (p != null && p.pressed) (p.position.x / size.width).coerceIn(0f, 1f) else cursor
                        }
                    }
                },
        ) {
            val w = size.width.toInt().coerceAtLeast(1)
            val rowH = size.height / rows.size
            rows.forEachIndexed { r, row ->
                val top = r * rowH + 4.dp.toPx()
                val h = rowH - 8.dp.toPx()
                // Min and max per pixel column.
                val lo = FloatArray(w) { Float.POSITIVE_INFINITY }
                val hi = FloatArray(w) { Float.NEGATIVE_INFINITY }
                for (i in row.values.indices) {
                    val v = row.values[i]
                    if (v.isNaN()) continue
                    val x = (i.toLong() * (w - 1) / (row.values.size - 1)).toInt()
                    if (v < lo[x]) lo[x] = v
                    if (v > hi[x]) hi[x] = v
                }
                var min = Float.POSITIVE_INFINITY
                var max = Float.NEGATIVE_INFINITY
                for (x in 0 until w) if (lo[x] <= hi[x]) { min = minOf(min, lo[x]); max = maxOf(max, hi[x]) }
                if (min > max) return@forEachIndexed
                val span = (max - min).coerceAtLeast(1e-3f)
                val faster = row.label == "Pace"                         // less time per mile is higher
                fun y(v: Float): Float = top + h * (if (faster) (v - min) / span else 1f - (v - min) / span)
                val path = Path()
                var started = false
                for (x in 0 until w) {
                    if (lo[x] > hi[x]) { started = false; continue }
                    if (!started) { path.moveTo(x.toFloat(), y(lo[x])); started = true } else path.lineTo(x.toFloat(), y(lo[x]))
                    if (hi[x] != lo[x]) path.lineTo(x.toFloat(), y(hi[x]))
                }
                drawPath(path, c.accent, style = Stroke(1.5.dp.toPx()))
            }
            cursor?.let { drawLine(c.fg, Offset(it * size.width, 0f), Offset(it * size.width, size.height), 1.dp.toPx()) }
        }
    }
}
