package com.qala.data.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import uniffi.qala_ffi.RunRecorder as FfiRunRecorder
import uniffi.qala_ffi.processRun as ffiProcessRun

// ---- run pipeline (qala-core run/; docs/rust-core.md R1) ----
// The TS pipeline in packages/run stays the oracle; these DTOs are the Kotlin face of the Rust port,
// checked against it by testdata/golden/run. Distances are metres, times seconds, speeds m/s.

/** One raw GPS fix. [t] is seconds on the fix source's own clock (elapsedRealtimeNanos), never callback time. */
@Serializable
data class RunFix(
    val t: Double,
    val lat: Double,
    val lon: Double,
    /** Horizontal accuracy in metres (Android's 68% radius). */
    val acc: Double,
    val hr: Double? = null,
    val cad: Double? = null,
    val ele: Double? = null,
)

@Serializable
data class RunFilterOptions(
    val accuracyGateM: Double? = null,
    val speedGateMps: Double? = null,
    val reanchorCount: Int? = null,
    val accelNoise: Double? = null,
)

@Serializable
data class RunAutoPauseOptions(
    val lowMps: Double? = null,
    val lowHoldSec: Double? = null,
    val highMps: Double? = null,
    val highHoldSec: Double? = null,
)

@Serializable
data class RunSplitOptions(val splitM: Double? = null, val minPartialM: Double? = null)

@Serializable
data class RunGuidedOptions(val toleranceMps: Double? = null, val promptCooldownSec: Double? = null)

/** Periodic audio cues. Metres and moving seconds: the app converts the user's 0.5 or 1 mile setting. */
@Serializable
data class RunCueOptions(val everyDistM: Double? = null, val everySec: Double? = null)

@Serializable
enum class RunStepKind {
    @SerialName("warmup") Warmup,
    @SerialName("work") Work,
    @SerialName("recover") Recover,
    @SerialName("cooldown") Cooldown,
}

@Serializable
data class RunWorkoutStep(
    val kind: RunStepKind,
    val distanceM: Double? = null,
    val seconds: Double? = null,
    val targetMps: Double? = null,
    val paceLoMps: Double? = null,
    val paceHiMps: Double? = null,
    val hrZone: Double? = null,
    val repeat: Double? = null,
)

@Serializable
data class RunWorkoutSpec(val steps: List<RunWorkoutStep>)

/** Everything optional; the defaults are the documented values. */
@Serializable
data class RunOpts(
    val filter: RunFilterOptions? = null,
    val autopause: RunAutoPauseOptions? = null,
    val splits: RunSplitOptions? = null,
    /** Shorthand that wins over [splits]`.splitM`. Default one mile. */
    val splitM: Double? = null,
    val workout: RunWorkoutSpec? = null,
    val guided: RunGuidedOptions? = null,
    val cues: RunCueOptions? = null,
)

/** A workout step after repeat expansion, as the events carry it. */
@Serializable
data class RunExpandedStep(
    val kind: RunStepKind,
    val distanceM: Double? = null,
    val seconds: Double? = null,
    val targetMps: Double? = null,
    val paceLoMps: Double? = null,
    val paceHiMps: Double? = null,
    val hrZone: Double? = null,
    val repeat: Double? = null,
    val index: Int,
)

/** What the phone speaks or shows: guided-workout events and the periodic cues, one `type` discriminator. */
@Serializable
sealed interface RunEvent {
    @Serializable @SerialName("stepStart")
    data class StepStart(val stepIndex: Int, val step: RunExpandedStep) : RunEvent

    @Serializable @SerialName("stepEnd")
    data class StepEnd(val stepIndex: Int) : RunEvent

    @Serializable @SerialName("workoutComplete")
    data object WorkoutComplete : RunEvent

    @Serializable @SerialName("speedUp")
    data class SpeedUp(val stepIndex: Int, val cueSpeedMps: Double) : RunEvent

    @Serializable @SerialName("slowDown")
    data class SlowDown(val stepIndex: Int, val cueSpeedMps: Double) : RunEvent

    @Serializable @SerialName("backInZone")
    data class BackInZone(val stepIndex: Int, val cueSpeedMps: Double) : RunEvent

    /** The [n]th distance mark (every `everyDistM` metres). */
    @Serializable @SerialName("distanceCue")
    data class DistanceCue(val n: Long, val distM: Double, val movingSec: Double, val avgPaceSecPerM: Double? = null) : RunEvent

