package com.qala.app.plan

import com.qala.app.today.Cta
import com.qala.app.today.CtaIcon
import com.qala.app.today.Destination
import com.qala.app.today.at
import com.qala.data.IsoTime
import com.qala.data.model.RunPlanDay
import com.qala.data.model.RunZone
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.plan.LiftSource
import com.qala.data.plan.PlanBounds
import com.qala.data.plan.PlanDay
import com.qala.data.plan.PlanLift
import com.qala.data.plan.PlanRun
import com.qala.data.plan.PlanWeekData
import com.qala.data.program.ExerciseOverview
import com.qala.data.program.PlannedSet
import com.qala.data.today.DayKind
import com.qala.data.today.DayPlan
import com.qala.data.today.DayStatus
import com.qala.data.today.StageId
import com.qala.data.today.StatusSpan

/*
 * Weeks built by hand, so the Plan copy is tested without Rust. The calendar: 2026-10-07 is a Wednesday, today, in the
 * default Mon, Wed, Fri, Sat training week with runs on Tuesday and Thursday; Monday and Tuesday are done.
 */

const val Today = "2026-10-07"
const val WeekStart = "2026-10-05"

val easyRun = RunPlanDay(dayOfWeek = 1, distanceM = 6437.0, zone = RunZone.Easy, label = "Easy run")

/** A set as the program prescribes it, with no target RPE or rest timer. */
fun ps(weight: Double?, reps: Double, unit: WeightUnit = WeightUnit.Lb, minReps: Double? = null, amrap: Boolean = false) =
    PlannedSet(weight, unit, reps, minReps, amrap, rpe = null, timerSec = null)

fun sets(n: Int, reps: Double = 5.0, weight: Double? = 150.0, last: PlannedSet? = null): List<PlannedSet> =
    List(n) { ps(weight, reps) }.let { if (last == null) it else it.dropLast(1) + last }

fun exercise(name: String, sets: List<PlannedSet>, warmups: List<PlannedSet> = emptyList()) =
    ExerciseOverview(name.replace(" ", "").replaceFirstChar { it.lowercase() }, name, sets, warmups)

val squatDay = listOf(
    exercise("Squat", sets(5, 3.0, 150.0, last = ps(150.0, 3.0, amrap = true)), warmups = sets(3, 5.0, 45.0)),
    exercise("Bench Press", sets(3, 5.0, 110.0)),
    exercise("Lat Pulldown", sets(3, 10.0, 90.0)),
)

fun planned(programDay: Int, exercises: List<ExerciseOverview> = squatDay, main: String? = exercises.firstOrNull()?.name) =
    PlanLift(programDay, "Day $programDay", main, LiftSource.PLANNED, exercises)

fun loggedLift(programDay: Int, date: String, exercises: List<ExerciseOverview>, minutes: Double? = 62.0, stub: Boolean = false, notes: String? = null) =
    PlanLift(programDay, "Day $programDay", exercises.firstOrNull()?.name, LiftSource.LOGGED, exercises, at(date, 7, 12), -240, minutes, stub, notes)

fun planDay(
    date: String,
    kind: DayKind = DayKind.REST,
    programDay: Int? = null,
    lift: PlanLift? = null,
    run: PlanRun? = null,
    reason: SkipReason? = null,
    logged: Boolean = false,
    training: Boolean = kind == DayKind.LIFT || (reason != null && lift != null),
    status: DayStatus? = null,
    movesTo: String? = null,
    injured: List<String> = emptyList(),
) = PlanDay(
    day = DayPlan(date, IsoTime.weekdayIndex(date), kind, programDay, run?.plan.takeIf { kind == DayKind.RUN }, reason, logged),
    training = training,
    lift = lift,
    run = run,
    status = status,
    movesTo = movesTo,
    injured = injured,
)

fun date(i: Int) = IsoTime.addDays(WeekStart, i.toLong())

/** The default week: Monday lifted and Tuesday run (done), Wednesday's lift is today, the rest ahead. */
fun week(
    offset: Int = 0,
    programName: String? = "gzclp.md",
    dayCount: Int = 4,
    days: List<PlanDay> = defaultDays(),
    today: String = Today,
    unit: WeightUnit = WeightUnit.Lb,
) = PlanWeekData(
    today = today,
    offset = offset,
    weekStart = days.first().date,
    programName = programName?.removeSuffix(".md"),
    dayCount = dayCount,
    unit = unit,
    days = days,
)

fun defaultDays(): List<PlanDay> = listOf(
    planDay(date(0), DayKind.LIFT, 1, loggedLift(1, date(0), listOf(exercise("Squat", sets(3, 5.0, 140.0)))), logged = true),
    planDay(date(1), DayKind.RUN, run = PlanRun(easyRun, logged = true), logged = true),
    planDay(date(2), DayKind.LIFT, 2, planned(2)),
    planDay(date(3), DayKind.RUN, run = PlanRun(easyRun.copy(dayOfWeek = 3, distanceM = 3218.0), logged = false)),
    planDay(date(4), DayKind.LIFT, 3, planned(3)),
    planDay(date(5), DayKind.LIFT, 4, planned(4)),
    planDay(date(6)),
)

val Bounds = PlanBounds(-3, 8)

fun vacationStatus(note: String? = null, span: StatusSpan = StatusSpan.OneDay) = DayStatus(SkipReason.Vacation, span, null, note, shifts = true)

fun breakStatus() = DayStatus(SkipReason.Break, StatusSpan.OneDay, null, null, shifts = false)

/** What Today offers at each stage, as Today's hero words it. */
val liftNext = TodayNext(StageId.LIFT, Cta("Start workout", Destination.Workout, CtaIcon.Dumbbell))
val checkInNext = TodayNext(StageId.CHECK_IN, Cta("Check in", Destination.CheckIn, CtaIcon.CircleCheck))
val warmUpNext = TodayNext(StageId.WARM_UP, Cta("Start warm-up", Destination.WarmUp, CtaIcon.Flame))
val runNext = TodayNext(StageId.RUN, Cta("Start run", Destination.Run, CtaIcon.SportShoe))

fun model(
    week: PlanWeekData = week(),
    nav: PlanNav = PlanNav(day = 2),
    bounds: PlanBounds = Bounds,
    use24h: Boolean = false,
    next: TodayNext? = liftNext,
) = PlanModel(week, nav, bounds, use24h, next)
