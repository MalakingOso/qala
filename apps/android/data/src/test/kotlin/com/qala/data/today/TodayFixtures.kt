package com.qala.data.today

import com.qala.data.IsoTime
import com.qala.data.db.CheckInEntity
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftStage
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.SkipReason

/*
 * Shared builders for the schedule and stage tests. The calendar: 2026-10-05 is a Monday, so the default
 * training days Mon, Wed, Fri, Sat are 10-05, 10-07, 10-09, 10-10, and Tue/Thu/Sun are rest days.
 */

const val OFFSET = -240

/** An instant at [hour] o'clock local time on a local date. */
fun at(date: String, hour: Int = 17, offsetMin: Int = OFFSET): Long =
    IsoTime.startOfDayMs(date, offsetMin) + hour * 3_600_000L

fun lift(
    date: String,
    day: Int? = 1,
    stage: String? = null,
    stub: Boolean = stage != null,
    hour: Int = 17,
    id: String = "s-$date-${stage ?: "real"}",
    offsetMin: Int = OFFSET,
) = LiftSessionEntity(id, at(date, hour, offsetMin), offsetMin, day, stub, stage, null, null, null, false)

fun warmup(date: String, day: Int? = 1, hour: Int = 16) = lift(date, day, LiftStage.WARMUP, hour = hour)

fun liftStub(date: String, day: Int? = 1, hour: Int = 17) = lift(date, day, LiftStage.LIFT, hour = hour)

fun run(date: String, hour: Int = 7, stub: Boolean = false) =
    RunSessionEntity("r-$date", at(date, hour), OFFSET, 0.0, null, 0.0, stub, null, null, null, null, null, null, false)

fun checkIn(date: String, hour: Int = 8) =
    CheckInEntity("c-$date", at(date, hour), OFFSET, 7.0, "{}", null, false)

/** Skips by date, with the rule that vacation and sick shift the plan. */
class FakeRules(private val skips: Map<String, SkipReason> = emptyMap()) : DayRules {
    override fun reasonOn(date: String): SkipReason? = skips[date]
    override fun shiftsPlan(reason: SkipReason) = reason == SkipReason.Vacation || reason == SkipReason.Sick
}

val DefaultWeekdays = setOf(0, 2, 4, 5)
