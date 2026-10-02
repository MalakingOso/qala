package com.qala.data.seed

import com.qala.data.IsoTime
import com.qala.data.core.QalaCore
import com.qala.data.core.programDay
import com.qala.data.engine.EngineCompute
import com.qala.data.model.Availability
import com.qala.data.model.WeightUnit
import com.qala.data.program.EvaluatedProgram
import com.qala.data.program.ProgramEngine
import com.qala.data.sync.LiftSessionBundle
import com.qala.data.today.DayKind
import com.qala.data.today.StageId
import com.qala.data.today.StageState
import com.qala.data.today.RustDayRules
import com.qala.data.today.Schedule
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The seed, generated for real through the LS++ and engine libraries (the host build) for a pinned day:
 * Wednesday 2026-10-07 in New York, so the history is 2026-09-16 to 2026-10-06.
 */
class SeedTest {
    private val today = LocalDate.of(2026, 10, 7)
    private val zone = ZoneId.of("America/New_York")
    private val programs = ProgramEngine()
    private val seed: SeedData = SeedGenerator(programs).generate(today, zone)
    private val dayCount = 4

    private fun nowMs() = today.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()

    // ---- the pieces ----

    @Test
    fun theHistoryIsThreeWeeksOfLiftsRunsCheckInsWeightsAndOneSkip() {
        assertEquals("11 lifts and a skipped training day", 11, seed.sessions.size)
        assertEquals(1, seed.skips.size)
        assertEquals("2026-09-25", seed.skips.single().date)
        assertEquals("sick", seed.skips.single().reason)
        assertEquals("two easy runs a week", 6, seed.runs.size)
        assertEquals("a check-in every day of the window", 21, seed.checkIns.size)
        assertTrue("a weigh-in every 2 to 3 days", seed.weights.size in 7..11)
        val gaps = seed.weights.map { it.date }.zipWithNext { a, b -> LocalDate.parse(b).toEpochDay() - LocalDate.parse(a).toEpochDay() }
        assertTrue(gaps.toString(), gaps.all { it == 2L || it == 3L })

        val liftDates = seed.sessions.map { IsoTime.localDateKey(it.bundle.session.startedAtMs, it.bundle.session.offsetMin) }
        assertTrue(liftDates.all { LocalDate.parse(it).dayOfWeek.value - 1 in setOf(0, 2, 4, 5) })
        assertFalse("nothing is lifted on the skipped day", "2026-09-25" in liftDates)
        val runDates = seed.runs.map { IsoTime.localDateKey(it.startedAtMs, it.offsetMin) }
        assertTrue(runDates.all { LocalDate.parse(it).dayOfWeek.value - 1 in setOf(1, 3) })
        assertEquals("2026-10-05", liftDates.last())
        assertEquals("the window ends the day before today", "2026-10-06", seed.checkIns.maxOf { IsoTime.localDateKey(it.atMs, it.offsetMin) })
    }

    @Test
    fun idsAndEverythingElseAreADeterministicFunctionOfTheDay() {
        val again = SeedGenerator(ProgramEngine()).generate(today, zone)
        assertEquals(seed.programText, again.programText)
        assertEquals(seed.programId, again.programId)
        assertEquals(seed.sessions.map { it.bundle }, again.sessions.map { it.bundle })
        assertEquals(seed.runs, again.runs)
        assertEquals(seed.checkIns, again.checkIns)
        assertEquals(seed.weights, again.weights)
        assertEquals(seed.skips, again.skips)
        val ids = seed.sessions.map { it.bundle.session.id } + seed.runs.map { it.id } + seed.checkIns.map { it.id } + seed.weights.map { it.id } + seed.program.id
        assertEquals("every id is unique", ids.size, ids.toSet().size)
    }

    @Test
    fun theSessionsHaveMissesAmrapOverrunsAndOneRpe9TopSet() {
        assertEquals("two sessions with a missed set", 2, seed.sessions.count { it.missedSets > 0 })
        assertEquals("one RPE 9 top set", 1, seed.sessions.sumOf { it.rpe9Sets })
        val sets = seed.sessions.flatMap { s -> s.bundle.entries.flatMap { e -> e.sets.map { e.exerciseId to it } } }
        assertTrue(sets.any { it.second.rpe == 9.0 && !it.second.warmup })
        assertTrue("failed sets are logged at RPE 10", sets.any { it.second.rpe == 10.0 })
        assertTrue("warm-ups are logged as warm-ups", sets.any { it.second.warmup && it.second.completed })
        assertTrue(sets.all { it.second.completed })
        assertTrue("every session lifts three exercises", seed.sessions.all { it.bundle.entries.size == 3 })
    }

