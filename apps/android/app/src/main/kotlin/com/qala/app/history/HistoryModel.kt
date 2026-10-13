package com.qala.app.history

import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftStage
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.WeightUnit
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.round

/*
 * History's decisions as plain data: past sessions from Room, newest first, grouped by week
 * (Monday start), each row the web's SessionRow shape (kind, day, title, detail). No Compose, so
 * the grouping, the volume and the stub wordings are unit tested on the JVM. Program day titles
 * arrive as [dayNames] from the evaluated program; sessions without one fall back honestly.
 */

enum class HistoryKind { Lift, Run }

/** One past session in a week group. */
data class HistoryRow(
    val kind: HistoryKind,
    /** "Mon", "Tue": the session's local weekday. */
    val day: String,
    val title: String,
    /** "20.4k lb · 58 min", "7.0 mi · 1:04", or the marked-done line for a stub. */
    val detail: String,
    val startedAtMs: Long,
)

/** One Monday-start week, newest first. */
data class HistoryWeek(val label: String, val rows: List<HistoryRow>)

private const val LB_PER_KG = 2.2046226218

private fun localDate(startedAtMs: Long, offsetMin: Int): LocalDate =
    Instant.ofEpochMilli(startedAtMs).atOffset(ZoneOffset.ofTotalSeconds(offsetMin * 60)).toLocalDate()

private val DayNames = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
private val MonthNames = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private fun dayLabel(date: LocalDate): String = DayNames[date.dayOfWeek.value - 1]

private fun monthLabel(date: LocalDate): String = MonthNames[date.monthValue - 1]

private fun fmtNum(n: Double): String {
    val v = round(n * 100) / 100
    return if (v == v.toInt().toDouble()) v.toInt().toString() else v.toString()
}

/** "20.4k lb" from a thousand up, "850 lb" under it, in the reader's unit (the web rows read "14.1k lb"). */
fun volumeText(volumeInUnit: Double, unit: WeightUnit): String {
    val suffix = if (unit == WeightUnit.Kg) "kg" else "lb"
    val whole = round(volumeInUnit)
    return if (whole >= 1_000) "${fmtNum(round(volumeInUnit / 100) / 10)}k $suffix" else "${fmtNum(whole)} $suffix"
}

/** "58 min" under an hour, "1:04" over it. */
fun durationText(seconds: Double): String {
    val mins = round(seconds / 60).toInt()
    return if (mins >= 60) "${mins / 60}:${(mins % 60).toString().padStart(2, '0')}" else "$mins min"
}

private fun liftRow(s: LiftSessionWithEntries, dayNames: Map<Int, String>, unit: WeightUnit): HistoryRow {
    val session = s.session
    val date = localDate(session.startedAtMs, session.offsetMin)
    if (session.stub) {
        // A stub carries its program day, so it reads like the real row it stands in for. The warm-up stub says
        // which day's warm-up it was, since the lift stub for the same day shares the day name.
        val day = session.programDayIndex?.let { dayNames[it] }
        return when (session.stage) {
            LiftStage.WARMUP -> HistoryRow(
                HistoryKind.Lift, dayLabel(date), day?.let { "$it warm-up" } ?: "Warm-up", "Marked done · nothing logged", session.startedAtMs,
            )
            else -> HistoryRow(HistoryKind.Lift, dayLabel(date), day ?: "Workout", "Marked done · no sets logged", session.startedAtMs)
        }
    }
    var volume = 0.0
    for (entry in s.entries) {
        for (set in entry.sets) {
            if (!set.completed || set.warmup) continue
            val w = when {
                unit == WeightUnit.Lb && set.unit == "kg" -> set.weight * LB_PER_KG
                unit == WeightUnit.Kg && set.unit == "lb" -> set.weight / LB_PER_KG
                else -> set.weight
            }
            volume += w * set.reps
        }
    }
    val parts = mutableListOf(volumeText(volume, unit))
    session.minutes?.let { parts.add("${round(it).toInt()} min") }
    val title = session.programDayIndex?.let { dayNames[it] } ?: "Lift"
    return HistoryRow(HistoryKind.Lift, dayLabel(date), title, parts.joinToString(" · "), session.startedAtMs)
}

private fun runRow(r: RunSessionEntity): HistoryRow {
    val date = localDate(r.startedAtMs, r.offsetMin)
    if (r.stub) {
        return HistoryRow(HistoryKind.Run, dayLabel(date), "Run", "Marked done · no distance logged", r.startedAtMs)
    }
    val miles = r.distanceM / 1609.344
    val milesText = String.format(Locale.US, "%.1f", miles)
    val seconds = r.movingSec ?: r.elapsedSec
    val detail = if (seconds > 0) "$milesText mi · ${durationText(seconds)}" else "$milesText mi"
    return HistoryRow(HistoryKind.Run, dayLabel(date), "Run", detail, r.startedAtMs)
}

private fun weekLabel(weekStart: LocalDate): String {
    val end = weekStart.plusDays(6)
    val startText = "${monthLabel(weekStart)} ${weekStart.dayOfMonth}"
    val endText = if (end.month == weekStart.month) "${end.dayOfMonth}" else "${monthLabel(end)} ${end.dayOfMonth}"
    return "$startText–$endText, ${weekStart.year}"
}

private fun weekStartOf(startedAtMs: Long, offsetMin: Int): LocalDate {
    val date = localDate(startedAtMs, offsetMin)
    return date.minusDays((date.dayOfWeek.value - 1).toLong())
}

/** Every session as week groups, newest first. Weeks start on Monday, in each session's own offset. */
fun historyWeeks(
    lifts: List<LiftSessionWithEntries>,
    runs: List<RunSessionEntity>,
    dayNames: Map<Int, String> = emptyMap(),
    unit: WeightUnit = WeightUnit.Lb,
): List<HistoryWeek> {
    val rows = lifts.map { liftRow(it, dayNames, unit) to weekStartOf(it.session.startedAtMs, it.session.offsetMin) } +
        runs.map { runRow(it) to weekStartOf(it.startedAtMs, it.offsetMin) }
    return rows
        .groupBy({ it.second }, { it.first })
        .entries
        .sortedByDescending { it.key }
        .map { (start, weekRows) ->
            HistoryWeek(weekLabel(start), weekRows.sortedByDescending { it.startedAtMs })
        }
}
