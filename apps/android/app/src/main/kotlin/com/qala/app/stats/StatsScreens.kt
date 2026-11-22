package com.qala.app.stats

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.charts.ChartCard
import com.qala.app.charts.ChartReference
import com.qala.app.charts.ChartSurface
import com.qala.app.charts.ColumnChart
import com.qala.app.charts.Donut
import com.qala.app.charts.DonutSlice
import com.qala.app.charts.LineChart
import com.qala.app.charts.ReadinessRing
import com.qala.app.run.elapsedText
import com.qala.app.today.againstAverage
import com.qala.app.today.muscleName
import com.qala.app.today.scorePoints
import com.qala.app.today.trimNumber
import com.qala.app.today.unitName
import com.qala.app.today.weightIn
import com.qala.app.today.weightValue
import com.qala.app.workout.SessionSummary
import com.qala.data.core.DatedValue
import com.qala.data.core.WeightTrend
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.WeightUnit
import com.qala.data.stats.LiftTrend
import com.qala.data.stats.ProgressStats
import com.qala.data.stats.Stats
import com.qala.design.Card
import com.qala.design.GlassCard
import com.qala.design.GlassPage
import com.qala.design.GroupLabel
import com.qala.design.PageHead
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.ScreenHead
import com.qala.design.Wash
import com.qala.design.glassInk
import com.qala.design.glassMuted
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs
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

/**
 * Progress on the Glass carrier: a chip per main lift under the head, the picked lift's e1RM as the hero card, then this week's sets by
 * muscle and the weeks of running. The picked lift is kept across a rotation and a return to the tab.
 */
@Composable
fun ProgressScreen(snapshot: EngineSnapshot, scroll: ScrollState) {
    val container = LocalAppContainer.current
    val stats by produceState<ProgressStats?>(null, snapshot) {
        value = withContext(container.env.work) { Stats.progress(snapshot, container.env.clock.nowMs(), container.env.clock.zone) }
    }
    val unit = snapshot.unit
    val s = stats
    val lifts = s?.lifts.orEmpty()
    var picked by rememberSaveable { mutableStateOf("") }
    val lift = lifts.firstOrNull { it.exerciseId == picked } ?: lifts.firstOrNull()
    GlassPage(
        scroll,
        head = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ScreenHead("Progress", eyebrow = "Strength and volume")
                if (lift != null) LiftChips(lifts, lift.exerciseId) { picked = it }
            }
        },
    ) {
        if (s == null) {
            GlassNote("Reading your history.")
        } else if (lift == null && s.setsByMuscle.isEmpty() && s.weeklyRunM.all { it.second == 0.0 }) {
            GlassNote("Nothing to chart yet. Lift or run and it shows up here.")
        } else {
            if (lift != null) LiftCard(lift, unitName(unit))
            if (s.setsByMuscle.isNotEmpty()) {
                val top = s.setsByMuscle.take(8)
                ChartCard(
                    title = "Sets by muscle, this week",
                    summary = "Hard sets this week: " + top.joinToString(", ") { "${muscleName(it.first)} ${it.second}" } + ".",
                    table = s.setsByMuscle.map { muscleName(it.first).replaceFirstChar { c -> c.uppercase() } to "${it.second} sets" },
                    surface = ChartSurface.Glass,
                    meta = "Hard sets, most first",
                ) { ColumnChart(top.map { it.second.toDouble() }, top.map { muscleName(it.first).take(6).trimEnd() }) }
            }
            if (s.weeklyRunM.any { it.second > 0.0 }) {
                val km = unit == WeightUnit.Kg
                val values = s.weeklyRunM.map { it.second / unitMeters(unit) }
                val word = if (km) "km" else "mi"
                ChartCard(
                    title = "Running, per week",
                    summary = "Distance run each week for the last ${values.size} weeks, the latest ${trimNumber(values.last())} $word.",
                    table = s.weeklyRunM.map { dayLabel(it.first) to "${trimNumber(it.second / unitMeters(unit))} $word" },
                    surface = ChartSurface.Glass,
                    meta = "${values.size} weeks · ${if (km) "kilometres" else "miles"}",
                ) { ColumnChart(values, s.weeklyRunM.map { dayLabel(it.first) }, highlightLast = true) }
            }
        }
    }
}

/** The name a chip carries: the program's lifts fit four across when the two presses lose a word. */
private fun chipName(t: LiftTrend) = when (t.exerciseId) {
    "benchPress" -> "Bench"
    "overheadPress" -> "Press"
    else -> t.name
}

/** One chip per lift, the [selected] one white. The row scrolls, since a lifter can name more lifts than four chips leave room for. */
@Composable
private fun LiftChips(lifts: List<LiftTrend>, selected: String, onPick: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        lifts.forEach { LiftChip(chipName(it), it.exerciseId == selected) { onPick(it.exerciseId) } }
    }
}