    /** The [n]th time mark (every `everySec` moving seconds). */
    @Serializable @SerialName("timeCue")
    data class TimeCue(val n: Long, val distM: Double, val movingSec: Double, val avgPaceSecPerM: Double? = null) : RunEvent
}

@Serializable
data class RunPace(val speedMps: Double, val paceSecPerM: Double)

@Serializable
data class RunStepRemaining(val distM: Double? = null, val sec: Double? = null)

@Serializable
data class RunLiveStep(val step: RunExpandedStep, val remaining: RunStepRemaining)

/** The numbers the Live screen shows, as of the last accepted fix. */
@Serializable
data class RunLive(
    val points: Int,
    val distM: Double,
    /** Moving seconds as known now: an auto-pause already takes its time out. */
    val movingSec: Double,
    val elapsedSec: Double,
    /** 20 s window pace; null while the window is under 5 s. */
    val current: RunPace? = null,
    /** 30 s window pace, the one the cues use. */
    val cue: RunPace? = null,
    val avg: RunPace? = null,
    val paused: Boolean,
    val step: RunLiveStep? = null,
    val workoutComplete: Boolean,
)

@Serializable
data class RunPushResult(val events: List<RunEvent>, val live: RunLive)

@Serializable
data class RunPoint(
    val t: Double,
    val lat: Double,
    val lon: Double,
    val speedMps: Double,
    val distM: Double,
    val acc: Double,
    val hr: Double? = null,
    val cad: Double? = null,
    val ele: Double? = null,
    /** True when the segment from the previous point spans a re-anchor jump and was not counted. */
    val gap: Boolean = false,
)

@Serializable
data class RunPause(val startT: Double, val endT: Double)

@Serializable
data class RunSplit(
    val index: Int,
    val distM: Double,
    val sec: Double,
    val cumDistM: Double,
    val cumSec: Double,
    val hrAvg: Double? = null,
)

/** The processed run: everything the Summary and the engine handoff need. */
@Serializable
data class ProcessedRun(
    val distanceM: Double,
    val movingSec: Double,
    val elapsedSec: Double,
    val avgSpeedMps: Double,
    val currentSpeedMps: Double? = null,
    val cueSpeedMps: Double? = null,
    val splits: List<RunSplit>,
    val paused: List<RunPause>,
    val points: List<RunPoint>,
    /** Guided events only; periodic cues are not part of the batch result. */
    val guidedEvents: List<RunEvent>,
)

@Serializable
private data class ProcessRunRequest(val fixes: List<RunFix>, val opts: RunOpts? = null)

@Serializable
private data class RecorderRequest(val opts: RunOpts? = null)

/** The whole pipeline over stored fixes (the Summary screen, a recomputation after a filter change). */
fun QalaCore.processRun(fixes: List<RunFix>, opts: RunOpts? = null): ProcessedRun = call(
    ProcessRunRequest.serializer(), ProcessedRun.serializer(), ProcessRunRequest(fixes, opts), ::ffiProcessRun,
)

/**
 * The live recorder behind the foreground service: push one fix at a time and get the events and live
 * numbers back. Each call is a JSON round trip of a few hundred bytes and costs microseconds in Rust.
 * Calls are serialised inside the library, but a recorder belongs to one run: use [close] (or `use { }`)
 * when the run is over.
 *
 * Recovery after a process kill: build a new recorder and push the stored fixes in order, then replay any
 * [advance] calls at the same points (they are not in the fixes, so the service persists them). The
 * guided clock is causal, so the replay gives the cues the live run gave.
 */
class RunRecorder(opts: RunOpts? = null) : AutoCloseable {
    private val ffi: FfiRunRecorder = FfiRunRecorder(QalaCore.request(RecorderRequest.serializer(), RecorderRequest(opts)))

    /** One raw fix; the events it produced and the live numbers. Throws `QalaException.Evaluation` after [finish]. */
    fun pushFix(fix: RunFix): RunPushResult = decode(RunPushResult.serializer(), ffi.pushFix(QalaCore.request(RunFix.serializer(), fix)))

    /** Ends the current guided step by hand (a step with no distance or time); no-op before the first fix. */
    fun advance(): RunPushResult = decode(RunPushResult.serializer(), ffi.advance())

    /** The batch result over everything pushed. Repeatable; pushing afterwards is an error. */
    fun finish(): ProcessedRun = decode(ProcessedRun.serializer(), ffi.finish())

    override fun close() = ffi.close()

    private fun <T> decode(serializer: kotlinx.serialization.KSerializer<T>, response: String): T =
        com.qala.data.QalaJson.decodeFromJsonElement(serializer, QalaCore.unwrap(response))
}
