package com.qala.app.run

import android.Manifest
import android.app.ForegroundServiceStartNotAllowedException
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.qala.app.AppContainer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.launch

/**
 * The foreground service behind a run (docs/android-native.md section 5). It is glue: it keeps the process alive and the screen
 * off, feeds the fixes and the heart rate to [RunRecording] and speaks the cues it returns. The run itself lives in
 * [RunRecording], so a service that dies and comes back (START_STICKY) picks the stored run up and carries on.
 *
 * It starts from the visible activity, on the Start button or when the app opens with a run waiting. A sticky restart with the
 * app in the background may be refused (a location service cannot be created from the background without background
 * location): that is expected, the run is kept and "Run paused, tap to keep recording" puts it back from the activity.
 */
class RunRecordingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var source: FixSource? = null
    private var cues: CuePlayer? = null
    private var strap: HeartRateClient? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand intent=${intent != null} flags=$flags")
        // First, before anything slow: the system gives a few seconds to call startForeground.
        if (!enterForeground()) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!running) {
            running = true
            scope.launch { record() }
        }
        return START_STICKY
    }

    /** True once the service is in the foreground; false (with the "tap to keep recording" notice up) when Android refused. */
    private fun enterForeground(): Boolean = try {
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        // The connected-device type is only allowed with a Bluetooth permission granted, so it is asked for only with a strap set.
        if (HeartRateClient.hasConnectPermission(this) && runBlocking(Dispatchers.IO) { AppContainer.obtain(applicationContext).strapAddress() } != null) {
            type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        }
        startForeground(RunNotifications.RecordingId, RunNotifications.recording(this), type)
        RunNotifications.clearPaused(this)
        true
    } catch (e: Exception) {
        // A background restart of a location service (ForegroundServiceStartNotAllowedException, SecurityException) lands here.
        Log.w(TAG, "startForeground refused: ${e.javaClass.simpleName}: ${e.message}")
        RunNotifications.postPaused(this)
        false
    }

    private suspend fun record() {
        val container = AppContainer.obtain(applicationContext)
        val recording = container.runRecording
        recording.attach()
        if (recording.state.value !is RunState.Active) {
            stopSelf()
            return
        }
        wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "qala:run").apply { acquire(MaxRunMs) }
        val fixes = LocationFixSource(this)
        source = fixes
        try {
            fixes.start { fix ->
                Log.d(TAG, "fix ${fix.tMs} acc=${fix.acc}")
                recording.fix(fix)
            }
            Log.i(TAG, "listening on ${fixes.provider}")
        } catch (e: SecurityException) {
            Log.w(TAG, "no location permission", e)
            RunNotifications.postPaused(this)
            stopSelf()
            return
        }
        val unit = container.settings.settings.first().unit
        val speaker = CuePlayer(this)
        cues = speaker
        scope.launch { recording.events.collect { event -> cueText(event, unit)?.let(speaker::speak) } }
        container.strapAddress()?.let { address ->
            strap = HeartRateClient(this, address) { recording.heartRate(it) }.also { it.start() }
        }
        // Whatever ends the run (Finish, a discard) ends the service.
        recording.state.collect { if (it !is RunState.Active) stopSelf() }
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        source?.stop()
        wakeLock?.let { if (it.isHeld) it.release() }
        cues?.shutdown()
        strap?.stop()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "RunService"

        /** The longest a run is held awake for; a service that leaked its lock would otherwise keep the phone up until the battery died. */
        private const val MaxRunMs = 12 * 60 * 60 * 1000L

        fun start(context: Context) {
            try {
                context.startForegroundService(Intent(context, RunRecordingService::class.java))
            } catch (e: ForegroundServiceStartNotAllowedException) {
                // Reached after a suspension (the recorder was attached first), by which time the app may be in the background.
                Log.w(TAG, "service start refused: ${e.message}")
                RunNotifications.postPaused(context)
            }
        }

        fun hasLocationPermission(context: Context): Boolean =
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
