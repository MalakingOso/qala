package com.qala.app.today

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.plates.PlateFaces
import com.qala.app.plates.rememberPlateHint
import com.qala.app.skip.SkipSheetState
import com.qala.app.skip.apply
import com.qala.app.skip.skipIcon
import com.qala.app.skip.undoWrites
import com.qala.data.model.GymSettings
import com.qala.data.today.DayKind
import com.qala.design.Card
import com.qala.design.DayTimelineRow
import com.qala.design.DayTimelineRowHeight
import com.qala.design.DayTimelineVertical
import com.qala.design.GroupLabel
import com.qala.design.IconButton
import com.qala.design.IconTile
import com.qala.design.LinkButton
import com.qala.design.PreviewBar
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.SecondaryButton
import com.qala.design.SheetCard
import com.qala.design.TabBarHeight
import com.qala.design.beamerSurface
import com.qala.design.sheetColor
import com.qala.design.sheetSurface
import com.qala.design.nextStage
import kotlinx.coroutines.launch

/**
 * Today's own state: which stage is being previewed. It lives in the shell, above the route, because the skip sheet is
 * composed over the whole window (the tab bar included) while the timeline and the cards live in the content.
 * Previewing is by stage id, with null meaning "follow now", so the screen stays on now when Mark done moves it. It
 * is reset whenever Today is left.
 */
@Stable
class TodayUiState {
    var previewing by mutableStateOf<String?>(null)

    /** The skip sheet, composed by the shell over the whole window. */
    val skip = SkipSheetState()

    fun reset() {
        previewing = null
        skip.close()
    }

    /** Moves the preview to the stage at [index] (the now stage clears it). */
    fun show(model: TodayModel, index: Int) {
        previewing = previewFor(model.stages, model.nowIndex, index)
    }
}

/**
 * Today (DECISIONS S48, DESIGN 7.1): the day's film behind the whole screen, the head and the day timeline over it, the hero for the
 * stage being looked at, and a three-stop drawer under it holding everything else. [TodayLayout] places the layers and the
 * [DrawerState] moves them; this composes what goes in each.
 *
 * Nothing here reads the drawer while composing except the booleans that decide which version of the timeline is the one on show,
 * so a drag recomposes nothing. [scroll] is the list's, which the shell owns.
 */
@Composable
fun TodayScreen(
    load: TodayLoad,
    ui: TodayUiState,
    scroll: ScrollState,
    onGo: (Destination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val model = (load as? TodayLoad.Ready)?.model
    val drawer = rememberDrawerState()
    val density = LocalDensity.current
    val statusTop = WindowInsets.statusBars.getTop(density)
    val navBottom = WindowInsets.navigationBars.getBottom(density)
    // Back closes the drawer, one press from half or full, before it leaves Today.
    BackHandler(enabled = model != null && drawer.stop != DrawerStop.Closed) { drawer.settle(DrawerStop.Closed) }

    Box(modifier.fillMaxSize().then(if (model != null) Modifier.drawerGestures(drawer) else Modifier)) {
        TodayFilm(
            parallaxPx = { drawer.anchors?.let { -0.08f * (it.closed - drawer.t) } ?: 0f },
            extraScrim = { 0.26f * drawer.q1 + 0.2f * drawer.q2 },
        )
        if (model == null) {
            Box(Modifier.align(Alignment.BottomCenter).padding(start = 16.dp, end = 16.dp, bottom = TabBarHeight + 24.dp).navigationBarsPadding()) { PlainNote(load) }
            TodayIcons(onGo, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(end = 8.dp))
        } else {
            val viewing = viewingIndex(model.stages, model.nowIndex, ui.previewing)
            val hero = model.hero(viewing)
            // Which timeline is the one on show: the vertical list while the sheet is mostly down, the row once it is mostly up.
            val rowActive by remember(drawer) { derivedStateOf { drawer.anchors?.rowOnly == true || drawer.q1 >= 0.47f } }
            // A window too short for a hero over a sheet (a phone on its side) gets the day as one scrolling column over the film.
            if (LocalConfiguration.current.screenHeightDp < 480) {
                TodayCompact(model, hero, viewing, ui, scroll, onGo)
            } else {
                TodayLayout(drawer, statusTop, navBottom, Modifier.fillMaxSize()) {
                    TodayContent(model, hero, viewing, ui, drawer, scroll, rowActive, onGo)
                }
            }
        }
    }
}

private val OverFilm = Color.White.copy(alpha = 0.88f)
private val EmberOnFilm = Color(0xFFFB923C)
private val FilmShadow = Shadow(Color(0x66000000), Offset(0f, 2f), 10f)
private val HeroKicker = QalaType.groupLabel.copy(shadow = FilmShadow)
private val HeroTitle = QalaType.stageTitle.copy(fontSize = 30.sp, lineHeight = 34.sp, shadow = FilmShadow)
private val HeroMeta = QalaType.body.copy(fontSize = 13.sp, lineHeight = 17.sp, shadow = FilmShadow)
private val HeroNumber = QalaType.figure.copy(fontSize = 96.sp, lineHeight = 96.sp, letterSpacing = (-0.02).em, shadow = FilmShadow)
private val HeroUnit = QalaType.figureUnit.copy(fontSize = 14.sp, lineHeight = 18.sp, shadow = FilmShadow)
private val HeroCaption = QalaType.log.copy(fontSize = 10.sp, lineHeight = 12.sp, shadow = FilmShadow)
private val PlateHeight = 44f

@Composable
private fun TodayIcons(onGo: (Destination) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier) {
        IconButton(QalaIcons.History, "History", { onGo(Destination.History) }, tint = Color.White)
        IconButton(QalaIcons.Settings, "Settings", { onGo(Destination.Settings) }, tint = Color.White)
    }
}

