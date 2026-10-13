package com.qala.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavTest {
    @Test
    fun idsRoundTrip() {
        for (route in Route.tabs + Route.History + Route.Settings + Route.Plates + Route.CheckIn + Route.WarmUp + Route.Workout + Route.Run) {
            assertEquals(route, Route.fromId(route.id))
        }
    }

    @Test
    fun unknownIdFallsBackToToday() {
        assertEquals(Route.Today, Route.fromId("nope"))
    }

    @Test
    fun platesIsPushedAndHighlightsToday() {
        assertEquals(Route.Today, Route.Plates.tab)
        val nav = Nav().push(Route.Settings).push(Route.Plates)
        assertEquals(Route.Plates, nav.route)
        assertEquals("Back from plates returns to the tab settings came from", Nav(), nav.back())
    }

    @Test
    fun historyAndSettingsHighlightToday() {
        assertEquals(Route.Today, Route.History.tab)
        assertEquals(Route.Today, Route.Settings.tab)
        assertEquals(Route.Coach, Route.Coach.tab)
    }

    @Test
    fun theStageStubsArePushedOverToday() {
        for (stub in listOf(Route.CheckIn, Route.WarmUp, Route.Workout, Route.Run)) {
            assertEquals(Route.Today, stub.tab)
            val nav = Nav().push(stub)
            assertEquals(stub, nav.route)
            assertEquals("Back from a stub is Today, so Mark done lands on the rail", Nav(), nav.back())
        }
    }

    @Test
    fun aStubPushedOverATabReturnsToThatTab() {
        assertEquals(Nav(Route.Plan), Nav().selectTab(Route.Plan).push(Route.Run).back())
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
