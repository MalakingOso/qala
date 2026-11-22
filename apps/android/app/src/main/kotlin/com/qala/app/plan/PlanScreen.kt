package com.qala.app.plan

import android.text.format.DateFormat
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.plates.PlateFaces
import com.qala.app.plates.rememberPerSide
import com.qala.data.core.PlateEntry
import com.qala.data.model.GymSettings
import com.qala.app.skip.skipIcon
import com.qala.app.today.CtaIcon
import com.qala.app.today.Destination
import com.qala.app.today.TodayLoad
import com.qala.data.IsoTime
import com.qala.data.engine.EngineSnapshot
import com.qala.data.plan.PlanWeekData
import com.qala.design.ChoiceChip
import com.qala.design.DayTabItem
import com.qala.design.GlassButton
import com.qala.design.Group
import com.qala.design.GroupLabel
import com.qala.design.GroupRow
import com.qala.design.IconTile
import com.qala.design.LinkButton
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.ScreenHead
import com.qala.design.SecondaryButton
import com.qala.design.SheetCard
import com.qala.design.SheetPage
import com.qala.design.Wash
import kotlinx.coroutines.withContext

private val PlanNavSaver: Saver<PlanNav, List<Int>> = Saver(
    save = { listOf(it.offset, it.day, it.view.ordinal) },
    restore = { PlanNav(it[0], it[1], PlanView.entries.getOrElse(it[2]) { PlanView.Overview }) },
)

/**
 * Plan (DESIGN 7.2, DECISIONS S51): the wash head with the program and its rotation over the title, a glass Change plan at its end, the
 * week's arrows and a glass tab for each day under it, then the cream sheet carrying the selected day (its exercises and, on today,
 * one Start workout button) and the week's summary. It scrolls on [scroll].
 *
 * The week is laid out by the data module from the records behind the engine snapshot, off the main thread, so it is
 * the week Today's strip and rail show, and any other week the arrows reach. Where the user is looking (week, day and
 * view) is saved across a recreated activity and starts again on this week and today when the tab is left.
 */
@Composable
fun PlanScreen(
    snapshot: EngineSnapshot,
    today: TodayLoad,
    scroll: ScrollState,
    onGo: (Destination) -> Unit,
    onChangePlan: () -> Unit,
) {
    val input = snapshot.input
    when {
        snapshot.error != null -> PlanShell(scroll, "Plan could not be worked out.", snapshot.error)
        !snapshot.loaded || input == null -> PlanShell(scroll, "Getting your plan ready.", null)
        else -> PlanContent(snapshot, today, scroll, onGo, onChangePlan)
    }
}

/** The page with nothing to show yet: the title under [eyebrow] and, if there is one, the [note] on the sheet. */
@Composable
private fun PlanShell(scroll: ScrollState, eyebrow: String, note: String?) {
    SheetPage(scroll, head = { ScreenHead("Plan", eyebrow = eyebrow) }) {
        note?.let { QalaText(it, style = BodyStyle, color = Qala.colors.fgSecondary) }
    }
}

private val BodyStyle = QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp)

