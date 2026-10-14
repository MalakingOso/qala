package com.qala.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.IsoTime
import com.qala.data.db.QalaDatabase
import com.qala.data.model.SkipReason
import com.qala.data.repo.DeviceClock
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.StubStage
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The real Plan tab over the seeded container, with the clock pinned to a Friday (a lift day) so the test means the same
 * thing on any day it runs. The seed ends yesterday, so Friday's lift is the one Today is about to start.
 */
@RunWith(AndroidJUnit4::class)
class PlanRouteTest {
    @get:Rule
    val rule: AndroidComposeTestRule<*, ComponentActivity> = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val context = ApplicationProvider.getApplicationContext<Context>()

    /** Noon on the next Friday on or after today, in the device zone, held still. */
    private val friday = object : DeviceClock {
        override val zone: ZoneId = ZoneId.systemDefault()
        private val noon = ZonedDateTime.now(zone).with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)).withHour(12).withMinute(0).withSecond(0).withNano(0)
        override fun nowMs(): Long = noon.toInstant().toEpochMilli()
    }

    @After
    fun close() = scope.cancel()

    private fun container() =
        AppContainer(QalaDatabase.inMemory(context), env = RepoEnv(clock = friday), scope = scope, seedInDebug = true).also { it.start() }

    private fun showApp(container: AppContainer) = rule.setContent {
        CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
    }

    private fun waitFor(timeoutMs: Long = 120_000, condition: () -> Boolean) = rule.waitUntil(timeoutMs, condition)

    private fun textShown(text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun waitForText(text: String, substring: Boolean = false) = waitFor { textShown(text, substring) }

    /** The seed writes the program first and the history after it; Today's head names the program once it is all in. */
    private fun waitForTheSeed() = waitForText("GZCLP DAY", substring = true)

    private fun openPlan() {
        waitForTheSeed()
        rule.onNode(hasText("Plan") and hasClickAction()).performClick()          // the tab, not the page's own title
        waitForText("This week")
    }

    private fun dayTab(name: String) = rule.onNode(hasContentDescription(name, substring = true) and hasClickAction())

    /** Writes the check-in and the warm-up through the repositories, so today's lift is the stage Today is on (as WorkoutFlowTest does). */
    private fun reachTheLift(container: AppContainer) = runBlocking {
        waitForTheSeed()
        val day = withTimeout(60_000) { container.engine.snapshot.first { it.today?.programDay != null }.today!!.programDay!! }
        container.checkIns.save(7.0)
        container.sessions.markStageDone(StubStage.WARM_UP, day)
        day
    }

    private fun finishTheWorkout() {
        rule.onNodeWithText("Log set 1").performClick()
        waitForText("Ready early")
        rule.onNodeWithText("Ready early").performClick()
        rule.onNodeWithContentDescription("Finish workout").performClick()
        val sheet = SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "Finish workout?")
        rule.onNode(hasText("Finish workout") and hasClickAction() and hasAnyAncestor(sheet)).performClick()
    }

    @Test
    fun theTabMovesBetweenWeeksAndDaysAndStartsTodaysWorkout() {
        val container = container()
        showApp(container)
        reachTheLift(container)
        openPlan()

        // Today, a Friday and a lift day with check-in and warm-up done: its tab is selected and it carries the one Start workout.
        dayTab("Friday").assertIsSelected()
        waitForText("Start workout")

        // Next week: the same weekday stays selected, but no day there is today, so there is nothing to start.
        rule.onNodeWithContentDescription("Next week").performClick()
        waitForText("Next week")
        dayTab("Friday").assertIsSelected()
        rule.onNodeWithText("Start workout").assertDoesNotExist()

        // Another day of that week.
        dayTab("Monday").performClick()
        dayTab("Monday").assertIsSelected()
        waitForText("MONDAY, ", substring = true)
        rule.onNodeWithText("Start workout").assertDoesNotExist()

        // Back to this week lands on today again, and Start opens the real workout.
        rule.onNodeWithText("Back to this week").performClick()
        waitForText("This week")
        dayTab("Friday").assertIsSelected()
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")
        assertTrue(rule.onAllNodes(hasContentDescription("Days of the week")).fetchSemanticsNodes().isEmpty())

        // Back comes home to the Plan tab it was started from.
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        waitForText("This week")
        rule.onNodeWithText("Start workout").assertExists()
    }

    @Test
    fun startFollowsTodaysStageOrderFromCheckInThroughTheWarmUpToTheLift() {
        showApp(container())
        openPlan()

        // Nothing done yet: Today is on the check-in, so that is Plan's button, and the lift is not offered.
        waitForText("Check in")
        waitForText("Check-in comes before the lift.")
        rule.onNodeWithText("Start workout").assertDoesNotExist()
        rule.onNodeWithText("Check in").performClick()
        rule.onNodeWithText("Save check-in").performClick()

        // The check-in goes back to the tab it was opened from, and the warm-up is next.
        waitForText("This week")
        waitForText("Start warm-up")
        waitForText("Warm-up comes before the lift.")
        rule.onNodeWithText("Start workout").assertDoesNotExist()
        rule.onNodeWithText("Start warm-up").performClick()
        waitForText("Easy cardio")
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }

        // Warm-up done: now Plan offers the workout itself.
        waitForText("This week")
        waitForText("Start workout")
        rule.onNodeWithText("Start warm-up").assertDoesNotExist()
    }

    @Test
    fun finishingTheWorkoutFromPlanMarksTheDayDoneAndHistoryIsOneTapAway() {
        val container = container()
        showApp(container)
        reachTheLift(container)
        openPlan()
        waitForText("Start workout")
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")
        finishTheWorkout()

        // The workout finished from Plan comes back to Plan, where the day is done: its tab, its card and its buttons say so.
        waitForText("This week")
        waitFor { rule.onAllNodes(hasContentDescription("done", substring = true) and hasContentDescription("Friday", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        waitForText("See what you did")
        rule.onNodeWithText("Start workout").assertDoesNotExist()
        waitForText("FRIDAY, ", substring = true)

        // See what you did leads to History, and Back returns to Plan.
        rule.onNodeWithText("See what you did").performClick()
        waitFor { rule.onAllNodes(hasContentDescription("Days of the week")).fetchSemanticsNodes().isEmpty() }
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        waitForText("This week")
    }

    @Test
    fun aRestDayHasNothingToStart() {
        showApp(container())
        openPlan()
        dayTab("Sunday").performClick()
        waitForText("REST DAY", substring = true)
        rule.onNodeWithText("Rest day").assertExists()
        rule.onNodeWithText("Start workout").assertDoesNotExist()
    }

    @Test
    fun aVacationDayShowsItsReasonTheShiftAndNoStart() {
        val container = container()
        showApp(container)
        waitForTheSeed()
        val today = IsoTime.localDateKey(friday.nowMs(), IsoTime.offsetMinAt(friday.zone, friday.nowMs()))
        runBlocking { container.availability.skip(today, SkipReason.Vacation, note = "Cabin") }
        openPlan()
        waitForText("SKIPPED, VACATION · SHIFTS THE PLAN", substring = true)
        rule.onNodeWithText("On vacation").assertExists()
        rule.onNodeWithText("Away from training. The plan shifts out.").assertExists()
        waitFor { textShown("The lift moves to ", substring = true) }
        rule.onNodeWithText("Note: Cabin").assertExists()
        rule.onNodeWithText("Start workout").assertDoesNotExist()
        assertTrue(rule.onAllNodes(hasContentDescription("skipped, vacation", substring = true)).fetchSemanticsNodes().isNotEmpty())
    }
}
