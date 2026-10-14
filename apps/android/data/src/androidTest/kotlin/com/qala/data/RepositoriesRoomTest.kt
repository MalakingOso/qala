package com.qala.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.LiftStage
import com.qala.data.db.QalaDatabase
import com.qala.data.model.AvailabilityStatus
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.PlateEntry
import com.qala.data.core.PlatePairs
import com.qala.data.model.EquipmentItem
import com.qala.data.model.GymSettings
import com.qala.data.model.OwnedEquipment
import com.qala.data.model.PlateSettings
import com.qala.data.model.RestSettings
import com.qala.data.model.WarmupSettings
import com.qala.data.model.RunPlan
import com.qala.data.model.RunPlanDay
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.repo.AvailabilityRepository
import com.qala.data.repo.BodyWeightRepository
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.DeviceClock
import com.qala.data.repo.IdSource
import com.qala.data.repo.NewLiftSession
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.RunRepository
import com.qala.data.repo.SessionRepository
import com.qala.data.repo.SettingsRepository
import com.qala.data.repo.StubStage
import com.qala.data.sync.RecordWriter
import com.qala.data.sync.RoomTransactor
import java.time.ZoneId
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Each repository against an in-memory Room database: what it writes, and what its flows then show. */
@RunWith(AndroidJUnit4::class)
class RepositoriesRoomTest {
    private val t0 = 1_790_000_000_000L // 2026-09-21T14:13:20Z, a Monday
    private lateinit var db: QalaDatabase
    private lateinit var env: RepoEnv
    private lateinit var writer: RecordWriter

    @Before
    fun open() {
        db = QalaDatabase.inMemory(ApplicationProvider.getApplicationContext<Context>())
        var n = 0
        env = RepoEnv(
            clock = object : DeviceClock {
                override fun nowMs() = t0
                override val zone: ZoneId = ZoneId.of("America/New_York")
            },
            ids = IdSource { "id-${++n}" },
        )
        writer = RecordWriter(RoomTransactor(db), nowMs = { t0 }, newNodeId = { "node-a" })
    }

    @After
    fun close() = db.close()

    @Test
    fun checkInsAreValidatedStoredAndFilteredWhenDeleted() = runBlocking {
        val repo = CheckInRepository(db, writer, env)
        val id = repo.save(7.5, mapOf("quads" to 2), "ok")
        val row = repo.checkIns.first().single()
        assertEquals(id, row.id)
        assertEquals(-240, row.offsetMin)
        assertEquals("""{"quads":2}""", row.sorenessJson)
        repo.delete(id)
        assertTrue(repo.checkIns.first().isEmpty())
        assertTrue(runCatching { repo.save(11.0) }.isFailure)
        assertTrue(runCatching { repo.save(5.0, mapOf("quads" to 5)) }.isFailure)
    }

    @Test
    fun weightsComeBackByDate() = runBlocking {
        val repo = BodyWeightRepository(db, writer, env)
        repo.log("2026-10-02", 81.0)
        repo.log("2026-10-01", 81.4)
        assertEquals(listOf("2026-10-01", "2026-10-02"), repo.weights.first().map { it.date })
    }

    @Test
    fun aSkipCanBeUndoneAndMadeAgain() = runBlocking {
        val repo = AvailabilityRepository(db, writer, env)
        repo.skip("2026-10-05", SkipReason.Sick, note = "flu")
        assertEquals(listOf("2026-10-05"), repo.skips.first().map { it.date })
        repo.undoSkip("2026-10-05")
        assertTrue(repo.skips.first().isEmpty())
        repo.skip("2026-10-05", SkipReason.Vacation)
        val again = repo.skips.first().single()
        assertEquals("vacation", again.reason)
        assertEquals(null, again.note)
        assertTrue("an injury names a muscle", runCatching { repo.skip("2026-10-06", SkipReason.Injured) }.isFailure)
        repo.undoSkip("2026-10-09") // never skipped: nothing to undo
    }

    @Test
    fun theStatusDefaultsToActiveAndRoundTrips() = runBlocking {
        val repo = AvailabilityRepository(db, writer, env)
        assertEquals(AvailabilityStatus.Active, repo.status.first().status)
        repo.setStatus(AvailabilityStatus.Injured, "2026-10-01", muscle = "calves")
        assertEquals("calves", repo.status.first().muscle)
        repo.clearStatus()
        assertEquals(AvailabilityStatus.Active, repo.status.first().status)
        assertEquals(null, repo.status.first().since)
    }

    @Test
    fun settingsDefaultToTheCoreAndKeepWhatIsWritten() = runBlocking {
        val repo = SettingsRepository(db, writer, env)
        assertEquals(listOf(0, 2, 4, 5), repo.settings.first().trainingWeekdays)
        repo.setTrainingWeekdays(listOf(5, 1, 3, 1))
        repo.setUnit(WeightUnit.Kg)
        val s = repo.settings.first()
        assertEquals(listOf(1, 3, 5), s.trainingWeekdays)
        assertEquals(WeightUnit.Kg, s.unit)
        assertEquals("the core default for a leaf never written", listOf("squat", "benchPress", "deadlift", "overheadPress"), s.mainLifts)

        assertTrue(repo.runPlan.first().days.isEmpty())
        repo.setRunPlan(RunPlan(listOf(RunPlanDay(1, 6437.0))))
        assertEquals(1, repo.runPlan.first().days.single().dayOfWeek)

        repo.setExerciseData(JsonObject(mapOf("squat_barbell" to JsonPrimitive(1))))
        assertEquals(setOf("squat_barbell"), repo.exerciseData.first().keys)
    }

