package com.qala.app.today

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.qala.app.skip.SkipSheetState
import com.qala.design.Card
import com.qala.design.CardNotch
import com.qala.design.DayMenu
import com.qala.design.DayRail
import com.qala.design.DmMonoFamily
import com.qala.design.GroupLabel
import com.qala.design.PreviewBar
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.SecondaryButton
import com.qala.design.beamerSurface
import com.qala.design.nextStage
import com.qala.design.rememberCardNotch
import com.qala.design.trackNotch
import com.qala.data.today.DayKind

/**
 * Today's own state: which stage is being previewed and whether the menu is open. It lives in the shell, above the
 * route, because the menu is composed over the whole window (the tab bar included) while the rail and the cards live
 * in the content. Previewing is by stage id, with null meaning "follow now", so the screen stays on now when Mark
 * done moves it. It is reset whenever Today is left.
 */
@Stable
class TodayUiState {
    var previewing by mutableStateOf<String?>(null)
    var menuOpen by mutableStateOf(false)

    /** The skip sheet, composed by the shell over the whole window like the menu. */
    val skip = SkipSheetState()

    fun reset() {
        previewing = null
        menuOpen = false
        skip.close()
    }

    /** Moves the preview to the stage at [index] (the now stage clears it). */
    fun show(model: TodayModel, index: Int) {
        previewing = previewFor(model.stages, model.nowIndex, index)
    }
}

/** The pinned head's lower edge fades in over this much scroll once content slides under it. */
private val HeadBorderRamp = 12.dp

/**
 * Today (DESIGN 7.1, mockups/today-rail-full.html): the pinned head, five cards that give way around the fixed day
 * rail, and the rail itself. It fills the content area above the tab bar and scrolls on [scroll], which the shell owns.
 *
 * The brand bar [topBar] scrolls away with the content. The head sits in the scrolling column too, so it rides up
 * with the content under the bar and then sticks at the status bar: one `offset` that adds back whatever the scroll
 * has moved past the bar's height. The rail is a sibling of the column, centred in the band between the stuck head
 * and the tab bar; it never scrolls, and each card cuts its own bite around it.
 */
@Composable
fun TodayScreen(
    load: TodayLoad,
    ui: TodayUiState,
    scroll: ScrollState,
    topBar: @Composable (Modifier) -> Unit,
    onGo: (Destination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Qala.colors
    val density = LocalDensity.current
    val model = (load as? TodayLoad.Ready)?.model
    var topBarPx by remember { mutableIntStateOf(0) }
    var headPx by remember { mutableIntStateOf(0) }
    val band = remember { mutableStateOf(Rect.Zero) }
    val statusTop = WindowInsets.statusBars.getTop(density)
    val viewing = model?.let { viewingIndex(it.stages, it.nowIndex, ui.previewing) } ?: 0
    val rampPx = with(density) { HeadBorderRamp.toPx() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Column(Modifier.statusBarsPadding()) {
                topBar(Modifier.padding(horizontal = 20.dp).onSizeChanged { topBarPx = it.height })
                Column(
                    Modifier
                        .fillMaxWidth()
                        .zIndex(1f)
                        .offset { IntOffset(0, (scroll.value - topBarPx).coerceAtLeast(0)) }
                        .onSizeChanged { headPx = it.height }
                        .background(c.bg)
                        .pointerInput(Unit) { }          // the head is opaque to touches too: a button scrolled under it is not pressed through it
                        .drawBehind {
                            // The edge appears as content starts sliding under the head, not while it still rests under the bar.
                            val stuck = ((scroll.value - topBarPx) / rampPx).coerceIn(0f, 1f)
                            val border = QalaTokens.borderWidth.toPx()
                            drawRect(c.border.copy(alpha = c.border.alpha * stuck), Offset(0f, size.height - border), Size(size.width, border))
                        },
                ) {
                    Column(Modifier.padding(horizontal = 20.dp).padding(top = 16.dp)) {
                        GroupLabel(model?.eyebrow ?: "Today", Modifier.padding(bottom = 2.dp))
                        QalaText("Today", Modifier.semantics { heading() }, QalaType.pageTitle, c.fg)
                    }
                    PreviewBar(
                        visible = model != null && viewing != model.nowIndex,
                        label = model?.stages?.getOrNull(viewing)?.label.orEmpty(),
                        onBackToNow = { ui.previewing = null },
                        modifier = Modifier.padding(horizontal = 20.dp),
                    )
                    Spacer(Modifier.height(12.dp))
                }
                Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 32.dp)) {
                    if (model == null) {
                        PlainNote(load)
                    } else {
                        val notchBand = { band.value }
                        val hero = model.hero(viewing)
                        RailCard(rememberCardNotch(notchBand)) { HeroContent(hero, onGo) }
                        RailCard(rememberCardNotch(notchBand)) { InfoContent(model.nextRun, onGo) }
                        RailCard(rememberCardNotch(notchBand)) { InfoContent(model.readiness, onGo) }
                        RailCard(rememberCardNotch(notchBand)) { WeekContent(model.week, onGo) }
                        RailCard(rememberCardNotch(notchBand)) { InfoContent(model.weight, onGo) }
                    }
                }
            }
        }
        if (model != null) {
            // The band for the rail: from the stuck head's lower edge to the bottom of the content area.
            Box(
                Modifier.fillMaxSize().layout { measurable, constraints ->
                    val top = (statusTop + headPx).coerceIn(0, constraints.maxHeight)
                    val placeable = measurable.measure(Constraints.fixed(constraints.maxWidth, constraints.maxHeight - top))
                    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(0, top) }
                },
            ) {
                DayRail(
                    stages = model.stages,
                    viewing = viewing,
                    onStep = { delta -> ui.show(model, nextStage(model.stages, viewing, delta)) },
                    onOpenMenu = { ui.menuOpen = true },
                    onBandChanged = { band.value = it },
                    modifier = Modifier.align(Alignment.CenterStart),
                )
            }
        }
    }
}

