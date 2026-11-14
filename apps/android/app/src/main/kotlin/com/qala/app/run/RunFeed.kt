package com.qala.app.run

import com.qala.data.core.ProcessedRun
import com.qala.data.core.RunFix
import com.qala.data.core.RunLive
import com.qala.data.core.RunOpts
import com.qala.data.core.RunPushResult
import com.qala.data.core.RunRecorder

/**
 * The Rust recorder fed with the dead time cut out (docs/android-native.md section 5, Gap marking). Every fix keeps its real
 * time `tMs`; the recorder is given `t = (tMs - startedAtMs - cutMs) / 1000`, where `cutMs` is the time the run was not
 * recording (a pause, a killed service) less the one second a normal step takes. So the pace windows, auto-pause and splits
 * see an unbroken stream and a resume never reads as "speed up", while a position that jumped while the phone was not
 * recording fails the speed gate and, after three fixes, is re-anchored by the filter without counting any distance.
 *
 * Pure: no Android, no storage. [RunRecording] feeds it live and replays the stored fixes through it after a kill, which is
 * why the replay and the live run give the same numbers.
 */
class RunFeed(opts: RunOpts?, private val startedAtMs: Long) : AutoCloseable {
    private val recorder = RunRecorder(opts)
    private var prevTMs: Long? = null

    /** Milliseconds of the run that were not recorded. */
    var cutMs: Long = 0
        private set

    /** The numbers after the last fix that went through, null before the first. */
    var live: RunLive? = null
        private set

    /**
     * Pushes one fix. [gap] marks the first fix after a pause or a restart. Returns what it produced, or null when the recorder
     * refused it (the caller treats the fix as not there, in the replay as in the live run).
     */
    fun push(tMs: Long, lat: Double, lon: Double, acc: Double, hr: Double?, ele: Double?, gap: Boolean): RunPushResult? {
        val prev = prevTMs
        if (gap && prev != null) cutMs += (tMs - prev - STEP_MS).coerceAtLeast(0)
        val t = (tMs - startedAtMs - cutMs) / 1000.0
        val result = try {
            recorder.pushFix(RunFix(t, lat, lon, acc, hr = hr, ele = ele))
        } catch (e: Exception) {
            return null
        }
        prevTMs = tMs
        live = result.live
        return result
    }

    /** Ends the current guided step by hand. */
    fun advance(): RunPushResult? = try {
        recorder.advance().also { live = it.live }
    } catch (e: Exception) {
        null
    }

    /** The batch result over everything pushed, with the recorder's own clock (the cut time is not in it). */
    fun finish(): ProcessedRun = recorder.finish()

    /** The elapsed time of the whole run: the recorder's, plus the time it was not recording. */
    fun elapsedSec(run: ProcessedRun): Double = run.elapsedSec + cutMs / 1000.0

    override fun close() = recorder.close()

    companion object {
        /** The step between two fixes at 1 Hz: what a gap still counts for after the dead time is cut. */
        const val STEP_MS = 1000L
    }
}
