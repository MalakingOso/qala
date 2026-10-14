package com.qala.app.coach

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A client that answers from a queue and records what it was asked. [gate] holds an answer back until the test lets it go. */
private class FakeClient(vararg results: CoachResult) : CoachClient {
    val asked = mutableListOf<CoachRequest>()
    val queue = ArrayDeque(results.toList())
    var gate: CompletableDeferred<Unit>? = null
    var throwing: Exception? = null

    override suspend fun ask(request: CoachRequest): CoachResult {
        asked += request
        gate?.await()
        throwing?.let { throw it }
        return queue.removeFirst()
    }
}

private val limits = CoachLimits(-10.0, 2.5, -2, 1)
private fun reply(text: String, suggestion: CoachSuggestion? = null, status: ReplyStatus = ReplyStatus.Ok) =
    CoachResult.Answer(CoachResponse(status, text, limits, suggestion))

private val suggestion = CoachSuggestion(
    "Squat top set", CoachNumbers(245.0, "lb", 4, 4), CoachNumbers(240.0, "lb", 4, 4), -2.0, 0, "Sore.", SuggestionStatus.Accepted,
)

class CoachStoreTest {
    // Unconfined runs a request on the calling thread up to its first suspension, so each test reads the state at once.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    @After
    fun close() = scope.coroutineContext[kotlinx.coroutines.Job]!!.cancel()

    private val day = CoachRequestContext(today = "Lower A", checkIn = "recovery 7")

    @Test
    fun aQuestionIsAnsweredAndBothTurnsStayInTheThread() {
        val client = FakeClient(reply("Hold 245 today."))
        val store = CoachStore(client, scope)
        store.send("  Why 245?  ", day)

        val s = store.state.value
        assertEquals(listOf(Who.You to "Why 245?", Who.Coach to "Hold 245 today."), s.messages.map { it.who to it.text })
        assertFalse(s.sending)
        assertNull(s.unavailable)
        assertEquals(CoachRequest("Why 245?", emptyList(), day), client.asked.single())
    }

    @Test
    fun aRequestIsOutWhileTheCoachThinksAndASecondSendWaits() {
        val client = FakeClient(reply("One."), reply("Two."))
        client.gate = CompletableDeferred()
        val store = CoachStore(client, scope)
        store.send("First question about squats", day)
        assertTrue(store.state.value.sending)
        store.send("Second question about squats", day)          // ignored: one request at a time
        assertEquals(1, client.asked.size)
        assertEquals(1, store.state.value.messages.size)

        client.gate!!.complete(Unit)
        assertFalse(store.state.value.sending)
        assertEquals(2, store.state.value.messages.size)
    }

    @Test
    fun theThreadGoesWithEachQuestionButNotTheQuestionItself() {
        val client = FakeClient(reply("A1."), reply("A2."))
        val store = CoachStore(client, scope)
        store.send("Q1 squats", day)
        store.send("Q2 squats", day)
        assertEquals(
            listOf(WireTurn(Who.You, "Q1 squats"), WireTurn(Who.Coach, "A1.")),
            client.asked[1].thread,
        )
        assertEquals("Q2 squats", client.asked[1].message)
    }

    @Test
    fun onlyTheLastEightTurnsAreSent() {
        val client = FakeClient(*Array(6) { reply("answer $it") })
        val store = CoachStore(client, scope)
        repeat(6) { store.send("question $it squats", day) }
        assertEquals(CoachStore.MaxTurns, client.asked.last().thread.size)
        assertEquals("question 1 squats", client.asked.last().thread.first().text)
    }

    @Test
    fun aBlankOrLongQuestionIsHandledBeforeItLeavesThePhone() {
        val client = FakeClient(reply("ok"))
        val store = CoachStore(client, scope)
        store.send("   ", day)
        assertTrue(client.asked.isEmpty())
        assertTrue(store.state.value.messages.isEmpty())

        store.send("x".repeat(900), day)
        assertEquals(CoachStore.MaxMessageChars, client.asked.single().message.length)
    }

