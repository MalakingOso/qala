package com.qala.app.workout

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import com.qala.app.MainActivity
import com.qala.app.R
import com.qala.data.model.RestAlert
import java.util.concurrent.atomic.AtomicInteger

/*
 * The notifications and alarms around a workout (D34, S45). The alarms belong to the OS, so they fire when the process is gone; the
 * rest itself is in the workout draft, so Rest comes back where it was. The store sets two alarms per running rest, the warning a few
 * seconds before the end and the end, and drops both when the rest ends. A third thing is not an alarm: one ongoing notification
 * for the whole workout, which shows the rest as a system chronometer counting down (and the elapsed time counting up the rest of
 * the time), so it keeps running with nothing of ours alive. No foreground service holds any of it. The alerts show only while the app
 * is not on screen: inside the app the shell buzzes instead.
 */

/** What the OS needs to know about a running rest to say, with the process gone, that it is nearly over and then over. */
data class RestAlarmPlan(
    val endAtMs: Long,
    /** When the warning fires and how many seconds before the end that is; null when the warning is off or the rest is shorter than it. */
    val warnAtMs: Long?,
    val warnSec: Int,
    val alert: RestAlert,
    /** What the end alert says: "Next: Back squat, set 3". */
    val endText: String,
    /** The ongoing notification as it should read once the rest is over: the clock counting up with the set the logger is on. */
    val afterEnd: WorkoutNotice,
)

/** The OS side of a rest: one end alarm and one warning alarm at a time. */
interface RestAlarm {
    /** Sets both alarms for [plan], replacing any already set. */
    fun schedule(plan: RestAlarmPlan)

    fun cancel()

    /** Wakes at [atMs] to say the warm-up's cardio countdown is over, as [alert] says; replaces the one already set. */
    fun scheduleCardio(atMs: Long, alert: RestAlert)

    fun cancelCardio()

    /** Nothing: the default for a container that has no Android context (tests, previews). */
    object None : RestAlarm {
        override fun schedule(plan: RestAlarmPlan) {}
        override fun cancel() {}
        override fun scheduleCardio(atMs: Long, alert: RestAlert) {}
        override fun cancelCardio() {}
    }
}

/** The one ongoing notification of a workout, from its first warm-up action or its opening to its finish or discard. */
interface WorkoutNotifier {
    /** Shows [notice], replacing the one showing; null takes the notification down. */
    fun update(notice: WorkoutNotice?)

    /** Nothing: the default for a container that has no Android context. */
    object None : WorkoutNotifier {
        override fun update(notice: WorkoutNotice?) {}
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

    private fun intent(kind: String) = Intent(context, RestAlarmReceiver::class.java).apply { putExtra(RestAlarmReceiver.EXTRA_KIND, kind) }

    // Two alarms need two request codes: a PendingIntent is told apart by its code and its intent's action and data, never by its extras.
    private fun pending(kind: String, request: Int, flags: Int, fill: Intent.() -> Unit = {}) =
        PendingIntent.getBroadcast(context, request, intent(kind).apply(fill), PendingIntent.FLAG_IMMUTABLE or flags)

    override fun schedule(plan: RestAlarmPlan) {
        val end = pending(RestAlarmReceiver.END, REQUEST_END, PendingIntent.FLAG_UPDATE_CURRENT) {
            putExtra(RestAlarmReceiver.EXTRA_ALERT, plan.alert.wire)
            putExtra(RestAlarmReceiver.EXTRA_TEXT, plan.endText)
            putExtra(RestAlarmReceiver.EXTRA_TITLE, plan.afterEnd.title)
            putExtra(RestAlarmReceiver.EXTRA_SET, plan.afterEnd.text)
            putExtra(RestAlarmReceiver.EXTRA_FROM, plan.afterEnd.countUpFromMs)
        }
        set(plan.endAtMs, end)
        if (plan.warnAtMs != null) {
            val warn = pending(RestAlarmReceiver.WARN, REQUEST_WARN, PendingIntent.FLAG_UPDATE_CURRENT) { putExtra(RestAlarmReceiver.EXTRA_SECONDS, plan.warnSec) }
            set(plan.warnAtMs, warn)
        } else {
            drop(RestAlarmReceiver.WARN, REQUEST_WARN)
        }
    }