    @Test
    fun theLiftingSettingsKeepEachLeafAndTheOthersStayAtTheirDefaults() = runBlocking {
        val repo = SettingsRepository(db, writer, env)
        assertEquals("nothing written reads as the app's old constants", GymSettings(), repo.gym.first())

        repo.setDefaultBar(35.0)
        repo.setEzBar(20.0)
        var g = repo.gym.first()
        assertEquals(35.0, g.plates.defaultBar, 0.0)
        assertEquals(20.0, g.plates.ezBar, 0.0)
        assertEquals("the inventory leaf was never written", DefaultLbPlates, g.plates.plates)

        val inventory = PlateSettings().withPairs(10.0, PlatePairs.Count(0.0)).with55(2.0).plates
        repo.setPlates(inventory)
        assertEquals(inventory, repo.gym.first().plates.plates)
        assertEquals("a bar written earlier is still there", 35.0, repo.gym.first().plates.defaultBar, 0.0)

        repo.setOwned(EquipmentItem.Percussion, false)
        repo.setOwned(EquipmentItem.Rower, true)
        repo.setWarmupEnabled(false)
        repo.setSoftTissue(false)
        repo.setPreferPercussion(false)
        repo.setWarmupMinutes(10)
        repo.setAutoRest(false)
        repo.setShowPlates(false)
        g = repo.gym.first()
        assertEquals(OwnedEquipment(percussion = false, rower = true), g.equipment)
        assertEquals(WarmupSettings(enabled = false, softTissue = false, preferPercussion = false, minutes = 10), g.warmup)
        assertEquals(RestSettings(auto = false, showPlates = false), g.rest)

        // They are their own groups: the core's settings and the training days are untouched.
        assertEquals(listOf(0, 2, 4, 5), repo.settings.first().trainingWeekdays)
        // Each leaf is a clocked field with an outbox row, like every other settings write.
        assertTrue(db.outboxDao().pending(10_000).any { it.recordId == "settings-plates" && it.field == "defaultBar" })
        assertTrue(db.outboxDao().pending(10_000).any { it.recordId == "settings-rest" && it.field == "auto" })
    }

    @Test
    fun theLiftingSettingSettersRefuseWhatCannotBeRight() = runBlocking {
        val repo = SettingsRepository(db, writer, env)
        for (bad in listOf<suspend () -> Unit>(
            { repo.setDefaultBar(0.0) },
            { repo.setEzBar(500.0) },
            { repo.setWarmupMinutes(1) },
            { repo.setPlates(listOf(PlateEntry(45.0, PlatePairs.Enough), PlateEntry(45.0, PlatePairs.Count(1.0)))) },
            { repo.setPlates(listOf(PlateEntry(0.0, PlatePairs.Enough))) },
        )) {
            try {
                bad()
                org.junit.Assert.fail("should have been refused")
            } catch (expected: IllegalArgumentException) {
            }
        }
        assertEquals(GymSettings(), repo.gym.first())
    }

    @Test
    fun programTextIsAFieldWrite() = runBlocking {
        val repo = ProgramRepository(db, writer, env)
        repo.save("p1", "gzclp.md", "# Week 1\n")
        repo.setText("p1", "# Week 1\n## Day 1\n")
        val active = repo.active.first()!!
        assertEquals("gzclp.md", active.name)
        assertEquals("# Week 1\n## Day 1\n", active.text)
    }

    @Test
    fun stubsAreMarkedWithTheirStageAndCarryNoSets() = runBlocking {
        val sessions = SessionRepository(db, writer, env)
        val runs = RunRepository(db, writer, env)
        sessions.markStageDone(StubStage.WARM_UP, programDayIndex = 3)
        sessions.markStageDone(StubStage.LIFT, programDayIndex = 3)
        runs.markDone()
        val rows = sessions.liftSessionRows.first()
        assertEquals(listOf(LiftStage.WARMUP, LiftStage.LIFT), rows.map { it.stage })
        assertTrue(rows.all { it.stub && it.programDayIndex == 3 })
        assertTrue(sessions.liftSessions.first().all { it.entries.isEmpty() })
        val run = runs.runs.first().single()
        assertTrue(run.stub && run.distanceM == 0.0)
    }

    @Test
    fun aRealSessionKeepsItsSetsAndItsNotesCanChange() = runBlocking {
        val sessions = SessionRepository(db, writer, env)
        val id = sessions.saveLiftSession(
            NewLiftSession(
                startedAtMs = t0,
                programDayIndex = 1,
                entries = listOf(LiftEntryRecord("squat", listOf(LiftSetRecord(225.0, WeightUnit.Lb, 5.0, completed = true)))),
                minutes = 60.0,
            ),
        )
        sessions.setNotes(id, "felt strong")
        val s = sessions.liftSessions.first().single()
        assertEquals("felt strong", s.session.notes)
        assertFalse(s.session.stub)
        assertEquals(1, s.entries.single().sets.size)
        sessions.delete(id)
        assertTrue(sessions.liftSessions.first().isEmpty())
    }
}
