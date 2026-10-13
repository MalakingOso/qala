package com.qala.app.plan

import com.qala.app.skip.spanLine
import com.qala.app.today.CtaIcon
import com.qala.app.today.Cta
import com.qala.app.today.Destination
import com.qala.app.today.TodayModel
import com.qala.app.today.label
import com.qala.app.today.dayWord
import com.qala.app.today.distanceIn
import com.qala.app.today.distanceUnit
import com.qala.app.today.effortText
import com.qala.app.today.formatClock
import com.qala.app.today.injuredLine
import com.qala.app.today.plural
import com.qala.app.today.reasonWord
import com.qala.app.today.shortDate
import com.qala.app.today.statusCard
import com.qala.app.today.trimNumber
import com.qala.app.today.unitName
import com.qala.app.today.weekdayName
import com.qala.data.model.RunPlanDay
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.plan.LiftSource
import com.qala.data.plan.PlanBounds
import com.qala.data.plan.PlanDay
import com.qala.data.plan.PlanWeekData
import com.qala.data.program.ExerciseOverview
import com.qala.data.program.PlannedSet
import com.qala.data.today.DayKind
import com.qala.data.today.StageId
import com.qala.data.today.StatusSpan

/*
 * What the Plan screen shows, as plain data (DESIGN 7.2, DECISIONS U4 and U16). Everything here is a pure function of a
 * [PlanWeekData] (the week, laid out by the data module off the same schedule Today's strip reads) and where the user is
 * looking (a week, a day, a view), so the labels, the day states and the buttons are unit tested on the JVM with no
 * Compose, no Rust and no clock. The composables in PlanScreen add nothing of their own.
 */

/** The three ways to read a lift day: its exercises in a line each, every set, or the warm-ups. */
enum class PlanView(val label: String) {
    Overview("Overview"),
    EverySet("Every set"),
    WarmUp("Warm-up"),
}

/**
 * Where the user is looking: [offset] weeks from this one (0 is this week), the weekday [day] (0 is Monday) and the
 * [view] of it. Moving to another week keeps the weekday, as the web page does.
 */
data class PlanNav(val offset: Int = 0, val day: Int = 0, val view: PlanView = PlanView.Overview) {
    /** The week before, or this one unchanged at the first week [bounds] reach. */
    fun previous(bounds: PlanBounds) = if (offset > bounds.minOffset) copy(offset = offset - 1) else this

    fun next(bounds: PlanBounds) = if (offset < bounds.maxOffset) copy(offset = offset + 1) else this

    /** Back to this week, on today's weekday. */
    fun thisWeek(todayWeekday: Int) = copy(offset = 0, day = todayWeekday.coerceIn(0, 6))

    fun select(weekday: Int) = copy(day = weekday.coerceIn(0, 6))

    fun show(view: PlanView) = copy(view = view)

    /** Brought back inside [bounds], for a record that arrived or went since the state was saved. */
    fun within(bounds: PlanBounds) = copy(offset = offset.coerceIn(bounds.minOffset, bounds.maxOffset))
}

/** The week switcher: its title, the dates under it and whether each arrow has a week to go to. */
class WeekBar(
    val label: String,
    /** "Oct 12 to Oct 18". */
    val range: String,
    val canPrevious: Boolean,
    val canNext: Boolean,
    /** False when the user has moved off this week and "Back to this week" is offered. */
    val onThisWeek: Boolean,
)

/** Where a day stands, which sets how its tab reads. */
enum class TabState { Done, Today, NotLogged, Later, Rest, Skipped }

/** The glyph on a day tab. A skipped day takes its reason's. */
enum class TabGlyph { Check, Lift, Run, Rest }

class DayTab(
    /** "Mon". */
    val name: String,
    /** "12": the day of the month. */
    val date: String,
    val state: TabState,
    val glyph: TabGlyph,
    /** Set on a skipped day. */
    val reason: SkipReason?,
    val selected: Boolean,
    val today: Boolean,
    /** What a screen reader says for the tab: "Monday 12, Day 1, done". */
    val description: String,
)

