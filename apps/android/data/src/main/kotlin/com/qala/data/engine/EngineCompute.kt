package com.qala.data.engine

import com.qala.data.IsoTime
import com.qala.data.core.BuildEngineStateRequest
import com.qala.data.core.EngineStateView
import com.qala.data.core.PlannedDay
import com.qala.data.core.QalaCore
import com.qala.data.core.ReadinessSummary
import com.qala.data.core.ReadinessSummaryRequest
import com.qala.data.core.WeekLoadRequest
import com.qala.data.core.WeekLoadResult
import com.qala.data.core.WeightTrend
import com.qala.data.core.WeightTrendRequest
import com.qala.data.core.buildEngineState
import com.qala.data.core.readinessSummary
import com.qala.data.core.stateView
import com.qala.data.core.weekLoad
import com.qala.data.core.weightTrend
import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.ProgramEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.Availability
import com.qala.data.model.RunPlan
import com.qala.data.model.SessionRecord
import com.qala.data.model.SettingsRecord
import com.qala.data.model.toModel
import com.qala.data.model.toRecord
import com.qala.data.model.WeightUnit
import com.qala.data.program.EvaluatedProgram
import com.qala.data.program.LiftHero
import com.qala.data.program.ProgramEngine
import com.qala.data.today.DayKind
import com.qala.data.today.DayRecords
import com.qala.data.today.NextRun
import com.qala.data.today.RustDayRules
import com.qala.data.today.Schedule
import com.qala.data.today.StageDeriver
import com.qala.data.today.TodayInput
import com.qala.data.today.TodayPlan
import com.qala.data.today.WeekPlan
import java.time.ZoneId
import kotlinx.serialization.json.JsonObject

/** Everything the engine snapshot is computed from: live rows and the settings that shape them. */
data class EngineInput(
    val liftSessions: List<LiftSessionWithEntries> = emptyList(),
    val runs: List<RunSessionEntity> = emptyList(),
    val checkIns: List<CheckInEntity> = emptyList(),
    val weights: List<BodyWeightEntity> = emptyList(),
    val skips: List<DaySkipEntity> = emptyList(),
    val availability: Availability = Availability(),
    val settings: SettingsRecord = SettingsRecord(),
    val runPlan: RunPlan = RunPlan(),
    /** LS++ `exerciseData`: the 1RMs percentage weights resolve against. */
    val exerciseData: JsonObject = JsonObject(emptyMap()),
    /** The program in use, null before one is saved. */
    val program: ProgramEntity? = null,
)

/** The newest weigh-in: its local day and the weight in kilograms. */
data class LatestWeight(val date: String, val kg: Double)

/**
 * The derived state the Today cards read. It is a cache of history (DECISIONS S8): rebuilt from the records,
 * never written back.
 */
data class EngineSnapshot(
    /** False until the first build finishes. */
    val loaded: Boolean = false,
    val builtAtMs: Long = 0,
    /** The local day this was computed for (`YYYY-MM-DD`). */
    val date: String = "",
    /** The engine state, TS-shaped and whole, for later Rust calls. */
    val state: JsonObject? = null,
    /** The fields of [state] the app reads. */
    val stateView: EngineStateView? = null,
    /** `unknown exercise: <id>` for ids the core does not know. */
    val warnings: List<String> = emptyList(),
    val readiness: ReadinessSummary? = null,
    /** Planned and done load per weekday of the current week, Monday first, in engine load units. */
    val weekLoad: WeekLoadResult? = null,
    /** Null until there are three weigh-in days in the last seven. */
    val weightTrend: WeightTrend? = null,
    val today: TodayPlan? = null,
    val week: WeekPlan? = null,
    val nextRun: NextRun? = null,
    /** The unit the user reads weights in (settings); [weightTrend] and [latestWeight] are in kilograms. */
    val unit: WeightUnit = WeightUnit.Lb,
    /** The newest weigh-in, set even while [weightTrend] is null (it needs three weigh-in days in a week). */
    val latestWeight: LatestWeight? = null,
    /** Today's day heading, main lift and top set; null on a rest day, with no program, or without a usable day. */
    val liftHero: LiftHero? = null,
    /** Set when the build failed; the other fields are then empty. */
    val error: String? = null,
)

