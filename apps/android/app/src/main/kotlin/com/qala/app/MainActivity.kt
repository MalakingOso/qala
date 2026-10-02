package com.qala.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider

class MainActivity : ComponentActivity() {
    private lateinit var container: AppContainer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        container = AppContainer.obtain(applicationContext)
        // Debug builds only: `--ez qala.seed false` starts without the seed, to see Today as a release build first starts.
        container.start(seed = intent.getBooleanExtra(EXTRA_SEED, true))
        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
        }
    }

    override fun onStart() {
        super.onStart()
        // A new day moves "today" and the week, so the engine snapshot is rebuilt whenever the app comes back.
        container.engine.refresh()
    }

    companion object {
        /** A debug build seeds on first launch unless this boolean extra is false. A release build never seeds. */
        const val EXTRA_SEED = "qala.seed"
    }
}
