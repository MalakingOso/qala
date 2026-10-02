package com.qala.data.today

import com.qala.data.model.Availability
import com.qala.data.model.DaySkip
import com.qala.data.model.SkipReason

/** How the status covering a day was set: one skipped day, or the persistent status over a span. */
sealed interface StatusSpan {
    /** A one-day skip for the day itself. Undo is `undoSkip`. */
    data object OneDay : StatusSpan

    /** The persistent status: [since] through [until] inclusive, open (until cleared) when [until] is null. Undo ends it. */
    data class Range(val since: String, val until: String?) : StatusSpan
}

/**
 * Why a day is off or adjusted, and how it was set: what the Today banner says and what Undo and Change act on.
 * Built from the rules' answers, not from the records alone, so a one-day skip winning over the status is the
 * core's call (`reason_on`) and not a second copy of the rule.
 */
data class DayStatus(
    val reason: SkipReason,
    val span: StatusSpan,
    /** The muscle an injury guards (`injured_on`); null for every other reason. */
    val muscle: String? = null,
    val note: String? = null,
    /** Whether the reason pushes the plan out (`shifts_plan`): vacation and sick. */
    val shifts: Boolean = false,
) {
    /** The day a sick stretch began, when this is a sick span; null for a one-day skip or any other reason. */
    val sickSince: String? get() = (span as? StatusSpan.Range)?.takeIf { reason == SkipReason.Sick }?.since
}

object DayStatuses {
    /**
     * The status covering [date], or null when nothing does. [reason] is `reason_on` for the day, [injured] is
     * `injured_on`, [shifts] is `shifts_plan(reason)`; the records only add the span and the note. A one-day skip
     * for the date is the source when there is one (it wins over the status), else the persistent status.
     */
    fun of(
        date: String,
        availability: Availability,
        skips: List<DaySkip>,
        reason: SkipReason?,
        injured: List<String>,
        shifts: Boolean,
    ): DayStatus? {
        if (reason == null) return null
        val skip = skips.firstOrNull { it.date == date }
        val muscle = if (reason == SkipReason.Injured) injured.firstOrNull() else null
        return if (skip != null) {
            DayStatus(reason, StatusSpan.OneDay, muscle, skip.note?.takeIf { it.isNotBlank() }, shifts)
        } else {
            DayStatus(
                reason,
                StatusSpan.Range(availability.since?.takeIf { it.isNotEmpty() } ?: date, availability.until?.takeIf { it.isNotEmpty() }),
                muscle,
                availability.note?.takeIf { it.isNotBlank() },
                shifts,
            )
        }
    }
}
