package com.qala.data.model

import com.qala.data.QalaJson
import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.PlateEntry
import com.qala.data.core.PlatePairs
import com.qala.data.repo.SettingsGroups
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject

/*
 * The lifting settings the web's Settings page lists, as typed values with defaults. Each is a settings group of the
 * record store (SettingsGroups), every leaf its own clocked field, so they sync like the training days do. They are not
 * in `SettingsRecord`, which mirrors what the Rust core reads: the core knows nothing of bars or warm-ups.
 *
 * Defaults are what the app did before any of this was a setting: the 45 lb bar and the default plate set (plenty of
 * everything but the 1.25s), a foam roller, a Theragun and a bike, a 15 minute warm-up with soft tissue and the Theragun
 * preferred, and automatic rest with plates shown. A leaf that was never written, or that holds something unreadable,
 * reads as its default, so a damaged row never takes the lifting flow down.
 */

/** What the plate math plans with: the bar every barbell lift starts from, the curl bar, and the plates the gym has. Pounds only. */
data class PlateSettings(
    val defaultBar: Double = DefaultBar,
    val ezBar: Double = DefaultEzBar,
    val plates: List<PlateEntry> = DefaultLbPlates,
) {
    /** The 55 lb plates are optional and off until switched on, as on the web: they are in [plates] only while they are on. */
    val uses55: Boolean get() = plates.any { it.weight == OptionalPlate }

    /** The pairs of the plate of [weight], null when there is no such row. */
    fun pairsOf(weight: Double): PlatePairs? = plates.firstOrNull { it.weight == weight }?.pairs

    /** The same inventory with the row for [weight] holding [pairs]; a weight with no row is left alone. */
    fun withPairs(weight: Double, pairs: PlatePairs): PlateSettings =
        copy(plates = plates.map { if (it.weight == weight) it.copy(pairs = pairs) else it })

    /**
     * The same inventory with the 55s on ([pairs] of them) or off ([pairs] null). The row goes in heaviest first and keeps
     * its colour when it comes back, which for a first switch-on is the bumper red.
     */
    fun with55(pairs: Double?): PlateSettings {
        val rest = plates.filter { it.weight != OptionalPlate }
        if (pairs == null) return copy(plates = rest)
        val colour = plates.firstOrNull { it.weight == OptionalPlate }?.color?.ifEmpty { null } ?: Plate55Color
        return copy(plates = listOf(PlateEntry(OptionalPlate, PlatePairs.Count(pairs), colour)) + rest)
    }

    companion object {
        const val DefaultBar = 45.0
        const val DefaultEzBar = 25.0
        const val OptionalPlate = 55.0
        const val Plate55Color = "red"

        /** The bars the default can be: the full bar and the lighter one. */
        val DefaultBarChoices = listOf(45.0, 35.0)

        /** What a bar can weigh at all; the setters refuse anything outside it. */
        val BarRange = 1.0..100.0
    }
}

/** The equipment the lifter owns, which the warm-up builds around. */
data class OwnedEquipment(
    val foamRoller: Boolean = true,
    val percussion: Boolean = true,
    val bike: Boolean = true,
    val rower: Boolean = false,
    val treadmill: Boolean = false,
) {
    fun owns(item: EquipmentItem): Boolean = when (item) {
        EquipmentItem.FoamRoller -> foamRoller
        EquipmentItem.Percussion -> percussion
        EquipmentItem.Bike -> bike
        EquipmentItem.Rower -> rower
        EquipmentItem.Treadmill -> treadmill
    }

    fun with(item: EquipmentItem, owned: Boolean): OwnedEquipment = when (item) {
        EquipmentItem.FoamRoller -> copy(foamRoller = owned)
        EquipmentItem.Percussion -> copy(percussion = owned)
        EquipmentItem.Bike -> copy(bike = owned)
        EquipmentItem.Rower -> copy(rower = owned)
        EquipmentItem.Treadmill -> copy(treadmill = owned)
    }
}

