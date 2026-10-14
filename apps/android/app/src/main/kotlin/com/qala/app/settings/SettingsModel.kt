package com.qala.app.settings

import com.qala.app.plates.fmtWeight
import com.qala.app.plates.pairsText
import com.qala.app.skip.reasonTitle
import com.qala.app.today.muscleName
import com.qala.app.today.shortDate
import com.qala.data.core.PlatePairs
import com.qala.data.model.EquipmentItem
import com.qala.data.model.OwnedEquipment
import com.qala.data.model.PlateSettings
import com.qala.data.model.SkipReason
import com.qala.data.model.WarmupSettings
import com.qala.data.model.WeightUnit
import com.qala.data.today.DayStatus
import com.qala.data.today.StatusSpan
import com.qala.design.QalaGear
import kotlin.math.floor

/*
 * What the Settings groups say and do, as plain data (DESIGN 7.13): the training status line and its hint, the unit
 * choices, the bar and plate steppers, the equipment rows, and which warm-up rows mean anything right now. No Compose and
 * no storage, so the copy and the stepping are unit tested on the JVM. The weekday picker has its own file (WeekdayModel).
 * The rows the web has that Android leaves out are named in the screen's header comment.
 */

// ---- training status ----

/** The status row: the reason it shows an icon for (null when training as usual), the sentence, and the hint beside it. */
data class StatusLine(val reason: SkipReason?, val text: String, val hint: String) {
    /** Whether Set active has anything to end. */
    val set: Boolean get() = reason != null
}

/**
 * What is on today, in the web's words (`statusLine` in skipStatus.tsx): "Sick until Oct 9.", "On Vacation until you say
 * so.", "Injured today: Quads." and "Active." when nothing is. The hint says what it means for the plan: training as
 * usual, the plan shifts (vacation, sick), the plan holds (a break, scheduling), or train around it (an injury).
 */
fun statusLine(status: DayStatus?): StatusLine {
    if (status == null) return StatusLine(null, "Active.", "training as usual")
    val title = reasonTitle(status.reason)
    val muscle = status.muscle?.let { muscleName(it).replaceFirstChar { c -> c.uppercase() } }
    val text = when (val span = status.span) {
        StatusSpan.OneDay -> if (status.reason == SkipReason.Injured && muscle != null) "Injured today: $muscle." else "$title today."
        is StatusSpan.Range -> {
            val until = span.until?.let { "until ${shortDate(it)}" } ?: "until you say so"
            if (status.reason == SkipReason.Injured && muscle != null) "Injured: $muscle $until." else "$title $until."
        }
    }
    val hint = when {
        status.reason == SkipReason.Injured -> "train around it"
        status.shifts -> "plan shifts"
        else -> "plan holds"
    }
    return StatusLine(status.reason, text, hint)
}

// ---- units ----

val UnitChoices = listOf(WeightUnit.Lb, WeightUnit.Kg)

val UnitLabels = listOf("lb", "kg")

/** The distance and pace units that go with the weight unit, as the rest of the app pairs them (miles with pounds). */
fun distanceAndPace(unit: WeightUnit): String = if (unit == WeightUnit.Kg) "km · min/km" else "mi · min/mi"

/** Said under Units while the weight is kilograms: the bar and plate settings, the calculator and the plate hints are pounds only. */
const val KilogramPlatesNote = "Bars and plates are in pounds. Plate hints are off while the unit is kg."

fun kilogramPlatesNote(unit: WeightUnit): String? = if (unit == WeightUnit.Kg) KilogramPlatesNote else null

// ---- bars ----

val DefaultBarLabels: List<String> = PlateSettings.DefaultBarChoices.map { "${fmtWeight(it)} lb" }

/** Which cell of the picker the default bar is, null for a bar the picker does not offer. */
fun defaultBarIndex(bar: Double): Int? = PlateSettings.DefaultBarChoices.indexOf(bar).takeIf { it >= 0 }

const val EzBarStep = 2.5
val EzBarRange = 10.0..45.0

fun stepEzBar(current: Double, direction: Int): Double = (current + direction * EzBarStep).coerceIn(EzBarRange)

fun canStepEzBar(current: Double, direction: Int): Boolean = stepEzBar(current, direction) != current

fun barText(weight: Double): String = "${fmtWeight(weight)} lb"

// ---- plates ----

/** Pair counts go up to this and then to plenty. */
const val MaxPairs = 12.0

