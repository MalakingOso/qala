package com.qala.app.skip

import com.qala.app.today.dayWord
import com.qala.app.today.muscleName
import com.qala.app.today.shortDate
import com.qala.app.today.weekdayName
import com.qala.data.IsoTime
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.SkipReason
import com.qala.data.repo.AvailabilityRepository
import com.qala.data.today.DayStatus
import com.qala.data.today.StatusSpan
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/*
 * The skip sheet and the status card, as plain data (DESIGN 7.18). Five reasons, a muscle for an injury, a note and how
 * long. The tone is the rule: each reason says what happens (rests, shifts, guards) and nothing counts against you, so
 * there is no warning colour, no count and no scolding. A skip is never a miss. No Compose and no Rust here: whether a
 * reason shifts the plan is passed in (the core's `shifts_plan`), so the copy, the writes and the prefill are unit tested.
 */

/** How long a skip lasts. One day writes a `DaySkip`; anything longer sets the persistent status. */
enum class SkipSpan(val label: String, val days: Int?) {
    Day("This day only", 1),
    Three("3 days", 3),
    Seven("7 days", 7),
    Open("Until I say so", null),
}

/** The reasons in the order the sheet lists them. */
val SkipReasons = listOf(SkipReason.Break, SkipReason.Vacation, SkipReason.Sick, SkipReason.Injured, SkipReason.Scheduling)

/** The reason's name as a tile and a heading carry it. */
fun reasonTitle(reason: SkipReason): String = when (reason) {
    SkipReason.Break -> "On a Break"
    SkipReason.Vacation -> "On Vacation"
    SkipReason.Sick -> "Sick"
    SkipReason.Injured -> "Injured"
    SkipReason.Scheduling -> "Scheduling"
}

/** The engine muscle ids an injury can name, by body region. "back" is left out: the engine accepts it but nothing maps to it. */
val InjuryMuscles = listOf(
    "quads", "hamstrings", "glutes", "calves", "chest",
    "upperback", "lowerback", "lats", "frontdelts", "sidedelts",
    "reardelts", "biceps", "triceps", "forearms", "abs",
)

enum class SkipMode { New, Change }

/** What the sheet has been told so far. */
data class SkipDraft(
    val reason: SkipReason = SkipReason.Break,
    val muscle: String? = null,
    val span: SkipSpan = SkipSpan.Day,
    val note: String = "",
) {
    /** An injury has to name its muscle; every other reason is complete as it stands. */
    val valid: Boolean get() = reason != SkipReason.Injured || muscle != null

    fun withReason(r: SkipReason) = copy(reason = r, muscle = if (r == SkipReason.Injured) muscle else null)
    fun withMuscle(m: String) = copy(muscle = m)
    fun withSpan(s: SkipSpan) = copy(span = s)
    fun withNote(text: String) = copy(note = text)
}

/** The sheet's first state for a day: nothing set (Break, this day only), or the status that is already on it. */
fun initialDraft(status: DayStatus?, today: String): SkipDraft {
    if (status == null) return SkipDraft()
    val span = when (val s = status.span) {
        StatusSpan.OneDay -> SkipSpan.Day
        is StatusSpan.Range -> {
            val end = s.until
            if (end == null) {
                SkipSpan.Open
            } else {
                val left = ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(end)) + 1
                when {
                    left <= 1 -> SkipSpan.Day
                    left <= 3 -> SkipSpan.Three
                    else -> SkipSpan.Seven
                }
            }
        }
    }
    return SkipDraft(status.reason, status.muscle, span, status.note.orEmpty())
}

/** What the sheet opens with: the day it is for, its heading line, whether it is changing a status, and the first draft. */
class SkipRequest(val mode: SkipMode, val date: String, val status: DayStatus?, val draft: SkipDraft) {
    /** "Friday, Oct 2". */
    val dayLine: String get() = "${weekdayName(date)}, ${shortDate(date)}"
    val title: String get() = if (mode == SkipMode.New) "Skip today" else "Change status"
}

fun skipRequest(date: String, status: DayStatus?): SkipRequest =
    SkipRequest(if (status == null) SkipMode.New else SkipMode.Change, date, status, initialDraft(status, date))

/** The confirm button's label. A new skip names its length; a change just saves. */
fun confirmLabel(draft: SkipDraft, mode: SkipMode): String = when {
    !draft.valid -> "Pick a muscle first"
    mode == SkipMode.Change -> "Save change"
    else -> when (draft.span) {
        SkipSpan.Day -> "Skip today"
        SkipSpan.Three -> "Skip 3 days"
        SkipSpan.Seven -> "Skip 7 days"
        SkipSpan.Open -> "Skip until I say so"
    }
}

fun dismissLabel(mode: SkipMode): String = if (mode == SkipMode.New) "Keep training" else "Cancel"

/** "today", "for 3 days", "until you say so": how long, as a phrase after a verb. */
private fun duration(span: SkipSpan): String = when (span) {
    SkipSpan.Day -> "today"
    SkipSpan.Three -> "for 3 days"
    SkipSpan.Seven -> "for 7 days"
    SkipSpan.Open -> "until you say so"
}

/**
 * The live "what happens" line under the reasons: what the plan does for this reason, muscle and span. [shifts] is the
 * core's `shifts_plan` for the reason (vacation and sick push the plan out); an injury trains around the muscle instead.
 * Nothing in it counts against anyone.
 */
