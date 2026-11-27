package com.qala.app.run

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.charts.ChartCard
import com.qala.app.charts.ChartSurface
import com.qala.app.charts.RunSeries
import com.qala.app.today.distanceUnit
import com.qala.app.today.effortText
import com.qala.data.core.ProcessedRun
import com.qala.data.core.RunLive
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.GymSettings
import com.qala.data.model.WeightUnit
import com.qala.design.GroupLabel
import com.qala.design.GroupRow
import com.qala.design.LinkButton
import com.qala.design.LocalBarClearance
import com.qala.design.LocalTitleFamily
import com.qala.design.PinnedBar
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaSwitch
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.ScalePicker
import com.qala.design.ScreenHead
import com.qala.design.SecondaryButton
import com.qala.design.Wash
import com.qala.design.WashCard
import com.qala.design.WashPage
import com.qala.design.WashScrim
import com.qala.design.beamerSurface
import kotlinx.coroutines.launch

/*
 * Run (DESIGN 7.14): Start, Live and Summary over the run state in [RunRecording], all on the wash (DECISIONS S51). Start shows the
 * planned run, the GPS, the cues switch and asks for what the run needs, with Start run in a bar at the bottom; Live draws miles
 * largest with time and pace straight on the wash, a square ember pause and Finish run in the bar; Summary draws six figures and the
 * run's charts on the wash, then the splits and the effort pick on cards, then Save. No maps here (they come with the map work), no
 * rTSS, climb or "for tomorrow", and the guided run is not built (DECISIONS S40).
 */


/**
 * Which of the three screens, from the run state. [onBack] leaves the route (a saved or discarded run goes back to where it started).
 * Each screen has its own scroll state, so a Live that was scrolled does not hand the Summary an offset.
 */
@Composable
fun RunRoute(snapshot: EngineSnapshot, onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.runRecording.state.collectAsState()
    val gym by container.settings.gym.collectAsState(initial = GymSettings())
    when (val s = state) {
        RunState.Idle -> StartRun(snapshot, gym, onBack)
        is RunState.Active -> LiveRun(s, snapshot.unit)
        is RunState.Finished -> RunSummary(s, snapshot.unit, onBack)
    }
}

// ---- Start ----

