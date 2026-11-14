package com.qala.app.run

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.SystemClock
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Where raw positions come from. One stream only (PLAN 8a rule 2). */
interface FixSource {
    /** The provider behind it, for the log and the status line. */
    val provider: String

    /** Starts delivering fixes to [onFix] on a background thread. Throws `SecurityException` without the location permission. */
    fun start(onFix: (RawFix) -> Unit)

    fun stop()
}

/**
 * `LocationManager`'s fused provider when the phone has one (it is part of the platform from Android 12, and on a phone with
 * Google's services it is Google's fused location behind it), the GPS chip otherwise. An emulator image without Play services
 * has the platform one too; `adb shell dumpsys location` names the package that backs it. A request every second at the
 * highest accuracy, no batching.
 */
class LocationFixSource(context: Context) : FixSource {
    private val manager = context.applicationContext.getSystemService(LocationManager::class.java)
    private var executor: ExecutorService? = null
    private var listener: LocationListener? = null

    override val provider: String =
        if (manager.hasProvider(LocationManager.FUSED_PROVIDER)) LocationManager.FUSED_PROVIDER else LocationManager.GPS_PROVIDER

    @SuppressLint("MissingPermission")
    override fun start(onFix: (RawFix) -> Unit) {
        stop()
        val run = Executors.newSingleThreadExecutor()
        val l = LocationListener { location -> onFix(location.toRawFix()) }
        executor = run
        listener = l
        val request = LocationRequest.Builder(1000L)
            .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
            .setMinUpdateIntervalMillis(1000L)
            .build()
        manager.requestLocationUpdates(provider, request, run, l)
    }

    override fun stop() {
        listener?.let { manager.removeUpdates(it) }
        listener = null
        executor?.shutdown()
        executor = null
    }
}

/**
 * A fix on the run's clock: UTC milliseconds, taken as now less the fix's age on `elapsedRealtimeNanos`. That is the same clock the
 * run's start time is read from, so a fix is never "before" the run because two clocks disagree, and it is the time of the fix,
 * not of the callback that delivered it.
 */
fun Location.toRawFix(): RawFix {
    val ageMs = (SystemClock.elapsedRealtimeNanos() - elapsedRealtimeNanos) / 1_000_000
    return RawFix(
        tMs = System.currentTimeMillis() - ageMs,
        lat = latitude,
        lon = longitude,
        acc = if (hasAccuracy()) accuracy.toDouble() else 99.0,
        ele = if (hasAltitude()) altitude else null,
    )
}
