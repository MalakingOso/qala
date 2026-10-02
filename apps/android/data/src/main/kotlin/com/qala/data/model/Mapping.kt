package com.qala.data.model

import com.qala.data.IsoTime
import com.qala.data.QalaJson
import com.qala.data.db.AvailabilityEntity
import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftEntryEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftSetEntity
import com.qala.data.db.RunSessionEntity
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject

/*
 * Rows to the Rust-shaped DTOs. Instants become ISO 8601 with the offset the row was written at. The
 * tombstone flag has no Rust counterpart; callers read only live rows (the DAOs filter) before converting.
 */

internal fun LiftSetEntity.toRecord() = LiftSetRecord(
    weight = weight,
    unit = if (unit == "kg") WeightUnit.Kg else WeightUnit.Lb,
    reps = reps,
    rpe = rpe,
    targetRpe = targetRpe,
    completed = completed,
    warmup = warmup,
    tested1rm = tested1rm,
    jointPain = jointPain,
)

/** The nested entries of a session, in position order. */
fun LiftSessionWithEntries.entryRecords(): List<LiftEntryRecord> =
    entries.sortedBy { it.entry.position }.map { e ->
        LiftEntryRecord(e.entry.exerciseId, e.sets.sortedBy { it.position }.map { it.toRecord() })
    }

fun LiftSessionWithEntries.toRecord() = LiftSessionRecord(
    id = session.id,
    startedAt = IsoTime.format(session.startedAtMs, session.offsetMin),
    programDayIndex = session.programDayIndex,
    stub = session.stub,
    minutes = session.minutes,
    srpe = session.srpe,
    entries = entryRecords(),
)

/** The typed child rows for a session's `entries` field. Ids are positional, so a rewrite reuses them. */
internal fun childRows(sessionId: String, entries: List<LiftEntryRecord>): Pair<List<LiftEntryEntity>, List<LiftSetEntity>> {
    val entryRows = ArrayList<LiftEntryEntity>(entries.size)
    val setRows = ArrayList<LiftSetEntity>()
    entries.forEachIndexed { i, entry ->
        val entryId = "$sessionId/$i"
        entryRows += LiftEntryEntity(entryId, sessionId, i, entry.exerciseId)
        entry.sets.forEachIndexed { j, set ->
            setRows += LiftSetEntity(
                id = "$entryId/$j",
                entryId = entryId,
                position = j,
                weight = set.weight,
                unit = if (set.unit == WeightUnit.Kg) "kg" else "lb",
                reps = set.reps,
                rpe = set.rpe,
                targetRpe = set.targetRpe,
                completed = set.completed,
                warmup = set.warmup,
                tested1rm = set.tested1rm,
                jointPain = set.jointPain,
            )
        }
    }
    return entryRows to setRows
}

fun RunSessionEntity.toRecord() = RunRecord(
    id = id,
    startedAt = IsoTime.format(startedAtMs, offsetMin),
    distanceM = distanceM,
    movingSec = movingSec,
    elapsedSec = elapsedSec,
    stub = stub,
    srpe = srpe,
    minutes = minutes,
    hrTrimp = hrTrimp,
    gradeProfile = gradeProfileJson?.let { QalaJson.decodeFromJsonElement<List<GradeSegment>>(QalaJson.parseToJsonElement(it)) },
    descentM = descentM,
)

fun CheckInEntity.toRecord() = CheckInRecord(
    id = id,
    at = IsoTime.format(atMs, offsetMin),
    recovery = recovery,
    soreness = QalaJson.parseToJsonElement(sorenessJson).jsonObject.mapValues { (_, v) ->
        QalaJson.decodeFromJsonElement<Int>(v)
    },
    note = note,
)

fun BodyWeightEntity.toRecord() = BodyWeightRecord(id = id, date = date, kg = kg)

fun DaySkipEntity.toModel() = DaySkip(
    date = date,
    // A reason this client does not know (a newer writer) reads as a break: it rests in place and never shifts.
    reason = SkipReason.entries.firstOrNull { it.wire() == reason } ?: SkipReason.Break,
    muscle = muscle,
    note = note,
)

fun AvailabilityEntity.toModel() = Availability(
    status = AvailabilityStatus.entries.firstOrNull { it.wire() == status } ?: AvailabilityStatus.Active,
    since = since,
    until = until,
    muscle = muscle,
    note = note,
)

/** The lowercase wire name of a skip reason, as stored in `day_skip.reason`. */
fun SkipReason.wire(): String = when (this) {
    SkipReason.Break -> "break"
    SkipReason.Vacation -> "vacation"
    SkipReason.Sick -> "sick"
    SkipReason.Injured -> "injured"
    SkipReason.Scheduling -> "scheduling"
}

/** The lowercase wire name of an availability status, as stored in `availability.status`. */
fun AvailabilityStatus.wire(): String = when (this) {
    AvailabilityStatus.Active -> "active"
    AvailabilityStatus.Break -> "break"
    AvailabilityStatus.Vacation -> "vacation"
    AvailabilityStatus.Sick -> "sick"
    AvailabilityStatus.Injured -> "injured"
    AvailabilityStatus.Scheduling -> "scheduling"
}