/** A glass pill: dark glass with a hairline, white and inked when picked. */
@Composable
private fun LiftChip(text: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Box(
        Modifier
            .height(44.dp)
            .background(if (selected) Color.White.copy(alpha = 0.92f) else Wash.GlassFill, shape)
            .border(1.dp, if (selected) Color.Transparent else Wash.GlassBorder, shape)
            .selectable(selected = selected, interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        QalaText(text, style = QalaType.button.copy(fontSize = 13.sp, lineHeight = 16.sp), color = if (selected) Wash.EmberInk else Wash.Text, maxLines = 1)
    }
}

/**
 * The lift's e1RM as the hero: the latest figure beside what it did over the span, and the line in the night panel with its start as the
 * dashed reference. One rounding (a tenth) serves the figure, the headline, the reference and the "now" label, so they never disagree.
 */
@Composable
private fun LiftCard(t: LiftTrend, word: String) {
    val points = t.points
    val values = points.map { it.value }
    val first = points.first()
    val last = points.last()
    val several = points.size > 1
    HeroCard(
        title = "${t.name} e1RM",
        table = points.map { dayLabel(it.date) to "${trimNumber(it.value)} $word" },
        head = {
            Eyebrow("${t.name} · estimated 1RM")
            Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Bottom) {
                QalaText(fig(last.value), style = QalaType.figure.copy(fontSize = 52.sp, lineHeight = 52.sp, letterSpacing = (-0.02).em), color = glassInk(), maxLines = 1)
                Column(Modifier.weight(1f).padding(bottom = 4.dp)) {
                    QalaText(liftHeadline(first, last, word), style = QalaType.cardTitle, color = glassInk())
                    QalaText(if (several) "since ${dayLabel(first.date)} · start ${fig(first.value)}" else dayLabel(first.date), style = NoteStyle, color = glassMuted())
                }
            }
        },
    ) {
        val summary = "${t.name} estimated one-rep max over ${values.size} sessions, from ${trimNumber(values.first())} to ${trimNumber(values.last())} $word."
        Box(Modifier.clearAndSetSemantics { contentDescription = summary }) {
            LineChart(
                values, points.map { dayLabel(it.date) },
                reference = if (several) ChartReference(first.value, "start ${fig(first.value)}") else null,
                nowLabel = "now ${fig(last.value)}",
            )
        }
    }
}

/** "Up 12 lb in 8 weeks", "Down 3 lb in 4 weeks", or "Holding at 294 lb" when the line has not moved or has one point. */
private fun liftHeadline(first: DatedValue, last: DatedValue, word: String): String {
    val change = tenth(last.value - first.value)
    if (first === last || change == 0.0) return "Holding at ${fig(last.value)} $word"
    val days = ChronoUnit.DAYS.between(LocalDate.parse(first.date.take(10)), LocalDate.parse(last.date.take(10)))
    val span = when {
        days >= 14 -> "${(days / 7.0).roundToInt()} weeks"
        days > 1 -> "$days days"
        else -> "a day"
    }
    return "${if (change > 0) "Up" else "Down"} ${trimNumber(abs(change))} $word in $span"
}

private fun tenth(v: Double) = Math.round(v * 10) / 10.0

/** [v] to a tenth, without a trailing ".0". */
private fun fig(v: Double) = trimNumber(tenth(v))

// ---- Body ----

/**
 * Body on the Glass carrier: the readiness card (today's ring with the 28-day average tick, and the last seven days under it), a prompt to
 * check in until today's is done, and the weight line against its 7-day average. [onCheckIn] opens the check-in.
 */
@Composable
fun BodyScreen(snapshot: EngineSnapshot, scroll: ScrollState, onCheckIn: () -> Unit) {
    val container = LocalAppContainer.current
    val stats by produceState<com.qala.data.stats.BodyStats?>(null, snapshot) {
        value = withContext(container.env.work) { Stats.body(snapshot, container.env.clock.nowMs(), container.env.clock.zone) }
    }
    val unit = snapshot.unit
    val readiness = snapshot.readiness
    // The engine's scores are 0 to 1; the page reads them on the web's 0 to 100.
    val score = readiness?.today?.score?.let { scorePoints(it.coerceIn(0.0, 1.0)) }
    val average = readiness?.average28d?.let { scorePoints(it.coerceIn(0.0, 1.0)) }
    val checkedIn = readiness?.checkedInToday == true
    val s = stats
    GlassPage(scroll, head = { ScreenHead("Body", eyebrow = "Recovery and weight") }) {
        ReadinessCard(score, average, checkedIn, s?.readiness.orEmpty())
        if (!checkedIn) CheckInCard(score != null, onCheckIn)
        if (s == null) GlassNote("Reading your history.") else WeightCard(s.weights, unit, snapshot.weightTrend)
    }
}

