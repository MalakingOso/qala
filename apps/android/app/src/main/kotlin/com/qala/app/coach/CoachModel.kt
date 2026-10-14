package com.qala.app.coach

import com.qala.app.today.muscleName
import com.qala.app.today.trimNumber
import com.qala.data.IsoTime
import com.qala.data.db.CheckInEntity
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.WeightUnit
import kotlin.math.roundToInt
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * What the Coach screen says and sends, as plain data (DESIGN 7.11). The day comes from the engine snapshot, so the
 * chips and the request context are pure functions of it and unit tested on the JVM. No Compose and no network here.
 */

/**
 * What the coach is told about today, and the chips that show it. [lift] is the main lift's top set, which is what lets
 * the coach suggest a change; it is null on a rest day and for a bodyweight lift. [barbell] says the lift takes plates.
 */
data class CoachDay(
    val today: String?,
    val checkIn: String?,
    val lift: WireLift?,
    val barbell: Boolean,
) {
    val chips: List<String> = if (today == null) emptyList() else listOf("Today: $today", "Check-in: ${checkIn ?: "not yet"}")

    /** Null before the engine has built today, when the coach is simply asked without context. */
    val context: CoachRequestContext? = if (today == null) null else CoachRequestContext(today = today, checkIn = checkIn, lift = lift)

    /** The questions offered on an empty thread. They name things the coach can answer from the context above. */
    val starters: List<String> = if (lift != null) {
        listOf("Why this weight today?", "Should I change anything?")
    } else {
        listOf("How is my recovery?", "What should I do on a rest day?")
    }

    companion object {
        val Unknown = CoachDay(null, null, null, false)
    }
}

/** Today for the coach: the day's name, today's check-in in a line, and the main lift's top set. [CoachDay.Unknown] until the engine has built. */
fun coachDay(snapshot: EngineSnapshot): CoachDay {
    val plan = snapshot.today
    if (!snapshot.loaded || snapshot.error != null || plan == null) return CoachDay.Unknown
    val hero = snapshot.liftHero.takeIf { plan.liftDay }
    val top = hero?.topSet
    val unit = if (top?.unit == WeightUnit.Kg) "kg" else "lb"
    val lift = if (hero != null && top?.weight != null && top.weight!! > 0.0) {
        WireLift(
            title = "${hero.exerciseName} top set",
            weight = top.weight!!,
            unit = unit,
            sets = top.sets.coerceIn(1, 20),
            reps = top.reps.roundToInt().coerceIn(1, 100),
        )
    } else {
        null
    }
    val today = when {
        hero != null -> hero.dayName
        plan.liftDay -> "Lift day"
        plan.noProgram -> "No program"
        else -> "Rest day"
    }
    val checkIn = snapshot.input?.checkIns
        ?.filter { !it.deleted && IsoTime.localDateKey(it.atMs, it.offsetMin) == snapshot.date }
        ?.maxByOrNull { it.atMs }
        ?.let(::checkInLine)
    return CoachDay(today, checkIn, lift, barbell = lift != null && unit == "lb" && hero?.equipment == "barbell")
}

/** "recovery 7, quads 4": the recovery score, then the muscles sore at 3 or 4, worst first and at most three. */
fun checkInLine(entry: CheckInEntity): String {
    val sore = soreness(entry.sorenessJson).filterValues { it >= 3 }.entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .take(3)
        .map { "${muscleName(it.key)} ${it.value}" }
    return (listOf("recovery ${trimNumber(entry.recovery)}") + sore).joinToString(", ")
}

private fun soreness(json: String): Map<String, Int> = try {
    (Json.parseToJsonElement(json) as? JsonObject)?.mapValues { it.value.jsonPrimitive.int } ?: emptyMap()
} catch (e: IllegalArgumentException) {
    emptyMap()          // a record of an unexpected shape reads as no soreness; SerializationException is one of these
}

// ---- the suggestion card ----

/** The number a card cell leads with: "245 lb". */
fun weightFigure(n: CoachNumbers): String = "${trimNumber(n.weight)} ${n.unit}"

/** The line under it: "4 sets × 4 reps @ 8". */
fun setsLine(n: CoachNumbers): String =
    "${n.sets} ${if (n.sets == 1) "set" else "sets"} × ${n.reps} ${if (n.reps == 1) "rep" else "reps"}" + (n.rpe?.let { " @ ${trimNumber(it)}" } ?: "")

private fun signed(x: Double): String = (if (x > 0) "+" else "") + trimNumber(x)

/** The limits the server enforced, as the web card prints them: "Coach can move weight -10% to +2.5% and sets -2 to +1." */
fun limitsLine(l: CoachLimits): String =
    "Coach can move weight ${signed(l.weightPctMin)}% to ${signed(l.weightPctMax)}% and sets ${signed(l.setsMin.toDouble())} to ${signed(l.setsMax.toDouble())}."

/** What the card says once the athlete has chosen. Null while the choice is pending. */
fun decisionLine(decision: Decision): String? = when (decision) {
    Decision.Pending -> null
    Decision.UseCoach -> "Noted. The workout still shows the engine's numbers, so change them there."
    Decision.KeepEngine -> "Engine numbers kept."
}

// ---- the unavailable state ----

/** The card's title and its sentence for each reason. All of them say the rest of the app is fine. */
class UnavailableCopy(val title: String, val body: String)

fun unavailableCopy(why: Why): UnavailableCopy = when (why) {
    Why.Unreachable -> UnavailableCopy("Coach is offline", "Qala can't reach the server from here. Your plan, workouts and history work without it.")
    Why.Degraded -> UnavailableCopy("Coach is unavailable", "The server is up, but its model isn't answering right now. Everything else in Qala works without it.")
    Why.NotRecognised -> UnavailableCopy("Coach is unavailable", "The server didn't recognise this phone, so it won't answer. Everything else in Qala works without it.")
    Why.Failed -> UnavailableCopy("Coach is unavailable", "The server sent back something the app couldn't use. Everything else in Qala works without it.")
}

/** The status next to the title: where the coach runs while it answers, "Offline" once a question could not be answered. */
fun coachStatus(unavailable: Why?): String = if (unavailable == null) "Runs on callisto" else "Offline"
