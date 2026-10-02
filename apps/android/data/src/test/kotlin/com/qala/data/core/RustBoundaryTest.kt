package com.qala.data.core

import com.qala.data.IsoTime
import com.qala.data.model.Availability
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.BodyWeightRecord
import com.qala.data.model.CheckInRecord
import com.qala.data.model.DayClass
import com.qala.data.model.DaySkip
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSessionRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.model.RunRecord
import com.qala.data.model.RunZone
import com.qala.data.model.SkipReason
import com.qala.data.model.SettingsRecord
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.qala_ffi.QalaException

/**
 * The Kotlin DTOs through the real Rust library (the host build): a record serialized here is accepted by
 * the core, and a result decodes. This is what proves the shapes, not a Kotlin-to-Kotlin round trip.
 */
class RustBoundaryTest {
    private fun set(weight: Double, reps: Double, rpe: Double? = 8.0) =
        LiftSetRecord(weight, WeightUnit.Lb, reps, rpe = rpe, completed = true)

    private fun squatSession(id: String = "s1", at: String = "2026-10-01T17:30:00-04:00", stub: Boolean = false) =
        LiftSessionRecord(
            id = id,
            startedAt = at,
            programDayIndex = 1,
            stub = stub,
            entries = if (stub) emptyList() else listOf(LiftEntryRecord("squat", List(3) { set(225.0, 5.0) })),
        )

    @Test
    fun buildEngineStateAcceptsKotlinRecordsAndReturnsAState() {
        val request = BuildEngineStateRequest(
            records = listOf(
                squatSession(),
                RunRecord("r1", "2026-10-02T07:05:00-04:00", distanceM = 8046.7, movingSec = 2580.0, elapsedSec = 2711.5, srpe = 6.0, minutes = 45.0),
            ),
            checkins = listOf(CheckInRecord("c1", "2026-10-01T16:45:00-04:00", 7.0, mapOf("quads" to 2))),
            settings = SettingsRecord(),
        )
        val result = QalaCore.buildEngineState(request)
        assertEquals(emptyList<String>(), result.warnings)
        val view = QalaCore.stateView(result.state)
        assertTrue(view.fatigueMuscle.getValue("quads") > 0.0)
        assertTrue(view.fatigueSystemic > 0.0)
        assertTrue(view.fitness.isNotEmpty())
        assertEquals("the run is the latest event", "2026-10-02T07:05:00-04:00".take(10), view.updated.take(10))
        assertNotNull("the whole state stays available for later calls", result.state["kalman"])
    }

    @Test
    fun aStubIsDroppedBeforeTheEngineAndAddsNothing() {
        val settings = SettingsRecord()
        val empty = QalaCore.buildEngineState(BuildEngineStateRequest(emptyList(), emptyList(), settings))
        val stubOnly = QalaCore.buildEngineState(BuildEngineStateRequest(listOf(squatSession(stub = true)), emptyList(), settings))
        assertEquals(empty.state, stubOnly.state)
        val view = QalaCore.stateView(stubOnly.state)
        assertTrue(view.fatigueMuscle.isEmpty() && view.fatigueSystemic == 0.0)
    }

    @Test
    fun anUnknownExerciseIsAWarningNotAnError() {
        val s = squatSession().copy(entries = listOf(LiftEntryRecord("zzz", listOf(set(100.0, 5.0)))))
        val result = QalaCore.buildEngineState(BuildEngineStateRequest(listOf(s), emptyList(), SettingsRecord()))
        assertEquals(listOf("unknown exercise: zzz"), result.warnings)
    }

    @Test
    fun aBadDateIsAnEvaluationError() {
        val s = squatSession(at = "2026-02-30T17:30:00-04:00")
        assertThrows(QalaException.Evaluation::class.java) {
            QalaCore.buildEngineState(BuildEngineStateRequest(listOf(s), emptyList(), SettingsRecord()))
        }
    }