    @Test
    fun theLiftCheckInsComeBeforeTheirSessionSoTheEngineAttachesThem() {
        for (s in seed.sessions) {
            val session = s.bundle.session
            val date = IsoTime.localDateKey(session.startedAtMs, session.offsetMin)
            val c = seed.checkIns.single { IsoTime.localDateKey(it.atMs, it.offsetMin) == date }
            assertEquals("45 minutes before the lift", 45 * 60_000L, session.startedAtMs - c.atMs)
            assertTrue("soreness on the muscles the day trains: ${c.sorenessJson}", c.sorenessJson != "{}")
        }
    }

    // ---- program and sessions agree ----

    /** What a program says about every day: each used exercise's state and its prescribed sets. */
    private fun signature(p: EvaluatedProgram): List<Any> =
        (1..p.dayCount).flatMap { day ->
            programs.usedExercises(p, day).map { ex ->
                val view = QalaCore.programDay(p.program, day)!!
                val exercise = view.getValue("exercises").jsonArray.map { it.jsonObject }.first { it.getValue("key").jsonPrimitive.content == ex.key }
                val sets = programs.entryFor(p, day, ex).getValue("sets").jsonArray.map {
                    val s = it.jsonObject
                    listOf(s["reps"], s["weight"], s["isAmrap"])
                }
                listOf(day, ex.key, exercise["progress"]?.jsonObject?.get("state"), sets)
            }
        }

    @Test
    fun theFinalProgramStateAfterReplayMatchesTheTextThatWasStored() {
        val replayed = programs.evaluate(seed.programText, GzclpProgram.NAME, WeightUnit.Lb, seed.exerciseData)
        assertEquals(dayCount, replayed.dayCount)
        assertEquals(emptyList<JsonElement>(), replayed.program.getValue("errors").jsonArray.toList())
        assertEquals(signature(seed.chainProgram), signature(replayed))
    }

    @Test
    fun theProgramMovedOnFromItsStartingTextAndTheMissesChangedStages() {
        assertTrue(seed.programText != GzclpProgram.TEXT)
        val fresh = programs.evaluate(GzclpProgram.TEXT, GzclpProgram.NAME, WeightUnit.Lb, seed.exerciseData)
        val now = programs.evaluate(seed.programText, GzclpProgram.NAME, WeightUnit.Lb, seed.exerciseData)
        assertTrue("eleven sessions changed what the days prescribe", signature(fresh) != signature(now))

        // The missed T1 set (session 2, day 3: bench) moves that lift to the next stage, 5x2 instead of 5x3.
        val weeks = seed.sessions.map { s -> s.programDay to s.bundle.entries.first().sets.filter { !it.warmup }.map { it.reps } }
        val benchT1 = weeks.filter { it.first == 3 }.map { it.second }
        assertEquals(listOf(3.0, 3.0, 3.0, 3.0), benchT1.first().take(4))
        assertTrue("after the miss the first set of bench T1 is a 2: $benchT1", benchT1.drop(1).any { it.first() == 2.0 })
    }

    @Test
    fun theRotationFollowsTheProgramAndTheNextDayIsTheNextInGzclp() {
        val days = seed.sessions.map { it.programDay }
        assertEquals("starts at day 1", 1, days.first())
        assertEquals(listOf(1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3), days)
        for (s in seed.sessions) assertEquals(s.programDay % dayCount + 1, s.nextDay)

        val next = seed.lastProgramDay % dayCount + 1
        assertEquals(4, next)
        val rules = RustDayRules(Availability(), emptyList())
        val schedule = Schedule(setOf(0, 2, 4, 5), dayCount, seed.sessions.map { it.bundle.session }, rules)
        assertEquals("the schedule agrees with the finish-day script", next, schedule.pointerAt(today.toString()))
        assertEquals(seed.sessions.last().nextDay, schedule.pointerAt(today.toString()))

        val view = QalaCore.programDay(seed.chainProgram.program, next)
        assertNotNull("getDay finds the next day", view)
        val replayed = programs.evaluate(seed.programText, GzclpProgram.NAME, WeightUnit.Lb, seed.exerciseData)
        assertEquals(
            "day 4 of GZCLP is deadlift, overhead press, row",
            listOf("deadlift", "overheadPress", "bentOverRow"),
            programs.usedExercises(replayed, next).map { it.exerciseId },
        )
        assertNull(QalaCore.programDay(replayed.program, dayCount + 1))
    }

