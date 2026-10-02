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
        container.start()
        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) { QalaApp() }
        }
    }

    override fun onStart() {
        super.onStart()
        // A new day moves "today" and the week, so the engine snapshot is rebuilt whenever the app comes back.
        container.engine.refresh()
    }
}
