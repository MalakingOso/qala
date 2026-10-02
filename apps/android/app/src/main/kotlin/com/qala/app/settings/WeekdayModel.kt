package com.qala.app.settings

/*
 * The training-weekdays picker as plain data (mockups/m4-weekdays.html option A): seven Mon to Sun cells, 0 is Monday as
 * `trainingWeekdays` counts, at least one day always on. The setting decides which weekdays are lift days; every other
 * weekday is a rest day. It moves upcoming days and leaves logged days alone. No Compose here, so the mapping is
 * unit tested on the JVM.
 */

val WeekdayLabels = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

/** What a screen reader calls each cell. */
val WeekdayNames = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

/** The one line under the title of the group: what the setting changes. */
const val WeekdayExplanation = "Lifts land on these days. The rest are rest days."

/** The line under the strip when only one day is left on: it cannot be turned off, and this says why. */
const val KeepOneDay = "Keep at least one training day."

/**
 * [days] with [day] flipped, sorted. Turning off the last day on is refused and the list comes back unchanged. Anything
 * outside 0 to 6 is ignored.
 */
fun toggleWeekday(days: List<Int>, day: Int): List<Int> = when {
    day !in 0..6 -> days.sorted()
    day in days -> if (days.distinct().size <= 1) days.sorted() else (days - day).distinct().sorted()
    else -> (days + day).distinct().sorted()
}

/** "4 days a week", "1 day a week". */
fun weekdayCount(days: List<Int>): String = days.distinct().size.let { "$it ${if (it == 1) "day" else "days"} a week" }

/** "Mon, Wed, Fri, Sat". */
fun weekdayNames(days: List<Int>): String = days.distinct().sorted().joinToString(", ") { WeekdayLabels[it] }

/** The summary line under the strip: "4 days a week: Mon, Wed, Fri, Sat". */
fun weekdaySummary(days: List<Int>): String = "${weekdayCount(days)}: ${weekdayNames(days)}"

/** The warning line: shown only when a single day is left. */
fun weekdayWarning(days: List<Int>): String? = if (days.distinct().size <= 1) KeepOneDay else null
