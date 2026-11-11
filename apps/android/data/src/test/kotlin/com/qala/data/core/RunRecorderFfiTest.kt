package com.qala.data.core

import com.qala.data.QalaJson
import com.qala.data.TestRepo
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.qala_ffi.QalaException

/**
 * The run DTOs and the live recorder through the real Rust library (the host build). The cases are the
 * golden vectors from the TS pipeline (testdata/golden/run), so this proves the Kotlin shapes against the
 * same answers as the Rust port: a recorder fed fix by fix, and the batch call, reproduce the TS run.
 */
class RunRecorderFfiTest {
    private val vectors: JsonArray by lazy {
        TestRepo.json("testdata/golden/run/process_run.json").jsonObject["cases"]!!.jsonArray
    }

    private fun case(name: String): JsonObject =
        vectors.map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content == name }

    private fun fixesOf(case: JsonObject): List<RunFix> =
        QalaJson.decodeFromJsonElement(ListSerializer(RunFix.serializer()), case["input"]!!.jsonObject["fixes"]!!)

    private fun optsOf(case: JsonObject): RunOpts? =
        case["input"]!!.jsonObject["opts"]?.let { QalaJson.decodeFromJsonElement(RunOpts.serializer(), it) }

    private fun close(actual: Double, expected: Double) =
        assertEquals(expected, actual, 1e-9 * maxOf(1.0, kotlin.math.abs(expected)) + 1e-9)

    private val pipeline = "pipeline: 2 miles with a stop, guided tempo"

    @Test
    fun aRecorderFedFixByFixReproducesTheTsRun() {
        val c = case(pipeline)
        val expected = c["expected"]!!.jsonObject
        val guided = mutableListOf<RunEvent>()
        var last: RunLive? = null
        RunRecorder(optsOf(c)).use { rec ->
            for (fix in fixesOf(c)) {
                val r = rec.pushFix(fix)
                guided += r.events
                last = r.live
            }
            val run = rec.finish()
            assertEquals(expected["points"]!!.jsonArray.size, run.points.size)
            assertEquals(expected["paused"]!!.jsonArray.size, run.paused.size)
            assertEquals(expected["splits"]!!.jsonArray.size, run.splits.size)
            close(run.distanceM, expected["distanceM"]!!.jsonPrimitive.content.toDouble())
            close(run.movingSec, expected["movingSec"]!!.jsonPrimitive.content.toDouble())
            assertEquals(guided, run.guidedEvents)
            assertEquals(expected["guidedEvents"]!!.jsonArray.size, guided.size)
            // The live numbers at the last push are the run's.
            close(last!!.distM, run.distanceM)
            assertEquals(run.points.size, last!!.points)
            assertEquals(run.currentSpeedMps, last!!.current?.speedMps)
        }
    }

    @Test
    fun theBatchCallEqualsTheRecorder() {
        val c = case(pipeline)
        val batch = QalaCore.processRun(fixesOf(c), optsOf(c))
        val rec = RunRecorder(optsOf(c))
        rec.use { r -> fixesOf(c).forEach(r::pushFix) }
        assertEquals(batch, RunRecorder(optsOf(c)).use { r -> fixesOf(c).forEach(r::pushFix); r.finish() })
        val types = batch.guidedEvents.map { it::class.simpleName }
        assertTrue("StepStart" in types && "StepEnd" in types)
        assertEquals(RunEvent.StepStart::class, batch.guidedEvents.first()::class)
    }

    @Test
    fun liveNumbersAndTheCurrentStep() {
        val steps = listOf(
            RunWorkoutStep(RunStepKind.Warmup, seconds = 20.0),
            RunWorkoutStep(RunStepKind.Work, seconds = 30.0, paceLoMps = 2.9, paceHiMps = 3.1),
            RunWorkoutStep(RunStepKind.Cooldown),
        )
        RunRecorder(RunOpts(workout = RunWorkoutSpec(steps), cues = RunCueOptions(everyDistM = 100.0, everySec = 40.0))).use { rec ->
            val cueTypes = mutableListOf<String>()
            var last: RunLive? = null
            for (i in 0..90) {
                val r = rec.pushFix(RunFix(i.toDouble(), 47.6062 + 3.0 * i / 111319.49, -122.3321, 3.0))
                r.events.forEach { if (it is RunEvent.DistanceCue || it is RunEvent.TimeCue) cueTypes += it::class.simpleName!! }
                if (i == 2) assertNull("under 5 s there is no pace", r.live.current)
                last = r.live
            }
            val live = last!!
            assertNotNull(live.current)
            assertEquals(3.0, live.current!!.speedMps, 0.05)
            assertEquals(false, live.paused)
            assertEquals(2, live.step!!.step.index)
            assertEquals(RunStepKind.Cooldown, live.step!!.step.kind)
            assertNull("an open-ended step has nothing left to count", live.step!!.remaining.sec)
            // 3 m/s for 90 s: the 100 m mark (~34 s), 40 s, the 200 m mark (~67 s), 80 s.
            assertEquals(listOf("DistanceCue", "TimeCue", "DistanceCue", "TimeCue"), cueTypes)
            val done = rec.advance()
            assertTrue(done.events.contains(RunEvent.WorkoutComplete))
            assertTrue(done.live.workoutComplete)
            assertNull(done.live.step)
        }
    }

    @Test
    fun badInputAndPushingAfterFinishAreErrors() {
        assertThrows(QalaException.InvalidInput::class.java) { RunRecorder(RunOpts(splitM = 0.5)) }
        assertThrows(QalaException.InvalidInput::class.java) { RunRecorder(RunOpts(filter = RunFilterOptions(reanchorCount = 0))) }
        assertThrows(QalaException.InvalidInput::class.java) { RunRecorder(RunOpts(cues = RunCueOptions(everySec = -1.0))) }
        RunRecorder().use { rec ->
            rec.pushFix(RunFix(1.0, 47.6, -122.3, 4.0))
            val run = rec.finish()
            assertEquals(1, run.points.size)
            assertEquals(run, rec.finish())
            assertThrows(QalaException.Evaluation::class.java) { rec.pushFix(RunFix(2.0, 47.6, -122.3, 4.0)) }
            assertThrows(QalaException.Evaluation::class.java) { rec.advance() }
        }
        // JSON cannot carry NaN, so the encoder refuses it before the library sees it.
        assertThrows(kotlinx.serialization.SerializationException::class.java) {
            RunRecorder().use { it.pushFix(RunFix(Double.NaN, 47.6, -122.3, 4.0)) }
        }
    }

    @Test
    fun aDroppedFixIsNotAnError() {
        RunRecorder().use { rec ->
            val bad = rec.pushFix(RunFix(1.0, 47.6, -122.3, 90.0))
            assertEquals(0, bad.live.points)
            assertEquals(1, rec.pushFix(RunFix(2.0, 47.6, -122.3, 4.0)).live.points)
        }
    }
}
