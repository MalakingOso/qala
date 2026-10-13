package com.qala.data.program

import com.qala.data.core.QalaCore
import com.qala.data.core.runFinishDayScript
import com.qala.data.model.WeightUnit
import com.qala.data.seed.GzclpProgram
import com.qala.data.seed.SeedOneRepMax
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The lifting flow's program side against the host library and the GZCLP program the seed uses: the day's plan as typed
 * sets, the update script after a set, and the finish-day scripts moving the program on.
 */
class LiftPlanTest {
    private val engine = ProgramEngine()
    private val gzclp = engine.evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)

    private fun plan(day: Int, program: EvaluatedProgram = gzclp) = engine.liftPlan(program, day, "gzclp.md", WeightUnit.Lb)!!

    /** Every set of the exercise done as prescribed, with the AMRAP set going one rep over. */
    private fun doneAsPrescribed(ex: LiftExercise): List<LoggedSet?> =
        ex.sets.map { LoggedSet(it.weight, if (it.amrap) it.reps + 1 else it.reps) }

    @Test
    fun aDayIsItsExercisesWithTheirPrescribedSets() {
        val day = plan(1)
        assertEquals("Day 1", day.dayName)
        assertEquals("gzclp", day.programName)
        assertEquals(listOf("Squat", "Bench Press", "Lat Pulldown"), day.exercises.map { it.name })
        assertEquals(listOf("squat", "benchPress", "latPulldown"), day.exercises.map { it.exerciseId })
        assertEquals(listOf(5, 3, 3), day.exercises.map { it.sets.size })
        assertEquals("t1-squat_barbell", day.exercises.first().key)

        val t1 = day.exercises.first().sets
        assertEquals(PlannedSet(150.0, WeightUnit.Lb, 3.0, null, amrap = false, rpe = null, timerSec = null), t1.first())
        assertTrue("the last T1 set is the AMRAP one", t1.last().amrap)
        assertEquals(listOf(false, false, false, false, true), t1.map { it.amrap })
        assertEquals("T3 names its rest", 90, day.exercises.last().sets.first().timerSec)
    }

    @Test
    fun theOneRepMaxIsFiledUnderTheExerciseAndItsEquipment() {
        val squat = plan(1).exercises.first()
        assertEquals("squat_barbell", squat.oneRepMaxKey)
        assertEquals(200.0, oneRepMax(SeedOneRepMax.ExerciseData, squat, WeightUnit.Lb)!!, 0.0)
        assertEquals(90.7, oneRepMax(SeedOneRepMax.ExerciseData, squat, WeightUnit.Kg)!!, 0.1)
        assertNull("a lift with no 1RM set", oneRepMax(SeedOneRepMax.ExerciseData, plan(1).exercises.last(), WeightUnit.Lb))
    }

    @Test
    fun completingAnEntryMarksOnlyTheLoggedSets() {
        val squat = plan(1).exercises.first()
        val logged = listOf(LoggedSet(150.0, 3.0, rpe = 8.5), null, LoggedSet(155.0, 2.0))
        val done = completeEntry(squat.entry, logged, WeightUnit.Lb)
        val sets = done.getValue("sets").jsonArray.map { it.jsonObject }
        assertEquals(5, sets.size)
        assertTrue(sets[0].getValue("isCompleted").jsonPrimitive.boolean)
        assertEquals(3L, sets[0].getValue("completedReps").jsonPrimitive.content.toLong())
        assertEquals(8.5, sets[0].getValue("completedRpe").jsonPrimitive.content.toDouble(), 0.0)
        assertEquals(150L, sets[0].getValue("completedWeight").jsonObject.getValue("value").jsonPrimitive.content.toLong())
        assertEquals("lb", sets[0].getValue("completedWeight").jsonObject.getValue("unit").jsonPrimitive.content)
        assertNull("a set that was not done carries no completion", sets[1]["completedReps"])
        assertNotEquals(JsonPrimitive(true), sets[1]["isCompleted"])
        assertEquals(155L, sets[2].getValue("completedWeight").jsonObject.getValue("value").jsonPrimitive.content.toLong())
        assertEquals(2L, sets[2].getValue("completedReps").jsonPrimitive.content.toLong())
        assertNull(sets[3]["completedReps"])
    }

    @Test
    fun theUpdateScriptPassesAProgramWithoutOneThrough() {
        val squat = plan(1).exercises.first()
        val entry = completeEntry(squat.entry, listOf(LoggedSet(150.0, 3.0)))
        val after = engine.afterSet(gzclp, 1, squat.key, entry, 0)
        assertEquals(squat.sets, plannedSets(after))
    }

    @Test
    fun anUpdateScriptRewritesTheSetsStillToCome() {
        // Westside's backoff: once the first set is done, the third one is about 70% of what was lifted.
        val text = "# Week 1\n## Day 1\nSquat / 3x5 100lb / update: custom() {~\n  if (setIndex == 1) {\n    weights[3] = completedWeights[1] * 0.7\n  }\n~}\n"
        val p = engine.evaluate(text, "update.md", WeightUnit.Lb, JsonObject(emptyMap()))
        val squat = plan(1, p).exercises.single()
        assertEquals(listOf(100.0, 100.0, 100.0), squat.sets.map { it.weight })

        val entry = completeEntry(squat.entry, listOf(LoggedSet(120.0, 5.0)))
        val after = plannedSets(engine.afterSet(p, 1, squat.key, entry, 0))
        // 70% of 120 is 84; LS++ rounds a weight a script sets to the program's 2.5 lb step.
        assertEquals(listOf(100.0, 100.0, 82.5), after.map { it.weight })

        // The set after the one that was done is not the script's trigger: nothing changes.
        val second = completeEntry(squat.entry, listOf(LoggedSet(120.0, 5.0), LoggedSet(100.0, 5.0)))
        assertEquals(listOf(100.0, 100.0, 100.0), plannedSets(engine.afterSet(p, 1, squat.key, second, 1)).map { it.weight })
    }

    @Test
    fun anUpdateScriptCanAddASet() {
        val text = "# Week 1\n## Day 1\nSquat / 2x5 100lb / update: custom() {~\n  if (setIndex == 2) {\n    numberOfSets += 1\n  }\n~}\n"
        val p = engine.evaluate(text, "more.md", WeightUnit.Lb, JsonObject(emptyMap()))
        val squat = plan(1, p).exercises.single()
        val entry = completeEntry(squat.entry, listOf(LoggedSet(100.0, 5.0), LoggedSet(100.0, 5.0)))
        assertEquals(3, plannedSets(engine.afterSet(p, 1, squat.key, entry, 1)).size)
    }

    @Test
    fun finishingADayAdvancesTheProgramAndTheNextDayComesUp() {
        val day = plan(1)
        val entries = day.exercises.map { completeEntry(it.entry, doneAsPrescribed(it)) }
        val fd = engine.finishDay(gzclp, 1, entries)
        assertEquals(emptyList<String>(), fd.errors)
        assertEquals(2, fd.nextDay)
        assertNotEquals(GzclpProgram.TEXT, fd.plannerText)

        // The squat's T1 went up 10 lb; the next lap through day 1 starts from the new weights.
        val next = engine.evaluate(fd.plannerText, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)
        assertEquals(160.0, plan(1, next).exercises.first().sets.first().weight!!, 0.0)
    }

    @Test
    fun anExerciseNothingWasDoneOnIsNotCountedAsAMiss() {
        val day = plan(1)
        val squat = day.exercises.first()
        val fd = engine.finishDay(gzclp, 1, listOf(completeEntry(squat.entry, doneAsPrescribed(squat))))
        val next = engine.evaluate(fd.plannerText, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)
        val after = plan(1, next)
        assertEquals("the squat progressed", 160.0, after.exercises[0].sets.first().weight!!, 0.0)
        assertEquals("the bench was skipped, so it stays", day.exercises[1].sets.map { it.weight }, after.exercises[1].sets.map { it.weight })
        assertEquals(day.exercises[1].sets.map { it.reps }, after.exercises[1].sets.map { it.reps })
    }

    @Test
    fun aMissedSetMovesTheProgressionToTheNextStage() {
        val squat = plan(1).exercises.first()
        val missed = squat.sets.mapIndexed { i, s -> LoggedSet(s.weight, if (i == squat.sets.lastIndex) 1.0 else s.reps) }
        val fd = engine.finishDay(gzclp, 1, listOf(completeEntry(squat.entry, missed)))
        assertEquals(emptyList<String>(), fd.errors)
        val next = engine.evaluate(fd.plannerText, GzclpProgram.NAME, WeightUnit.Lb, SeedOneRepMax.ExerciseData)
        val sets = plan(1, next).exercises.first().sets
        assertEquals("the same weight, the next scheme (5x2 after 5x3)", 150.0, sets.first().weight!!, 0.0)
        assertEquals(6, sets.size)
        assertEquals(2.0, sets.first().reps, 0.0)
    }

    @Test
    fun theFinishDayScriptOfOneExerciseCanBeReadWithoutMovingTheProgram() {
        val squat = plan(1).exercises.first()
        val result = QalaCore.runFinishDayScript(gzclp.program, 1, squat.key, completeEntry(squat.entry, doneAsPrescribed(squat)), gzclp.settings)
        assertTrue(result.getValue("success").jsonPrimitive.boolean)
        assertNotNull(result.getValue("data").jsonObject["updates"])
        assertFalse("the program text is untouched", gzclp.program.toString().contains("160"))
    }

    @Test
    fun aSessionSavesOnlyTheExercisesAndSetsThatWereDone() {
        val day = plan(1)
        val squat = day.exercises[0]
        val bench = day.exercises[1]
        val lifted = LiftedSession(
            sessionId = "s-1",
            programId = "p-1",
            day = 1,
            startedAtMs = 1_000_000,
            finishedAtMs = 1_000_000 + 47 * 60_000L + 20_000,
            exercises = listOf(
                LiftedExercise(squat.exerciseId, squat.key, squat.entry, squat.sets, listOf(LoggedSet(150.0, 3.0, rpe = 8.0), LoggedSet(150.0, 3.0), null, null, null)),
                LiftedExercise(bench.exerciseId, bench.key, bench.entry, bench.sets, bench.sets.map { null }),
            ),
        )
        val new = lifted.toNewLiftSession(WeightUnit.Lb)
        assertEquals("s-1", new.id)
        assertEquals(1, new.programDayIndex)
        assertEquals(1_000_000L, new.startedAtMs)
        assertEquals(47.0, new.minutes!!, 0.0)
        assertEquals("the bench had nothing done", listOf("squat"), new.entries.map { it.exerciseId })
        val sets = new.entries.single().sets
        assertEquals(2, sets.size)
        assertTrue(sets.all { it.completed && !it.warmup })
        assertEquals(150.0, sets[0].weight, 0.0)
        assertEquals(8.0, sets[0].rpe!!, 0.0)
        assertEquals(WeightUnit.Lb, sets[0].unit)
        assertNull(sets[1].rpe)
    }
}
