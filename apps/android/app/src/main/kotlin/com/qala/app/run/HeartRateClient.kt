package com.qala.app.run

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import java.util.UUID

/** The standard Heart Rate Measurement value: a flags byte, then the rate as one byte, or two (little-endian) when bit 0 says so. */
fun parseHeartRate(value: ByteArray): Int? {
    if (value.size < 2) return null
    val sixteen = value[0].toInt() and 0x01 != 0
    val bpm = if (sixteen) {
        if (value.size < 3) return null
        (value[1].toInt() and 0xFF) or ((value[2].toInt() and 0xFF) shl 8)
    } else {
        value[1].toInt() and 0xFF
    }
    return bpm.takeIf { it > 0 }
}

/**
 * A heart-rate strap over native GATT: `connectGatt` with `autoConnect` so Android reconnects when the strap comes back into
 * range, notifications on 0x2A37, never bonding. Every sample goes to [onSample]; the recorder puts the newest one that is under
 * five seconds old on each fix. A phone with no Bluetooth, or no permission, is quietly no strap.
 */
class HeartRateClient(private val context: Context, private val address: String, private val onSample: (Int) -> Unit) {
    private var gatt: BluetoothGatt? = null

    private val callback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) gatt.discoverServices()
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val characteristic = gatt.getService(HeartRateService)?.getCharacteristic(Measurement) ?: return
            gatt.setCharacteristicNotification(characteristic, true)
            characteristic.getDescriptor(Cccd)?.let { gatt.writeDescriptor(it, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            if (characteristic.uuid == Measurement) parseHeartRate(value)?.let(onSample)
        }
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (!hasConnectPermission(context)) return
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return
        try {
            gatt = adapter.getRemoteDevice(address).connectGatt(context, true, callback, BluetoothDevice.TRANSPORT_LE)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "not a strap address: $address")
        }
    }

    @SuppressLint("MissingPermission")
    fun stop() {
        gatt?.close()
        gatt = null
    }

    companion object {
        private const val TAG = "HeartRate"
        val HeartRateService: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        private val Measurement: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        private val Cccd: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        fun hasConnectPermission(context: Context) =
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    }
}
