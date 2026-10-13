package com.qala.app

import androidx.compose.runtime.saveable.Saver
import com.qala.app.today.Destination

/**
 * The places the shell can show. Five are tabs; History, Settings, check-in, the lifting flow (warm-up, workout, rest,
 * all exercises) and the run stub are pushed over a tab. Two screens have a parent of their own: Rest, which sits over
 * Workout, and All exercises, which sits over whichever flow screen opened it. A hand-written two-level model still
 * covers both, and Navigation Compose versus Navigation 3 stays open.
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
    data object AllExercises : Route { override val id = "allex" }
    data object CheckIn : Route { override val id = "check-in" }
    data object WarmUp : Route { override val id = "warm-up" }
    data object Workout : Route { override val id = "workout" }
    data object Rest : Route { override val id = "rest" }
    data object Run : Route { override val id = "run" }

    companion object {
        val tabs: List<Route> = listOf(Today, Plan, Body, Progress, Coach)
        private val all: List<Route> = tabs + History + Settings + Plates + CheckIn + WarmUp + Workout + Rest + Run + AllExercises

        fun fromId(id: String): Route = all.firstOrNull { it.id == id } ?: Today
    }
}

val Route.isPushed: Boolean
    get() = when (this) {
        Route.History, Route.Settings, Route.Plates, Route.CheckIn, Route.WarmUp, Route.Workout, Route.Rest, Route.Run, Route.AllExercises -> true
        else -> false
    }

/**
 * The lifting flow. It drops the tab bar: a thumb mid-set should not hit Plan, and the screens want the height. Back
 * and the screens' own buttons are the ways out. All exercises is the flow's zoom-out, so it is part of it.
 */
val Route.isFocus: Boolean
    get() = this == Route.WarmUp || this == Route.Workout || this == Route.Rest || this == Route.AllExercises

/** The tab to highlight: a pushed screen counts as Today, as History and Settings do on the web. */
val Route.tab: Route get() = if (isPushed) Route.Today else this

/**
 * Where the user is, the tab a pushed screen returns to, and, for All exercises, the flow screen it was opened from
 * (Warm-up, Workout or Rest), which is where its Back goes.
 */
data class Nav(val route: Route = Route.Today, val origin: Route = Route.Today, val parent: Route? = null) {
    fun selectTab(tab: Route) = Nav(tab, Route.Today)

    /** Pushes [screen] over this one. All exercises remembers the screen it was opened over; every other screen starts afresh. */
    fun push(screen: Route) = Nav(screen, if (route.isPushed) origin else route, parent = if (screen == Route.AllExercises) route else null)

    /**
     * The state after Back, or null at the root (Today), where Back leaves the app. Rest goes back to the workout under
     * it, and All exercises back to the screen it was opened from.
     */
    fun back(): Nav? = when {
        route == Route.Rest -> Nav(Route.Workout, origin)
        route == Route.AllExercises && parent != null -> Nav(parent, origin)
        route.isPushed -> Nav(origin, Route.Today)
        route != Route.Today -> Nav(Route.Today, Route.Today)
        else -> null
    }

    companion object {
        val Saver: Saver<Nav, List<String>> = Saver(
            save = { listOf(it.route.id, it.origin.id, it.parent?.id.orEmpty()) },
            restore = { Nav(Route.fromId(it[0]), Route.fromId(it[1]), it.getOrNull(2)?.takeIf { id -> id.isNotEmpty() }?.let(Route::fromId)) },
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
    Destination.History -> push(Route.History)
    Destination.Skip -> this          // opens the skip sheet over Today: the shell handles it, nothing navigates
}
