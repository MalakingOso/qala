package com.qala.app.today

import com.qala.data.today.StageId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A fresh install (mockups/m4-empty-states.html option A, quiet cards): every card keeps its slot with one plain sentence
 * about what fills it and one action where there is one. 2026-10-07 is a Wednesday, a training day with no program.
 */
class EmptyStateTest {
    private val snapshot = emptySnapshot()
    private val model = TodayModel(snapshot, snapshot.today!!, false)

    @Test
    fun aTrainingDayWithNoProgramIsThreeDotsWithCheckInNow() {
        assertEquals(listOf("check-in", "recover", "wind-down"), model.stages.map { it.id })
        assertEquals(0, model.nowIndex)
        assertEquals("Wednesday · No program yet", model.eyebrow)
    }

    @Test
    fun theHeroAsksForACheckInAndPointsToPlan() {
        val hero = model.hero(0)
        assertEquals("Now · check-in", hero.kicker)
        assertEquals("How are you walking in?", hero.title)
        assertEquals(listOf("Two quick questions set your readiness for the day. It takes about a minute."), hero.lines)
        assertEquals("Check in", hero.cta!!.label)
        assertEquals("No program yet. Add one in Plan and Today shows your lift.", hero.note)
        assertEquals("Add a program", hero.link!!.label)
        assertEquals(Destination.Plan, hero.link!!.to)
        assertNull("nothing to skip with no program", hero.skip)
    }

    @Test
    fun thePointerStaysAfterTheCheckIn() {
        val plan = restPlan("2026-10-07", done = mapOf(StageId.CHECK_IN to 8), noProgram = true)
        val hero = TodayModel(emptySnapshot(plan), plan, false).hero(0)
        assertEquals("Checked in", hero.title)
        assertEquals("Add a program", hero.link!!.label)
    }

    @Test
    fun anOrdinaryRestDayHasNoPointer() {
        val plan = restPlan("2026-10-08")
        val hero = TodayModel(emptySnapshot(plan), plan, false).hero(0)
        assertNull(hero.note)
        assertNull(hero.link)
        assertEquals("Thursday · Rest day", TodayModel(emptySnapshot(plan), plan, false).eyebrow)
    }

    @Test
    fun eachOtherCardSaysWhatFillsItAndOffersTheNextStep() {
        assertEquals("Next run", model.nextRun.kicker)
        assertEquals("No run planned", model.nextRun.title)
        assertEquals(listOf("Runs you plan show up here with distance and effort."), model.nextRun.lines)
        assertEquals("Plan a run" to Destination.Plan, model.nextRun.action!!.let { it.label to it.to })

        assertEquals("No score yet", model.readiness.title)
        assertEquals(listOf("Your first check-in sets it. The 28-day average builds as you check in."), model.readiness.lines)
        assertNull("the score has no action of its own", model.readiness.action)

        assertEquals("No weigh-ins yet", model.weight.title)
        assertEquals(listOf("Log a weight and the 7-day trend shows up here."), model.weight.lines)
        assertEquals("Log weight" to Destination.Body, model.weight.action!!.let { it.label to it.to })
    }

    @Test
    fun theWeekShowsTheTrainingDaysAsDashedCellsAndPointsToSettings() {
        val week = model.week
        assertTrue(week.empty)
        assertEquals("Nothing planned", week.title)
        assertEquals(listOf(true, false, true, false, true, true, false), week.cells.map { it.training })
        assertEquals("Dashed days are your training days: Mon, Wed, Fri, Sat. Change them in Settings.", week.caption)
        assertEquals("Open Settings" to Destination.Settings, week.action!!.let { it.label to it.to })
    }

    @Test
    fun noTrainingDaysAtAllStillExplainsItself() {
        val none = snapshot.copy(week = weekOf("2026-10-07", List(7) { com.qala.data.today.DayKind.REST }))
        val week = weekCard(none)
        assertEquals("No training days are set. Pick them in Settings.", week.caption)
    }

    @Test
    fun everyCardHasWordsAndNoCardCountsOrScolds() {
        val texts = listOf(model.nextRun, model.readiness, model.weight).flatMap { listOf(it.kicker, it.title) + it.lines } + model.hero(0).lines
        for (t in texts) {
            assertTrue(t, t.isNotBlank())
            assertFalse(t, t.contains("!") || t.contains("—") || t.contains("miss", ignoreCase = true))
        }
    }
}