@Composable
private fun PlanContent(snapshot: EngineSnapshot, today: TodayLoad, scroll: ScrollState, onGo: (Destination) -> Unit, onChangePlan: () -> Unit) {
    val container = LocalAppContainer.current
    val input = snapshot.input!!
    val use24h = DateFormat.is24HourFormat(LocalContext.current)
    val zone = container.env.clock.zone
    var nav by rememberSaveable(stateSaver = PlanNavSaver) { mutableStateOf(PlanNav(day = IsoTime.weekdayIndex(snapshot.date))) }
    val bounds = remember(snapshot) { container.planCompute.bounds(input, snapshot.builtAtMs, zone) }
    val shown = nav.within(bounds)
    val week by produceState<PlanWeekData?>(null, snapshot, shown.offset) {
        // Rust and JSON work, off the main thread. The previous week stays on screen until the next one is ready.
        value = withContext(container.env.work) { container.planCompute.week(input, snapshot.builtAtMs, zone, shown.offset) }
    }
    val data = week
    if (data == null) {
        PlanShell(scroll, "Getting your plan ready.", null)
        return
    }
    // What Today would offer next, so Plan's button on today follows Today's stage order instead of deciding it again.
    val next = remember(today) { (today as? TodayLoad.Ready)?.model?.let { todayNext(it) } }
    val model = remember(data, shown, bounds, use24h, next) { PlanModel(data, shown, bounds, use24h, next) }
    val c = Qala.colors

    // No program: the empty week gives way to the way out of it. A run plan still has days worth showing under it.
    val hasProgram = data.programName != null
    val showWeek = hasProgram || snapshot.hasRunPlan
    SheetPage(
        scroll,
        head = {
            Column {
                ScreenHead(
                    "Plan",
                    eyebrow = model.eyebrow,
                    actions = { if (hasProgram) GlassButton(onChangePlan, Modifier.padding(top = 10.dp), label = "Change plan") },
                )
                if (showWeek) {
                    GlassWeekSwitcher(
                        model.week,
                        onPrevious = { nav = shown.previous(bounds) },
                        onNext = { nav = shown.next(bounds) },
                        Modifier.padding(top = 10.dp),
                    )
                    if (!model.week.onThisWeek) {
                        LinkButton(
                            "Back to this week",
                            onClick = { nav = shown.thisWeek(IsoTime.weekdayIndex(snapshot.date)) },
                            Modifier.align(Alignment.CenterHorizontally),
                            color = Wash.Text,
                        )
                    }
                    GlassDayTabs(
                        items = model.tabs.map { it.item() },
                        onSelect = { nav = shown.select(it) },
                        groupLabel = "Days of the week",
                        Modifier.padding(top = 8.dp),
                    )
                }
            }
        },
    ) {
        if (!hasProgram) {
            SheetCard {
                QalaText("No plan yet. Choose one and each training day lists its lifts here.", style = QalaType.hint, color = c.fgMuted)
                Spacer(Modifier.height(16.dp))
                PrimaryButton("Choose a plan", onClick = onChangePlan, large = true)
            }
        }
        if (showWeek) {
            DayCardView(model.card, onPick = { nav = shown.show(it) }, onGo = onGo)
            Group(model.summary.title) {
                GroupRow(last = true) {
                    Column {
                        QalaText(model.summary.holds, style = QalaType.bodyStrong, color = c.fg)
                        QalaText(model.summary.went, Modifier.padding(top = 2.dp), QalaType.hint, c.fgMuted)
                    }
                }
            }
        }
    }
}

/**
 * `<  This week  >` over the wash: a glass arrow either side of the week's label and the dates under it. The label is a heading and
 * a polite live region, so moving to another week is spoken. An arrow with no week beyond it is dimmed and inert.
 */
@Composable
private fun GlassWeekSwitcher(week: WeekBar, onPrevious: () -> Unit, onNext: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        GlassButton(onPrevious, icon = QalaIcons.ChevronLeft, description = "Previous week", enabled = week.canPrevious)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            QalaText(
                week.label,
                Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite },
                QalaType.cardTitle.copy(fontSize = 16.sp, lineHeight = 20.sp, shadow = Wash.TextShadow),
                Wash.Text,
                TextAlign.Center,
                maxLines = 1,
            )
            QalaText(week.range, style = Wash.Small.copy(fontSize = 11.sp, lineHeight = 14.sp), color = Color.White.copy(alpha = 0.8f), textAlign = TextAlign.Center, maxLines = 1)
        }
        GlassButton(onNext, icon = QalaIcons.ChevronRight, description = "Next week", enabled = week.canNext)
    }
}

/**
 * A glass pill for each day of the week: the weekday over the day of the month, then a glyph, sharing the width. The picked one is
 * the light chip and today's name reads in ember when it is not the one picked; a done day's glyph is teal, and a day skipped or not
 * logged is struck through. Each pill answers to its [DayTabItem.description] for a screen reader, and the row to [groupLabel].
 */
