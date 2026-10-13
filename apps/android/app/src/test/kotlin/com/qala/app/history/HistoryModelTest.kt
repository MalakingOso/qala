package com.qala.app.history

import com.qala.data.db.LiftEntryEntity
import com.qala.data.db.LiftEntryWithSets
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftSetEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryModelTest {
    // EDT (UTC-4) throughout: offsets are part of each session row.
    private fun ms(iso: String): Long = java.time.Instant.parse(iso).toEpochMilli()

    private fun set(id: String, entryId: String, weight: Double, reps: Double, completed: Boolean = true, warmup: Boolean = false) =
        LiftSetEntity(id, entryId, 0, weight, "lb", reps, null, null, completed, warmup, tested1rm = false, jointPain = false)

    private fun lift(
        id: String,
        startedAt: String,
        programDay: Int? = 1,
        stub: Boolean = false,
        stage: String? = null,
        minutes: Double? = 58.0,
        sets: List<LiftSetEntity> = emptyList(),
    ): LiftSessionWithEntries {
        val session = LiftSessionEntity(id, ms(startedAt), -240, programDay, stub, stage, minutes, null, null, false)
        val entry = LiftEntryEntity("$id/e0", id, 0, "squat")
        return LiftSessionWithEntries(session, listOf(LiftEntryWithSets(entry, sets)))
    }

    private fun run(id: String, startedAt: String, distanceM: Double = 11265.0, movingSec: Double? = 3840.0, stub: Boolean = false) =
        RunSessionEntity(id, ms(startedAt), -240, distanceM, movingSec, movingSec ?: 0.0, stub, null, null, null, null, null, null, false)

    @Test
    fun sessionsGroupByWeekNewestFirst() {
        val lifts = listOf(
            lift("a", "2026-09-13T21:30:00Z", sets = listOf(set("a/0", "a/e0", 225.0, 5.0), set("a/1", "a/e0", 225.0, 5.0), set("a/2", "a/e0", 225.0, 5.0))),
            lift("b", "2026-09-06T21:30:00Z", sets = listOf(set("b/0", "b/e0", 100.0, 5.0))),
        )
        val runs = listOf(run("r", "2026-09-12T11:30:00Z"))
        val weeks = historyWeeks(lifts, runs, mapOf(1 to "Lower A"))
        assertEquals(2, weeks.size)
        assertEquals("Sep 7–13, 2026", weeks[0].label)
        assertEquals("Aug 31–Sep 6, 2026", weeks[1].label)
        assertEquals(listOf("Lower A", "Run"), weeks[0].rows.map { it.title })
        val liftRow = weeks[0].rows[0]
        assertEquals(HistoryKind.Lift, liftRow.kind)
        assertEquals("Sun", liftRow.day)
        assertEquals("3.4k lb · 58 min", liftRow.detail)
        val runRow = weeks[0].rows[1]
        assertEquals(HistoryKind.Run, runRow.kind)
        assertEquals("Sat", runRow.day)
        assertEquals("7.0 mi · 1:04", runRow.detail)
    }

    @Test
    fun warmupsAndUnfinishedSetsDoNotCountTowardVolume() {
        val sets = listOf(
            set("s/0", "s/e0", 135.0, 5.0, warmup = true),
            set("s/1", "s/e0", 225.0, 5.0),
            set("s/2", "s/e0", 225.0, 5.0, completed = false),
        )
        val row = historyWeeks(listOf(lift("s", "2026-09-13T21:30:00Z", sets = sets)), emptyList()).single().rows.single()
        assertEquals("1.1k lb · 58 min", row.detail)
    }

    @Test
    fun markedDoneSessionsSaySoInsteadOfReadingEmpty() {
        val stubLift = lift("w", "2026-09-13T21:30:00Z", stub = true, stage = "lift", minutes = null)
        val stubRun = run("x", "2026-09-13T12:00:00Z", stub = true)
        val rows = historyWeeks(listOf(stubLift), listOf(stubRun)).single().rows
        assertEquals("Workout", rows.first { it.kind == HistoryKind.Lift }.title)
        assertEquals("Marked done · no sets logged", rows.first { it.kind == HistoryKind.Lift }.detail)
        assertEquals("Marked done · no distance logged", rows.first { it.kind == HistoryKind.Run }.detail)
        val warm = lift("v", "2026-09-13T21:30:00Z", stub = true, stage = "warmup", minutes = null)
        val warmRow = historyWeeks(listOf(warm), emptyList()).single().rows.single()
        assertEquals("Warm-up", warmRow.title)
        assertEquals("Marked done · nothing logged", warmRow.detail)
    }

    @Test
    fun aStubNamesItsProgramDayWhenTheProgramKnowsIt() {
        val names = mapOf(1 to "Lower A")
        val stubLift = lift("w", "2026-09-13T21:30:00Z", stub = true, stage = "lift", minutes = null)
        val warm = lift("v", "2026-09-13T20:00:00Z", stub = true, stage = "warmup", minutes = null)
        val rows = historyWeeks(listOf(stubLift, warm), emptyList(), names).single().rows
        assertEquals(listOf("Lower A", "Lower A warm-up"), rows.map { it.title })
        // A day the program no longer has falls back to the stage, not to a made-up name.
        val gone = historyWeeks(listOf(stubLift), emptyList(), mapOf(2 to "Upper A")).single().rows.single()
        assertEquals("Workout", gone.title)
    }

    @Test
    fun theWeekFollowsTheSessionsOwnOffset() {
        // 02:00 UTC Monday the 14th is still Sunday evening at UTC-4, so it belongs to the week of Sep 7.
        val late = lift("l", "2026-09-14T02:00:00Z", sets = listOf(set("l/0", "l/e0", 100.0, 5.0)))
        val weeks = historyWeeks(listOf(late), emptyList())
        assertEquals("Sep 7–13, 2026", weeks.single().label)
        assertEquals("Sun", weeks.single().rows.single().day)
    }

    @Test
    fun volumeIsShownInTheReadersUnit() {
        val sets = listOf(set("k/0", "k/e0", 100.0, 10.0))
        val row = historyWeeks(listOf(lift("k", "2026-09-13T21:30:00Z", sets = sets, minutes = null)), emptyList(), unit = WeightUnit.Kg).single().rows.single()
        assertEquals("454 kg", row.detail)
    }

    @Test
    fun volumeAndDurationFormatsMatchTheWeb() {
        assertEquals("20.4k lb", volumeText(20400.0, WeightUnit.Lb))
        assertEquals("850 lb", volumeText(850.0, WeightUnit.Lb))
        assertEquals("1k lb", volumeText(999.6, WeightUnit.Lb))
        assertEquals("9.3k kg", volumeText(9300.0, WeightUnit.Kg))
        assertEquals("10.4k kg", volumeText(10400.0, WeightUnit.Kg))
        assertEquals("58 min", durationText(3480.0))
        assertEquals("1:04", durationText(3840.0))
        assertEquals("2:00", durationText(7200.0))
    }

    @Test
    fun noSessionsMeansNoWeeks() {
        assertTrue(historyWeeks(emptyList(), emptyList()).isEmpty())
    }
}
