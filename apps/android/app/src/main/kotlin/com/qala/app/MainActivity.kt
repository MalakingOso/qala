package com.qala.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import com.qala.app.coach.demoCoachClient
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
        if (intent.getBooleanExtra(EXTRA_OPEN_REST, false)) container.pendingRoute.value = Route.Rest
    }

    override fun onStart() {
        super.onStart()
        AppVisibility.onStart()
        RestNotification.clear(this)
        // A new day moves "today" and the week, so the engine snapshot is rebuilt whenever the app comes back.
        container.engine.refresh()
    }

    override fun onStop() {
        AppVisibility.onStop()
        super.onStop()
    }

    companion object {
        /** The rest-end notification opens Rest: a boolean extra on the intent it fires. */
        const val EXTRA_OPEN_REST = "qala.openRest"

        /** A debug build seeds on first launch unless this boolean extra is false. A release build never seeds. */
        const val EXTRA_SEED = "qala.seed"

        /** A debug build swaps the Coach tab's server for a stand-in named by this string extra. A release build ignores it. */
        const val EXTRA_COACH = "qala.coach"
    }
}
