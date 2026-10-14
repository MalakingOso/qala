package com.qala.data.repo

import com.qala.data.QalaJson
import com.qala.data.core.PlateEntry
import com.qala.data.db.QalaDatabase
import com.qala.data.db.SettingsEntity
import com.qala.data.model.EquipmentItem
import com.qala.data.model.GymSettings
import com.qala.data.model.PlateSettings
import com.qala.data.model.RunPlan
import com.qala.data.model.RunPlanDay
import com.qala.data.model.SettingsRecord
import com.qala.data.model.WarmupSettings
import com.qala.data.model.WeightUnit
import com.qala.data.sync.RecordType
import com.qala.data.sync.RecordWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The settings groups in use. A group is one record; each leaf is a clocked field of it. */
object SettingsGroups {
    /** `unit`, `mainLifts`, `trainingWeekdays`: the leaves of qala-core's `SettingsRecord`. */
    const val TRAINING = "training"

    /** `days`: the run plan, a JSON list of [RunPlanDay]. */
    const val RUN_PLAN = "runPlan"

    /** `exerciseData`: LS++ `ISettings.exerciseData`, the 1RMs that percentage weights resolve against. */
    const val LSPP = "lspp"

    /** `defaultBar`, `ezBar` and `plates` (a JSON list of `PlateEntry`): what the plate math plans with. See [GymSettings]. */
    const val PLATES = "plates"

    /** One boolean per [EquipmentItem]: what the lifter owns. */
    const val EQUIPMENT = "equipment"

    /** `enabled`, `softTissue`, `preferPercussion`, `minutes`: how the warm-up is built. */
    const val WARMUP = "warmup"

    /** `auto` (logging a set opens Rest) and `showPlates` (plate hints are shown). */
    const val REST = "rest"

    fun id(group: String) = "settings-$group"
}

