package com.qala.app.allex

import com.qala.app.workout.WorkoutFixtures
import com.qala.app.workout.WorkoutState
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AllExercisesModelTest {
    private val open = WorkoutFixtures.open()

    @Test
    fun prescriptionLinesReadLikeTheWeb() {
        // The fixture day: squat 5 sets of 3 at 150 (the last as many as possible), bench 3 x 10 at 100, pulldown 3 x 15 at 80.
        assertEquals(listOf("5 × 3 @ 150 lb", "3 × 10 @ 100 lb", "3 × 15 @ 80 lb"), open.exercises.map { detailLine(it) })
        assertEquals("4 × 8 @ 60 kg", detailLine(WorkoutFixtures.open(WeightUnit.Kg).exercises[0].let { ex -> ex.copy(sets = List(4) { ex.sets[0].copy(targetReps = 8.0, targetWeight = 60.0) }) }))
        val bodyweight = open.exercises[0].let { ex -> ex.copy(sets = List(3) { ex.sets[0].copy(targetWeight = null, weight = null, targetReps = 12.0) }) }
        assertEquals("3 × 12", detailLine(bodyweight))
        assertEquals("no sets", detailLine(open.exercises[0].copy(sets = emptyList())))
    }

    @Test
    fun anAsManyAsPossibleFirstSetSaysSo() {
        val ex = open.exercises[0]
        assertEquals("5 × 3+ @ 150 lb", detailLine(ex.copy(sets = ex.sets.map { it.copy(amrap = true) })))
    }

    @Test
    fun aFreshDayHasNothingDoneAndTheFirstCardCurrent() {
        val cards = allExCards(open)
        assertEquals(listOf(1, 2, 3), cards.map { it.number })
        assertEquals(listOf("Squat", "Bench Press", "Lat Pulldown"), cards.map { it.name })
        assertEquals(listOf(true, false, false), cards.map { it.current })
        assertEquals(listOf(5, 3, 3), cards.map { it.sets })
        assertTrue(cards.all { it.doneCount == 0 })
        assertEquals("Day 1 · 3 exercises · 11 sets", allExSummary(open))
    }

    @Test
    fun aWorkoutInProgressShowsItsDoneSetsAndTheExerciseItIsOn() {
        val logged = open.log(1)!!.state.log(2)!!.state          // two squat sets logged, the workout moved on to set 3
        val onBench = logged.show(1)
        val cards = allExCards(onBench)
        assertEquals(listOf(2, 0, 0), cards.map { it.doneCount })
        assertEquals(listOf(true, true, false, false, false), cards[0].done)
        assertEquals("the exercise the pager is on is the current card", listOf(false, true, false), cards.map { it.current })
        assertEquals("Day 1 · 3 exercises · 2 of 11 sets", allExSummary(onBench))
    }

    @Test
    fun aSingleExerciseAndASingleSetAreSingular() {
        val one = open.copy(exercises = listOf(open.exercises[0].let { ex -> ex.copy(sets = ex.sets.take(1)) }))
        assertEquals("Day 1 · 1 exercise · 1 set", allExSummary(one))
    }

    @Test
    fun theCardDescriptionSaysHowFarAlongItIs() {
        val state: WorkoutState = open.log(1)!!.state
        assertEquals("1, Squat, 5 × 3 @ 150 lb, 1 of 5 sets done", allExDescription(allExCards(state)[0]))
        assertFalse(allExCards(state)[1].current)
    }
}
