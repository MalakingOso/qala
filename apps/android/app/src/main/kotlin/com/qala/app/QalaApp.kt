package com.qala.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.qala.design.ContentMaxWidth
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

/** The shell: header, one screen, tab bar. Content is capped at 560 dp and scrolls under the system bars. */
@Composable
fun QalaApp() {
    QalaTheme {
        var nav by rememberSaveable(stateSaver = Nav.Saver) { mutableStateOf(Nav()) }
        val back = nav.back()
        BackHandler(enabled = back != null) { back?.let { nav = it } }

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
            Column(Modifier.widthIn(max = ContentMaxWidth).fillMaxSize()) {
                key(nav.route) {       // each screen keeps its own scroll position
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                        Column(Modifier.statusBarsPadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
                            TopBar(
                                onHistory = { nav = nav.push(Route.History) },
                                onSettings = { nav = nav.push(Route.Settings) },
                            )
                            Spacer(Modifier.height(16.dp))
                            Screen(nav.route)
                        }
                    }
                }
                TabBar(
                    items = Route.tabs.map { TabItems.getValue(it) },
                    selectedIndex = Route.tabs.indexOf(nav.route.tab),
                    onSelect = { nav = nav.selectTab(Route.tabs[it]) },
                )
            }
        }
    }
}
