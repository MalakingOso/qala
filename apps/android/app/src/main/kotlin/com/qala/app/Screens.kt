package com.qala.app

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.qala.app.checkin.CheckInScreen
import com.qala.app.plates.PlatesScreen
import com.qala.app.settings.SettingsScreen
import com.qala.app.today.Destination
import com.qala.app.today.TodayLoad
import com.qala.app.today.TodayScreen
import com.qala.app.today.TodayUiState
import com.qala.design.Card
import com.qala.design.PageHead
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaType
import kotlinx.coroutines.launch

/**
 * The screen for [route], filling the shell's content box. Today brings its own scroll column and fixed layers; every
 * other screen is the same header over a padded column.
 */
@Composable
fun Screen(
    route: Route,
    scroll: ScrollState,
    today: TodayLoad,
    ui: TodayUiState,
    topBar: @Composable (Modifier) -> Unit,
    onGo: (Destination) -> Unit,
    onBack: () -> Unit,
    onPlates: () -> Unit,
    onEditPlates: () -> Unit,
) {
    when (route) {
        Route.Today -> TodayScreen(today, ui, scroll, topBar, onGo)
        Route.Plan -> Plain(scroll, topBar) { StubScreen("Plan", "Week and block view. Arrives with the lifting screens (A4).") }
        Route.Body -> Plain(scroll, topBar) { StubScreen("Body", "Measurements and recovery. Arrives with the stats screens (A5).") }
        Route.Progress -> Plain(scroll, topBar) { StubScreen("Progress", "Charts and records. Arrives with the stats screens (A5).") }
        Route.Coach -> Plain(scroll, topBar) { StubScreen("Coach", "Chat and suggestions. Arrives with the coach route (A6).") }
        Route.History -> Plain(scroll, topBar) { StubScreen("History", "Past sessions. Arrives with the rest of A1.") }
        Route.Settings -> SettingsScreen(scroll, onBack, onPlates)
        Route.Plates -> PlatesScreen(scroll, onBack, onEditPlates)
        Route.CheckIn -> CheckInRoute(today, scroll, topBar, onBack)
        Route.WarmUp -> Plain(scroll, topBar) { WarmUpStub(onBack) }
        Route.Workout -> Plain(scroll, topBar) { WorkoutStub(onBack) }
        Route.Run -> Plain(scroll, topBar) { RunStub(onBack) }
    }
}

/** A scrolling screen under the brand bar, with the 20 dp page gutters. */
@Composable
private fun Plain(scroll: ScrollState, topBar: @Composable (Modifier) -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
        Column(Modifier.statusBarsPadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
            topBar(Modifier)
            Spacer(Modifier.height(16.dp))
            content()
        }
    }
}

/** The check-in over the day Today is showing; Save writes the record on the container's scope and goes home. */
@Composable
private fun CheckInRoute(today: TodayLoad, scroll: ScrollState, topBar: @Composable (Modifier) -> Unit, onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val model = (today as? TodayLoad.Ready)?.model
    if (model == null) {
        Plain(scroll, topBar) { StubScreen("Check-in", "Getting your day ready.") }
        return
    }
    CheckInScreen(model.checkIn, scroll, onBack) { save ->
        // The container's scope, not the screen's: going back leaves the screen, and a Room write must not be cancelled half way.
        container.scope.launch { container.checkIns.save(save.recovery, save.soreness, save.note) }
        onBack()
    }
}

@Composable
private fun StubScreen(title: String, note: String) {
    PageHead(title)
    Card {
        QalaText(note, style = QalaType.hint, color = Qala.colors.fgMuted)
    }
}
