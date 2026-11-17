package com.qala.data.program

import com.qala.data.model.WeightUnit
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.SettingsRepository
import com.qala.data.repo.WorkoutDraftStore
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The starting-weights step: what the form shows for a lift, and what Start writes back as 1RMs. */
object StartingWeights {
    /**
     * What the form shows for [lift]: the 1RM [exerciseData] holds, times the share of 1RM the lifted set sits at, to the
     * nearest half unit. Null when the lifter has no 1RM for it.
     */
    fun prefill(lift: StartingLift, exerciseData: JsonObject, unit: WeightUnit): Double? {
        val rm1 = (exerciseData[lift.key] as? JsonObject)?.get("rm1") as? JsonObject ?: return null
        val weight = weightIn(rm1, unit) ?: return null
        return Math.round(weight * lift.share * 2) / 2.0
    }

    /**
     * [exerciseData] with the 1RMs of the lifts in [entered] that the lifter changed, or had none for. A row left at its
     * prefilled value is not rewritten, so the rounding in [prefill] cannot nudge a 1RM. Null when nothing needs writing.
     * The other fields of a lift's entry stay as they are.
     */
    fun merge(plan: BuiltinPlan, exerciseData: JsonObject, entered: Map<String, Double>, unit: WeightUnit): JsonObject? {
        var merged = exerciseData
        var changed = false
        for (lift in plan.startingLifts) {
            val weight = entered[lift.key] ?: continue
            if (weight == prefill(lift, exerciseData, unit)) continue
            val rm1 = buildJsonObject {
                // Rounded up: LS++ rounds a prescribed weight down, so a 1RM that falls short by a hair costs a plate.
                put("value", Math.ceil(weight / lift.share * 100) / 100.0)
                put("unit", unit.name.lowercase())
            }
            val entry = (merged[lift.key] as? JsonObject) ?: JsonObject(emptyMap())
            merged = JsonObject(merged + (lift.key to JsonObject(entry + ("rm1" to rm1))))
            changed = true
        }
        return merged.takeIf { changed }
    }
}

sealed interface StartResult {
    /** [weekdays] is the training days the plan set because the lifter's count did not match, or null when theirs were kept. */
    data class Started(val weekdays: List<Int>?) : StartResult

    data class Refused(val reason: String) : StartResult
}

/**
 * Picks a plan. The program row is written from the plan's text, so choosing a plan always restarts it at week 1; then the
 * 1RMs the lifter entered or changed, then the training days when their count differs from the plan's, and last the
 * active program with its start time, so no snapshot is ever built with the new program on the old days or weights.
 * Refused while a workout is in progress, because its draft belongs to the old program.
 */
class PlanStarter(
    private val programs: ProgramRepository,
    private val settings: SettingsRepository,
    private val drafts: WorkoutDraftStore,
    private val env: RepoEnv = RepoEnv(),
) {
    /** [entered] holds one weight for every starting lift of [plan], in the lifter's unit. */
    suspend fun start(plan: BuiltinPlan, entered: Map<String, Double>): StartResult {
        require(plan.startingLifts.all { (entered[it.key] ?: 0.0) > 0.0 }) { "every starting lift needs a weight" }
        if (drafts.load() != null) return StartResult.Refused("Finish or discard the workout in progress first.")

        val record = settings.settings.first()
        programs.save(plan.id, plan.programName, plan.text)
        StartingWeights.merge(plan, settings.exerciseData.first(), entered, record.unit)?.let { settings.setExerciseData(it) }
        val weekdays = plan.defaultWeekdays.takeIf { record.trainingWeekdays.size != plan.daysPerWeek }
        weekdays?.let { settings.setTrainingWeekdays(it) }
        settings.setActiveProgram(plan.id, env.clock.nowMs())
        return StartResult.Started(weekdays)
    }
}
