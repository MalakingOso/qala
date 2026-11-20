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
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.semantics.contentDescription
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
 * The warm-up (DESIGN 7.4, DECISIONS T6, S46): three numbered steps, easy cardio with a countdown, soft tissue with the owner's
 * tools (their Blender renders, never drawn) and dynamic mobility. The ramp sets are not here: they sit above the sets of each
 * exercise in the workout, where they are ticked. Soft tissue and mobility are check rows, and the countdown runs on the
 * clock, so all of it is kept in the workout draft, opened by the first action here (looking opens nothing), and survives
 * leaving the screen. Start workout marks the warm-up stage done, as the stub's Mark done did, and goes to the workout; Skip goes
 * there without a mark, and Back leaves with nothing recorded.
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
    val state by container.workout.state.collectAsState()
    val draft = state?.takeIf { it.day == day }
    val ticked = remember(draft?.warmupTicked) { draft?.warmupTicked.orEmpty().toSet() }
    // The container's scope, not the screen's: a tick that opens the draft must not be cancelled by leaving the screen.
    val flip = { id: String -> if (day != null) container.scope.launch { container.workout.flipWarmup(day, id) } }

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
                    GroupLabel(
                        if (ready != null) "Before ${ready.dayName} · ${if (ready.blocksOff) "ramp sets only" else "${ready.plan.minutes} min"}" else "Before the lift",
                        Modifier.padding(bottom = 2.dp),
                    )
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
                is WarmupLoad.Ready -> WarmupSteps(
                    ready!!, ticked, flip, draft?.cardio,
                    onCardio = { seconds -> if (day != null) container.scope.launch { container.workout.startCardio(day, seconds) } },
                    onAddCardio = container.workout::addCardio,
                )
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
private fun WarmupSteps(view: WarmupView, ticked: Set<String>, flip: (String) -> Unit, cardio: RestTimer?, onCardio: (Int) -> Unit, onAddCardio: (Int) -> Unit) {
    val plan = view.plan
    val c = Qala.colors
    var n = 0

    if (view.blocksOff) {
        QalaText("Your warm-up is off in Settings, so there is no cardio, soft tissue or mobility. The ramp sets stay, above the sets in the workout.", Modifier.padding(horizontal = 4.dp), QalaType.hint, c.fgMuted)
    }

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
            CardioCountdown(general.minutes * 60, cardio, onCardio, onAddCardio)
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
 * The cardio countdown: the planner's minutes with -1 and +1 before it starts, the clock once it has, and the same two buttons while
 * it runs. It counts from the moment it was started, so leaving the screen and coming back finds it where it is; at zero the shell
 * buzzes, and this says it is done.
 */
@Composable
private fun CardioCountdown(plannedSec: Int, timer: RestTimer?, onStart: (Int) -> Unit, onAdd: (Int) -> Unit) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    var chosen by rememberSaveable(plannedSec) { mutableStateOf(plannedSec) }
    val now by rememberNow(container.env.clock, timer?.startedAtMs ?: 0L)
    val running = timer != null
    val remaining = timer?.remainingSec(now) ?: chosen
    val over = running && timer!!.isUp(now)
    val adjust = { delta: Int -> if (running) onAdd(delta) else chosen = (chosen + delta).coerceAtLeast(MinCardioSec) }
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        SecondaryButton("-1 min", { adjust(-60) }, Modifier.semantics { contentDescription = "One minute less cardio" }, small = true, enabled = (timer?.budgetSec ?: chosen) > MinCardioSec)
        QalaText(
            if (over) "Done" else formatClock(remaining),
            Modifier.weight(1f).semantics { contentDescription = if (over) "Cardio is done" else "${remaining / 60} minutes ${remaining % 60} seconds of cardio left" },
            QalaType.ticking.copy(fontSize = 34.sp, lineHeight = 40.sp),
            if (over) c.accent else c.fg,
            androidx.compose.ui.text.style.TextAlign.Center,
            maxLines = 1,
        )
        SecondaryButton("+1 min", { adjust(60) }, Modifier.semantics { contentDescription = "One minute more cardio" }, small = true)
    }
    if (!running) {
        PrimaryButton("Start cardio", { onStart(chosen) }, Modifier.fillMaxWidth().padding(top = 8.dp), icon = QalaIcons.Bike)
    }
}
