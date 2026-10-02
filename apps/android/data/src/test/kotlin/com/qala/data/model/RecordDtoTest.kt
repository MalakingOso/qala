package com.qala.data.model

import com.qala.data.IsoTime
import com.qala.data.QalaJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The DTOs against the serde shapes of qala-core/records.rs: tag, spelling, optionality. The Rust side
 * accepting what these write is tested through the FFI in RustBoundaryTest; this pins the JSON text.
 */
class RecordDtoTest {
    private fun lift() = LiftSessionRecord(
        id = "6f0c3a52-7c0e-4b8f-9d1b-2a5e1d0c9a11",
        startedAt = "2026-10-02T17:30:00-04:00",
        programDayIndex = 2,
        minutes = 74.5,
        srpe = 7.5,
        entries = listOf(
            LiftEntryRecord(
                "squat",
                listOf(
                    LiftSetRecord(225.5, WeightUnit.Lb, 4.5, rpe = 8.5, targetRpe = 8.0, completed = true),
                    LiftSetRecord(102.5, WeightUnit.Kg, 1.0, rpe = 10.0, completed = true, tested1rm = true, jointPain = true),
                ),
            ),
            LiftEntryRecord("benchPress"),
        ),
    )

    @Test
    fun aSessionIsTaggedOnKindWithTheRustSpellings() {
        val json = QalaJson.encodeToJsonElement(SessionRecord.serializer(), lift()).jsonObject
        assertEquals("lift", json.getValue("kind").jsonPrimitive.content)
        assertEquals("2026-10-02T17:30:00-04:00", json.getValue("startedAt").jsonPrimitive.content)
        assertEquals(2.0, json.getValue("programDayIndex").jsonPrimitive.double, 0.0)
        assertFalse(json.getValue("stub").jsonPrimitive.boolean)
        val set = json.getValue("entries").jsonArray[0].jsonObject.getValue("sets").jsonArray[1].jsonObject
        assertEquals("kg", set.getValue("unit").jsonPrimitive.content)
        assertTrue("tested1rm, not tested1Rm", set.getValue("tested1rm").jsonPrimitive.boolean)
        assertTrue(set.getValue("jointPain").jsonPrimitive.boolean)
        assertFalse("an absent target rpe is left out", "targetRpe" in set)
        assertEquals(setOf("benchPress"), setOf(json.getValue("entries").jsonArray[1].jsonObject.getValue("exerciseId").jsonPrimitive.content))
    }

    @Test
    fun aRunIsTaggedRunAndLeavesOutWhatItDoesNotHave() {
        val run = RunRecord("r1", "2026-10-03T07:05:00-04:00", distanceM = 8046.7, elapsedSec = 2711.5)
        val json = QalaJson.encodeToJsonElement(SessionRecord.serializer(), run).jsonObject
        assertEquals("run", json.getValue("kind").jsonPrimitive.content)
        for (absent in listOf("movingSec", "srpe", "minutes", "hrTrimp", "gradeProfile", "descentM")) assertFalse(absent, absent in json)
        assertEquals(setOf("kind", "id", "startedAt", "distanceM", "elapsedSec", "stub"), json.keys)
    }

    @Test
    fun recordsReadBackFromTheirOwnJson() {
        for (record in listOf<SessionRecord>(lift(), RunRecord("r1", "2026-10-03T07:05:00-04:00", 5000.0, 1500.0, 1700.0, false, 6.0, 28.0, 60.0, listOf(GradeSegment(0.01, 4000.0)), 12.0))) {
            val text = QalaJson.encodeToString(SessionRecord.serializer(), record)
            assertEquals(record, QalaJson.decodeFromString(SessionRecord.serializer(), text))
        }
    }

    @Test
    fun aSparseRecordFromRustOrAnotherClientStillReads() {
        val stub = QalaJson.decodeFromString(
            SessionRecord.serializer(),
            """{"kind":"lift","id":"s1","startedAt":"2026-10-02T17:30:00-04:00","programDayIndex":0,"stub":true,"somethingNew":{"a":1}}""",
        )
        assertTrue(stub.stub)
        assertEquals(emptyList<LiftEntryRecord>(), (stub as LiftSessionRecord).entries)
        val set = QalaJson.decodeFromString(LiftSetRecord.serializer(), """{"weight":100,"unit":"kg","reps":5}""")
        assertFalse(set.completed || set.warmup || set.tested1rm || set.jointPain)
        assertNull(set.rpe)
    }