@Composable
private fun StartRun(snapshot: EngineSnapshot, gym: GymSettings, onBack: () -> Unit) {
    val context = LocalContext.current
    val container = LocalAppContainer.current
    val c = Qala.colors
    val unit = snapshot.unit
    val next = snapshot.nextRun?.plan
    val title = next?.let { "${it.label} · ${distanceIn(unit, it.distanceM)} ${distanceUnit(unit)}" } ?: "Run"
    var blocked by remember { mutableStateOf(false) }
    val gps = rememberGpsStatus()

    fun begin() {
        // The container's scope, not the screen's: starting the run swaps this screen for Live, and that must not cancel the service start.
        container.scope.launch {
            container.runRecording.start(title, runOpts(gym.running, unit))
            RunRecordingService.start(context)
        }
    }

    // The asks go in order, one after the other: precise location (a refusal stops the run), notifications (a refusal is fine),
    // then once, the exemption from battery optimisation.
    val battery = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { begin() }
    fun askBattery() {
        val prefs = context.getSharedPreferences("qala", Context.MODE_PRIVATE)
        val power = context.getSystemService(PowerManager::class.java)
        if (power.isIgnoringBatteryOptimizations(context.packageName) || prefs.getBoolean(AskedBattery, false)) {
            begin()
        } else {
            prefs.edit().putBoolean(AskedBattery, true).apply()
            battery.launch(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
        }
    }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { askBattery() }
    fun askNotifications() {
        val prefs = context.getSharedPreferences("qala", Context.MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= 33 && !granted(context, Manifest.permission.POST_NOTIFICATIONS) && !prefs.getBoolean(AskedNotifications, false)) {
            prefs.edit().putBoolean(AskedNotifications, true).apply()
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            askBattery()
        }
    }
    val location = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            blocked = false
            askNotifications()
        } else {
            blocked = true        // approximate-only is not enough to record a run
        }
    }
    fun start() {
        if (granted(context, Manifest.permission.ACCESS_FINE_LOCATION)) askNotifications()
        else location.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    WashPage(
        scroll = rememberScrollState(),
        scrim = WashScrim.Soft,
        head = { ScreenHead(title, eyebrow = if (next != null) "Next run" else "Run", onBack = onBack) },
        pinned = { PinnedBar { PrimaryButton("Start run", ::start, large = true, icon = QalaIcons.Play) } },
    ) {
        WashCard(contentPadding = 0.dp) {
            GroupRow {
                QalaIcon(QalaIcons.SignalHigh, null, size = 18.dp, tint = if (gps.good) c.progress else c.fgMuted)
                QalaText(gps.text, Modifier.weight(1f).semantics { contentDescription = "GPS status, ${gps.text}" }, QalaType.log.copy(fontSize = 13.sp), if (gps.good) c.fg else c.fgMuted)
            }
            GroupRow(last = next == null && !blocked) {
                QalaIcon(QalaIcons.Volume2, null, size = 18.dp, tint = c.fgMuted)
                QalaText(if (gym.running.cues) cueLabel(gym, unit) else "Cues off", Modifier.weight(1f), QalaType.body, c.fg)
                QalaSwitch(gym.running.cues, { on -> container.scope.launch { container.settings.setRunCues(on) } }, "Audio cues")
            }
            if (next != null) {
                GroupRow(last = !blocked) {
                    QalaIcon(QalaIcons.SportShoe, null, size = 18.dp, tint = c.fgMuted)
                    QalaText(effortText(next.zone) + ".", Modifier.weight(1f), QalaType.hint, c.fgMuted)
                }
            }
            if (blocked) {
                QalaText(
                    "Qala needs precise location to record a run. Allow precise location for Qala in the phone's settings, then start again.",
                    Modifier.padding(16.dp),
                    QalaType.hint,
                    c.accent,
                )
            }
        }
        Spacer(Modifier.height(StartButton))          // the pinned bar is this tall over the last row
    }
}

private const val AskedNotifications = "askedNotifications"
private const val AskedBattery = "askedBatteryOptimisation"