    // ---- what the app reads from it ----

    @Test
    fun theEngineSnapshotOfTheSeedHasStateFatigueFitnessAndTheCards() {
        val snapshot = EngineCompute(programs).compute(seed.engineInput(), nowMs(), zone)

        assertTrue(snapshot.loaded)
        assertNull(snapshot.error)
        assertEquals(emptyList<String>(), snapshot.warnings)
        val view = snapshot.stateView!!
        assertTrue(view.fatigueSystemic > 0.0)
        assertTrue(view.fatigueMuscle.isNotEmpty() && view.fatigueMuscle.values.all { it >= 0.0 } && view.fatigueMuscle.values.any { it > 0.0 })
        assertTrue(view.fitness.isNotEmpty() && view.fitness.values.any { it > 0.0 })
        assertTrue(view.fitnessRun > 0.0)
        assertTrue("the state is the last session's or later: ${view.updated}", view.updated >= "2026-10-05")
        assertEquals("every check-in reached the engine", 21, snapshot.state!!.getValue("prsHistory").jsonArray.size)

        val readiness = snapshot.readiness!!
        assertEquals(21, readiness.checkinCount28d)
        assertNotNull(readiness.average28d)
        assertTrue(readiness.today.score in 0.0..1.0)
        assertFalse("no check-in yet today", readiness.checkedInToday)
        assertTrue("two days after a lift some muscles are not ready yet", readiness.readyDates.isNotEmpty())

        val trend = snapshot.weightTrend
        assertNotNull("three weigh-in days in any seven", trend)
        assertTrue(trend!!.latestKg in 78.0..84.0)
    }

    @Test
    fun todayIsTheNextLiftDayWithItsStagesAndTheWeekCardCountsWhatWasDone() {
        val snapshot = EngineCompute(programs).compute(seed.engineInput(), nowMs(), zone)
        val plan = snapshot.today!!
        assertEquals("2026-10-07", plan.date)
        assertTrue(plan.liftDay)
        assertEquals(4, plan.programDay)
        assertEquals(6, plan.stages.size)
        assertEquals(StageId.CHECK_IN, plan.now)

        val week = snapshot.week!!
        assertEquals("2026-10-05", week.weekStart)
        assertEquals(
            listOf(DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.RUN, DayKind.LIFT, DayKind.LIFT, DayKind.REST),
            week.days.map { it.kind },
        )
        assertEquals(listOf(3, null, 4, null, 1, 2, null), week.days.map { it.programDay })

        val load = snapshot.weekLoad!!
        assertTrue("Monday's lift is done and planned", load.done[0] > 0.0 && load.planned[0] > 0.0)
        assertTrue("Tuesday's run is done", load.done[1] > 0.0)
        assertEquals("the planned run and the logged one are on one scale", load.planned[1], load.done[1], 1e-6)
        assertEquals("what Monday prescribed is about what was lifted", 1.0, load.done[0] / load.planned[0], 0.15)
        assertTrue("today and the rest of the week are planned, not done", load.planned[2] > 0.0 && load.done[2] == 0.0)
        assertTrue(load.planned[3] > 0.0 && load.planned[4] > 0.0 && load.planned[5] > 0.0)
        assertEquals(0.0, load.planned[6], 0.0)

        assertEquals("the Tuesday run is logged, so the next one is Thursday", "2026-10-08", snapshot.nextRun!!.date)
    }

    @Test
    fun aDayWithTheLiftLoggedShowsItsStagesDoneAndTheWeekFollowsTheRotation() {
        val extra = seed.engineInput().let {
            // Lift day 4 for real on Wednesday, with its check-in and a warm-up stub.
            val at = today.atTime(17, 30).atZone(zone).toInstant().toEpochMilli()
            val real = LiftSessionBundle(
                seed.sessions.last().bundle.session.copy(id = "wed", startedAtMs = at, programDayIndex = 4),
                seed.sessions.last().bundle.entries,
            )
            it.copy(liftSessions = it.liftSessions + real.asRows())
        }
        val snapshot = EngineCompute(programs).compute(extra, nowMs() + 8 * 3_600_000L, zone)
        val plan = snapshot.today!!
        assertEquals(4, plan.programDay)
        assertEquals(StageState.DONE, plan.stages.first { it.id == StageId.LIFT }.state)
        assertTrue(snapshot.weekLoad!!.done[2] > 0.0)
    }
}
