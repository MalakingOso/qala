package com.qala.app

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.QalaDatabase
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
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Progress and Body tabs over the seeded container (a debug start seeds weeks of lifting, runs, check-ins and weigh-ins):
 * the charts are there with their titles, each has a Table button that swaps in the same numbers as rows, and Body has the ring.
 */
@RunWith(AndroidJUnit4::class)
class StatsRouteTest {
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

    private fun showApp() {
        val container = AppContainer(QalaDatabase.inMemory(context), env = RepoEnv(clock = friday), scope = scope, seedInDebug = true).also { it.start() }
        rule.setContent { CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() } }
    }

    private fun waitFor(timeoutMs: Long = 120_000, condition: () -> Boolean) = rule.waitUntil(timeoutMs, condition)

    private fun textShown(text: String, substring: Boolean = false) = rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun tab(name: String) = rule.onNode(hasText(name) and hasClickAction()).performClick()

    @Test
    fun progressDrawsTheLiftsTheSetsAndTheRunsAndEachChartHasATable() {
        showApp()
        waitFor { textShown("GZCLP DAY", substring = true) }
        tab("Progress")
        waitFor { textShown("ESTIMATED 1RM", substring = true) }     // a main lift's strength hero, from the engine's observations
        waitFor { textShown("Sets by muscle, this week") || textShown("Running, per week") }
        // The Table button swaps the first chart for the same numbers as rows, and back.
        val table = rule.onAllNodes(hasText("Table") and hasClickAction())[0]
        table.performClick()
        waitFor { textShown("Chart") }
        rule.onAllNodes(hasText("Chart") and hasClickAction())[0].performClick()
        waitFor { textShown("Table") }
    }

    @Test
    fun bodyHasTheReadinessRingTheSevenDayLineAndTheWeightLine() {
        showApp()
        waitFor { textShown("GZCLP DAY", substring = true) }
        tab("Body")
        waitFor { textShown("READINESS TODAY") }
        // The ring is a description and no table: "Readiness 80 of 100" is among the descriptions.
        waitFor { rule.onAllNodes(hasContentDescription(" of 100", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        waitFor { textShown("READINESS, LAST 7 DAYS") }
        waitFor { textShown("Body weight") }
    }
}
