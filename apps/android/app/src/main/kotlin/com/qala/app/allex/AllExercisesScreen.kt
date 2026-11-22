package com.qala.app.allex

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.ScreenHead
import com.qala.design.Wash
import com.qala.design.WashCard
import com.qala.design.WashPage
import com.qala.design.WashScrim

/**
 * All exercises (DESIGN 7.7, S51 board AllExercises): the zoomed-out grid of the day on the wash, one white card per exercise with a box
 * per set, done sets filled and the current exercise ringed in ember. It is the one grid of the lifting flow: Warm-up, Workout and Rest
 * each open it from their header, and its Back returns to whichever did.
 *
 * With a workout in progress for [day] it shows that workout live, and a card jumps to its exercise in the workout
 * ([onWorkout] opens it). With none (the warm-up comes first) it shows the program's day as it will be lifted, and the
 * cards stay put because there is no workout to jump into yet. [day] is today's program day, null on a day with no lift.
 */
@Composable
fun AllExercisesScreen(day: Int?, onBack: () -> Unit, onWorkout: () -> Unit) {
    val c = Qala.colors
    val store = LocalAppContainer.current.workout
    val workout by store.state.collectAsState()
    val live = workout?.takeIf { it.day == day }
    val preview by produceState<AllExState>(AllExState.Loading, day, live == null) {
        value = when {
            day == null -> AllExState.NoDay
            live != null -> AllExState.Loading          // not read: the live state is shown
            else -> store.preview(day)?.let { AllExState.Ready(it, live = false) } ?: AllExState.NoDay
        }
    }
    val state = if (live != null) AllExState.Ready(live, live = true) else preview

    WashPage(
        rememberScrollState(),
        WashScrim.Soft,
        head = { ScreenHead("All exercises", eyebrow = (state as? AllExState.Ready)?.state?.let { "${it.programName} · ${it.dayName}" }, onBack = onBack) },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            when (state) {
                AllExState.Loading -> Sub("Getting your day ready.")
                AllExState.NoDay -> WashCard {
                    QalaText("Nothing to lift today, so there are no exercises to show.", style = QalaType.hint, color = c.fgMuted)
                }
                is AllExState.Ready -> {
                    Sub(allExSummary(state.state))
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        for (row in allExCards(state.state).chunked(2)) {
                            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                for (card in row) {
                                    ExerciseCard(
                                        card,
                                        Modifier.weight(1f).fillMaxHeight(),
                                        onClick = if (state.live) ({ store.show(card.number - 1); onWorkout() }) else null,
                                    )
                                }
                                if (row.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    Sub(if (state.live) "Tap any exercise to jump to it. The order is yours to choose." else "The order is yours to choose; history keeps it.")
                }
            }
        }
        Spacer(Modifier.navigationBarsPadding())          // the lifting flow has no tab bar, so nothing else keeps the last row off the system bar
    }
}

/** A line of white text on the wash under the head or the grid. */
@Composable
private fun Sub(text: String) {
    QalaText(text, style = QalaType.body.copy(fontSize = 13.sp, lineHeight = 17.sp, shadow = Wash.TextShadow), color = Wash.Text2)
}

/** The ring round the current card: 3 dp of ember just outside its edge, drawn over the card's own shadow as the board's box-shadow stack does. */
private fun Modifier.currentRing(): Modifier = drawWithContent {
    drawContent()
    val w = 3.dp.toPx()
    drawRoundRect(
        Wash.ChartEmber,
        Offset(-w / 2, -w / 2),
        Size(size.width + w, size.height + w),
        CornerRadius(QalaTokens.radiusLg.toPx() + w / 2),
        style = Stroke(w),
    )
}

/** One exercise: its number (bold and in the accent on the current one), name, prescription and a box per set, filled once the set is done. */
@Composable
private fun ExerciseCard(card: AllExCard, modifier: Modifier, onClick: (() -> Unit)?) {
    val c = Qala.colors
    WashCard(
        modifier
            .then(if (card.current) Modifier.currentRing() else Modifier)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClickLabel = "Go to ${card.name}", onClick = onClick) else Modifier)
            .semantics(mergeDescendants = true) { contentDescription = allExDescription(card) },
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QalaText(card.name, Modifier.weight(1f), QalaType.bodyStrong.copy(fontSize = 14.sp, lineHeight = 18.sp), c.fg)
            QalaText(
                "${card.number}",
                style = QalaType.body.copy(fontSize = 12.sp, lineHeight = 18.sp, fontWeight = if (card.current) FontWeight.Bold else FontWeight.Normal),
                color = if (card.current) c.accent else c.fgMuted,
            )
        }
        QalaText(card.line, Modifier.padding(top = 2.dp), QalaType.body.copy(fontSize = 12.sp, lineHeight = 16.sp), c.fgSecondary)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            card.done.forEach { done ->
                Box(
                    Modifier
                        .size(14.dp)
                        .background(if (done) c.progressFill else Color.Transparent, RoundedCornerShape(3.dp))
                        .border(1.dp, if (done) c.progressFill else c.fgMuted, RoundedCornerShape(3.dp)),
                )
            }
        }
    }
}
