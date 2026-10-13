package com.qala.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.IsoTime
import com.qala.data.db.MetaKeys
import com.qala.data.db.QalaDatabase
import com.qala.data.program.liftPlan
import com.qala.data.model.WeightUnit
import com.qala.data.repo.DeviceClock
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.StubStage
import com.qala.app.workout.Opened
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The lifting flow end to end over the real app on the debug seed, with no network: Today's Start workout opens the
 * workout, logging a set opens Rest, Ready early comes back to the next set, finishing saves a real session with its
 * sets and moves the program on. The check-in and the warm-up are written through the repositories (as M4FlowTest
 * writes its status), so the test starts at the lift stage. The clock is held on a Friday noon, a lift day.
 */
@RunWith(AndroidJUnit4::class)
class WorkoutFlowTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val context = ApplicationProvider.getApplicationContext<Context>()

    private class TestClock(val noon: ZonedDateTime) : DeviceClock {
        override val zone: ZoneId = noon.zone
        override fun nowMs(): Long = noon.toInstant().toEpochMilli()
    }

    private val clock = TestClock(
        ZonedDateTime.now(ZoneId.systemDefault()).with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)).withHour(12).withMinute(0).withSecond(0).withNano(0),
    )

    @After
    fun close() = scope.cancel()

    private fun container(database: QalaDatabase = QalaDatabase.inMemory(context)) =
        AppContainer(database, env = RepoEnv(clock = clock), scope = scope, seedInDebug = true).also { it.start() }

    /** The app, in a tester that can save and restore what `rememberSaveable` holds, as a rotation does. */
    private val restoration by lazy { StateRestorationTester(rule) }

    private fun showApp(container: AppContainer) = restoration.setContent {
        CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
    }

    private fun waitFor(timeoutMs: Long = 120_000, condition: () -> Boolean) = rule.waitUntil(timeoutMs, condition)

    private fun textShown(text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun waitForText(text: String, substring: Boolean = false) = waitFor { textShown(text, substring) }

    private fun railSays(text: String) = waitFor { rule.onAllNodes(hasContentDescription(text)).fetchSemanticsNodes().isNotEmpty() }

    private val sheetPane = { title: String -> SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, title) }

    private fun inSheet(title: String, text: String) = rule.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(sheetPane(title)))

    /** Opens the app on the seed, writes the check-in and the warm-up, and returns the program day Today will lift. */
    private fun reachTheLift(container: AppContainer): Int = runBlocking {
        showApp(container)
        waitForText("GZCLP DAY", substring = true)
        val day = withTimeout(60_000) { container.engine.snapshot.first { it.today?.programDay != null }.today!!.programDay!! }
        container.checkIns.save(7.0)
        container.sessions.markStageDone(StubStage.WARM_UP, day)
        railSays("Day stages: lift now, 2 of 6 done")
        day
    }

    private fun startWorkout() {
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")
    }

    /** Logs the set the workout is on, then comes back from Rest to the next set. Returns whether Rest opened. */
    private fun logSet(): Boolean {
        rule.onNodeWithText("Log set", substring = true).performClick()
        waitFor { textShown("Ready early") || rule.onAllNodes(sheetPane("Finish workout?")).fetchSemanticsNodes().isNotEmpty() }
        if (!textShown("Ready early")) return false
        rule.onNodeWithText("Ready early").performClick()
        waitFor { textShown("Log set", substring = true) }
        return true
    }

    // ---- the flow ----

    @Test
    fun loggingSetsRestingAndFinishingSavesARealSessionAndMovesTheProgramOn() = runBlocking {
        val container = container()
        val day = reachTheLift(container)
        val before = container.programs.active.first()!!.text
        val unit = WeightUnit.Lb

        startWorkout()
        rule.onNodeWithText("Workout").assertIsDisplayed()
        val plan = container.workout.state.value!!
        assertEquals(day, plan.day)
        val total = plan.totalSets

        // Every set of a barbell lift says what goes on the bar, from the Rust plate math.
        waitForText("per side", substring = true)

        // The first set: Rest opens on the clock's own time, shows the next set and the ledger, and +30 s lengthens it.
        rule.onNodeWithText("Log set 1").performClick()
        waitForText("Ready early")
        waitForText("PER SIDE")                                                         // the plates for set 2, once the plate math has answered
        rule.onNodeWithText("Same as last set, leave the plates on.").assertExists()
        rule.onNodeWithContentDescription("3 minutes 0 seconds left").assertExists()      // the clock does not move, so the countdown holds at the full rest
        rule.onNodeWithText("of 3:00").assertExists()
        rule.onNodeWithText("NEXT · SET 2").assertExists()
        rule.onNodeWithText("+30 s").performClick()
        rule.onNodeWithText("of 3:30").assertExists()
        rule.onNodeWithText("Time you added").assertExists()
        rule.onNodeWithText("Ready early").performClick()
        waitForText("Log set 2")

        // The rest of the workout, as prescribed. The last set opens the finish sheet instead of Rest.
        var rests = 1
        repeat(total - 1) { if (logSet()) rests += 1 }
        assertEquals("every set but the last opened Rest", total - 1, rests)
        waitFor { rule.onAllNodes(sheetPane("Finish workout?")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("All $total sets are logged. The program moves on to its next day.").assertExists()
        inSheet("Finish workout?", "Finish workout").performClick()

        // Back on Today, with the lift done on the rail.
        railSays("Day stages: run now, 3 of 6 done")

        val saved = withTimeout(60_000) {
            container.sessions.liftSessions.first { all -> all.any { it.session.startedAtMs == clock.nowMs() && !it.session.stub } }
        }.single { it.session.startedAtMs == clock.nowMs() && !it.session.stub }      // the warm-up stub shares the pinned minute
        assertFalse(saved.session.stub)
        assertNull("a real session is not a stage stub", saved.session.stage)
        assertEquals(day, saved.session.programDayIndex)
        assertEquals(3, saved.entries.size)
        assertEquals(total, saved.entries.sumOf { it.sets.size })
        assertTrue(saved.entries.flatMap { it.sets }.all { it.completed && !it.warmup })

        // The program moved on: its text changed, the day's first lift got heavier, and the next training day is the next program day.
        val after = withTimeout(60_000) { container.programs.active.first { it?.text != before } }!!
        assertNotEquals(before, after.text)
        val exerciseData = container.settings.exerciseData.first()
        val old = container.programEngine.evaluate(before, after.name, unit, exerciseData)
        val new = container.programEngine.evaluate(after.text, after.name, unit, exerciseData)
        val oldWeight = container.programEngine.liftPlan(old, day, after.name, unit)!!.exercises.first().sets.first().weight!!
        val newWeight = container.programEngine.liftPlan(new, day, after.name, unit)!!.exercises.first().sets.first().weight!!
        assertTrue("the main lift went from $oldWeight to $newWeight", newWeight > oldWeight)
        val snapshot = container.engine.snapshot.first { it.today?.stages?.any { s -> s.id.name == "LIFT" && s.state.name == "DONE" } == true }
        val saturday = IsoTime.addDays(snapshot.date, 1)
        assertEquals(day % old.dayCount + 1, snapshot.week!!.on(saturday)!!.programDay)

        // The workout is closed: nothing in progress, no draft left behind.
        withTimeout(30_000) { while (container.workout.state.value != null) kotlinx.coroutines.delay(100) }
        assertNull(container.database.metaDao().get(MetaKeys.WORKOUT_DRAFT))
        container.database.close()
    }

    @Test
    fun theStepperAndTheRpeStripChangeWhatIsLogged() = runBlocking {
        val container = container()
        reachTheLift(container)
        startWorkout()
        rule.onNodeWithContentDescription("More weight").performClick()
        rule.onNodeWithContentDescription("More reps").performClick()
        rule.onNodeWithContentDescription("RPE 9, one in the tank").performClick()
        rule.onNodeWithText("RPE 9 · one in the tank").assertExists()
        rule.onNodeWithText("Log set 1").performClick()
        waitForText("Ready early")
        val set = container.workout.state.value!!.exercises[0].sets[0]
        val target = set.targetWeight!!
        assertEquals(target + 5.0, set.weight!!, 0.0)
        assertEquals(set.targetReps + 1, set.reps, 0.0)
        assertEquals(9.0, set.rpe!!, 0.0)
        assertTrue(set.done)
        // The rest screen reads back what was logged.
        rule.onNodeWithText("@ 9", substring = true).assertExists()
        container.database.close()
    }

    @Test
    fun aHalfLoggedWorkoutIsStillThereAfterBackToTodayAndReturning() = runBlocking {
        val container = container()
        reachTheLift(container)
        startWorkout()
        logSet()
        logSet()
        waitForText("Log set 3")
        // Back to Today (the in-app button), then the same Start workout comes back on set 3 with two sets logged.
        rule.onNodeWithContentDescription("Back to Today").performClick()
        railSays("Day stages: lift now, 2 of 6 done")
        assertEquals(2, container.workout.state.value!!.loggedSets)
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 3")
        assertEquals(2, container.workout.state.value!!.loggedSets)
        container.database.close()
    }

    @Test
    fun systemBackFromRestReturnsToTheWorkoutOnTheNextSet() = runBlocking {
        val container = container()
        reachTheLift(container)
        startWorkout()
        rule.onNodeWithText("Log set 1").performClick()
        waitForText("Ready early")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        waitForText("Log set 2")
        rule.onNodeWithText("Workout").assertIsDisplayed()
        container.database.close()
    }

    @Test
    fun anExerciseIsReachedByNameFromTheNeighbourButtonAndTheGrid() = runBlocking {
        val container = container()
        reachTheLift(container)
        startWorkout()
        val names = container.workout.state.value!!.exercises.map { it.name }
        rule.onNodeWithContentDescription("Next exercise, ${names[1]}").performClick()
        waitFor { container.workout.state.value!!.current == 1 }
        rule.onNodeWithContentDescription("Previous exercise, ${names[0]}").assertExists()
        // The zoom-out is its own screen; picking an exercise there goes to it in the workout.
        rule.onNodeWithContentDescription("All exercises").performClick()
        rule.onNode(isHeading() and hasText("All exercises")).assertExists()
        rule.onNode(hasContentDescription("1, ${names[0]}", substring = true)).performClick()
        waitFor { container.workout.state.value!!.current == 0 }
        waitForText("Log set 1")
        rule.onNodeWithText("Workout").assertIsDisplayed()
        container.database.close()
    }

    @Test
    fun theGridShowsTheWorkoutLiveFromTheWorkoutAndFromRestAndBackReturnsToWhereItWasOpened() = runBlocking {
        val container = container()
        reachTheLift(container)
        startWorkout()
        val names = container.workout.state.value!!.exercises.map { it.name }
        val firstSets = container.workout.state.value!!.exercises[0].sets.size
        logSet()
        waitForText("Log set 2")

        // From the workout: the logged set is filled in, and Back is the workout.
        rule.onNodeWithContentDescription("All exercises").performClick()
        rule.onNode(isHeading() and hasText("All exercises")).assertExists()
        rule.onNode(hasContentDescription("1, ${names[0]}", substring = true) and hasContentDescription("1 of $firstSets sets done", substring = true)).assertExists()
        rule.onNode(hasContentDescription("2, ${names[1]}", substring = true) and hasContentDescription("0 of ", substring = true)).assertExists()
        rule.onNodeWithContentDescription("Back").performClick()
        waitForText("Log set 2")

        // From Rest: the same grid, and Back is Rest, still counting; a card then leaves Rest for that exercise.
        rule.onNodeWithText("Log set 2").performClick()
        waitForText("Ready early")
        rule.onNodeWithContentDescription("All exercises").performClick()
        rule.onNode(hasContentDescription("1, ${names[0]}", substring = true) and hasContentDescription("2 of $firstSets sets done", substring = true)).assertExists()
        rule.onNodeWithContentDescription("Back").performClick()
        waitForText("Ready early")
        rule.onNodeWithContentDescription("All exercises").performClick()
        rule.onNode(hasContentDescription("3, ${names[2]}", substring = true)).performClick()
        waitFor { container.workout.state.value!!.current == 2 }
        waitForText("Log set 1")
        rule.onNodeWithText("Workout").assertIsDisplayed()
        container.database.close()
    }

    @Test
    fun theGridShowsTheDayDuringTheWarmUpWithoutStartingTheWorkout() = runBlocking {
        val container = container()
        showApp(container)
        waitForText("GZCLP DAY", substring = true)
        container.checkIns.save(7.0)
        railSays("Day stages: warm-up now, 1 of 6 done")
        rule.onNodeWithText("Start warm-up").performClick()
        waitForText("Easy cardio")
        rule.onNodeWithContentDescription("All exercises").performClick()
        rule.onNode(isHeading() and hasText("All exercises")).assertExists()
        waitFor { rule.onAllNodes(hasContentDescription("0 of ", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        waitForText("exercises ·", substring = true)
        // There is no workout to jump into yet: the cards are not buttons, and nothing was opened.
        assertTrue(rule.onAllNodes(hasContentDescription("sets done", substring = true) and hasClickAction()).fetchSemanticsNodes().isEmpty())
        assertNull(container.workout.state.value)
        rule.onNodeWithContentDescription("Back").performClick()
        waitForText("Easy cardio")
        container.database.close()
    }

    @Test
    fun finishingWithNothingLoggedOffersToLeaveAndSavesNothing() = runBlocking {
        val container = container()
        reachTheLift(container)
        val sessionsBefore = container.sessions.liftSessions.first().size
        startWorkout()
        rule.onNodeWithContentDescription("Finish workout").performClick()
        waitFor { rule.onAllNodes(sheetPane("Leave the workout?")).fetchSemanticsNodes().isNotEmpty() }
        inSheet("Leave the workout?", "Leave without saving").performClick()
        railSays("Day stages: lift now, 2 of 6 done")
        withTimeout(30_000) { while (container.workout.state.value != null) kotlinx.coroutines.delay(100) }
        assertEquals(sessionsBefore, container.sessions.liftSessions.first().size)
        container.database.close()
    }

    @Test
    fun theWarmUpMarksItsStageDoneAndGoesOnToTheWorkout() = runBlocking {
        val container = container()
        showApp(container)
        waitForText("GZCLP DAY", substring = true)
        container.checkIns.save(7.0)
        railSays("Day stages: warm-up now, 1 of 6 done")
        rule.onNodeWithText("Start warm-up").performClick()
        waitForText("Easy cardio")
        rule.onNodeWithText("Ramp sets").assertExists()
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        railSays("Day stages: lift now, 2 of 6 done")
        container.database.close()
    }

    // ---- surviving a recreated activity and a killed process ----

    @Test
    fun aRotationKeepsTheWorkoutAndWhereTheLifterWas() = runBlocking {
        val container = container()
        reachTheLift(container)
        startWorkout()
        logSet()
        waitForText("Log set 2")
        // The screens are rebuilt from saved state, as when the activity is recreated: the route (Workout) comes back from
        // what rememberSaveable held, and the workout itself from the container, which the activity does not own.
        restoration.emulateSavedInstanceStateRestore()
        waitForText("Log set 2")
        rule.onNodeWithText("Workout").assertIsDisplayed()
        assertEquals(1, container.workout.state.value!!.loggedSets)
        // Rest survives it too.
        rule.onNodeWithText("Log set 2").performClick()
        waitForText("Ready early")
        restoration.emulateSavedInstanceStateRestore()
        waitForText("Ready early")
        rule.onNodeWithText("NEXT · SET 3").assertExists()
        container.database.close()
    }

    @Test
    fun aKilledProcessPicksTheWorkoutUpFromTheDatabase() = runBlocking {
        val database = QalaDatabase.inMemory(context)
        val first = container(database)
        val day = reachTheLift(first)
        startWorkout()
        logSet()
        logSet()
        waitForText("Log set 3")
        // The draft is written behind the screen; wait for the one with two sets in it.
        withTimeout(30_000) {
            while (database.metaDao().get(MetaKeys.WORKOUT_DRAFT)?.let { com.qala.app.workout.WorkoutState.fromJson(it)?.loggedSets } != 2) kotlinx.coroutines.delay(100)
        }
        val sessionId = first.workout.state.value!!.sessionId

        // A second container over the same database is a new process: it has no workout until it opens the day.
        val second = AppContainer(database, env = RepoEnv(clock = clock), scope = scope, seedInDebug = false)
        assertNull(second.workout.state.value)
        assertEquals(Opened.Ready, second.workout.open(day))
        val restored = second.workout.state.value!!
        assertEquals(sessionId, restored.sessionId)
        assertEquals(2, restored.loggedSets)
        assertEquals(first.workout.state.value, restored)
        assertNotNull(restored.exercises[0].sets[0].loggedAtMs)
        database.close()
    }
}
