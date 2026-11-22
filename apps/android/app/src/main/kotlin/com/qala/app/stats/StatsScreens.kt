package com.qala.app.stats

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.charts.ChartCard
import com.qala.app.charts.ChartSurface
import com.qala.app.charts.ColumnChart
import com.qala.app.charts.Donut
import com.qala.app.charts.DonutSlice
import com.qala.app.charts.LineChart
import com.qala.app.charts.ReadinessRing
import com.qala.app.run.elapsedText
import com.qala.app.today.muscleName
import com.qala.app.today.trimNumber
import com.qala.app.today.unitName
import com.qala.app.workout.SessionSummary
import com.qala.data.core.DatedValue
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.WeightUnit
import com.qala.data.stats.ProgressStats
import com.qala.data.stats.Stats
import com.qala.design.Card
import com.qala.design.GroupLabel
import com.qala.design.PageHead
import com.qala.design.PinnedBar
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.ScreenHead
import com.qala.design.Wash
import com.qala.design.WashCard
import com.qala.design.WashPage
import com.qala.design.WashScrim
import java.time.LocalDate
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.withContext

/*
 * The stats screens (DESIGN 7.x, android-native 8): Progress (strength per main lift, this week's sets by muscle, the weeks of
 * running), Body (the readiness ring and line, the weight trend) and Session complete (the time split, sets by muscle, e1RM). Each
 * chart is a ChartCard: one TalkBack sentence and a table view. Left out on Android (DECISIONS S42): reps against intensity, the
 * Beamer 85% chart, the recovery body map and fatigue by muscle.
 */

private const val MileM = 1609.344

/** "Nov 9" from a local date. */
private fun dayLabel(date: String): String =
    LocalDate.parse(date.take(10)).let { "${it.month.getDisplayName(java.time.format.TextStyle.SHORT, Locale.US)} ${it.dayOfMonth}" }

private fun unitMeters(unit: WeightUnit) = if (unit == WeightUnit.Kg) 1000.0 else MileM

@Composable
private fun Empty(text: String) {
    Card(contentPadding = 16.dp) { QalaText(text, style = QalaType.hint, color = Qala.colors.fgMuted) }
}

// ---- Progress ----

@Composable
fun ProgressScreen(snapshot: EngineSnapshot) {
    val container = LocalAppContainer.current
    val stats by produceState<ProgressStats?>(null, snapshot) {
        value = withContext(container.env.work) { Stats.progress(snapshot, container.env.clock.nowMs(), container.env.clock.zone) }
    }
    val unit = snapshot.unit
    val lift = unitName(unit)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PageHead("Progress", eyebrow = "Strength and volume")
        val s = stats ?: run { Empty("Reading your history."); return@Column }
        if (s.lifts.isEmpty() && s.setsByMuscle.isEmpty() && s.weeklyRunM.all { it.second == 0.0 }) {
            Empty("Nothing to chart yet. Lift or run and it shows up here.")
            return@Column
        }
        s.lifts.forEach { t ->
            val values = t.points.map { it.value }
            ChartCard(
                title = "${t.name} e1RM",
                summary = "${t.name} estimated one-rep max over ${values.size} sessions, from ${trimNumber(values.first())} to ${trimNumber(values.last())} $lift.",
                table = t.points.map { dayLabel(it.date) to "${trimNumber(it.value)} $lift" },
            ) { LineChart(values, t.points.map { dayLabel(it.date) }) }
        }
        if (s.setsByMuscle.isNotEmpty()) {
            val top = s.setsByMuscle.take(8)
            ChartCard(
                title = "Sets by muscle, this week",
                summary = "Hard sets this week: " + top.joinToString(", ") { "${muscleName(it.first)} ${it.second}" } + ".",
                table = s.setsByMuscle.map { muscleName(it.first).replaceFirstChar { c -> c.uppercase() } to "${it.second} sets" },
            ) { ColumnChart(top.map { it.second.toDouble() }, top.map { muscleName(it.first).take(5) }) }
        }
        if (s.weeklyRunM.any { it.second > 0.0 }) {
            val km = unit == WeightUnit.Kg
            val values = s.weeklyRunM.map { it.second / unitMeters(unit) }
            val word = if (km) "km" else "mi"
            ChartCard(
                title = "Running, per week",
                summary = "Distance run each week for the last ${values.size} weeks, the latest ${trimNumber(values.last())} $word.",
                table = s.weeklyRunM.map { dayLabel(it.first) to "${trimNumber(it.second / unitMeters(unit))} $word" },
            ) { LineChart(values, s.weeklyRunM.map { dayLabel(it.first) }) }
        }
    }
}

