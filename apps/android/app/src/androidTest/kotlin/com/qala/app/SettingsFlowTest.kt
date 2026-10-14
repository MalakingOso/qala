package com.qala.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.core.PlatePairs
import com.qala.data.db.QalaDatabase
import com.qala.data.model.EquipmentItem
import com.qala.data.repo.DeviceClock
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.StubStage
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Settings end to end over the real app on the debug seed: a value changed in Settings is the value the rest of the app
 * uses. The default bar set to 35 is the bar the plate calculator opens on, automatic rest turned off means logging a set
 * does not open Rest, the plate inventory is edited where Edit plates lands, and the training status is changed and ended
 * from Settings with Today's own skip sheet. The clock is held on a Friday noon, a lift day.
 */
@RunWith(AndroidJUnit4::class)
class SettingsFlowTest {
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

    private fun container() =
        AppContainer(QalaDatabase.inMemory(context), env = RepoEnv(clock = clock), scope = scope, seedInDebug = true).also { it.start() }

    private fun showApp(container: AppContainer) = rule.setContent {
        CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
    }

    private fun waitFor(timeoutMs: Long = 120_000, condition: () -> Boolean) = rule.waitUntil(timeoutMs, condition)

    private fun textShown(text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun waitForText(text: String, substring: Boolean = false) = waitFor { textShown(text, substring) }

    private fun railSays(text: String) = waitFor { rule.onAllNodes(hasContentDescription(text)).fetchSemanticsNodes().isNotEmpty() }

    private val sheetPane = { title: String -> SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, title) }

