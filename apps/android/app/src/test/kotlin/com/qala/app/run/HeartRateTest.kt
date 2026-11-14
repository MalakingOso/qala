package com.qala.app.run

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HeartRateTest {
    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test
    fun theRateIsOneByteOrTwoLittleEndianByDependingOnBitZeroOfTheFlags() {
        assertEquals(72, parseHeartRate(bytes(0x00, 72)))
        assertEquals(172, parseHeartRate(bytes(0x00, 172)))                     // a byte over 127 is not negative
        assertEquals(300, parseHeartRate(bytes(0x01, 0x2C, 0x01)))              // 0x012C
        assertEquals("the other flag bits (contact, energy, RR) do not change where the rate is", 150, parseHeartRate(bytes(0x16, 150, 0x10, 0x00)))
    }

    @Test
    fun aShortOrEmptyReadingIsNoReading() {
        assertNull(parseHeartRate(bytes()))
        assertNull(parseHeartRate(bytes(0x00)))
        assertNull(parseHeartRate(bytes(0x01, 0x2C)))
        assertNull("a zero is a strap that has not found a pulse", parseHeartRate(bytes(0x00, 0)))
    }
}