/** Settings as live reads of the groups and suspend writes of single leaves. */
class SettingsRepository(
    private val db: QalaDatabase,
    private val writer: RecordWriter,
    private val env: RepoEnv = RepoEnv(),
) {
    private val groups: Flow<Map<String, JsonObject>> = db.settingsDao().observeAll()
        .map { rows -> rows.associate { it.id.removePrefix("settings-") to leaves(it) } }
        .flowOn(Dispatchers.Default)

    /** The settings the Rust core reads; leaves never written take the core's defaults. */
    val settings: Flow<SettingsRecord> = groups
        .map { g -> g[SettingsGroups.TRAINING]?.let { QalaJson.decodeFromJsonElement(SettingsRecord.serializer(), it) } ?: SettingsRecord() }
        .distinctUntilChanged()
        .flowOn(Dispatchers.Default)

    val runPlan: Flow<RunPlan> = groups
        .map { g ->
            val days = g[SettingsGroups.RUN_PLAN]?.get("days")
            if (days == null || days is JsonNull) RunPlan() else RunPlan(QalaJson.decodeFromJsonElement(ListSerializer(RunPlanDay.serializer()), days))
        }
        .distinctUntilChanged()
        .flowOn(Dispatchers.Default)

    /** Bars, plates, equipment, warm-up and rest settings; every leaf never written takes its default. */
    val gym: Flow<GymSettings> = groups
        .map { g -> GymSettings.from(g) }
        .distinctUntilChanged()
        .flowOn(Dispatchers.Default)

    /** LS++ `exerciseData` (1RMs per exercise), an empty object until set. */
    val exerciseData: Flow<JsonObject> = groups
        .map { g -> (g[SettingsGroups.LSPP]?.get("exerciseData") as? JsonObject) ?: JsonObject(emptyMap()) }
        .distinctUntilChanged()
        .flowOn(Dispatchers.Default)

    suspend fun setUnit(unit: WeightUnit) =
        leaf(SettingsGroups.TRAINING, "unit", QalaJson.encodeToJsonElement(WeightUnit.serializer(), unit))

    /** 0 is Monday, 6 is Sunday. */
    suspend fun setTrainingWeekdays(days: List<Int>) {
        require(days.all { it in 0..6 }) { "weekdays are 0 (Monday) to 6 (Sunday)" }
        leaf(SettingsGroups.TRAINING, "trainingWeekdays", QalaJson.encodeToJsonElement(ListSerializer(Int.serializer()), days.sorted().distinct()))
    }

    suspend fun setMainLifts(exerciseIds: List<String>) =
        leaf(SettingsGroups.TRAINING, "mainLifts", QalaJson.encodeToJsonElement(ListSerializer(String.serializer()), exerciseIds))

    suspend fun setRunPlan(plan: RunPlan) {
        require(plan.days.all { it.dayOfWeek in 0..6 && it.distanceM >= 0 }) { "a run plan day needs a weekday 0..6 and a distance" }
        leaf(SettingsGroups.RUN_PLAN, "days", QalaJson.encodeToJsonElement(ListSerializer(RunPlanDay.serializer()), plan.days))
    }

    suspend fun setExerciseData(exerciseData: JsonObject) = leaf(SettingsGroups.LSPP, "exerciseData", exerciseData)

    // ---- bars and plates ----

    /** The bar every barbell lift is planned with; the screen offers 45 and 35. */
    suspend fun setDefaultBar(weight: Double) {
        require(weight in PlateSettings.BarRange) { "a bar weighs ${PlateSettings.BarRange}" }
        leaf(SettingsGroups.PLATES, "defaultBar", JsonPrimitive(weight))
    }

    suspend fun setEzBar(weight: Double) {
        require(weight in PlateSettings.BarRange) { "a bar weighs ${PlateSettings.BarRange}" }
        leaf(SettingsGroups.PLATES, "ezBar", JsonPrimitive(weight))
    }

    /** The whole inventory, one row a plate weight; the list is one field, so a write replaces it. */
    suspend fun setPlates(plates: List<PlateEntry>) {
        require(plates.all { it.weight > 0.0 }) { "a plate weighs something" }
        require(plates.map { it.weight }.distinct().size == plates.size) { "one row for each plate weight" }
        leaf(SettingsGroups.PLATES, "plates", QalaJson.encodeToJsonElement(ListSerializer(PlateEntry.serializer()), plates))
    }

    // ---- equipment ----

    suspend fun setOwned(item: EquipmentItem, owned: Boolean) = leaf(SettingsGroups.EQUIPMENT, item.leaf, JsonPrimitive(owned))

    // ---- warm-up ----

    /** Off, the warm-up builds no cardio, soft tissue or mobility; the ramp sets stay. */
    suspend fun setWarmupEnabled(on: Boolean) = leaf(SettingsGroups.WARMUP, "enabled", JsonPrimitive(on))

    suspend fun setSoftTissue(on: Boolean) = leaf(SettingsGroups.WARMUP, "softTissue", JsonPrimitive(on))

    suspend fun setPreferPercussion(on: Boolean) = leaf(SettingsGroups.WARMUP, "preferPercussion", JsonPrimitive(on))

    suspend fun setWarmupMinutes(minutes: Int) {
        require(minutes in WarmupSettings.MinutesRange) { "a warm-up takes ${WarmupSettings.MinutesRange} minutes" }
        leaf(SettingsGroups.WARMUP, "minutes", JsonPrimitive(minutes))
    }

    // ---- rest ----

    suspend fun setAutoRest(on: Boolean) = leaf(SettingsGroups.REST, "auto", JsonPrimitive(on))

    suspend fun setShowPlates(on: Boolean) = leaf(SettingsGroups.REST, "showPlates", JsonPrimitive(on))

    /**
     * Writes one after another, in the order they reach this lock. A caller that launches its writes undispatched from the
     * main thread (a stepper tapped twice fast) therefore gets them stored in tap order, so a slow first write never lands
     * over a faster second one.
     */
    private val writes = Mutex()

    private suspend fun leaf(group: String, leaf: String, value: JsonElement) = writes.withLock {
        withContext(env.work) {
            writer.put(RecordType.SETTINGS, SettingsGroups.id(group), mapOf(leaf to value))
        }
    }

    private fun leaves(row: SettingsEntity): JsonObject =
        (QalaJson.parseToJsonElement(row.valuesJson) as JsonObject)
}
