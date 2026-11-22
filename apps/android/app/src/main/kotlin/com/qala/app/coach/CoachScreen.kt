package com.qala.app.coach

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.workout.PlateMath
import com.qala.app.workout.plateLine
import com.qala.data.model.GymSettings
import com.qala.design.GroupLabel
import com.qala.design.LocalBarClearance
import com.qala.design.PinnedBar
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaTextField
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.ScreenHead
import com.qala.design.SecondaryButton
import com.qala.design.SheetCard
import com.qala.design.SheetPage
import com.qala.design.Wash
import com.qala.design.beamerSurface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Coach (DESIGN 7.11, DECISIONS U8): the title with where the coach runs, glass chips for the day it is looking at, the
 * thread on the cream sheet, the coach's suggested change next to the engine's, and the composer on a bar pinned over the
 * tab island. It reads the [store] and writes only through it. A coach that cannot answer shows [UnavailableCard] under the
 * thread and nothing else changes: the tabs, the composer and every other screen keep working.
 *
 * It lays its page on the shell's [scroll]. The composer floats over the bottom of the sheet, so the thread ends with [ComposerRoom]
 * under it and its last row (Use coach, Try again) is never under the bar. A new turn brings the end of the thread into view, and
 * moves the page only if it is not already.
 */
@Composable
fun CoachScreen(
    store: CoachStore,
    day: CoachDay,
    gym: GymSettings,
    scroll: ScrollState,
) {
    val state by store.state.collectAsState()
    var draft by rememberSaveable { mutableStateOf("") }
    val focus = LocalFocusManager.current

    // Keep the newest turn in view: when a turn arrives, or the unavailable card appears, or the screen opens on a thread. The sheet is a
    // screen high, so the end of the page is not the end of the thread; what is brought into view is the thread's own end, the room under
    // it and the page's padding below that (the same place the page stops when scrolled all the way down).
    val end = remember { BringIntoViewRequester() }
    var threadHeight by remember { mutableIntStateOf(0) }
    val pagePadding = with(LocalDensity.current) { (LocalBarClearance.current + 16.dp).toPx() }
    LaunchedEffect(state.messages.size, state.sending, state.unavailable) {
        withFrameNanos { }
        withFrameNanos { }          // the second frame is the one laid out with the new turn
        end.bringIntoView(Rect(0f, threadHeight - 1f, 1f, threadHeight + pagePadding))
    }

    fun send(text: String) {
        if (text.isBlank() || state.sending) return
        store.send(text, day.context)
        draft = ""
        focus.clearFocus()
    }

    SheetPage(
        scroll,
        head = {
            Column {
                // No kicker, so the title is let down by the kicker's height, where the other tab heads have theirs.
                ScreenHead("Coach", Modifier.padding(top = 16.dp), actions = { CoachStatus(state.unavailable, Modifier.align(Alignment.Bottom)) })
                ContextChips(day.chips)
            }
        },
        pinned = {
            PinnedBar {
                QalaTextField(
                    value = draft,
                    onValueChange = { draft = it.take(CoachStore.MaxMessageChars) },
                    placeholder = "Ask about training, recovery...",
                    label = "Ask the coach",
                    modifier = Modifier.weight(1f),
                    onDone = { send(draft) },
                )
                PrimaryButton("Send", { send(draft) }, Modifier.width(84.dp), enabled = !state.sending && draft.isNotBlank())
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().onSizeChanged { threadHeight = it.height }.bringIntoViewRequester(end)) {
            Thread(state, day, gym, store)
            state.unavailable?.let { UnavailableCard(it, state.detail, onRetry = store::retry, retrying = state.sending) }
            Spacer(Modifier.height(ComposerRoom))
        }
    }
}

/**
 * What the pinned composer covers of the page below the thread: its 10 dp of air and 48 dp field, less the 16 dp the page keeps under
 * its last row and the 12 dp every card carries under it, and then 18 dp of air.
 */
private val ComposerRoom = 48.dp

/** The status at the head's end, on the title's baseline: a teal dot while the coach answers, a dimmed one once it can't. */
@Composable
private fun CoachStatus(unavailable: Why?, modifier: Modifier = Modifier) {
    Row(modifier.padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).background(if (unavailable == null) Wash.Teal else Color.White.copy(alpha = 0.5f), CircleShape))
        QalaText(
            coachStatus(unavailable),
            style = QalaType.hint.copy(fontStyle = FontStyle.Normal, fontSize = 12.sp, lineHeight = 16.sp, shadow = Wash.TextShadow),
            color = Wash.Text2,
            maxLines = 1,
        )
    }
}

