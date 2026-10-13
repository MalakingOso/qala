package com.qala.app.allex

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.qala.app.LocalAppContainer
import com.qala.design.Card
import com.qala.design.FlowHead
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaTokens
import com.qala.design.QalaType

/**
 * All exercises (DESIGN 7.7): the zoomed-out grid of the day, one card per exercise with a box per set, done sets
 * filled and the current exercise outlined in ember. It is the one grid of the lifting flow: Warm-up, Workout and Rest
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

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
    ) {
        FlowHead("All exercises", onBack, eyebrow = (state as? AllExState.Ready)?.state?.let { "${it.programName} · ${it.dayName}" })
        when (state) {
            AllExState.Loading -> QalaText("Getting your day ready.", style = QalaType.hint, color = c.fgMuted)
            AllExState.NoDay -> Card {
                QalaText("Nothing to lift today, so there are no exercises to show.", style = QalaType.hint, color = c.fgMuted)
            }
            is AllExState.Ready -> {
                QalaText(allExSummary(state.state), style = QalaType.hint, color = c.fgMuted)
                Spacer(Modifier.height(14.dp))
                for (row in allExCards(state.state).chunked(2)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        for (card in row) {
                            ExerciseCard(
                                card,
                                Modifier.weight(1f),
                                onClick = if (state.live) ({ store.show(card.number - 1); onWorkout() }) else null,
                            )
                        }
                        if (row.size == 1) Spacer(Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(12.dp))
                }
                QalaText(
                    if (state.live) "Tap any exercise to jump to it. The order is yours to choose." else "The order is yours to choose; history keeps it.",
                    style = QalaType.hint,
                    color = c.fgMuted,
                )
            }
        }
    }
}

/** One exercise: its number (in ember on the current one), name, prescription and a box per set, filled once the set is done. */
@Composable
private fun ExerciseCard(card: AllExCard, modifier: Modifier, onClick: (() -> Unit)?) {
    val c = Qala.colors
    Card(
        modifier
            .then(if (card.current) Modifier.border(2.dp, c.accent, RoundedCornerShape(QalaTokens.radiusMd)) else Modifier)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClickLabel = "Go to ${card.name}", onClick = onClick) else Modifier)
            .semantics(mergeDescendants = true) { contentDescription = allExDescription(card) },
        contentPadding = 12.dp,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QalaText(card.name, Modifier.weight(1f), style = QalaType.bodyStrong)
            QalaText("${card.number}", style = QalaType.hint, color = if (card.current) c.accent else c.fgMuted)
        }
        QalaText(card.line, style = QalaType.hint, color = c.fgMuted)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            card.done.forEach { done ->
                Box(
                    Modifier
                        .size(14.dp)
                        .background(if (done) c.progressFill else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(3.dp))
                        .border(1.dp, if (done) c.progressFill else c.borderStrong, RoundedCornerShape(3.dp)),
                )
            }
        }
    }
}