    @Test
    fun aFailureKeepsTheQuestionAndShowsWhy() {
        for (why in Why.entries) {
            val client = FakeClient(CoachResult.Unavailable(why, "the detail"))
            val store = CoachStore(client, scope)
            store.send("Why 245 squats?", day)

            val s = store.state.value
            assertEquals("$why", why, s.unavailable)
            assertEquals("the detail", s.detail)
            assertEquals("Why 245 squats?", s.failedText)
            assertFalse(s.sending)
            assertEquals("the question is still in the thread", listOf(Who.You), s.messages.map { it.who })
        }
    }

    @Test
    fun tryAgainAsksTheSameQuestionOnceMoreWithTheSameContext() {
        val client = FakeClient(CoachResult.Unavailable(Why.Unreachable), reply("Back now."))
        val store = CoachStore(client, scope)
        store.send("Why 245 squats?", day)
        store.retry()

        assertEquals(2, client.asked.size)
        assertEquals(client.asked[0], client.asked[1])
        val s = store.state.value
        assertNull(s.unavailable)
        assertNull(s.failedText)
        assertEquals(listOf(Who.You, Who.Coach), s.messages.map { it.who })
    }

    @Test
    fun aNewQuestionAfterAFailureClearsTheOldState() {
        val client = FakeClient(CoachResult.Unavailable(Why.Degraded), reply("Fine."))
        val store = CoachStore(client, scope)
        store.send("First squats?", day)
        store.send("Second squats?", day)
        assertNull(store.state.value.unavailable)
        assertEquals(listOf(Who.You, Who.You, Who.Coach), store.state.value.messages.map { it.who })
        // The unanswered first question is part of the thread the second one carries.
        assertEquals(listOf(WireTurn(Who.You, "First squats?")), client.asked[1].thread)
    }

    @Test
    fun retryWithNothingToRetryDoesNothing() {
        val client = FakeClient()
        val store = CoachStore(client, scope)
        store.retry()
        assertTrue(client.asked.isEmpty())
    }

    @Test
    fun aClientThatThrowsIsAnUnavailableCoachNotACrash() {
        val client = FakeClient()
        client.throwing = IllegalStateException("bug in the client")
        val store = CoachStore(client, scope)
        store.send("Why 245 squats?", day)
        assertEquals(Why.Failed, store.state.value.unavailable)
        assertFalse(store.state.value.sending)
    }

    @Test
    fun aSuggestionCardRidesOnTheCoachTurnAndTheChoiceIsRecorded() {
        val client = FakeClient(reply("Pull it back.", suggestion))
        val store = CoachStore(client, scope)
        store.send("Should I change anything squats?", day)

        val turn = store.state.value.messages.last()
        assertEquals(Decision.Pending, turn.card!!.decision)
        assertEquals(limits, turn.card!!.limits)
        store.decide(turn.id, Decision.UseCoach)
        assertEquals(Decision.UseCoach, store.state.value.messages.last().card!!.decision)
        store.decide(turn.id, Decision.KeepEngine)
        assertEquals(Decision.KeepEngine, store.state.value.messages.last().card!!.decision)
        store.decide(9999, Decision.UseCoach)          // an id that is not a card changes nothing
        assertEquals(Decision.KeepEngine, store.state.value.messages.last().card!!.decision)
    }

    @Test
    fun aDeclinedReplyIsMarkedSoItCanBeLeftOutOfLaterContext() {
        val client = FakeClient(reply("I only do training.", status = ReplyStatus.Declined))
        val store = CoachStore(client, scope)
        store.send("What is the capital of France?", day)
        assertTrue(store.state.value.messages.last().declined)
        assertNull(store.state.value.messages.last().card)
    }

    @Test
    fun theClientCanBeSwappedForTheDebugDemo() {
        val first = FakeClient(reply("real"))
        val store = CoachStore(first, scope)
        val demo = FakeClient(reply("demo"))
        store.client = demo
        store.send("Why 245 squats?", day)
        assertTrue(first.asked.isEmpty())
        assertEquals("demo", store.state.value.messages.last().text)
    }
}
