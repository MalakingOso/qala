package com.qala.data.stats

import com.qala.data.IsoTime
import com.qala.data.core.DatedValue
import com.qala.data.core.ExerciseMuscles
import com.qala.data.core.QalaCore
import com.qala.data.core.ReadinessSummaryRequest
import com.qala.data.core.exerciseMuscles
import com.qala.data.core.readinessSummary
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.RunSessionEntity
import com.qala.data.engine.EngineInput
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.LbPerKg
import com.qala.data.model.SessionRecord
import com.qala.data.model.WeightUnit
import com.qala.data.model.toRecord
import java.time.ZoneId

/*
 * The numbers behind the stats screens (Progress, Body, Session complete), read off the engine snapshot and the stored records.
 * Pure Kotlin over Rust answers: nothing here reads a clock or storage, so the screens can build them off the main thread and
 * the JVM tests need no emulator. Weights are in the lifter's unit; the engine works in it, so e1RMs need no conversion.
 */

/** One main lift's strength line: the e1RM each session gave, oldest first. */
data class LiftTrend(val exerciseId: String, val name: String, val points: List<DatedValue>)

/** Progress: strength per main lift, this week's sets by muscle, and the last weeks of running. */
data class ProgressStats(
    val lifts: List<LiftTrend>,
    /** Muscle id and the hard sets it got this week, most first. */
    val setsByMuscle: List<Pair<String, Int>>,
    /** The Monday of each of the last weeks, oldest first, and the metres run in it. */
    val weeklyRunM: List<Pair<String, Double>>,
)

/** Body: the 7-day readiness line (0 to 100) and the weigh-ins in the lifter's unit. */
data class BodyStats(val readiness: List<DatedValue>, val weights: List<DatedValue>)

object Stats {
    const val RunWeeks = 8

    /** "benchPress" as "Bench Press". */
    fun liftName(id: String): String = id.replace(Regex("([a-z0-9])([A-Z])"), "$1 $2").replaceFirstChar { it.uppercase() }

    /** The e1RM series of each main lift the engine has seen, the last [limit] of each, in the engine's lift order. */
    fun lifts(snapshot: EngineSnapshot, limit: Int = 12): List<LiftTrend> {
        val view = snapshot.stateView ?: return emptyList()
        return view.mainLifts.mapNotNull { id ->
            view.e1rmObs[id]?.takeIf { it.isNotEmpty() }?.let { LiftTrend(id, liftName(id), it.takeLast(limit)) }
        }
    }

    /** The hard sets each muscle got from [fromDate] on: a completed work set counts once for every muscle its exercise targets. */
    fun setsByMuscle(sessions: List<LiftSessionWithEntries>, muscles: Map<String, ExerciseMuscles?>, fromDate: String): List<Pair<String, Int>> {
        val counts = HashMap<String, Int>()
        for (s in sessions) {
            if (s.session.stub || s.session.deleted || IsoTime.localDateKey(s.session.startedAtMs, s.session.offsetMin) < fromDate) continue
            for (e in s.entries) {
                val sets = e.sets.count { it.completed && !it.warmup }
                if (sets == 0) continue
                for (m in muscles[e.entry.exerciseId]?.targets.orEmpty()) counts.merge(m, sets, Int::plus)
            }
        }
        return counts.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key }).map { it.key to it.value }
    }

    /** The metres run in each of the [weeks] weeks up to the one holding [today], oldest first, by local day. */
    fun weeklyRunM(runs: List<RunSessionEntity>, today: String, weeks: Int = RunWeeks): List<Pair<String, Double>> {
        val thisMonday = IsoTime.weekStart(today)
        val starts = (weeks - 1 downTo 0).map { IsoTime.addDays(thisMonday, -7L * it) }
        val metres = HashMap<String, Double>()
        for (r in runs) {
            if (r.stub || r.deleted) continue
            metres.merge(IsoTime.weekStart(IsoTime.localDateKey(r.startedAtMs, r.offsetMin)), r.distanceM, Double::plus)
        }
        return starts.map { it to (metres[it] ?: 0.0) }
    }

    /** The weigh-ins, the last [limit], oldest first, in [unit]. */
    fun weights(input: EngineInput, unit: WeightUnit, limit: Int = 30): List<DatedValue> =
        input.weights.filter { !it.deleted }.sortedBy { it.date }.takeLast(limit)
            .map { DatedValue(it.date, if (unit == WeightUnit.Lb) it.kg * LbPerKg else it.kg) }

    /**
     * Readiness (0 to 100) at noon on each of the last [days] days up to [today], from the engine's own score as it stood then:
     * only the sessions and check-ins before that moment go in. A Rust call per day, so off the main thread.
     */
    fun readiness(input: EngineInput, today: String, zone: ZoneId, nowMs: Long, days: Int = 7): List<DatedValue> {
        return (days - 1 downTo 0).mapNotNull { back ->
            val day = IsoTime.addDays(today, -back.toLong())
            val at = if (back == 0) nowMs else java.time.LocalDate.parse(day).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
            val offset = IsoTime.offsetMinAt(zone, at)
            val records: List<SessionRecord> =
                input.liftSessions.filter { it.session.startedAtMs <= at }.map { it.toRecord() } + input.runs.filter { it.startedAtMs <= at }.map { it.toRecord() }
            val checkins = input.checkIns.filter { !it.deleted && it.atMs <= at }.map { it.toRecord() }
            runCatching {
                val summary = QalaCore.readinessSummary(ReadinessSummaryRequest(records, checkins, input.settings, IsoTime.format(at, offset), offset, null))
                DatedValue(day, summary.today.score * 100.0)
            }.getOrNull()
        }
    }

    /** Everything Progress shows. Rust calls inside: off the main thread. */
    fun progress(snapshot: EngineSnapshot, nowMs: Long, zone: ZoneId): ProgressStats {
        val input = snapshot.input ?: return ProgressStats(emptyList(), emptyList(), emptyList())
        val today = IsoTime.localDateKey(nowMs, IsoTime.offsetMinAt(zone, nowMs))
        val ids = input.liftSessions.flatMap { s -> s.entries.map { it.entry.exerciseId } }.distinct()
        return ProgressStats(
            lifts = lifts(snapshot),
            setsByMuscle = setsByMuscle(input.liftSessions, QalaCore.exerciseMuscles(ids), IsoTime.weekStart(today)),
            weeklyRunM = weeklyRunM(input.runs, today),
        )
    }

    /** Everything Body shows. Rust calls inside: off the main thread. */
    fun body(snapshot: EngineSnapshot, nowMs: Long, zone: ZoneId): BodyStats {
        val input = snapshot.input ?: return BodyStats(emptyList(), emptyList())
        val today = IsoTime.localDateKey(nowMs, IsoTime.offsetMinAt(zone, nowMs))
        return BodyStats(readiness(input, today, zone, nowMs), weights(input, snapshot.unit))
    }
}
