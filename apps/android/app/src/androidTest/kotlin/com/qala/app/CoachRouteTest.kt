package com.qala.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.app.coach.CoachResult
import com.qala.app.coach.Why
import com.qala.data.db.QalaDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Coach tab inside the whole app, over the seeded container and a fake server. The A6 gate (docs/android-native.md
 * section 9) is that a coach that cannot answer shows an unavailable state and never blocks the rest of the app: here the
 * server is unreachable, and Today, Plan and the check-in still open afterwards.
 */
@RunWith(AndroidJUnit4::class)
class CoachRouteTest {
    @get:Rule
    val rule: AndroidComposeTestRule<*, ComponentActivity> = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @After
    fun close() = scope.cancel()

    private fun shown(text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun waitForText(text: String, substring: Boolean = false) = rule.waitUntil(120_000) { shown(text, substring) }

    private fun openTab(name: String) = rule.onNode(hasText(name) and hasClickAction()).performClick()      // the tab, not a page title

    private fun showApp(client: FakeCoachClient): AppContainer {
        val container = AppContainer(QalaDatabase.inMemory(context), scope = scope, seedInDebug = true, coachClient = client).also { it.start() }
        rule.setContent { CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() } }
        waitForText("GZCLP DAY", substring = true)          // the seed ends with Today naming the program
        return container
    }

    @Test
    fun anUnreachableServerLeavesTheRestOfTheAppWorking() {
        val client = FakeCoachClient(CoachResult.Unavailable(Why.Unreachable, "Failed to connect to /10.0.2.2:8500"))
        showApp(client)

        openTab("Coach")
        waitForText("Runs on callisto")
        assertTrue("opening the tab makes no request", client.asked.isEmpty())
        // The chips come from the seeded day, so they are the app's own words, not the fake's.
        waitForText("Today: ", substring = true)

        rule.onNodeWithContentDescription("Ask the coach").performTextInput("Why is this weight on squats today?")
        rule.onNode(hasText("Send") and hasClickAction()).performClick()
        waitForText("Coach is offline")
        rule.onNodeWithText("Offline").assertExists()
        assertEquals(1, client.asked.size)
        assertEquals("Why is this weight on squats today?", client.asked.single().message)
        assertTrue("the request carries the seeded day", client.asked.single().context?.today != null)

        // Nothing else is blocked: Today, Plan and the check-in all open.
        openTab("Today")
        waitForText("GZCLP DAY", substring = true)
        openTab("Plan")
        waitForText("This week")
        openTab("Today")
        waitForText("GZCLP DAY", substring = true)

        // The thread and the unavailable card are the store's, so they are still there when the tab is opened again.
        openTab("Coach")
        waitForText("Coach is offline")
        rule.onNodeWithText("Why is this weight on squats today?").assertExists()
    }

    @Test
    fun aUnauthorizedAnswerIsAlsoJustAnUnavailableCoach() {
        val client = FakeCoachClient(CoachResult.Unavailable(Why.NotRecognised, "missing Tailscale identity"))
        showApp(client)
        openTab("Coach")
        waitForText("Runs on callisto")
        rule.onNodeWithContentDescription("Ask the coach").performTextInput("How is my recovery?")
        rule.onNode(hasText("Send") and hasClickAction()).performClick()
        waitForText("didn't recognise this phone", substring = true)
        openTab("Today")
        waitForText("GZCLP DAY", substring = true)
    }
}