// ---- Body ----

@Composable
fun BodyScreen(snapshot: EngineSnapshot) {
    val container = LocalAppContainer.current
    val stats by produceState<com.qala.data.stats.BodyStats?>(null, snapshot) {
        value = withContext(container.env.work) { Stats.body(snapshot, container.env.clock.nowMs(), container.env.clock.zone) }
    }
    val c = Qala.colors
    val score = snapshot.readiness?.today?.score?.let { (it * 100).roundToInt().coerceIn(0, 100) }
    val unit = snapshot.unit
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PageHead("Body", eyebrow = "Recovery and weight")
        Card(hero = true) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                ReadinessRing(score)
                Column {
                    GroupLabel("Readiness today")
                    QalaText(
                        when {
                            score == null -> "Not enough history yet."
                            snapshot.readiness?.checkedInToday == true -> "From today's check-in and your training."
                            else -> "An estimate from your training. Check in to firm it up."
                        },
                        Modifier.padding(top = 4.dp),
                        QalaType.hint,
                        c.fgMuted,
                    )
                }
            }
        }
        val s = stats ?: run { Empty("Reading your history."); return@Column }
        if (s.readiness.isNotEmpty()) {
            val values = s.readiness.map { it.value }
            ChartCard(
                title = "Readiness, last 7 days",
                summary = "Readiness each day for the last ${values.size} days, from ${values.first().roundToInt()} to ${values.last().roundToInt()} out of 100.",
                table = s.readiness.map { dayLabel(it.date) to "${it.value.roundToInt()} of 100" },
            ) { LineChart(values, s.readiness.map { dayLabel(it.date) }) }
        }
        weightCard(s.weights, unit)
    }
}

@Composable
private fun weightCard(weights: List<DatedValue>, unit: WeightUnit) {
    if (weights.size < 2) {
        Empty(if (weights.isEmpty()) "No weigh-ins yet." else "One weigh-in so far. The trend needs a few.")
        return
    }
    val word = unitName(unit)
    val values = weights.map { it.value }
    ChartCard(
        title = "Body weight",
        summary = "Body weight over ${values.size} weigh-ins, from ${trimNumber(values.first())} to ${trimNumber(values.last())} $word.",
        table = weights.map { dayLabel(it.date) to "${trimNumber(it.value)} $word" },
    ) { LineChart(values, weights.map { dayLabel(it.date) }) }
}

// ---- Session complete ----

/**
 * Opened after Finish workout, on the wash under [WashScrim.Board3] (S51 board Session): the figures and the charts are drawn straight
 * on it, and Done is pinned. [saveError] is the message when the save failed and the workout was kept.
 */
@Composable
fun SessionCompleteScreen(scroll: ScrollState, onDone: () -> Unit) {
    val container = LocalAppContainer.current
    val summary by container.workout.summary.collectAsState()
    val saveError by container.workout.saveError.collectAsState()
    val s = summary
    WashPage(
        scroll,
        WashScrim.Board3,
        head = { ScreenHead(if (saveError != null) "Not saved" else "Session complete", eyebrow = s?.dayName) },
        pinned = { PinnedBar { PrimaryButton(if (saveError != null) "Back to Today" else "Done", onDone, large = true) } },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
            saveError?.let { WashCard(contentPadding = 16.dp) { QalaText(it, style = QalaType.body, color = Qala.colors.fg) } }
            if (s == null) {
                WashCard(contentPadding = 16.dp) { QalaText("There is no workout to show.", style = QalaType.hint, color = Qala.colors.fgMuted) }
            } else {
                SummaryBody(s)
            }
        }
        Spacer(Modifier.height(BarRoom))
    }
}