/** Every layer of Today, each in its own slot for [TodayLayout] to place. */
@Composable
private fun TodayContent(
    model: TodayModel,
    hero: Hero,
    viewing: Int,
    ui: TodayUiState,
    drawer: DrawerState,
    scroll: ScrollState,
    rowActive: Boolean,
    onGo: (Destination) -> Unit,
) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    val gym by container.settings.gym.collectAsState(initial = GymSettings())
    val saveError by container.workout.saveError.collectAsState()
    val bottomInset = TabBarHeight + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    // The head: the weekday and the kind of day, the title, and the preview bar while another stage is being previewed.
    Layer(Slot.Head, Modifier.semantics { isTraversalGroup = true; traversalIndex = -3f }) {
        Column(Modifier.fillMaxWidth().statusBarsPadding()) {
            Column(Modifier.padding(start = 20.dp, end = 104.dp, top = 6.dp)) {
                QalaText(model.eyebrow.uppercase(), Modifier.padding(bottom = 2.dp), HeroKicker, OverFilm, maxLines = 1)
                QalaText("Today", Modifier.semantics { heading() }, QalaType.pageTitle.copy(fontSize = 36.sp, lineHeight = 42.sp, shadow = FilmShadow), Color.White)
            }
            PreviewBar(
                visible = viewing != model.nowIndex,
                label = model.stages.getOrNull(viewing)?.label.orEmpty(),
                onBackToNow = { ui.previewing = null },
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }
    }
    Layer(Slot.Icons) { TodayIcons(onGo) }

    Layer(Slot.TimelineV, Modifier.semantics { isTraversalGroup = true; traversalIndex = -2f }) {
        DayTimelineVertical(model.stages, viewing, active = !rowActive, onSelect = { ui.show(model, it) }, onStep = { ui.show(model, nextStage(model.stages, viewing, it)) })
    }
    Layer(Slot.TimelineRow, Modifier.semantics { isTraversalGroup = true; traversalIndex = -2f }) {
        DayTimelineRow(
            model.stages, viewing, active = rowActive, onSelect = { ui.show(model, it) }, onStep = { ui.show(model, nextStage(model.stages, viewing, it)) },
            dock = { drawer.docked }, ink = { smooth((drawer.q2 - 0.02f) / 0.4f) },
        )
    }

    // The hero, a part at a time, so the layout can scale and move each one.
    Layer(Slot.Kicker) { QalaText(hero.kicker.uppercase(), style = HeroKicker, color = if (hero.now) EmberOnFilm else OverFilm, maxLines = 1) }
    Layer(Slot.Title) { QalaText(hero.title, Modifier.semantics { heading() }, HeroTitle, Color.White, maxLines = 2) }
    val meta = listOfNotNull(hero.subtitle, hero.detail).joinToString(" · ")
    if (meta.isNotEmpty()) Layer(Slot.Meta) { QalaText(meta, style = HeroMeta, color = OverFilm, maxLines = 2) }
    hero.figure?.let { figure ->
        Layer(Slot.Number) { QalaText(figure.value, style = HeroNumber, color = Color.White, maxLines = 1) }
        val unit = listOfNotNull(figure.unit, figure.times?.let { "× $it" }).joinToString(" ")
        if (unit.isNotEmpty()) Layer(Slot.Unit) { QalaText(unit, style = HeroUnit, color = OverFilm, maxLines = 1) }
        // The plates of one side of the top set follow "Show plates" in Settings.
        val plateHint = rememberPlateHint(figure.plateWeight, gym.plates, enabled = gym.rest.showPlates && figure.plateWeight != null)
        if (plateHint != null && plateHint.perSide.isNotEmpty()) {
            Layer(Slot.Plates) { PlateFaces(plateHint.perSide, gym.plates.plates, height = PlateHeight) }
            Layer(Slot.Caption) { QalaText(plateHint.shorthand, style = HeroCaption, color = OverFilm, maxLines = 1) }
        }
    }

    // The action block: what the stage says and its buttons. White over the film, ink once it is over the cream sheet.
    Layer(Slot.Action, Modifier.semantics { isTraversalGroup = true; traversalIndex = 0f }) {
        ActionBlock(hero, saveError, { drawer.q1 }, onGo)
    }

    // The sheet. Its peek is decoration (the list has the same cards for TalkBack), and the list is always in the semantics tree.
    Layer(Slot.Sheet, Modifier.clearAndSetSemantics { }) { Box(Modifier.fillMaxSize().sheetSurface(sheetColor()) { 0.3f * drawer.q1 + 0.2f * drawer.q2 }) }
    Layer(Slot.Peek, Modifier.clearAndSetSemantics { }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PeekTile(model.nextRun, Modifier.weight(1f))
            PeekTile(model.readiness, Modifier.weight(1f))
        }
    }
    Layer(Slot.List, Modifier.semantics { isTraversalGroup = true; traversalIndex = 1f }) {
        Column(
            Modifier
                .fillMaxSize()
                .nestedScroll(drawer.nestedScroll)
                .verticalScroll(scroll)
                .padding(bottom = bottomInset + 16.dp),
        ) {
            model.status?.let { card -> SheetCard { StatusContent(card, model, ui) } }
            SheetCard { InfoContent(model.readiness, onGo) }
            Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SheetCard(Modifier.weight(1f).fillMaxHeight()) { InfoContent(model.nextRun, onGo) }
                SheetCard(Modifier.weight(1f).fillMaxHeight()) { WeekContent(model.week, onGo) }
            }
            SheetCard { InfoContent(model.weight, onGo) }
        }
    }
    Layer(Slot.DayLabel) { GroupLabel("The day") }
    Layer(Slot.Handle) { Handle(drawer) }
}

