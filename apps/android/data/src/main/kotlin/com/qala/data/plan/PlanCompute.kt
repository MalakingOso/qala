package com.qala.data.plan

import com.qala.data.IsoTime
import com.qala.data.core.QalaCore
import com.qala.data.core.dayName
import com.qala.data.core.injuredOn
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftSetEntity
import com.qala.data.engine.EngineInput
import com.qala.data.model.RunPlanDay
import com.qala.data.model.WeightUnit
import com.qala.data.model.toModel
import com.qala.data.program.DayOverview
import com.qala.data.program.EvaluatedProgram
import com.qala.data.program.ExerciseOverview
import com.qala.data.program.PlannedSet
import com.qala.data.program.ProgramEngine
import com.qala.data.today.DayKind
import com.qala.data.today.DayPlan
import com.qala.data.today.DayStatus
import com.qala.data.today.DayStatuses
import com.qala.data.today.RustDayRules
import com.qala.data.today.Schedule
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/*
 * The Plan screen's data (DESIGN 7.2): any week laid out on the same footing as Today's. The week comes from the same
 * [Schedule] Today's strip and rail read, so this week is, day for day, the week in the engine snapshot; an earlier week
 * is what the records say and a later one is projected forward from this one. Everything here is Rust and JSON work, so
 * call it off the main thread. Nothing reads a clock or touches storage.
 */

/** How far ahead of this week the arrows go. A later week is a projection, so it stops where the guess stops being useful. */
const val MaxWeeksAhead = 8

/** How far back, at most. Older history is the History screen's. */
const val MaxWeeksBack = 26

/** Where a lift's exercises come from: what the program prescribes, or what was logged on that day. */
enum class LiftSource { PLANNED, LOGGED }

/**
 * A lift day's work. A day not yet lifted shows the program's prescription as it stands now ([LiftSource.PLANNED]; LS++ moves
 * the loads when a session finishes, so a later day can be heavier by the time it comes round). A day already lifted shows
 * what was done ([LiftSource.LOGGED]), because the program has moved on from it since: asking it again would give the
 * next session's loads.
 */
data class PlanLift(
    val programDay: Int,
    /** The program's own heading ("Day 3"); null when there is no program to name it. */
    val dayName: String?,
    /** The exercise that leads the day, as the Today hero names it. */
    val mainExerciseName: String?,
    val source: LiftSource,
    val exercises: List<ExerciseOverview>,
    /** For a logged lift: when it started, and the offset it is read at. */
    val doneAtMs: Long? = null,
    val doneOffsetMin: Int? = null,
    /** For a logged lift: the minutes it took, when it recorded any. */
    val minutes: Double? = null,
    /** True for a placeholder (Mark done) with no sets. */
    val stub: Boolean = false,
    /** For a logged lift: the note left on the session. */
    val notes: String? = null,
)

/** A run the plan puts on a day. [off] is true when the day is skipped, so the run goes with it. */
data class PlanRun(val plan: RunPlanDay, val logged: Boolean, val off: Boolean = false)

/** One day of a planned week: the schedule's own [day] (what Today's strip reads), and what the Plan adds to it. */
data class PlanDay(
    val day: DayPlan,
    /** Whether the weekday is one of the training weekdays, whether or not the day is skipped. */
    val training: Boolean,
    val lift: PlanLift?,
    val run: PlanRun?,
    /** Why the day is off and how that was set; null when it trains. */
    val status: DayStatus?,
    /** The day a shifted lift comes up instead (the next lift day after this one); null when nothing shifts or none is in reach. */
    val movesTo: String?,
    /** The muscle an injury guards on a lift day (at most one): the day still lifts, around it. */
    val injured: List<String>,
) {
    val date: String get() = day.date
}

data class PlanWeekData(
    /** The local day this was laid out for. */
    val today: String,
    /** 0 is this week, 1 next week, -1 last week. */
    val offset: Int,
    val weekStart: String,
    /** The program's name without its `.md`; null when there is none. */
    val programName: String?,
    /** Days in the program's rotation; 0 when there is no program. */
    val dayCount: Int,
    val unit: WeightUnit,
    val days: List<PlanDay>,
)

/** The weeks the arrows reach, as offsets from this week: [minOffset] is zero or negative, [maxOffset] zero or more. */
data class PlanBounds(val minOffset: Int, val maxOffset: Int) {
    init {
        require(minOffset <= 0 && maxOffset >= 0) { "this week is always within reach" }
    }
}

class PlanCompute(private val programs: ProgramEngine = ProgramEngine()) {
    /** The weeks to reach: back to the first logged lift or run (at most [MaxWeeksBack]), ahead [MaxWeeksAhead]. */
    fun bounds(input: EngineInput, nowMs: Long, zone: ZoneId): PlanBounds {
        val thisWeek = IsoTime.weekStart(IsoTime.localDateKey(nowMs, IsoTime.offsetMinAt(zone, nowMs)))
        val first = (
            input.liftSessions.map { IsoTime.localDateKey(it.session.startedAtMs, it.session.offsetMin) } +
                input.runs.map { IsoTime.localDateKey(it.startedAtMs, it.offsetMin) }
            ).minOrNull()
        val back = first?.let { ChronoUnit.WEEKS.between(LocalDate.parse(IsoTime.weekStart(it)), LocalDate.parse(thisWeek)).toInt() } ?: 0
        return PlanBounds(-back.coerceIn(0, MaxWeeksBack), MaxWeeksAhead)
    }

