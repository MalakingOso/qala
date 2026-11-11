package com.qala.data.seed

import com.qala.data.IsoTime
import com.qala.data.QalaJson
import com.qala.data.core.QalaCore
import com.qala.data.core.finishDay
import com.qala.data.core.sessionMuscles
import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.model.RunPlan
import com.qala.data.model.RunPlanDay
import com.qala.data.model.RunZone
import com.qala.data.model.SettingsRecord
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.model.wire
import com.qala.data.program.DayExercise
import com.qala.data.program.EvaluatedProgram
import com.qala.data.program.ProgramEngine
import com.qala.data.sync.DaySkipIds
import com.qala.data.sync.LiftSessionBundle
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Generates the debug seed (docs/archive/completed.md, M2 as built): about three weeks of Mon/Wed/Fri/Sat
 * GZCLP lift days with two easy runs a week, a daily check-in, a weigh-in every two to three days and one
 * skipped day, ending the day before [generate]'s `today`.
 *
 * The program and the sessions are made together through the LS++ library, the same calls the app will make
 * after a real session: evaluate the program text, take the entries the day prescribes, complete their sets at
 * target (with a few deliberate misses, AMRAP sets over target and one RPE-9 top set), log the session, run the
 * finish-day script to advance the text, evaluate the new text, and repeat. A hand-written pair of text and
 * sessions that disagreed would put a top set on the hero that the week card contradicts; this cannot.
 *
 * Everything is a function of `today` and the zone: ids come from names, never from a random source.
 * Rust and JSON work, so call it off the main thread.
 */
class SeedGenerator(private val programs: ProgramEngine = ProgramEngine()) {
    fun generate(today: LocalDate, zone: ZoneId, weeks: Int = 3): SeedData {
        val settings = SettingsRecord()
        val unit = settings.unit
        val weekdays = settings.trainingWeekdays.toSet()
        val exerciseData = SeedOneRepMax.ExerciseData
        val start = today.minusDays(7L * weeks)
        val end = today.minusDays(1)

        var text = GzclpProgram.TEXT
        var program = programs.evaluate(text, GzclpProgram.NAME, unit, exerciseData)
        var chain: EvaluatedProgram = program
        var day = 1

        val sessions = ArrayList<SeededSession>()
        val runs = ArrayList<RunSessionEntity>()
        val checkIns = ArrayList<CheckInEntity>()
        val skips = ArrayList<DaySkipEntity>()
        var trainingDays = 0
        var previousLiftMuscles: List<String> = emptyList()

        var date = start
        while (!date.isAfter(end)) {
            val key = date.toString()
            val weekday = date.dayOfWeek.value - 1
            var checkInAt: Long
            var recovery: Double
            var soreness: Map<String, Int> = emptyMap()
            var note: String? = null
            var liftMuscles: List<String> = emptyList()
            val dayIndex = (date.toEpochDay() - start.toEpochDay()).toInt()

            if (weekday in weekdays) {
                trainingDays += 1
                if (trainingDays == SKIP_TRAINING_DAY) {
                    // A sick day: the plan shifts out, so the same program day is lifted on the next training day.
                    skips += DaySkipEntity(DaySkipIds.of(key), key, SkipReason.Sick.wire(), null, "Stomach bug", deleted = false)
                    checkInAt = at(date, LocalTime.of(8, 0), zone)
                    recovery = 3.0
                    note = "Sick, staying in"
                } else {
                    val k = sessions.size
                    val used = programs.usedExercises(program, day)
                    val lifted = lift(date, zone, k, day, used, program)
                    val fd = QalaCore.finishDay(program.program, day, lifted.entries, program.settings)
                    check(fd.errors.isEmpty()) { "finish day for $key failed: ${fd.errors}" }
                    check(fd.nextDay == day % program.dayCount + 1) { "finish day moved $day to ${fd.nextDay}" }
                    sessions += SeededSession(lifted.bundle, day, fd.nextDay, lifted.missed, lifted.rpe9)
                    text = fd.plannerText
                    chain = EvaluatedProgram(fd.evaluatedProgram, program.settings, program.dayCount)
                    program = programs.evaluate(text, GzclpProgram.NAME, unit, exerciseData)
                    day = fd.nextDay

                    liftMuscles = QalaCore.sessionMuscles(used.map { it.exerciseId })
                    soreness = liftMuscles.mapIndexed { i, m -> m to SORENESS[(k + i) % SORENESS.size] }.toMap()
                    checkInAt = lifted.bundle.session.startedAtMs - 45 * 60_000L
                    recovery = RECOVERY[k % RECOVERY.size]
                }
            } else {
                checkInAt = at(date, LocalTime.of(8, 0), zone)
                recovery = RECOVERY[(dayIndex + 3) % RECOVERY.size]
                // The day after a lift: the muscles it worked are sore.
                soreness = previousLiftMuscles.associateWith { 2 }
                if (weekday in RUN_WEEKDAYS) {
                    val r = runs.size
                    runs += easyRun(date, zone, r)
                    checkInAt = at(date, LocalTime.of(7, 0), zone)
                }
            }

            checkIns += CheckInEntity(
                id = seedId("checkin", key),
                atMs = checkInAt,
                offsetMin = IsoTime.offsetMinAt(zone, checkInAt),
                recovery = recovery,
                sorenessJson = QalaJson.encodeToString(MapSerializer(String.serializer(), Int.serializer()), soreness),
                note = note,
                deleted = false,
            )
            previousLiftMuscles = liftMuscles
            date = date.plusDays(1)
        }

        return SeedData(
            today = today.toString(),
            zone = zone,
            programId = seedId("program", "gzclp"),
            programName = GzclpProgram.NAME,
            programText = text,
            exerciseData = exerciseData,
            sessions = sessions,
            runs = runs,
            checkIns = checkIns,
            weights = weighIns(start, end),
            skips = skips,
            // The plan rates its easy runs as steady: until the run pipeline gives the engine best efforts for a
            // critical speed, it rates every logged run steady (z = 1.0), so planned and done load only line up
            // on that scale. When critical speed exists this becomes RunZone.Easy.
            runPlan = RunPlan(RUN_WEEKDAYS.sorted().map { RunPlanDay(it, EASY_RUN_M[0], RunZone.Steady, "Easy run") }),
            settings = settings,
            chainProgram = chain,
        )
    }

