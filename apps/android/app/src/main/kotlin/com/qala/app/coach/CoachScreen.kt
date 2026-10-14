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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
import com.qala.design.Card
import com.qala.design.GroupLabel
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaTextField
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.SecondaryButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Coach (DESIGN 7.11, DECISIONS U8): the title with where the coach runs, chips for the day it is looking at, the
 * thread, the coach's suggested change next to the engine's, and the composer pinned over the tab bar. It reads the
 * [store] and writes only through it. A coach that cannot answer shows [UnavailableCard] under the thread and nothing
 * else changes: the tabs, the composer and every other screen keep working.
 *
 * It lays its own column on the shell's [scroll], with the composer pinned under it, as the check-in does with Save.
 * [topBar] is the shell's brand bar, which scrolls away with the content.
 */
@Composable
fun CoachScreen(
    store: CoachStore,
    day: CoachDay,
    gym: GymSettings,
    scroll: ScrollState,
    topBar: @Composable (Modifier) -> Unit,
) {
    val state by store.state.collectAsState()
    var draft by rememberSaveable { mutableStateOf("") }
    val focus = LocalFocusManager.current

    // Keep the newest turn in view: when a turn arrives, or the unavailable card appears, or the screen opens on a thread.
    LaunchedEffect(state.messages.size, state.sending, state.unavailable) {
        withFrameNanos { }
        withFrameNanos { }          // the second frame is the one laid out with the new turn
        scroll.animateScrollTo(scroll.maxValue)
    }

    fun send(text: String) {
        if (text.isBlank() || state.sending) return
        store.send(text, day.context)
        draft = ""
        focus.clearFocus()
    }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(scroll)
                .statusBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 16.dp),
        ) {
            topBar(Modifier)
            Spacer(Modifier.height(16.dp))
            CoachHead(state.unavailable)
            ContextChips(day.chips)
            Thread(state, day, gym, store)
            if (state.unavailable != null) {
                Spacer(Modifier.height(12.dp))
                UnavailableCard(state.unavailable!!, state.detail, onRetry = store::retry, retrying = state.sending)
            }
        }
        Composer(
            draft = draft,
            onDraft = { draft = it.take(CoachStore.MaxMessageChars) },
            onSend = { send(draft) },
            enabled = !state.sending,
        )
    }
}

/** The title with the status at its end: a square in the success colour while the coach answers, the muted colour once it can't. */
@Composable
private fun CoachHead(unavailable: Why?) {
    val c = Qala.colors
    Row(Modifier.fillMaxWidth().padding(bottom = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
        QalaText("Coach", Modifier.semantics { heading() }, QalaType.pageTitle, c.fg)
        Row(Modifier.padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(if (unavailable == null) c.success else c.fgMuted))
            QalaText(coachStatus(unavailable), style = QalaType.hint.copy(fontStyle = FontStyle.Normal, fontSize = 12.sp), color = c.fgMuted, maxLines = 1)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ContextChips(chips: List<String>) {
    if (chips.isEmpty()) return
    val c = Qala.colors
    val shape = RoundedCornerShape(QalaTokens.radius)
    FlowRow(Modifier.fillMaxWidth().padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        chips.forEach { chip ->
            QalaText(
                chip,
                Modifier
                    .background(c.bgSurface, shape)
                    .border(QalaTokens.borderWidth, c.border, shape)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                QalaType.button.copy(fontSize = 12.5.sp, lineHeight = 17.sp),
                c.fg,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun Thread(state: CoachState, day: CoachDay, gym: GymSettings, store: CoachStore) {
    if (state.messages.isEmpty()) {
        EmptyThread(day, enabled = !state.sending) { store.send(it, day.context) }
        return
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        state.messages.forEach { m ->
            Bubble(m)
            m.card?.let { card -> SuggestionCardView(card, day, gym) { store.decide(m.id, it) } }
        }
        if (state.sending) Thinking()
    }
}

/** The coach's opening line and a few questions to start from: tapping one asks it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmptyThread(day: CoachDay, enabled: Boolean, onAsk: (String) -> Unit) {
    val c = Qala.colors
    Card(contentPadding = 16.dp) {
        QalaText(
            "Ask about today's session, how you are recovering, or a number you don't understand. Anything it suggests as a change comes back as a card you can accept or keep the engine's.",
            style = QalaType.body.copy(fontSize = 14.sp, lineHeight = 21.sp),
            color = c.fgSecondary,
        )
    }
    Spacer(Modifier.height(12.dp))
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        day.starters.forEach { question ->
            SecondaryButton(question, onClick = { onAsk(question) }, small = true, enabled = enabled)
        }
    }
}

/** One turn: the coach's on a surface with a border at the start side, yours in ink at the end side (the web's thread). */
@Composable
private fun Bubble(m: CoachMessage) {
    val c = Qala.colors
    val mine = m.who == Who.You
    val shape = RoundedCornerShape(QalaTokens.radiusMd)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .then(
                    if (mine) Modifier.background(c.fg, shape)
                    else Modifier.background(c.bgSurface, shape).border(QalaTokens.borderWidth, c.border, shape),
                )
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            GroupLabel(if (mine) "You" else "Coach", color = if (mine) c.bgSurface.copy(alpha = 0.7f) else c.fgMuted)
            QalaText(
                m.text,
                Modifier.padding(top = 2.dp),
                QalaType.body.copy(fontSize = 14.sp, lineHeight = 21.sp),
                if (mine) c.bgSurface else c.fg,
            )
        }
    }
}

/** A line under the thread while a request is out. The composer stays usable for typing; only Send waits. */
@Composable
private fun Thinking() {
    QalaText(
        "Coach is thinking",
        Modifier.padding(start = 2.dp).semantics { liveRegion = LiveRegionMode.Polite },
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
    Card(contentPadding = 16.dp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
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

/** The text field and Send, over a hairline and the ground colour, above the tab bar. */
@Composable
private fun Composer(draft: String, onDraft: (String) -> Unit, onSend: () -> Unit, enabled: Boolean) {
    val c = Qala.colors
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.bg)
            .drawBehind { drawRect(c.border, Offset.Zero, Size(size.width, QalaTokens.borderWidth.toPx())) }
            .padding(start = 16.dp, end = 16.dp, top = 10.dp + QalaTokens.borderWidth, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QalaTextField(
            value = draft,
            onValueChange = onDraft,
            placeholder = "Ask about training, recovery...",
            label = "Ask the coach",
            modifier = Modifier.weight(1f),
            onDone = onSend,
        )
        PrimaryButton("Send", onSend, Modifier.width(84.dp), enabled = enabled && draft.isNotBlank())
    }
}
