package com.qala.app

import android.content.ContextWrapper
import android.graphics.Color as AndroidColor
import android.text.format.DateFormat
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.qala.app.settings.SettingsFocus
import com.qala.app.workout.Alerts
import com.qala.app.workout.AppVisibility
import com.qala.app.workout.FlowBackdrop
import com.qala.app.workout.HandOver
import com.qala.app.workout.HandOverCurve
import com.qala.app.workout.HandOverVeil
import com.qala.app.workout.WorkoutEvent
import com.qala.app.run.RunState
import com.qala.app.skip.SkipSheet
import com.qala.app.today.Destination
import com.qala.app.today.TodayLoad
import com.qala.app.today.TodayUiState
import com.qala.app.today.todayLoad
import com.qala.data.model.AppearanceSettings
import com.qala.data.model.ThemeMode
import com.qala.data.model.TitleFont
import com.qala.design.ContentMaxWidth
import com.qala.design.FaustinaFamily
import com.qala.design.LocalBarClearance
import com.qala.design.TabBarHeight
import com.qala.design.QalaTestFamily
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaTheme
import com.qala.design.TabBar
import com.qala.design.TabItem
import com.qala.design.animationsEnabled
import kotlinx.coroutines.launch

private val TabItems = mapOf(
    Route.Today to TabItem("Today", QalaIcons.Sun),
    Route.Plan to TabItem("Plan", QalaIcons.CalendarRange),
    Route.Body to TabItem("Body", QalaIcons.Activity),
    Route.Progress to TabItem("Progress", QalaIcons.TrendingUp),
    Route.Coach to TabItem("Coach", QalaIcons.MessageSquareText),
)

/**
 * The shell: one screen over a tab bar, with the window's fixed layers on top. Content is capped at 560 dp. Each route
 * gets a [Box] to fill, so a screen can host layers that do not scroll (Today's rail and pinned head) beside its own
 * scroll column, and the shell hands it the [ScrollState] it owns. The brand bar is the screen's to place, since on
 * Today it scrolls away with the content.
 *
 * Every deliberate push out of Today hands over to the wash rather than cut (S49, S51): Start warm-up, Resume workout, Check-in, Run, History
 * and Settings. A softened still fades in over Today and its film, the shell swaps screens under it, and it fades out to the wash as the new
 * screen's content comes in. A tap on a tab in the island is a plain swap. [animate] overrides whether system animations are on (a test sets
 * it); the default reads the system, and with them off the hand-over is a plain swap.
 */
