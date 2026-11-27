package com.qala.app.workout

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.plates.LoadedSleeve
import com.qala.data.core.AutoregAction
import com.qala.data.core.AutoregWhy
import com.qala.data.core.PlateEntry
import com.qala.data.model.WeightUnit
import com.qala.design.FlowBottomBar
import com.qala.design.FlowRail
import com.qala.design.GlassButton
import com.qala.design.GroupLabel
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.SecondaryButton
import com.qala.design.Wash
import com.qala.design.WashCard

/**
 * Rest (DESIGN 7.6, DECISIONS U18): the countdown is the screen. A ticking figure in the hero numeral face, the rest it
 * is counting off, a bar that runs down, then the next set, and the ledger of why the rest is as long as it is. Ready
 * early is the one primary (it reads "Start set 3" once the time is up) and +30 s lengthens the rest. Going back, or
 * starting the set, returns to the workout, which is already on the next set.
 *
 * The countdown's warning and end are not this screen's: the shell answers them from any screen (S45), and at zero it moves to the
 * workout and leaves the rest open, so this screen shows the time past the end ("+0:12") until the next set is logged.
 *
 * The next set's plates come from the running rest ([RestState.perSide] and [RestState.plateInstruction], computed by the
 * store off the main thread from the Rust plate math on the bar and plates in Settings): the loaded sleeve with the per-side
 * numbers beneath it, and the change from what is on the bar ("take off 5, add 25 each side"). They are absent for a lift with no
 * plates, until the plate math has answered, and when Settings hides plates.
 */
@Composable
fun RestScreen(onBack: () -> Unit, onAllExercises: () -> Unit) {
    val container = LocalAppContainer.current
    val store = container.workout
    val all by store.state.collectAsState()
    val state = all
    val rest = state?.rest
    // No rest to show (the workout was finished, or the rest ended): back to the workout. After a killed process the stored
    // draft has to be taken up first, or the empty state of a cold start would send a tapped notification straight back.
    val loaded by produceState(false, store) { store.awaitLoaded(); value = true }
    LaunchedEffect(loaded, rest == null) { if (loaded && rest == null) onBack() }
    if (state == null || rest == null) return

    KeepScreenOn()
    val c = Qala.colors
    val now by rememberNow(container.env.clock, rest.startedAtMs)
    val timer = rest.timer
    val remaining = timer.remainingSec(now)
    val up = timer.isUp(now)

    val gym by store.gym.collectAsState()
    val from = state.restLogged()
    val next = state.restNext()
    val plates = next?.let { restPlatesView(gym.rest.showPlates, rest, it) }
    val ready = { store.endRest() }            // the workout is already on the next set; ending the rest keeps what was taken and drops its alarm, and with no rest left this screen goes back

    Column(Modifier.fillMaxSize()) {
        WashHead(
            title = "Rest",
            kicker = from?.let { "${it.exerciseName} · ${if (it.warmup) "warm-up set" else "set"} ${it.setNumber} ${if (it.warmup) "done" else "logged"}" },
            onBack = onBack,
            modifier = Modifier.statusBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp),
        ) {
            GlassButton(onAllExercises, icon = QalaIcons.LayoutGrid, description = "All exercises")
        }
        Row(Modifier.weight(1f).fillMaxWidth()) {
            // A display here: choosing another exercise in the middle of a rest is for the workout, one tap back.
            FlowRail(flowNodes(state, hourglass = true), Modifier.fillMaxHeight().padding(top = 12.dp))
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState())
                    .padding(end = 16.dp, top = 12.dp, bottom = 16.dp),
            ) {
                if (from != null) {
                    val logged = (if (from.weight != null) "${formatWeight(from.weight)} ${unitLabel(from.unit)} × " else if (from.warmup) "Bar × " else "") + formatWeight(from.reps) + (from.rpe?.let { " @ ${formatWeight(it)}" } ?: "")
                    QalaText(logged, style = Wash.Body.copy(fontSize = 13.sp, lineHeight = 18.sp), color = Wash.Text2)
                }
                QalaText(
                    // Past the end the rest is still open, counting what is taken on top of what was asked.
                    if (up) "+${formatClock(timer.overSec(now))}" else formatClock(remaining),
                    Modifier
                        .padding(top = 2.dp)
                        .semantics {
                            contentDescription = if (up) "Rest is over, ${timer.overSec(now)} seconds past" else "${remaining / 60} minutes ${remaining % 60} seconds left"
                        },
                    QalaType.ticking.copy(fontSize = 104.sp, lineHeight = 96.sp, shadow = Wash.TextShadow),
                    if (up) Wash.Ember else Wash.Text,
                    maxLines = 1,
                )
                QalaText("of ${formatClock(timer.budgetSec)}", Modifier.padding(top = 6.dp), Wash.Kicker, Wash.Text2)
                Box(
                    Modifier
                        .padding(top = 10.dp)
                        .fillMaxWidth()
                        .height(12.dp)
                        .background(Color.White.copy(alpha = 0.28f), RoundedCornerShape(6.dp))
                        .semantics { progressBarRangeInfo = ProgressBarRangeInfo(remaining.toFloat(), 0f..timer.budgetSec.toFloat().coerceAtLeast(1f)) },
                ) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(timer.fraction(now)).background(Wash.Ember, RoundedCornerShape(6.dp)))
                }

                if (next != null) {
                    WashCard(Modifier.padding(top = 16.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                            GroupLabel(if (next.newExercise) "Next · ${next.exerciseName}" else "Next · set ${next.setNumber}", Modifier.weight(1f, fill = false))
                            QalaText(
                                (if (next.weight != null) "${formatWeight(next.weight)} ${unitLabel(next.unit)} × " else "") + next.reps,
                                Modifier.padding(start = 8.dp),
                                QalaType.figure.copy(fontSize = 22.sp, lineHeight = 28.sp),
                                c.fg,
                                maxLines = 1,
                            )
                        }
                        if (next.newExercise) QalaText("Set ${next.setNumber} of ${next.setCount}", Modifier.padding(top = 2.dp), QalaType.hint, c.fgMuted)
                        if (plates?.perSide != null) PerSide(plates.perSide, gym.plates.plates)
                        // A weight the plates cannot make says what they do make, as the set rows do ("loads 205").
                        plates?.loadsNote?.let {
                            QalaText(it, Modifier.fillMaxWidth().padding(top = 6.dp), QalaType.hint, c.fgMuted, TextAlign.Center)
                        }
                        plates?.changeLine?.let { QalaText(it, Modifier.padding(top = 8.dp), QalaType.hint, c.fgMuted) }
                    }
                } else {
                    QalaText("That was the last set.", Modifier.padding(top = 16.dp), Wash.Body, Wash.Text2)
                }

                rest.autoreg?.let { AutoregCard(it, next?.unit ?: WeightUnit.Lb, Modifier.padding(top = 12.dp)) }
                Ledger(rest, Modifier.padding(top = 12.dp))
            }
        }
        FlowBottomBar(onWash = true) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                SecondaryButton("+30 s", { store.addRest(30) }, Modifier.weight(0.45f))
                PrimaryButton(
                    if (up) (if (next != null) (if (next.newExercise) "Start ${next.exerciseName}" else "Start set ${next.setNumber}") else "Done") else "Ready early",
                    ready,
                    Modifier.weight(1f),
                    large = true,
                )
            }
        }
    }
}

