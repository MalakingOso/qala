package com.qala.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.MetaKeys
import com.qala.data.db.QalaDatabase
import com.qala.data.engine.EngineRepository
import com.qala.data.model.toRecord
import com.qala.data.repo.AvailabilityRepository
import com.qala.data.repo.BodyWeightRepository
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.DeviceClock
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.RunRepository
import com.qala.data.repo.SessionRepository
import com.qala.data.repo.SettingsRepository
import com.qala.data.seed.DebugSeeder
import com.qala.data.seed.SeedGenerator
import com.qala.data.sync.RecordWriter
import com.qala.data.sync.RoomTransactor
import com.qala.data.today.StageId
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The seed through a real in-memory Room database, on a device or emulator: the repositories show what the
 * generator made, a second run changes nothing, and the engine snapshot built from the stored rows is the one
 * the JVM test builds from the generated data. The time is pinned to Wednesday 2026-10-07, noon, New York.
 */
@RunWith(AndroidJUnit4::class)
class SeedRoomTest {
    private val today = LocalDate.of(2026, 10, 7)
    private val zone = ZoneId.of("America/New_York")
    private val nowMs = today.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()

    private lateinit var db: QalaDatabase
    private lateinit var env: RepoEnv
    private lateinit var writer: RecordWriter
    private lateinit var sessions: SessionRepository
    private lateinit var runs: RunRepository
    private lateinit var checkIns: CheckInRepository
    private lateinit var weights: BodyWeightRepository
    private lateinit var availability: AvailabilityRepository
    private lateinit var settings: SettingsRepository
    private lateinit var programs: ProgramRepository
    private lateinit var seeder: DebugSeeder
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Before
    fun open() {
        db = QalaDatabase.inMemory(ApplicationProvider.getApplicationContext<Context>())
        env = RepoEnv(clock = object : DeviceClock {
            override fun nowMs() = nowMs
            override val zone: ZoneId = this@SeedRoomTest.zone
        })
        writer = RecordWriter(RoomTransactor(db), nowMs = { nowMs })
        sessions = SessionRepository(db, writer, env)
        runs = RunRepository(db, writer, env)
        checkIns = CheckInRepository(db, writer, env)
        weights = BodyWeightRepository(db, writer, env)
        availability = AvailabilityRepository(db, writer, env)
        settings = SettingsRepository(db, writer, env)
        programs = ProgramRepository(db, writer, env)
        seeder = DebugSeeder(db, sessions, runs, checkIns, weights, availability, settings, programs, env)
    }

    @After
    fun close() {
        scope.cancel()
        db.close()
    }

    @Test
    fun theRepositoriesShowWhatTheGeneratorMade() = runBlocking {
        assertTrue(seeder.seedIfEmpty(today))
        val seed = SeedGenerator().generate(today, zone)

        val stored = sessions.liftSessions.first()
        assertEquals(seed.sessions.size, stored.size)
        assertEquals(seed.sessions.map { it.bundle.entries }, stored.map { it.toRecord().entries })
        assertEquals(seed.sessions.map { it.programDay }, stored.map { it.session.programDayIndex })
        assertEquals(seed.runs.size, runs.runs.first().size)
        assertEquals(seed.checkIns.map { it.id }, checkIns.checkIns.first().map { it.id })
        assertEquals(seed.weights.map { it.kg }, weights.weights.first().map { it.kg })
        assertEquals(seed.skips.map { it.date }, availability.skips.first().map { it.date })
        assertEquals(seed.programText, programs.active.first()!!.text)
        assertEquals(listOf(0, 2, 4, 5), settings.settings.first().trainingWeekdays)
        assertEquals(listOf(1, 3), settings.runPlan.first().days.map { it.dayOfWeek })
        assertEquals(seed.exerciseData, settings.exerciseData.first())
    }

    @Test
    fun seedingTwiceChangesNothing() = runBlocking {
        assertTrue(seeder.seedIfEmpty(today))
        val queued = db.outboxDao().count()
        assertTrue(queued > 0)
        assertNotNull(db.metaDao().get(MetaKeys.DEBUG_SEEDED))
        assertFalse(seeder.seedIfEmpty(today))
        assertEquals(queued, db.outboxDao().count())
        assertEquals(11, sessions.liftSessions.first().size)
    }

    @Test
    fun aSeedWrittenTwiceByHandRewritesTheSameRecords() = runBlocking {
        val seed = SeedGenerator().generate(today, zone)
        seeder.write(seed)
        seeder.write(seed)
        assertEquals("deterministic ids: a rerun after a crash does not double the history", 11, sessions.liftSessions.first().size)
        assertEquals(21, checkIns.checkIns.first().size)
    }

    @Test
    fun everyWriteIsClockedAndQueuedInOrder() = runBlocking {
        seeder.seedIfEmpty(today)
        val outbox = db.outboxDao().pending(10_000)
        assertEquals((1L..outbox.size.toLong()).toList(), outbox.map { it.seq })
        assertEquals(outbox.map { it.hlc }, outbox.map { it.hlc }.sorted())
        val types = outbox.map { it.recordType }.toSet()
        assertEquals(setOf("settings", "program", "lift_session", "run_session", "check_in", "body_weight", "day_skip"), types)
        val first = outbox.first { it.recordType == "lift_session" && it.field == "entries" }
        assertTrue(first.valueJson.startsWith("[{\"exerciseId\":\"squat\""))
        val clocked = db.fieldClockDao().forRecord(first.recordId)
        assertEquals(setOf("startedAtMs", "offsetMin", "programDayIndex", "stub", "stage", "minutes", "srpe", "notes", "entries", "deleted"), clocked.map { it.field }.toSet())
    }

    @Test
    fun theEngineSnapshotAfterSeedingHasStateAndTheNextLiftDay() = runBlocking {
        seeder.seedIfEmpty(today)
        val engine = EngineRepository(sessions, runs, checkIns, weights, availability, settings, programs, scope, env, debounceMs = 50)
        assertFalse(engine.snapshot.value.loaded)
        val snapshot = withTimeout(60_000) { engine.snapshot.first { it.loaded } }

        assertNull(snapshot.error, snapshot.error)
        assertEquals(emptyList<String>(), snapshot.warnings)
        val view = snapshot.stateView!!
        assertTrue(view.fatigueSystemic > 0.0)
        assertTrue(view.fatigueMuscle.values.any { it > 0.0 })
        assertTrue(view.fitness.values.any { it > 0.0 })
        assertEquals(21, snapshot.readiness!!.checkinCount28d)
        assertNotNull(snapshot.weightTrend)
        assertTrue(snapshot.weekLoad!!.done[0] > 0.0)

        val plan = snapshot.today!!
        assertEquals("2026-10-07", plan.date)
        assertTrue(plan.liftDay)
        assertEquals(4, plan.programDay)
        assertEquals(StageId.CHECK_IN, plan.now)

        // A new check-in is a record change: the snapshot rebuilds and today's check-in stage is done.
        checkIns.save(7.0, mapOf("quads" to 1), null, atMs = nowMs)
        val after = withTimeout(60_000) { engine.snapshot.first { s -> s.today?.stages?.first()?.doneAtMs != null } }
        assertEquals(StageId.WARM_UP, after.today!!.now)
        assertTrue(after.readiness!!.checkedInToday)
    }
}
