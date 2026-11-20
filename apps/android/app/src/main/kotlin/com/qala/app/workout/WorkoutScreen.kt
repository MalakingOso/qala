package com.qala.app.workout

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.plates.LoadedSleeve
import com.qala.app.plates.PlateFace
import com.qala.app.rememberAskForNotifications
import com.qala.data.core.PlateEntry
import com.qala.data.model.WeightUnit
import com.qala.design.Card
import com.qala.design.FlowBottomBar
import com.qala.design.FlowIconButton
import com.qala.design.GroupLabel
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaSheet
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.ScalePicker
import com.qala.design.SecondaryButton
import com.qala.design.Stepper
import kotlinx.coroutines.launch

/** The RPE strip's cells, in half steps (DESIGN 7.5). */
private val RpeValues = listOf(7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0)

/** What an RPE means in reps left in the tank, under the strip once one is picked. */
private fun rpeMeaning(rpe: Double): String = when (rpe) {
    10.0 -> "no reps left"
    9.5 -> "maybe one more rep"
    9.0 -> "one in the tank"
    8.5 -> "one or two in the tank"
    8.0 -> "two in the tank"
    7.5 -> "two or three in the tank"
    else -> "three in the tank"
}

/**
 * The workout (DESIGN 7.5, DECISIONS U5 and U18): one exercise at a time, swiped between or jumped to from the segments
 * or the All exercises grid, each set a row you can tap, the selected one open with weight and reps steppers, the AMRAP flag and
 * the one RPE strip, and Log set pinned under it. Logging opens Rest. The workout itself lives in the container's
 * [com.qala.app.workout.WorkoutStore], so leaving this screen and coming back, or rotating, loses nothing.
 *
 * [day] is today's program day, null while Today is still loading. [onRest] pushes the Rest screen; [onBack] goes to
 * Today, whether the workout was finished or only left.
 */
@Composable
fun WorkoutScreen(day: Int?, onBack: () -> Unit, onRest: () -> Unit, onAllExercises: () -> Unit, onWarmup: () -> Unit = {}, onFinished: () -> Unit = onBack) {
    val container = LocalAppContainer.current
    val store = container.workout
    val all by store.state.collectAsState()
    var opened by remember { mutableStateOf<Opened?>(null) }
    // The first workout asks to be allowed to say when a rest is over while the app is in the background (D34, S46).
    val askForNotifications = rememberAskForNotifications()
    LaunchedEffect(day) {
        if (day != null) {
            opened = store.open(day)
            store.clearSaveError()
            if (opened == Opened.Ready) askForNotifications()
        }
    }
    val state = all?.takeIf { it.day == day }

    KeepScreenOn()
    Column(Modifier.fillMaxSize()) {
        when {
            state != null -> WorkoutBody(state, store, onBack, onRest, onAllExercises, onWarmup, onFinished)
            opened == Opened.NoDay -> Notice("Nothing to lift today", "The program has no exercise for this day.", onBack)
            else -> Notice("Getting your workout ready", null, onBack)
        }
    }
}

@Composable
private fun Notice(title: String, detail: String?, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(16.dp)) {
        FlowIconButton(QalaIcons.ChevronLeft, "Back", onBack)
        Spacer(Modifier.height(20.dp))
        QalaText(title, Modifier.semantics { heading() }, QalaType.stageTitle, Qala.colors.fg)
        if (detail != null) QalaText(detail, Modifier.padding(top = 8.dp), QalaType.hint, Qala.colors.fgMuted)
    }
}

