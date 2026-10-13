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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.data.model.WeightUnit
import com.qala.design.Card
import com.qala.design.FlowBottomBar
import com.qala.design.FlowHead
import com.qala.design.FlowIconButton
import com.qala.design.GroupLabel
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.SecondaryButton

/**
 * Rest (DESIGN 7.6, DECISIONS U18): the countdown is the screen. A ticking figure in the hero numeral face, the rest it
 * is counting off, a bar that runs down, then the next set, and the ledger of why the rest is as long as it is. Ready
 * early is the one primary (it reads "Start set 3" once the time is up) and +30 s lengthens the rest. Going back, or
 * starting the set, returns to the workout, which is already on the next set.
 *
 * The next set's plates come from the running rest ([RestState.perSide] and [RestState.plateInstruction], computed by the
 * store off the main thread from the Rust plate math): what goes on each side, heaviest first, and the change from
 * what is on the bar ("take off 5, add 25 each side"). They are absent for a lift with no plates, and until the plate
 * math has answered. A plate shows as its weight; the sprites are not drawn here.
 */
@Composable
fun RestScreen(onBack: () -> Unit, onAllExercises: () -> Unit) {
    val container = LocalAppContainer.current
    val store = container.workout
    val all by store.state.collectAsState()
    val state = all
    val rest = state?.rest
    // No rest to show (the process was killed after the rest ended, or the workout was finished): back to the workout.
    LaunchedEffect(rest == null) { if (rest == null) onBack() }
    if (state == null || rest == null) return

    KeepScreenOn()
    val c = Qala.colors
    val now by rememberNow(container.env.clock, rest.startedAtMs)
    val timer = rest.timer
    val remaining = timer.remainingSec(now)
    val up = timer.isUp(now)
    val haptic = LocalHapticFeedback.current
    val buzz = rememberUpdatedState { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    LaunchedEffect(up, rest.startedAtMs) { if (up && timer.budgetSec > 0 && now - rest.startedAtMs < (timer.budgetSec + 5) * 1000L) buzz.value() }

    val from = state.restLogged()
    val next = state.restNext()
    val perSide = rest.perSide
    val plateInstruction = rest.plateInstruction
    val ready = onBack            // the workout is already on the next set; a rest left behind is replaced by the next one

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                FlowHead("Rest", onBack, Modifier.weight(1f), eyebrow = from?.let { "${it.exerciseName} · set ${it.setNumber} logged" })
                FlowIconButton(QalaIcons.LayoutGrid, "All exercises", onAllExercises)
            }

            Card(hero = true) {
                if (from != null) {
                    val logged = (if (from.weight != null) "${formatWeight(from.weight)} ${unitLabel(from.unit)} × " else "") + formatWeight(from.reps) + (from.rpe?.let { " @ ${formatWeight(it)}" } ?: "")
                    QalaText(logged, Modifier.fillMaxWidth(), QalaType.log, c.fgMuted, TextAlign.Center)
                }
                QalaText(
                    formatClock(remaining),
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 4.dp)
                        .semantics {
                            contentDescription = if (up) "Rest is over" else "${remaining / 60} minutes ${remaining % 60} seconds left"
                        },
                    QalaType.ticking.copy(fontSize = 104.sp, lineHeight = 112.sp),
                    if (up) c.accent else c.fg,
                    TextAlign.Center,
                    maxLines = 1,
                )
                QalaText("of ${formatClock(timer.budgetSec)}", Modifier.fillMaxWidth(), QalaType.hint, c.fgMuted, TextAlign.Center)
                Box(
                    Modifier
                        .padding(top = 16.dp)
                        .fillMaxWidth()
                        .height(12.dp)
                        .background(c.grid, RoundedCornerShape(6.dp))
                        .semantics { progressBarRangeInfo = ProgressBarRangeInfo(remaining.toFloat(), 0f..timer.budgetSec.toFloat().coerceAtLeast(1f)) },
                ) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(timer.fraction(now)).background(c.accent, RoundedCornerShape(6.dp)))
                }
            }

            if (next != null) {
                Card(Modifier.padding(top = 12.dp), contentPadding = 16.dp) {
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
                    if (perSide != null) PlateWeights(perSide)
                    // A weight the plates cannot make says what they do make, as the set rows do ("loads 205").
                    plateLoadsNote(next.weight, rest.plateTotal)?.let {
                        QalaText(it, Modifier.fillMaxWidth().padding(top = 6.dp), QalaType.hint, c.fgMuted, TextAlign.Center)
                    }
                    if (plateInstruction != null) QalaText(plateChangeLine(plateInstruction), Modifier.padding(top = 8.dp), QalaType.hint, c.fgMuted)
                    else if (next.sameWeight && perSide != null) QalaText(plateChangeLine("no change"), Modifier.padding(top = 8.dp), QalaType.hint, c.fgMuted)
                }
            } else {
                QalaText("That was the last set.", Modifier.padding(top = 16.dp), QalaType.hint, c.fgMuted)
            }

            Ledger(rest, Modifier.padding(top = 12.dp))
        }
        FlowBottomBar {
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

/** The plates for each side as the weights they are, heaviest first: the placeholder until the plate sprites exist. */
@Composable
private fun PlateWeights(perSide: List<Double>) {
    val c = Qala.colors
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        GroupLabel("Per side", Modifier.padding(end = 4.dp))
        if (perSide.isEmpty()) {
            QalaText("bar only", style = QalaType.log, color = c.fgSecondary)
        } else {
            perSide.forEach { w ->
                QalaText(
                    formatWeight(w),
                    Modifier.border(QalaTokens.borderWidth, c.borderStrong, RoundedCornerShape(QalaTokens.radius)).padding(horizontal = 10.dp, vertical = 8.dp),
                    QalaType.log.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium),
                    c.fg,
                    maxLines = 1,
                )
            }
        }
    }
}

/** "Why 3:00": the base and each adjustment in signed seconds, then the rest (DECISIONS U18). */
@Composable
private fun Ledger(rest: RestState, modifier: Modifier) {
    val c = Qala.colors
    Card(modifier, contentPadding = 16.dp) {
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
                QalaText(row.label, Modifier.weight(1f).padding(end = 12.dp), QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp), c.fgSecondary)
                if (i == 0) {
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
