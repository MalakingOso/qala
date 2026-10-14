package com.qala.app.coach

import com.qala.app.today.at
import com.qala.app.today.emptySnapshot
import com.qala.app.today.fullSnapshot
import com.qala.app.today.gzclpHero
import com.qala.app.today.restPlan
import com.qala.data.db.CheckInEntity
import com.qala.data.engine.EngineInput
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.program.TopSet
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoachModelTest {
    private fun checkIn(date: String, recovery: Double, soreness: String, hour: Int = 8, deleted: Boolean = false) =
        CheckInEntity("c-$date-$hour", at(date, hour), com.qala.app.today.Offset, recovery, soreness, null, deleted)

    private fun withCheckIns(s: EngineSnapshot, vararg entries: CheckInEntity) = s.copy(input = EngineInput(checkIns = entries.toList()))

    @Test
    fun aLiftDayCarriesTheMainLiftsTopSetAndTheChips() {
        val day = coachDay(withCheckIns(fullSnapshot(hero = gzclpHero.copy(equipment = "barbell")), checkIn("2026-10-07", 7.0, """{"quads":4,"hamstrings":2,"glutes":3}""")))
        assertEquals("Day 3", day.today)
        assertEquals("recovery 7, quads 4, glutes 3", day.checkIn)
        assertEquals(listOf("Today: Day 3", "Check-in: recovery 7, quads 4, glutes 3"), day.chips)
        assertEquals(WireLift("Bench Press top set", 112.5, "lb", sets = 5, reps = 3), day.lift)
        assertTrue(day.barbell)
        assertEquals(day.lift, day.context!!.lift)
        assertEquals(listOf("Why this weight today?", "Should I change anything?"), day.starters)
    }

    @Test
    fun theLiftOnlyTakesPlatesOnABarbellInPounds() {
        assertFalse(coachDay(fullSnapshot(hero = gzclpHero)).barbell)                                                  // equipment unknown
        assertFalse(coachDay(fullSnapshot(hero = gzclpHero.copy(equipment = "dumbbell"))).barbell)
        val kg = gzclpHero.copy(equipment = "barbell", topSet = TopSet(60.0, WeightUnit.Kg, 5.0, false, 5))
        val day = coachDay(fullSnapshot(hero = kg, unit = WeightUnit.Kg))
        assertEquals("kg", day.lift!!.unit)
        assertFalse(day.barbell)
    }

    @Test
    fun aRestDayHasNoLiftSoTheCoachCannotAdjustAnything() {
        val day = coachDay(fullSnapshot(plan = restPlan("2026-10-08"), hero = null))
        assertEquals("Rest day", day.today)
        assertNull(day.lift)
        assertNull(day.context!!.lift)
        assertEquals(listOf("How is my recovery?", "What should I do on a rest day?"), day.starters)
        assertEquals("Check-in: not yet", day.chips[1])
    }

    @Test
    fun aSkippedDayAndAWeekdayWithNoProgramReadAsTheyAre() {
        assertEquals("Rest day", coachDay(fullSnapshot(plan = restPlan("2026-10-07", reason = SkipReason.Sick), hero = null)).today)
        assertEquals("No program", coachDay(emptySnapshot()).today)
    }

    @Test
    fun aBodyweightTopSetHasNoWeightToAdjust() {
        val bodyweight = gzclpHero.copy(topSet = TopSet(null, WeightUnit.Lb, 8.0, false, 3))
        val day = coachDay(fullSnapshot(hero = bodyweight))
        assertNull(day.lift)
        assertEquals("Day 3", day.today)
    }

    @Test
    fun beforeTheEngineHasBuiltTheCoachIsAskedWithoutContext() {
        for (s in listOf(EngineSnapshot(), EngineSnapshot(loaded = true, error = "boom"))) {
            val day = coachDay(s)
            assertEquals(CoachDay.Unknown, day)
            assertTrue(day.chips.isEmpty())
            assertNull(day.context)
        }
    }

    @Test
    fun onlyTodaysLiveCheckInCounts() {
        val old = checkIn("2026-10-06", 3.0, "{}")
        val deleted = checkIn("2026-10-07", 2.0, "{}", hour = 9, deleted = true)
        val morning = checkIn("2026-10-07", 6.0, """{"quads":3}""", hour = 7)
        val evening = checkIn("2026-10-07", 8.0, "{}", hour = 18)
        assertEquals("recovery 8", coachDay(withCheckIns(fullSnapshot(), old, deleted, morning, evening)).checkIn)
        assertEquals("recovery 6, quads 3", coachDay(withCheckIns(fullSnapshot(), old, deleted, morning)).checkIn)
        assertNull(coachDay(withCheckIns(fullSnapshot(), old, deleted)).checkIn)
    }

    @Test
    fun theCheckInLineNamesTheWorstMusclesFirstAndAtMostThree() {
        val line = checkInLine(checkIn("2026-10-07", 7.5, """{"quads":3,"hamstrings":4,"glutes":3,"calves":3,"abs":1}"""))
        assertEquals("recovery 7.5, hamstrings 4, calves 3, glutes 3", line)
        assertEquals("recovery 7", checkInLine(checkIn("2026-10-07", 7.0, "this is not json")))
    }

    @Test
    fun theCardPrintsNumbersAndTheServersLimits() {
        val n = CoachNumbers(245.0, "lb", 4, 4, 8.0)
        assertEquals("245 lb", weightFigure(n))
        assertEquals("4 sets × 4 reps @ 8", setsLine(n))
        assertEquals("1 set × 1 rep", setsLine(CoachNumbers(100.0, "kg", 1, 1)))
        assertEquals("112.5 kg", weightFigure(CoachNumbers(112.5, "kg", 3, 5)))
        assertEquals(
            "Coach can move weight -10% to +2.5% and sets -2 to +1.",
            limitsLine(CoachLimits(-10.0, 2.5, -2, 1)),
        )
    }

    @Test
    fun theDecisionLinesAreHonestAboutTheWorkoutNotReadingThem() {
        assertNull(decisionLine(Decision.Pending))
        assertEquals("Engine numbers kept.", decisionLine(Decision.KeepEngine))
        assertTrue(decisionLine(Decision.UseCoach)!!.contains("workout still shows the engine's numbers"))
    }

    @Test
    fun everyReasonHasItsOwnWordsAndSaysTheRestOfTheAppIsFine() {
        val titles = Why.entries.map { unavailableCopy(it).title }
        assertEquals("Coach is offline", unavailableCopy(Why.Unreachable).title)
        assertTrue(titles.all { it.startsWith("Coach is ") })
        assertEquals(4, Why.entries.map { unavailableCopy(it).body }.toSet().size)
        for (why in Why.entries) assertTrue("$why", unavailableCopy(why).body.contains("Everything else in Qala works") || unavailableCopy(why).body.contains("work without it"))
        assertTrue(unavailableCopy(Why.NotRecognised).body.contains("didn't recognise this phone"))
    }

    @Test
    fun theStatusSaysWhereTheCoachRunsUntilItCannotAnswer() {
        assertEquals("Runs on callisto", coachStatus(null))
        for (why in Why.entries) assertEquals("Offline", coachStatus(why))
    }
}