@Composable
private fun WorkoutBody(state: WorkoutState, store: WorkoutStore, onBack: () -> Unit, onRest: () -> Unit, onAllExercises: () -> Unit, onWarmup: () -> Unit, onFinished: () -> Unit) {
    val container = LocalAppContainer.current
    val c = Qala.colors
    var finishOpen by rememberSaveable { mutableStateOf(false) }

    val pager = rememberPagerState(initialPage = state.current) { state.exercises.size }
    // The model is the truth: a jump (Prev, Next, a segment, the next set after a log) moves the pager; a swipe that
    // settles moves the model. Only the settled page is read back, so the two never chase each other.
    LaunchedEffect(state.current) { if (pager.currentPage != state.current) pager.animateScrollToPage(state.current) }
    LaunchedEffect(pager) {
        snapshotFlow { pager.settledPage }.collect { page -> if (page != store.state.value?.current) store.show(page) }
    }

    val now by rememberNow(container.env.clock, state.startedAtMs)
    val plates by store.plateHints.collectAsState()
    val gym by store.gym.collectAsState()
    val saved by store.saved.collectAsState()

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().semantics { if (finishOpen) hideFromAccessibility() }) {
            Column(Modifier.statusBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp)) {
                Header(
                    state = state,
                    elapsedSec = ((now - state.startedAtMs) / 1000).toInt(),
                    onBack = onBack,
                    onAllExercises = onAllExercises,
                    onWarmup = onWarmup,
                    onRest = onRest,
                    onFinish = { finishOpen = true },
                    clock = container.env.clock,
                )
                ExerciseSegments(state) { i -> store.show(i) }
                NeighbourRow(state, onPrev = store::prev, onNext = store::next)
            }
            HorizontalPager(
                state = pager,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                key = { it },
            ) { page ->
                ExercisePage(state, page, store, plates, gym.rest.showPlates, gym.plates.plates, saved, manualRest = !gym.rest.auto, onRest = onRest)
            }
            FlowBottomBar {
                val hint = state.restHint(gym.rest.auto)
                if (hint != null) {
                    Row(Modifier.padding(bottom = 8.dp).fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        // The hourglass is the rest: with automatic rest off there is none to show.
                        if (gym.rest.auto) QalaIcon(QalaIcons.Hourglass, null, size = 14.dp, tint = c.fgMuted)
                        QalaText(hint, Modifier.padding(start = if (gym.rest.auto) 6.dp else 0.dp), QalaType.hint, c.fgMuted, maxLines = 1)
                    }
                }
                PrimaryButton(
                    state.logLabel(),
                    onClick = {
                        if (state.allDone && state.selectedSet?.done == true) {
                            finishOpen = true
                        } else {
                            when (store.log()) {
                                AfterLog.Rest -> onRest()
                                AfterLog.Finish -> finishOpen = true
                                AfterLog.Stay, AfterLog.Next, AfterLog.Saved -> {}
                            }
                        }
                    },
                    large = true,
                    icon = QalaIcons.Check,
                )
            }
        }
        FinishSheet(
            open = finishOpen,
            state = state,
            onClose = { finishOpen = false },
            onFinish = {
                finishOpen = false
                // The container's scope, not the screen's: going back leaves this screen, and a save must not be cancelled half way.
                container.scope.launch { store.finish() }
                onFinished()
            },
            onLeave = {
                finishOpen = false
                store.discard()
                onBack()
            },
        )
    }
}

// ---- head ----

@Composable
private fun Header(
    state: WorkoutState,
    elapsedSec: Int,
    onBack: () -> Unit,
    onAllExercises: () -> Unit,
    onWarmup: () -> Unit,
    onRest: () -> Unit,
    onFinish: () -> Unit,
    clock: com.qala.data.repo.DeviceClock,
) {
    Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        FlowIconButton(QalaIcons.ChevronLeft, "Back", onBack)
        Column(Modifier.weight(1f).padding(start = 2.dp, top = 2.dp)) {
            GroupLabel("${state.programName} · ${state.dayName} · ${formatClock(elapsedSec)} in")
            QalaText("Workout", Modifier.semantics { heading() }, QalaType.stageTitle, Qala.colors.fg, maxLines = 1)
        }
        FlowIconButton(QalaIcons.LayoutGrid, "All exercises", onAllExercises)
        FlowIconButton(QalaIcons.Check, "Finish workout", onFinish)
    }
    // The way back to the warm-up, and the rest that is running: it stays one tap away from every set (S46).
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(bottom = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        SecondaryButton("Warm-up", onWarmup, small = true, icon = QalaIcons.Bike)
        state.rest?.let { RestPill(it, clock, onRest) }
    }
}

/** "Rest 1:42" counting down, then "Rest +0:12" for the time past the end: opens Rest. */
@Composable
private fun RestPill(rest: RestState, clock: com.qala.data.repo.DeviceClock, onClick: () -> Unit) {
    val c = Qala.colors
    val now by rememberNow(clock, rest.startedAtMs)
    val timer = rest.timer
    val over = timer.isUp(now)
    val text = if (over) "Rest +${formatClock(timer.overSec(now))}" else "Rest ${formatClock(timer.remainingSec(now))}"
    Row(
        Modifier
            .heightIn(min = 44.dp)
            .clickable(role = Role.Button, onClickLabel = "Open the rest", onClick = onClick)
            .border(QalaTokens.borderWidth, c.accent, RoundedCornerShape(QalaTokens.radius))
            .padding(horizontal = 12.dp)
            .semantics(mergeDescendants = true) { contentDescription = if (over) "Rest is over, ${timer.overSec(now)} seconds ago" else "Rest, ${timer.remainingSec(now)} seconds left" },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QalaIcon(QalaIcons.Hourglass, null, size = 16.dp, tint = c.accent)
        QalaText(text, style = QalaType.log.copy(fontSize = 14.sp, lineHeight = 20.sp), color = c.accent, maxLines = 1)
    }
}

