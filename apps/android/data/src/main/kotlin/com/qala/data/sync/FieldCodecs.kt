package com.qala.data.sync

import com.qala.data.QalaJson
import com.qala.data.bool
import com.qala.data.db.AvailabilityEntity
import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.ProgramEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.db.SettingsEntity
import com.qala.data.double
import com.qala.data.doubleOrNull
import com.qala.data.int
import com.qala.data.intOrNull
import com.qala.data.long
import com.qala.data.model.LiftEntryRecord
import com.qala.data.string
import com.qala.data.stringOrNull
import com.qala.data.toJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

/*
 * How each record type maps to its clocked fields. The writer works on field maps (name to JSON value); a
 * codec turns a typed row into that map and applies a field value back onto a row. Field names and value
 * shapes here are what the outbox carries and what the sync endpoint will mirror, so they follow
 * qala-core's `records.rs` for the fields the core reads (`startedAt` is the pair `startedAtMs` and
 * `offsetMin`, `entries` is one field holding the nested sets).
 *
 * Maps are in canonical order, `deleted` last, which is the order the outbox rows of an insert get.
 */

/** The typed mapping of one record type to and from its clocked fields. */
internal interface FieldCodec<E> {
    /** Canonical field order, `deleted` last. Empty when the field names are open (settings leaves). */
    val fields: List<String>

    /** A row with every field at its zero value, for a remote write that arrives before the rest of the record. */
    fun blank(id: String): E

    fun toFields(entity: E): LinkedHashMap<String, JsonElement>

    /** [entity] with one field written. A field this codec does not know leaves it unchanged. */
    fun withField(entity: E, field: String, value: JsonElement): E

    fun isKnown(field: String): Boolean = fields.isEmpty() || field in fields
}

internal const val DELETED = "deleted"

/** A session row plus the value of its `entries` field. The typed child rows are derived from the entries. */
internal data class LiftSessionBundle(val session: LiftSessionEntity, val entries: List<LiftEntryRecord>)

internal object LiftSessionCodec : FieldCodec<LiftSessionBundle> {
    override val fields = listOf(
        "startedAtMs", "offsetMin", "programDayIndex", "stub", "stage", "minutes", "srpe", "notes", "entries", DELETED,
    )

    override fun blank(id: String) =
        LiftSessionBundle(LiftSessionEntity(id, 0, 0, null, false, null, null, null, null, false), emptyList())

    override fun toFields(entity: LiftSessionBundle): LinkedHashMap<String, JsonElement> {
        val s = entity.session
        return linkedMapOf(
            "startedAtMs" to s.startedAtMs.toJson(),
            "offsetMin" to s.offsetMin.toJson(),
            "programDayIndex" to s.programDayIndex.toJson(),
            "stub" to s.stub.toJson(),
            "stage" to s.stage.toJson(),
            "minutes" to s.minutes.toJson(),
            "srpe" to s.srpe.toJson(),
            "notes" to s.notes.toJson(),
            "entries" to QalaJson.encodeToJsonElement(entity.entries),
            DELETED to s.deleted.toJson(),
        )
    }

    override fun withField(entity: LiftSessionBundle, field: String, value: JsonElement): LiftSessionBundle {
        val s = entity.session
        return when (field) {
            "startedAtMs" -> entity.copy(session = s.copy(startedAtMs = value.long()))
            "offsetMin" -> entity.copy(session = s.copy(offsetMin = value.int()))
            "programDayIndex" -> entity.copy(session = s.copy(programDayIndex = value.intOrNull()))
            "stub" -> entity.copy(session = s.copy(stub = value.bool()))
            "stage" -> entity.copy(session = s.copy(stage = value.stringOrNull()))
            "minutes" -> entity.copy(session = s.copy(minutes = value.doubleOrNull()))
            "srpe" -> entity.copy(session = s.copy(srpe = value.doubleOrNull()))
            "notes" -> entity.copy(session = s.copy(notes = value.stringOrNull()))
            "entries" -> entity.copy(
                entries = if (value is JsonNull) emptyList() else QalaJson.decodeFromJsonElement<List<LiftEntryRecord>>(value),
            )
            DELETED -> entity.copy(session = s.copy(deleted = value.bool()))
            else -> entity
        }
    }
}

internal object RunSessionCodec : FieldCodec<RunSessionEntity> {
    override val fields = listOf(
        "startedAtMs", "offsetMin", "distanceM", "movingSec", "elapsedSec", "stub", "srpe", "minutes", "hrTrimp",
        "gradeProfile", "descentM", "notes", DELETED,
    )

