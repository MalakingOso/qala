package com.qala.data.today

import com.qala.data.IsoTime
import com.qala.data.core.QalaCore
import com.qala.data.core.reasonOn
import com.qala.data.core.shiftsPlan
import com.qala.data.db.CheckInEntity
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftStage
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.Availability
import com.qala.data.model.DaySkip
import com.qala.data.model.RunPlan
import com.qala.data.model.RunPlanDay
import com.qala.data.model.SkipReason

/** Why a day is off and whether the plan moves for it: the two availability rules the schedule reads. */
interface DayRules {
    /** The skip reason covering a local `YYYY-MM-DD` day, or null when it trains. A one-day skip wins over the status. */
    fun reasonOn(date: String): SkipReason?

    /** Vacation and sick push the plan out; break, scheduling and injured do not. */
    fun shiftsPlan(reason: SkipReason): Boolean
}

/** The rules as qala-core computes them (`reason_on`, `shifts_plan`). */
class RustDayRules(private val availability: Availability, private val skips: List<DaySkip>) : DayRules {
    override fun reasonOn(date: String): SkipReason? = QalaCore.reasonOn(date, availability, skips)
    override fun shiftsPlan(reason: SkipReason): Boolean = QalaCore.shiftsPlan(reason)
}

/**
 * The reason that takes [date] off training, or null when it trains. An injury is not one: it trains around the muscle,
 * so an injured training day is still a lift day (the injured-muscle guard cuts or halves the work that leans on it,
 * DESIGN 7.18). Everything that decides whether a day lifts reads this, not [DayRules.reasonOn].
 */
internal fun DayRules.offReasonOn(date: String): SkipReason? = reasonOn(date)?.takeIf { it != SkipReason.Injured }

/** The logged rows the schedule and the stage deriver read (live rows only: tombstones are filtered upstream). */
class DayRecords(
    val liftSessions: List<LiftSessionEntity> = emptyList(),
    val runs: List<RunSessionEntity> = emptyList(),
    val checkIns: List<CheckInEntity> = emptyList(),
)

/** What a calendar day holds in the plan. */
enum class DayKind { LIFT, RUN, REST }

/** One day of the planned week. [programDay] is the 1-based LS++ day on a lift day; [reason] why an otherwise planned day is off. */
data class DayPlan(
    val date: String,
    /** 0 is Monday. */
    val weekday: Int,
    val kind: DayKind,
    val programDay: Int?,
    val run: RunPlanDay?,
    val reason: SkipReason?,
    /** True when the day's lift or run is already logged. */
    val logged: Boolean,
)

class WeekPlan(val weekStart: String, val days: List<DayPlan>) {
    fun on(date: String): DayPlan? = days.firstOrNull { it.date == date }
}

/**
 * The calendar side of the program (docs/archive/completed.md, M2 as built).
 *
 * The program rotates over `dayCount` days. The day after a logged lift is `last % dayCount + 1`, and a
 * lift that is never logged is simply done again (a miss is not a skip, nothing moves). Skips move the plan
 * by [DayRules.shiftsPlan]: a vacation or sick day pushes the lift out, so the next training day takes the
 * same program day; a break or scheduling day on a training weekday spends its slot, so the rotation moves
 * one day on without a session. An injured day is a lift day (see [offReasonOn]): the lift runs around the
 * muscle and the rotation moves on as usual. A lift logged on a day wins over any skip that covers it.
 *
 * Stub records count like real ones for sequencing, except a warm-up stub: the warm-up is not the lift.
 */