@Composable
private fun GlassDayTabs(items: List<DayTabItem>, onSelect: (Int) -> Unit, groupLabel: String, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(24.dp)
    Row(
        modifier.fillMaxWidth().selectableGroup().semantics { contentDescription = groupLabel },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items.forEachIndexed { i, item ->
            val ink = if (item.selected) Wash.EmberInk else Wash.Text
            val strike = if (item.struck) TextDecoration.LineThrough else TextDecoration.None
            Column(
                Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 72.dp)
                    .background(if (item.selected) Wash.Text2 else Wash.GlassFill, shape)
                    .border(1.dp, if (item.selected) Color.Transparent else Wash.GlassBorder, shape)
                    .selectable(
                        selected = item.selected,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Tab,
                        onClick = { onSelect(i) },
                    )
                    .semantics { contentDescription = item.description }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
            ) {
                QalaText(
                    item.name.uppercase(),
                    style = QalaType.tabLabel.copy(fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.08.em, textDecoration = strike),
                    color = when {
                        item.selected -> Wash.EmberInk.copy(alpha = 0.72f)
                        item.today -> Wash.Ember
                        else -> Color.White.copy(alpha = 0.8f)
                    },
                    maxLines = 1,
                )
                QalaText(item.date, style = QalaType.log.copy(fontSize = 15.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium, textDecoration = strike), color = ink, maxLines = 1)
                QalaIcon(item.glyph, null, size = 16.dp, tint = if (item.selected) ink else if (item.done) Wash.Teal else Color.White.copy(alpha = 0.6f))
            }
        }
    }
}

private fun DayTab.item() = DayTabItem(
    name = name,
    date = date,
    glyph = when {
        reason != null -> skipIcon(reason)
        glyph == TabGlyph.Check -> QalaIcons.Check
        glyph == TabGlyph.Lift -> QalaIcons.Dumbbell
        glyph == TabGlyph.Run -> QalaIcons.SportShoe
        else -> QalaIcons.Bed
    },
    description = description,
    selected = selected,
    today = today,
    done = state == TabState.Done,
    struck = state == TabState.Skipped || state == TabState.NotLogged,
)

private fun CtaIcon.vector() = when (this) {
    CtaIcon.None -> null
    CtaIcon.CircleCheck -> QalaIcons.CircleCheck
    CtaIcon.Flame -> QalaIcons.Flame
    CtaIcon.Dumbbell -> QalaIcons.Dumbbell
    CtaIcon.SportShoe -> QalaIcons.SportShoe
}

/** The selected day on a sheet card. Today's eyebrow is ember, and its button is the one ember fill on the screen. */
@Composable
private fun DayCardView(card: DayCard, onPick: (PlanView) -> Unit, onGo: (Destination) -> Unit) {
    val c = Qala.colors
    SheetCard {
        GroupLabel(card.eyebrow, color = if (card.hero) c.accent else c.fgMuted)
        if (card.reason != null) {
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconTile(skipIcon(card.reason))
                Column {
                    QalaText(card.title, Modifier.semantics { heading() }, QalaType.cardTitle)
                    card.subtitle?.let { QalaText(it, style = QalaType.hint, color = c.fgMuted) }
                }
            }
        } else {
            QalaText(card.title, Modifier.padding(top = 6.dp).semantics { heading() }, QalaType.stageTitle.copy(fontSize = 26.sp, lineHeight = 30.sp))
            card.subtitle?.let { QalaText(it, Modifier.padding(top = 4.dp), QalaType.hint, c.fgMuted) }
        }
        card.detail?.let {
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                QalaIcon(QalaIcons.ListChecks, null, size = 16.dp, tint = c.fgSecondary)
                QalaText(it, style = QalaType.body.copy(fontSize = QalaType.groupLabel.fontSize), color = c.fgSecondary)
            }
        }
        card.lines.forEach { QalaText(it, Modifier.padding(top = 10.dp), BodyStyle, c.fgSecondary) }
        card.note?.let { QalaText("Note: $it", Modifier.padding(top = 6.dp), QalaType.hint, c.fgMuted) }
        card.cta?.let {
            Spacer(Modifier.height(18.dp))
            PrimaryButton(it.label, onClick = { onGo(it.to) }, large = true, icon = it.icon.vector())
            card.ctaNote?.let { note -> QalaText(note, Modifier.padding(top = 8.dp), QalaType.hint, c.fgMuted) }
        }
        card.secondary?.let {
            Spacer(Modifier.height(if (card.cta == null) 18.dp else 8.dp))
            SecondaryButton(it.label, onClick = { onGo(it.to) })
        }
        if (card.views.isNotEmpty()) {
            Row(
                Modifier.padding(top = 18.dp).fillMaxWidth().selectableGroup(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                card.views.forEach { view -> ChoiceChip(view.label, view == card.view, onClick = { onPick(view) }, Modifier.weight(1f)) }
            }
        }
        if (card.exercises.isNotEmpty()) ExerciseList(card)
        card.run?.let { run ->
            Row(
                // The last exercise row has its own bottom padding, so the rule sits right under it.
                Modifier.padding(top = if (card.exercises.isEmpty()) 12.dp else 0.dp).fillMaxWidth().rule().padding(top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                QalaIcon(QalaIcons.SportShoe, null, size = 20.dp, tint = c.fgSecondary)
                Column {
                    QalaText(run.title, style = QalaType.bodyStrong, color = c.fg)
                    QalaText(run.line, style = Mono, color = c.fgSecondary)
                }
            }
        }
        card.footnote?.let { QalaText(it, Modifier.padding(top = 12.dp), QalaType.hint, c.fgMuted) }
    }
}

