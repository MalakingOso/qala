package com.qala.app.workout

import com.qala.data.program.ExerciseClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RestPlanTest {
    private fun rest(
        cls: ExerciseClass = ExerciseClass.Main,
        targetReps: Double = 5.0,
        reps: Double = targetReps,
        rpe: Double? = null,
        targetRpe: Double? = null,
        set: Int = 1,
        amrap: Boolean = false,
        explicit: Int? = null,
    ) = restPlan(RestInput(cls, targetReps, reps, rpe, targetRpe, set, amrap, explicit))

    @Test
    fun theBaseComesFromTheClassAndTheRepRange() {
        assertEquals(180, rest(ExerciseClass.Main, 5.0).seconds)
        assertEquals(150, rest(ExerciseClass.Secondary, 5.0).seconds)
        assertEquals(90, rest(ExerciseClass.Isolation, 5.0).seconds)
        assertEquals("hypertrophy reps", 150, rest(ExerciseClass.Main, 10.0).seconds)
        assertEquals(120, rest(ExerciseClass.Secondary, 10.0).seconds)
        assertEquals(90, rest(ExerciseClass.Isolation, 12.0).seconds)
        assertEquals("six reps still counts as strength", 180, rest(ExerciseClass.Main, 6.0).seconds)
        assertEquals(150, rest(ExerciseClass.Main, 7.0).seconds)
    }

    @Test
    fun theProgramsOwnRestReplacesTheBaseButStaysInTheClassRange() {
        val plan = rest(ExerciseClass.Isolation, 15.0, explicit = 90)
        assertEquals(90, plan.seconds)
        assertEquals("The program's rest", plan.rows.first().label)
        assertEquals("a main lift is never rested under its floor", 120, rest(ExerciseClass.Main, 5.0, explicit = 30).seconds)
        assertEquals("nor over its cap", 300, rest(ExerciseClass.Main, 5.0, explicit = 600).seconds)
    }

    @Test
    fun effortAgainstTheTargetMovesTheRestFifteenSecondsPerHalfPoint() {
        assertEquals(210, rest(rpe = 9.0, targetRpe = 8.0).seconds)       // +30
        assertEquals(225, rest(rpe = 9.5, targetRpe = 8.0).seconds)       // +45
        assertEquals("capped at +45", 225, rest(rpe = 9.5, targetRpe = 7.0).seconds)
        assertEquals(165, rest(rpe = 7.5, targetRpe = 8.0).seconds)       // -15
        assertEquals("floored at -30", 150, rest(rpe = 6.0, targetRpe = 8.0).seconds)
        assertEquals("no target, no adjustment", 180, rest(rpe = 9.0).seconds)
        assertEquals("no RPE, no adjustment", 180, rest(targetRpe = 8.0).seconds)
    }

    @Test
    fun aFailureReplacesTheEffortAdjustment() {
        val plan = rest(rpe = 10.0, targetRpe = 8.0)
        assertEquals(240, plan.seconds)                                    // +60, not +45
        assertTrue(plan.rows.any { it.seconds == 60 })
        assertEquals("isolation takes +30", 120, rest(ExerciseClass.Isolation, 12.0, rpe = 10.0, targetRpe = 8.0).seconds)
        assertEquals("reps short at RPE 9.5 is a failure", 240, rest(targetReps = 5.0, reps = 4.0, rpe = 9.5, targetRpe = 8.0).seconds)
    }

    @Test
    fun repsShortOfTheTargetAddHalfAMinuteUnlessItWasAFailureOrAnAmrapSet() {
        assertEquals(210, rest(targetReps = 5.0, reps = 4.0).seconds)
        assertEquals("an as-many-as-possible set has no target to miss", 180, rest(targetReps = 5.0, reps = 3.0, amrap = true).seconds)
        assertEquals(180, rest(targetReps = 5.0, reps = 6.0).seconds)
    }

    @Test
    fun aLateSetOfAHeavyMainLiftAddsHalfAMinute() {
        assertEquals(180, rest(set = 3).seconds)
        assertEquals(210, rest(set = 4).seconds)
        assertEquals("only for a heavy main lift", 150, rest(ExerciseClass.Secondary, 5.0, set = 4).seconds)
        assertEquals("only at strength reps", 150, rest(ExerciseClass.Main, 10.0, set = 5).seconds)
    }

    @Test
    fun theRestIsRoundedAndKeptInRangeAndTheLedgerSaysSo() {
        val plan = rest(ExerciseClass.Isolation, 12.0, reps = 11.0, rpe = 9.0, targetRpe = 7.0)   // 90 + 45 + 30 = 165, over the 150 cap
        assertEquals(150, plan.seconds)
        assertEquals(-15, plan.rows.last().seconds)
        assertEquals("the ledger adds up to the rest", plan.seconds, plan.rows.sumOf { it.seconds })
        assertEquals("a plain rest adds up too", 180, rest().rows.sumOf { it.seconds })
    }

    @Test
    fun theLedgerAddsUpWhateverTheInputs() {
        for (cls in ExerciseClass.entries) for (reps in listOf(3.0, 8.0, 15.0)) for (rpe in listOf(null, 7.0, 9.0, 10.0)) for (set in 1..5) {
            val plan = rest(cls, reps, reps - 1, rpe, 8.0, set)
            assertEquals("$cls $reps $rpe $set", plan.seconds, plan.rows.sumOf { it.seconds })
            assertEquals(0, plan.seconds % 15)
        }
    }

    @Test
    fun roundingGoesToTheNearestFifteenHalvesUp() {
        assertEquals(15, round15(7.5))
        assertEquals(0, round15(7.4))
        assertEquals(195, round15(188.0))
        assertEquals(180, round15(187.0))
    }

    // ---- the clock ----

    @Test
    fun theTimerCountsDownFromTheClockAndStopsAtZero() {
        val timer = RestTimer(startedAtMs = 100_000, budgetSec = 180)
        assertEquals(180, timer.remainingSec(100_000))
        assertEquals(180, timer.remainingSec(100_999))
        assertEquals(179, timer.remainingSec(101_000))
        assertEquals(1, timer.remainingSec(279_000))
        assertEquals(0, timer.remainingSec(280_000))
        assertEquals(0, timer.remainingSec(900_000))
        assertFalse(timer.isUp(279_999))
        assertTrue(timer.isUp(280_000))
    }

    @Test
    fun aClockBeforeTheStartDoesNotRunTheTimerBackwards() {
        val timer = RestTimer(startedAtMs = 100_000, budgetSec = 60)
        assertEquals(0, timer.elapsedSec(50_000))
        assertEquals(60, timer.remainingSec(50_000))
    }

    @Test
    fun addingTimeLengthensTheBudgetAndTheBarFollows() {
        val timer = RestTimer(0, 60)
        assertEquals(0.5f, timer.fraction(30_000), 0.0001f)
        val longer = timer.plus(30)
        assertEquals(90, longer.budgetSec)
        assertEquals(60, longer.remainingSec(30_000))
        assertEquals(2f / 3f, longer.fraction(30_000), 0.0001f)
        assertFalse("time added after it was up starts it again", timer.isUp(30_000))
        assertTrue(timer.isUp(60_000))
        assertFalse(timer.plus(30).isUp(60_000))
    }

    @Test
    fun anEmptyBudgetIsAlreadyUp() {
        val timer = RestTimer(0, 0)
        assertTrue(timer.isUp(0))
        assertEquals(0f, timer.fraction(0), 0f)
    }
}