/** One segment per exercise, a tick per set (done in teal), the current exercise outlined; each jumps to its exercise. */
@Composable
private fun ExerciseSegments(state: WorkoutState, onPick: (Int) -> Unit) {
    val c = Qala.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        state.exercises.forEachIndexed { i, ex ->
            val current = i == state.current
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 44.dp)
                    .clickable(role = Role.Tab, onClickLabel = "Go to ${ex.name}") { onPick(i) }
                    .semantics {
                        contentDescription = "${ex.name}, ${ex.doneCount} of ${ex.setCount} sets done"
                        selected = current
                    },
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .border(QalaTokens.borderWidth, if (current) c.fg else c.border, RoundedCornerShape(QalaTokens.radius))
                        .padding(horizontal = 6.dp, vertical = 9.dp),
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    ex.sets.filter { !it.skipped }.forEach { set ->
                        Box(
                            Modifier
                                .weight(1f)
                                .height(8.dp)
                                .background(if (set.done) c.progressFill else c.grid, RoundedCornerShape(4.dp)),
                        )
                    }
                }
            }
        }
    }
}

/** "‹ Squat" and "Bench Press ›": the neighbouring exercises by name, for the thumb that would rather tap than swipe. */
@Composable
private fun NeighbourRow(state: WorkoutState, onPrev: () -> Unit, onNext: () -> Unit) {
    val c = Qala.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        NeighbourButton(state.prevName, "Previous exercise", leading = true, onPrev, Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        NeighbourButton(state.nextName, "Next exercise", leading = false, onNext, Modifier.weight(1f))
    }
    Box(Modifier.fillMaxWidth().height(QalaTokens.borderWidth).background(c.border))
}

@Composable
private fun NeighbourButton(name: String?, description: String, leading: Boolean, onClick: () -> Unit, modifier: Modifier) {
    val c = Qala.colors
    if (name == null) {
        Spacer(modifier.heightIn(min = 44.dp))
        return
    }
    Row(
        modifier
            .heightIn(min = 44.dp)
            .clickable(role = Role.Button, onClickLabel = "$description, $name", onClick = onClick)
            .semantics { contentDescription = "$description, $name" },
        horizontalArrangement = if (leading) Arrangement.Start else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading) QalaIcon(QalaIcons.ChevronLeft, null, size = 18.dp, tint = c.fgSecondary)
        QalaText(name, Modifier.weight(1f, fill = false).padding(horizontal = 2.dp), QalaType.button.copy(fontSize = 13.sp), c.fgSecondary, maxLines = 1)
        if (!leading) QalaIcon(QalaIcons.ChevronRight, null, size = 18.dp, tint = c.fgSecondary)
    }
}

// ---- one exercise ----

