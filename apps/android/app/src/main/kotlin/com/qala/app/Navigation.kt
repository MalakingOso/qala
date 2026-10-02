package com.qala.app

import androidx.compose.runtime.saveable.Saver

/**
 * The seven places the shell can show. Five are tabs; History and Settings are pushed over a tab.
 * Navigation Compose versus Navigation 3 stays open until A4, when real back stacks and arguments appear.
 */
sealed interface Route {
    val id: String

    data object Today : Route { override val id = "today" }
    data object Plan : Route { override val id = "plan" }
    data object Body : Route { override val id = "body" }
    data object Progress : Route { override val id = "progress" }
    data object Coach : Route { override val id = "coach" }
    data object History : Route { override val id = "history" }
    data object Settings : Route { override val id = "settings" }

    companion object {
        val tabs: List<Route> = listOf(Today, Plan, Body, Progress, Coach)
        private val all: List<Route> = tabs + History + Settings

        fun fromId(id: String): Route = all.firstOrNull { it.id == id } ?: Today
    }
}

val Route.isPushed: Boolean get() = this == Route.History || this == Route.Settings

/** The tab to highlight: History and Settings count as Today, as they do on the web. */
val Route.tab: Route get() = if (isPushed) Route.Today else this

/** Where the user is, and the tab a pushed screen returns to. */
data class Nav(val route: Route = Route.Today, val origin: Route = Route.Today) {
    fun selectTab(tab: Route) = Nav(tab, Route.Today)

    fun push(screen: Route) = Nav(screen, if (route.isPushed) origin else route)

    /** The state after Back, or null at the root (Today), where Back leaves the app. */
    fun back(): Nav? = when {
        route.isPushed -> Nav(origin, Route.Today)
        route != Route.Today -> Nav(Route.Today, Route.Today)
        else -> null
    }

    companion object {
        val Saver: Saver<Nav, List<String>> = Saver(
            save = { listOf(it.route.id, it.origin.id) },
            restore = { Nav(Route.fromId(it[0]), Route.fromId(it[1])) },
        )
    }
}
