package com.qala.data.today

import com.qala.data.IsoTime
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftStage
import com.qala.data.model.RunPlan
import com.qala.data.model.SkipReason

/** The stages of a day, in the order the rail shows them. */
enum class StageId {
    CHECK_IN,
    WARM_UP,
    LIFT,
    RUN,

    /** Passive interlude: no doneness, "now" skips it, a static-copy hero. */
    RECOVER,

    /** Passive interlude, like [RECOVER]. */
    WIND_DOWN,
    ;

    val passive: Boolean get() = this == RECOVER || this == WIND_DOWN
}

/** The state of one stage dot. [SKIPPED] renders as a hollow ring (M3). */
enum class StageState { DONE, NOW, LATER, SKIPPED }

/**
 * One stage of today. For a [StageState.DONE] stage, [doneAtMs] and [doneOffsetMin] are the time of the
 * record that completed it (check-in time, session or run start); later stages carry none.
 */
data class DayStage(
    val id: StageId,
    val state: StageState,
    val doneAtMs: Long? = null,
    val doneOffsetMin: Int? = null,
) {
    val passive: Boolean get() = id.passive
}

/** Today as the rail and the stage hero read it. */
data class TodayPlan(
    /** Local `YYYY-MM-DD`. */
    val date: String,
    /** True on a lift day: six stages. A rest day has three. */
    val liftDay: Boolean,
    /** Why a training weekday is a rest day today (a skip or status), null otherwise. An injury is not one. */
    val skipReason: SkipReason?,
    /** The 1-based LS++ program day to lift today, null on a rest day. */
    val programDay: Int?,
    val stages: List<DayStage>,
    /** The first stage that is not done or skipped and not passive; null when the day's work is done. */
    val now: StageId?,
    /** A training weekday with nothing to lift because there is no program: three stages, and the hero says so. */
    val noProgram: Boolean = false,
)

/** Everything the deriver reads. The caller computes [today] from its clock and zone. */
class TodayInput(
    /** Local `YYYY-MM-DD`. */
    val today: String,
    /** 0 is Monday. */
    val trainingWeekdays: Set<Int>,
    /** Days in the program's rotation; 0 when there is no program. */
    val dayCount: Int,
    val records: DayRecords,
    val rules: DayRules,
    val runPlan: RunPlan = RunPlan(),
)

/**
 * Today's kind, day and stages, mirroring `StageState` in `apps/web/src/store/types.ts` plus the passive
 * interludes (docs/archive/completed.md, M2 as built). Pure: no clock, no storage.
 *
 * - A lift day is a training weekday that is not skipped and has a program to lift (or any day with a lift
 *   already logged, since a logged day stays logged). It has six stages: check-in, warm-up, lift, run, recover,
 *   wind down. Every other day is a rest day with three: check-in, recover, wind down. An injury does not
 *   skip the day, it trains around the muscle ([offReasonOn]). With no program a training weekday has no
 *   warm-up or lift to do, so it takes the rest-day shape too (a "now" parked on a stage nothing can complete
 *   would be a dead end) and [TodayPlan.noProgram] tells the hero why.
 * - A stage is done when a record of its kind exists today. Check-in: a check-in. Warm-up: a warm-up stub,
 *   or a real session (which includes it). Lift: a real session or a lift stub. Run: a run, stub or real.
 * - A check-in, warm-up or lift that is not done while a later one of the three is done was skipped. The run
 *   stands apart: it is done when a run is logged, whenever in the day, and implies nothing about the rest.
 * - The now stage is the first active stage that is neither done nor skipped, and it skips the passive
 *   ones, so it is null once the day's work is done.
 *
 * A stub record is as good as a real one for all of this.
 */
object StageDeriver {
    fun derive(input: TodayInput): TodayPlan {
        val schedule = Schedule(input.trainingWeekdays, input.dayCount, input.records.liftSessions, input.rules)
        val date = input.today
        val reason = input.rules.offReasonOn(date)
        val liftedToday = lifts(input, date)
        val trains = schedule.isTrainingWeekday(date) && reason == null
        val liftDay = liftedToday.isNotEmpty() || (trains && input.dayCount > 0)
        val skipReason = if (!liftDay && schedule.isTrainingWeekday(date)) reason else null
        val noProgram = !liftDay && trains

        val ids = if (liftDay) {
            listOf(StageId.CHECK_IN, StageId.WARM_UP, StageId.LIFT, StageId.RUN, StageId.RECOVER, StageId.WIND_DOWN)
        } else {
            listOf(StageId.CHECK_IN, StageId.RECOVER, StageId.WIND_DOWN)
        }

        val done: Map<StageId, Pair<Long, Int>> = buildMap {
            input.records.checkIns.filter { local(it.atMs, it.offsetMin) == date }
                .maxByOrNull { it.atMs }?.let { put(StageId.CHECK_IN, it.atMs to it.offsetMin) }
            if (liftDay) {
                liftedToday.filter { it.stage == LiftStage.WARMUP || it.stage == null }
                    .minByOrNull { it.startedAtMs }?.let { put(StageId.WARM_UP, it.startedAtMs to it.offsetMin) }
                liftedToday.filter { it.stage != LiftStage.WARMUP }
                    .maxByOrNull { it.startedAtMs }?.let { put(StageId.LIFT, it.startedAtMs to it.offsetMin) }
                input.records.runs.filter { local(it.startedAtMs, it.offsetMin) == date }
                    .maxByOrNull { it.startedAtMs }?.let { put(StageId.RUN, it.startedAtMs to it.offsetMin) }
            }
        }

        val active = ids.filterNot { it.passive }
        // The run is not part of the chain: it is as often done before the lift as after it, so a run on record
        // says nothing about the stages before it.
        val chain = active.filterNot { it == StageId.RUN }
        val lastDone = chain.indexOfLast { it in done }
        var nowAssigned: StageId? = null
        val stages = ids.map { id ->
            val record = done[id]
            val state = when {
                id.passive -> StageState.LATER
                record != null -> StageState.DONE
                chain.indexOf(id) in 0 until lastDone -> StageState.SKIPPED
                nowAssigned == null -> StageState.NOW.also { nowAssigned = id }
                else -> StageState.LATER
            }
            DayStage(id, state, record?.first, record?.second)
        }

        val programDay = if (liftDay) {
            // A lift logged today names its own day; otherwise the rotation says which one is next.
            schedule.liftedOn(date)?.programDayIndex ?: schedule.pointerAt(date).takeIf { input.dayCount > 0 }
        } else {
            null
        }
        return TodayPlan(date, liftDay, skipReason, programDay, stages, nowAssigned, noProgram)
    }

    private fun lifts(input: TodayInput, date: String): List<LiftSessionEntity> =
        input.records.liftSessions.filter { local(it.startedAtMs, it.offsetMin) == date }

    private fun local(ms: Long, offsetMin: Int) = IsoTime.localDateKey(ms, offsetMin)
}