/**
 * A button on the day. [primary] is the ember one: only today's carries it, and only where there is something to start.
 * A done day offers "See what you did" as a quiet one.
 *
 * TODO: the web page also has "Do this today instead" on a later day (needs a program-day argument Route.Workout does
 * not carry yet) and "Skip this day" / "Undo skip" (the skip sheet is built around today). Neither is built here.
 */
class PlanCta(val label: String, val to: Destination, val icon: CtaIcon, val primary: Boolean = true)

/** On a done day: History, which opens as a screen of its own for now, not on that session (TODO once History takes an argument). */
private val SeeWhatYouDid = PlanCta("See what you did", Destination.History, CtaIcon.None, primary = false)

/**
 * What Today would do next on today's lift day: the stage the day is on and the live button Today's hero offers for it
 * ("Check in", "Start warm-up", "Start workout", "Start run"). Plan's button on today is this one, so the two never
 * disagree about the order: the lift is only offered once check-in and warm-up are done or skipped.
 */
class TodayNext(val stage: StageId, val cta: Cta)

/** Today's next stage and button, read from [TodayModel] itself rather than decided again; null when the day's work is done. */
fun todayNext(model: TodayModel): TodayNext? {
    val stage = model.plan.now ?: return null
    val cta = model.hero(model.nowIndex).cta ?: return null
    return TodayNext(stage, cta)
}

/** One exercise of a lift day: its line for the overview, then every set and every warm-up set for the other views. */
class ExerciseRow(
    val name: String,
    /** "4 × 3, 1 × 3+ @ 150 lb", or "No sets" for an exercise with none. */
    val scheme: String,
    /** "150 lb × 3", one per set. */
    val sets: List<String>,
    val warmups: List<String>,
)

/** The run on a day, as a row beside the exercises. */
class RunRow(val title: String, val line: String)

/** The selected day: what it is, what is on it and what can be done with it. */
class DayCard(
    /** "Wednesday, Oct 14 · today". */
    val eyebrow: String,
    val title: String,
    /** "Bench Press day". */
    val subtitle: String? = null,
    /** "3 exercises · 11 sets". */
    val detail: String? = null,
    /** Set on a skipped day: its reason's glyph leads the card. */
    val reason: SkipReason? = null,
    /** Sentences under the title: what a skip means for the plan, what an injury does, why there is nothing to list. */
    val lines: List<String> = emptyList(),
    /** The note left with a skip, or on the session that was lifted. */
    val note: String? = null,
    val cta: PlanCta? = null,
    /** A line under the button: why it is not Start workout. */
    val ctaNote: String? = null,
    /** The quiet button under it: "See what you did". */
    val secondary: PlanCta? = null,
    /** True on today: the card carries the shadow. */
    val hero: Boolean = false,
    /** The views on offer; empty when the day has no exercises to read. */
    val views: List<PlanView> = emptyList(),
    val view: PlanView = PlanView.Overview,
    val exercises: List<ExerciseRow> = emptyList(),
    val run: RunRow? = null,
    /** Small print under the exercises. */
    val footnote: String? = null,
)

/** The week in two lines: what it holds and how it went. */
class WeekSummary(val title: String, val holds: String, val went: String)