    /** The week [offset] weeks from the one containing now. */
    fun week(input: EngineInput, nowMs: Long, zone: ZoneId, offset: Int): PlanWeekData {
        val today = IsoTime.localDateKey(nowMs, IsoTime.offsetMinAt(zone, nowMs))
        val weekStart = IsoTime.addDays(IsoTime.weekStart(today), offset * 7L)
        val skips = input.skips.map { it.toModel() }
        val rules = RustDayRules(input.availability, skips)
        val evaluated: EvaluatedProgram? = input.program?.let { programs.evaluate(it.text, it.name, input.settings.unit, input.exerciseData) }
        val dayCount = evaluated?.dayCount ?: 0
        val schedule = Schedule(input.settings.trainingWeekdays.toSet(), dayCount, input.liftSessions.map { it.session }, rules)
        val week = schedule.weekOn(weekStart, today, input.runPlan, input.runs)

        val overviews = HashMap<Int, DayOverview?>()
        fun overview(day: Int, sets: Boolean): DayOverview? =
            if (evaluated == null) null else overviews.getOrPut(day * 2 + if (sets) 1 else 0) { programs.dayOverview(evaluated, day, input.settings.mainLifts, input.settings.unit, sets) }

        val days = week.days.map { day ->
            val date = day.date
            val shifts = day.reason?.let { rules.shiftsPlan(it) } ?: false
            val programDay = day.programDay
            val lift = if (day.kind == DayKind.LIFT && programDay != null) {
                val logged = if (day.logged) schedule.liftedOn(date)?.let { entity -> input.liftSessions.firstOrNull { it.session.id == entity.id } } else null
                if (logged != null) {
                    loggedLift(logged, programDay, evaluated, overview(programDay, sets = false))
                } else {
                    overview(programDay, sets = true)?.let { o -> PlanLift(programDay, o.dayName, o.mainExerciseName, LiftSource.PLANNED, o.exercises) }
                }
            } else {
                null
            }
            val runDay = input.runPlan.on(day.weekday)
            val ranOn = runDay != null && day.reason == null && input.runs.any { IsoTime.localDateKey(it.startedAtMs, it.offsetMin) == date }
            PlanDay(
                day = day,
                training = schedule.isTrainingWeekday(date),
                lift = lift,
                run = runDay?.let { PlanRun(it, ranOn, off = day.reason != null) },
                status = day.reason?.let { DayStatuses.of(date, input.availability, skips, it, emptyList(), shifts) },
                movesTo = if (shifts && schedule.isTrainingWeekday(date)) nextLiftAfter(schedule, date, today, input) else null,
                injured = if (day.kind == DayKind.LIFT && day.reason == null) QalaCore.injuredOn(date, input.availability, skips) else emptyList(),
            )
        }
        return PlanWeekData(
            today = today,
            offset = offset,
            weekStart = weekStart,
            programName = input.program?.name?.removeSuffix(".md"),
            dayCount = dayCount,
            unit = input.settings.unit,
            days = days,
        )
    }

    /** The first lift day after [date], looking [MaxWeeksAhead] weeks on; null when every one of them is off. */
    private fun nextLiftAfter(schedule: Schedule, date: String, today: String, input: EngineInput): String? {
        var start = IsoTime.weekStart(date)
        repeat(MaxWeeksAhead + 1) {
            schedule.weekOn(start, today, input.runPlan, input.runs).days
                .firstOrNull { it.date > date && it.kind == DayKind.LIFT }?.let { return it.date }
            start = IsoTime.addDays(start, 7)
        }
        return null
    }

    private fun loggedLift(session: LiftSessionWithEntries, programDay: Int, evaluated: EvaluatedProgram?, names: DayOverview?): PlanLift {
        val byId = names?.exercises?.associate { it.exerciseId to it.name }.orEmpty()
        val exercises = session.entries.sortedBy { it.entry.position }.mapNotNull { e ->
            val done = e.sets.filter { it.completed }.sortedBy { it.position }
            val work = done.filter { !it.warmup }.map(::loggedSet)
            val warm = done.filter { it.warmup }.map(::loggedSet)
            if (work.isEmpty() && warm.isEmpty()) {
                null
            } else {
                ExerciseOverview(e.entry.exerciseId, byId[e.entry.exerciseId] ?: humanize(e.entry.exerciseId), work, warm)
            }
        }
        return PlanLift(
            programDay = programDay,
            dayName = evaluated?.let { QalaCore.dayName(it.program, programDay) },
            mainExerciseName = names?.mainExerciseName,
            source = LiftSource.LOGGED,
            exercises = exercises,
            doneAtMs = session.session.startedAtMs,
            doneOffsetMin = session.session.offsetMin,
            minutes = session.session.minutes,
            stub = session.session.stub,
            notes = session.session.notes?.trim()?.takeIf { it.isNotEmpty() },
        )
    }

    private fun loggedSet(set: LiftSetEntity) = PlannedSet(
        weight = set.weight.takeIf { it > 0.0 },
        unit = if (set.unit == "kg") WeightUnit.Kg else WeightUnit.Lb,
        reps = set.reps,
        minReps = null,
        amrap = false,
        rpe = set.rpe,
        timerSec = null,
    )

    /** "benchPress" as "Bench Press": the name of an exercise the program no longer lists on the day. */
    private fun humanize(id: String): String =
        id.replace(Regex("([a-z0-9])([A-Z])"), "$1 $2").replaceFirstChar { it.uppercase() }
}