/** One thing the lifter can own; [leaf] is its name in the `equipment` group. */
enum class EquipmentItem(val leaf: String) {
    FoamRoller("foamRoller"),
    Percussion("percussion"),
    Bike("bike"),
    Rower("rower"),
    Treadmill("treadmill"),
}

/** How the warm-up is built. [minutes] is the time for the cardio, soft tissue and mobility blocks; the ramp sets are extra. */
data class WarmupSettings(
    val enabled: Boolean = true,
    val softTissue: Boolean = true,
    val preferPercussion: Boolean = true,
    val minutes: Int = 15,
) {
    companion object {
        /** What the time can be set to. */
        val MinutesRange = 3..60
    }
}

/** What logging a set does. */
data class RestSettings(
    /** Logging a set opens Rest. Off, the logger just moves to the next set. */
    val auto: Boolean = true,
    /** The plates for a set show on its row, on Rest and on the warm-up's ramp steps. */
    val showPlates: Boolean = true,
)

/** Everything the lifting flow reads from Settings besides the weight unit. */
data class GymSettings(
    val plates: PlateSettings = PlateSettings(),
    val equipment: OwnedEquipment = OwnedEquipment(),
    val warmup: WarmupSettings = WarmupSettings(),
    val rest: RestSettings = RestSettings(),
) {
    companion object {
        /** Reads the typed settings from the leaves of each group; a group, leaf or value that is missing or unreadable takes its default. */
        fun from(groups: Map<String, JsonObject>): GymSettings {
            val plates = PlateSettings()
            val bars = groups[SettingsGroups.PLATES]
            val equipment = groups[SettingsGroups.EQUIPMENT]
            val warmup = groups[SettingsGroups.WARMUP]
            val rest = groups[SettingsGroups.REST]
            val owned = OwnedEquipment()
            val build = WarmupSettings()
            val auto = RestSettings()
            return GymSettings(
                plates = PlateSettings(
                    defaultBar = bars.leaf("defaultBar", Double.serializer(), plates.defaultBar).takeIf { it in PlateSettings.BarRange } ?: plates.defaultBar,
                    ezBar = bars.leaf("ezBar", Double.serializer(), plates.ezBar).takeIf { it in PlateSettings.BarRange } ?: plates.ezBar,
                    plates = bars.leaf("plates", ListSerializer(PlateEntry.serializer()), plates.plates),
                ),
                equipment = OwnedEquipment(
                    foamRoller = equipment.leaf("foamRoller", Boolean.serializer(), owned.foamRoller),
                    percussion = equipment.leaf("percussion", Boolean.serializer(), owned.percussion),
                    bike = equipment.leaf("bike", Boolean.serializer(), owned.bike),
                    rower = equipment.leaf("rower", Boolean.serializer(), owned.rower),
                    treadmill = equipment.leaf("treadmill", Boolean.serializer(), owned.treadmill),
                ),
                warmup = WarmupSettings(
                    enabled = warmup.leaf("enabled", Boolean.serializer(), build.enabled),
                    softTissue = warmup.leaf("softTissue", Boolean.serializer(), build.softTissue),
                    preferPercussion = warmup.leaf("preferPercussion", Boolean.serializer(), build.preferPercussion),
                    minutes = warmup.leaf("minutes", Int.serializer(), build.minutes).coerceIn(WarmupSettings.MinutesRange),
                ),
                rest = RestSettings(
                    auto = rest.leaf("auto", Boolean.serializer(), auto.auto),
                    showPlates = rest.leaf("showPlates", Boolean.serializer(), auto.showPlates),
                ),
            )
        }

        private fun <T> JsonObject?.leaf(name: String, serializer: KSerializer<T>, default: T): T {
            val value = this?.get(name) ?: return default
            return try {
                QalaJson.decodeFromJsonElement(serializer, value)
            } catch (e: IllegalArgumentException) {
                default      // SerializationException is one: a leaf of the wrong shape
            }
        }
    }
}