class PlanModel(
    val data: PlanWeekData,
    val nav: PlanNav,
    val bounds: PlanBounds,
    private val use24h: Boolean = false,
    /** Where Today's day stands; null while Today has not loaded, when today has no button. */
    private val todayNext: TodayNext? = null,
) {
    private val today = data.today

    /** The program and its rotation. The web's block name and "week 3 of 6" have no source here: a program is a rotation of days, not a block of weeks. */
    val eyebrow: String = data.programName?.let { "$it · ${data.dayCount}-day rotation" } ?: "No program yet"

    val week: WeekBar = WeekBar(
        label = weekLabel(data.offset),
        range = "${shortDate(data.weekStart)} to ${shortDate(data.days.last().date)}",
        canPrevious = nav.offset > bounds.minOffset,
        canNext = nav.offset < bounds.maxOffset,
        onThisWeek = nav.offset == 0,
    )

    val selectedDay: Int = nav.day.coerceIn(0, data.days.lastIndex)

    val tabs: List<DayTab> = data.days.mapIndexed { i, d -> tab(d, selected = i == selectedDay) }

    val card: DayCard = card(data.days[selectedDay])

    val summary: WeekSummary = summary()

    // ---- tabs ----

    private fun state(d: PlanDay): TabState = when {
        d.day.reason != null -> TabState.Skipped
        d.day.logged -> TabState.Done
        d.date == today && d.day.kind != DayKind.REST -> TabState.Today
        d.day.kind == DayKind.REST -> TabState.Rest
        d.date < today -> TabState.NotLogged
        else -> TabState.Later
    }

    private fun tab(d: PlanDay, selected: Boolean): DayTab {
        val state = state(d)
        val glyph = when {
            state == TabState.Done -> TabGlyph.Check
            d.day.kind == DayKind.LIFT -> TabGlyph.Lift
            d.day.kind == DayKind.RUN -> TabGlyph.Run
            else -> TabGlyph.Rest
        }
        val kind = when {
            state == TabState.Skipped -> "skipped, ${reasonWord(d.day.reason!!)}"
            d.day.kind == DayKind.LIFT -> d.lift?.dayName ?: "lift day"
            d.day.kind == DayKind.RUN -> "run day"
            else -> "rest day"
        }
        val status = when {
            state == TabState.Done -> "done"
            state == TabState.NotLogged -> "not logged"
            d.date == today -> "today"
            else -> null
        }
        return DayTab(
            name = weekdayName(d.date).take(3),
            date = d.date.takeLast(2).trimStart('0'),
            state = state,
            glyph = glyph,
            reason = d.day.reason,
            selected = selected,
            today = d.date == today,
            description = listOfNotNull("${weekdayName(d.date)} ${d.date.takeLast(2).trimStart('0')}", kind, status).joinToString(", "),
        )
    }

    // ---- the day ----

    private fun dayLine(d: PlanDay) = "${weekdayName(d.date)}, ${shortDate(d.date)}"

    private fun card(d: PlanDay): DayCard {
        val state = state(d)
        val isToday = d.date == today
        return when {
            state == TabState.Skipped -> skippedCard(d, isToday)
            d.lift != null -> liftCard(d, state, isToday)
            d.day.kind == DayKind.LIFT -> noProgramCard(d, state, isToday)
            d.run != null -> runCard(d, state, isToday)
            else -> restCard(d, isToday)
        }
    }

    /** "Wednesday, Oct 14 · today · done", or the day alone for one that is just ahead. */
    private fun eyebrow(d: PlanDay, state: TabState): String = listOfNotNull(
        dayLine(d),
        if (d.date == today) "today" else null,
        when (state) {
            TabState.Done -> "done"
            TabState.NotLogged -> "not logged"
            TabState.Rest -> "rest day"
            else -> null
        },
    ).joinToString(" · ")

    private fun skippedCard(d: PlanDay, isToday: Boolean): DayCard {
        val status = d.status
        val reason = d.day.reason!!
        val card = status?.let { statusCard(it, today) }
        val shifts = status?.shifts == true
        val eyebrow = "${dayLine(d)} · skipped, ${reasonWord(reason)}" + if (shifts) " · shifts the plan" else ""
        val whenLine = status?.let { st ->
            when (st.span) {
                StatusSpan.OneDay -> if (isToday) "Today only" else "This day only"
                is StatusSpan.Range -> spanLine(st, today)
            }
        }
        val to = d.movesTo
        val moves = when {
            !d.training || !shifts -> null
            to == null -> "The lift moves out until the status ends."
            to > today -> "The lift moves to ${dayWord(today, to)}."
            else -> "The lift moved to ${dayWord(today, to)}."
        }
        return DayCard(
            eyebrow = eyebrow,
            title = card?.head ?: "Skipped",
            subtitle = whenLine,
            reason = reason,
            lines = listOfNotNull(card?.line, moves),
            note = card?.note,
            hero = isToday,
        )
    }

    private fun liftCard(d: PlanDay, state: TabState, isToday: Boolean): DayCard {
        val lift = d.lift!!
        val done = lift.source == LiftSource.LOGGED
        val rows = lift.exercises.map { row(it) }
        val views = buildList {
            if (rows.isNotEmpty()) {
                add(PlanView.Overview)
                add(PlanView.EverySet)
                if (lift.exercises.any { it.warmups.isNotEmpty() }) add(PlanView.WarmUp)
            }
        }
        val view = nav.view.takeIf { it in views } ?: PlanView.Overview
        val sets = lift.exercises.sumOf { it.sets.size }
        val minutes = lift.minutes?.let { "${trimNumber(it)} min" }
        val at = if (done) lift.doneAtMs?.let { "Done at ${formatClock(it, lift.doneOffsetMin ?: 0, use24h)}" } else null
        val detail = when {
            done && lift.stub -> listOfNotNull(at, "no sets logged")
            done -> listOfNotNull(at, if (rows.isNotEmpty()) "${plural(rows.size, "exercise")} · ${plural(sets, "set")}" else null, minutes)
            rows.isNotEmpty() -> listOf("${plural(rows.size, "exercise")} · ${plural(sets, "set")}")
            else -> emptyList()
        }.joinToString(" · ").ifEmpty { null }
        val run = d.run?.takeIf { !it.off }
        val (cta, ctaNote) = liftCta(d, isToday, done)
        return DayCard(
            eyebrow = eyebrow(d, state),
            title = lift.dayName ?: "Lift day",
            subtitle = lift.mainExerciseName?.let { "$it day" },
            detail = detail,
            lines = listOfNotNull(
                d.injured.firstOrNull()?.let { injuredLine(it) },
                if (rows.isEmpty() && !lift.stub) "The program has nothing prescribed for this day." else null,
            ),
            note = lift.notes,
            cta = cta,
            ctaNote = ctaNote,
            secondary = if (done) SeeWhatYouDid else null,
            hero = isToday,
            views = views,
            view = view,
            exercises = rows,
            run = run?.let { runRow(it.plan, it.logged) },
            footnote = if (!done && rows.isNotEmpty() && d.date > today) "Loads are what the program holds now. They update after each session." else null,
        )
    }

    /** A lift weekday with no program behind it: the day is set, there is just nothing to list. */
    private fun noProgramCard(d: PlanDay, state: TabState, isToday: Boolean): DayCard {
        val run = d.run?.takeIf { !it.off }
        return DayCard(
            eyebrow = eyebrow(d, state),
            title = "Lift day",
            lines = listOf(
                if (data.dayCount > 0) "The program has nothing prescribed for this day."
                else "No program yet. Once one is added, each lift day lists its exercises here.",
            ),
            hero = isToday,
            run = run?.let { runRow(it.plan, it.logged) },
            // TODO: a link to add a program, when programs can be added on the phone.
        )
    }

    private fun runCard(d: PlanDay, state: TabState, isToday: Boolean): DayCard {
        val run = d.run!!
        return DayCard(
            eyebrow = eyebrow(d, state),
            title = run.plan.label,
            subtitle = "${distanceIn(data.unit, run.plan.distanceM)} ${distanceUnit(data.unit)} · ${effortText(run.plan.zone).lowercase()}",
            cta = runOnlyCta(d, isToday),
            secondary = if (run.logged) SeeWhatYouDid else null,
            hero = isToday,
        )
    }

    private fun restCard(d: PlanDay, isToday: Boolean) = DayCard(
        eyebrow = eyebrow(d, TabState.Rest),
        title = "Rest day",
        lines = listOf("Nothing is planned. Eat well, drink water and take a walk."),
        hero = isToday,
    )

    /**
     * Today's button for an unlogged lift day, taken from Today: whatever stage Today is on. With check-in or the warm-up still
     * ahead that is their button and a line says the lift comes after, so Start workout is only offered when Today offers it.
     * With the lift done, the run is next when one is planned today. Any other day has no button.
     */
    private fun liftCta(d: PlanDay, isToday: Boolean, liftDone: Boolean): Pair<PlanCta?, String?> {
        val next = todayNext
        if (!isToday || next == null) return null to null
        if (liftDone) {
            val run = d.run
            val runNext = run != null && !run.off && !run.logged && next.stage == StageId.RUN
            return (if (runNext) next.cta.asPlan() else null) to null
        }
        val note = if (next.stage == StageId.LIFT) null else "${next.stage.label} comes before the lift."
        return next.cta.asPlan() to note
    }

    /** A run-only day has no stages on Today, so Start run is its own button, on today while the run is not logged. */
    private fun runOnlyCta(d: PlanDay, isToday: Boolean): PlanCta? {
        val run = d.run ?: return null
        return if (isToday && !run.off && !run.logged) PlanCta("Start run", Destination.Run, CtaIcon.SportShoe) else null
    }

    private fun Cta.asPlan() = PlanCta(label, to, icon)

    private fun runRow(run: RunPlanDay, logged: Boolean) = RunRow(
        title = run.label,
        line = listOfNotNull(
            "${distanceIn(data.unit, run.distanceM)} ${distanceUnit(data.unit)}",
            effortText(run.zone).lowercase(),
            if (logged) "done" else null,
        ).joinToString(" · "),
    )

    private fun row(e: ExerciseOverview) = ExerciseRow(
        name = e.name,
        scheme = setScheme(e.sets),
        sets = e.sets.map { setText(it) },
        warmups = e.warmups.map { setText(it) },
    )

    // ---- the week ----

    private fun summary(): WeekSummary {
        val days = data.days
        val lifts = days.count { it.day.kind == DayKind.LIFT }
        val runs = days.count { it.run?.off == false }
        val states = days.map { it to state(it) }
        // A skipped day only counts when it would have trained: a vacation over a whole week is not seven shifts.
        val off = states.filter { (d, s) -> s == TabState.Skipped && (d.training || d.run != null) }
        val shifted = off.count { (d, _) -> d.status?.shifts == true }
        val parts = listOfNotNull(
            states.count { it.second == TabState.Done }.takeIf { it > 0 }?.let { "$it done" },
            (off.size - shifted).takeIf { it > 0 }?.let { "$it skipped" },
            shifted.takeIf { it > 0 }?.let { "$it shifted" },
            states.count { it.second == TabState.NotLogged }.takeIf { it > 0 }?.let { "$it not logged" },
        )
        return WeekSummary(
            title = week.label,
            holds = "${plural(lifts, "lift")} · ${plural(runs, "run")}",
            went = parts.joinToString(" · ").ifEmpty { "Nothing logged yet" },
        )
    }
}

