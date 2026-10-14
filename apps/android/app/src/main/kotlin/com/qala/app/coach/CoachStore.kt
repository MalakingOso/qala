package com.qala.app.coach

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the athlete did with a suggestion card. Held for the session only: the workout does not read it yet. */
enum class Decision { Pending, UseCoach, KeepEngine }

/** The coach's change to a lift, with the limits the server enforced and what the athlete chose. */
data class SuggestionCard(val suggestion: CoachSuggestion, val limits: CoachLimits, val decision: Decision = Decision.Pending)

/** One turn of the thread. A coach turn may carry a suggestion card; [declined] marks the standard "outside my topics" reply. */
data class CoachMessage(
    val id: Int,
    val who: Who,
    val text: String,
    val card: SuggestionCard? = null,
    val declined: Boolean = false,
)

/**
 * The Coach screen's state. [sending] is true while a request is out. [unavailable] is set when the last request could
 * not be answered, with [failedText] the question to ask again; the thread keeps that question, so nothing typed is lost.
 */
data class CoachState(
    val messages: List<CoachMessage> = emptyList(),
    val sending: Boolean = false,
    val unavailable: Why? = null,
    val detail: String? = null,
    val failedText: String? = null,
)

/**
 * The conversation with the coach, process-wide like the workout store: the thread lives as long as the app does, so it
 * is still there after a visit to another tab. Requests run on the container's [scope], not the screen's, and each one
 * ends in a state, never an exception, so a coach that is down costs the rest of the app nothing. The app does not talk
 * to the server until the athlete sends a question.
 */
class CoachStore(client: CoachClient, private val scope: CoroutineScope) {
    @Volatile
    var client: CoachClient = client

    private val mutable = MutableStateFlow(CoachState())
    val state: StateFlow<CoachState> = mutable.asStateFlow()

    private val ids = AtomicInteger(1)

    /** The context the failed question was asked with, so Try again asks it the same way. */
    @Volatile
    private var failedContext: CoachRequestContext? = null

    /** Asks [text] (cut to the server's limit). Ignored while a request is out or when the text is blank. */
    fun send(text: String, context: CoachRequestContext?) {
        val question = text.trim().take(MaxMessageChars)
        if (question.isEmpty() || mutable.value.sending) return
        val thread = mutable.value.messages
        mutable.update {
            it.copy(
                messages = it.messages + CoachMessage(ids.getAndIncrement(), Who.You, question),
                sending = true,
                unavailable = null,
                detail = null,
                failedText = null,
            )
        }
        ask(question, thread, context)
    }

    /** Asks the question that could not be answered again, without adding it to the thread twice. */
    fun retry() {
        val s = mutable.value
        val question = s.failedText ?: return
        if (s.sending) return
        val thread = s.messages.dropLast(1)          // the unanswered question is the last turn
        mutable.update { it.copy(sending = true, unavailable = null, detail = null, failedText = null) }
        ask(question, thread, failedContext)
    }

    /** Records what the athlete chose on the card of message [id]. */
    fun decide(id: Int, decision: Decision) {
        mutable.update { s ->
            s.copy(messages = s.messages.map { m -> if (m.id == id && m.card != null) m.copy(card = m.card.copy(decision = decision)) else m })
        }
    }

    private fun ask(question: String, thread: List<CoachMessage>, context: CoachRequestContext?) {
        val request = CoachRequest(question, thread.takeLast(MaxTurns).map { WireTurn(it.who, it.text) }, context)
        scope.launch {
            val result = try {
                client.ask(request)
            } catch (e: kotlin.coroutines.cancellation.CancellationException) {
                throw e
            } catch (e: Exception) {
                CoachResult.Unavailable(Why.Failed, e.message)       // a client that throws must not take the screen down
            }
            mutable.update { s ->
                when (result) {
                    is CoachResult.Answer -> {
                        failedContext = null
                        val r = result.response
                        val card = r.suggestion?.let { SuggestionCard(it, r.limits) }
                        s.copy(
                            messages = s.messages + CoachMessage(ids.getAndIncrement(), Who.Coach, r.reply, card, declined = r.status == ReplyStatus.Declined),
                            sending = false,
                        )
                    }
                    is CoachResult.Unavailable -> {
                        failedContext = context
                        s.copy(sending = false, unavailable = result.why, detail = result.detail, failedText = question)
                    }
                }
            }
        }
    }

    companion object {
        /** The server's limits (COACH_LIMITS in packages/llm/coach.ts): 600 characters a message, the last 8 turns. */
        const val MaxMessageChars = 600
        const val MaxTurns = 8
    }
}
