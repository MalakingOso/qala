package com.qala.app.workout

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.data.repo.StubStage
import com.qala.design.FlowBottomBar
import com.qala.design.GearImage
import com.qala.design.GlassButton
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaGear
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.RailStepRow
import com.qala.design.RailWidth
import com.qala.design.StageDotState
import com.qala.design.Wash
import com.qala.design.WashCard
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
        val ready = (load as? WarmupLoad.Ready)?.view
        WashHead(
            title = "Warm-up",
            kicker = if (ready != null) "Before ${ready.dayName} · ${if (ready.blocksOff) "ramp sets only" else "${ready.plan.minutes} min"}" else "Before the lift",
            onBack = onBack,
            modifier = Modifier.statusBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp),
        ) {
            if (ready != null) {
                GlassButton(onAllExercises, icon = QalaIcons.LayoutGrid, description = "All exercises")
                GlassButton(onSkip, label = "Skip")
            }
        }
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(top = 16.dp, bottom = 16.dp),
        ) {
            when (load) {
                WarmupLoad.Loading -> WashNote("Getting your warm-up ready.")
                WarmupLoad.Empty -> WashNote("Nothing to lift today, so there is nothing to warm up for.")
                is WarmupLoad.Ready -> WarmupSteps(
                    ready!!, ticked, flip, draft?.cardio,
                    onCardio = { seconds -> if (day != null) container.scope.launch { container.workout.startCardio(day, seconds) } },
                    onAddCardio = container.workout::addCardio,
                )
            }
        }
        if (load is WarmupLoad.Ready) {
            FlowBottomBar(onWash = true) {
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

/** A line of white text on the wash, in the content column to the right of the rail. */
@Composable
private fun WashNote(text: String) {
    QalaText(text, Modifier.padding(start = RailWidth, end = 16.dp), Wash.Body, Wash.Text2)
}

/** Which step of the warm-up a row is, and whether the lifter has finished it. */
private class WarmupStep(val kind: BlockKind, val block: WarmupBlock, val done: Boolean)

@Composable
private fun WarmupSteps(view: WarmupView, ticked: Set<String>, flip: (String) -> Unit, cardio: RestTimer?, onCardio: (Int) -> Unit, onAddCardio: (Int) -> Unit) {
    val plan = view.plan
    val container = LocalAppContainer.current
    val now by rememberNow(container.env.clock, cardio?.startedAtMs ?: 0L)

    if (view.blocksOff) {
        WashNote("Your warm-up is off in Settings, so there is no cardio, soft tissue or mobility. The ramp sets stay, above the sets in the workout.")
    }

    // The steps in the order of the page; the first one not done is the open one, and the lift is open once they all are.
    val steps = listOf(BlockKind.General, BlockKind.SoftTissue, BlockKind.Mobility).mapNotNull { kind ->
        plan.block(kind)?.let { block ->
            val done = if (kind == BlockKind.General) cardio != null && cardio.isUp(now) else block.items.isNotEmpty() && block.items.all { it.id in ticked }
            WarmupStep(kind, block, done)
        }
    }
    val open = steps.indexOfFirst { !it.done }
    fun stateOf(i: Int) = if (steps[i].done) StageDotState.Done else if (i == open) StageDotState.Now else StageDotState.Later

    steps.forEachIndexed { i, step ->
        RailStepRow(
            state = stateOf(i),
            above = if (i == 0) null else stateOf(i - 1),
            last = false,
            nodeY = if (step.kind == BlockKind.General) 40.dp else 28.dp,
            text = if (step.kind == BlockKind.General) null else "${i + 1}",
            icon = if (step.kind == BlockKind.General) QalaIcons.Bike else null,
        ) {
            Box(Modifier.padding(end = 16.dp, bottom = 14.dp)) {
                when (step.kind) {
                    BlockKind.General -> CardioHero(step.block, steps.size, plannedSec = step.block.minutes * 60, cardio, onCardio, onAddCardio)
                    BlockKind.SoftTissue -> WarmupCard("Soft tissue", "${step.block.minutes} min") {
                        step.block.items.forEachIndexed { n, item ->
                            CheckRow(
                                done = item.id in ticked,
                                onFlip = { flip(item.id) },
                                divider = n > 0,
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
                    BlockKind.Mobility -> WarmupCard("Mobility", "${step.block.minutes} min") {
                        step.block.items.forEachIndexed { n, item -> CheckRow(item.id in ticked, { flip(item.id) }, n > 0, item.title, item.detail) }
                    }
                }
            }
        }
    }
    RailStepRow(
        state = if (open < 0) StageDotState.Now else StageDotState.Later,
        above = steps.lastIndex.takeIf { it >= 0 }?.let { stateOf(it) },
        last = true,
        nodeY = 14.dp,
        icon = QalaIcons.Dumbbell,
        label = "Lift",
    ) {
        Box(Modifier.padding(end = 16.dp).heightIn(min = 44.dp)) {
            QalaText("* A coach-practice rule, not a study prescription.", Modifier.padding(top = 2.dp), QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 16.sp, shadow = Wash.TextShadow), Wash.Text2)
        }
    }
}

/** The first step on the wash, not on a card: the kicker in ember, the clock, its two buttons, and what the cardio is. */
@Composable
private fun CardioHero(block: WarmupBlock, count: Int, plannedSec: Int, cardio: RestTimer?, onStart: (Int) -> Unit, onAdd: (Int) -> Unit) {
    Column {
        QalaText("STEP 1 OF $count · EASY CARDIO", style = Wash.Kicker, color = Wash.Ember)
        CardioCountdown(plannedSec, cardio, onStart, onAdd)
        block.items.forEach { item ->
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                QalaIcon(QalaIcons.Bike, null, Modifier.padding(top = 2.dp), size = 18.dp, tint = Wash.Text2)
                Column(Modifier.weight(1f)) {
                    QalaText(item.title, style = Wash.Body.copy(fontWeight = FontWeight.Medium), color = Wash.Text)
                    QalaText(item.detail, style = Wash.Body, color = Wash.Text2)
                }
            }
        }
    }
}

/** A white card on the wash for a step with rows to tick: its title, the time it takes, then the rows. */
@Composable
private fun WarmupCard(title: String, time: String, content: @Composable () -> Unit) {
    val c = Qala.colors
    WashCard {
        Row(Modifier.fillMaxWidth().padding(bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            QalaText(title, Modifier.weight(1f).semantics { heading() }, QalaType.cardTitle, c.fg)
            QalaText(time, style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.fgMuted, maxLines = 1)
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
    val container = LocalAppContainer.current
    var chosen by rememberSaveable(plannedSec) { mutableStateOf(plannedSec) }
    val now by rememberNow(container.env.clock, timer?.startedAtMs ?: 0L)
    val running = timer != null
    val remaining = timer?.remainingSec(now) ?: chosen
    val over = running && timer!!.isUp(now)
    val adjust = { delta: Int -> if (running) onAdd(delta) else chosen = (chosen + delta).coerceAtLeast(MinCardioSec) }
    QalaText(
        if (over) "Done" else formatClock(remaining),
        Modifier
            .padding(top = 6.dp)
            .semantics { contentDescription = if (over) "Cardio is done" else "${remaining / 60} minutes ${remaining % 60} seconds of cardio left" },
        QalaType.ticking.copy(fontSize = 100.sp, lineHeight = 92.sp, shadow = Wash.TextShadow),
        if (over) Wash.Ember else Wash.Text,
        maxLines = 1,
    )
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        GlassButton({ adjust(-60) }, Modifier.semantics { contentDescription = "One minute less cardio" }, label = "-1 min", enabled = (timer?.budgetSec ?: chosen) > MinCardioSec)
        GlassButton({ adjust(60) }, Modifier.semantics { contentDescription = "One minute more cardio" }, label = "+1 min")
        QalaText("of ${formatClock(timer?.budgetSec ?: chosen)}", Modifier.padding(start = 2.dp), Wash.Kicker, Wash.Text2, maxLines = 1)
    }
    if (!running) {
        PrimaryButton("Start cardio", { onStart(chosen) }, Modifier.fillMaxWidth().padding(top = 10.dp), icon = QalaIcons.Bike)
    }
}