@Composable
private fun ExercisePage(
    state: WorkoutState,
    page: Int,
    store: WorkoutStore,
    plates: Map<Double, PlateHint>,
    showPlates: Boolean,
    inventory: List<PlateEntry>,
    saved: SetRef?,
    manualRest: Boolean,
    onRest: () -> Unit,
) {
    val ex = state.exercises[page]
    val unit = ex.unit
    val scroll = rememberScrollState()
    // The plates of the open set: the last answer stays until the next one comes, so the sleeve never blanks as the weight moves.
    val openWeight = ex.sets.getOrNull(ex.selected)?.weight
    val hint = if (showPlates && ex.barbell && openWeight != null) plates[openWeight] else null
    var lastHint by remember { mutableStateOf<PlateHint?>(null) }
    LaunchedEffect(hint) { if (hint != null) lastHint = hint }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
    ) {
        Card(hero = true, contentPadding = 14.dp) {
            GroupLabel("Exercise ${page + 1} of ${state.exercises.size} · ${ex.setCount} sets")
            QalaText(ex.name, Modifier.padding(top = 4.dp).semantics { heading() }, QalaType.stageTitle, Qala.colors.fg)
            if (ex.lastTime != null) QalaText("Last time ${ex.lastTime}", Modifier.padding(top = 4.dp), QalaType.log.copy(fontSize = 12.sp, lineHeight = 17.sp), Qala.colors.fgMuted)
            Spacer(Modifier.height(10.dp))
            if (ex.ramps.isNotEmpty()) {
                ex.ramps.forEachIndexed { i, step ->
                    RampRow(
                        number = i + 1,
                        step = step,
                        unit = unit,
                        faces = if (showPlates && ex.barbell && !step.bar) plates[step.load]?.perSide else null,
                        inventory = inventory,
                        onClick = { store.tickRamp(page, i) },
                    )
                }
                Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(QalaTokens.borderWidth).background(Qala.colors.borderStrong))
            }
            ex.sets.forEachIndexed { i, set ->
                val selected = i == ex.selected && page == state.current && !set.skipped
                SetRow(
                    number = i + 1,
                    set = set,
                    unit = unit,
                    selected = selected,
                    last = i == ex.sets.lastIndex,
                    saved = saved == SetRef(page, i),
                    onClick = { if (!set.skipped) store.pickSet(i) },
                    // With Automatic rest off a done set offers the rest it would have started (D34).
                    onRest = if (manualRest && set.done) ({ if (store.startRest(SetRef(page, i))) onRest() }) else null,
                ) {
                    Logger(set, unit, store, sleeve = if (showPlates && ex.barbell) SleeveView(hint, lastHint, inventory) else null)
                }
            }
        }
        if (page == state.current) {
            Spacer(Modifier.height(12.dp))
            Tools(state.selectedSet?.jointPain == true, store::toggleJointPain)
        }
    }
}

/**
 * One step of the ramp, above the work sets and lighter than them (S46): "W1 · 95 lb × 5", the plates of one side as small faces,
 * and the rest after it. Tapping ticks it and starts that short rest; tapping again takes the tick back. Nothing here is logged:
 * no RPE, and it never reaches progression.
 */
@Composable
private fun RampRow(number: Int, step: RampSetState, unit: WeightUnit, faces: List<Double>?, inventory: List<PlateEntry>, onClick: () -> Unit) {
    val c = Qala.colors
    val load = if (step.bar) "Bar" else "${formatWeight(step.load)} ${unitLabel(unit)}"
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .toggleable(value = step.done, role = Role.Checkbox, onValueChange = { onClick() })
            .semantics(mergeDescendants = true) { contentDescription = "Warm-up set $number, $load times ${step.reps}, rest ${formatClock(step.restSec)}" + if (step.done) ", done" else "" },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(22.dp)
                .background(if (step.done) c.progressFill else androidx.compose.ui.graphics.Color.Transparent, CircleShape)
                .border(QalaTokens.borderWidth, if (step.done) c.progressFill else c.border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (step.done) QalaIcon(QalaIcons.Check, null, size = 14.dp, tint = androidx.compose.ui.graphics.Color.White)
        }
        QalaText("W$number", Modifier.width(26.dp), QalaType.hint.copy(fontSize = 12.sp, lineHeight = 16.sp), c.fgMuted, maxLines = 1)
        Column(Modifier.weight(1f)) {
            QalaText("$load × ${step.reps}", style = QalaType.log.copy(fontSize = 13.sp, lineHeight = 18.sp), color = if (step.done) c.fgMuted else c.fgSecondary, maxLines = 1)
            if (faces != null && faces.isNotEmpty()) {
                Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                    faces.forEach { PlateFace(it, inventory, RampFaceDp) }
                }
            }
        }
        QalaText("rest ${formatClock(step.restSec)}", style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.fgMuted, maxLines = 1)
    }
}

/** The height of a plate face on a ramp row, small enough that a row stays a single line of weight and a line of plates. */
private const val RampFaceDp = 16f

/**
 * One set of the exercise as a row, the progress of the exercise (DECISIONS U18): a number or a check, the prescription,
 * what was done once it is, and a "Saved" check for a moment after an edit of it was kept. A set a grind dropped is struck out
 * and one it lowered says so. The selected row opens into the logger ([logger]).
 */