/** The day on a window too short for the drawer: the head, the row, the hero and its buttons, and the cards, in one column that scrolls. */
@Composable
private fun TodayCompact(model: TodayModel, hero: Hero, viewing: Int, ui: TodayUiState, scroll: ScrollState, onGo: (Destination) -> Unit) {
    val container = LocalAppContainer.current
    val saveError by container.workout.saveError.collectAsState()
    val bottomInset = TabBarHeight + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Box(Modifier.fillMaxSize().background(Color(0x80140A04))) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll).statusBarsPadding().padding(horizontal = 20.dp).padding(bottom = bottomInset + 16.dp)) {
            QalaText(model.eyebrow.uppercase(), Modifier.padding(top = 6.dp, end = 96.dp), HeroKicker, OverFilm, maxLines = 1)
            QalaText("Today", Modifier.semantics { heading() }, QalaType.pageTitle.copy(shadow = FilmShadow), Color.White)
            PreviewBar(visible = viewing != model.nowIndex, label = model.stages.getOrNull(viewing)?.label.orEmpty(), onBackToNow = { ui.previewing = null })
            Box(Modifier.padding(top = 8.dp).height(DayTimelineRowHeight)) {
                DayTimelineRow(model.stages, viewing, active = true, onSelect = { ui.show(model, it) }, onStep = { ui.show(model, nextStage(model.stages, viewing, it)) }, dock = { 0f }, ink = { 0f }, modifier = Modifier.fillMaxWidth())
            }
            QalaText(hero.kicker.uppercase(), Modifier.padding(top = 12.dp), HeroKicker, if (hero.now) EmberOnFilm else OverFilm, maxLines = 1)
            QalaText(hero.title, Modifier.semantics { heading() }, HeroTitle, Color.White, maxLines = 2)
            val meta = listOfNotNull(hero.subtitle, hero.detail).joinToString(" · ")
            if (meta.isNotEmpty()) QalaText(meta, style = HeroMeta, color = OverFilm)
            hero.figure?.let { f -> QalaText(listOfNotNull(f.value, f.unit, f.times?.let { "× $it" }).joinToString(" "), style = HeroNumber.copy(fontSize = 44.sp, lineHeight = 48.sp), color = Color.White) }
            Spacer(Modifier.height(10.dp))
            ActionBlock(hero, saveError, { 0f }, onGo)
            Spacer(Modifier.height(16.dp))
            model.status?.let { card -> SheetCard { StatusContent(card, model, ui) } }
            SheetCard { InfoContent(model.readiness, onGo) }
            SheetCard { InfoContent(model.nextRun, onGo) }
            SheetCard { WeekContent(model.week, onGo) }
            SheetCard { InfoContent(model.weight, onGo) }
        }
        TodayIcons(onGo, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(end = 8.dp))
    }
}