/** The day's chips as glass pills under the head: labels, so 34 dp tall, not the 44 dp of a control. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ContextChips(chips: List<String>) {
    if (chips.isEmpty()) return
    val shape = RoundedCornerShape(17.dp)
    FlowRow(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        chips.forEach { chip ->
            QalaText(
                chip,
                Modifier
                    .background(Wash.GlassFill, shape)
                    .border(1.dp, Wash.GlassBorder, shape)
                    .padding(horizontal = 14.dp, vertical = 9.dp),
                QalaType.button.copy(fontSize = 12.5.sp, lineHeight = 16.sp),
                Wash.Text,
                maxLines = 1,
            )
        }
    }
}

/** The turns, each with its 12 dp of air under it, as the sheet's cards have. */
@Composable
private fun Thread(state: CoachState, day: CoachDay, gym: GymSettings, store: CoachStore) {
    if (state.messages.isEmpty()) {
        EmptyThread(day, enabled = !state.sending) { store.send(it, day.context) }
        return
    }
    state.messages.forEach { m ->
        Bubble(m)
        m.card?.let { card -> SuggestionCardView(card, day, gym) { store.decide(m.id, it) } }
    }
    if (state.sending) Thinking()
}

/** The coach's opening line and a few questions to start from: tapping one asks it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmptyThread(day: CoachDay, enabled: Boolean, onAsk: (String) -> Unit) {
    val c = Qala.colors
    SheetCard {
        QalaText(
            "Ask about today's session, how you are recovering, or a number you don't understand. Anything it suggests as a change comes back as a card you can accept or keep the engine's.",
            style = QalaType.body.copy(fontSize = 14.sp, lineHeight = 21.sp),
            color = c.fgSecondary,
        )
    }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        day.starters.forEach { question ->
            SecondaryButton(question, onClick = { onAsk(question) }, small = true, enabled = enabled)
        }
    }
}

/**
 * One turn: a card on the sheet, yours at the end side and the coach's at the start, each as wide as its words up to 300 dp. It is the
 * sheet card's surface, but not [SheetCard] itself, which always fills the width.
 */
@Composable
private fun Bubble(m: CoachMessage) {
    val c = Qala.colors
    val mine = m.who == Who.You
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusLg, c.shadowCard)
                .padding(QalaTokens.borderWidth + 14.dp),
        ) {
            GroupLabel(if (mine) "You" else "Coach")
            QalaText(m.text, Modifier.padding(top = 2.dp), QalaType.body.copy(fontSize = 14.sp, lineHeight = 21.sp), c.fg)
        }
    }
}

