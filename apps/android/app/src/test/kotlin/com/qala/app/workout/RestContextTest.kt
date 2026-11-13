package com.qala.app.workout

import com.qala.data.core.RestObservation
import com.qala.data.db.LiftEntryEntity
import com.qala.data.db.LiftEntryWithSets
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftSetEntity
import com.qala.data.program.ExerciseClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RestContextTest {
    private fun set(i: Int, rpe: Double? = 8.0, target: Double? = 8.0, taken: Int? = null, warmup: Boolean = false, done: Boolean = true) = LiftSetEntity(
        "e/$i", "e", i, 100.0, "lb", 5.0, rpe, target, done, warmup, false, false,
        restTakenSec = taken, restBaseSec = taken?.let { 120 }, restAdjustSec = taken?.let { 0 }, restPlannedSec = taken?.let { 120 },
    )

    private fun session(id: String, at: Long, vararg sets: LiftSetEntity, exercise: String = "squat", stub: Boolean = false) = LiftSessionWithEntries(
        LiftSessionEntity(id, at, 0, 1, stub, null, null, null, null, false),
        listOf(LiftEntryWithSets(LiftEntryEntity("$id/0", id, 0, exercise), sets.toList())),
    )

    @Test
    fun aRestIsJudgedByTheSetAfterItAndOnlyInTheSameExercise() {
        val samples = restSamples(listOf(session("s", 1, set(0, taken = 90), set(1, rpe = 8.5), set(2, rpe = 9.5, taken = 100), set(3, rpe = 9.5))))
        assertEquals(listOf("squat", "squat"), samples.map { it.first })
        // Set 1 reached its RPE (8.5 against 8, within half a point); set 3 did not (9.5 against 8).
        assertEquals(listOf(true, false), samples.map { it.second.hit })
        assertEquals(RestObservation(90.0, 120.0, 0.0, 120.0, true), samples[0].second)
        // The last set of an exercise has no set after it to judge by.
        assertTrue(restSamples(listOf(session("s", 1, set(0, taken = 90)))).isEmpty())
    }

    @Test
    fun warmupsStubsAndRestsThatWereNotRestsAreLeftOutAndTheOrderIsOldestFirst() {
        val old = session("a", 1, set(0, taken = 60), set(1))
        val new = session("b", 2, set(0, taken = 70), set(1))
        assertEquals(listOf(60.0, 70.0), restSamples(listOf(new, old)).map { it.second.taken })
        assertTrue("a warm-up set between work sets is skipped, so its rest is not a work rest", restSamples(listOf(session("w", 1, set(0, taken = 60, warmup = true), set(1)))).isEmpty())
        assertTrue(restSamples(listOf(session("stub", 1, set(0, taken = 60), set(1), stub = true))).isEmpty())
        assertTrue("twenty minutes away is not a rest", restSamples(listOf(session("long", 1, set(0, taken = 1200), set(1)))).isEmpty())
        assertTrue(restSamples(listOf(session("none", 1, set(0), set(1)))).isEmpty())
    }

    @Test
    fun theLedgerSaysWhyForTheLearnedPaceDriftAndLowReadiness() {
        val tap = RestObservation(90.0, 120.0, 0.0, 120.0, true)
        val base = RestInput(ExerciseClass.Secondary, 10.0, 10.0)
        val paced = restPlan(base.copy(context = RestContext(cls = List(10) { tap })))
        assertEquals("Your pace, 84% of the base", paced.rows[1].label)
        assertEquals(paced.seconds, paced.rows.sumOf { it.seconds })
        val tired = restPlan(base.copy(context = RestContext(soreness = 4)))
        assertEquals(listOf("Base for a second lift", "Not fully recovered today"), tired.rows.map { it.label })
        assertEquals(150, tired.seconds)
        val drift = restPlan(base.copy(loggedReps = 8.0, setNumber = 3, weight = 100.0, first = com.qala.data.core.RestFirstSet(10.0, null, 100.0)))
        assertTrue(drift.rows.any { it.label == "Reps or effort slipped since the first set" })
    }
}
