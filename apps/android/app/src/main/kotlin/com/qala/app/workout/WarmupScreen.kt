package com.qala.app.workout

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.data.model.WeightUnit
import com.qala.data.repo.StubStage
import com.qala.design.Card
import com.qala.design.FlowBottomBar
import com.qala.design.FlowIconButton
import com.qala.design.GearImage
import com.qala.design.GroupLabel
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaGear
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.SecondaryButton
import kotlinx.coroutines.launch

private sealed interface WarmupLoad {
    data object Loading : WarmupLoad
    data object Empty : WarmupLoad
    class Ready(val view: WarmupView) : WarmupLoad
}

/**
 * The warm-up (DESIGN 7.4, DECISIONS T6): four numbered steps, easy cardio, soft tissue with the owner's tools (their
 * Blender renders, never drawn), dynamic mobility, then ramp sets worked out from each exercise's working weight.
 * Soft tissue and mobility are check rows. Start workout marks the warm-up stage done, as the stub's Mark done did, and
 * goes to the workout; Skip goes there without a mark, and Back leaves with nothing recorded.
 *
 * [onStart] and [onSkip] push the workout; [onAllExercises] pushes the grid of the day's exercises. [day] is today's
 * program day, null while Today is still loading.
 */
@Composable
fun WarmupScreen(day: Int?, onBack: () -> Unit, onStart: () -> Unit, onSkip: () -> Unit, onAllExercises: () -> Unit) {
    val container = LocalAppContainer.current
    var load by remember { mutableStateOf<WarmupLoad>(WarmupLoad.Loading) }
    LaunchedEffect(day) {
        if (day != null) load = container.workout.warmup(day)?.let { WarmupLoad.Ready(it) } ?: WarmupLoad.Empty
    }
    val c = Qala.colors
    var checked by rememberSaveable { mutableStateOf("") }          // ids of the rows ticked, comma separated
    val ticked = remember(checked) { checked.split(',').filter { it.isNotEmpty() }.toSet() }
    val flip = { id: String -> checked = (if (id in ticked) ticked - id else ticked + id).joinToString(",") }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val ready = (load as? WarmupLoad.Ready)?.view
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                FlowIconButton(QalaIcons.ChevronLeft, "Back", onBack)
                Column(Modifier.weight(1f).padding(top = 2.dp)) {
                    GroupLabel(if (ready != null) "Before ${ready.dayName} · ${ready.plan.minutes} min" else "Before the lift", Modifier.padding(bottom = 2.dp))
                    QalaText("Warm-up", Modifier.semantics { heading() }, QalaType.stageTitle, c.fg)
                }
                if (ready != null) {
                    FlowIconButton(QalaIcons.LayoutGrid, "All exercises", onAllExercises)
                    SecondaryButton("Skip", onSkip, Modifier.padding(top = 2.dp), small = true)
                }
            }
            when (load) {
                WarmupLoad.Loading -> QalaText("Getting your warm-up ready.", style = QalaType.hint, color = c.fgMuted)
                WarmupLoad.Empty -> QalaText("Nothing to lift today, so there is nothing to warm up for.", style = QalaType.hint, color = c.fgMuted)
                is WarmupLoad.Ready -> WarmupSteps(ready!!, ticked, flip)
            }
        }
        if (load is WarmupLoad.Ready) {
            FlowBottomBar {
                PrimaryButton(
                    "Start workout",
                    onClick = {
                        // The container's scope, not the screen's: going on leaves this screen, and the record must not be cancelled half way.
                        container.scope.launch { container.sessions.markStageDone(StubStage.WARM_UP, day) }
                        onStart()
                    },
                    large = true,
                    icon = QalaIcons.Dumbbell,
                )
            }
        }
    }
}

