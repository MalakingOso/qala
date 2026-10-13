package com.qala.app

import androidx.compose.runtime.saveable.Saver
import com.qala.app.today.Destination

/**
 * The places the shell can show. Five are tabs; History, Settings and the four stage stubs (check-in, warm-up,
 * workout, run) are pushed over a tab. Navigation Compose versus Navigation 3 stays open until A4, when real back
 * stacks and arguments appear.
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
    data object Plates : Route { override val id = "plates" }
    data object CheckIn : Route { override val id = "check-in" }
    data object WarmUp : Route { override val id = "warm-up" }
    data object Workout : Route { override val id = "workout" }
    data object Run : Route { override val id = "run" }

    companion object {
        val tabs: List<Route> = listOf(Today, Plan, Body, Progress, Coach)
        private val all: List<Route> = tabs + History + Settings + Plates + CheckIn + WarmUp + Workout + Run

        fun fromId(id: String): Route = all.firstOrNull { it.id == id } ?: Today
    }
}

val Route.isPushed: Boolean
    get() = when (this) {
        Route.History, Route.Settings, Route.Plates, Route.CheckIn, Route.WarmUp, Route.Workout, Route.Run -> true
        else -> false
    }

/** The tab to highlight: a pushed screen counts as Today, as History and Settings do on the web. */
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

/**
 * Where a Today button leads. The stage stubs are pushed over Today, so Back (or a stub's Mark done) comes home to
 * it; Plan and Body are tabs, and Settings is pushed over whatever tab is showing.
 */
fun Nav.go(to: Destination): Nav = when (to) {
    Destination.CheckIn -> push(Route.CheckIn)
    Destination.WarmUp -> push(Route.WarmUp)
    Destination.Workout -> push(Route.Workout)
    Destination.Run -> push(Route.Run)
    Destination.Plan -> selectTab(Route.Plan)
    Destination.Body -> selectTab(Route.Body)
    Destination.Settings -> push(Route.Settings)
    Destination.Skip -> this          // opens the skip sheet over Today: the shell handles it, nothing navigates
}
