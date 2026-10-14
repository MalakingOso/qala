package com.qala.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.QalaDatabase
import com.qala.data.repo.DeviceClock
import com.qala.data.repo.RepoEnv
import com.qala.design.DayMenu
import com.qala.design.QalaTheme
import com.qala.design.RailStage
import com.qala.design.StageDotState
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The real Today route over the seeded container, with the clock pinned to a Friday (a lift day, six stages) so the
 * test means the same thing on any day it runs. The seed ends yesterday, so the day starts at check-in.
 */
@RunWith(AndroidJUnit4::class)
class TodayRouteTest {
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

    private fun container(seed: Boolean = true) =
        AppContainer(QalaDatabase.inMemory(context), env = RepoEnv(clock = friday), scope = scope, seedInDebug = seed).also { it.start() }

    private fun showApp(container: AppContainer) = rule.setContent {
        CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
    }

    private fun railSays(text: String) = rule.waitUntil(timeoutMillis = 120_000) {
        rule.onAllNodes(hasContentDescription(text)).fetchSemanticsNodes().isNotEmpty()
    }

    /** The seed writes the program first and the history after it; the head names the program once it is all in. */
    private fun waitForTheSeed() = rule.waitUntil(timeoutMillis = 120_000) {
        rule.onAllNodes(hasText("GZCLP DAY", substring = true)).fetchSemanticsNodes().isNotEmpty()
    }

    private fun waitForText(text: String) = rule.waitUntil(timeoutMillis = 120_000) {
        rule.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun theRailFollowsACheckInTheWarmUpAndTheLift() {
        showApp(container())
        waitForTheSeed()
        railSays("Day stages: check-in now, 0 of 6 done")

        rule.onNodeWithText("Check in").performClick()
        rule.onNodeWithText("Save check-in").performClick()
        railSays("Day stages: warm-up now, 1 of 6 done")

        // The warm-up's Start workout marks its stage and opens the workout; Back from there is Today, one stage on.
        rule.onNodeWithText("Start warm-up").performClick()
        waitForText("Easy cardio")
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        railSays("Day stages: lift now, 2 of 6 done")

        // One set logged and the workout finished is a real session: the lift stage is done.
        rule.onNodeWithText("Start workout").performClick()
        rule.onNodeWithText("Log set 1").performClick()
        waitForText("Ready early")
        rule.onNodeWithText("Ready early").performClick()
        rule.onNodeWithContentDescription("Finish workout").performClick()
        val sheet = SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "Finish workout?")
        rule.onNode(hasText("Finish workout") and hasClickAction() and hasAnyAncestor(sheet)).performClick()
        railSays("Day stages: run now, 3 of 6 done")
    }

    @Test
    fun systemBackAndTheInAppBackBothLeaveAScreenForToday() {
        showApp(container())
        railSays("Day stages: check-in now, 0 of 6 done")

        rule.onNodeWithText("Start warm-up").assertDoesNotExist()
        rule.onNodeWithText("Check in").performClick()
        rule.onNodeWithText("Save check-in").assertExists()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.onNodeWithText("Check in").assertExists()
        rule.onNodeWithText("Save check-in").assertDoesNotExist()

        rule.onNodeWithText("Check in").performClick()
        rule.onNodeWithContentDescription("Back").performClick()
        rule.onNodeWithText("Check in").assertExists()
        railSays("Day stages: check-in now, 0 of 6 done")

        // The warm-up has the same two ways home.
        rule.onNodeWithText("Check in").performClick()
        rule.onNodeWithText("Save check-in").performClick()
        railSays("Day stages: warm-up now, 1 of 6 done")
        rule.onNodeWithText("Start warm-up").performClick()
        waitForText("Easy cardio")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.onNodeWithText("Start warm-up").assertExists()
        rule.onNodeWithText("Start warm-up").performClick()
        waitForText("Easy cardio")
        rule.onNodeWithContentDescription("Back").performClick()
        rule.onNodeWithText("Start warm-up").assertExists()
        railSays("Day stages: warm-up now, 1 of 6 done")             // leaving the warm-up records nothing
    }

    @Test
    fun aPreviewIsAnnouncedAndReadOnly() {
        showApp(container())
        waitForTheSeed()
        railSays("Day stages: check-in now, 0 of 6 done")

        // TalkBack steps through the stages with the rail's custom actions.
        val rail = rule.onNode(hasContentDescription("Day stages: check-in now, 0 of 6 done"))
        val next = rail.fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "Next stage" }
        rule.runOnUiThread { next.action() }

        val bar = rule.onNodeWithText("Previewing Warm-up")
        bar.assertExists()
        assertEquals(LiveRegionMode.Polite, bar.fetchSemanticsNode().config[SemanticsProperties.LiveRegion])
        rule.onNodeWithText("Preview · warm-up".uppercase()).assertExists()
        rule.onNodeWithText("Start warm-up").assertIsNotEnabled()
        rule.onNodeWithText("Back to now").performClick()
        railSays("Day stages: check-in now, 0 of 6 done")
        rule.onNodeWithText("Check in").assertIsEnabled()
    }

    @Test
    fun theTitlesAreHeadings() {
        showApp(container())
        waitForTheSeed()
        val headings = rule.onAllNodes(isHeading()).fetchSemanticsNodes().size
        // The page title, the hero, and the four cards below it (some may be off screen but are still composed).
        assertTrue("found $headings headings", headings >= 4)
        rule.onNode(isHeading() and hasText("Today")).assertExists()
    }

    @Test
    fun theMenusBackHandlerBeatsAnOuterOneWhileItIsOpen() {
        var outer = 0
        var open by mutableStateOf(true)
        val stages = listOf(
            RailStage("check-in", "Check-in", StageDotState.Now),
            RailStage("recover", "Recover", StageDotState.Later, interlude = true),
        )
        rule.setContent {
            QalaTheme {
                // The shell's handler comes first in composition, the menu's after it, as in QalaApp.
                BackHandler(enabled = true) { outer += 1 }
                DayMenu(open = open, title = "Friday", stages = stages, viewing = 0, nowIndex = 0, onSelect = {}, onClose = { open = false })
            }
        }
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        assertFalse("Back closed the menu", open)
        assertEquals("and did not reach the outer handler", 0, outer)

        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        assertEquals("with the menu shut, Back belongs to the outer handler again", 1, outer)
    }
}
