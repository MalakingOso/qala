package com.qala.app.today

import com.qala.data.IsoTime
import com.qala.data.core.Readiness
import com.qala.data.core.ReadinessSummary
import com.qala.data.core.ReadyDate
import com.qala.data.core.TrendDirection
import com.qala.data.core.WeekLoadResult
import com.qala.data.core.WeightTrend
import com.qala.data.engine.EngineSnapshot
import com.qala.data.engine.LatestWeight
import com.qala.data.model.RunPlanDay
import com.qala.data.model.RunZone
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.program.LiftHero
import com.qala.data.program.TopSet
import com.qala.data.today.DayKind
import com.qala.data.today.DayPlan
import com.qala.data.today.DayStage
import com.qala.data.today.NextRun
import com.qala.data.today.StageId
import com.qala.data.today.StageState
import com.qala.data.today.TodayPlan
import com.qala.data.today.WeekPlan

/*
 * Snapshots built by hand, so the Today copy is tested without Rust. The calendar: 2026-10-07 is a Wednesday, a
 * training day in the default Mon, Wed, Fri, Sat week; 10-06 and 10-08 are rest days.
 */

const val Offset = -240

fun at(date: String, hour: Int, minute: Int = 0, offsetMin: Int = Offset): Long =
    IsoTime.startOfDayMs(date, offsetMin) + hour * 3_600_000L + minute * 60_000L

private val SixIds = listOf(StageId.CHECK_IN, StageId.WARM_UP, StageId.LIFT, StageId.RUN, StageId.RECOVER, StageId.WIND_DOWN)
private val RestIds = listOf(StageId.CHECK_IN, StageId.RECOVER, StageId.WIND_DOWN)

/** A day's stages: the ones in [done] are done at the given hour, the first of the rest that is active is now. */
fun stages(ids: List<StageId>, date: String, done: Map<StageId, Int> = emptyMap(), skipped: Set<StageId> = emptySet()): List<DayStage> {
    var nowGiven = false
    return ids.map { id ->
        when {
            id in done -> DayStage(id, StageState.DONE, at(date, done.getValue(id)), Offset)
            id in skipped -> DayStage(id, StageState.SKIPPED)
            id.passive -> DayStage(id, StageState.LATER)
            !nowGiven -> DayStage(id, StageState.NOW).also { nowGiven = true }
            else -> DayStage(id, StageState.LATER)
        }
    }
}

fun liftPlan(
    date: String = "2026-10-07",
    done: Map<StageId, Int> = emptyMap(),
    skipped: Set<StageId> = emptySet(),
    programDay: Int? = 3,
): TodayPlan {
    val list = stages(SixIds, date, done, skipped)
    return TodayPlan(date, true, null, programDay, list, list.firstOrNull { it.state == StageState.NOW }?.id)
}

fun restPlan(date: String = "2026-10-06", done: Map<StageId, Int> = emptyMap(), reason: SkipReason? = null): TodayPlan {
    val list = stages(RestIds, date, done)
    return TodayPlan(date, false, reason, null, list, list.firstOrNull { it.state == StageState.NOW }?.id)
}

val gzclpHero = LiftHero(
    programName = "gzclp",
    dayName = "Day 3",
    exerciseId = "benchPress",
    exerciseName = "Bench Press",
    topSet = TopSet(weight = 112.5, unit = WeightUnit.Lb, reps = 3.0, amrap = true, sets = 5),
    exerciseCount = 3,
    setCount = 11,
)

fun readiness(
    score: Double = 0.72,
    average: Double? = 0.76,
    checkedIn: Boolean = true,
    count: Int = 20,
    ready: List<ReadyDate> = emptyList(),
) = ReadinessSummary(Readiness(score, prsFlag = false), checkedIn, average, count, ready)

fun weekOf(date: String, kinds: List<DayKind> = listOf(DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.LIFT, DayKind.REST)): WeekPlan {
    val start = IsoTime.weekStart(date)
    return WeekPlan(start, kinds.mapIndexed { i, kind -> DayPlan(IsoTime.addDays(start, i.toLong()), i, kind, null, null, null, false) })
}

val easyRun = RunPlanDay(dayOfWeek = 1, distanceM = 6437.0, zone = RunZone.Easy, label = "Easy run")

/** A lift day with everything the cards can show: a program, a check-in history, runs, a week, a trend. */
fun fullSnapshot(
    plan: TodayPlan = liftPlan(),
    hero: LiftHero? = gzclpHero,
    next: NextRun? = NextRun("2026-10-13", easyRun),
    readiness: ReadinessSummary? = readiness(),
    trend: WeightTrend? = WeightTrend(80.1, 80.4, 80.9, -0.5, TrendDirection.Down, 4),
    latest: LatestWeight? = LatestWeight("2026-10-07", 80.1),
    unit: WeightUnit = WeightUnit.Lb,
) = EngineSnapshot(
    loaded = true,
    date = plan.date,
    readiness = readiness,
    weekLoad = WeekLoadResult(
        planned = listOf(34.0, 12.0, 34.0, 12.0, 34.0, 34.0, 0.0),
        done = listOf(34.0, 12.0, 0.0, 0.0, 0.0, 0.0, 0.0),
    ),
    weightTrend = trend,
    today = plan,
    week = weekOf(plan.date),
    nextRun = next,
    unit = unit,
    latestWeight = latest,
    liftHero = hero,
)

/** What a release build shows before anything is written: no program, history, runs or weights. */
fun emptySnapshot(plan: TodayPlan = liftPlan(programDay = null)) = EngineSnapshot(
    loaded = true,
    date = plan.date,
    readiness = readiness(score = 1.0, average = null, checkedIn = false, count = 0),
    weekLoad = WeekLoadResult(List(7) { 0.0 }, List(7) { 0.0 }),
    weightTrend = null,
    today = plan,
    week = weekOf(plan.date),
    nextRun = null,
    latestWeight = null,
    liftHero = null,
)