/** The action block between the hero and the list: the save error, the stage's own lines, Start, and what goes with it. */
@Composable
private fun ActionBlock(hero: Hero, saveError: String?, ink: () -> Float, onGo: (Destination) -> Unit) {
    val c = Qala.colors
    // White over the film, the secondary ink over the cream sheet, turning as the sheet comes up. Read when drawn.
    val text = { lerp(OverFilm, c.fgSecondary, ink()) }
    val accent = { lerp(EmberOnFilm, c.accent, ink()) }
    Column(Modifier.fillMaxWidth()) {
        saveError?.let { message ->
            // The workout could not be saved and is kept (D34): Resume, in the hero under this, tries again.
            QalaText("NOT SAVED", accent, style = HeroKicker.copy(shadow = null), maxLines = 1)
            QalaText(message, text, Modifier.padding(bottom = 6.dp).semantics { liveRegion = LiveRegionMode.Polite }, BodyStyle)
        }
        hero.lines.forEach { QalaText(it, text, Modifier.padding(bottom = 2.dp), BodyStyle) }
        hero.cta?.let {
            Spacer(Modifier.height(12.dp))
            PrimaryButton(it.label, onClick = { onGo(it.to) }, icon = it.icon.vector(), enabled = hero.ctaEnabled)
        }
        hero.skip?.let {
            Spacer(Modifier.height(8.dp))
            SecondaryButton(it.label, onClick = { onGo(it.to) }, small = true)
        }
        hero.note?.let { QalaText(it, text, Modifier.padding(top = 10.dp), QalaType.body.copy(fontSize = 12.sp, lineHeight = 17.sp)) }
        hero.link?.let { LinkButton(it.label, onClick = { onGo(it.to) }) }
    }
}

/** The grab bar. A tap goes to the next stop (closed, half, full, closed); the same click is what TalkBack and a test use. */
@Composable
private fun Handle(drawer: DrawerState) {
    val c = Qala.colors
    val state = when (drawer.stop) {
        DrawerStop.Closed -> "Closed"
        DrawerStop.Half -> "Half open"
        DrawerStop.Full -> "Open"
    }
    val label = when (drawer.stop) {
        DrawerStop.Closed -> "Open the drawer"
        DrawerStop.Half -> "Open the drawer fully"
        DrawerStop.Full -> "Close the drawer"
    }
    Box(
        Modifier
            .fillMaxWidth()
            .height(58.dp)
            .semantics { contentDescription = "Day drawer"; stateDescription = state }
            .clickable(interactionSource = null, indication = null, onClickLabel = label, role = Role.Button) { drawer.cycle() }
            .drawBehind {
                val d = density
                drawRoundRect(c.fg.copy(alpha = 0.28f), Offset((size.width - 36f * d) / 2f, 8f * d), Size(36f * d, 4f * d), CornerRadius(2f * d))
            },
    )
}

