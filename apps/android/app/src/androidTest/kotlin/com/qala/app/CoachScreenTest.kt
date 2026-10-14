package com.qala.app

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.app.coach.CoachClient
import com.qala.app.coach.CoachDay
import com.qala.app.coach.CoachLimits
import com.qala.app.coach.CoachNumbers
import com.qala.app.coach.CoachRequest
import com.qala.app.coach.CoachResponse
import com.qala.app.coach.CoachResult
import com.qala.app.coach.CoachScreen
import com.qala.app.coach.CoachStore
import com.qala.app.coach.CoachSuggestion
import com.qala.app.coach.ReplyStatus
import com.qala.app.coach.SuggestionStatus
import com.qala.app.coach.Why
import com.qala.app.coach.WireLift
import com.qala.data.model.GymSettings
import com.qala.design.QalaTheme
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** A coach that answers from a queue, so a test decides what the server says. It records every request. */
class FakeCoachClient(vararg results: CoachResult, private val delayMs: Long = 0) : CoachClient {
    val asked = CopyOnWriteArrayList<CoachRequest>()
    private val queue = ConcurrentLinkedQueue(results.toList())

    override suspend fun ask(request: CoachRequest): CoachResult {
        asked += request
        if (delayMs > 0) delay(delayMs)
        return queue.poll() ?: CoachResult.Unavailable(Why.Failed, "no more canned answers")
    }
}

val FakeLimits = CoachLimits(-10.0, 2.5, -2, 1)

/** The fixture's answer: the engine's 245 against the coach's 240, with a reason. */
fun fakeAnswer(reply: String = "Your quads are still sore, so I would pull it back a little.", withCard: Boolean = true) = CoachResult.Answer(
    CoachResponse(
        ReplyStatus.Ok,
        reply,
        FakeLimits,
        if (!withCard) null else CoachSuggestion(
            title = "Squat top set",
            engine = CoachNumbers(245.0, "lb", 4, 4, 8.0),
            coach = CoachNumbers(240.0, "lb", 4, 4, 8.0),
            weightPct = -2.0,
            setsDelta = 0,
            reason = "Quads still sore (4). Small pullback, same reps.",
            status = SuggestionStatus.Accepted,
        ),
    ),
)

/**
 * The Coach screen over a fake client: the answer, the two ways the server can fail (degraded, and a 401 or no connection
 * as offline), Try again, and that a failure leaves the composer working. The screen is composed on its own here; the
 * full app is in CoachRouteTest.
 */
@RunWith(AndroidJUnit4::class)
class CoachScreenTest {
    @get:Rule
    val rule: AndroidComposeTestRule<*, ComponentActivity> = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @After
    fun close() = scope.cancel()

    private val liftDay = CoachDay(
        today = "Lower A",
        checkIn = "recovery 7, quads 4",
        lift = WireLift("Squat top set", 245.0, "lb", 4, 4, 8.0),
        barbell = true,
    )

    private fun show(client: CoachClient, day: CoachDay = liftDay) {
        val store = CoachStore(client, scope)
        rule.setContent {
            QalaTheme { CoachScreen(store, day, GymSettings(), rememberScrollState(), topBar = { Spacer(Modifier.height(1.dp)) }) }
        }
    }