/** The day menu, composed by the shell over the whole window. Nothing is drawn until Today has a day. */
@Composable
fun TodayMenu(load: TodayLoad, ui: TodayUiState, modifier: Modifier = Modifier) {
    val model = (load as? TodayLoad.Ready)?.model ?: return
    DayMenu(
        open = ui.menuOpen,
        title = model.menuTitle,
        stages = model.stages,
        viewing = viewingIndex(model.stages, model.nowIndex, ui.previewing),
        nowIndex = model.nowIndex,
        onSelect = { ui.show(model, it) },
        onClose = { ui.menuOpen = false },
        modifier = modifier,
    )
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

/** A Today card: 44 dp of start padding past the border so no glyph enters the notch zone, and the bite wired in. */
@Composable
private fun RailCard(notch: CardNotch, content: @Composable ColumnScope.() -> Unit) {
    val c = Qala.colors
    val border = QalaTokens.borderWidth
    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp)
            .trackNotch(notch)
            .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusLg, c.shadowCard, notch = notch)
            .padding(start = border + 44.dp, end = border + 14.dp, top = border + 14.dp, bottom = border + 14.dp),
        content = content,
    )
}

private fun CtaIcon.vector() = when (this) {
    CtaIcon.None -> null
    CtaIcon.CircleCheck -> QalaIcons.CircleCheck
    CtaIcon.Flame -> QalaIcons.Flame
    CtaIcon.Dumbbell -> QalaIcons.Dumbbell
    CtaIcon.SportShoe -> QalaIcons.SportShoe
}

@Composable
private fun HeroContent(hero: Hero, onGo: (Destination) -> Unit) {
    val c = Qala.colors
    GroupLabel(hero.kicker, color = if (hero.now) c.accent else c.fgMuted)
    QalaText(hero.title, Modifier.padding(top = 8.dp).semantics { heading() }, QalaType.stageTitle)
    hero.subtitle?.let { QalaText(it, Modifier.padding(top = 4.dp), QalaType.hint, c.fgMuted) }
    hero.figure?.let { figure ->
        Column(
            Modifier
                .padding(top = 16.dp)
                .fillMaxWidth()
                .drawBehind { drawRect(c.border, Offset.Zero, Size(size.width, 1.dp.toPx())) }
                .padding(top = 1.dp + 14.dp),
        ) {
            GroupLabel(figure.label)
            QalaText(
                buildAnnotatedString {
                    append(figure.value)
                    figure.unit?.let {
                        append(" ")
                        withStyle(SpanStyle(fontFamily = DmMonoFamily, fontWeight = FontWeight.Normal, fontSize = QalaType.figureUnit.fontSize, color = c.fgMuted)) { append(it) }
                    }
                    figure.times?.let { append(" × $it") }
                },
                Modifier.padding(vertical = 6.dp),
                QalaType.figure,
            )
        }
    }
    hero.lines.forEach { QalaText(it, Modifier.padding(top = 8.dp), BodyStyle, c.fgSecondary) }
    hero.detail?.let {
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            QalaIcon(QalaIcons.ListChecks, null, size = 16.dp, tint = c.fgSecondary)
            QalaText(it, style = QalaType.body.copy(fontSize = QalaType.groupLabel.fontSize), color = c.fgSecondary)
        }
    }
    hero.cta?.let {
        Spacer(Modifier.height(18.dp))
        PrimaryButton(it.label, onClick = { onGo(it.to) }, large = true, icon = it.icon.vector(), enabled = hero.ctaEnabled)
    }
    hero.skip?.let {
        Spacer(Modifier.height(8.dp))
        SecondaryButton(it.label, onClick = { onGo(it.to) })
    }
}

@Composable
private fun InfoContent(card: InfoCard, onGo: (Destination) -> Unit) {
    val c = Qala.colors
    GroupLabel(card.kicker)
    QalaText(card.title, Modifier.padding(top = 4.dp).semantics { heading() }, QalaType.cardTitle)
    card.lines.forEach { QalaText(it, Modifier.padding(top = 6.dp), BodyStyle, c.fgSecondary) }
    card.action?.let {
        Spacer(Modifier.height(12.dp))
        SecondaryButton(it.label, onClick = { onGo(it.to) }, small = true)
    }
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
    card.action?.let {
        Spacer(Modifier.height(12.dp))
        SecondaryButton(it.label, onClick = { onGo(it.to) }, small = true)
    }
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
        QalaText(cell.letter, Modifier.padding(top = 4.dp), QalaType.tabLabel, if (cell.today) c.accent else c.fgMuted, maxLines = 1)
        QalaIcon(
            when (cell.kind) {
                DayKind.LIFT -> QalaIcons.Dumbbell
                DayKind.RUN -> QalaIcons.SportShoe
                DayKind.REST -> QalaIcons.Bed
            },
            null,
            Modifier.padding(top = 3.dp),
            size = 12.dp,
            tint = c.fgMuted,
        )
    }
}
