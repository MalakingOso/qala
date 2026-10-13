package com.qala.app.plan

import android.text.format.DateFormat
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.skip.skipIcon
import com.qala.app.today.CtaIcon
import com.qala.app.today.Destination
import com.qala.app.today.TodayLoad
import com.qala.data.IsoTime
import com.qala.data.engine.EngineSnapshot
import com.qala.data.plan.PlanWeekData
import com.qala.design.Card
import com.qala.design.ChoiceChip
import com.qala.design.DayTabItem
import com.qala.design.DayTabs
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
import com.qala.design.SecondaryButton
import com.qala.design.WeekSwitcher
import kotlinx.coroutines.withContext

private val PlanNavSaver: Saver<PlanNav, List<Int>> = Saver(
    save = { listOf(it.offset, it.day, it.view.ordinal) },
    restore = { PlanNav(it[0], it[1], PlanView.entries.getOrElse(it[2]) { PlanView.Overview }) },
)

/**
 * Plan (DESIGN 7.2, mockups/phone-refresh-plan.html): arrows over the week, a tab for each day, the day's own exercises and,
 * on today, one Start workout button. It fills the shell's content box under the brand bar and scrolls on [scroll].
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
    topBar: @Composable (Modifier) -> Unit,
    onGo: (Destination) -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
        Column(Modifier.statusBarsPadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
            topBar(Modifier)
            val input = snapshot.input
            when {
                snapshot.error != null -> PlanHead("Plan could not be worked out.", snapshot.error)
                !snapshot.loaded || input == null -> PlanHead("Getting your plan ready.", null)
                else -> PlanContent(snapshot, today, onGo)
            }
        }
    }
}

@Composable
private fun PlanHead(eyebrow: String, note: String?) {
    Column(Modifier.padding(top = 16.dp, bottom = 16.dp)) {
        GroupLabel(eyebrow, Modifier.padding(bottom = 2.dp))
        QalaText("Plan", Modifier.semantics { heading() }, QalaType.pageTitle, Qala.colors.fg)
        note?.let { QalaText(it, Modifier.padding(top = 8.dp), BodyStyle, Qala.colors.fgSecondary) }
    }
}

private val BodyStyle = QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp)

@Composable
private fun PlanContent(snapshot: EngineSnapshot, today: TodayLoad, onGo: (Destination) -> Unit) {
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
        PlanHead("Getting your plan ready.", null)
        return
    }
    // What Today would offer next, so Plan's button on today follows Today's stage order instead of deciding it again.
    val next = remember(today) { (today as? TodayLoad.Ready)?.model?.let { todayNext(it) } }
    val model = remember(data, shown, bounds, use24h, next) { PlanModel(data, shown, bounds, use24h, next) }
    val c = Qala.colors

    PlanHead(model.eyebrow, null)
    Card(contentPadding = 14.dp) {
        WeekSwitcher(
            label = model.week.label,
            range = model.week.range,
            canPrevious = model.week.canPrevious,
            canNext = model.week.canNext,
            onPrevious = { nav = shown.previous(bounds) },
            onNext = { nav = shown.next(bounds) },
        )
        if (!model.week.onThisWeek) {
            LinkButton(
                "Back to this week",
                onClick = { nav = shown.thisWeek(IsoTime.weekdayIndex(snapshot.date)) },
                Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }
    Spacer(Modifier.height(12.dp))
    DayTabs(
        items = model.tabs.map { it.item() },
        onSelect = { nav = shown.select(it) },
        groupLabel = "Days of the week",
    )
    Spacer(Modifier.height(12.dp))
    DayCardView(model.card, onPick = { nav = shown.show(it) }, onGo = onGo)
    Spacer(Modifier.height(16.dp))
    Group(model.summary.title) {
        GroupRow(last = true) {
            Column {
                QalaText(model.summary.holds, style = QalaType.bodyStrong, color = c.fg)
                QalaText(model.summary.went, Modifier.padding(top = 2.dp), QalaType.hint, c.fgMuted)
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

/** The selected day. Today's card carries the shadow, and its button is the one ember fill on the screen. */
@Composable
private fun DayCardView(card: DayCard, onPick: (PlanView) -> Unit, onGo: (Destination) -> Unit) {
    val c = Qala.colors
    Card(hero = card.hero) {
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
            QalaText(card.title, Modifier.padding(top = 8.dp).semantics { heading() }, QalaType.stageTitle)
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
    Column(Modifier.padding(top = 12.dp)) {
        rows.forEachIndexed { i, e ->
            // TODO: a tap on an exercise should open it in All exercises (as the mockup's chevron implies) once that route exists.
            Column(
                Modifier
                    .fillMaxWidth()
                    .then(if (i == 0) Modifier else Modifier.rule())
                    .padding(vertical = 10.dp),
            ) {
                QalaText(e.name, style = QalaType.bodyStrong, color = c.fg)
                when (card.view) {
                    PlanView.Overview -> QalaText(e.scheme, Modifier.padding(top = 2.dp), Mono, c.fgSecondary)
                    PlanView.EverySet -> SetLines(e.sets)
                    PlanView.WarmUp -> SetLines(e.warmups)
                }
            }
        }
        if (rows.isEmpty()) QalaText("No warm-up sets are planned.", Modifier.padding(vertical = 10.dp), QalaType.hint, c.fgMuted)
    }
}

@Composable
private fun SetLines(sets: List<String>) {
    val c = Qala.colors
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        sets.forEachIndexed { i, text ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                QalaText("${i + 1}", style = Mono, color = c.fgMuted)
                QalaText(text, style = Mono, color = c.fgSecondary)
            }
        }
    }
}