    private fun shown(text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun waitForText(text: String, substring: Boolean = false) = rule.waitUntil(10_000) { shown(text, substring) }

    private fun ask(text: String) {
        rule.onNodeWithContentDescription("Ask the coach").performTextInput(text)
        rule.onNode(hasText("Send") and hasClickAction()).performClick()
    }

    @Test
    fun anAnswerShowsTheReplyAndTheSuggestedChangeNextToTheEngines() {
        val client = FakeCoachClient(fakeAnswer())
        show(client)

        // An empty thread: the day's chips, the coach's status and the questions to start from.
        rule.onNodeWithText("Today: Lower A").assertExists()
        rule.onNodeWithText("Check-in: recovery 7, quads 4").assertExists()
        rule.onNodeWithText("Runs on callisto").assertExists()
        rule.onNodeWithText("Why this weight today?").performClick()

        waitForText("Your quads are still sore", substring = true)
        rule.onNode(hasText("Why this weight today?") and hasClickAction()).assertDoesNotExist()      // the starters go once there is a thread
        rule.onNodeWithText("Why this weight today?").assertExists()                                    // and the question is the You turn
        rule.onNodeWithText("Suggested change".uppercase()).assertExists()
        rule.onNodeWithText("Squat top set").assertExists()
        rule.onNodeWithText("245 lb").assertExists()
        rule.onNodeWithText("240 lb").assertExists()
        rule.onNodeWithText("Quads still sore (4). Small pullback, same reps.").assertExists()
        rule.onNodeWithText("Coach can move weight -10% to +2.5% and sets -2 to +1.").assertExists()
        waitForText("per side", substring = true)                                // the plates for the engine's and the coach's weight

        val request = client.asked.single()
        assertEquals("Why this weight today?", request.message)
        assertEquals("Lower A", request.context!!.today)
        assertEquals(245.0, request.context!!.lift!!.weight, 0.0)

        rule.onNodeWithText("Use coach").performClick()
        waitForText("Noted. The workout still shows the engine's numbers", substring = true)
        rule.onNodeWithText("Use coach").assertDoesNotExist()
        rule.onNodeWithText("Keep engine").assertDoesNotExist()
    }

    @Test
    fun keepingTheEngineSaysSoAndTheButtonsGo() {
        show(FakeCoachClient(fakeAnswer()))
        ask("Should I change anything on squats?")
        waitForText("Keep engine")
        rule.onNodeWithText("Keep engine").performClick()
        waitForText("Engine numbers kept.")
        rule.onNodeWithText("Use coach").assertDoesNotExist()
    }

    @Test
    fun aDegradedServerShowsTheUnavailableCardAndTryAgainBringsTheAnswerBack() {
        val client = FakeCoachClient(CoachResult.Unavailable(Why.Degraded, "fetch failed: connection refused"), fakeAnswer("Back now.", withCard = false))
        show(client)
        ask("How is my recovery?")

        waitForText("Coach is unavailable")
        rule.onNodeWithText("The server is up, but its model isn't answering right now.", substring = true).assertExists()
        rule.onNodeWithText("Offline").assertExists()
        rule.onNodeWithText("How is my recovery?").assertExists()                  // what was typed is still there
        rule.onNodeWithText("fetch failed: connection refused").assertExists()

        rule.onNodeWithText("Try again").performClick()
        waitForText("Back now.")
        rule.onNodeWithText("Coach is unavailable").assertDoesNotExist()
        rule.onNodeWithText("Runs on callisto").assertExists()
        assertEquals(2, client.asked.size)
        assertEquals(client.asked[0], client.asked[1])
    }

    @Test
    fun noConnectionIsOfflineAndAFreshQuestionStillWorks() {
        val client = FakeCoachClient(CoachResult.Unavailable(Why.Unreachable, "Failed to connect"), fakeAnswer("I am here.", withCard = false))
        show(client)
        ask("Why a rest day?")

        waitForText("Coach is offline")
        rule.onNodeWithText("Qala can't reach the server from here.", substring = true).assertExists()
        rule.onNodeWithText("Offline").assertExists()

        // Failing never locks the composer: type again, send, and the unavailable card goes with the next answer.
        ask("What about tomorrow?")
        waitForText("I am here.")
        rule.onNodeWithText("Coach is offline").assertDoesNotExist()
        assertEquals("What about tomorrow?", client.asked.last().message)
        // The unanswered first question rides along as part of the thread.
        assertTrue(client.asked.last().thread.any { it.text == "Why a rest day?" })
    }

    @Test
    fun aPhoneTheServerDoesNotRecogniseGetsItsOwnWords() {
        show(FakeCoachClient(CoachResult.Unavailable(Why.NotRecognised, "missing Tailscale identity")))
        ask("Why this weight?")
        waitForText("Coach is unavailable")
        rule.onNodeWithText("The server didn't recognise this phone, so it won't answer.", substring = true).assertExists()
        rule.onNodeWithText("missing Tailscale identity").assertExists()
    }

    @Test
    fun sendWaitsForTextAndForTheAnswerInFlight() {
        val client = FakeCoachClient(fakeAnswer("Slow answer.", withCard = false), delayMs = 700)
        show(client)
        rule.onNode(hasText("Send") and hasClickAction()).assertIsNotEnabled()      // nothing typed
        rule.onNodeWithContentDescription("Ask the coach").performTextInput("How is my recovery?")
        rule.onNode(hasText("Send") and hasClickAction()).assertIsEnabled().performClick()

        waitForText("Coach is thinking")
        rule.onNodeWithText("Slow answer.").assertDoesNotExist()
        waitForText("Slow answer.")
        rule.onNodeWithText("Coach is thinking").assertDoesNotExist()
        assertEquals(1, client.asked.size)
    }

    @Test
    fun aDeclinedQuestionShowsTheCoachsLineWithoutACard() {
        val declined = CoachResult.Answer(CoachResponse(ReplyStatus.Declined, "I am your training coach, so I stay inside fitness.", FakeLimits))
        show(FakeCoachClient(declined))
        ask("What is the capital of France?")
        waitForText("I am your training coach", substring = true)
        rule.onNodeWithText("Suggested change".uppercase()).assertDoesNotExist()
    }

    @Test
    fun aRestDayOffersRecoveryQuestionsAndNoLift() {
        val client = FakeCoachClient(fakeAnswer("Easy day.", withCard = false))
        show(client, CoachDay(today = "Rest day", checkIn = null, lift = null, barbell = false))
        rule.onNodeWithText("Today: Rest day").assertExists()
        rule.onNodeWithText("Check-in: not yet").assertExists()
        rule.onNodeWithText("How is my recovery?").performClick()
        waitForText("Easy day.")
        assertTrue(client.asked.single().context!!.lift == null)
    }
}
