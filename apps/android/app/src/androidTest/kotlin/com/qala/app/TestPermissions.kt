package com.qala.app

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry

/** The first rest asks for the notification permission; granting it up front keeps the system dialog off the screen under test. */
fun allowNotifications(context: Context) {
    InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(context.packageName, "android.permission.POST_NOTIFICATIONS")
}
