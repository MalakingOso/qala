package com.qala.app.checkin

import androidx.compose.runtime.saveable.SaverScope
import com.qala.app.today.emptySnapshot
import com.qala.app.today.fullSnapshot
import com.qala.app.today.liftPlan
import com.qala.app.today.restPlan
import com.qala.data.model.SkipReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CheckInModelTest {
    // ---- which muscles ----

    @Test
    fun aLiftDayAsksAboutTheProgramDaysMuscles() {
        assertEquals(listOf("quads", "glutes", "chest"), checkInMuscles(true, listOf("quads", "glutes", "chest"), emptyList()))
    }

    @Test
    fun aRestDayAndASkippedDayAskAboutTheFourFixedMuscles() {
        assertEquals(FixedMuscles, checkInMuscles(false, emptyList(), emptyList()))
        assertEquals("a rest day ignores the program's muscles", FixedMuscles, checkInMuscles(false, listOf("chest"), emptyList()))
        assertEquals(4, FixedMuscles.size)
    }

    @Test
    fun aLiftDayThatNamesNoMusclesFallsBackToTheFixedFour() {
        assertEquals(FixedMuscles, checkInMuscles(true, emptyList(), emptyList()))
    }

    @Test
    fun anInjuredMuscleLeadsEvenWhenTheProgramDoesNotTrainIt() {
        assertEquals(listOf("calves", "quads", "glutes"), checkInMuscles(true, listOf("quads", "glutes"), listOf("calves")))
        assertEquals("and is not listed twice", listOf("quads", "glutes"), checkInMuscles(true, listOf("quads", "glutes"), listOf("quads")))
        assertEquals(listOf("calves") + FixedMuscles, checkInMuscles(false, emptyList(), listOf("calves")))
    }

    @Test
    fun everyFixedMuscleHasALabelNotARawId() {
        assertEquals(listOf("Quads", "Hamstrings", "Upper back", "Front delts"), FixedMuscles.map { muscleLabel(it) })
    }

    // ---- the plan from a snapshot ----

    @Test
    fun theWholePlanFromALiftDaySnapshot() {
        val snapshot = fullSnapshot().copy(
            sessionMuscles = listOf("quads", "glutes"),
            injured = listOf("quads"),
            lastTrained = mapOf("quads" to "2026-10-05", "glutes" to "2026-10-06"),
        )
        val plan = checkInPlan(snapshot, liftPlan("2026-10-07"))
        assertTrue(plan.liftDay)
        assertFalse("a lift day has no rest-day tip", plan.showTip)
        assertEquals(listOf("quads", "glutes"), plan.muscles.map { it.id })
        assertEquals(listOf("trained Mon", "trained yesterday"), plan.muscles.map { it.lastTrained })
        assertEquals(listOf(true, false), plan.muscles.map { it.injured })
        assertEquals("the injured muscle walks in at 4", mapOf("quads" to 4), plan.initialSoreness)
    }

    @Test
    fun aSickDayIsARestShapeWithTheFixedFourAndTheTip() {
        val snapshot = emptySnapshot(restPlan("2026-10-06", reason = SkipReason.Sick))
        val plan = checkInPlan(snapshot, snapshot.today!!)
        assertFalse(plan.liftDay)
        assertTrue(plan.showTip)
        assertEquals(FixedMuscles, plan.muscles.map { it.id })
        assertEquals(emptyMap<String, Int>(), plan.initialSoreness)
        assertEquals(List(4) { "not trained lately" }, plan.muscles.map { it.lastTrained })
    }

    // ---- what a row says ----

    @Test
    fun lastTrainedReadsAsAPersonSaysIt() {
        assertEquals("trained today", lastTrainedLine("2026-10-07", "2026-10-07"))
        assertEquals("trained yesterday", lastTrainedLine("2026-10-06", "2026-10-07"))
        assertEquals("trained Mon", lastTrainedLine("2026-10-05", "2026-10-07"))
        assertEquals("trained Sep 27", lastTrainedLine("2026-09-27", "2026-10-07"))
        assertEquals("not trained lately", lastTrainedLine(null, "2026-10-07"))
    }

    @Test
    fun aRowShowsTheLastTrainedLineUntilAValueIsPickedThenItsMeaning() {
        val quads = CheckInMuscle("quads", "Quads", "trained Mon", injured = false)
        assertEquals("trained Mon", muscleHint(quads, null))
        assertEquals(listOf("never sore", "healed well before", "healed just in time", "still sore now"), (1..4).map { muscleHint(quads, it) })
        assertEquals("injured, still sore now", muscleHint(CheckInMuscle("quads", "Quads", "trained Mon", injured = true), 4))
    }

    // ---- the rest-day tip ----

    @Test
    fun theTipNamesTheSoreMusclesInjuredFirstElseTheHips() {
        assertEquals("Easy hips: 90 s foam roller each side, then a short walk.", restDayTip(emptyMap(), emptyList()))
        assertEquals("Easy hips: 90 s foam roller each side, then a short walk.", restDayTip(mapOf("quads" to 2), emptyList()))
        assertEquals("Easy quads + front delts: 90 s foam roller each side, then a short walk.", restDayTip(mapOf("quads" to 3, "frontdelts" to 4), emptyList()))
        assertEquals(
            "Easy front delts + quads: 90 s foam roller each side, then a short walk.",
            restDayTip(mapOf("quads" to 3, "frontdelts" to 4), listOf("frontdelts")),
        )
    }

    // ---- the draft and the saved record ----

    @Test
    fun aFreshDraftIsRecoverySevenWithNothingAnswered() {
        val draft = CheckInDraft()
        assertEquals(7, draft.recovery)
        assertEquals(CheckInSave(7.0, emptyMap(), null), draft.toSave())
    }

    @Test
    fun aDraftSavesOnlyWhatWasAnsweredAndTrimsTheNote() {
        val draft = CheckInDraft().withRecovery(4).withSoreness("quads", 4).withSoreness("chest", 2).withNote("  knee achy  ")
        assertEquals(CheckInSave(4.0, mapOf("quads" to 4, "chest" to 2), "knee achy"), draft.toSave())
        assertNull("a blank note is no note", draft.withNote("   ").toSave().note)
    }

    @Test
    fun valuesStayInTheirScales() {
        assertEquals(10, CheckInDraft().withRecovery(11).recovery)
        assertEquals(0, CheckInDraft().withRecovery(-1).recovery)
        assertEquals(mapOf("quads" to 4), CheckInDraft().withSoreness("quads", 9).soreness)
        assertEquals(mapOf("quads" to 1), CheckInDraft().withSoreness("quads", 0).soreness)
    }

    @Test
    fun theSaverRoundTripsADraft() {
        val draft = CheckInDraft(3, mapOf("quads" to 4, "upperback" to 1), "short on time")
        val saved = with(CheckInDraft.Saver) { SaverScope { true }.save(draft) }!!
        assertEquals(draft, CheckInDraft.Saver.restore(saved))
        assertEquals(CheckInDraft(), CheckInDraft.Saver.restore(with(CheckInDraft.Saver) { SaverScope { true }.save(CheckInDraft()) }!!))
    }
}
