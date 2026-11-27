package com.qala.app.run

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.app.AppContainer
import com.qala.data.core.RunEvent
import com.qala.data.core.RunCueOptions
import com.qala.data.core.RunOpts
import com.qala.data.db.MetaKeys
import com.qala.data.db.QalaDatabase
import com.qala.data.repo.RepoEnv
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The run recorder over a real in-memory Room database on the emulator: a run recorded, the process "killed" (a second
 * [RunRecording] built over the same database), the run recovered with the same numbers, the next fix marked as a gap and no
 * cue spoken again, and the finished-run marker that keeps a run on its Summary.
 */
@RunWith(AndroidJUnit4::class)
class RunRecordingTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val start = 1_800_000_000_000L
    private val opts = RunOpts(cues = RunCueOptions(everyDistM = 40.0))      // a cue every 40 m, so a short test run speaks

    @After
    fun close() = scope.cancel()

    private fun container() = AppContainer(QalaDatabase.inMemory(context), env = RepoEnv(), scope = scope, seedInDebug = false)

    private fun recording(c: AppContainer) = RunRecording(c.database, c.runs, scope, now = { start })

    private fun fix(k: Int, lat: Double = 47.6 + k * 2.7e-5) = RawFix(start + k * 1000L, lat, -122.3321, 4.0)

    private suspend fun RunRecording.waitForPoints(n: Int) = withTimeout(30_000) { state.first { it is RunState.Active && (it.live?.points ?: 0) >= n } as RunState.Active }

    @Test
    fun aRunRecoversWithTheSameNumbersMarksTheNextFixAsAGapAndSpeaksNothingAgain() = runBlocking {
        val c = container()
        val first = recording(c)
        first.start("Test run", opts)
        for (k in 1..60) first.fix(fix(k))
        first.advance()
        val before = first.waitForPoints(60).live!!

        // The process dies: a new recorder over the same database picks the run up.
        val second = recording(c)
        val spoken = mutableListOf<RunEvent>()
        val listening = scope.launch { second.events.collect { spoken += it } }
        delay(200)
        second.attach()
        val after = (second.state.value as RunState.Active).live!!
        assertEquals(before.points, after.points)
        assertEquals(before.distM, after.distM, 1e-9)
        assertEquals(before.movingSec, after.movingSec, 1e-9)
        assertTrue("replay speaks nothing, the cues were spoken the first time", spoken.isEmpty())

        // The first fix after the restart is a gap; the rows carry it, and a late fix is dropped whole.
        second.fix(fix(100, lat = 47.6 + 61 * 2.7e-5))            // 40 s later, one step on from where the run was
        second.fix(fix(99))                    // older than the last stored fix
        second.fix(fix(101).copy(lat = Double.NaN))
        val resumed = second.waitForPoints(61).live!!
        assertTrue(resumed.points >= 61)
        val rows = c.database.runFixDao().fixes((second.state.value as RunState.Active).run.id)
        assertEquals(61, rows.size)
        assertEquals(listOf(100L), rows.filter { it.gap == 1 }.map { (it.tMs - start) / 1000 })
        assertEquals("the advance is stored with the fix it followed", 1, rows.sumOf { it.advances })

        // Finish: the totals are what the live screen showed at the last fix.
        second.finish()
        val done = withTimeout(30_000) { second.state.first { it is RunState.Finished } as RunState.Finished }
        assertEquals(resumed.distM, done.result.distanceM, 1e-6)
        listening.cancel()
        c.database.close()
    }

    @Test
    fun aFinishedRunStaysOnItsSummaryUntilItIsSavedAndNeverRecordsAgain() = runBlocking {
        val c = container()
        val first = recording(c)
        first.start("Test run", null)
        for (k in 1..30) first.fix(fix(k))
        first.waitForPoints(30)
        first.finish()
        withTimeout(30_000) { first.state.first { it is RunState.Finished } }
        assertFalse("a run on its Summary is not a run to record", first.needsService())
        assertNotNull(c.database.metaDao().get(MetaKeys.RUN_ACTIVE))

        // The process dies on the Summary: the next one comes back to it, with the same distance, and not recording.
        val second = recording(c)
        second.attach()
        val summary = second.state.value as RunState.Finished
        assertEquals((first.state.value as RunState.Finished).result.distanceM, summary.result.distanceM, 1e-9)
        second.fix(fix(50))
        second.attach()                           // queued behind the fix on the same actor, so the fix has been handled when this returns
        assertEquals("a fix after Finish is dropped", 30, c.database.runFixDao().fixes(summary.run.id).size)

        // Save writes the session under the run's id and closes the record; a later look finds nothing to resume.
        second.save(srpe = 6.0)
        val saved = c.database.runSessionDao().row(summary.run.id)!!
        assertEquals(6.0, saved.srpe!!, 0.0)
        assertEquals(summary.result.distanceM, saved.distanceM, 1e-9)
        assertNull(c.database.metaDao().get(MetaKeys.RUN_ACTIVE))
        val third = recording(c)
        third.attach()
        assertEquals(RunState.Idle, third.state.value)
        assertEquals("the fixes stay for the map", 30, c.database.runFixDao().fixes(summary.run.id).size)
        c.database.close()
    }

    @Test
    fun aHeartRateSampleThatArrivesAfterTheFixWasTakenStillRidesOnIt() = runBlocking {
        val c = container()
        var clock = start
        val r = RunRecording(c.database, c.runs, scope, now = { clock })
        r.start("Test run", null)
        clock = start + 10_000                    // the phone is now ten seconds in: the strap reports, then the fix of second 8 is delivered
        r.heartRate(150)
        r.fix(fix(8))
        r.fix(fix(60))                            // a minute on, the old sample no longer counts
        r.waitForPoints(2)
        val rows = c.database.runFixDao().fixes((r.state.value as RunState.Active).run.id)
        assertEquals(listOf(150.0, null), rows.map { it.hr })
        c.database.close()
    }

    @Test
    fun aPausedRunDropsFixesAndTheFirstFixAfterResumeIsAGap() = runBlocking {
        val c = container()
        val r = recording(c)
        r.start("Test run", null)
        for (k in 1..10) r.fix(fix(k))
        r.waitForPoints(10)
        r.pause()
        delay(300)
        for (k in 11..40) r.fix(fix(k))
        r.resume()
        r.fix(fix(41, lat = 47.6 + 11 * 2.7e-5))
        r.waitForPoints(11)
        val id = (r.state.value as RunState.Active).run.id
        val rows = c.database.runFixDao().fixes(id)
        assertEquals("nothing was stored while paused", 11, rows.size)
        assertEquals(listOf(41L), rows.filter { it.gap == 1 }.map { (it.tMs - start) / 1000 })
        c.database.close()
    }

    @Test
    fun aRunThatWasSavedJustBeforeTheProcessDiedIsNotResumed() = runBlocking {
        val c = container()
        val r = recording(c)
        r.start("Test run", null)
        for (k in 1..20) r.fix(fix(k))
        r.waitForPoints(20)
        val id = (r.state.value as RunState.Active).run.id
        // The session was written, but the key was not cleared before the process died.
        c.runs.saveRun(com.qala.data.repo.NewRun(id = id, startedAtMs = start, distanceM = 50.0, elapsedSec = 20.0))
        val next = recording(c)
        next.attach()
        assertEquals(RunState.Idle, next.state.value)
        assertNull(c.database.metaDao().get(MetaKeys.RUN_ACTIVE))
        c.database.close()
    }
}