    private fun inSheet(title: String, text: String) = rule.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(sheetPane(title)))

    private fun openSettings(container: AppContainer) {
        showApp(container)
        waitForText("GZCLP DAY", substring = true)
        rule.onNodeWithContentDescription("Settings").performClick()
        waitForText("TRAINING STATUS")
    }

    // ---- bars and plates ----

    @Test
    fun theDefaultBarSetTo35InSettingsIsTheBarTheCalculatorOpensOn() = runBlocking {
        val container = container()
        openSettings(container)
        assertEquals(45.0, container.settings.gym.first().plates.defaultBar, 0.0)

        rule.onNodeWithContentDescription("35 lb").performScrollTo().performClick()
        waitFor { runBlocking { container.settings.gym.first().plates.defaultBar } == 35.0 }

        rule.onNodeWithContentDescription("Open plate calculator").performClick()
        waitForText("35 bar + 2 × 105 = 245")                                                  // 245 on the 35 lb bar, planned by the Rust math
        rule.onNode(hasContentDescription("35") and isSelected()).assertExists()
        assertTrue("the 45 cell is not the picked one", rule.onAllNodes(hasContentDescription("45") and isSelected()).fetchSemanticsNodes().isEmpty())
        container.database.close()
    }

    @Test
    fun theInventoryIsEditedWhereEditPlatesLandsAndTheCalculatorPlansOnIt() = runBlocking {
        val container = container()
        openSettings(container)
        rule.onNodeWithContentDescription("Open plate calculator").performClick()
        waitForText("45 bar + 2 × 100 = 245")
        assertTrue("the default inventory loads 245 with a ten", container.settings.gym.first().plates.pairsOf(10.0) == PlatePairs.Enough)

        // Edit plates goes back to Settings, scrolled to the inventory.
        rule.onNodeWithText("Edit plates").performClick()
        waitFor { runCatching { rule.onNodeWithText("YOUR PLATES").assertIsDisplayed() }.isSuccess }

        // No 10s: step the plenty down to twelve pairs, then all the way to nothing.
        rule.onNodeWithContentDescription("One fewer pair of 10 lb plates").performScrollTo().performClick()
        waitFor { runBlocking { container.settings.gym.first().plates.pairsOf(10.0) } == PlatePairs.Count(12.0) }
        repeat(12) { rule.onNodeWithContentDescription("One fewer pair of 10 lb plates").performClick() }
        waitFor { runBlocking { container.settings.gym.first().plates.pairsOf(10.0) } == PlatePairs.Count(0.0) }
        assertEquals("the 10s and the 1.25s both read none", 2, rule.onAllNodes(hasText("0 pairs")).fetchSemanticsNodes().size)

        // And a pair of 55s.
        rule.onNodeWithContentDescription("Use 55 lb plates").performScrollTo().performClick()
        waitFor { runBlocking { container.settings.gym.first().plates.uses55 } }
        rule.onNodeWithText("1 pair").assertExists()

        rule.onNodeWithContentDescription("Back").performScrollTo().performClick()
        railSays("Day stages: check-in now, 0 of 6 done")
        rule.onNodeWithContentDescription("Settings").performClick()
        rule.onNodeWithContentDescription("Open plate calculator").performClick()
        waitForText("55 · 45 on each side", substring = true)                                   // 245 is now a 55 and a 45 a side
        rule.onNodeWithText("55 lb").performScrollTo().assertExists()                           // and the calculator lists the saved inventory, 55s included
        container.database.close()
    }

    // ---- rest ----

    @Test
    fun turningAutomaticRestOffLogsASetWithoutOpeningRest() = runBlocking {
        val container = container()
        openSettings(container)
        rule.onNodeWithText("Automatic rest").performScrollTo().performClick()
        waitFor { !runBlocking { container.settings.gym.first().rest.auto } }
        rule.onNodeWithContentDescription("Back").performScrollTo().performClick()

        val day = withTimeout(60_000) { container.engine.snapshot.first { it.today?.programDay != null }.today!!.programDay!! }
        container.checkIns.save(7.0)
        container.sessions.markStageDone(StubStage.WARM_UP, day)
        railSays("Day stages: lift now, 2 of 6 done")
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")
        waitForText("Then set 2")                                                              // the hint promises no rest

        rule.onNodeWithText("Log set 1").performClick()
        waitForText("Log set 2")                                                               // the logger moved on, and stayed on the workout
        assertFalse("Rest did not open", textShown("Ready early"))
        val state = container.workout.state.value!!
        assertNull(state.rest)
        assertTrue(state.exercises[0].sets[0].done)
        assertEquals(1, state.exercises[0].selected)

        // Another set, still no Rest.
        rule.onNodeWithText("Log set 2").performClick()
        waitForText("Log set 3")
        assertFalse(textShown("Ready early"))
        assertNull(container.workout.state.value!!.rest)
        container.database.close()
    }

    @Test
    fun turningShowPlatesOffHidesThePlatesOnSetRowsAndRest() = runBlocking {
        val container = container()
        showApp(container)
        waitForText("GZCLP DAY", substring = true)
        container.settings.setShowPlates(false)
        waitFor { !container.workout.gym.value.rest.showPlates }
        val day = withTimeout(60_000) { container.engine.snapshot.first { it.today?.programDay != null }.today!!.programDay!! }
        container.checkIns.save(7.0)
        container.sessions.markStageDone(StubStage.WARM_UP, day)
        railSays("Day stages: lift now, 2 of 6 done")
        rule.onNodeWithText("Start workout").performClick()
        waitForText("Log set 1")

        // The store still works the plates out (the hints are there to be shown); the screen does not show them.
        withTimeout(60_000) { while (container.workout.plateHints.value.isEmpty()) kotlinx.coroutines.delay(100) }
        rule.waitForIdle()
        assertFalse("no plate line on a set row", textShown("per side", substring = true))

        rule.onNodeWithText("Log set 1").performClick()
        waitForText("Ready early")
        assertFalse("none on Rest either", textShown("PER SIDE") || textShown("Same as last set", substring = true))
        container.database.close()
    }

    @Test
    fun withoutATheragunTheWarmupHasNoTheragunRows() = runBlocking {
        val container = container()
        showApp(container)
        waitForText("GZCLP DAY", substring = true)
        container.settings.setOwned(EquipmentItem.Percussion, false)
        waitFor { !container.workout.gym.value.equipment.percussion }
        container.checkIns.save(7.0)
        railSays("Day stages: warm-up now, 1 of 6 done")
        rule.onNodeWithText("Start warm-up").performClick()
        waitForText("Soft tissue")
        waitForText("Foam roller", substring = true)
        assertFalse("no Theragun in the soft tissue rows", textShown("Theragun", substring = true))
        container.database.close()
    }

    // ---- training status ----

    @Test
    fun theStatusIsChangedFromSettingsWithTheSkipSheetAndSetActiveEndsIt() = runBlocking {
        val container = container()
        openSettings(container)
        rule.onNodeWithText("Active.").assertExists()
        rule.onNodeWithText("training as usual").assertExists()
        assertTrue(rule.onAllNodes(hasText("Set active")).fetchSemanticsNodes().isEmpty())

        rule.onNodeWithContentDescription("Change today's status").performClick()
        waitFor { rule.onAllNodes(sheetPane("Skip today")).fetchSemanticsNodes().isNotEmpty() }
        inSheet("Skip today", "Sick").performClick()
        inSheet("Skip today", "Skip today").performClick()
        waitFor { rule.onAllNodes(sheetPane("Skip today")).fetchSemanticsNodes().isEmpty() }

        waitForText("Sick today.")
        rule.onNodeWithText("plan shifts").assertExists()
        rule.onNodeWithText("Set active").performScrollTo().performClick()
        waitForText("Active.")
        rule.onNodeWithText("training as usual").assertExists()
        assertTrue(rule.onAllNodes(hasText("Set active")).fetchSemanticsNodes().isEmpty())
        container.database.close()
    }
}
