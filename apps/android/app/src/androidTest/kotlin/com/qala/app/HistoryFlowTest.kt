package com.qala.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.QalaDatabase
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
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * History over the real app on the debug seed, with the clock pinned to a Friday (a lift day) so the test means the
 * same thing on any day it runs. The All exercises grid is tested with the lifting flow it belongs to (WorkoutFlowTest).
 */
@RunWith(AndroidJUnit4::class)
class HistoryFlowTest {
    @get:Rule
    val rule: AndroidComposeTestRule<*, ComponentActivity> = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val context = ApplicationProvider.getApplicationContext<Context>()

    private val friday = object : DeviceClock {
        override val zone: ZoneId = ZoneId.systemDefault()
        private val noon = ZonedDateTime.now(zone).with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)).withHour(12).withMinute(0).withSecond(0).withNano(0)
        override fun nowMs(): Long = noon.toInstant().toEpochMilli()
    }

    @After
    fun close() = scope.cancel()

    private fun showSeededApp(): AppContainer {
        val container = AppContainer(QalaDatabase.inMemory(context), env = RepoEnv(clock = friday), scope = scope, seedInDebug = true).also { it.start() }
        rule.setContent { CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() } }
        // The seed writes the program first and the history after it; the head names the program once it is all in.
        waitFor { rule.onAllNodes(hasText("GZCLP DAY", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        return container
    }

    private fun waitFor(condition: () -> Boolean) = rule.waitUntil(timeoutMillis = 120_000, condition = condition)

    private fun showsText(text: String) = rule.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun historyListsTheSeededSessionsAndBackLeavesForToday() {
        showSeededApp()

        rule.onNodeWithContentDescription("History").performClick()
        rule.onNode(isHeading() and hasText("History")).assertExists()
        // The seed's lifts show their volume and minutes, its runs their distance; none reads as a stub.
        waitFor { showsText(" lb · ") && showsText(" mi · ") }
        waitFor { !showsText("Marked done") }

        // Back leaves the pushed screen for Today.
        rule.onNodeWithContentDescription("Back").performClick()
        rule.onNodeWithText("Check in").assertExists()
    }

    @Test
    fun aMarkedDoneStageReadsAsMarkedDoneNotAsAnEmptyWorkout() = runBlocking {
        val container = showSeededApp()
        val day = withTimeout(60_000) { container.engine.snapshot.first { it.today?.programDay != null }.today!!.programDay!! }
        // The records a stage's Mark done leaves: a warm-up and a lift with no sets, and a run with no distance.
        container.sessions.markStageDone(StubStage.WARM_UP, day)
        container.sessions.markStageDone(StubStage.LIFT, day)
        container.runs.markDone()

        rule.onNodeWithContentDescription("History").performClick()
        waitFor { showsText("Marked done · nothing logged") && showsText("Marked done · no sets logged") && showsText("Marked done · no distance logged") }
    }
}