fun whatHappens(reason: SkipReason, muscle: String?, span: SkipSpan, shifts: Boolean): String = when {
    reason == SkipReason.Injured -> {
        val which = muscle?.let { "Direct ${muscleName(it)} work" } ?: "Direct work for the muscle you pick"
        "$which pauses ${duration(span)} and lifts that lean on it run at half volume. Everything else stays."
    }
    reason == SkipReason.Vacation && shifts -> "Away from training ${duration(span)}. Your plan shifts out by the days you are gone."
    reason == SkipReason.Sick && shifts -> "Resting to get well ${duration(span)}. Your plan shifts out, so nothing is lost."
    shifts -> "Training pauses ${duration(span)}. Your plan shifts out, so nothing is lost."
    else -> when (span) {
        SkipSpan.Day -> "Today rests. Your plan stays where it is."
        SkipSpan.Three -> "The next 3 days rest. Your plan stays where it is."
        SkipSpan.Seven -> "The next 7 days rest. Your plan stays where it is."
        SkipSpan.Open -> "Days rest until you say so. Your plan stays where it is."
    }
}

/** One change to the records. Applied in order by the container; each is one repository call. */
sealed interface SkipWrite {
    data class SkipDay(val date: String, val reason: SkipReason, val muscle: String?, val note: String?) : SkipWrite
    data class SetStatus(val status: AvailabilityStatus, val since: String, val until: String?, val muscle: String?, val note: String?) : SkipWrite
    data class UndoSkip(val date: String) : SkipWrite
    data object ClearStatus : SkipWrite
}

fun SkipReason.asStatus(): AvailabilityStatus = when (this) {
    SkipReason.Break -> AvailabilityStatus.Break
    SkipReason.Vacation -> AvailabilityStatus.Vacation
    SkipReason.Sick -> AvailabilityStatus.Sick
    SkipReason.Injured -> AvailabilityStatus.Injured
    SkipReason.Scheduling -> AvailabilityStatus.Scheduling
}

/**
 * The writes for Confirm. One day is a `DaySkip`; a longer span sets the status, running [SkipSpan.days] days from today
 * (open when null). What was on the day before is replaced, not stacked:
 *
 * - a one-day skip wins over the status in the core's `reason_on`, so a span written over one first undoes it;
 * - a span that is being shortened to this day only ends yesterday (or is cleared when it began today), so the days
 *   already marked keep their mark;
 * - changing a span that keeps its reason keeps its start, for the same reason.
 */
fun confirmWrites(draft: SkipDraft, today: String, existing: DayStatus?): List<SkipWrite> {
    require(draft.valid) { "an injury names a muscle" }
    val muscle = draft.muscle.takeIf { draft.reason == SkipReason.Injured }
    val note = draft.note.trim().ifEmpty { null }
    val writes = mutableListOf<SkipWrite>()
    val range = existing?.span as? StatusSpan.Range
    if (draft.span == SkipSpan.Day) {
        if (range != null) writes += endRange(existing, range, today)
        writes += SkipWrite.SkipDay(today, draft.reason, muscle, note)
    } else {
        if (existing?.span == StatusSpan.OneDay) writes += SkipWrite.UndoSkip(today)
        val since = if (range != null && existing.reason == draft.reason) range.since else today
        val until = draft.span.days?.let { IsoTime.addDays(today, it - 1L) }
        writes += SkipWrite.SetStatus(draft.reason.asStatus(), since, until, muscle, note)
    }
    return writes
}

/** Ends a status span before [today]: the day before when it began earlier, a clear when it began today. */
private fun endRange(status: DayStatus, range: StatusSpan.Range, today: String): SkipWrite =
    if (range.since < today) {
        SkipWrite.SetStatus(status.reason.asStatus(), range.since, IsoTime.addDays(today, -1), status.muscle, status.note)
    } else {
        SkipWrite.ClearStatus
    }

/** Undo, and "I am better": a one-day skip is undone; a span ends before today (or clears, when it began today). */
fun undoWrites(status: DayStatus, today: String): List<SkipWrite> = when (val s = status.span) {
    StatusSpan.OneDay -> listOf(SkipWrite.UndoSkip(today))
    is StatusSpan.Range -> listOf(endRange(status, s, today))
}

/** How long a status has run, for its sentence: "Since Thu", "Until Oct 9", "Since Thu, until Oct 9". */
fun spanLine(status: DayStatus, today: String): String = when (val s = status.span) {
    StatusSpan.OneDay -> "Today only"
    is StatusSpan.Range -> {
        val since = if (s.since < today) "since ${dayWord(today, s.since)}" else null
        val end = s.until
        val until = if (end == null) "until you say so" else "until ${dayWord(today, end)}"
        (listOfNotNull(since, until).joinToString(", ")).replaceFirstChar { it.uppercase() }
    }
}

/** Applies [writes] in order. Each is one repository call, on the repository's own dispatcher. */
suspend fun AvailabilityRepository.apply(writes: List<SkipWrite>) {
    for (write in writes) {
        when (write) {
            is SkipWrite.SkipDay -> skip(write.date, write.reason, write.muscle, write.note)
            is SkipWrite.SetStatus -> setStatus(write.status, write.since, write.until, write.muscle, write.note)
            is SkipWrite.UndoSkip -> undoSkip(write.date)
            SkipWrite.ClearStatus -> clearStatus()
        }
    }
}