private fun granted(context: Context, permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

private fun cueLabel(gym: GymSettings, unit: WeightUnit): String {
    val metric = unit == WeightUnit.Kg
    return when (gym.running.cueEvery) {
        com.qala.data.model.CueEvery.Half -> if (metric) "Cue every 0.5 km" else "Cue every 0.5 mi"
        com.qala.data.model.CueEvery.One -> if (metric) "Cue every 1 km" else "Cue every 1 mi"
        com.qala.data.model.CueEvery.Time -> "Cue every 5 min"
    }
}

/** What the Start screen says about the GPS: a line, and whether it is good enough to start on. */
private class GpsStatus(val text: String, val good: Boolean)

/** Listens for a position while the Start screen is up, so "GPS good" is a fact and not a hope. */
@Composable
private fun rememberGpsStatus(): GpsStatus {
    val context = LocalContext.current
    var status by remember { mutableStateOf(GpsStatus(if (granted(context, Manifest.permission.ACCESS_FINE_LOCATION)) "Looking for GPS" else "Allow location to record", false)) }
    DisposableEffect(Unit) {
        val source = LocationFixSource(context)
        if (granted(context, Manifest.permission.ACCESS_FINE_LOCATION)) {
            try {
                source.start { fix ->
                    val m = fix.acc.toInt()
                    status = when {
                        fix.acc <= 15 -> GpsStatus("GPS good, within $m m", true)
                        fix.acc <= 25 -> GpsStatus("GPS fair, within $m m", true)
                        else -> GpsStatus("GPS weak, within $m m", false)
                    }
                }
            } catch (e: SecurityException) {
                status = GpsStatus("Allow location to record", false)
            }
        }
        onDispose { source.stop() }
    }
    return status
}

// ---- Live ----

/** What a pinned bar adds over the page's own bottom padding: the height of its one control. */
private val StartButton = 64.dp
private val LiveControl = 72.dp

/** The Live head's height, over-reserved (the status gap, two title lines under the kicker, the page's top padding) so centring the figures never makes the page scroll. */
private val LiveHeadReserve = 12.dp + 84.dp + 16.dp

@Composable
private fun LiveRun(state: RunState.Active, unit: WeightUnit) {
    val container = LocalAppContainer.current
    val c = Qala.colors
    val live = state.live
    val paused = state.run.paused
    val figures = listOfNotNull(
        "Time" to elapsedText(live?.elapsedSec ?: 0.0),
        "Pace" to paceText(live?.current?.paceSecPerM, unit),
        "Avg" to paceText(live?.avg?.paceSecPerM, unit),
        state.hr?.let { "HR" to it.toString() },
    )
    // The figures sit centred between the head and the bar. The page scrolls, so its content has no height to centre in: the screen's own
    // is taken here, and the head, the bar and the bottom padding come off it.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val room = (maxHeight - WindowInsets.statusBars.asPaddingValues().calculateTopPadding() - LiveHeadReserve - LocalBarClearance.current - 16.dp - LiveControl).coerceAtLeast(0.dp)
        WashPage(
            scroll = rememberScrollState(),
            scrim = WashScrim.Soft,
            head = { LiveHead(state.run.title, paused) },
            pinned = {
                PinnedBar {
                    // A square ember button, the DESIGN 7.14 pause. 72 dp so a thumb finds it with a hand that is moving.
                    Box(
                        Modifier
                            .size(LiveControl)
                            .beamerSurface(c.accent, Color.Transparent, QalaTokens.radiusMd, c.shadowCta, 0.dp)
                            .clickable(role = Role.Button, onClickLabel = if (paused) "Resume the run" else "Pause the run") {
                                if (paused) container.runRecording.resume() else container.runRecording.pause()
                            }
                            .semantics { contentDescription = if (paused) "Resume" else "Pause" },
                        contentAlignment = Alignment.Center,
                    ) {
                        QalaIcon(if (paused) QalaIcons.Play else QalaIcons.Pause, null, size = 32.dp, tint = c.onAccent)
                    }
                    Spacer(Modifier.width(6.dp))          // 14 dp between the two, so a thumb on Pause does not land on Finish
                    SecondaryButton("Finish run", { container.runRecording.finish() }, Modifier.weight(1f).height(LiveControl))
                }
            },
        ) {
            Column(Modifier.fillMaxWidth().heightIn(min = room), verticalArrangement = Arrangement.spacedBy(40.dp, Alignment.CenterVertically)) {
                Column(
                    Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = liveDescription(live, unit) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    FitFigure(distanceText(live?.distM ?: 0.0, unit), 140, textAlign = TextAlign.Center)
                    WashLabel(if (unit == WeightUnit.Kg) "kilometres" else "miles", Modifier.padding(top = 10.dp), TextAlign.Center)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Wash.Line))
                Column(verticalArrangement = Arrangement.spacedBy(26.dp)) {
                    figures.chunked(2).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            row.forEach { (label, value) -> WashFigure(label, value, 46, Modifier.weight(1f), TextAlign.Center) }
                        }
                    }
                }
            }
            Spacer(Modifier.height(LiveControl))          // the pinned bar is this tall over the last row
        }
    }
}

/**
 * The Live head. [ScreenHead] has no room for the ember dot that says the run is happening, so this draws the kicker with it, and the
 * 30 sp title the board has, in the same faces. A paused run's dot goes quiet.
 */
