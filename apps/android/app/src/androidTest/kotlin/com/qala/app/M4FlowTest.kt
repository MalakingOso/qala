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
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.QalaDatabase
import com.qala.data.model.AvailabilityStatus
import com.qala.data.repo.DeviceClock
import com.qala.data.repo.RepoEnv
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
 * The M4 flows end to end over the real app: a check-in that moves readiness and the rail, the skip sheet and the status
 * card with Undo, an injury that walks into the check-in at soreness 4, "Feeling better?" once per session, the weekday
 * picker moving Today's day, and the empty state. The clock is held on a Friday (a lift day) unless a test moves it.
 */
@RunWith(AndroidJUnit4::class)
class M4FlowTest {
    @get:Rule
    val rule: AndroidComposeTestRule<*, ComponentActivity> = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val context = ApplicationProvider.getApplicationContext<Context>()

    /** A clock the test can move: noon on the Friday on or after today, in the device zone. */
    private class TestClock(var noon: ZonedDateTime) : DeviceClock {
        override val zone: ZoneId = noon.zone
        override fun nowMs(): Long = noon.toInstant().toEpochMilli()
    }

    private val clock = TestClock(
        ZonedDateTime.now(ZoneId.systemDefault()).with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)).withHour(12).withMinute(0).withSecond(0).withNano(0),
    )

    @After
    fun close() = scope.cancel()

    private fun container(seed: Boolean = true) =
        AppContainer(QalaDatabase.inMemory(context), env = RepoEnv(clock = clock), scope = scope, seedInDebug = seed).also { it.start() }

    private fun showApp(container: AppContainer) = rule.setContent {
        CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
    }

    private fun waitFor(timeoutMs: Long = 120_000, condition: () -> Boolean) = rule.waitUntil(timeoutMs, condition)

    private fun railSays(text: String) = waitFor { rule.onAllNodes(hasContentDescription(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun textShown(text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun waitForText(text: String, substring: Boolean = false) = waitFor { textShown(text, substring) }

    private fun waitForTheSeed() = waitForText("GZCLP DAY", substring = true)

    private val sheetPane = { title: String -> SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, title) }

    /** A control inside the open skip sheet (the same words are on the screen behind it). */
    private fun inSheet(title: String, text: String) = rule.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(sheetPane(title)))

    private fun openSkipSheet() {
        rule.onNodeWithText("Skip today").performClick()
        waitFor { rule.onAllNodes(sheetPane("Skip today")).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun skipToday(reason: String) {
        openSkipSheet()
        inSheet("Skip today", reason).performClick()
        inSheet("Skip today", "Skip today").performClick()
        waitFor { rule.onAllNodes(sheetPane("Skip today")).fetchSemanticsNodes().isEmpty() }
    }

    /** The readiness card's kicker numerals: "Readiness · estimate 80 of 100" or "Readiness · 63 of 100". */
    private fun readinessPoints(): Int {
        val node = rule.onAllNodes(hasText("READINESS ·", substring = true)).fetchSemanticsNodes().first()
        val text = node.config[SemanticsProperties.Text].joinToString("") { it.text }
        return Regex("(\\d+) OF 100").find(text)!!.groupValues[1].toInt()
    }

    // ---- check-in ----

    @Test
    fun aCheckInWithAHighSorenessMovesReadinessAndTheRail() {
        showApp(container())
        waitForTheSeed()
        railSays("Day stages: check-in now, 0 of 6 done")
        rule.onNodeWithText("READINESS · ESTIMATE", substring = true).performScrollTo()
        val before = readinessPoints()

        rule.onNodeWithText("Check in").performScrollTo().performClick()
        rule.onNodeWithText("Save check-in").assertIsDisplayed()
        // Recovery 3 and the first muscle the day trains at "still sore now".
        rule.onNodeWithContentDescription("3 of 10").performClick()
        val firstMuscle = rule.onAllNodes(hasContentDescription(" soreness", substring = true)).fetchSemanticsNodes().first()
            .config[SemanticsProperties.ContentDescription].first()
        rule.onNode(hasContentDescription("4, still sore now") and hasAnyAncestor(hasContentDescription(firstMuscle))).performClick()
        rule.onNodeWithText("Save check-in").performClick()

        railSays("Day stages: warm-up now, 1 of 6 done")
        rule.onNodeWithText("READINESS · ", substring = true).performScrollTo()
        waitFor { rule.onAllNodes(hasText("READINESS · ESTIMATE", substring = true)).fetchSemanticsNodes().isEmpty() }
        val after = readinessPoints()
        assertTrue("readiness went from $before to $after", after != before)
        assertTrue("a low recovery and a sore muscle pull it down: $before to $after", after < before)
    }

    @Test
    fun aCheckInSavesWhatWasAnsweredThroughTheRepository() = runBlocking {
        val container = container()
        showApp(container)
        waitForTheSeed()
        rule.onNodeWithText("Check in").performClick()
        rule.onNodeWithContentDescription("5 of 10").performClick()
        rule.onNodeWithText("Save check-in").performClick()
        val saved = withTimeout(60_000) { container.checkIns.checkIns.first { rows -> rows.any { it.recovery == 5.0 } } }
        assertTrue(saved.any { it.recovery == 5.0 && it.sorenessJson == "{}" })
    }

    // ---- skip, status, undo ----

    @Test
    fun skippingTodayAsSickShowsTheCardMakesARestShapeAndUndoRestoresTheLift() {
        showApp(container())
        waitForTheSeed()
        railSays("Day stages: check-in now, 0 of 6 done")

        skipToday("Sick")
        waitForText("Resting to get well. The plan shifts out.")
        railSays("Day stages: check-in now, 0 of 3 done")
        rule.onNodeWithText("Sick").assertExists()
        rule.onNodeWithText("Skip today").assertDoesNotExist()
        rule.onNodeWithContentDescription("Undo today's skip, sick").assertExists()

        rule.onNodeWithContentDescription("Undo today's skip, sick").performClick()
        railSays("Day stages: check-in now, 0 of 6 done")
        waitFor { !textShown("Resting to get well. The plan shifts out.") }
        rule.onNodeWithText("Skip today").assertExists()
    }

    @Test
    fun systemBackClosesTheSkipSheetBeforeLeavingToday() {
        showApp(container())
        waitForTheSeed()
        openSkipSheet()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        waitFor { rule.onAllNodes(sheetPane("Skip today")).fetchSemanticsNodes().isEmpty() }
        rule.onNodeWithText("How are you walking in?").assertExists()      // still on Today
        assertFalse("the activity did not finish", rule.activity.isFinishing)
    }

    @Test
    fun anInjuryNamesTheMuscleKeepsTheLiftAndWalksIntoTheCheckInAtFour() {
        showApp(container())
        waitForTheSeed()
        openSkipSheet()
        inSheet("Skip today", "Injured").performClick()
        // The button cannot be pressed until a muscle is named.
        rule.onNode(hasText("Pick a muscle first") and hasAnyAncestor(sheetPane("Skip today"))).assertExists()
        inSheet("Skip today", "Quads").performClick()
        inSheet("Skip today", "7 days").performClick()
        inSheet("Skip today", "Skip 7 days").performClick()

        waitForText("Injured: quads")
        waitFor { rule.onAllNodes(sheetPane("Skip today")).fetchSemanticsNodes().isEmpty() }
        railSays("Day stages: check-in now, 0 of 6 done")           // an injury trains around the muscle: the lift stays
        rule.onNodeWithText("Skip today").assertDoesNotExist()

        rule.onNodeWithText("Check in").performScrollTo().performClick()
        rule.onNodeWithText("injured, still sore now").assertExists()
        rule.onNode(hasContentDescription("4, still sore now") and hasAnyAncestor(hasContentDescription("Quads soreness"))).assertExists()
    }

    // ---- "Feeling better?" ----

    @Test
    fun feelingBetterAsksFromDayTwoOncePerSession() = runBlocking {
        val container = container()
        showApp(container)
        waitForTheSeed()
        railSays("Day stages: check-in now, 0 of 6 done")

        // Sick since yesterday: today is the second day.
        val yesterday = clock.noon.toLocalDate().minusDays(1).toString()
        container.availability.setStatus(AvailabilityStatus.Sick, since = yesterday)
        waitForText("Feeling better?")
        rule.onNodeWithText("Since ", substring = true).assertExists()

        rule.onNodeWithText("Still sick").performClick()
        waitFor { !textShown("Feeling better?") }
        // A rebuild in the same session does not bring it back.
        container.engine.refresh()
        container.availability.setStatus(AvailabilityStatus.Sick, since = yesterday, note = "still rough")
        waitForText("Note: still rough")
        assertFalse(textShown("Feeling better?"))
        assertTrue(container.feelingBetterAsked)
    }

    @Test
    fun iAmBetterEndsTheStatusAndTheLiftComesBack() = runBlocking {
        val container = container()
        showApp(container)
        waitForTheSeed()
        val yesterday = clock.noon.toLocalDate().minusDays(1).toString()
        container.availability.setStatus(AvailabilityStatus.Sick, since = yesterday)
        waitForText("Feeling better?")
        railSays("Day stages: check-in now, 0 of 3 done")

        rule.onNodeWithText("I am better").performClick()
        railSays("Day stages: check-in now, 0 of 6 done")
        waitFor { !textShown("Feeling better?") }
        // The days already marked keep their mark: the status ended yesterday, it was not erased.
        val status = withTimeout(30_000) { container.availability.status.first { it.until != null } }
        assertEquals(AvailabilityStatus.Sick, status.status)
        assertEquals(yesterday, status.until)
        assertEquals(yesterday, status.since)
    }

    @Test
    fun aOneDaySkipNeverAsksFeelingBetter() {
        showApp(container())
        waitForTheSeed()
        skipToday("Sick")
        waitForText("Resting to get well. The plan shifts out.")
        assertFalse(textShown("Feeling better?"))
    }

    // ---- training weekdays ----

    @Test
    fun changingTheTrainingWeekdaysChangesTodaysDayAndTheWeek() = runBlocking {
        val container = container()
        showApp(container)
        waitForTheSeed()
        railSays("Day stages: check-in now, 0 of 6 done")        // Friday lifts by default

        rule.onNodeWithContentDescription("Settings").performClick()
        rule.onNodeWithText("Training days".uppercase()).assertExists()
        rule.onNodeWithContentDescription("Friday").performClick()
        waitFor {
            runBlocking { container.settings.settings.first().trainingWeekdays } == listOf(0, 2, 5)
        }
        rule.onNodeWithText("3 days a week").assertExists()
        rule.onNodeWithContentDescription("Back").performClick()
        railSays("Day stages: check-in now, 0 of 3 done")
        waitForText("FRIDAY · REST DAY")

        // And back on: Friday is a lift day again.
        rule.onNodeWithContentDescription("Settings").performClick()
        rule.onNodeWithContentDescription("Friday").performClick()
        rule.onNodeWithContentDescription("Back").performClick()
        railSays("Day stages: check-in now, 0 of 6 done")
    }

    @Test
    fun theLastTrainingDayCannotBeTurnedOff() = runBlocking {
        val container = container()
        container.settings.setTrainingWeekdays(listOf(5))
        showApp(container)
        rule.onNodeWithContentDescription("Settings").performClick()
        rule.onNodeWithContentDescription("Saturday").performClick()
        rule.onNodeWithText("Keep at least one training day.").assertExists()
        assertEquals(listOf(5), container.settings.settings.first().trainingWeekdays)
    }

    // ---- empty state ----

    @Test
    fun aFreshInstallShowsQuietCardsAndNeverCrashes() {
        showApp(container(seed = false))
        railSays("Day stages: check-in now, 0 of 3 done")
        waitForText("FRIDAY · NO PROGRAM YET")
        rule.onNodeWithText("No program yet. Add one in Plan and Today shows your lift.").assertExists()
        rule.onNodeWithText("Add a program").assertExists()
        rule.onNodeWithText("No run planned").performScrollTo().assertExists()
        rule.onNodeWithText("No score yet").performScrollTo().assertExists()
        rule.onNodeWithText("Nothing planned").performScrollTo().assertExists()
        rule.onNodeWithText("No weigh-ins yet").performScrollTo().assertExists()
        assertNull("nothing to skip with no program", rule.onAllNodes(hasText("Skip today")).fetchSemanticsNodes().firstOrNull())

        // The check-in works with nothing behind it: four fixed muscles, save writes a record.
        rule.onNodeWithText("Check in").performScrollTo().performClick()
        rule.onNodeWithText("Upper back").assertExists()
        rule.onNodeWithText("Rest-day tip".uppercase()).assertExists()
        rule.onNodeWithText("Save check-in").performClick()
        railSays("Day stages: 1 of 3 done")
    }
}
