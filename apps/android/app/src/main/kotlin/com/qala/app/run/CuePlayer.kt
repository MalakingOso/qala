package com.qala.app.run

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.qala.data.core.RunEvent
import com.qala.data.core.RunExpandedStep
import com.qala.data.core.RunStepKind
import com.qala.data.model.WeightUnit
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt


/**
 * What a run says for [event], or null for the events that stay quiet (a step ending, which the next step's start covers). Speech
 * only, one short line each: distance and time marks give the distance, the moving time and the average pace; a step start gives
 * its kind and target; speed up, slow down and back in zone one line each; the end of a workout one line. Pure, so the words are
 * tested without a phone.
 */
fun cueText(event: RunEvent, unit: WeightUnit): String? = when (event) {
    is RunEvent.DistanceCue -> marker(event.distM, event.movingSec, event.avgPaceSecPerM, unit)
    is RunEvent.TimeCue -> marker(event.distM, event.movingSec, event.avgPaceSecPerM, unit)
    is RunEvent.StepStart -> stepStart(event.step, unit)
    is RunEvent.StepEnd -> null
    RunEvent.WorkoutComplete -> "Workout complete."
    is RunEvent.SpeedUp -> "Speed up a little."
    is RunEvent.SlowDown -> "Slow down a little."
    is RunEvent.BackInZone -> "Back in the zone."
}

private fun marker(distM: Double, movingSec: Double, avgPaceSecPerM: Double?, unit: WeightUnit): String {
    val parts = mutableListOf(spokenDistance(distM, unit), "Time ${spokenDuration(movingSec)}.")
    if (avgPaceSecPerM != null && avgPaceSecPerM.isFinite() && avgPaceSecPerM > 0) {
        parts += "Average pace ${spokenDuration(avgPaceSecPerM * unitM(unit))} per ${unitWord(unit)}."
    }
    return parts.joinToString(" ")
}

private fun stepStart(step: RunExpandedStep, unit: WeightUnit): String {
    val kind = when (step.kind) {
        RunStepKind.Warmup -> "Warm-up"
        RunStepKind.Work -> "Work"
        RunStepKind.Recover -> "Recover"
        RunStepKind.Cooldown -> "Cool-down"
    }
    val amount = step.seconds?.let { spokenDuration(it) } ?: step.distanceM?.let { spokenDistanceAmount(it, unit) }
    val target = step.targetMps?.takeIf { it > 0 }?.let { ", target pace ${spokenDuration(unitM(unit) / it)} per ${unitWord(unit)}" }.orEmpty()
    return "$kind${amount?.let { ", $it" }.orEmpty()}$target."
}

private fun unitWord(unit: WeightUnit) = if (unit == WeightUnit.Kg) "kilometre" else "mile"

private fun number(v: Double): String {
    val r = (v * 100).roundToInt() / 100.0
    return if (r == floor(r)) r.toInt().toString() else r.toString().trimEnd('0')
}

private fun spokenDistanceAmount(distM: Double, unit: WeightUnit): String {
    val v = distM / unitM(unit)
    return if (v >= 0.1) "${number(v)} ${unitWord(unit)}${if (number(v) == "1") "" else "s"}" else "${distM.roundToInt()} metres"
}

private fun spokenDistance(distM: Double, unit: WeightUnit) = spokenDistanceAmount(distM, unit).replaceFirstChar { it.uppercase() } + "."

/** "9 minutes 12 seconds", "45 seconds", "1 hour 2 minutes". */
fun spokenDuration(seconds: Double): String {
    val total = seconds.roundToInt().coerceAtLeast(0)
    val h = total / 3600
    val m = total % 3600 / 60
    val s = total % 60
    fun unit(n: Int, word: String) = "$n $word${if (n == 1) "" else "s"}"
    return when {
        h > 0 -> listOfNotNull(unit(h, "hour"), m.takeIf { it > 0 }?.let { unit(it, "minute") }).joinToString(" ")
        m > 0 -> listOfNotNull(unit(m, "minute"), s.takeIf { it > 0 }?.let { unit(it, "second") }).joinToString(" ")
        else -> unit(s, "second")
    }
}

/**
 * Speaks the cues, over the music rather than instead of it: a transient may-duck audio focus is taken before each cue and
 * given back when it ends, with the navigation-guidance usage. When Android refuses the focus (Android 17 refuses it to a
 * background app that has no while-in-use foreground service, and the cue would be silent anyway) the cue is skipped. If
 * the phone has no speech engine, or it does not start, the player says nothing and the run goes on.
 */
class CuePlayer(context: Context) {
    private val audio = context.applicationContext.getSystemService(AudioManager::class.java)
    private var ready = false
    private var focus: AudioFocusRequest? = null
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            tts().language = Locale.getDefault()
            tts().setAudioAttributes(attributes)
            tts().setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) = release()
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) = release()
                override fun onError(utteranceId: String?, errorCode: Int) = release()
            })
        } else {
            Log.w(TAG, "no speech engine: cues stay silent ($status)")
        }
    }

    private fun tts() = tts

    fun speak(text: String) {
        if (!ready) return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setWillPauseWhenDucked(false)
            .build()
        if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            Log.w(TAG, "audio focus refused: cue skipped")
            return
        }
        focus = request
        if (tts.speak(text, TextToSpeech.QUEUE_ADD, null, "cue") != TextToSpeech.SUCCESS) release()
    }

    private fun release() {
        focus?.let { audio.abandonAudioFocusRequest(it) }
        focus = null
    }

    fun shutdown() {
        release()
        tts.shutdown()
    }

    private companion object {
        const val TAG = "CuePlayer"
    }
}
