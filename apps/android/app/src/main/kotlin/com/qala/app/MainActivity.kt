package com.qala.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import com.qala.app.coach.demoCoachClient
import com.qala.app.run.RunRecordingService
import com.qala.app.run.runOpts
import com.qala.app.workout.AppVisibility
import com.qala.app.workout.RestNotification

class MainActivity : ComponentActivity() {
    private lateinit var container: AppContainer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        container = AppContainer.obtain(applicationContext)
        // Debug builds only: `--ez qala.seed false` starts without the seed, to see Today as a release build first starts.
        container.start(seed = intent.getBooleanExtra(EXTRA_SEED, true))
        // Debug builds only: `--es qala.coach demo|offline|degraded|unauthorized` answers the Coach tab without a server.
        if (BuildConfig.DEBUG) intent.getStringExtra(EXTRA_COACH)?.let(::demoCoachClient)?.let { container.coach.client = it }
        takeRoute(intent)
        // Debug builds only: `--ez qala.startRun true` starts a run without the Start screen, for the emulator's GPS playback.
        if (BuildConfig.DEBUG && intent.getBooleanExtra(EXTRA_START_RUN, false)) {
            container.scope.launch {
                container.runRecording.start("Test run", runOpts(container.settings.gym.first().running, container.settings.settings.first().unit))
                RunRecordingService.start(applicationContext)
            }
        }
        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
        }
    }

    /** The activity is singleTask, so a tapped notification arrives here when the app is already running. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeRoute(intent)
    }

    private fun takeRoute(intent: Intent) {
        if (intent.getBooleanExtra(EXTRA_OPEN_WORKOUT, false)) container.pendingRoute.value = Route.Workout
        // Debug builds only: `--ez qala.openRun true` opens the Run screen, for the emulator's GPS playback.
        if (BuildConfig.DEBUG && intent.getBooleanExtra(EXTRA_OPEN_RUN, false)) container.pendingRoute.value = Route.Run
    }

    override fun onStart() {
        super.onStart()
        AppVisibility.onStart()
        RestNotification.clear(this)
        // A run waiting to be recorded (a killed service, a fresh launch) is picked up and, with the permission, recorded again.
        container.scope.launch {
            container.runRecording.attach()
            if (RunRecordingService.hasLocationPermission(applicationContext) && container.runRecording.needsService()) RunRecordingService.start(applicationContext)
        }
        // A new day moves "today" and the week, so the engine snapshot is rebuilt whenever the app comes back.
        container.engine.refresh()
    }

    override fun onStop() {
        AppVisibility.onStop()
        super.onStop()
    }

    companion object {
        /** The workout notification and the rest alerts open the workout, or Rest while one is running: a boolean extra on the intent they fire. */
        const val EXTRA_OPEN_WORKOUT = "qala.openWorkout"

        /** A debug build opens the Run screen when this boolean extra is true. A release build ignores it. */
        const val EXTRA_OPEN_RUN = "qala.openRun"

        /** A debug build starts a run at launch when this boolean extra is true. A release build ignores it. */
        const val EXTRA_START_RUN = "qala.startRun"

        /** A debug build seeds on first launch unless this boolean extra is false. A release build never seeds. */
        const val EXTRA_SEED = "qala.seed"

        /** A debug build swaps the Coach tab's server for a stand-in named by this string extra. A release build ignores it. */
        const val EXTRA_COACH = "qala.coach"
    }
}