/** What the drawer shows while it is closed: the top of the next card or two, cut off by the tab bar. Decoration, not read out. */
@Composable
private fun PeekTile(card: InfoCard, modifier: Modifier = Modifier) {
    val c = Qala.colors
    val border = QalaTokens.borderWidth
    Column(
        modifier
            .heightIn(min = 132.dp)
            .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusLg, c.shadowCard)
            .padding(border + 12.dp),
    ) {
        GroupLabel(card.kicker)
        QalaText(card.title, Modifier.padding(top = 2.dp), QalaType.cardTitle, maxLines = 2)
        card.lines.firstOrNull()?.let { QalaText(it, Modifier.padding(top = 4.dp), QalaType.body.copy(fontSize = 12.sp, lineHeight = 16.sp), c.fgSecondary, maxLines = 3) }
    }
}

@Composable
private fun PlainNote(load: TodayLoad) {
    val c = Qala.colors
    Card {
        when (load) {
            is TodayLoad.Failed -> {
                GroupLabel("Today")
                QalaText("Today could not be worked out.", Modifier.padding(top = 4.dp).semantics { heading() }, QalaType.cardTitle)
                QalaText(load.message, Modifier.padding(top = 6.dp), BodyStyle, c.fgSecondary)
            }
            else -> {
                GroupLabel("Today")
                QalaText("Getting your day ready.", Modifier.padding(top = 4.dp), QalaType.cardTitle)
            }
        }
    }
}

private val BodyStyle = QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp)

private fun CtaIcon.vector() = when (this) {
    CtaIcon.None -> null
    CtaIcon.CircleCheck -> QalaIcons.CircleCheck
    CtaIcon.Flame -> QalaIcons.Flame
    CtaIcon.Dumbbell -> QalaIcons.Dumbbell
    CtaIcon.SportShoe -> QalaIcons.SportShoe
}

/**
 * The status card (mockups/m4-status-banner.html option B, with the question inline): the reason, how long, what it means
 * for the plan, Undo and Change. From a sick span's second day the "Feeling better?" question sits under them, once per
 * session. The head is a heading and a polite live region, so a status appearing or changing is spoken and the card stays
 * reachable by heading navigation.
 */
