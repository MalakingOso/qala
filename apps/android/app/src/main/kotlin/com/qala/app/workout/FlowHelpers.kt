package com.qala.app.workout

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView
import com.qala.data.repo.DeviceClock
import kotlinx.coroutines.delay

/**
 * The clock, read again once a second. [originMs] puts the ticks just after each whole second counted from it, so a
 * countdown that started at [originMs] steps the moment its second turns over and not up to a second late. With a
 * clock that does not move (a test's) it simply holds one value.
 */
@Composable
fun rememberNow(clock: DeviceClock, originMs: Long = 0L): State<Long> {
    val now = remember { mutableLongStateOf(clock.nowMs()) }
    LaunchedEffect(clock, originMs) {
        while (true) {
            val t = clock.nowMs()
            now.longValue = t
            delay(1000 - Math.floorMod(t - originMs, 1000L) + 20)
        }
    }
    return now
}

/** Keeps the screen awake while it is composed: a lifter between sets is looking at it, not touching it. */
@Composable
fun KeepScreenOn() {
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
}