@Composable
private fun WarmupSteps(view: WarmupView, ticked: Set<String>, flip: (String) -> Unit) {
    val plan = view.plan
    val c = Qala.colors
    var n = 0

    plan.block(BlockKind.General)?.let { general ->
        Step(++n, "Easy cardio", "${general.minutes} min") {
            general.items.forEach { item ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    QalaIcon(QalaIcons.Bike, null, size = 24.dp, tint = c.fg)
                    Column(Modifier.weight(1f)) {
                        QalaText(item.title, style = QalaType.bodyStrong, color = c.fg)
                        QalaText(item.detail, style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgMuted)
                    }
                }
            }
        }
    }
    plan.block(BlockKind.SoftTissue)?.let { tissue ->
        Step(++n, "Soft tissue", "${tissue.minutes} min") {
            tissue.items.forEachIndexed { i, item ->
                CheckRow(
                    done = item.id in ticked,
                    onFlip = { flip(item.id) },
                    divider = i > 0,
                    title = item.title,
                    detail = item.detail,
                    trailing = {
                        val gear = when (item.tool) {
                            SoftTissueTool.FoamRoller -> QalaGear.Roller
                            SoftTissueTool.Percussion -> QalaGear.Theragun
                            null -> null
                        }
                        if (gear != null) GearImage(gear)
                    },
                )
            }
        }
    }
    plan.block(BlockKind.Mobility)?.let { mobility ->
        Step(++n, "Mobility", "${mobility.minutes} min") {
            mobility.items.forEachIndexed { i, item ->
                CheckRow(item.id in ticked, { flip(item.id) }, i > 0, item.title, item.detail)
            }
        }
    }
    Step(++n, "Ramp sets", "up to the work sets") {
        val shown = plan.ramps.filter { it.workWeight != null }
        if (shown.isEmpty()) QalaText("Bodyweight work today: no ramp, just start easy.", style = QalaType.hint, color = c.fgMuted)
        shown.forEachIndexed { i, ramp ->
            Column(Modifier.fillMaxWidth().padding(top = if (i > 0) 14.dp else 0.dp)) {
                Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                    QalaText(ramp.name, style = QalaType.bodyStrong, color = c.fg, maxLines = 1, modifier = Modifier.weight(1f))
                    QalaText("work: ${formatWeight(ramp.workWeight!!)} ${unitLabel(view.unit)} × ${ramp.workReps}", style = QalaType.log.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgMuted, maxLines = 1)
                }
                if (ramp.steps.isEmpty()) QalaText("No ramp needed: it is light.", style = QalaType.hint, color = c.fgMuted)
                ramp.steps.forEach { step ->
                    val hint = if (ramp.barbell && !step.bar) view.plateHints[step.load] else null
                    RampRow(step, view.unit, plateShorthand = hint?.let { plateLine(step.load, it) })
                }
            }
        }
    }
    QalaText("* A coach-practice rule, not a study prescription.", Modifier.padding(horizontal = 4.dp), QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 16.sp), c.fgMuted)
}

/** A numbered step card: the number, the title and the time it takes, then its rows. */
@Composable
private fun Step(number: Int, title: String, time: String, content: @Composable () -> Unit) {
    val c = Qala.colors
    Card(hero = true, contentPadding = 14.dp) {
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(28.dp).background(c.fg, CircleShape), contentAlignment = Alignment.Center) {
                QalaText("$number", style = QalaType.button.copy(fontSize = 13.sp, lineHeight = 15.sp), color = c.bgSurface)
            }
            QalaText(title, Modifier.weight(1f).semantics { heading() }, QalaType.cardTitle, c.fg)
            QalaText(time, style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 16.sp), color = c.fgMuted, maxLines = 1)
        }
        content()
    }
}

/** A row you tick off: a 24 dp box, the drill or the muscle, what it is for, and an optional picture at the end. */
@Composable
private fun CheckRow(
    done: Boolean,
    onFlip: () -> Unit,
    divider: Boolean,
    title: String,
    detail: String,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = Qala.colors
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 56.dp)
            .drawBehind { if (divider) drawRect(c.border, Offset.Zero, Size(size.width, 1.dp.toPx())) }
            .toggleable(value = done, role = Role.Checkbox, onValueChange = { onFlip() })
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(24.dp)
                .background(if (done) c.progressFill else Color.Transparent, RoundedCornerShape(QalaTokens.radius))
                .border(QalaTokens.borderWidth, if (done) c.progressFill else c.borderStrong, RoundedCornerShape(QalaTokens.radius)),
            contentAlignment = Alignment.Center,
        ) {
            if (done) QalaIcon(QalaIcons.Check, null, size = 16.dp, tint = Color.White)
        }
        Column(Modifier.weight(1f)) {
            QalaText(title, style = QalaType.bodyStrong, color = if (done) c.fgMuted else c.fg)
            QalaText(detail, style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgMuted)
        }
        trailing?.invoke()
    }
}

/**
 * One ramp step: its weight and reps, the rest after it, and [plateShorthand] ("per side 45 · 45 · 10") under them when
 * the plates work provides it. The step the soreness or a low recovery added is flagged in the accent colour.
 */
@Composable
private fun RampRow(step: RampStep, unit: WeightUnit, plateShorthand: String?) {
    val c = Qala.colors
    Column(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 44.dp)
            .padding(vertical = 6.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            QalaText(
                (if (step.bar) "Bar" else "${formatWeight(step.load)} ${unitLabel(unit)}") + " × ${step.reps}",
                style = QalaType.log.copy(fontSize = 14.sp, lineHeight = 20.sp),
                color = if (step.extra) c.accent else c.fg,
                maxLines = 1,
            )
            QalaText("rest ${formatClock(step.restSec)}", style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 16.sp), color = c.fgMuted, maxLines = 1)
        }
        if (step.extra) QalaText("extra step*", style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.accent)
        if (plateShorthand != null) QalaText(plateShorthand, style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.fgMuted)
    }
}
