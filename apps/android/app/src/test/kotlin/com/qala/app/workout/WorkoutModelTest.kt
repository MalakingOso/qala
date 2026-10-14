package com.qala.app.workout

import com.qala.app.workout.WorkoutFixtures.entry
import com.qala.app.workout.WorkoutFixtures.sets
import com.qala.data.model.WeightUnit
import com.qala.data.program.ExerciseClass
import com.qala.data.program.PlannedSet
import com.qala.data.program.plannedSets
import com.qala.data.program.toNewLiftSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutModelTest {
    private val open = WorkoutFixtures.open()

    // ---- opening ----

    @Test
    fun aNewWorkoutStartsOnTheFirstSetOfTheFirstExerciseAtItsPrescription() {
        assertEquals(listOf("Squat", "Bench Press", "Lat Pulldown"), open.exercises.map { it.name })
        assertEquals(0, open.current)
        assertEquals(0, open.exercise.selected)
        assertEquals("gzclp", open.programName)
        assertEquals("Day 1", open.dayName)
        assertEquals(1, open.day)
        assertEquals(11, open.totalSets)
        assertEquals(0, open.loggedSets)
        val first = open.exercise.sets.first()
        assertEquals(150.0, first.weight!!, 0.0)
        assertEquals(3.0, first.reps, 0.0)
        assertFalse(first.done)
        assertTrue(open.exercise.sets.last().amrap)
        assertEquals("145 lb: 3 3, 150 lb: 4", open.exercises[0].lastTime)
        assertNull("never lifted", open.exercises[1].lastTime)
    }

    // ---- plates ----

    @Test
    fun onlyBarbellLiftsInPoundsGetPlateHints() {
        assertEquals(listOf(true, true, false), open.exercises.map { it.barbell })
        assertEquals("the cable pulldown's 80 lb is not a plate load", listOf(150.0, 100.0), open.plateWeights())
        val kg = WorkoutFixtures.open(WeightUnit.Kg)
        assertEquals(listOf(false, false, false), kg.exercises.map { it.barbell })
        assertEquals(emptyList<Double>(), kg.plateWeights())
    }

    @Test
    fun theStepperMovesTheWeightsThatWantPlates() {
        assertEquals(listOf(155.0, 150.0, 100.0), open.stepWeight(1).plateWeights())
    }

    @Test
    fun thePlatesOfTheNextSetAreAddedToTheRestThatIsStillRunning() {
        val logged = open.log(1)!!
        val resting = logged.state.startRest(logged.ref, logged.next, 1)
        val withPlates = resting.withRestPlates(logged.ref, listOf(45.0, 45.0, 10.0), "take off 5, add 25 each side")
        assertEquals(listOf(45.0, 45.0, 10.0), withPlates.rest!!.perSide)
        assertEquals("take off 5, add 25 each side", withPlates.rest?.plateInstruction)
        assertEquals("an answer that gives no total leaves the note off", null, withPlates.rest?.plateTotal)
        // An answer for an older rest is dropped: a second set has been logged since.
        assertEquals(resting, resting.withRestPlates(SetRef(1, 1), listOf(45.0), null))
        assertEquals(open, open.withRestPlates(logged.ref, listOf(45.0), null))
        assertEquals("the plates survive the JSON round trip", withPlates, WorkoutState.fromJson(withPlates.toJson()))
    }

    @Test
    fun theRestKeepsWhatTheNextSetsPlatesAddUpTo() {
        val logged = open.log(1)!!
        val resting = logged.state.startRest(logged.ref, logged.next, 1)
        val withPlates = resting.withRestPlates(logged.ref, listOf(45.0, 35.0), null, total = 205.0)
        assertEquals(205.0, withPlates.rest?.plateTotal)
        assertEquals("the total survives the JSON round trip", withPlates, WorkoutState.fromJson(withPlates.toJson()))
        val older = withPlates.toJson().replace(Regex(",\"plateTotal\":[0-9.]*"), "")
        assertTrue(!older.contains("plateTotal"))
        assertEquals("a draft saved before the total existed still loads", null, WorkoutState.fromJson(older)!!.rest?.plateTotal)
    }

    @Test
    fun anOlderDraftWithoutEquipmentOrPlatesStillLoads() {
        val old = open.toJson().replace(Regex(",\"equipment\":\"[a-z]*\""), "")
        assertTrue(!old.contains("equipment"))
        val back = WorkoutState.fromJson(old)!!
        assertEquals(listOf(false, false, false), back.exercises.map { it.barbell })
    }

    // ---- the logger ----

    @Test
    fun theWeightMovesByTheSmallestPlatePairAndNeverBelowZero() {
        assertEquals(155.0, open.stepWeight(1).exercise.sets[0].weight!!, 0.0)
        assertEquals(145.0, open.stepWeight(-1).exercise.sets[0].weight!!, 0.0)
        val kg = WorkoutFixtures.open(WeightUnit.Kg)
        assertEquals(152.5, kg.stepWeight(1).exercise.sets[0].weight!!, 0.0)
        var low = open
        repeat(40) { low = low.stepWeight(-1) }
        assertEquals(0.0, low.exercise.sets[0].weight!!, 0.0)
    }

    @Test
    fun aSetWithNoWeightHasNothingToStep() {
        val bodyweight = open.copy(exercises = open.exercises.map { it.copy(sets = it.sets.map { s -> s.copy(weight = null) }) })
        assertNull(bodyweight.stepWeight(1).exercise.sets[0].weight)
    }

    @Test
    fun theRepsMoveByOneAndStayAtOrAboveOne() {
        assertEquals(4.0, open.stepReps(1).exercise.sets[0].reps, 0.0)
        var low = open
        repeat(10) { low = low.stepReps(-1) }
        assertEquals(1.0, low.exercise.sets[0].reps, 0.0)
        assertEquals("the target is kept", 3.0, low.exercise.sets[0].targetReps, 0.0)
    }

    @Test
    fun theRpeStripPicksAndPickingItAgainClearsIt() {
        val picked = open.pickRpe(8.5)
        assertEquals(8.5, picked.exercise.sets[0].rpe!!, 0.0)
        assertEquals(9.0, picked.pickRpe(9.0).exercise.sets[0].rpe!!, 0.0)
        assertNull(picked.pickRpe(8.5).exercise.sets[0].rpe)
    }

    @Test
    fun editsLandOnTheSelectedSetOnly() {
        val s = open.pickSet(2).stepWeight(1).stepReps(1).pickRpe(8.0).toggleJointPain()
        val sets = s.exercise.sets
        assertEquals(155.0, sets[2].weight!!, 0.0)
        assertEquals(4.0, sets[2].reps, 0.0)
        assertTrue(sets[2].jointPain)
        assertEquals(150.0, sets[1].weight!!, 0.0)
        assertEquals(3.0, sets[1].reps, 0.0)
        assertNull(sets[1].rpe)
    }

    // ---- logging ----

    @Test
    fun loggingASetMarksItDoneAndMovesOnToTheNext() {
        val logged = open.stepReps(1).pickRpe(9.0).log(nowMs = 5_000)!!
        assertTrue(logged.first)
        assertEquals(SetRef(0, 0), logged.ref)
        assertEquals(SetRef(0, 1), logged.next)
        val set = logged.state.exercises[0].sets[0]
        assertTrue(set.done)
        assertEquals(4.0, set.reps, 0.0)
        assertEquals(9.0, set.rpe!!, 0.0)
        assertEquals(5_000L, set.loggedAtMs)
        assertEquals(1, logged.state.exercise.selected)
        assertEquals(1, logged.state.loggedSets)
    }

    @Test
    fun theLastSetOfAnExerciseMovesTheWorkoutToTheNextExercise() {
        var s = open
        repeat(5) { s = s.log(1)!!.state }
        assertEquals(1, s.current)
        assertEquals(0, s.exercise.selected)
        assertTrue(s.exercises[0].complete)
    }

    @Test
    fun theNextSetAfterTheLastOfAnExerciseIsTheFirstOpenOneOfTheFollowingExercise() {
        var s = open
        repeat(4) { s = s.log(1)!!.state }
        val last = s.log(1)!!
        assertEquals(SetRef(0, 4), last.ref)
        assertEquals(SetRef(1, 0), last.next)
    }

    @Test
    fun aSkippedSetIsComeBackToBeforeMovingOn() {
        // Set 3 is done first, out of order; after it the lifter returns to the sets skipped before it.
        val logged = open.pickSet(2).log(1)!!
        assertEquals(SetRef(0, 3), logged.next)
        val after = logged.state.log(2)!!.state.log(3)!!
        assertEquals("sets 0 and 1 are still open, and the last set 4 comes first", SetRef(0, 0), after.next)
    }

    @Test
    fun theLastSetOfTheWorkoutHasNoNextAndEverythingIsDone() {
        var s = open
        var last: Logged? = null
        repeat(11) { last = s.log(it.toLong()); s = last!!.state }
        assertNull(last!!.next)
        assertTrue(s.allDone)
        assertEquals(11, s.loggedSets)
    }

    @Test
    fun loggingASetAlreadyDoneSavesTheNewNumbersAndStaysPut() {
        val first = open.log(1)!!.state
        val edited = first.pickSet(0).stepWeight(1).log(9)!!
        assertFalse("not a first logging, so no rest", edited.first)
        assertNull(edited.next)
        assertEquals(0, edited.state.exercise.selected)
        assertEquals(155.0, edited.state.exercise.sets[0].weight!!, 0.0)
        assertEquals("the time of the first logging stands", 1L, edited.state.exercise.sets[0].loggedAtMs)
        assertEquals(1, edited.state.loggedSets)
    }

    @Test
    fun loggingWhereThereIsNoSetDoesNothing() {
        val empty = open.copy(exercises = open.exercises.map { it.copy(sets = emptyList()) })
        assertNull(empty.log(1))
    }

    // ---- prev and next ----

    @Test
    fun prevAndNextMoveBetweenExercisesAndNameTheirNeighbours() {
        assertNull(open.prevName)
        assertEquals("Bench Press", open.nextName)
        val mid = open.next()
        assertEquals(1, mid.current)
        assertEquals("Squat", mid.prevName)
        assertEquals("Lat Pulldown", mid.nextName)
        val end = mid.next()
        assertNull(end.nextName)
        assertEquals("the end stays the end", 2, end.next().current)
        assertEquals("the start stays the start", 0, open.prev().current)
        assertEquals(0, end.prev().prev().current)
    }

    @Test
    fun showJumpsToAnExerciseAndASetAndKeepsThemInRange() {
        val s = open.show(1, set = 2)
        assertEquals(1, s.current)
        assertEquals(2, s.exercise.selected)
        assertEquals(2, open.show(9).current)
        assertEquals(2, open.show(1, set = 99).exercise.selected)
        assertEquals("an exercise remembers the set it was on", 2, s.show(0).show(1).exercise.selected)
    }

    // ---- the update script's rewrite ----

    private fun planned(w: List<Double>, reps: Double = 3.0) = w.map { PlannedSet(it, WeightUnit.Lb, reps, null, false, null, null) }

    @Test
    fun theSetsStillToDoFollowTheScriptAndTheSetsDoneStay() {
        val done = open.log(1)!!.state
        val rewritten = done.withUpdatedEntry(0, entry(planned(listOf(150.0, 150.0, 150.0, 150.0, 105.0))))
        val sets = rewritten.exercises[0].sets
        assertTrue(sets[0].done)
        assertEquals(105.0, sets[4].weight!!, 0.0)
        assertEquals(105.0, sets[4].targetWeight!!, 0.0)
        assertEquals(150.0, sets[3].weight!!, 0.0)
    }

    @Test
    fun aSetTheScriptLeftAloneKeepsTheNumbersTheLifterChanged() {
        val edited = open.pickSet(1).stepWeight(1).stepReps(1)
        val same = edited.withUpdatedEntry(0, entry(open.exercise.sets.map { PlannedSet(it.targetWeight, WeightUnit.Lb, it.targetReps, null, it.amrap, null, null) }))
        assertEquals(155.0, same.exercises[0].sets[1].weight!!, 0.0)
        assertEquals(4.0, same.exercises[0].sets[1].reps, 0.0)
        // A rewritten target replaces the edit.
        val rewritten = edited.withUpdatedEntry(0, entry(planned(listOf(150.0, 140.0, 150.0, 150.0, 150.0))))
        assertEquals(140.0, rewritten.exercises[0].sets[1].weight!!, 0.0)
        assertEquals(3.0, rewritten.exercises[0].sets[1].reps, 0.0)
    }

    @Test
    fun theScriptCanAddASet() {
        val grown = open.withUpdatedEntry(1, entry(planned(listOf(100.0, 100.0, 100.0, 100.0), 10.0)))
        assertEquals(4, grown.exercises[1].sets.size)
        assertEquals(12, grown.totalSets)
        assertEquals(4, plannedSets(grown.exercises[1].entry, WeightUnit.Lb).size)
    }

    @Test
    fun workAlreadyLoggedIsNeverDroppedWhenTheScriptAsksForFewerSets() {
        val s = open.pickSet(4).log(1)!!.state.pickSet(4)
        val shrunk = s.withUpdatedEntry(0, entry(planned(listOf(150.0, 150.0, 150.0))))
        assertEquals(4, shrunk.exercises[0].sets.size)
        assertTrue("the logged fifth set is kept", shrunk.exercises[0].sets.last().done)
    }

    // ---- rest ----

    @Test
    fun startingRestTakesItsLengthFromTheSetJustLogged() {
        val logged = open.log(10_000)!!
        val withRest = logged.state.startRest(logged.ref, logged.next, 10_000)
        val rest = withRest.rest!!
        assertEquals(SetRef(0, 0), rest.logged)
        assertEquals(SetRef(0, 1), rest.next)
        assertEquals("a heavy main lift, strength reps: 3:00", 180, rest.seconds)
        assertEquals(10_000L, rest.startedAtMs)
        assertEquals(170, rest.timer.remainingSec(20_000))
    }

    @Test
    fun theProgramsOwnRestAndTheRpeShapeTheRest() {
        var s = open.pickSet(0)
        // The pulldown names a 90 s rest.
        s = s.show(2)
        val logged = s.log(1)!!
        assertEquals(90, logged.state.startRest(logged.ref, logged.next, 1).rest!!.seconds)
    }

    @Test
    fun theRestScreenReadsWhatWasLoggedAndWhatComesNext() {
        val logged = open.pickRpe(9.0).log(1)!!
        val s = logged.state.startRest(logged.ref, logged.next, 1)
        val from = s.restLogged()!!
        assertEquals("Squat", from.exerciseName)
        assertEquals(1, from.setNumber)
        assertEquals(150.0, from.weight!!, 0.0)
        assertEquals(9.0, from.rpe!!, 0.0)
        val next = s.restNext()!!
        assertEquals(2, next.setNumber)
        assertEquals(5, next.setCount)
        assertEquals("3", next.reps)
        assertTrue("same exercise, same weight: leave the plates on", next.sameWeight)
        assertFalse(next.newExercise)
    }

    @Test
    fun theNextSetCanBeInAnotherExercise() {
        var s = open
        repeat(4) { s = s.log(1)!!.state }
        val logged = s.log(1)!!
        val rest = logged.state.startRest(logged.ref, logged.next, 1).restNext()!!
        assertTrue(rest.newExercise)
        assertEquals("Bench Press", rest.exerciseName)
        assertEquals(1, rest.setNumber)
        assertFalse(rest.sameWeight)
        assertEquals("10", rest.reps)
    }

    @Test
    fun addingTimeLengthensTheBudgetAndEndingRestClearsIt() {
        val logged = open.log(1)!!
        val s = logged.state.startRest(logged.ref, logged.next, 1)
        assertEquals(210, s.addRest(30).rest!!.seconds)
        assertNull(s.endRest().rest)
        assertNull(s.endRest().restNext())
        assertNull(open.addRest(30).rest)
    }

    // ---- automatic rest ----

    @Test
    fun withAutomaticRestOnTheFirstLoggingOpensRestForTheNextSet() {
        val settled = open.log(10_000)!!.settle(10_000, autoRest = true)
        assertEquals(AfterLog.Rest, settled.after)
        val rest = settled.state.rest!!
        assertEquals(SetRef(0, 0), rest.logged)
        assertEquals(SetRef(0, 1), rest.next)
        assertEquals(180, rest.seconds)
    }

    @Test
    fun withAutomaticRestOffTheSetIsLoggedTheLoggerMovesOnAndNoRestOpens() {
        val settled = open.log(10_000)!!.settle(10_000, autoRest = false)
        assertEquals(AfterLog.Next, settled.after)
        assertNull("no rest was started", settled.state.rest)
        assertTrue("the set is logged", settled.state.exercises[0].sets[0].done)
        assertEquals("and the logger is on the next set", 1, settled.state.exercise.selected)
        assertEquals("with the same state automatic rest would have started from", open.log(10_000)!!.state.exercises, settled.state.exercises)
    }

    @Test
    fun theLastSetOffersToFinishWhetherOrNotRestIsAutomatic() {
        var s = open
        repeat(10) { s = s.log(1)!!.state }
        for (auto in listOf(true, false)) {
            val settled = s.log(1)!!.settle(1, autoRest = auto)
            assertEquals(AfterLog.Finish, settled.after)
            assertNull(settled.state.rest)
        }
    }

    @Test
    fun editingASetAlreadyLoggedStaysPutWhetherOrNotRestIsAutomatic() {
        val done = open.log(1)!!.state.pickSet(0)
        for (auto in listOf(true, false)) {
            val settled = done.log(2)!!.settle(2, autoRest = auto)
            assertEquals(AfterLog.Stay, settled.after)
            assertNull(settled.state.rest)
        }
    }

    @Test
    fun withAutomaticRestOffTheHintSaysWhatComesNextAndPromisesNoRest() {
        assertEquals("Then set 2", open.restHint(autoRest = false))
        var four = open
        repeat(4) { four = four.log(1)!!.state }
        assertEquals("Then Bench Press", four.restHint(autoRest = false))
        var last = open
        repeat(10) { last = last.log(1)!!.state }
        assertEquals("The last set, then you're done", last.restHint(autoRest = false))
        assertEquals("a set already done has nothing to preview", null, open.log(1)!!.state.pickSet(0).restHint(autoRest = false))
        assertEquals("on is still the default", "Rest about 3:00, then set 2", open.restHint())
    }

    // ---- the words around the logger ----

    @Test
    fun theRestHintNamesWhatTheSelectedSetWillEarnAndWhatFollows() {
        assertEquals("Rest about 3:00, then set 2", open.restHint())
        // An RPE well over the target would lengthen it; with none in the program the hint stays at the base.
        assertEquals("Rest about 3:00, then set 2", open.pickRpe(9.0).restHint())
        // The last set of an exercise rests for the first of the next one, by name.
        var four = open
        repeat(4) { four = four.log(1)!!.state }
        assertEquals("a late set of a heavy lift rests longer", "Rest about 3:30, then Bench Press", four.restHint())
        val skipped = open.pickSet(2).log(1)!!.state.log(2)!!.state      // sets 3 and 4 done first; set 5 is selected
        assertEquals("a skipped set is not forgotten", "Rest about 3:30, then set 1", skipped.restHint())
        assertEquals("a set already done has no rest to preview", null, open.log(1)!!.state.pickSet(0).restHint())
    }

    @Test
    fun theLastSetOfTheWorkoutHasNoRestAndSaysSo() {
        var s = open
        repeat(10) { s = s.log(1)!!.state }
        assertEquals("The last set, then you're done", s.restHint())
    }

    @Test
    fun theLogButtonSaysLogSaveOrFinish() {
        assertEquals("Log set 1", open.logLabel())
        assertEquals("Log set 3", open.pickSet(2).logLabel())
        assertEquals("Save set 1", open.log(1)!!.state.pickSet(0).logLabel())
        var s = open
        repeat(11) { s = s.log(1)!!.state }
        assertEquals("Finish workout", s.logLabel())
    }

    // ---- finishing ----

    @Test
    fun theFinishedWorkoutCarriesWhatWasDoneAlignedWithTheSets() {
        var s = open.pickRpe(8.0).log(1)!!.state
        s = s.stepReps(1).log(2)!!.state                        // set 2 done at 4 reps
        s = s.pickSet(3).toggleJointPain().log(3)!!.state       // set 4 done, hurt
        val lifted = s.toLifted(finishedAtMs = 3_000_000)
        assertEquals("session-1", lifted.sessionId)
        assertEquals("program-1", lifted.programId)
        assertEquals(1, lifted.day)
        assertEquals(1_000_000L, lifted.startedAtMs)
        assertEquals(3_000_000L, lifted.finishedAtMs)
        val squat = lifted.exercises[0]
        assertEquals("squat", squat.exerciseId)
        assertEquals("t1-squat_barbell", squat.key)
        assertEquals(5, squat.sets.size)
        assertEquals(squat.sets.map { it != null }, listOf(true, true, false, true, false))
        assertEquals(8.0, squat.sets[0]!!.rpe!!, 0.0)
        assertEquals(4.0, squat.sets[1]!!.reps, 0.0)
        assertTrue(squat.sets[3]!!.jointPain)
        assertTrue("nothing done on the bench", lifted.exercises[1].sets.all { it == null })
        assertEquals(squat.planned.map { it.reps }, listOf(3.0, 3.0, 3.0, 3.0, 3.0))
    }

    @Test
    fun theFinishedWorkoutBuildsTheSessionTheRepositoryStores() {
        var s = open.log(1)!!.state
        s = s.stepReps(1).pickRpe(9.0).log(2)!!.state
        val new = s.toLifted(finishedAtMs = 1_000_000 + 41 * 60_000L).toNewLiftSession(WeightUnit.Lb)
        assertEquals("session-1", new.id)
        assertEquals(1, new.programDayIndex)
        assertEquals(1_000_000L, new.startedAtMs)
        assertEquals(41.0, new.minutes!!, 0.0)
        assertEquals(listOf("squat"), new.entries.map { it.exerciseId })
        val sets = new.entries.single().sets
        assertEquals(listOf(3.0, 4.0), sets.map { it.reps })
        assertEquals(listOf(150.0, 150.0), sets.map { it.weight })
        assertEquals(listOf(null, 9.0), sets.map { it.rpe })
        assertTrue(sets.all { it.completed && !it.warmup })
    }

    @Test
    fun theCompletedEntryMarksTheDoneSetsForTheScripts() {
        val s = open.log(1)!!.state
        val entry = s.exercises[0].completedEntry()
        val sets = (entry["sets"] as kotlinx.serialization.json.JsonArray).map { it as kotlinx.serialization.json.JsonObject }
        assertNotNull(sets[0]["completedReps"])
        assertNull(sets[1]["completedReps"])
    }

    // ---- the draft ----

    @Test
    fun theWholeWorkoutSurvivesAJsonRoundTrip() {
        var s = open.pickRpe(8.5).log(7)!!.let { it.state.startRest(it.ref, it.next, 7) }
        s = s.show(1, 1)
        val back = WorkoutState.fromJson(s.toJson())
        assertEquals(s, back)
        assertEquals(ExerciseClass.Main, back!!.exercises[0].cls)
        assertEquals(WeightUnit.Lb, back.exercises[0].unit)
    }

    @Test
    fun aDamagedOrEmptyDraftReadsAsNoDraft() {
        assertNull(WorkoutState.fromJson(""))
        assertNull(WorkoutState.fromJson("{not json"))
        assertNull(WorkoutState.fromJson("{}"))
        assertNull(WorkoutState.fromJson(open.copy(exercises = emptyList()).toJson()))
    }
}
