package com.qala.app.workout

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.qala.app.MainActivity
import com.qala.app.R
import com.qala.data.model.RestAlert
import java.util.concurrent.atomic.AtomicInteger

/*
 * The rest-end notification (D34). The alarm belongs to the OS, so it fires when the process is gone; the rest itself is in
 * the workout draft, so Rest comes back where it was. The store schedules one alarm per running rest and cancels it when
 * the rest ends. The notification shows only while the app is not on screen: inside the app, Rest has its own buzz.
 */

/** The OS side of a rest: one alarm at a time. */
interface RestAlarm {
    /** Wakes at [atMs] (UTC epoch ms) with a notification saying [text]; replaces any alarm already set. */
    fun schedule(atMs: Long, alert: RestAlert, text: String)

    fun cancel()

    /** Nothing: the default for a container that has no Android context (tests, previews). */
    object None : RestAlarm {
        override fun schedule(atMs: Long, alert: RestAlert, text: String) {}
        override fun cancel() {}
    }
}

/** How many of the app's activities are started, so the receiver knows whether the lifter is looking at the app. */
object AppVisibility {
    private val started = AtomicInteger(0)
    val visible: Boolean get() = started.get() > 0
    fun onStart() { started.incrementAndGet() }
    fun onStop() { started.updateAndGet { (it - 1).coerceAtLeast(0) } }
}

class AndroidRestAlarm(context: Context) : RestAlarm {
    private val context = context.applicationContext
    private val alarms = this.context.getSystemService(AlarmManager::class.java)

    private fun intent(alert: RestAlert? = null, text: String? = null) = Intent(context, RestAlarmReceiver::class.java).apply {
        if (alert != null) putExtra(RestAlarmReceiver.EXTRA_ALERT, alert.wire)
        if (text != null) putExtra(RestAlarmReceiver.EXTRA_TEXT, text)
    }

    override fun schedule(atMs: Long, alert: RestAlert, text: String) {
        val pending = PendingIntent.getBroadcast(context, REQUEST, intent(alert, text), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        try {
            // USE_EXACT_ALARM is granted at install, so this is the usual path; the inexact alarm is for a build that lacks it.
            if (alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
        } catch (e: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
        }
    }

    override fun cancel() {
        PendingIntent.getBroadcast(context, REQUEST, intent(), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE)?.let {
            alarms.cancel(it)
            it.cancel()
        }
    }

    private companion object {
        const val REQUEST = 1
    }
}

/** Posts the rest-over notification unless the app is on screen. */
class RestAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (AppVisibility.visible) return
        val alert = RestAlert.of(intent.getStringExtra(EXTRA_ALERT))
        RestNotification.post(context, alert, intent.getStringExtra(EXTRA_TEXT).orEmpty())
    }

    companion object {
        const val EXTRA_ALERT = "qala.alert"
        const val EXTRA_TEXT = "qala.text"
    }
}

object RestNotification {
    private const val ID = 7001

    /**
     * One channel per alert, because a channel's sound and vibration cannot be changed once it exists: the setting picks the
     * channel instead.
     */
    private fun channelId(alert: RestAlert) = "rest-${alert.wire}"

    private fun ensureChannels(manager: NotificationManager) {
        RestAlert.entries.forEach { alert ->
            val name = when (alert) {
                RestAlert.Vibrate -> "Rest timer, vibrate"
                RestAlert.Sound -> "Rest timer, sound"
                RestAlert.Both -> "Rest timer, sound and vibrate"
            }
            manager.createNotificationChannel(
                NotificationChannel(channelId(alert), name, NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Tells you the rest is over while Qala is in the background."
                    enableVibration(alert != RestAlert.Sound)
                    if (alert == RestAlert.Vibrate) setSound(null, null)
                },
            )
        }
    }

    fun post(context: Context, alert: RestAlert, text: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        ensureChannels(manager)
        val open = PendingIntent.getActivity(
            context, 2,
            Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_REST, true),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(context, channelId(alert))
            .setSmallIcon(R.drawable.ic_stat_rest)
            .setContentTitle("Rest is over")
            .setContentText(text)
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        manager.notify(ID, notification)
    }

    fun clear(context: Context) = context.getSystemService(NotificationManager::class.java).cancel(ID)
}
