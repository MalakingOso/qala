package com.qala.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Time at the Rust boundary (docs/archive/completed.md, M1 as built, DECISIONS S25). Instants are stored as UTC epoch ms
 * plus the device offset in minutes at write time; the core takes ISO 8601 with an explicit offset and local
 * `YYYY-MM-DD` keys for calendar days. Weekdays count from Monday = 0, like `trainingWeekdays`.
 */
object IsoTime {
    /** `2026-10-02T17:30:00-04:00`, with a `.123` fraction only when the millisecond part is not zero. */
    fun format(epochMs: Long, offsetMin: Int): String =
        Instant.ofEpochMilli(epochMs)
            .atOffset(ZoneOffset.ofTotalSeconds(offsetMin * 60))
            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

    /** The local `YYYY-MM-DD` key of an instant at a UTC offset in minutes. */
    fun localDateKey(epochMs: Long, offsetMin: Int): String =
        Instant.ofEpochMilli(epochMs).atOffset(ZoneOffset.ofTotalSeconds(offsetMin * 60)).toLocalDate().toString()

    /** The UTC offset of [zone] at an instant, in minutes (`-240` for EDT). */
    fun offsetMinAt(zone: ZoneId, epochMs: Long): Int =
        zone.rules.getOffset(Instant.ofEpochMilli(epochMs)).totalSeconds / 60

    /** Adds calendar days to a `YYYY-MM-DD` key. */
    fun addDays(key: String, days: Long): String = LocalDate.parse(key).plusDays(days).toString()

    /** 0 is Monday, 6 is Sunday. */
    fun weekdayIndex(key: String): Int = LocalDate.parse(key).dayOfWeek.value - 1

    /** The Monday on or before a date key. */
    fun weekStart(key: String): String = addDays(key, -weekdayIndex(key).toLong())

    /** Epoch ms of the start of a local day at an offset. */
    fun startOfDayMs(key: String, offsetMin: Int): Long =
        LocalDate.parse(key).atStartOfDay().toInstant(ZoneOffset.ofTotalSeconds(offsetMin * 60)).toEpochMilli()
}