/** What goes on each side for the next set: the loaded sleeve, then the numbers of its plates. */
@Composable
private fun PerSide(perSide: List<Double>, inventory: List<PlateEntry>) {
    val c = Qala.colors
    Column(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        LoadedSleeve(perSide, inventory, Modifier.fillMaxWidth(), 110.dp)
        GroupLabel("Per side", Modifier.padding(top = 6.dp))
        QalaText(if (perSide.isEmpty()) "bar only" else perSide.joinToString(" · ") { formatWeight(it) }, Modifier.padding(top = 2.dp), QalaType.log, c.fgSecondary)
    }
}

/** What a grind did to the sets still to come, in words (S47). */
@Composable
private fun AutoregCard(note: AutoregNote, unit: WeightUnit, modifier: Modifier) {
    val c = Qala.colors
    val why = if (note.why == AutoregWhy.CapOverflow) "the rest would have run past its limit" else "that was the second grind in a row"
    val words = when (note.action) {
        AutoregAction.DropRemaining -> "Dropped ${setsLeft(note.sets)} left of this lift, since $why."
        AutoregAction.Lower -> "Lowered ${setsLeft(note.sets)} left of this lift by ${note.percent}%" +
            (note.weight?.let { ", the next to ${formatWeight(it)} ${unitLabel(unit)}" } ?: "") + ", since $why."
    }
    WashCard(modifier) {
        GroupLabel("Load adjusted")
        QalaText(words, Modifier.padding(top = 4.dp), QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp), c.fgSecondary)
    }
}

private fun setsLeft(n: Int) = if (n == 1) "the 1 set" else "the $n sets"

/** "Why 3:00": the base and each adjustment in signed seconds, then the rest (DECISIONS U18). */
@Composable
private fun Ledger(rest: RestState, modifier: Modifier) {
    val c = Qala.colors
    WashCard(modifier) {
        val planned = rest.rows.sumOf { it.seconds }
        val added = rest.seconds - planned
        GroupLabel("Why ${formatClock(rest.seconds)}", Modifier.padding(bottom = 4.dp))
        rest.rows.forEachIndexed { i, row ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp)
                    .semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                QalaText(row.label, Modifier.weight(1f).padding(end = 12.dp), QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp), if (row.atMax) c.fgMuted else c.fgSecondary)
                if (row.atMax) {
                    // Past the cap: it asked for time that did not fit, so it counts for nothing and has no sign.
                    QalaText("at max", style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgMuted, maxLines = 1)
                } else if (i == 0) {
                    QalaText(formatClock(row.seconds), style = QalaType.log, color = c.fg, maxLines = 1)
                } else {
                    QalaText(formatSigned(row.seconds), style = QalaType.log, color = if (row.seconds > 0) c.accent else c.progress, maxLines = 1)
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
        }
        if (added != 0) {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                QalaText("Time you added", Modifier.weight(1f).padding(end = 12.dp), QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp), c.fgSecondary)
                QalaText(formatSigned(added), style = QalaType.log, color = if (added > 0) c.accent else c.progress, maxLines = 1)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            QalaText("Rest", style = QalaType.bodyStrong, color = c.fg)
            QalaText(formatClock(rest.seconds), style = QalaType.log.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = c.fg)
        }
    }
}