@Composable
private fun SetRow(
    number: Int,
    set: SetState,
    unit: WeightUnit,
    selected: Boolean,
    last: Boolean,
    saved: Boolean,
    onClick: () -> Unit,
    onRest: (() -> Unit)?,
    logger: @Composable () -> Unit,
) {
    val c = Qala.colors
    val bring = remember { BringIntoViewRequester() }
    LaunchedEffect(selected) { if (selected) bring.bringIntoView() }
    // A lowered set shows the load it is now at; the program's own number stays in the saved record for the scripts.
    val shownWeight = if (set.adjusted) set.weight else set.targetWeight
    val target = (if (shownWeight != null) "${formatWeight(shownWeight)} ${unitLabel(unit)} × " else "") + repsTarget(set.targetReps, set.minReps, set.amrap)
    val done = if (set.done) (if (set.weight != null) "${formatWeight(set.weight)} × " else "") + formatWeight(set.reps) + (set.rpe?.let { " @ ${formatWeight(it)}" } ?: "") else null
    Column(
        Modifier
            .fillMaxWidth()
            .bringIntoViewRequester(bring)
            .drawBehind { if (!last) drawRect(c.border, Offset(0f, size.height - 1.dp.toPx()), Size(size.width, 1.dp.toPx())) },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clickable(enabled = !set.skipped, role = Role.Button, onClickLabel = "Go to set $number", onClick = onClick)
                .semantics(mergeDescendants = true) {
                    contentDescription = "Set $number, " + (if (set.skipped) "dropped after a grind" else if (done != null) "done, $done" else target) + if (set.amrap) ", as many reps as you can" else ""
                    this.selected = selected
                },
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(28.dp)
                    .background(if (set.done) c.progressFill else androidx.compose.ui.graphics.Color.Transparent, CircleShape)
                    .border(QalaTokens.borderWidth, if (set.done) c.progressFill else if (selected) c.accent else c.borderStrong, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (set.done) QalaIcon(QalaIcons.Check, null, size = 16.dp, tint = androidx.compose.ui.graphics.Color.White)
                else QalaText("$number", style = QalaType.button.copy(fontSize = 12.sp, lineHeight = 14.sp), color = if (selected) c.accent else c.fgSecondary)
            }
            Column(Modifier.weight(1f)) {
                QalaText(
                    if (set.skipped) "Set $number · dropped" else "Set $number · " + (done ?: target),
                    style = QalaType.log.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = if (selected) androidx.compose.ui.text.font.FontWeight.Medium else androidx.compose.ui.text.font.FontWeight.Normal),
                    color = if ((set.done && !selected) || set.skipped) c.fgMuted else c.fg,
                    maxLines = 1,
                )
                if (set.done && done != null) QalaText("target $target", style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.fgMuted, maxLines = 1)
                if (set.adjusted && !set.done) QalaText("lowered after a grind", style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.accent, maxLines = 1)
            }
            AnimatedVisibility(visible = saved, enter = fadeIn(), exit = fadeOut()) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    QalaIcon(QalaIcons.Check, null, size = 14.dp, tint = c.progress)
                    QalaText("Saved", style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 16.sp), color = c.progress, maxLines = 1)
                }
            }
            if (set.amrap) {
                QalaText("AMRAP", Modifier.border(QalaTokens.borderWidth, c.accent, RoundedCornerShape(QalaTokens.radius)).padding(horizontal = 6.dp, vertical = 2.dp), QalaType.groupLabel.copy(fontSize = 10.sp), c.accent, maxLines = 1)
            }
        }
        if (onRest != null) {
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.End) {
                SecondaryButton("Rest", onRest, Modifier.semantics { contentDescription = "Start rest after set $number" }, small = true, icon = QalaIcons.Hourglass)
            }
        }
        if (selected) Column(Modifier.padding(bottom = 14.dp)) { logger() }
    }
}

/** The plates under the weight figure: the answer for this weight when there is one, else the last answer, and the inventory the colours come from. */
private class SleeveView(val now: PlateHint?, val last: PlateHint?, val inventory: List<PlateEntry>)

/**
 * The open set: weight stepper with the loaded sleeve under it, reps stepper, then the RPE strip with its anchors and what the
 * pick means. The sleeve has a fixed height and the numbers under it a fixed line, reserved even before the plate math has
 * answered, so stepping the weight moves the plates and nothing else (S46).
 */