    @Test
    fun readinessSummaryReadsTodaysCheckIn() {
        val request = ReadinessSummaryRequest(
            records = listOf(squatSession()),
            checkins = listOf(CheckInRecord("c", "2026-10-02T08:00:00-04:00", 5.0, mapOf("quads" to 4))),
            settings = SettingsRecord(),
            now = "2026-10-02T13:00:00-04:00",
            offsetMin = -240,
            sessionMuscles = listOf("quads"),
        )
        val summary = QalaCore.readinessSummary(request)
        assertTrue(summary.checkedInToday)
        assertEquals(1, summary.checkinCount28d)
        assertEquals(listOf("quads"), summary.today.soreBlockedMuscles)
        assertNotNull(summary.average28d)
        assertTrue(summary.readyDates.all { it.date.length == 10 })

        val none = QalaCore.readinessSummary(request.copy(records = emptyList(), checkins = emptyList(), sessionMuscles = null))
        assertFalse(none.checkedInToday)
        assertNull(none.average28d)
        assertEquals(1.0, none.today.score, 1e-9)
    }

    @Test
    fun weekLoadTakesPlannedDaysOfEveryKind() {
        val planned = listOf(
            PlannedDay.Lift(listOf(PlannedExercise("squat", 5.0), PlannedExercise("benchPress", 3.0, targetRpe = 8.5))),
            PlannedDay.Run(8000.0, RunZone.Easy),
            PlannedDay.Lift(listOf(PlannedExercise("deadlift", 3.0))),
            PlannedDay.Run(5000.0, RunZone.Hard),
            PlannedDay.Rest, PlannedDay.Rest, PlannedDay.Rest,
        )
        val result = QalaCore.weekLoad(WeekLoadRequest(planned, listOf(squatSession(at = "2026-09-28T17:30:00-04:00")), SettingsRecord(), "2026-09-28"))
        assertEquals(7, result.planned.size)
        assertEquals(7, result.done.size)
        assertTrue(result.planned[0] > 0 && result.planned[1] > 0 && result.planned[4] == 0.0)
        assertTrue("a hard run adds load", result.planned[3] > 0)
        assertTrue(result.done[0] > 0 && result.done.drop(1).all { it == 0.0 })
        assertEquals(emptyList<String>(), result.warnings)
    }

    @Test
    fun weekLoadRefusesAWeekStartThatIsNotAMonday() {
        assertThrows(QalaException::class.java) {
            QalaCore.weekLoad(WeekLoadRequest(List(7) { PlannedDay.Rest }, emptyList(), SettingsRecord(), "2026-09-29"))
        }
    }

    @Test
    fun weightTrendIsNullUntilThereAreThreeDays() {
        val two = List(2) { BodyWeightRecord("w$it", IsoTime.addDays("2026-10-01", it.toLong()), 80.0) }
        assertNull(QalaCore.weightTrend(WeightTrendRequest(two, "2026-10-02")))
        val many = List(8) { BodyWeightRecord("w$it", IsoTime.addDays("2026-09-24", it.toLong()), 82.0 - it * 0.2) }
        val trend = QalaCore.weightTrend(WeightTrendRequest(many, "2026-10-01"))!!
        assertTrue(trend.latestKg > 0 && trend.avg7Kg > 0)
    }

    @Test
    fun availabilityCallsMatchTheTsRules() {
        val sick = Availability(AvailabilityStatus.Sick, since = "2026-10-01")
        assertEquals(DayClass.Shift, QalaCore.classifyDay("2026-10-03", sick, emptyList()))
        assertEquals(SkipReason.Sick, QalaCore.reasonOn("2026-10-03", sick, emptyList()))
        assertNull(QalaCore.reasonOn("2026-09-30", sick, emptyList()))
        val skips = listOf(DaySkip("2026-10-04", SkipReason.Break))
        assertEquals(DayClass.Rest, QalaCore.classifyDay("2026-10-04", Availability(), skips))
        assertEquals(DayClass.Train, QalaCore.classifyDay("2026-10-05", Availability(), skips))
        assertTrue(QalaCore.shiftsPlan(SkipReason.Vacation))
        for (r in listOf(SkipReason.Break, SkipReason.Scheduling, SkipReason.Injured)) assertFalse(r.name, QalaCore.shiftsPlan(r))
    }
}
