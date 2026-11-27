package com.qala.app.run

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.ParcelUuid
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.qala.design.Qala
import com.qala.design.QalaSheet
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.SecondaryButton
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A heart-rate strap found by the scan. */
data class FoundStrap(val name: String, val address: String)

fun hasScanPermission(context: Context) =
    context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
        context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

/**
 * Looks for straps for ten seconds, filtered to the heart-rate service (0x180D), and lists what it finds. Picking one hands it to
 * [onPick]; "No strap" hands null. The caller has asked for the Bluetooth permissions first. A phone with no Bluetooth finds nothing.
 */
@SuppressLint("MissingPermission")
@Composable
fun StrapPicker(open: Boolean, onClose: () -> Unit, onPick: (FoundStrap?) -> Unit) {
    val context = LocalContext.current
    val found = remember { mutableStateListOf<FoundStrap>() }
    var scanning by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    DisposableEffect(open) {
        val scanner = if (open && hasScanPermission(context)) context.getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeScanner else null
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val address = result.device.address
                if (found.none { it.address == address }) found += FoundStrap(result.scanRecord?.deviceName ?: result.device.name ?: "Heart-rate strap", address)
            }
        }
        var stopped = false
        fun stop() {
            if (!stopped) scanner?.stopScan(callback)
            stopped = true
        }
        var timeout: Job? = null
        if (scanner != null) {
            found.clear()
            scanning = true
            scanner.startScan(
                listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(HeartRateClient.HeartRateService)).build()),
                ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
                callback,
            )
            // Ten seconds is long enough to find a strap that is on; the low-latency scan is stopped then, not left running behind the sheet.
            timeout = scope.launch {
                delay(10_000)
                scanning = false
                stop()
            }
        }
        onDispose {
            timeout?.cancel()
            scanning = false
            stop()
        }
    }
    QalaSheet(open = open, title = "Heart-rate strap", onClose = onClose) {
        val c = Qala.colors
        Column(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            QalaText(
                if (scanning) "Looking for straps nearby. Wet the strap's pads and put it on." else if (found.isEmpty()) "No strap found. Check that it is on and not connected to another phone." else "Pick yours.",
                style = QalaType.hint,
                color = c.fgMuted,
            )
            found.forEach { strap -> SecondaryButton(strap.name, { onPick(strap) }, Modifier.fillMaxWidth()) }
            SecondaryButton("No strap", { onPick(null) }, Modifier.fillMaxWidth())
        }
    }
}
