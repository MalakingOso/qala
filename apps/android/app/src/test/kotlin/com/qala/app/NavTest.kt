package com.qala.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavTest {
    @Test
    fun idsRoundTrip() {
        for (route in Route.tabs + Route.History + Route.Settings + Route.Plates + Route.CheckIn + Route.WarmUp + Route.Workout + Route.Rest + Route.Run + Route.AllExercises) {
            assertEquals(route, Route.fromId(route.id))
        }
    }

    @Test
    fun unknownIdFallsBackToToday() {
        assertEquals(Route.Today, Route.fromId("nope"))
    }

    @Test
    fun allExercisesSitsOverTheFlowScreenThatOpenedItAndBackReturnsThere() {
        assertEquals(Route.Today, Route.AllExercises.tab)
        for (from in listOf(Route.WarmUp, Route.Workout)) {
            val grid = Nav().push(from).push(Route.AllExercises)
            assertEquals(Route.AllExercises, grid.route)
            assertEquals("Back from the grid is the screen it was opened from", Nav(from, Route.Today), grid.back())
            assertEquals("and from there it is Today", Nav(), grid.back()!!.back())
        }
    }

    @Test
    fun allExercisesOverRestGoesBackToRestAndThenToTheWorkout() {
        val grid = Nav().selectTab(Route.Plan).push(Route.Workout).push(Route.Rest).push(Route.AllExercises)
        val rest = grid.back()!!
        assertEquals(Nav(Route.Rest, Route.Plan), rest)
        assertEquals(Nav(Route.Workout, Route.Plan), rest.back())
    }

    @Test
    fun aCardJumpsFromTheGridToTheWorkoutAndBackThenLeavesForToday() {
        val jumped = Nav().push(Route.Workout).push(Route.Rest).push(Route.AllExercises).push(Route.Workout)
        assertEquals("the grid and the rest above the workout are left behind", Nav(Route.Workout, Route.Today), jumped)
        assertEquals(Nav(), jumped.back())
    }

    @Test
    fun theParentOfTheGridSurvivesSavedState() {
        val saver = Nav.Saver
        val scope = androidx.compose.runtime.saveable.SaverScope { true }
        val grid = Nav().push(Route.Workout).push(Route.Rest).push(Route.AllExercises)
        assertEquals(grid, saver.restore(saver.run { scope.save(grid)!! }))
        assertEquals("a state saved before the grid had a parent still restores", Nav(Route.Workout), saver.restore(listOf("workout", "today")))
    }

    @Test
    fun platesIsPushedAndHighlightsToday() {
        assertEquals(Route.Today, Route.Plates.tab)
        val nav = Nav().push(Route.Settings).push(Route.Plates)
        assertEquals(Route.Plates, nav.route)
        assertEquals("Back from plates returns to the tab settings came from", Nav(), nav.back())
    }

    @Test
    fun aPlanDayLeadsToHistoryAndBackReturnsToPlan() {
        val nav = Nav().selectTab(Route.Plan).go(com.qala.app.today.Destination.History)
        assertEquals(Route.History, nav.route)
        assertEquals(Nav(Route.Plan), nav.back())
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
    fun restSitsOverTheWorkoutAndBackReturnsThere() {
        val workout = Nav().push(Route.Workout)
        val rest = workout.push(Route.Rest)
        assertEquals(Route.Rest, rest.route)
        assertEquals(Route.Today, rest.route.tab)
        assertEquals("Back from Rest is the workout, not Today", Nav(Route.Workout, Route.Today), rest.back())
        assertEquals("and from the workout it is Today, where the day is", Nav(), rest.back()!!.back())
    }

    @Test
    fun restOverAWorkoutOpenedFromAnotherTabGoesBackThroughItToThatTab() {
        val nav = Nav().selectTab(Route.Plan).push(Route.Workout).push(Route.Rest)
        assertEquals(Nav(Route.Workout, Route.Plan), nav.back())
        assertEquals(Nav(Route.Plan), nav.back()!!.back())
    }

    @Test
    fun theLiftingFlowDropsTheTabBarAndNothingElseDoes() {
        assertEquals(listOf(Route.WarmUp, Route.Workout, Route.Rest, Route.AllExercises), (Route.tabs + Route.History + Route.Settings + Route.CheckIn + Route.WarmUp + Route.Workout + Route.Rest + Route.Run + Route.AllExercises).filter { it.isFocus })
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