@Composable
private fun StatusContent(card: StatusCard, model: TodayModel, ui: TodayUiState) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    val status = model.dayStatus ?: return
    val date = model.plan.date
    val ask = feelingBetterDue(card, container.feelingBetterAsked)
    // Writes run on the container's scope: the card goes away when the snapshot catches up, and a Room write must not be cancelled with it.
    fun end() = container.scope.launch { container.availability.apply(undoWrites(status, date)) }

    Column {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            IconTile(skipIcon(card.reason))
            Column {
                QalaText(card.head, Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite }, QalaType.cardTitle)
                QalaText(card.whenLine, style = QalaType.hint, color = c.fgMuted)
            }
        }
        QalaText(card.line, Modifier.padding(top = 10.dp), BodyStyle, c.fgSecondary)
        card.note?.let { QalaText("Note: $it", Modifier.padding(top = 4.dp), QalaType.hint, c.fgMuted) }
    }
    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        SecondaryButton(
            "Undo",
            onClick = { end() },
            modifier = Modifier.semantics { contentDescription = card.undoDescription },
            small = true,
            icon = QalaIcons.Undo2,
        )
        LinkButton("Change", onClick = { ui.skip.show(model.skip) }, Modifier.semantics { contentDescription = "Change today's status" }.padding(horizontal = 10.dp))
    }
    if (ask) {
        val rule = c.border
        Column(
            Modifier
                .padding(top = 12.dp)
                .fillMaxWidth()
                .drawBehind { drawRect(rule, Offset.Zero, Size(size.width, QalaTokens.borderWidth.toPx())) }
                .padding(top = 12.dp + QalaTokens.borderWidth),
        ) {
            QalaText("Feeling better?", Modifier.semantics { heading() }, QalaType.bodyStrong, c.fg)
            QalaText(card.ask!!.text, Modifier.padding(top = 2.dp), BodyStyle, c.fgSecondary)
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("I am better", onClick = { container.feelingBetterAsked = true; end() }, modifier = Modifier.weight(1f))
                SecondaryButton("Still sick", onClick = { container.feelingBetterAsked = true }, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun InfoContent(card: InfoCard, onGo: (Destination) -> Unit) {
    val c = Qala.colors
    GroupLabel(card.kicker)
    QalaText(card.title, Modifier.padding(top = 4.dp).semantics { heading() }, QalaType.cardTitle)
    card.lines.forEach { QalaText(it, Modifier.padding(top = 6.dp), BodyStyle, c.fgSecondary) }
    card.action?.let { LinkButton(it.label, onClick = { onGo(it.to) }, Modifier.padding(top = 4.dp)) }
}

@Composable
private fun WeekContent(card: WeekCard, onGo: (Destination) -> Unit) {
    val c = Qala.colors
    GroupLabel(card.kicker)
    QalaText(card.title, Modifier.padding(top = 4.dp).semantics { heading() }, QalaType.cardTitle)
    val scale = card.cells.maxOf { maxOf(it.planned, it.done) }
    Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        card.cells.forEach { cell -> WeekDay(cell, scale, Modifier.weight(1f)) }
    }
    card.caption?.let { QalaText(it, Modifier.padding(top = 10.dp), BodyStyle, c.fgSecondary) }
    card.action?.let { LinkButton(it.label, onClick = { onGo(it.to) }, Modifier.padding(top = 4.dp)) }
}

/**
 * One day of the week card, in the web strip's vocabulary (DESIGN 6.3): a bar as tall as the day's load, filled by the
 * share done. Done is teal, today is ember, a later day is outlined, a rest day a dash, and a training day with nothing
 * planned yet a dashed outline. The glyph under the letter says lift, run or rest.
 */
@Composable
private fun WeekDay(cell: WeekCell, scale: Double, modifier: Modifier) {
    val c = Qala.colors
    val size = maxOf(cell.planned, cell.done)
    val spoken = buildString {
        append(cell.dayName)
        append(if (cell.training) ", lift day" else if (cell.kind == DayKind.RUN) ", run day" else ", rest day")
        if (size > 0) append(", ${loadUnits(cell.planned)} planned, ${loadUnits(cell.done)} done")
        if (cell.reason != null) append(", skipped, ${reasonWord(cell.reason)}")
        if (cell.today) append(", today")
    }
    Column(modifier.semantics(mergeDescendants = true) { contentDescription = spoken }, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(if (scale <= 0.0) 30.dp else 52.dp)           // a week with nothing in it needs no tall bars
                .drawBehind {
                    val stroke = 2.dp.toPx()
                    val radius = CornerRadius(3.dp.toPx())
                    val outline = if (cell.today) c.accent else if (cell.done > 0) c.progressFill else c.fgFaint
                    if (size <= 0.0) {
                        if (cell.training) {
                            val h = if (scale <= 0.0) this.size.height else this.size.height * 0.4f
                            drawRoundRect(
                                outline, Offset(stroke / 2, this.size.height - h + stroke / 2), Size(this.size.width - stroke, h - stroke), radius,
                                style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))),
                            )
                        } else {
                            drawRect(c.fgFaint, Offset(this.size.width * 0.3f, this.size.height - stroke), Size(this.size.width * 0.4f, stroke))
                        }
                    } else {
                        val h = maxOf((size / scale).toFloat() * this.size.height, 8.dp.toPx())
                        val top = this.size.height - h
                        val share = (cell.done / size).toFloat().coerceIn(0f, 1f)
                        if (share > 0f) {
                            val fillH = h * share
                            drawRoundRect(if (cell.today) c.accent else c.progressFill, Offset(0f, this.size.height - fillH), Size(this.size.width, fillH), radius)
                        }
                        drawRoundRect(
                            outline, Offset(stroke / 2, top + stroke / 2), Size(this.size.width - stroke, h - stroke), radius,
                            style = Stroke(stroke),
                        )
                    }
                },
        )
        QalaText(
            cell.letter,
            Modifier.padding(top = 4.dp),
            if (cell.reason != null) QalaType.tabLabel.copy(textDecoration = TextDecoration.LineThrough) else QalaType.tabLabel,
            if (cell.today) c.accent else c.fgMuted,
            maxLines = 1,
        )
        QalaIcon(
            when {
                cell.reason != null -> skipIcon(cell.reason)
                cell.kind == DayKind.LIFT -> QalaIcons.Dumbbell
                cell.kind == DayKind.RUN -> QalaIcons.SportShoe
                else -> QalaIcons.Bed
            },
            null,
            Modifier.padding(top = 3.dp),
            size = 12.dp,
            tint = c.fgMuted,
        )
    }
}
