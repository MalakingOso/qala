package com.qala.data.sync

import com.qala.data.db.AvailabilityEntity
import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.ProgramEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.db.SettingsEntity
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.model.WeightUnit
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Each codec turns a row into its clocked fields and back. The check is the same for every type: the fields
 * of a fully filled row, applied one by one to a blank row, give the row back. That is what both a remote
 * apply and the create path rely on.
 */
class FieldCodecsTest {
    private fun <E> roundTrips(codec: FieldCodec<E>, id: String, entity: E) {
        val fields = codec.toFields(entity)
        if (codec.fields.isNotEmpty()) assertEquals("canonical order", codec.fields, fields.keys.toList())
        assertEquals("deleted is written last", DELETED, fields.keys.last())
        var rebuilt = codec.blank(id)
        for ((field, value) in fields) rebuilt = codec.withField(rebuilt, field, value)
        assertEquals(entity, rebuilt)
        // And the map of the rebuilt row is the same map.
        assertEquals(fields, codec.toFields(rebuilt))
    }

    @Test
    fun checkIn() = roundTrips(
        CheckInCodec, "c1",
        CheckInEntity("c1", 1_790_000_000_000, -240, 7.5, """{"quads":2,"lats":1}""", "slept badly", false),
    )

    @Test
    fun checkInWithNoNote() = roundTrips(CheckInCodec, "c2", CheckInEntity("c2", 5, 0, 4.0, "{}", null, true))

    @Test
    fun bodyWeight() = roundTrips(BodyWeightCodec, "w1", BodyWeightEntity("w1", "2026-10-02", 81.35, false))

    @Test
    fun daySkip() = roundTrips(DaySkipCodec, "skip-2026-10-04", DaySkipEntity("skip-2026-10-04", "2026-10-04", "injured", "calves", "tight", false))

    @Test
    fun availability() = roundTrips(
        AvailabilityCodec, "availability",
        AvailabilityEntity("availability", "vacation", "2026-10-05", "2026-10-12", null, "beach", false),
    )

    @Test
    fun program() = roundTrips(ProgramCodec, "p1", ProgramEntity("p1", "gzclp.md", "# Week 1\n## Day 1\nt1: Squat / 3x5\n", false))

    @Test
    fun run() = roundTrips(
        RunSessionCodec, "r1",
        RunSessionEntity(
            "r1", 1_790_000_000_000, -240, 8046.7, 2580.0, 2711.5, false, 6.0, 45.2, 71.3,
            """[{"grade":0.012,"meters":4000.0},{"grade":-0.06,"meters":1500.5}]""", 90.03, "felt fine", false,
        ),
    )

    @Test
    fun stubRun() = roundTrips(
        RunSessionCodec, "r2",
        RunSessionEntity("r2", 1_790_000_000_000, -240, 0.0, null, 0.0, true, null, null, null, null, null, null, false),
    )

    @Test
    fun liftSessionCarriesItsEntriesAsOneField() {
        val entries = listOf(
            LiftEntryRecord(
                "squat",
                listOf(
                    LiftSetRecord(135.0, WeightUnit.Lb, 5.0, completed = true, warmup = true),
                    LiftSetRecord(225.5, WeightUnit.Lb, 4.5, rpe = 8.5, targetRpe = 8.0, completed = true),
                ),
            ),
            LiftEntryRecord("benchPress"),
        )
        val bundle = LiftSessionBundle(
            LiftSessionEntity("s1", 1_790_000_000_000, -240, 2, false, null, 74.5, 7.5, "heavy", false),
            entries,
        )
        roundTrips(LiftSessionCodec, "s1", bundle)

        val value = LiftSessionCodec.toFields(bundle).getValue("entries").toString()
        assertTrue(value, value.startsWith("""[{"exerciseId":"squat","sets":[{"weight":135.0,"unit":"lb","reps":5.0"""))
        assertTrue(value, value.contains(""""tested1rm":false"""))
        assertTrue("a null rpe is left out, like serde's skip_serializing_if", !value.substringBefore("225.5").contains("rpe"))
    }

    @Test
    fun stubSessionKeepsItsStage() = roundTrips(
        LiftSessionCodec, "s2",
        LiftSessionBundle(LiftSessionEntity("s2", 1_790_000_000_000, -240, 1, true, "warmup", null, null, null, false), emptyList()),
    )

    @Test
    fun settingsLeavesAreMergedIntoOneRow() {
        var row = SettingsCodec.blank("settings-training")
        row = SettingsCodec.withField(row, "unit", JsonPrimitive("kg"))
        row = SettingsCodec.withField(row, "trainingWeekdays", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(1), JsonPrimitive(3))))
        row = SettingsCodec.withField(row, "unit", JsonPrimitive("lb"))
        val fields = SettingsCodec.toFields(row)
        assertEquals(listOf("unit", "trainingWeekdays", DELETED), fields.keys.toList())
        assertEquals(JsonPrimitive("lb"), fields["unit"])
        assertEquals(SettingsEntity("settings-training", """{"unit":"lb","trainingWeekdays":[1,3]}""", false), row)
    }

    @Test
    fun anUnknownFieldLeavesTheRowAlone() {
        val c = CheckInEntity("c1", 1, 0, 5.0, "{}", null, false)
        assertEquals(c, CheckInCodec.withField(c, "futureField", JsonPrimitive(1)))
        assertTrue(CheckInCodec.isKnown("note") && !CheckInCodec.isKnown("futureField"))
        assertTrue(SettingsCodec.isKnown("anything"))
    }

    @Test
    fun aNullClearsAnOptionalColumn() {
        val s = LiftSessionBundle(LiftSessionEntity("s", 1, 0, 3, false, "lift", 60.0, 7.0, "n", false), emptyList())
        val cleared = LiftSessionCodec.withField(LiftSessionCodec.withField(s, "notes", JsonNull), "programDayIndex", JsonNull)
        assertEquals(null, cleared.session.notes)
        assertEquals(null, cleared.session.programDayIndex)
    }

    @Test
    fun everyRecordTypeNamesItsFields() {
        for (type in RecordType.entries) {
            val known = knownFields(type)
            if (type == RecordType.SETTINGS) assertEquals(null, known) else assertEquals(DELETED, known!!.last())
        }
    }
}
