package com.qala.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Asks for the notification permission (Android 13 and later) the first time something needs it: a rest starts, a run
 * starts. A denial is tolerated, the feature that wanted it just stays quiet, and the question is asked once so a "no" is
 * not nagged. Returns the function to call at that moment.
 */
@Composable
fun rememberAskForNotifications(): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    return remember(context, launcher) {
        {
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                val prefs = context.getSharedPreferences("qala", Context.MODE_PRIVATE)
                if (!prefs.getBoolean(ASKED, false)) {
                    prefs.edit().putBoolean(ASKED, true).apply()
                    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }
    }
}

private const val ASKED = "askedNotifications"