/** The pinned bar's height without the tab bar's clearance: its 10 dp of top padding and the large button's 64 dp. The last card ends this far above the page's own bottom padding. */
private val BarRoom = 74.dp

/** The big figures under the head: the title face at 52 sp, white on the wash. */
private val FigureStyle = Wash.Title.copy(fontSize = 52.sp, lineHeight = 52.sp, letterSpacing = (-0.02).em)

/** A kicker over a big figure, white on the wash. A time of an hour or more ("1:05:20") drops to 44 sp so it stays inside its half of the row. */
@Composable
private fun SummaryFigure(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        QalaText(label.uppercase(), style = Wash.Kicker, color = Wash.Text2)
        QalaText(value, Modifier.padding(top = 4.dp), if (value.length > 5) FigureStyle.copy(fontSize = 44.sp, lineHeight = 44.sp) else FigureStyle, Wash.Text)
    }
}

@Composable
private fun SummaryBody(s: SessionSummary) {
    val lift = unitName(s.unit)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        // The same total the time split shows in its middle: the warm-up, the lifting and the resting.
        SummaryFigure("Time", elapsedText(((s.warmupSec ?: 0) + s.liftSec + s.restSec).toDouble()), Modifier.weight(1f))
        SummaryFigure("Sets", "${s.sets}", Modifier.weight(1f))
    }
    // The warm-up slice is left out when it was not measured; the colours belong to the slices, so the others do not shift.
    val parts = listOfNotNull(
        s.warmupSec?.takeIf { it > 0 }?.let { Triple("Warm-up", it, Wash.Teal) },
        Triple("Lifting", s.liftSec, Wash.ChartEmber),
        Triple("Resting", s.restSec, Color.White.copy(alpha = 0.35f)),
    )
    val total = parts.sumOf { it.second }
    fun share(seconds: Int) = if (total > 0) "${Math.round(seconds * 100.0 / total)}%" else "0%"
    ChartCard(
        title = "Time split",
        summary = "Where the time went, ${elapsedText(total.toDouble())} in all: " + parts.joinToString(", ") { "${it.first} ${elapsedText(it.second.toDouble())}, ${share(it.second)}" } + ".",
        table = parts.map { it.first to "${elapsedText(it.second.toDouble())} · ${share(it.second)}" },
        surface = ChartSurface.Wash,
    ) { Donut(parts.map { DonutSlice(it.first, it.second.toDouble(), it.third, "${elapsedText(it.second.toDouble())} · ${share(it.second)}") }, elapsedText(total.toDouble()), "total") }
    if (s.setsByMuscle.isNotEmpty()) {
        val top = s.setsByMuscle.take(8)
        // A name stays whole while the bars are 66 dp apart (five or fewer); with more bars it is cut to five letters.
        val room = if (top.size > 5) 5 else Int.MAX_VALUE
        ChartCard(
            title = "Sets by muscle",
            summary = "Sets this session: " + top.joinToString(", ") { "${muscleName(it.first)} ${it.second}" } + ".",
            table = s.setsByMuscle.map { muscleName(it.first).replaceFirstChar { c -> c.uppercase() } to "${it.second} sets" },
            surface = ChartSurface.Wash,
        ) { ColumnChart(top.map { it.second.toDouble() }, top.map { muscleName(it.first).take(room) }) }
    }
    if (s.e1rms.isNotEmpty()) {
        WashCard(contentPadding = 14.dp) {
            GroupLabel("Estimated 1RM")
            s.e1rms.forEach { e ->
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    QalaText(e.name, style = QalaType.body, color = Qala.colors.fg)
                    QalaText("${trimNumber(e.e1rm)} $lift", style = QalaType.log, color = Qala.colors.fg)
                }
            }
        }
    }
}
