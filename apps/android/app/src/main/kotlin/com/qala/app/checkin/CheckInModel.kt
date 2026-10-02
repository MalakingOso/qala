package com.qala.app.checkin

import androidx.compose.runtime.saveable.listSaver
import com.qala.app.today.dayWord
import com.qala.app.today.headEyebrow
import com.qala.app.today.muscleName
import com.qala.data.engine.EngineSnapshot
import com.qala.data.today.TodayPlan

/*
 * The check-in screen's decisions as plain data (DESIGN 7.3): which muscles it asks about, what a row says, the draft the
 * screen edits and the record it saves. No Compose and no Rust, so the selection, the copy and the saved shape are unit
 * tested on the JVM. The muscles come from the engine snapshot, which asked the core's `exercise_muscles` for them.
 */

/**
 * The four muscles a rest day or a skipped day asks about, as engine ids: legs front and back, the upper back and the
 * front of the shoulder. The mockup's "Back" and "Shoulders" are not engine ids (the engine splits them into upper back,
 * lower back and three delts), so these are the closest ids the lifts really load.
 */
val FixedMuscles = listOf("quads", "hamstrings", "upperback", "frontdelts")

/** What each soreness value means, 1 to 4: the answer in words, shown under the muscle once a value is picked. */
val SorenessMeaning = listOf("never sore", "healed well before", "healed just in time", "still sore now")

/** The words under the ends and the middle of the recovery strip. */
val RecoveryAnchors = listOf("worse session", "normal", "better")

/** An injured muscle walks in at "still sore now". */
const val InjuredSoreness = 4

/** The recovery the strip starts on, as the web's check-in does: most days are fine, so one tap is only needed to say otherwise. */
const val DefaultRecovery = 7

/** One row of the soreness grid. [lastTrained] is the line shown until a value is picked. */
class CheckInMuscle(val id: String, val label: String, val lastTrained: String, val injured: Boolean)

/** What the screen shows for today: its eyebrow, the muscles, and whether the rest-day tip belongs. */
class CheckInPlan(
    val eyebrow: String,
    val liftDay: Boolean,
    val muscles: List<CheckInMuscle>,
    /** Soreness the screen starts with: each injured muscle at [InjuredSoreness]. */
    val initialSoreness: Map<String, Int>,
    val injured: List<String>,
) {
    /** The tip is for days with no lift: a rest day, or a skipped day. */
    val showTip: Boolean get() = !liftDay
}

/**
 * The muscle ids to ask about: the injured ones first (a muscle the program does not train still walks in sore), then
 * the program day's muscles on a lift day, or the [FixedMuscles] on a rest or skipped day and when the day names none.
 */
fun checkInMuscles(liftDay: Boolean, sessionMuscles: List<String>, injured: List<String>): List<String> =
    (injured + if (liftDay && sessionMuscles.isNotEmpty()) sessionMuscles else FixedMuscles).distinct()

/** "Quads", "Front delts": the engine id as a row label. */
fun muscleLabel(id: String): String = muscleName(id).replaceFirstChar { it.uppercase() }

/** "trained Mon", "trained yesterday", "trained Oct 12"; a muscle not trained in the window says so. */
fun lastTrainedLine(lastTrained: String?, today: String): String = when {
    lastTrained == null -> "not trained lately"
    else -> {
        val word = dayWord(today, lastTrained)
        // dayWord gives a full weekday inside the week; the row has room for three letters.
        "trained " + if (word.length > 3 && word[0].isUpperCase() && !word.contains(' ')) word.take(3) else word
    }
}

fun checkInPlan(snapshot: EngineSnapshot, plan: TodayPlan): CheckInPlan {
    val ids = checkInMuscles(plan.liftDay, snapshot.sessionMuscles, snapshot.injured)
    return CheckInPlan(
        eyebrow = headEyebrow(snapshot, plan),
        liftDay = plan.liftDay,
        muscles = ids.map { CheckInMuscle(it, muscleLabel(it), lastTrainedLine(snapshot.lastTrained[it], plan.date), it in snapshot.injured) },
        initialSoreness = snapshot.injured.associateWith { InjuredSoreness },
        injured = snapshot.injured,
    )
}

/**
 * The meaning line under a muscle: its soreness in words once a value is picked ("injured, still sore now" for an
 * injured muscle), the last-trained line until then.
 */
fun muscleHint(muscle: CheckInMuscle, value: Int?): String = when {
    value == null -> muscle.lastTrained
    muscle.injured -> "injured, ${SorenessMeaning[value - 1]}"
    else -> SorenessMeaning[value - 1]
}

/** The rest-day tip, from the sore muscles (injured first), as the web writes it: "Easy quads + glutes: 90 s foam roller each side, then a short walk." */
fun restDayTip(soreness: Map<String, Int>, injured: List<String>): String {
    val sore = soreness.filter { it.value >= 3 }.keys.sortedBy { if (it in injured) 0 else 1 }
    val where = if (sore.isEmpty()) "hips" else sore.joinToString(" + ") { muscleName(it) }
    return "Easy $where: 90 s foam roller each side, then a short walk."
}

/** What the screen has been told so far. [soreness] holds only the muscles that were answered. */
data class CheckInDraft(
    val recovery: Int = DefaultRecovery,
    val soreness: Map<String, Int> = emptyMap(),
    val note: String = "",
) {
    fun withRecovery(value: Int) = copy(recovery = value.coerceIn(0, 10))
    fun withSoreness(muscle: String, value: Int) = copy(soreness = soreness + (muscle to value.coerceIn(1, 4)))
    fun withNote(text: String) = copy(note = text)

    /** The record to save: recovery, the answered muscles, and the note without its edges (null when blank). */
    fun toSave() = CheckInSave(recovery.toDouble(), soreness, note.trim().ifEmpty { null })

    companion object {
        /** Survives a rotation: recovery, note, then the answered muscles as `id=value` pairs. */
        val Saver = listSaver<CheckInDraft, Any>(
            save = { listOf(it.recovery, it.note) + it.soreness.map { (m, v) -> "$m=$v" } },
            restore = { saved ->
                CheckInDraft(
                    recovery = saved[0] as Int,
                    note = saved[1] as String,
                    soreness = saved.drop(2).associate { pair -> (pair as String).split("=").let { it[0] to it[1].toInt() } },
                )
            },
        )
    }
}

/** The arguments of `CheckInRepository.save`. */
data class CheckInSave(val recovery: Double, val soreness: Map<String, Int>, val note: String?)