/** One pair more or fewer: a count stops at nothing below and at [MaxPairs] above, where the next step is plenty. */
fun stepPairs(pairs: PlatePairs, direction: Int): PlatePairs = when (pairs) {
    PlatePairs.Enough -> if (direction < 0) PlatePairs.Count(MaxPairs) else PlatePairs.Enough
    is PlatePairs.Count -> {
        val next = floor(pairs.pairs) + direction
        when {
            next < 0.0 -> PlatePairs.Count(0.0)
            next > MaxPairs -> PlatePairs.Enough
            else -> PlatePairs.Count(next)
        }
    }
}

fun canStepPairs(pairs: PlatePairs, direction: Int): Boolean = stepPairs(pairs, direction) != pairs

/** A row of the inventory (never the 55s, which have a row of their own), with what its stepper may do. */
data class PlateRow(val weight: Double, val pairs: PlatePairs, val canLess: Boolean, val canMore: Boolean) {
    val label: String get() = "${fmtWeight(weight)} lb"
}

fun plateRows(settings: PlateSettings): List<PlateRow> =
    settings.plates.filter { it.weight != PlateSettings.OptionalPlate }.map {
        PlateRow(it.weight, it.pairs, canStepPairs(it.pairs, -1), canStepPairs(it.pairs, 1))
    }

fun PlateSettings.stepped(weight: Double, direction: Int): PlateSettings =
    pairsOf(weight)?.let { withPairs(weight, stepPairs(it, direction)) } ?: this

/** The 55s' pair count while they are on, one or more; null while they are off. */
fun pairs55(settings: PlateSettings): Double? = (settings.pairsOf(PlateSettings.OptionalPlate) as? PlatePairs.Count)?.pairs

/** The 55s step between one pair and [MaxPairs]: fewer than one is switching them off, and plenty is not offered. */
private fun step55(now: Double, direction: Int): Double = (floor(now) + direction).coerceIn(1.0, MaxPairs)

fun PlateSettings.stepped55(direction: Int): PlateSettings = pairs55(this)?.let { with55(step55(it, direction)) } ?: this

fun canStep55(settings: PlateSettings, direction: Int): Boolean = pairs55(settings)?.let { step55(it, direction) != it } ?: false

/** The 55 row's right-hand words: "off for now", or the pairs. */
fun text55(settings: PlateSettings): String = pairs55(settings)?.let { pairsText(PlatePairs.Count(it)) } ?: "off for now"

// ---- equipment ----

/** The five rows in the web's order, each with the picture the owner has for it (the bike and the rower have none yet). */
data class EquipmentRow(val item: EquipmentItem, val label: String, val gear: QalaGear?)

val EquipmentRows = listOf(
    EquipmentRow(EquipmentItem.FoamRoller, "Foam roller", QalaGear.Roller),
    EquipmentRow(EquipmentItem.Percussion, "Theragun", QalaGear.Theragun),
    EquipmentRow(EquipmentItem.Bike, "Bike", null),
    EquipmentRow(EquipmentItem.Rower, "Rower", null),
    EquipmentRow(EquipmentItem.Treadmill, "Treadmill", QalaGear.Treadmill),
)

// ---- warm-up ----

/**
 * Which warm-up rows mean something right now. With the warm-up off nothing below it does anything, and the Theragun
 * preference needs soft tissue on and a Theragun to prefer. The rows stay in place, dimmed, so the list does not jump.
 */
data class WarmupRows(val softTissue: Boolean, val preferPercussion: Boolean, val time: Boolean)

fun warmupRows(warmup: WarmupSettings, equipment: OwnedEquipment): WarmupRows = WarmupRows(
    softTissue = warmup.enabled,
    preferPercussion = warmup.enabled && warmup.softTissue && equipment.percussion,
    time = warmup.enabled,
)

const val WarmupMinuteStep = 5
val WarmupMinuteRange = 5..30

/** The next multiple of five up or down from [current], inside 5 to 30 (a stored 12 goes to 15 or to 10). */
fun stepWarmupMinutes(current: Int, direction: Int): Int {
    val next = if (direction > 0) (current / WarmupMinuteStep + 1) * WarmupMinuteStep else ((current - 1) / WarmupMinuteStep) * WarmupMinuteStep
    return next.coerceIn(WarmupMinuteRange)
}

fun canStepWarmupMinutes(current: Int, direction: Int): Boolean = stepWarmupMinutes(current, direction) != current

fun minutesText(minutes: Int): String = "$minutes min"