@Composable
private fun Logger(set: SetState, unit: WeightUnit, store: WorkoutStore, sleeve: SleeveView?) {
    val c = Qala.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.bgRecessed, RoundedCornerShape(QalaTokens.radiusMd))
            .border(QalaTokens.borderWidth, c.border, RoundedCornerShape(QalaTokens.radiusMd))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (set.weight != null) {
            Column {
                Stepper("Weight", formatWeight(set.weight), { store.stepWeight(it) }, "Less weight", "More weight", unit = unitLabel(unit), canDecrease = set.weight > 0)
                if (sleeve != null) {
                    val shown = sleeve.now ?: sleeve.last
                    LoadedSleeve(shown?.perSide.orEmpty(), sleeve.inventory, Modifier.fillMaxWidth().padding(top = 4.dp), SleeveHeightDp.dp)
                    // The numbers of the plates on the sleeve: this weight's when they are known, the last ones until they are.
                    QalaText(
                        when {
                            sleeve.now != null -> plateLine(set.weight, sleeve.now)
                            shown != null -> shown.shorthand
                            else -> ""
                        },
                        Modifier.fillMaxWidth().padding(top = 4.dp).heightIn(min = 22.dp),
                        QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 16.sp),
                        c.fgMuted,
                        TextAlign.Center,
                        maxLines = 1,
                    )
                }
            }
        }
        Stepper(
            label = if (set.amrap) "Reps (as many as you can)" else "Reps",
            value = formatWeight(set.reps),
            onStep = { store.stepReps(it) },
            decreaseDescription = "Fewer reps",
            increaseDescription = "More reps",
            canDecrease = set.reps > 1,
        )
        Column {
            Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                GroupLabel("RPE")
                if (set.targetRpe != null) QalaText("target ${formatWeight(set.targetRpe)}", style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.fgMuted)
            }
            ScalePicker(
                labels = RpeValues.map { formatWeight(it) },
                selected = RpeValues.indexOf(set.rpe).takeIf { it >= 0 },
                onPick = { store.pickRpe(RpeValues[it]) },
                groupLabel = "RPE",
                describe = { "RPE ${formatWeight(RpeValues[it])}, ${rpeMeaning(RpeValues[it])}" },
                cellHeight = 44.dp,
                fontSize = 13.sp,
            )
            QalaText(
                if (set.rpe != null) "RPE ${formatWeight(set.rpe)} · ${rpeMeaning(set.rpe)}" else "Optional. Tap how hard it was; tap again to clear.",
                Modifier.padding(top = 6.dp),
                QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp),
                c.fgMuted,
            )
        }
    }
}

/** The sleeve under the weight figure: tall enough for a full 45 lb plate to read, the same height whatever is on it. */
private const val SleeveHeightDp = 96f

/** The tools under the card (DECISIONS U18). Only joint pain is wired today: it flags the set on the saved record. */
@Composable
private fun Tools(jointPain: Boolean, onJointPain: () -> Unit) {
    val c = Qala.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(role = Role.Switch, onClickLabel = "Flag this set as painful", onClick = onJointPain)
            .semantics(mergeDescendants = true) { contentDescription = "Joint pain on this set" + if (jointPain) ", flagged" else ""; selected = jointPain },
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QalaIcon(QalaIcons.TriangleAlert, null, size = 18.dp, tint = if (jointPain) c.danger else c.fgMuted)
        QalaText(if (jointPain) "Joint pain flagged on this set" else "Joint pain on this set", style = QalaType.button.copy(fontSize = 13.sp), color = if (jointPain) c.danger else c.fgSecondary)
    }
}

// ---- finishing ----

@Composable
private fun FinishSheet(open: Boolean, state: WorkoutState, onClose: () -> Unit, onFinish: () -> Unit, onLeave: () -> Unit) {
    val none = state.loggedSets == 0
    QalaSheet(
        open = open,
        title = if (none) "Leave the workout?" else "Finish workout?",
        onClose = onClose,
        footer = {
            if (none) {
                PrimaryButton("Leave without saving", onLeave)
            } else {
                PrimaryButton("Finish workout", onFinish, large = true, icon = QalaIcons.Check)
            }
            Spacer(Modifier.height(8.dp))
            SecondaryButton("Keep lifting", onClose)
        },
    ) {
        val left = state.totalSets - state.loggedSets
        QalaText(
            when {
                none -> "Nothing is logged yet, so there is nothing to save. Leaving drops this workout; Today will offer it again."
                left == 0 -> "All ${state.totalSets} sets are logged. The program moves on to its next day."
                else -> "${state.loggedSets} of ${state.totalSets} sets are logged. The $left you skipped are not counted, and the program moves on to its next day."
            },
            Modifier.padding(bottom = 12.dp),
            QalaType.body,
            Qala.colors.fg,
        )
    }
}
