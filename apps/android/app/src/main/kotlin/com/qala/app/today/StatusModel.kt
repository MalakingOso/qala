package com.qala.app.today

import com.qala.app.skip.spanLine
import com.qala.data.model.SkipReason
import com.qala.data.today.DayStatus
import com.qala.data.today.StatusSpan

/*
 * The status card at the top of Today (DESIGN 7.18, mockups/m4-status-banner.html option B with the "Feeling better?"
 * question inline, option C): what is on today, what it means in a calm sentence, Undo and Change. Plain data, so the
 * copy and the question's rule are unit tested without Compose or Rust. Nothing here counts against anyone: a skipped day
 * is never a miss.
 */

/** The inline "Feeling better?" question, for a sick span from its second day. */
class FeelingBetterAsk(val sickSince: String) {
    /** "You marked yourself sick on Oct 1. Back to training?" */
    val text: String get() = "You marked yourself sick on ${shortDate(sickSince)}. Back to training?"
}

class StatusCard(
    val reason: SkipReason,
    /** "Sick", "On vacation", "Injured: quads". */
    val head: String,
    /** "Today only", "Until Oct 9", "Since Monday, until you say so". */
    val whenLine: String,
    /** What it means for the plan, in a sentence. */
    val line: String,
    /** The note the user left, if any. */
    val note: String?,
    /** What a screen reader says for Undo, naming what it undoes. */
    val undoDescription: String,
    /** The question, when this is a sick span past its first day. It is still shown only until it is answered this session. */
    val ask: FeelingBetterAsk?,
    /** True when the status is a one-day skip (Undo is `undoSkip`) and false for a span (Undo ends it). */
    val oneDay: Boolean,
) {}

private fun head(reason: SkipReason, muscle: String?): String = when (reason) {
    SkipReason.Sick -> "Sick"
    SkipReason.Vacation -> "On vacation"
    SkipReason.Break -> "On a break"
    SkipReason.Scheduling -> "Scheduling"
    SkipReason.Injured -> if (muscle != null) "Injured: ${muscleName(muscle)}" else "Injured"
}

private fun sentence(reason: SkipReason, muscle: String?): String = when (reason) {
    SkipReason.Sick -> "Resting to get well. The plan shifts out."
    SkipReason.Vacation -> "Away from training. The plan shifts out."
    SkipReason.Break -> "Taking a few days off to recover. The plan holds."
    SkipReason.Scheduling -> "Could not fit it in today. The plan holds."
    SkipReason.Injured -> {
        val which = muscle?.let { "Direct ${muscleName(it)} work" } ?: "Direct work for it"
        "$which is off. Related lifts run at half volume."
    }
}

fun statusCard(status: DayStatus?, today: String): StatusCard? {
    if (status == null) return null
    val since = status.sickSince
    return StatusCard(
        reason = status.reason,
        head = head(status.reason, status.muscle),
        whenLine = spanLine(status, today),
        line = sentence(status.reason, status.muscle),
        note = status.note,
        undoDescription = when (status.span) {
            StatusSpan.OneDay -> "Undo today's skip, ${reasonWord(status.reason)}"
            is StatusSpan.Range -> "Undo ${reasonWord(status.reason)} status"
        },
        ask = if (since != null && since < today) FeelingBetterAsk(since) else null,
        oneDay = status.span == StatusSpan.OneDay,
    )
}

/**
 * Whether "Feeling better?" shows: only on a sick span's second day or later (day one never asks, the user just said they
 * were sick; a one-day skip never asks) and only until it has been answered once in this session.
 */
fun feelingBetterDue(card: StatusCard?, answeredThisSession: Boolean): Boolean = card?.ask != null && !answeredThisSession