    // ---- one lift day ----

    private class Completed(val record: LiftEntryRecord, val json: JsonObject, val missed: Int, val rpe9: Int)

    /** One lift day: the session row with its logged sets, and the completed entries for the finish-day script. */
    private class LiftDay(val bundle: LiftSessionBundle, val entries: List<JsonObject>, val missed: Int, val rpe9: Int)

    private fun lift(
        date: LocalDate,
        zone: ZoneId,
        k: Int,
        day: Int,
        used: List<DayExercise>,
        program: EvaluatedProgram,
    ): LiftDay {
        val completed = used.map { ex -> complete(programs.entryFor(program, day, ex), ex, k) }
        val startedAt = at(date, LocalTime.of(17, 30).plusMinutes(5L * (k % 3)), zone)
        val row = LiftSessionEntity(
            id = seedId("lift", date.toString()),
            startedAtMs = startedAt,
            offsetMin = IsoTime.offsetMinAt(zone, startedAt),
            programDayIndex = day,
            stub = false,
            stage = null,
            minutes = 62.0 + 4 * (k % 4),
            srpe = 6.5 + 0.5 * (k % 3),
            notes = null,
            deleted = false,
        )
        return LiftDay(
            bundle = LiftSessionBundle(row, completed.map { it.record }),
            entries = completed.map { it.json },
            missed = completed.sumOf { it.missed },
            rpe9 = completed.sumOf { it.rpe9 },
        )
    }

    /**
     * Completes an entry's working sets at target, with the exceptions that make the engine data uneven:
     * the last T1 set of session [MISS_T1_SESSION] and the last T2 set of [MISS_T2_SESSION] fall short, T1 and
     * T3 AMRAP sets run over (T3 sometimes past the 25 that raises its weight), and the T1 top set of
     * [RPE9_SESSION] is logged at RPE 9. Returns the entry for the finish-day script and the logged record.
     */
    private fun complete(entry: JsonObject, ex: DayExercise, k: Int): Completed {
        val tier = ex.key.substringBefore('-')
        val sets = entry.getValue("sets").jsonArray.map { it.jsonObject }
        var missed = 0
        var rpe9 = 0
        val logged = ArrayList<LiftSetRecord>()
        val warmups = entry["warmupSets"]?.jsonArray.orEmpty().map { it.jsonObject }
        for (w in warmups) {
            logged += LiftSetRecord(weight(w).first, weight(w).second, reps(w), completed = true, warmup = true)
        }
        val done = sets.mapIndexed { i, set ->
            val last = i == sets.lastIndex
            val target = reps(set)
            val amrap = set["isAmrap"]?.jsonPrimitive?.booleanOrNull == true
            val got = when {
                tier == "t1" && last && k == MISS_T1_SESSION -> target - 1
                tier == "t2" && last && k == MISS_T2_SESSION -> target - 2
                tier == "t1" && amrap -> target + (k % 3) + if (k == RPE9_SESSION) 1 else 0
                tier == "t3" && amrap -> 18.0 + 4 * (k % 3)
                else -> target
            }
            val rpe = when {
                got < target -> 10.0
                tier == "t1" && amrap && k == RPE9_SESSION -> 9.0
                tier == "t1" && amrap -> 8.5
                tier == "t1" -> 8.0
                tier == "t2" -> 7.5
                else -> 7.0
            }
            if (got < target) missed += 1
            if (rpe == 9.0) rpe9 += 1
            val (w, u) = weight(set)
            logged += LiftSetRecord(w, u, got, rpe = rpe, completed = true)
            JsonObject(
                set + mapOf(
                    "isCompleted" to JsonPrimitive(true),
                    "completedReps" to JsonPrimitive(got.toLong()),
                    "completedWeight" to set.getValue("weight"),
                ),
            )
        }
        return Completed(
            record = LiftEntryRecord(ex.exerciseId, logged),
            json = JsonObject(entry + ("sets" to JsonArray(done))),
            missed = missed,
            rpe9 = rpe9,
        )
    }

