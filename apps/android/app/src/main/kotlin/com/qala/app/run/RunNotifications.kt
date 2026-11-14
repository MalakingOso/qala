package com.qala.app.run

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.qala.app.MainActivity
import com.qala.app.R

/** The two notifications of a run: the quiet one while it records, and the one that asks for a tap when it could not carry on. */
object RunNotifications {
    const val RecordingId = 7101
    const val PausedId = 7102
    private const val RecordingChannel = "run-recording"
    private const val PausedChannel = "run-paused"

    private fun open(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 3, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun manager(context: Context): NotificationManager = context.getSystemService(NotificationManager::class.java)

    /** Low importance, no actions: a tap opens the app. */
    fun recording(context: Context): Notification {
        manager(context).createNotificationChannel(
            NotificationChannel(RecordingChannel, "Run recording", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while Qala records a run."
            },
        )
        return Notification.Builder(context, RecordingChannel)
            .setSmallIcon(R.drawable.ic_stat_rest)
            .setContentTitle("Qala is recording your run")
            .setContentText("GPS active. Thanks for leaving the screen locked.")
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setContentIntent(open(context))
            .build()
    }

    /** The service could not go on in the background (Android refused it); the run is kept and a tap puts it back. */
    fun postPaused(context: Context) {
        val m = manager(context)
        m.createNotificationChannel(NotificationChannel(PausedChannel, "Run paused", NotificationManager.IMPORTANCE_HIGH))
        m.notify(
            PausedId,
            Notification.Builder(context, PausedChannel)
                .setSmallIcon(R.drawable.ic_stat_rest)
                .setContentTitle("Run paused")
                .setContentText("Tap to keep recording.")
                .setCategory(Notification.CATEGORY_ERROR)
                .setContentIntent(open(context))
                .setAutoCancel(true)
                .build(),
        )
    }

    fun clearPaused(context: Context) = manager(context).cancel(PausedId)
}