/** A line under the thread while a request is out. The composer stays usable for typing; only Send waits. */
@Composable
private fun Thinking() {
    QalaText(
        "Coach is thinking",
        Modifier.padding(start = 2.dp, bottom = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
        QalaType.hint,
        Qala.colors.fgMuted,
    )
}

/** The coach's suggested change next to the engine's, with plates when the lift takes them, the limits and the two choices. */
@Composable
private fun SuggestionCardView(card: SuggestionCard, day: CoachDay, gym: GymSettings, onDecide: (Decision) -> Unit) {
    val c = Qala.colors
    val s = card.suggestion
    val shape = RoundedCornerShape(QalaTokens.radiusMd)
    val showPlates = day.barbell && gym.rest.showPlates && s.engine.unit == "lb"
    // The plate math is Rust and synchronous, so it runs off the main thread and the card fills the lines in when it has them.
    val engineLine = platesLine(s.engine, gym, showPlates)
    val coachLine = platesLine(s.coach, gym, showPlates)

    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp)
            .height(IntrinsicSize.Min)
            .clip(shape)
            .background(c.bgSurface, shape)
            .border(QalaTokens.borderWidth, c.border, shape),
    ) {
        Box(Modifier.width(6.dp).fillMaxHeight().background(c.accent))
        Column(Modifier.weight(1f).padding(16.dp)) {
            GroupLabel("Suggested change")
            QalaText(s.title, Modifier.padding(top = 4.dp).semantics { heading() }, QalaType.bodyStrong, c.fg)
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NumbersCell("Engine", s.engine, engineLine, coach = false, modifier = Modifier.weight(1f))
                NumbersCell("Coach", s.coach, coachLine, coach = true, modifier = Modifier.weight(1f))
            }
            QalaText(s.reason, Modifier.padding(top = 12.dp), QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp), c.fg)
            QalaText(limitsLine(card.limits), Modifier.padding(top = 6.dp), QalaType.hint.copy(fontSize = 12.sp, lineHeight = 17.sp), c.fgMuted)
            val done = decisionLine(card.decision)
            if (done == null) {
                Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryButton("Keep engine", { onDecide(Decision.KeepEngine) }, Modifier.weight(1f))
                    PrimaryButton("Use coach", { onDecide(Decision.UseCoach) }, Modifier.weight(1f))
                }
            } else {
                QalaText(done, Modifier.padding(top = 12.dp), QalaType.bodyStrong.copy(fontSize = 13.sp, lineHeight = 19.sp), c.progress)
            }
        }
    }
}

/** The plates for [n] from the lifter's inventory; null while the math runs, for a lift with no plates, and when Settings hides them. */
@Composable
private fun platesLine(n: CoachNumbers, gym: GymSettings, show: Boolean): String? {
    val line by produceState<String?>(null, show, n.weight, gym.plates) {
        value = if (!show) null else withContext(Dispatchers.Default) {
            PlateMath.hint(n.weight, gym.plates)?.let { plateLine(n.weight, it) }
        }
    }
    return line
}

@Composable
private fun NumbersCell(label: String, n: CoachNumbers, plates: String?, coach: Boolean, modifier: Modifier) {
    val c = Qala.colors
    val shape = RoundedCornerShape(QalaTokens.radius)
    Column(
        modifier
            .background(if (coach) c.accentSubtle else c.bgRecessed, shape)
            .border(if (coach) QalaTokens.borderWidth else 1.dp, if (coach) c.accent else c.border, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        GroupLabel(label)
        QalaText(weightFigure(n), style = QalaType.figure.copy(fontSize = 22.sp, lineHeight = 26.sp), color = c.fg, maxLines = 1)
        QalaText(setsLine(n), style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgSecondary)
        if (plates != null) QalaText(plates, Modifier.padding(top = 3.dp), QalaType.log.copy(fontSize = 11.5.sp, lineHeight = 16.sp), c.fgSecondary)
    }
}

/**
 * Shown under the thread when a question could not be answered: why, that the rest of the app is unaffected, and Try again.
 * A live region, so TalkBack says it when it appears.
 */
@Composable
fun UnavailableCard(why: Why, detail: String?, onRetry: () -> Unit, retrying: Boolean) {
    val c = Qala.colors
    val copy = unavailableCopy(why)
    SheetCard(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        GroupLabel("Coach")
        QalaText(copy.title, Modifier.padding(top = 4.dp).semantics { heading() }, QalaType.cardTitle, c.fg)
        QalaText(copy.body, Modifier.padding(top = 6.dp), QalaType.body.copy(fontSize = 14.sp, lineHeight = 21.sp), c.fgSecondary)
        if (!detail.isNullOrBlank()) {
            QalaText(detail, Modifier.padding(top = 6.dp), QalaType.log.copy(fontSize = 11.5.sp, lineHeight = 16.sp), c.fgMuted)
        }
        Spacer(Modifier.height(14.dp))
        SecondaryButton(if (retrying) "Asking" else "Try again", onRetry, enabled = !retrying)
    }
}