    private fun set(atMs: Long, pending: PendingIntent) {
        try {
            // USE_EXACT_ALARM is granted at install, so this is the usual path; the inexact alarm is for a build that lacks it.
            if (alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
        } catch (e: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
        }
    }

    private fun drop(kind: String, request: Int) {
        pending(kind, request, PendingIntent.FLAG_NO_CREATE)?.let {
            alarms.cancel(it)
            it.cancel()
        }
    }

    override fun cancel() {
        drop(RestAlarmReceiver.END, REQUEST_END)
        drop(RestAlarmReceiver.WARN, REQUEST_WARN)
    }

    // The cardio countdown runs on a bike with the screen off: only an alarm can say it is over then.
    override fun scheduleCardio(atMs: Long, alert: RestAlert) {
        set(atMs, pending(RestAlarmReceiver.CARDIO, REQUEST_CARDIO, PendingIntent.FLAG_UPDATE_CURRENT) { putExtra(RestAlarmReceiver.EXTRA_ALERT, alert.wire) })
    }

    override fun cancelCardio() = drop(RestAlarmReceiver.CARDIO, REQUEST_CARDIO)

    private companion object {
        const val REQUEST_END = 1
        const val REQUEST_WARN = 3
        const val REQUEST_CARDIO = 5
    }
}

/** The ongoing notification, posted by the store while the process is alive. */
class AndroidWorkoutNotifier(context: Context) : WorkoutNotifier {
    private val context = context.applicationContext

    override fun update(notice: WorkoutNotice?) {
        if (notice == null) WorkoutNotification.cancel(context) else WorkoutNotification.post(context, notice)
    }
}

/**
 * Fires for the two alarms. The warning posts a short-lived alerting notification, unless the app is on screen. The end flips the
 * ongoing notification from counting down to counting up, always, and posts the "Rest is over" alert unless the app is on screen.
 */
class RestAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getStringExtra(EXTRA_KIND)) {
            WARN -> if (!AppVisibility.visible) RestNotification.postWarning(context, intent.getIntExtra(EXTRA_SECONDS, 10))
            CARDIO -> if (!AppVisibility.visible) RestNotification.postCardio(context, RestAlert.of(intent.getStringExtra(EXTRA_ALERT)))
            else -> {
                // What the receiver needs to flip the notification is in the intent, since the process may be a fresh one with no workout in it.
                val title = intent.getStringExtra(EXTRA_TITLE)
                val from = intent.getLongExtra(EXTRA_FROM, 0L)
                if (title != null && from > 0L) WorkoutNotification.post(context, WorkoutNotice(title, intent.getStringExtra(EXTRA_SET).orEmpty(), null, from))
                if (!AppVisibility.visible) RestNotification.post(context, RestAlert.of(intent.getStringExtra(EXTRA_ALERT)), intent.getStringExtra(EXTRA_TEXT).orEmpty())
            }
        }
    }

    companion object {
        const val EXTRA_KIND = "qala.kind"
        const val EXTRA_ALERT = "qala.alert"
        const val EXTRA_TEXT = "qala.text"
        const val EXTRA_TITLE = "qala.title"
        const val EXTRA_SET = "qala.set"
        const val EXTRA_FROM = "qala.from"
        const val EXTRA_SECONDS = "qala.seconds"
        const val WARN = "warn"
        const val END = "end"
        const val CARDIO = "cardio"
    }
}