/**
 * The snapshot as a pure function of [EngineInput], the time and the zone: build the engine state, then the
 * readiness summary, planned and done week load and weight trend from it, and today's stages. Rust and JSON
 * work, so call it off the main thread. Nothing here reads a clock or touches storage.
 */
class EngineCompute(private val programs: ProgramEngine = ProgramEngine()) {
    fun compute(input: EngineInput, nowMs: Long, zone: ZoneId): EngineSnapshot {
        val offset = IsoTime.offsetMinAt(zone, nowMs)
        val today = IsoTime.localDateKey(nowMs, offset)

        val records: List<SessionRecord> = input.liftSessions.map { it.toRecord() } + input.runs.map { it.toRecord() }
        val checkins = input.checkIns.map { it.toRecord() }
        val built = QalaCore.buildEngineState(BuildEngineStateRequest(records, checkins, input.settings))

        val evaluated: EvaluatedProgram? = input.program?.let {
            programs.evaluate(it.text, it.name, input.settings.unit, input.exerciseData)
        }
        val rules = RustDayRules(input.availability, input.skips.map { it.toModel() })
        val dayCount = evaluated?.dayCount ?: 0
        val weekdays = input.settings.trainingWeekdays.toSet()
        val dayRecords = DayRecords(input.liftSessions.map { it.session }, input.runs, input.checkIns)

        val plan = StageDeriver.derive(TodayInput(today, weekdays, dayCount, dayRecords, rules, input.runPlan))
        val schedule = Schedule(weekdays, dayCount, dayRecords.liftSessions, rules)
        val week = schedule.week(today, input.runPlan, input.runs)

        val todaysExercises = if (evaluated != null && plan.programDay != null) programs.usedExercises(evaluated, plan.programDay) else emptyList()
        val sessionMuscles = ExerciseMuscles.targetsOf(todaysExercises.map { it.exerciseId }).ifEmpty { null }
        val readiness = QalaCore.readinessSummary(
            ReadinessSummaryRequest(records, checkins, input.settings, IsoTime.format(nowMs, offset), offset, sessionMuscles),
        )

        val planned = week.days.map { day ->
            when (day.kind) {
                DayKind.LIFT -> {
                    val exercises = if (evaluated != null && day.programDay != null) programs.planned(evaluated, day.programDay) else emptyList()
                    if (exercises.isEmpty()) PlannedDay.Rest else PlannedDay.Lift(exercises)
                }
                DayKind.RUN -> PlannedDay.Run(day.run!!.distanceM, day.run.zone)
                DayKind.REST -> PlannedDay.Rest
            }
        }
        val load = QalaCore.weekLoad(WeekLoadRequest(planned, records, input.settings, week.weekStart))
        val trend = QalaCore.weightTrend(WeightTrendRequest(input.weights.map { it.toRecord() }, today))

        return EngineSnapshot(
            loaded = true,
            builtAtMs = nowMs,
            date = today,
            state = built.state,
            stateView = QalaCore.stateView(built.state),
            warnings = built.warnings,
            readiness = readiness,
            weekLoad = load,
            weightTrend = trend,
            today = plan,
            week = week,
            nextRun = schedule.nextRun(today, input.runPlan, input.runs),
            unit = input.settings.unit,
            latestWeight = input.weights.maxByOrNull { it.date }?.let { LatestWeight(it.date, it.kg) },
            liftHero = if (evaluated != null && input.program != null && plan.liftDay && plan.programDay != null) {
                programs.liftHero(evaluated, plan.programDay, input.settings.mainLifts, input.program.name)
            } else {
                null
            },
        )
    }
}