private val Mono = QalaType.log

/** A 1 dp rule across the top of the element, in the card border's colour. */
@Composable
private fun Modifier.rule(): Modifier {
    val color = Qala.colors.border
    return drawBehind { drawRect(color, Offset.Zero, Size(size.width, 1.dp.toPx())) }
}

@Composable
private fun ExerciseList(card: DayCard) {
    val c = Qala.colors
    val rows = if (card.view == PlanView.WarmUp) card.exercises.filter { it.warmups.isNotEmpty() } else card.exercises
    // Plate faces next to the prescribed weights, as "Show plates" in Settings has them (S46).
    val gym by LocalAppContainer.current.settings.gym.collectAsState(initial = GymSettings())
    val perSide = rememberPerSide(rows.flatMap { it.plateWeights }.filterNotNull(), gym.plates, enabled = gym.rest.showPlates && card.view != PlanView.WarmUp)
    Column(Modifier.padding(top = 12.dp)) {
        rows.forEachIndexed { i, e ->
            // TODO: a tap on an exercise should open it in All exercises (as the mockup's chevron implies) once that route exists.
            Row(
                Modifier
                    .fillMaxWidth()
                    .then(if (i == 0) Modifier else Modifier.rule())
                    .defaultMinSize(minHeight = 48.dp)
                    .padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    QalaText(e.name, style = QalaType.bodyStrong, color = c.fg)
                    when (card.view) {
                        PlanView.Overview -> QalaText(e.scheme, Modifier.padding(top = 2.dp), Mono, c.fgSecondary)
                        PlanView.EverySet -> SetLines(e.sets, e.plateWeights.map { w -> w?.let { perSide[it] } }, gym.plates.plates)
                        PlanView.WarmUp -> SetLines(e.warmups)
                    }
                }
                // The heaviest set's plates, once for the exercise, at the row's end.
                if (card.view == PlanView.Overview) {
                    e.plateWeights.filterNotNull().maxOrNull()?.let { w -> perSide[w]?.let { PlateFaces(it, gym.plates.plates, height = 28f) } }
                }
            }
        }
        if (rows.isEmpty()) QalaText("No warm-up sets are planned.", Modifier.padding(vertical = 10.dp), QalaType.hint, c.fgMuted)
    }
}

@Composable
private fun SetLines(sets: List<String>, faces: List<List<Double>?> = emptyList(), inventory: List<PlateEntry> = emptyList()) {
    val c = Qala.colors
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        sets.forEachIndexed { i, text ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                QalaText("${i + 1}", style = Mono, color = c.fgMuted)
                QalaText(text, style = Mono, color = c.fgSecondary)
                faces.getOrNull(i)?.let { PlateFaces(it, inventory) }
            }
        }
    }
}