/**
 * Today's readiness: the ring with the 28-day [average] marked on it, a headline against that average, and the last days' line in the same
 * night panel. The ring keeps its own description; the line stands for one sentence, and the Table switch lists its days.
 */
@Composable
private fun ReadinessCard(score: Int?, average: Int?, checkedIn: Boolean, curve: List<DatedValue>) {
    val values = curve.map { it.value }
    val headline = when {
        score == null -> "Not enough history yet."
        average == null -> "No 28-day average yet"
        else -> againstAverage(score, average)
    }
    val note = listOfNotNull(average?.let { "28-day average $it" }, "checked in today".takeIf { checkedIn }).joinToString(" · ")
    HeroCard(
        title = "Readiness",
        table = curve.map { dayLabel(it.date) to "${it.value.roundToInt()} of 100" },
        head = {
            Eyebrow("Readiness today")
            QalaText(headline, Modifier.padding(top = 2.dp), QalaType.cardTitle, glassInk())
            if (note.isNotEmpty()) QalaText(note, Modifier.padding(top = 2.dp), NoteStyle, glassMuted())
        },
    ) {
        ReadinessRing(score, Modifier.align(Alignment.CenterHorizontally), average)
        if (values.isNotEmpty()) {
            Eyebrow("Readiness, last 7 days", Modifier.padding(start = 6.dp, top = 10.dp), Color.White.copy(alpha = 0.88f))
            val summary = "Readiness each day for the last ${values.size} days, from ${values.first().roundToInt()} to ${values.last().roundToInt()} out of 100" +
                (average?.let { ", against a 28-day average of $it." } ?: ".")
            Box(Modifier.clearAndSetSemantics { contentDescription = summary }) {
                LineChart(
                    values, curve.map { weekdayInitial(it.date) },
                    reference = average?.let { ChartReference(it.toDouble(), "avg $it") },
                    nowLabel = "now ${values.last().roundToInt()}",
                )
            }
        }
    }
}

/** "How are you walking in?" with the way to the check-in, for a day that has none yet. */
@Composable
private fun CheckInCard(hasScore: Boolean, onCheckIn: () -> Unit) {
    GlassCard(
        body = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    QalaText("How are you walking in?", style = QalaType.cardTitle, color = glassInk())
                    QalaText(
                        if (hasScore) "An estimate from your training. Check in to firm it up." else "Your first check-in sets it. The 28-day average builds as you check in.",
                        Modifier.padding(top = 2.dp), MetaStyle, glassMuted(),
                    )
                }
                // The button fills the width it is offered, so it is told to take only what its label needs.
                PrimaryButton("Check in", onCheckIn, Modifier.width(IntrinsicSize.Max))
            }
        },
    )
}

@Composable
private fun WeightCard(weights: List<DatedValue>, unit: WeightUnit, trend: WeightTrend?) {
    if (weights.size < 2) {
        GlassNote(if (weights.isEmpty()) "No weigh-ins yet." else "One weigh-in so far. The trend needs a few.")
        return
    }
    val word = unitName(unit)
    val values = weights.map { it.value }
    ChartCard(
        title = "Body weight",
        summary = "Body weight over ${values.size} weigh-ins, from ${trimNumber(values.first())} to ${trimNumber(values.last())} $word.",
        table = weights.map { dayLabel(it.date) to "${trimNumber(it.value)} $word" },
        surface = ChartSurface.Glass,
        meta = "${values.size} weigh-ins · $word",
    ) {
        // The weigh-ins are already in the lifter's unit; the trend's average is kilograms.
        LineChart(values, weights.map { dayLabel(it.date) }, reference = trend?.let { ChartReference(weightValue(unit, it.avg7Kg), "7-day avg ${weightIn(unit, it.avg7Kg)}") })
    }
}

// ---- the glass pieces both screens share ----

private val NoteStyle = QalaType.log.copy(fontSize = 11.sp, lineHeight = 14.sp)
private val MetaStyle = QalaType.body.copy(fontSize = 12.sp, lineHeight = 16.sp)

/** "M" for a Monday: the day under a point of the readiness line, whose table has the dates. */
private fun weekdayInitial(date: String): String = LocalDate.parse(date.take(10)).dayOfWeek.getDisplayName(java.time.format.TextStyle.NARROW, Locale.US)

/** The small upper-case line over a card's headline, in the card's quiet ink unless told otherwise. */
@Composable
private fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = glassMuted()) =
    QalaText(text.uppercase(), modifier, QalaType.groupLabel, color, maxLines = 1)

/** A line on a glass card for what is loading or missing. */
@Composable
private fun GlassNote(text: String) {
    GlassCard(body = { QalaText(text, style = QalaType.hint, color = glassMuted()) })
}