class Schedule(
    private val trainingWeekdays: Set<Int>,
    private val dayCount: Int,
    private val lifts: List<LiftSessionEntity>,
    private val rules: DayRules,
) {
    /** A lift that advances the rotation, with its local date. */
    private class Lifted(val date: String, val day: Int?, val startedAtMs: Long, val id: String)

    private val sequencing: List<Lifted> = lifts
        .filter { it.stage != LiftStage.WARMUP }
        .map { Lifted(IsoTime.localDateKey(it.startedAtMs, it.offsetMin), it.programDayIndex, it.startedAtMs, it.id) }
        .sortedWith(compareBy({ it.startedAtMs }, { it.id }))

    fun isTrainingWeekday(date: String) = IsoTime.weekdayIndex(date) in trainingWeekdays

    /** The day after [day] in the rotation. */
    fun after(day: Int): Int = if (dayCount <= 0) 1 else day % dayCount + 1

    /** [day] moved on by [steps] days of the rotation. */
    private fun advance(day: Int, steps: Int): Int = if (dayCount <= 0) 1 else (day - 1 + steps) % dayCount + 1

    /** The lift logged on a local date, the last one when there are several. */
    fun liftedOn(date: String): LiftSessionEntity? =
        lifts.filter { it.stage != LiftStage.WARMUP && IsoTime.localDateKey(it.startedAtMs, it.offsetMin) == date }
            .maxWithOrNull(compareBy({ it.startedAtMs }, { it.id }))

    /** Slots of training weekdays strictly between two dates that a non-shifting skip spent. */
    private fun spentSlots(afterDate: String, beforeDate: String): Int {
        var spent = 0
        var d = IsoTime.addDays(afterDate, 1)
        while (d < beforeDate) {
            if (isTrainingWeekday(d)) {
                val reason = rules.offReasonOn(d)
                if (reason != null && !rules.shiftsPlan(reason)) spent += 1
            }
            d = IsoTime.addDays(d, 1)
        }
        return spent
    }

    /**
     * The program day a lift on [date] would be, from what was logged before that date: the day after the
     * last logged lift, moved on by the slots skipped since. Day 1 before anything is logged.
     */
    fun pointerAt(date: String): Int {
        val last = sequencing.lastOrNull { it.date < date && it.day != null } ?: return 1
        return advance(after(last.day!!), spentSlots(last.date, date))
    }

    /** The seven days of the week that contains [today], Monday first. */
    fun week(today: String, runPlan: RunPlan, runs: List<RunSessionEntity>): WeekPlan {
        val weekStart = IsoTime.weekStart(today)
        return build(weekStart, today, pointerAt(weekStart), runPlan, runs).week
    }

    /**
     * The week that starts on [weekStart] (a Monday), as it stands on [today], for any week: this one is exactly
     * [week]; an earlier one is what the records say (a logged day is logged, a day with nothing logged was missed and
     * its lift comes round again); a later one is projected forward from this week, every day carried out as planned,
     * so its first lift is the program day after the last one this week plans. Skips apply as everywhere else: a
     * shifting one leaves the pointer where it is, a non-shifting one spends its slot.
     */
    fun weekOn(weekStart: String, today: String, runPlan: RunPlan, runs: List<RunSessionEntity>): WeekPlan {
        val target = IsoTime.weekStart(weekStart)
        val thisWeek = IsoTime.weekStart(today)
        if (target <= thisWeek) return build(target, today, pointerAt(target), runPlan, runs).week
        var built = build(thisWeek, today, pointerAt(thisWeek), runPlan, runs)
        var start = thisWeek
        while (start < target) {
            start = IsoTime.addDays(start, 7)
            built = build(start, today, built.pointerAfter, runPlan, runs)
        }
        return built.week
    }

    /** A built week and the program day the next training day after it would take. */
    private class Built(val week: WeekPlan, val pointerAfter: Int)

    private fun build(weekStart: String, today: String, startPointer: Int, runPlan: RunPlan, runs: List<RunSessionEntity>): Built {
        var pointer = startPointer
        val days = (0..6).map { i ->
            val date = IsoTime.addDays(weekStart, i.toLong())
            val lifted = liftedOn(date)
            val reason = rules.offReasonOn(date)
            val ranOn = runs.any { IsoTime.localDateKey(it.startedAtMs, it.offsetMin) == date }
            val runDay = runPlan.on(i)
            when {
                lifted != null -> {
                    val day = lifted.programDayIndex ?: pointer
                    pointer = after(day)
                    DayPlan(date, i, DayKind.LIFT, day, null, null, logged = true)
                }
                isTrainingWeekday(date) && reason == null -> {
                    val day = pointer
                    // A past training day with nothing logged was missed: the lift repeats. Today and later advance.
                    if (date >= today) pointer = after(day)
                    DayPlan(date, i, DayKind.LIFT, day, null, null, logged = false)
                }
                isTrainingWeekday(date) -> {
                    // Skipped: a shifting reason moves the lift out, a non-shifting one spends the slot.
                    if (!rules.shiftsPlan(reason!!)) pointer = after(pointer)
                    DayPlan(date, i, DayKind.REST, null, null, reason, logged = false)
                }
                runDay != null && reason == null -> DayPlan(date, i, DayKind.RUN, null, runDay, null, logged = ranOn)
                else -> DayPlan(date, i, DayKind.REST, null, null, reason, logged = false)
            }
        }
        return Built(WeekPlan(weekStart, days), pointer)
    }

    /**
     * The next planned run from [today] on: today counts until a run is logged for it. Null when the plan has
     * no run days or every one of the next 14 days is skipped.
     */
    fun nextRun(today: String, runPlan: RunPlan, runs: List<RunSessionEntity>): NextRun? {
        for (offset in 0L..13L) {
            val date = IsoTime.addDays(today, offset)
            val plan = runPlan.on(IsoTime.weekdayIndex(date)) ?: continue
            if (rules.offReasonOn(date) != null) continue
            val ranOn = runs.any { IsoTime.localDateKey(it.startedAtMs, it.offsetMin) == date }
            if (ranOn) continue
            return NextRun(date, plan)
        }
        return null
    }
}

/** The next run on the plan and the local day it falls on. */
data class NextRun(val date: String, val plan: RunPlanDay)