@Composable
private fun LiveHead(title: String, paused: Boolean) {
    Column(Modifier.fillMaxWidth().padding(top = 2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.padding(end = 8.dp).size(8.dp).background(if (paused) Wash.Line else Wash.ChartEmber, CircleShape))
            QalaText((if (paused) "Paused" else "Recording").uppercase(), style = Wash.Kicker, color = Wash.Text2, maxLines = 1)
        }
        QalaText(title, Modifier.semantics { heading() }, Wash.Title, Wash.Text, maxLines = 2)
    }
}

/** A small upper-case label on the wash. */
@Composable
private fun WashLabel(text: String, modifier: Modifier = Modifier, textAlign: TextAlign = TextAlign.Unspecified) =
    QalaText(text.uppercase(), modifier, Wash.Kicker, Wash.Text2, textAlign, maxLines = 1)

/** A label over a figure, straight on the wash. */
@Composable
private fun WashFigure(label: String, value: String, size: Int, modifier: Modifier = Modifier, textAlign: TextAlign = TextAlign.Start) {
    Column(modifier) {
        WashLabel(label, Modifier.fillMaxWidth(), textAlign)
        FitFigure(value, size, Modifier.padding(top = 4.dp), textAlign)
    }
}

/**
 * A figure in the title face, white with the wash's text shadow. It shrinks to the width it has, so a run of an hour or a large font
 * scale never turns it into an ellipsis.
 */
@Composable
private fun FitFigure(text: String, size: Int, modifier: Modifier = Modifier, textAlign: TextAlign = TextAlign.Start) {
    val measurer = rememberTextMeasurer()
    val style = QalaType.ticking.copy(
        fontFamily = LocalTitleFamily.current,
        fontSize = size.sp,
        lineHeight = (size * 1.1f).sp,
        letterSpacing = (-0.02).em,
        shadow = Wash.TextShadow,
    )
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val width = measurer.measure(text, style, maxLines = 1, softWrap = false).size.width
        val fit = if (width > constraints.maxWidth) constraints.maxWidth / width.toFloat() else 1f
        QalaText(text, Modifier.fillMaxWidth(), style.copy(fontSize = style.fontSize * fit, lineHeight = style.lineHeight * fit), Wash.Text, textAlign, maxLines = 1)
    }
}

private fun liveDescription(live: RunLive?, unit: WeightUnit): String =
    if (live == null) "Waiting for the first position" else "${distanceText(live.distM, unit)} ${if (unit == WeightUnit.Kg) "kilometres" else "miles"}, ${spokenDuration(live.elapsedSec)}"

// ---- Summary ----

@Composable
private fun RunSummary(state: RunState.Finished, unit: WeightUnit, onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val c = Qala.colors
    val run = state.result
    var effort by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    val hr = run.points.mapNotNull { it.hr }.takeIf { it.isNotEmpty() }?.average()
    val fastest = run.splits.filter { it.distM > 0 }.minOfOrNull { it.sec / it.distM * unitM(unit) }
    WashPage(
        scroll = rememberScrollState(),
        scrim = WashScrim.Board3,
        head = { ScreenHead(state.run.title, eyebrow = "Run done") },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(26.dp)) {
            val figures = listOf(
                elapsedText(state.elapsedSec) to "time",
                distanceText(run.distanceM, unit) to (if (unit == WeightUnit.Kg) "km" else "miles"),
                paceText(run.avgSpeedMps.takeIf { it > 0 }?.let { 1.0 / it }, unit) to "avg pace",
                elapsedText(run.movingSec) to "moving",
                (hr?.let { it.toInt().toString() } ?: "—") to "avg HR",
                paceText(fastest?.div(unitM(unit)), unit) to "fastest split",
            )
            Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                figures.chunked(3).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        row.forEach { (value, label) -> WashFigure(label, value, 30, Modifier.weight(1f)) }
                    }
                }
            }
            if (run.points.size >= 2) {
                ChartCard(
                    title = "Pace, heart rate and elevation",
                    summary = "Pace, heart rate and elevation along the run. Average pace ${paceText(run.avgSpeedMps.takeIf { it > 0 }?.let { 1.0 / it }, unit)} per ${distanceUnit(unit)}" +
                        (hr?.let { ", average heart rate ${it.toInt()}" } ?: "") + ".",
                    table = seriesTable(run.points, unit),
                    surface = ChartSurface.Wash,
                ) { RunSeries(run.points, unit) }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Splits(run, unit)
                WashCard {
                    QalaText("How hard was it?", style = QalaType.cardTitle, color = c.fg)
                    Box(Modifier.padding(top = 12.dp)) {
                        ScalePicker(
                            labels = (0..10).map { it.toString() },
                            selected = effort,
                            onPick = { effort = it },
                            groupLabel = "Run effort, 0 rest to 10 max",
                        )
                    }
                    Box(Modifier.padding(top = 16.dp)) {
                        PrimaryButton(
                            "Save run",
                            {
                                busy = true
                                // The container's scope: saving swaps this screen out, which would cancel a coroutine of the screen's own before it went back.
                                container.scope.launch {
                                    container.runRecording.save(effort?.toDouble())
                                    onBack()
                                }
                            },
                            Modifier.fillMaxWidth(),
                            large = true,
                            enabled = !busy,
                        )
                    }
                }
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                LinkButton("Discard run", { container.scope.launch { container.runRecording.discard(); onBack() } }, color = Wash.Text)
            }
        }
    }
}