/** The alerts: "Rest is over" and the warning before it. They are separate from the ongoing notification, which never makes a sound. */
object RestNotification {
    private const val ID = 7001
    private const val WARN_ID = 7003
    private const val CARDIO_ID = 7004
    private const val WARN_CHANNEL = "rest-warning"

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
        // The warning is one short buzz and the default notification tick, whatever the alert for the end is.
        manager.createNotificationChannel(
            NotificationChannel(WARN_CHANNEL, "Rest warning", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "A short buzz and a soft tick a few seconds before a rest ends, while Qala is in the background."
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 120)
                setSound(
                    android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                )
            },
        )
    }

    private fun open(context: Context) = PendingIntent.getActivity(
        context, 2,
        Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_WORKOUT, true),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun post(context: Context, alert: RestAlert, text: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        ensureChannels(manager)
        val notification = Notification.Builder(context, channelId(alert))
            .setSmallIcon(R.drawable.ic_stat_rest)
            .setContentTitle("Rest is over")
            .setContentText(text)
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(open(context))
            .setAutoCancel(true)
            .build()
        manager.notify(ID, notification)
    }

    /** "Cardio is done": the warm-up's countdown ran out while the app was in the background, as the Alert setting says. */
    fun postCardio(context: Context, alert: RestAlert) {
        val manager = context.getSystemService(NotificationManager::class.java)
        ensureChannels(manager)
        val notification = Notification.Builder(context, channelId(alert))
            .setSmallIcon(R.drawable.ic_stat_rest)
            .setContentTitle("Cardio is done")
            .setContentText("On to soft tissue and mobility.")
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(open(context))
            .setAutoCancel(true)
            .build()
        manager.notify(CARDIO_ID, notification)
    }

    /** "Rest ends in 10 s": gone by itself after those seconds, so a warning that was missed does not sit in the shade. */
    fun postWarning(context: Context, seconds: Int) {
        val manager = context.getSystemService(NotificationManager::class.java)
        ensureChannels(manager)
        val notification = Notification.Builder(context, WARN_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rest)
            .setContentTitle("Rest ends in $seconds s")
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(open(context))
            .setAutoCancel(true)
            .setTimeoutAfter(seconds * 1000L)
            .build()
        manager.notify(WARN_ID, notification)
    }

    fun clear(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(ID)
        manager.cancel(WARN_ID)
        manager.cancel(CARDIO_ID)
    }
}

/**
 * The ongoing notification of a workout: low importance, so it never sounds or pops up, with a system chronometer that counts
 * down during a rest and up the rest of the time. On Android 16 and later it asks to be a Live Update, which puts the clock on the
 * status bar and the lock screen. Tapping it opens the workout, or Rest while one is running.
 */
object WorkoutNotification {
    private const val ID = 7002
    private const val CHANNEL = "workout"

    fun post(context: Context, notice: WorkoutNotice) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Workout in progress", NotificationManager.IMPORTANCE_LOW).apply {
                description = "The time of the workout, and the rest counting down between sets."
                setShowBadge(false)
            },
        )
        val open = PendingIntent.getActivity(
            context, 4,
            Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_WORKOUT, true),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val countDown = notice.countDownToMs != null
        val builder = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rest)
            .setContentTitle(notice.title)
            .setContentText(notice.text)
            .setCategory(Notification.CATEGORY_STOPWATCH)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setLocalOnly(true)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(countDown)
            .setWhen(notice.countDownToMs ?: notice.countUpFromMs)
        // The request is Android 16 QPR2 (API 36.1) and later; before it the notification is an ordinary ongoing one.
        if (Build.VERSION.SDK_INT >= 36 && Build.VERSION.SDK_INT_FULL >= Build.VERSION_CODES_FULL.BAKLAVA_1) builder.setRequestPromotedOngoing(true)
        manager.notify(ID, builder.build())
    }

    fun cancel(context: Context) = context.getSystemService(NotificationManager::class.java).cancel(ID)
}
