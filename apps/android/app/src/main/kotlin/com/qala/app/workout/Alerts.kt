package com.qala.app.workout

import android.content.Context
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import com.qala.data.model.RestAlert

/**
 * What the app does in the hand when a timer says something (S45): the warning a few seconds before a rest ends is one short buzz
 * and a soft tick, the end follows the Alert setting (a buzz, the notification sound, or both). The haptic goes through the view,
 * so no VIBRATE permission is asked for. These only run while the app is on screen; out of it the notifications do the same.
 */
class Alerts(private val context: Context, private val haptic: HapticFeedback) {
    /** One short buzz and a soft tick. */
    fun warn() {
        haptic.performHapticFeedback(HapticFeedbackType.Confirm)
        tick()
    }

    /** The end of a rest, or of the cardio countdown, as the Alert setting says. */
    fun over(alert: RestAlert) {
        if (alert != RestAlert.Sound) haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        if (alert != RestAlert.Vibrate) RingtoneManager.getRingtone(context, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))?.play()
    }

    private fun tick() {
        try {
            val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, TickVolume)
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, TickMs)
            Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, TickMs + 100L)
        } catch (e: RuntimeException) {
            // No tone to play on this device: the buzz was the warning.
        }
    }

    private companion object {
        const val TickVolume = 30
        const val TickMs = 60
    }
}