/** The run series as rows for the Table view: ten points along the run, each with its time, pace, heart rate and elevation. */
private fun seriesTable(points: List<com.qala.data.core.RunPoint>, unit: WeightUnit): List<Pair<String, String>> {
    val start = points.first().t
    return (0..9).map { k ->
        val p = points[(k * (points.size - 1)) / 9]
        elapsedText(p.t - start) to listOfNotNull(
            paceText(p.speedMps.takeIf { it > 0.3 }?.let { 1.0 / it }, unit),
            p.hr?.let { "${it.toInt()} bpm" },
            p.ele?.let { "${it.toInt()} m" },
        ).joinToString(" · ")
    }
}

/** The splits as a card on the wash: the split, its distance, its pace and its average heart rate, in columns. */
@Composable
private fun Splits(run: ProcessedRun, unit: WeightUnit) {
    if (run.splits.isEmpty()) return
    val c = Qala.colors
    WashCard {
        GroupLabel("Splits")
        run.splits.forEach { s ->
            val pace = if (s.distM > 0) s.sec / s.distM * unitM(unit) else null
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.Bottom) {
                QalaText("${s.index}", Modifier.width(28.dp), QalaType.log, c.fgMuted)
                QalaText(distanceText(s.distM, unit), Modifier.width(64.dp), QalaType.log, c.fgMuted)
                QalaText(paceText(pace?.div(unitM(unit)), unit) + " / " + distanceUnit(unit), Modifier.weight(1f), QalaType.log, c.fg)
                QalaText(s.hrAvg?.let { it.toInt().toString() } ?: "", Modifier.width(40.dp), QalaType.log, c.fgMuted, TextAlign.End)
            }
        }
    }
}

// ---- numbers as text ----


/** Two decimals in the lifter's distance unit: "3.07". */
fun distanceText(meters: Double, unit: WeightUnit): String = "%.2f".format(java.util.Locale.US, meters / unitM(unit))

private fun distanceIn(unit: WeightUnit, meters: Double) = com.qala.app.today.distanceIn(unit, meters)

/** "9:12": seconds per metre as minutes and seconds per mile (or kilometre); a dash when there is no pace yet. */
fun paceText(secPerM: Double?, unit: WeightUnit): String {
    if (secPerM == null || !secPerM.isFinite() || secPerM <= 0) return "—"
    val total = (secPerM * unitM(unit)).toInt()
    return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
}

/** "42:07", or "1:02:07" from an hour. */
fun elapsedText(seconds: Double): String {
    val total = seconds.toInt().coerceAtLeast(0)
    val h = total / 3600
    val m = total % 3600 / 60
    val s = total % 60
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}" else "$m:${s.toString().padStart(2, '0')}"
}