    private fun reps(set: JsonObject): Double = set.getValue("reps").jsonPrimitive.doubleOrNull ?: error("set without reps: $set")

    private fun weight(set: JsonObject): Pair<Double, WeightUnit> {
        val w = set.getValue("weight").jsonObject
        val value = w.getValue("value").jsonPrimitive.doubleOrNull ?: error("weight without a value: $set")
        return value to if (w.getValue("unit").jsonPrimitive.content == "kg") WeightUnit.Kg else WeightUnit.Lb
    }

    // ---- runs, weights, ids ----

    private fun easyRun(date: LocalDate, zone: ZoneId, r: Int): RunSessionEntity {
        val startedAt = at(date, LocalTime.of(7, 30), zone)
        val distance = EASY_RUN_M[r % EASY_RUN_M.size]
        val moving = distance / 1000.0 * 375.0
        return RunSessionEntity(
            id = seedId("run", date.toString()),
            startedAtMs = startedAt,
            offsetMin = IsoTime.offsetMinAt(zone, startedAt),
            distanceM = distance,
            movingSec = moving,
            elapsedSec = moving + 45.0,
            stub = false,
            srpe = 4.0,
            minutes = Math.round(moving / 60.0).toDouble(),
            hrTrimp = null,
            gradeProfileJson = null,
            descentM = null,
            notes = null,
            deleted = false,
        )
    }

    /** A weigh-in on the last day of the window, then every 2 and 3 days back: always 3 in any 7. */
    private fun weighIns(start: LocalDate, end: LocalDate): List<BodyWeightEntity> {
        val out = ArrayList<BodyWeightEntity>()
        var d = end
        var gap = 2
        while (!d.isBefore(start)) {
            val i = (d.toEpochDay() - start.toEpochDay()).toInt()
            val kg = Math.round((82.6 - 0.12 * i + WOBBLE[i % WOBBLE.size]) * 10.0) / 10.0
            out += BodyWeightEntity(seedId("weight", d.toString()), d.toString(), kg, deleted = false)
            d = d.minusDays(gap.toLong())
            gap = if (gap == 2) 3 else 2
        }
        return out.reversed()
    }

    private fun at(date: LocalDate, time: LocalTime, zone: ZoneId): Long =
        date.atTime(time).atZone(zone).toInstant().toEpochMilli()

    /** A stable UUID from a name: the same seed always yields the same ids. */
    private fun seedId(kind: String, name: String): String =
        UUID.nameUUIDFromBytes("qala-seed:$kind:$name".toByteArray()).toString()

    companion object {
        /** The training day (counted from the start of the window) that is skipped. */
        const val SKIP_TRAINING_DAY = 6

        /** Session numbers (0-based among the logged lifts) with a deliberate miss and the RPE-9 top set. */
        const val MISS_T1_SESSION = 2
        const val MISS_T2_SESSION = 6
        const val RPE9_SESSION = 4

        /** Tuesday and Thursday. */
        val RUN_WEEKDAYS = setOf(1, 3)

        /** 4 and 5 miles in meters. */
        val EASY_RUN_M = listOf(6437.0, 8047.0, 6437.0, 6437.0, 8047.0, 6437.0)

        private val SORENESS = listOf(1, 2, 1, 3, 2, 1)
        private val RECOVERY = listOf(7.0, 6.5, 8.0, 7.5, 6.0, 8.5, 7.0)
        private val WOBBLE = listOf(0.0, 0.15, -0.1, 0.2, -0.05)
    }
}