/** "This week", "Next week", "Last week", "In 3 weeks", "3 weeks ago". */
fun weekLabel(offset: Int): String = when {
    offset == 0 -> "This week"
    offset == 1 -> "Next week"
    offset == -1 -> "Last week"
    offset > 1 -> "In $offset weeks"
    else -> "${-offset} weeks ago"
}

// ---- sets ----

private fun repsText(s: PlannedSet): String {
    val top = trimNumber(s.reps) + if (s.amrap) "+" else ""
    return s.minReps?.let { "${trimNumber(it)}-$top" } ?: top
}

private fun weightText(weight: Double, unit: WeightUnit) = "${trimNumber(weight)} ${unitName(unit)}"

/** One set on its own line: "150 lb × 3+", or "8 reps" for work with no load. */
fun setText(s: PlannedSet): String = s.weight?.let { "${weightText(it, s.unit)} × ${repsText(s)}" } ?: "${repsText(s)} reps"

/**
 * An exercise's sets in one line: consecutive identical sets run together ("4 × 3, 1 × 3+"), and the weight comes once
 * at the end when every set has the same one, else after each run.
 */
fun setScheme(sets: List<PlannedSet>): String {
    if (sets.isEmpty()) return "No sets"
    val runs = ArrayList<Pair<PlannedSet, Int>>()
    // The target RPE and the rest timer do not make two sets different lines of the scheme.
    for (s in sets.map { it.copy(rpe = null, timerSec = null) }) {
        if (runs.isNotEmpty() && runs.last().first == s) runs[runs.lastIndex] = s to runs.last().second + 1 else runs += s to 1
    }
    val loads = runs.map { it.first.weight to it.first.unit }.distinct()
    val single = loads.size == 1
    val parts = runs.map { (s, n) ->
        val reps = if (s.weight == null && n == 1 && runs.size == 1) "${repsText(s)} reps" else "$n × ${repsText(s)}"
        if (single || s.weight == null) reps else "$reps @ ${weightText(s.weight!!, s.unit)}"
    }
    val tail = loads.singleOrNull()?.let { (w, u) -> w?.let { " @ ${weightText(it, u)}" } }.orEmpty()
    return parts.joinToString(", ") + tail
}