    override fun blank(id: String) =
        RunSessionEntity(id, 0, 0, 0.0, null, 0.0, false, null, null, null, null, null, null, false)

    override fun toFields(entity: RunSessionEntity): LinkedHashMap<String, JsonElement> = linkedMapOf(
        "startedAtMs" to entity.startedAtMs.toJson(),
        "offsetMin" to entity.offsetMin.toJson(),
        "distanceM" to entity.distanceM.toJson(),
        "movingSec" to entity.movingSec.toJson(),
        "elapsedSec" to entity.elapsedSec.toJson(),
        "stub" to entity.stub.toJson(),
        "srpe" to entity.srpe.toJson(),
        "minutes" to entity.minutes.toJson(),
        "hrTrimp" to entity.hrTrimp.toJson(),
        "gradeProfile" to (entity.gradeProfileJson?.let { QalaJson.parseToJsonElement(it) } ?: JsonNull),
        "descentM" to entity.descentM.toJson(),
        "notes" to entity.notes.toJson(),
        DELETED to entity.deleted.toJson(),
    )

    override fun withField(entity: RunSessionEntity, field: String, value: JsonElement): RunSessionEntity =
        when (field) {
            "startedAtMs" -> entity.copy(startedAtMs = value.long())
            "offsetMin" -> entity.copy(offsetMin = value.int())
            "distanceM" -> entity.copy(distanceM = value.double())
            "movingSec" -> entity.copy(movingSec = value.doubleOrNull())
            "elapsedSec" -> entity.copy(elapsedSec = value.double())
            "stub" -> entity.copy(stub = value.bool())
            "srpe" -> entity.copy(srpe = value.doubleOrNull())
            "minutes" -> entity.copy(minutes = value.doubleOrNull())
            "hrTrimp" -> entity.copy(hrTrimp = value.doubleOrNull())
            "gradeProfile" -> entity.copy(gradeProfileJson = if (value is JsonNull) null else value.toString())
            "descentM" -> entity.copy(descentM = value.doubleOrNull())
            "notes" -> entity.copy(notes = value.stringOrNull())
            DELETED -> entity.copy(deleted = value.bool())
            else -> entity
        }
}

internal object CheckInCodec : FieldCodec<CheckInEntity> {
    override val fields = listOf("atMs", "offsetMin", "recovery", "soreness", "note", DELETED)

    override fun blank(id: String) = CheckInEntity(id, 0, 0, 0.0, "{}", null, false)

    override fun toFields(entity: CheckInEntity): LinkedHashMap<String, JsonElement> = linkedMapOf(
        "atMs" to entity.atMs.toJson(),
        "offsetMin" to entity.offsetMin.toJson(),
        "recovery" to entity.recovery.toJson(),
        "soreness" to QalaJson.parseToJsonElement(entity.sorenessJson),
        "note" to entity.note.toJson(),
        DELETED to entity.deleted.toJson(),
    )

    override fun withField(entity: CheckInEntity, field: String, value: JsonElement): CheckInEntity = when (field) {
        "atMs" -> entity.copy(atMs = value.long())
        "offsetMin" -> entity.copy(offsetMin = value.int())
        "recovery" -> entity.copy(recovery = value.double())
        "soreness" -> entity.copy(sorenessJson = if (value is JsonNull) "{}" else value.toString())
        "note" -> entity.copy(note = value.stringOrNull())
        DELETED -> entity.copy(deleted = value.bool())
        else -> entity
    }
}

internal object BodyWeightCodec : FieldCodec<BodyWeightEntity> {
    override val fields = listOf("date", "kg", DELETED)

    override fun blank(id: String) = BodyWeightEntity(id, "", 0.0, false)

    override fun toFields(entity: BodyWeightEntity): LinkedHashMap<String, JsonElement> = linkedMapOf(
        "date" to entity.date.toJson(),
        "kg" to entity.kg.toJson(),
        DELETED to entity.deleted.toJson(),
    )

    override fun withField(entity: BodyWeightEntity, field: String, value: JsonElement): BodyWeightEntity =
        when (field) {
            "date" -> entity.copy(date = value.string())
            "kg" -> entity.copy(kg = value.double())
            DELETED -> entity.copy(deleted = value.bool())
            else -> entity
        }
}

internal object DaySkipCodec : FieldCodec<DaySkipEntity> {
    override val fields = listOf("date", "reason", "muscle", "note", DELETED)

    override fun blank(id: String) = DaySkipEntity(id, id.removePrefix(DaySkipIds.PREFIX), "break", null, null, false)