    @Test
    fun checkInBodyWeightAndSettingsMatchTheirRustShapes() {
        val c = CheckInRecord("c1", "2026-10-02T07:10:00-04:00", 7.5, mapOf("quads" to 2, "lats" to 1), "slept badly")
        val cj = QalaJson.encodeToJsonElement(CheckInRecord.serializer(), c).jsonObject
        assertEquals(JsonObject(mapOf("quads" to JsonPrimitive(2), "lats" to JsonPrimitive(1))), cj.getValue("soreness"))
        assertEquals("slept badly", cj.getValue("note").jsonPrimitive.content)
        assertFalse("note" in QalaJson.encodeToJsonElement(CheckInRecord.serializer(), c.copy(note = null)).jsonObject)

        assertEquals(
            JsonObject(mapOf("id" to JsonPrimitive("w1"), "date" to JsonPrimitive("2026-10-02"), "kg" to JsonPrimitive(81.35))),
            QalaJson.encodeToJsonElement(BodyWeightRecord.serializer(), BodyWeightRecord("w1", "2026-10-02", 81.35)),
        )

        val s = QalaJson.encodeToJsonElement(SettingsRecord.serializer(), SettingsRecord()).jsonObject
        assertEquals("lb", s.getValue("unit").jsonPrimitive.content)
        assertEquals(JsonArray(listOf(0, 2, 4, 5).map(::JsonPrimitive)), s.getValue("trainingWeekdays"))
        assertEquals(SettingsRecord(), QalaJson.decodeFromString(SettingsRecord.serializer(), "{}"))
    }

    @Test
    fun availabilityAndSkipUseLowercaseNames() {
        val skip = QalaJson.encodeToJsonElement(DaySkip.serializer(), DaySkip("2026-10-04", SkipReason.Injured, "calves")).jsonObject
        assertEquals("injured", skip.getValue("reason").jsonPrimitive.content)
        assertFalse("note" in skip)
        val a = QalaJson.encodeToJsonElement(Availability.serializer(), Availability(AvailabilityStatus.Vacation, "2026-10-05")).jsonObject
        assertEquals("vacation", a.getValue("status").jsonPrimitive.content)
        assertEquals(SkipReason.Vacation, AvailabilityStatus.Vacation.skipReason)
        assertNull(AvailabilityStatus.Active.skipReason)
        for (r in SkipReason.entries) {
            assertEquals(r, SkipReason.entries.first { it.wire() == QalaJson.encodeToJsonElement(SkipReason.serializer(), r).jsonPrimitive.content })
        }
    }

    // ---- ISO time at the boundary ----

    @Test
    fun isoCarriesTheOffsetItWasWrittenAt() {
        assertEquals("2026-10-02T17:30:00-04:00", IsoTime.format(1_790_976_600_000, -240))
        assertEquals("2026-10-02T21:30:00Z", IsoTime.format(1_790_976_600_000, 0))
        assertEquals("2026-10-03T03:00:00+05:30", IsoTime.format(1_790_976_600_000, 330))
        assertEquals("2026-10-02T17:30:00.123-04:00", IsoTime.format(1_790_976_600_123, -240))
    }

    @Test
    fun theLocalDateFollowsTheOffsetNotUtc() {
        val ms = 1_790_976_600_000 // 2026-10-02T21:30:00Z
        assertEquals("2026-10-02", IsoTime.localDateKey(ms, -240))
        assertEquals("2026-10-03", IsoTime.localDateKey(ms, 330))
        assertEquals("2026-10-03", IsoTime.addDays("2026-10-02", 1))
        assertEquals("2026-10-01", IsoTime.addDays("2026-10-02", -1))
        assertEquals(4, IsoTime.weekdayIndex("2026-10-02")) // a Friday
        assertEquals("2026-09-28", IsoTime.weekStart("2026-10-02"))
        assertEquals("2026-09-28", IsoTime.weekStart("2026-09-28"))
        assertEquals("2026-09-28", IsoTime.weekStart("2026-10-04"))
    }
}
