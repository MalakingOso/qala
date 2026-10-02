package com.qala.app.settings

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.data.model.SettingsRecord
import com.qala.design.Card
import com.qala.design.DayStrip
import com.qala.design.FlowHead
import com.qala.design.Group
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaType
import kotlinx.coroutines.launch

/**
 * Settings. For now one group, Training days (the weekday picker); units, equipment and the title font arrive with the
 * rest of A1. Each tap writes `trainingWeekdays` through the settings repository, and Today's day kind and the week card
 * follow because they observe the same flow. The strip shows the tap at once and hands over to the stored value when it
 * catches up, so two quick taps do not undo each other.
 */
@Composable
fun SettingsScreen(scroll: ScrollState, onBack: () -> Unit) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    val stored by container.settings.settings.collectAsState(initial = SettingsRecord())
    var pending by remember { mutableStateOf<List<Int>?>(null) }
    LaunchedEffect(stored.trainingWeekdays) { if (pending == stored.trainingWeekdays.sorted()) pending = null }
    val days = pending ?: stored.trainingWeekdays.sorted()

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .statusBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
    ) {
        FlowHead("Settings", onBack)

        Group("Training days") {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                QalaText(WeekdayExplanation, Modifier.padding(bottom = 12.dp), QalaType.body.copy(fontSize = 12.5.sp, lineHeight = 17.sp), c.fgSecondary)
                DayStrip(
                    labels = WeekdayLabels,
                    names = WeekdayNames,
                    picked = days.toSet(),
                    onToggle = { day ->
                        val next = toggleWeekday(days, day)
                        if (next != days) {
                            pending = next
                            container.scope.launch { container.settings.setTrainingWeekdays(next) }
                        }
                    },
                    groupLabel = "Training days",
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp).semantics(mergeDescendants = true) { contentDescription = weekdaySummary(days) },
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    QalaText(weekdayCount(days), style = QalaType.bodyStrong.copy(fontSize = 12.5.sp, lineHeight = 17.sp), color = c.fg)
                    QalaText(weekdayNames(days), style = QalaType.body.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgMuted)
                }
                QalaText(
                    weekdayWarning(days).orEmpty(),
                    Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
                    QalaType.body.copy(fontSize = 12.sp, lineHeight = 17.sp),
                    c.fgSecondary,
                )
            }
        }

        Card(Modifier.padding(top = 14.dp)) {
            QalaText("Units, equipment and the title font arrive with the rest of A1.", style = QalaType.hint, color = c.fgMuted)
        }
    }
}
