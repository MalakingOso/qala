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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.zIndex
import com.qala.app.settings.SettingsFocus
import com.qala.app.run.RunState
import com.qala.app.skip.SkipSheet
import com.qala.app.today.Destination
import com.qala.app.today.TodayLoad
import com.qala.app.today.TodayMenu
import com.qala.app.today.TodayUiState
import com.qala.app.today.todayLoad
import com.qala.data.model.AppearanceSettings
import com.qala.data.model.ThemeMode
import com.qala.data.model.TitleFont
import com.qala.design.ContentMaxWidth
import com.qala.design.FaustinaFamily
import com.qala.design.QalaTestFamily
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaTheme
import com.qala.design.TabBar
import com.qala.design.TabItem
import com.qala.design.TopBar

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
 * The day menu is composed here, after the shell's own [BackHandler], so its handler registers later and wins while
 * the menu is open, and so its scrim covers the tab bar and the status bar too.
 */
@Composable
fun QalaApp() {
    val container = LocalAppContainer.current
    // Settings' Appearance: Light, Dark or System, and the face of the titles. Light and Qala Test until the stored choice has been read.
    val look by remember(container) { container.settings.gym.map { it.appearance }.distinctUntilChanged() }.collectAsState(initial = AppearanceSettings())
    val dark = when (look.theme) {
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
        ThemeMode.System -> isSystemInDarkTheme()
    }
    SystemBars(dark)
    QalaTheme(dark, if (look.titleFont == TitleFont.Faustina) FaustinaFamily else QalaTestFamily) {
        var nav by rememberSaveable(stateSaver = Nav.Saver) { mutableStateOf(Nav()) }
        // The plate calculator's Edit plates lands on Settings scrolled to the inventory.
        var settingsFocus by remember { mutableStateOf<SettingsFocus?>(null) }
        val back = nav.back()
        BackHandler(enabled = back != null) { back?.let { nav = it } }

        // A run that is recording or waiting on its Summary opens its screen once, when the app comes up with it.
        val runState by container.runRecording.state.collectAsState()
        var runOpened by rememberSaveable { mutableStateOf(false) }
        LaunchedEffect(runState !is RunState.Idle) {
            if (runState !is RunState.Idle && !runOpened) {
                runOpened = true
                if (nav.route != Route.Run) nav = nav.push(Route.Run)
            }
        }

        // A tapped rest notification opens Rest over the workout it belongs to.
        val requested by container.pendingRoute.collectAsState()
        LaunchedEffect(requested) {
            when (requested) {
                Route.Rest -> nav = Nav(Route.Workout).push(Route.Rest)
                Route.Run -> nav = Nav().push(Route.Run)
                else -> {}
            }
            if (requested != null) container.pendingRoute.value = null
        }

        val use24h = DateFormat.is24HourFormat(LocalContext.current)
        val snapshot by container.engine.snapshot.collectAsState()
        val resume by container.workout.hasDraft.collectAsState()
        val today = remember(snapshot, use24h, resume) { todayLoad(snapshot, use24h, resume) }
        val ui = remember { TodayUiState() }
        LaunchedEffect(nav.route) { if (nav.route != Route.Today) ui.reset() }

        Box(Modifier.fillMaxSize().background(Qala.colors.bg), contentAlignment = Alignment.TopCenter) {
            // Content scrolls under the status bar; this keeps the clock and icons readable over it.
            Spacer(
                Modifier
                    .align(Alignment.TopStart)
                    .fillMaxWidth()
                    .windowInsetsTopHeight(WindowInsets.statusBars)
                    .background(Qala.colors.bg)
                    .zIndex(1f),
            )
            Column(
                Modifier
                    .widthIn(max = ContentMaxWidth)
                    .fillMaxSize()
                    .then(if (nav.route == Route.CheckIn || nav.route == Route.Coach || nav.route == Route.PlanPicker) Modifier.imePadding() else Modifier)      // the note, the coach's composer and the starting weights stay above the keyboard
                    .semantics { if (ui.skip.open) hideFromAccessibility() },                        // the skip sheet is modal: the screen behind it is not reachable
            ) {
                key(nav.route) {       // each screen keeps its own scroll position
                    val scroll = rememberScrollState()
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        Screen(
                            route = nav.route,
                            scroll = scroll,
                            today = today,
                            snapshot = snapshot,
                            ui = ui,
                            topBar = { modifier ->
                                TopBar(
                                    onHistory = { nav = nav.push(Route.History) },
                                    onSettings = { nav = nav.push(Route.Settings) },
                                    modifier = modifier,
                                )
                            },
                            onGo = { to ->
                                if (to == Destination.Skip) (today as? TodayLoad.Ready)?.let { ui.skip.show(it.model.skip) } else nav = nav.go(to)
                            },
                            onBack = { nav.back()?.let { nav = it } },
                            onPlates = { nav = nav.push(Route.Plates) },
                            onEditPlates = { settingsFocus = SettingsFocus.Plates; nav = nav.push(Route.Settings) },
                            onPush = { nav = nav.push(it) },
                            settingsFocus = settingsFocus,
                            onSettingsFocused = { settingsFocus = null },
                        )
                    }
                }
                // The lifting flow has no tab bar: a thumb mid-set should not land on Plan, and the screens want the height.
                if (!nav.route.isFocus) {
                    TabBar(
                        items = Route.tabs.map { TabItems.getValue(it) },
                        selectedIndex = Route.tabs.indexOf(nav.route.tab),
                        onSelect = { nav = nav.selectTab(Route.tabs[it]) },
                    )
                }
            }
            if (nav.route == Route.Today) TodayMenu(today, ui, Modifier.zIndex(2f))
            // Change on Settings' Training status opens the same sheet over Settings.
            if (nav.route == Route.Today || nav.route == Route.Settings) SkipSheet(ui.skip, Modifier.zIndex(3f))
        }
    }
}

/** The status and navigation bars follow the app's own theme, not the system's: Light on a dark phone still needs dark icons. */
@Composable
private fun SystemBars(dark: Boolean) {
    var context = LocalContext.current
    while (context is ContextWrapper && context !is ComponentActivity) context = context.baseContext
    val activity = context as? ComponentActivity ?: return
    SideEffect {
        val bars = if (dark) SystemBarStyle.dark(AndroidColor.TRANSPARENT) else SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
        activity.enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
    }
}
