package com.qala.app.today

import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/*
 * Plain-text helpers for the Today copy. No Compose and no Rust: these are unit tested on the JVM. Names are
 * English on purpose (the app's copy is English), so nothing here reads the device locale.
 */

private const val LbPerKg = 2.2046226218

/**
 * The clock time of a record, read at the record's own UTC offset (not the device's): "7:12 am", or "07:12" when
 * [use24h]. An instant stored in another zone still reads as the wall clock it was made on.
 */
fun formatClock(epochMs: Long, offsetMin: Int, use24h: Boolean): String {
    val t = Instant.ofEpochMilli(epochMs).atOffset(ZoneOffset.ofTotalSeconds(offsetMin * 60))
    val h = t.hour
    val m = t.minute
    if (use24h) return "%02d:%02d".format(Locale.US, h, m)
    val hour = if (h % 12 == 0) 12 else h % 12
    return "%d:%02d %s".format(Locale.US, hour, m, if (h < 12) "am" else "pm")
}

/** "Friday" for a local `YYYY-MM-DD` key. */
fun weekdayName(date: String): String = LocalDate.parse(date).dayOfWeek.getDisplayName(TextStyle.FULL, Locale.ENGLISH)

/** "Oct 12" for a local `YYYY-MM-DD` key. */
fun shortDate(date: String): String {
    val d = LocalDate.parse(date)
    return "${d.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)} ${d.dayOfMonth}"
}

/**
 * A day as a person says it from [today]: today, tomorrow or yesterday, a weekday name inside the week either side,
 * and a short date past that ("Oct 12").
 */
fun dayWord(today: String, date: String): String {
    val diff = ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(date))
    return when {
        diff == 0L -> "today"
        diff == 1L -> "tomorrow"
        diff == -1L -> "yesterday"
        abs(diff) <= 6 -> weekdayName(date)
        else -> shortDate(date)
    }
}

fun String.capitalized(): String = replaceFirstChar { it.uppercase() }

/** A number without a trailing ".0": 150.0 is "150", 112.5 stays "112.5". */
fun trimNumber(x: Double): String {
    val rounded = (x * 100).roundToInt() / 100.0
    return if (rounded % 1.0 == 0.0) rounded.toLong().toString() else "%.2f".format(Locale.US, rounded).trimEnd('0').trimEnd('.')
}

/** A whole number of load units with a thousands separator. */
fun loadUnits(x: Double): String = "%,d".format(Locale.US, x.roundToInt())

/** Kilograms in the user's unit. */
fun weightValue(unit: WeightUnit, kg: Double): Double = if (unit == WeightUnit.Lb) kg * LbPerKg else kg

fun oneDecimal(x: Double): String = "%.1f".format(Locale.US, x)

/** Kilograms in the user's unit, to one decimal: "178.2". */
fun weightIn(unit: WeightUnit, kg: Double): String = oneDecimal(weightValue(unit, kg))

fun unitName(unit: WeightUnit): String = if (unit == WeightUnit.Lb) "lb" else "kg"

/** The distance unit that goes with the weight unit, as the program settings pair them. */
fun distanceUnit(unit: WeightUnit): String = if (unit == WeightUnit.Lb) "mi" else "km"

/** Meters in the user's distance unit, to one decimal: "4.0". */
fun distanceIn(unit: WeightUnit, meters: Double): String =
    oneDecimal(meters / if (unit == WeightUnit.Lb) 1609.344 else 1000.0)

/** The short word for why a day is off ("sick"), as the web writes it on a struck day. */
fun reasonWord(reason: SkipReason): String = when (reason) {
    SkipReason.Break -> "break"
    SkipReason.Vacation -> "vacation"
    SkipReason.Sick -> "sick"
    SkipReason.Injured -> "injured"
    SkipReason.Scheduling -> "scheduling"
}

private val MuscleNames = mapOf(
    "abs" to "abs",
    "back" to "back",
    "biceps" to "biceps",
    "calves" to "calves",
    "chest" to "chest",
    "forearms" to "forearms",
    "frontdelts" to "front delts",
    "glutes" to "glutes",
    "hamstrings" to "hamstrings",
    "lats" to "lats",
    "lowerback" to "lower back",
    "quads" to "quads",
    "reardelts" to "rear delts",
    "sidedelts" to "side delts",
    "triceps" to "triceps",
    "upperback" to "upper back",
)

/** The words for an engine muscle id ("frontdelts" is "front delts"); an id the table does not know is shown as it is. */
fun muscleName(id: String): String = MuscleNames[id] ?: id

/** "a", "a and b", "a, b and c". */
fun joinWords(words: List<String>): String = when (words.size) {
    0 -> ""
    1 -> words[0]
    else -> words.dropLast(1).joinToString(", ") + " and " + words.last()
}