/**
 * A glass card whose header is [head] (a figure and a headline, where [ChartCard]'s is a title and a line), with the Table and Chart switch at
 * its right and [chart] in the night panel. Same switch as [ChartCard]'s: two button labels and the same description. [chart] gives its own
 * semantics, so a ring in it keeps its description while a line beside it stands for a sentence.
 */
@Composable
private fun HeroCard(
    title: String,
    table: List<Pair<String, String>>,
    head: @Composable ColumnScope.() -> Unit,
    chart: @Composable ColumnScope.() -> Unit,
) {
    var asTable by remember { mutableStateOf(false) }
    GlassCard(
        header = {
            Column(Modifier.weight(1f), content = head)
            if (table.isNotEmpty()) TableSwitch(title, asTable) { asTable = !asTable }
        },
        body = if (asTable) { { TableRows(table) } } else null,
        panel = if (asTable) null else chart,
    )
}

/** The Table / Chart switch: underlined glass ink, at least 44 dp square to touch. */
@Composable
private fun TableSwitch(title: String, asTable: Boolean, onClick: () -> Unit) {
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
            color = glassInk(),
            maxLines = 1,
        )
    }
}

@Composable
private fun TableRows(rows: List<Pair<String, String>>) {
    Column(Modifier.fillMaxWidth()) {
        rows.forEach { (label, value) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                QalaText(label, style = QalaType.log, color = glassMuted())
                QalaText(value, style = QalaType.log, color = glassInk())
            }
        }
    }
}

// ---- Session complete ----

/** Opened after Finish workout. [saveError] is the message when the save failed and the workout was kept. */
@Composable
fun SessionCompleteScreen(onDone: () -> Unit) {
    val container = LocalAppContainer.current
    val summary by container.workout.summary.collectAsState()
    val saveError by container.workout.saveError.collectAsState()
    val s = summary
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PageHead(if (saveError != null) "Not saved" else "Session complete", eyebrow = s?.dayName)
        // Done is first, not last: the charts make the page long, and the way out must never be scrolled to.
        PrimaryButton(if (saveError != null) "Back to Today" else "Done", onDone, Modifier.fillMaxWidth(), large = true)
        saveError?.let { Card(contentPadding = 16.dp) { QalaText(it, style = QalaType.body, color = Qala.colors.fg) } }
        if (s == null) {
            Empty("There is no workout to show.")
        } else {
            SummaryBody(s)
        }
    }
}

@Composable
private fun SummaryBody(s: SessionSummary) {
    val lift = unitName(s.unit)
    Card(hero = true) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            // The same total the time split shows in its middle: the warm-up, the lifting and the resting.
            Column { GroupLabel("Time"); QalaText(elapsedText(((s.warmupSec ?: 0) + s.liftSec + s.restSec).toDouble()), style = QalaType.figure, color = Qala.colors.fg) }
            Column { GroupLabel("Sets"); QalaText("${s.sets}", style = QalaType.figure, color = Qala.colors.fg) }
        }
    }
    // The warm-up slice is left out when it was not measured; the colours belong to the slices, so the others do not shift.
    val c = Qala.colors
    val parts = listOfNotNull(s.warmupSec?.takeIf { it > 0 }?.let { Triple("Warm-up", it, c.viz1) }, Triple("Lifting", s.liftSec, c.viz2), Triple("Resting", s.restSec, c.viz3))
    val total = parts.sumOf { it.second }
    fun share(seconds: Int) = if (total > 0) "${Math.round(seconds * 100.0 / total)}%" else "0%"
    ChartCard(
        title = "Time split",
        summary = "Where the time went, ${elapsedText(total.toDouble())} in all: " + parts.joinToString(", ") { "${it.first} ${elapsedText(it.second.toDouble())}, ${share(it.second)}" } + ".",
        table = parts.map { it.first to "${elapsedText(it.second.toDouble())} · ${share(it.second)}" },
    ) { Donut(parts.map { DonutSlice(it.first, it.second.toDouble(), it.third, "${elapsedText(it.second.toDouble())} · ${share(it.second)}") }, elapsedText(total.toDouble()), "total") }
    if (s.setsByMuscle.isNotEmpty()) {
        val top = s.setsByMuscle.take(8)
        ChartCard(
            title = "Sets by muscle",
            summary = "Sets this session: " + top.joinToString(", ") { "${muscleName(it.first)} ${it.second}" } + ".",
            table = s.setsByMuscle.map { muscleName(it.first).replaceFirstChar { c -> c.uppercase() } to "${it.second} sets" },
        ) { ColumnChart(top.map { it.second.toDouble() }, top.map { muscleName(it.first).take(5) }) }
    }
    if (s.e1rms.isNotEmpty()) {
        Card(contentPadding = 16.dp) {
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
