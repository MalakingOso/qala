package com.qala.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavTest {
    @Test
    fun idsRoundTrip() {
        for (route in Route.tabs + Route.History + Route.Settings) {
            assertEquals(route, Route.fromId(route.id))
        }
    }

    @Test
    fun unknownIdFallsBackToToday() {
        assertEquals(Route.Today, Route.fromId("nope"))
    }

    @Test
    fun historyAndSettingsHighlightToday() {
        assertEquals(Route.Today, Route.History.tab)
        assertEquals(Route.Today, Route.Settings.tab)
        assertEquals(Route.Coach, Route.Coach.tab)
    }

    @Test
    fun pushedScreenReturnsToTheTabItCameFrom() {
        val nav = Nav().selectTab(Route.Coach).push(Route.Settings)
        assertEquals(Route.Settings, nav.route)
        assertEquals(Nav(Route.Coach), nav.back())
    }

    @Test
    fun pushingOverAPushedScreenKeepsTheOriginalTab() {
        val nav = Nav().selectTab(Route.Plan).push(Route.History).push(Route.Settings)
        assertEquals(Nav(Route.Plan), nav.back())
    }

    @Test
    fun backFromATabGoesToTodayThenLeaves() {
        val nav = Nav().selectTab(Route.Body)
        assertEquals(Nav(), nav.back())
        assertNull(Nav().back())
    }
}