    override fun toFields(entity: DaySkipEntity): LinkedHashMap<String, JsonElement> = linkedMapOf(
        "date" to entity.date.toJson(),
        "reason" to entity.reason.toJson(),
        "muscle" to entity.muscle.toJson(),
        "note" to entity.note.toJson(),
        DELETED to entity.deleted.toJson(),
    )

    override fun withField(entity: DaySkipEntity, field: String, value: JsonElement): DaySkipEntity = when (field) {
        "date" -> entity.copy(date = value.string())
        "reason" -> entity.copy(reason = value.string())
        "muscle" -> entity.copy(muscle = value.stringOrNull())
        "note" -> entity.copy(note = value.stringOrNull())
        DELETED -> entity.copy(deleted = value.bool())
        else -> entity
    }
}

object DaySkipIds {
    const val PREFIX = "skip-"

    fun of(date: String) = PREFIX + date
}

internal object AvailabilityCodec : FieldCodec<AvailabilityEntity> {
    override val fields = listOf("status", "since", "until", "muscle", "note", DELETED)

    override fun blank(id: String) = AvailabilityEntity(id, "active", null, null, null, null, false)

    override fun toFields(entity: AvailabilityEntity): LinkedHashMap<String, JsonElement> = linkedMapOf(
        "status" to entity.status.toJson(),
        "since" to entity.since.toJson(),
        "until" to entity.until.toJson(),
        "muscle" to entity.muscle.toJson(),
        "note" to entity.note.toJson(),
        DELETED to entity.deleted.toJson(),
    )

    override fun withField(entity: AvailabilityEntity, field: String, value: JsonElement): AvailabilityEntity =
        when (field) {
            "status" -> entity.copy(status = value.string())
            "since" -> entity.copy(since = value.stringOrNull())
            "until" -> entity.copy(until = value.stringOrNull())
            "muscle" -> entity.copy(muscle = value.stringOrNull())
            "note" -> entity.copy(note = value.stringOrNull())
            DELETED -> entity.copy(deleted = value.bool())
            else -> entity
        }
}

/** A settings group: every leaf of the group is a field, so the field names are open. */
internal object SettingsCodec : FieldCodec<SettingsEntity> {
    override val fields: List<String> = emptyList()

    override fun blank(id: String) = SettingsEntity(id, "{}", false)

    override fun toFields(entity: SettingsEntity): LinkedHashMap<String, JsonElement> {
        val out = LinkedHashMap<String, JsonElement>()
        (QalaJson.parseToJsonElement(entity.valuesJson) as JsonObject).forEach { (leaf, value) -> out[leaf] = value }
        out[DELETED] = entity.deleted.toJson()
        return out
    }

    override fun withField(entity: SettingsEntity, field: String, value: JsonElement): SettingsEntity {
        if (field == DELETED) return entity.copy(deleted = value.bool())
        val leaves = LinkedHashMap((QalaJson.parseToJsonElement(entity.valuesJson) as JsonObject))
        leaves[field] = value
        return entity.copy(valuesJson = JsonObject(leaves).toString())
    }
}

internal object ProgramCodec : FieldCodec<ProgramEntity> {
    override val fields = listOf("name", "text", DELETED)

    override fun blank(id: String) = ProgramEntity(id, "", "", false)

    override fun toFields(entity: ProgramEntity): LinkedHashMap<String, JsonElement> = linkedMapOf(
        "name" to entity.name.toJson(),
        "text" to entity.text.toJson(),
        DELETED to entity.deleted.toJson(),
    )

    override fun withField(entity: ProgramEntity, field: String, value: JsonElement): ProgramEntity = when (field) {
        "name" -> entity.copy(name = value.string())
        "text" -> entity.copy(text = value.string())
        DELETED -> entity.copy(deleted = value.bool())
        else -> entity
    }
}

/** Field names a record of [type] accepts; null when the names are open. */
internal fun knownFields(type: RecordType): List<String>? = when (type) {
    RecordType.LIFT_SESSION -> LiftSessionCodec.fields
    RecordType.RUN_SESSION -> RunSessionCodec.fields
    RecordType.CHECK_IN -> CheckInCodec.fields
    RecordType.BODY_WEIGHT -> BodyWeightCodec.fields
    RecordType.DAY_SKIP -> DaySkipCodec.fields
    RecordType.AVAILABILITY -> AvailabilityCodec.fields
    RecordType.SETTINGS -> null
    RecordType.PROGRAM -> ProgramCodec.fields
}
