package com.qala.data

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.qala.data.core.RunCueOptions
import com.qala.data.core.RunEvent
import com.qala.data.core.RunFix
import com.qala.data.core.RunOpts
import com.qala.data.core.RunRecorder
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Replays the committed 2 h track (testdata/golden/run/process_run_2h.json, 7,200 fixes at 1 Hz, copied
 * into the test assets by :data:copyRunVectors) through the native library, one fix per call, the way
 * the foreground service does. Checks it against the TS result and that no cue is missed, and logs the
 * per-push time (tag "RunRecorderPerf"). The under-1 ms-per-push gate for the phone itself waits for the
 * phone pass (D15); an emulator number stands in until then.
 */
@RunWith(AndroidJUnit4::class)
class RunRecorderInstrumentedTest {
    private val case by lazy {
        val text = InstrumentationRegistry.getInstrumentation().context.assets.open("process_run_2h.json")
            .bufferedReader().use { it.readText() }
        QalaJson.parseToJsonElement(text).jsonObject["cases"]!!.jsonArray.first().jsonObject
    }

    private val fixes: List<RunFix> by lazy {
        QalaJson.decodeFromJsonElement(ListSerializer(RunFix.serializer()), case["input"]!!.jsonObject["fixes"]!!)
    }

    private val opts: RunOpts by lazy {
        QalaJson.decodeFromJsonElement(RunOpts.serializer(), case["input"]!!.jsonObject["opts"]!!)
    }

    /** Bionic's libm is not glibc's or V8's; the vectors agree to 1e-9 on the host, so allow a margin here. */
    private fun assertClose(actual: Double, expected: Double, what: String) {
        val tol = 1e-6 * maxOf(1.0, kotlin.math.abs(expected))
        assertTrue("$what: $actual vs $expected", kotlin.math.abs(actual - expected) <= tol)
    }

    @Test
    fun twoHourReplayMatchesTheTsRunWithNoCueGap() {
        val expected = case["expected"]!!.jsonObject
        val cues = RunOpts(
            filter = opts.filter, autopause = opts.autopause, splits = opts.splits, splitM = opts.splitM,
            workout = opts.workout, guided = opts.guided,
            cues = RunCueOptions(everyDistM = 1609.344, everySec = 300.0),
        )
        val micros = LongArray(fixes.size)
        val distMarks = mutableListOf<Long>()
        val timeMarks = mutableListOf<Long>()
        val guidedPushed = mutableListOf<RunEvent>()
        RunRecorder(cues).use { rec ->
            fixes.forEachIndexed { i, fix ->
                val t0 = System.nanoTime()
                val r = rec.pushFix(fix)
                micros[i] = (System.nanoTime() - t0) / 1000
                for (e in r.events) when (e) {
                    is RunEvent.DistanceCue -> distMarks += e.n
                    is RunEvent.TimeCue -> timeMarks += e.n
                    else -> guidedPushed += e
                }
            }
            val run = rec.finish()
            assertEquals(expected["points"]!!.jsonArray.size, run.points.size)
            assertEquals(expected["paused"]!!.jsonArray.size, run.paused.size)
            assertEquals(expected["splits"]!!.jsonArray.size, run.splits.size)
            assertEquals(expected["guidedEvents"]!!.jsonArray.size, run.guidedEvents.size)
            assertEquals(guidedPushed, run.guidedEvents)
            assertClose(run.distanceM, expected["distanceM"]!!.jsonPrimitive.content.toDouble(), "distance")
            assertClose(run.movingSec, expected["movingSec"]!!.jsonPrimitive.content.toDouble(), "moving time")
            // Every mile and every five minutes was read out once, in order: no gap.
            assertEquals((1..(run.distanceM / 1609.344).toLong()).toList(), distMarks)
            assertEquals(timeMarks.indices.map { it + 1L }, timeMarks)
            assertTrue("two real hours of cues: ${timeMarks.size}", timeMarks.size >= 18)
        }
        micros.sort()
        val mean = micros.average()
        Log.i("RunRecorderPerf", "7,200 pushes: mean ${"%.1f".format(mean)} us, p50 ${micros[micros.size / 2]} us, " +
            "p99 ${micros[micros.size * 99 / 100]} us, max ${micros.last()} us")
        assertTrue("mean push ${mean} us", mean < 1000.0)
    }

    @Test
    fun aKilledServiceResumesByReplayingTheStoredFixes() {
        // Recovery: the process dies after the first half, so a new recorder replays the stored fixes
        // (those and the ones that arrive after the restart). Same guided events, same result.
        val live = RunRecorder(opts).use { rec ->
            fixes.forEach(rec::pushFix)
            rec.finish()
        }
        val replayed = RunRecorder(opts).use { rec ->
            fixes.take(fixes.size / 2).forEach(rec::pushFix) // the stored half
            fixes.drop(fixes.size / 2).forEach(rec::pushFix) // then the live fixes
            rec.finish()
        }
        assertEquals(live, replayed)
    }
}
