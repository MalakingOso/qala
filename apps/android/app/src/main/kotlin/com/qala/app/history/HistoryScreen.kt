package com.qala.app.history

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.qala.app.LocalAppContainer
import com.qala.data.core.QalaCore
import com.qala.data.core.dayName
import com.qala.design.Card
import com.qala.design.FlowHead
import com.qala.design.Group
import com.qala.design.GroupRow
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/**
 * History: every session from Room, newest first, grouped by week. Lift rows show the volume and
 * minutes the session recorded; marked-done sessions, which have no sets, say so instead of
 * reading as empty workouts. Reached from the shell's header History button, as on the web.
 */
@Composable
fun HistoryScreen(scroll: ScrollState, onBack: () -> Unit) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    val lifts by container.sessions.liftSessions.collectAsState(initial = emptyList())
    val runs by container.runs.runs.collectAsState(initial = emptyList())
    val snapshot by container.engine.snapshot.collectAsState()
    val active by container.programs.active.collectAsState(initial = null)
    val exerciseData by container.settings.exerciseData.collectAsState(initial = JsonObject(emptyMap()))
    val dayIndexes = lifts.mapNotNull { it.session.programDayIndex }.distinct()
    val dayNames by produceState<Map<Int, String>>(emptyMap(), active, dayIndexes, snapshot.unit, exerciseData) {
        value = withContext(Dispatchers.Default) {
            val program = active ?: return@withContext emptyMap()
            val evaluated = container.programEngine.evaluate(program.text, program.name, snapshot.unit, exerciseData)
            dayIndexes.mapNotNull { day -> QalaCore.dayName(evaluated.program, day)?.let { day to it } }.toMap()
        }
    }
    val weeks = historyWeeks(lifts, runs, dayNames, snapshot.unit)

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .statusBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
    ) {
        FlowHead("History", onBack)
        if (weeks.isEmpty()) {
            Card {
                QalaText("No sessions yet. Finish a day and it lands here.", style = QalaType.hint, color = c.fgMuted)
            }
        } else {
            for (week in weeks) {
                Group(week.label) {
                    week.rows.forEachIndexed { i, row ->
                        GroupRow(Modifier.semantics(mergeDescendants = true) {}, last = i == week.rows.lastIndex) {
                            QalaIcon(
                                if (row.kind == HistoryKind.Lift) QalaIcons.Dumbbell else QalaIcons.SportShoe,
                                null,
                                size = 18.dp,
                                tint = c.fgSecondary,
                            )
                            Column {
                                QalaText(row.title, style = QalaType.bodyStrong)
                                QalaText("${row.day} · ${row.detail}", style = QalaType.hint, color = c.fgMuted)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
            }
        }
        if (weeks.isNotEmpty()) {
            QalaText(
                "History starts cold. Every session lands here and replays into the engine.",
                style = QalaType.hint,
                color = c.fgMuted,
            )
        }
    }
}
