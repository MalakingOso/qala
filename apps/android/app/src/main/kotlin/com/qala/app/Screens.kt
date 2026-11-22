package com.qala.app

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.qala.app.allex.AllExercisesScreen
import com.qala.app.checkin.CheckInScreen
import com.qala.app.coach.CoachScreen
import com.qala.app.coach.coachDay
import com.qala.app.history.HistoryScreen
import com.qala.app.plates.PlatesScreen
import com.qala.app.plan.PlanPickerScreen
import com.qala.app.plan.PlanScreen
import com.qala.app.settings.SettingsFocus
import com.qala.app.settings.SettingsScreen
import com.qala.app.workout.RestScreen
import com.qala.app.workout.WarmupScreen
import com.qala.app.workout.WorkoutScreen
import com.qala.app.today.Destination
import com.qala.app.run.RunRoute
import com.qala.app.stats.BodyScreen
import com.qala.app.stats.ProgressScreen
import com.qala.app.stats.SessionCompleteScreen
import com.qala.app.today.TodayLoad
import com.qala.app.today.TodayScreen
import com.qala.app.today.TodayUiState
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.GymSettings
import com.qala.design.LocalBarClearance
import com.qala.design.Card
import com.qala.design.PageHead
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.WashScrim
import com.qala.design.WashScrimLayer
import kotlinx.coroutines.launch

/**
 * The screen for [route], filling the shell's content box. Today brings its own scroll column and fixed layers, and so
 * do the lifting screens (a pinned bar under their own scroll); the screens that have not moved to a page frame yet are the same
 * header over a padded column, and [topBar] is theirs alone (it goes with [Plain]). [onPush] opens a screen over this one (Workout opens
 * Rest, the warm-up opens Workout, and each of the three opens All exercises, whose Back returns to it). [settingsFocus] is the group
 * Settings opens scrolled to, if one sent the lifter there; Settings calls [onSettingsFocused] once it has scrolled.
 */
@Composable
fun Screen(
    route: Route,
    scroll: ScrollState,
    today: TodayLoad,
    snapshot: EngineSnapshot,
    ui: TodayUiState,
    topBar: @Composable (Modifier) -> Unit,
    onGo: (Destination) -> Unit,
    onBack: () -> Unit,
    onPlates: () -> Unit,
    onEditPlates: () -> Unit,
    onPush: (Route) -> Unit,
    settingsFocus: SettingsFocus? = null,
    onSettingsFocused: () -> Unit = {},
) {
    when (route) {
        Route.Today -> TodayScreen(today, ui, scroll, onGo)
        Route.Plan -> PlanScreen(snapshot, today, scroll, topBar, onGo, onChangePlan = { onPush(Route.PlanPicker) })
        Route.Body -> Plain(scroll, topBar) { BodyScreen(snapshot) }
        Route.Progress -> Plain(scroll, topBar) { ProgressScreen(snapshot) }
        Route.SessionComplete -> Plain(scroll, topBar) { SessionCompleteScreen(onBack) }
        Route.Coach -> CoachTab(snapshot, scroll, topBar)
        Route.History -> HistoryScreen(scroll, onBack)
        Route.Settings -> SettingsScreen(scroll, today, ui, settingsFocus, onSettingsFocused, onBack, onPlates)
        Route.Plates -> PlatesScreen(scroll, onBack, onEditPlates)
        Route.PlanPicker -> PlanPickerScreen(scroll, onBack)
        Route.CheckIn -> CheckInRoute(today, scroll, topBar, onBack)
        Route.WarmUp -> OnSoftWash {
            WarmupScreen(
                programDay(today), onBack,
                onStart = { onPush(Route.Workout) }, onSkip = { onPush(Route.Workout) }, onAllExercises = { onPush(Route.AllExercises) },
            )
        }
        Route.Workout -> OnSoftWash {
            WorkoutScreen(programDay(today), onBack, onRest = { onPush(Route.Rest) }, onAllExercises = { onPush(Route.AllExercises) }, onWarmup = { onPush(Route.WarmUp) }, onFinished = { onPush(Route.SessionComplete) })
        }
        Route.Rest -> OnSoftWash { RestScreen(onBack, onAllExercises = { onPush(Route.AllExercises) }) }
        Route.Run -> RunRoute(snapshot, onBack)
        Route.AllExercises -> OnSoftWash { AllExercisesScreen(programDay(today), onBack, onWorkout = { onPush(Route.Workout) }) }
    }
}

/** The program day Today has chosen for today, which the lifting screens open: null while Today is loading or on a day with no lift. */
private fun programDay(today: TodayLoad): Int? = (today as? TodayLoad.Ready)?.model?.plan?.programDay

/**
 * A scrolling screen under the brand bar, with the 20 dp page gutters. Transitional: the screens that still use it move to
 * [com.qala.design.WashPage], [com.qala.design.SheetPage] or [com.qala.design.GlassPage], and this goes with them.
 */
@Composable
private fun Plain(scroll: ScrollState, topBar: @Composable (Modifier) -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
        Column(Modifier.statusBarsPadding().padding(horizontal = 20.dp).padding(bottom = 32.dp + LocalBarClearance.current)) {
            topBar(Modifier)
            Spacer(Modifier.height(16.dp))
            content()
        }
    }
}

/**
 * Transitional, like [Plain]: a lifting screen that has not moved to [com.qala.design.WashPage] yet keeps the soft scrim the shell's
 * backdrop used to paint under it. A screen that has moved paints its own, so it comes out of this.
 */
@Composable
private fun OnSoftWash(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        WashScrimLayer(WashScrim.Soft)
        content()
    }
}

/** The Coach tab over the container's coach store, the day the engine snapshot describes, and the plates Settings holds. */
@Composable
private fun CoachTab(snapshot: EngineSnapshot, scroll: ScrollState, topBar: @Composable (Modifier) -> Unit) {
    val container = LocalAppContainer.current
    val gym by container.settings.gym.collectAsState(initial = GymSettings())
    val day = remember(snapshot) { coachDay(snapshot) }
    CoachScreen(container.coach, day, gym, scroll, topBar)
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
