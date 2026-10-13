package com.qala.app.workout

import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass
import com.qala.data.program.LastSet
import com.qala.data.program.LiftExercise
import com.qala.data.program.LiftPlan
import com.qala.data.program.PlannedDay
import com.qala.data.program.PlannedSet
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A day built by hand, so the model tests need no Rust: the squat (5 sets, the last as many as possible), the bench and a pulldown. */
object WorkoutFixtures {
    /** An LS++ entry with these sets, in the shape `next_history_entry` gives (only the fields the app reads). */
    fun entry(sets: List<PlannedSet>): JsonObject = JsonObject(
        mapOf(
            "sets" to JsonArray(
                sets.mapIndexed { i, s ->
                    val fields = LinkedHashMap<String, kotlinx.serialization.json.JsonElement>()
                    fields["index"] = JsonPrimitive(i)
                    fields["reps"] = JsonPrimitive(s.reps.toLong())
                    if (s.weight != null) fields["weight"] = JsonObject(mapOf("value" to JsonPrimitive(s.weight), "unit" to JsonPrimitive(s.unit.name.lowercase())))
                    if (s.amrap) fields["isAmrap"] = JsonPrimitive(true)
                    if (s.rpe != null) fields["rpe"] = JsonPrimitive(s.rpe)
                    if (s.timerSec != null) fields["timer"] = JsonPrimitive(s.timerSec)
                    JsonObject(fields)
                },
            ),
        ),
    )

    fun sets(count: Int, weight: Double?, reps: Double, amrapLast: Boolean = false, unit: WeightUnit = WeightUnit.Lb, timerSec: Int? = null, rpe: Double? = null) =
        List(count) { PlannedSet(weight, unit, reps, null, amrap = amrapLast && it == count - 1, rpe = rpe, timerSec = timerSec) }

    fun exercise(key: String, id: String, name: String, index: Int, sets: List<PlannedSet>, cls: ExerciseClass = ExerciseClass.Secondary) =
        LiftExercise(key, id, name, index, "barbell", sets, entry(sets), cls)

    fun day(unit: WeightUnit = WeightUnit.Lb): PlannedDay {
        val squat = exercise("t1-squat_barbell", "squat", "Squat", 0, sets(5, 150.0, 3.0, amrapLast = true, unit = unit), ExerciseClass.Main)
        val bench = exercise("t2-bench_barbell", "benchPress", "Bench Press", 1, sets(3, 100.0, 10.0, unit = unit))
        val pulldown = exercise("t3-lat_cable", "latPulldown", "Lat Pulldown", 2, sets(3, 80.0, 15.0, amrapLast = true, unit = unit, timerSec = 90), ExerciseClass.Isolation)
        return PlannedDay(
            programId = "program-1",
            plan = LiftPlan(1, "Day 1", "gzclp", listOf(squat, bench, pulldown)),
            unit = unit,
            mainLifts = listOf("squat", "benchPress"),
            exerciseData = JsonObject(emptyMap()),
            muscles = emptyMap(),
            lastTime = mapOf("squat" to listOf(LastSet(145.0, unit, 3.0), LastSet(145.0, unit, 3.0), LastSet(150.0, unit, 4.0))),
        )
    }

    fun open(unit: WeightUnit = WeightUnit.Lb, startedAtMs: Long = 1_000_000L): WorkoutState =
        WorkoutState.open(day(unit), sessionId = "session-1", startedAtMs = startedAtMs) { id -> day(unit).lastTime[id]?.let(::lastTimeLine) }
}