@Composable
fun QalaApp(animate: Boolean? = null) {
    val container = LocalAppContainer.current
    // Settings' Appearance: Light, Dark or System, and the face of the titles. Light and Qala Test until the stored choice has been read.
    val look by remember(container) { container.settings.gym.map { it.appearance }.distinctUntilChanged() }.collectAsState(initial = AppearanceSettings())
    val dark = when (look.theme) {
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
        ThemeMode.System -> isSystemInDarkTheme()
    }
    QalaTheme(dark, if (look.titleFont == TitleFont.Faustina) FaustinaFamily else QalaTestFamily) {
        var nav by rememberSaveable(stateSaver = Nav.Saver) { mutableStateOf(Nav()) }
        SystemBars()
        val handOver = remember { HandOver() }
        val scope = rememberCoroutineScope()
        // The plate calculator's Edit plates lands on Settings scrolled to the inventory.
        var settingsFocus by remember { mutableStateOf<SettingsFocus?>(null) }
        val back = nav.back()
        BackHandler(enabled = back != null) { back?.let { nav = it } }
        BackHandler(enabled = handOver.running) {}          // registered after the one above, so it wins: Back does nothing mid-flight

        // A run that is recording or waiting on its Summary opens its screen once, when the app comes up with it.
        val runState by container.runRecording.state.collectAsState()
        var runOpened by rememberSaveable { mutableStateOf(false) }
        LaunchedEffect(runState !is RunState.Idle) {
            if (runState !is RunState.Idle && !runOpened) {
                runOpened = true
                if (nav.route != Route.Run) nav = nav.push(Route.Run)
            }
        }

        // A tapped workout notification opens Rest while one is running, else the workout (or its warm-up, before the lifting began).
        // It waits for the stored draft to be taken up, so after a killed process it still knows where to go.
        val requested by container.pendingRoute.collectAsState()
        LaunchedEffect(requested) {
            when (requested) {
                Route.Workout -> {
                    container.workout.awaitLoaded()
                    val open = container.workout.state.value
                    nav = when {
                        open == null -> Nav()
                        open.rest != null -> Nav(Route.Workout).push(Route.Rest)
                        !open.liftStarted -> Nav().push(Route.WarmUp)
                        else -> Nav(Route.Workout)
                    }
                }
                Route.Run -> nav = Nav().push(Route.Run)
                else -> {}
            }
            if (requested != null) container.pendingRoute.value = null
        }

        // The timers answer to the whole app, not to Rest: the warning buzzes and ticks, the end buzzes and, from any screen but a
        // run or the summary, jumps to the workout with the next set open. The rest itself stays open until that set is logged.
        val context = LocalContext.current
        val haptic = LocalHapticFeedback.current
        val alerts = remember(context, haptic) { Alerts(context, haptic) }
        val latest by rememberUpdatedState(nav)
        val alertSetting by container.workout.gym.collectAsState()
        val alertNow by rememberUpdatedState(alertSetting.rest.alert)
        LaunchedEffect(container) {
            container.workout.events.collect { event ->
                if (!AppVisibility.visible) return@collect
                when (event) {
                    is WorkoutEvent.RestWarning -> alerts.warn()
                    is WorkoutEvent.CardioOver -> alerts.over(alertNow)
                    is WorkoutEvent.RestOver -> {
                        alerts.over(alertNow)
                        event.next?.let { container.workout.show(it.exercise, it.set) }
                        if (latest.route != Route.Workout && latest.route != Route.Run && latest.route != Route.SessionComplete) nav = Nav(Route.Workout)
                    }
                }
            }
        }

        val use24h = DateFormat.is24HourFormat(LocalContext.current)
        val snapshot by container.engine.snapshot.collectAsState()
        val resume by container.workout.hasDraft.collectAsState()
        val resumeWarmup by container.workout.resumeAtWarmup.collectAsState()
        val today = remember(snapshot, use24h, resume, resumeWarmup) { todayLoad(snapshot, use24h, resume, resumeWarmup) }
        val ui = remember { TodayUiState() }
        LaunchedEffect(nav.route) { if (nav.route != Route.Today) ui.reset() }

        // The shell's one call for the route's screen; each route gets a Box to fill, and the scroll state it owns.
        val screen: @Composable (ScrollState) -> Unit = { scroll ->
            Screen(
                route = nav.route,
                scroll = scroll,
                today = today,
                snapshot = snapshot,
                ui = ui,
                onGo = { to ->
                    when {
                        handOver.running -> {}                  // a second tap during the hand-over is ignored
                        to == Destination.Skip -> (today as? TodayLoad.Ready)?.let { ui.skip.show(it.model.skip) }
                        nav.route == Route.Today && to in HandedOver && (animate ?: animationsEnabled(context)) ->
                            scope.launch {
                                // Only if Today is still where the shell is: a notification or a rest ending may have moved it meanwhile.
                                handOver.run { if (latest.route == Route.Today) nav = latest.go(to) }
                            }
                        else -> nav = nav.go(to)
                    }
                },
                onBack = { nav.back()?.let { nav = it } },
                onPlates = { nav = nav.push(Route.Plates) },
                onEditPlates = { settingsFocus = SettingsFocus.Plates; nav = nav.push(Route.Settings) },
                onPush = { nav = nav.push(it) },
                settingsFocus = settingsFocus,
                onSettingsFocused = { settingsFocus = null },
            )
        }
        val tabBar: @Composable (Modifier) -> Unit = { modifier ->
            TabBar(
                items = Route.tabs.map { TabItems.getValue(it) },
                selectedIndex = Route.tabs.indexOf(nav.route.tab),
                onSelect = { nav = nav.selectTab(Route.tabs[it]) },
                modifier = modifier,
            )
        }

        Box(Modifier.fillMaxSize().background(Qala.colors.bg), contentAlignment = Alignment.TopCenter) {
            if (nav.route.onWash) FlowBackdrop()
            if (nav.route == Route.Today) {
                // Today is full window: the film runs under the status bar and the tab bar, and the tab bar is dark glass over it.
                key(nav.route) {
                    val scroll = rememberScrollState()
                    Box(Modifier.fillMaxSize().semantics { if (ui.skip.open) hideFromAccessibility() }) {       // the skip sheet is modal: the screen behind it is not reachable
                        screen(scroll)
                        tabBar(Modifier.align(Alignment.BottomCenter))
                    }
                }
            } else {
                Column(
                    Modifier
                        .widthIn(max = ContentMaxWidth)
                        .fillMaxSize()
                        // The screen's content comes in as the second half of the hand-over runs; read in the layer, so a frame of it recomposes nothing.
                        .graphicsLayer { alpha = HandOverCurve.content(handOver.progress) }
                        .then(if (nav.route == Route.CheckIn || nav.route == Route.Coach || nav.route == Route.PlanPicker) Modifier.imePadding() else Modifier)      // the note, the coach's composer and the starting weights stay above the keyboard
                        .semantics { if (ui.skip.open) hideFromAccessibility() },                        // the skip sheet is modal: the screen behind it is not reachable
                ) {
                    // The tab bar floats over the screen and paints nothing behind it, so each screen scrolls clear of it by this much: its zone plus the
                    // navigation inset, and nothing where the lifting flow has no bar (a thumb mid-set should not land on Plan, and the screens want the height)
                    // or a keyboard is up.
                    val density = LocalDensity.current
                    val keyboardUp = WindowInsets.ime.getBottom(density) > 0
                    val clearance = if (nav.route.isFocus || keyboardUp) 0.dp else TabBarHeight + with(density) { WindowInsets.navigationBars.getBottom(density).toDp() }
                    CompositionLocalProvider(LocalBarClearance provides clearance) {
                        key(nav.route) {       // each screen keeps its own scroll position
                            val scroll = rememberScrollState()
                            Box(Modifier.weight(1f).fillMaxWidth()) { screen(scroll) }
                        }
                    }
                }
                if (!nav.route.isFocus) {
                    tabBar(Modifier.align(Alignment.BottomCenter).semantics { if (ui.skip.open) hideFromAccessibility() })
                }
            }
            // Change on Settings' Training status opens the same sheet over Settings.
            if (nav.route == Route.Today || nav.route == Route.Settings) SkipSheet(ui.skip, Modifier.zIndex(3f))
            HandOverVeil(handOver, Modifier.zIndex(10f))
        }
    }
}

/** The deliberate pushes out of Today that hand over to the wash; Plan and Body are tabs and swap plainly, and Skip opens a sheet. */
private val HandedOver = setOf(Destination.CheckIn, Destination.WarmUp, Destination.Workout, Destination.Run, Destination.History, Destination.Settings)

/**
 * The status and navigation bars are transparent with light icons on every route, whatever the theme: Today's film and the wash under every
 * other screen are dark in both.
 */
@Composable
private fun SystemBars() {
    var context = LocalContext.current
    while (context is ContextWrapper && context !is ComponentActivity) context = context.baseContext
    val activity = context as? ComponentActivity ?: return
    SideEffect {
        val bars = SystemBarStyle.dark(AndroidColor.TRANSPARENT)
        activity.enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
    }
}
