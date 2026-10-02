package com.qala.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.CheckInEntity
import com.qala.data.db.LiftSessionEntity
import com.qala.data.db.MetaKeys
import com.qala.data.db.QalaDatabase
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.model.WeightUnit
import com.qala.data.model.toRecord
import com.qala.data.sync.ApplyResult
import com.qala.data.sync.CheckInCodec
import com.qala.data.sync.Hlc
import com.qala.data.sync.LiftSessionBundle
import com.qala.data.sync.LiftSessionCodec
import com.qala.data.sync.RecordType
import com.qala.data.sync.RecordWriter
import com.qala.data.sync.RemoteChange
import com.qala.data.sync.RoomTransactor
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * RecordWriter on a real in-memory Room database (run on a device or emulator): the transaction writes the
 * row, its clocks, its outbox rows and the meta clock together, and a failure rolls all of it back.
 */
@RunWith(AndroidJUnit4::class)
class RoomWriteTest {
    private val t0 = 1_790_000_000_000L
    private lateinit var db: QalaDatabase
    private lateinit var writer: RecordWriter

    @Before
    fun open() {
        db = QalaDatabase.inMemory(ApplicationProvider.getApplicationContext<Context>())
        writer = RecordWriter(RoomTransactor(db), nowMs = { t0 }, newNodeId = { "node-a" })
    }

    @After
    fun close() = db.close()

    private fun checkIn(id: String = "c1") = CheckInEntity(id, t0, -240, 7.0, """{"quads":2}""", "ok", false)

    @Test
    fun aCreateWritesRowClocksOutboxAndMetaTogether() = runBlocking {
        writer.put(RecordType.CHECK_IN, "c1", CheckInCodec.toFields(checkIn()))

        assertEquals(checkIn(), db.checkInDao().row("c1"))
        val clocks = db.fieldClockDao().forRecord("c1")
        assertEquals(setOf("atMs", "offsetMin", "recovery", "soreness", "note", "deleted"), clocks.map { it.field }.toSet())
        assertTrue(clocks.all { it.wallMs == t0 && it.counter == 0 && it.nodeId == "node-a" })
        val outbox = db.outboxDao().pending(100)
        assertEquals(listOf("atMs", "offsetMin", "recovery", "soreness", "note", "deleted"), outbox.map { it.field })
        assertEquals((1L..6L).toList(), outbox.map { it.seq })
        assertEquals(Hlc(t0, 0, "node-a").toString(), db.metaDao().get(MetaKeys.HLC))
        assertEquals("node-a", db.metaDao().get(MetaKeys.NODE_ID))
    }

    @Test
    fun aFailureInsideTheTransactionRollsEverythingBack() = runBlocking {
        val result = runCatching {
            RoomTransactor(db).inTransaction {
                writeFields(RecordType.CHECK_IN, "c1", CheckInCodec.toFields(checkIn()))
                putClock("c1", "recovery", Hlc(t0, 0, "node-a"))
                putMeta(MetaKeys.HLC, Hlc(t0, 0, "node-a").toString())
                error("crash after the writes")
            }
        }
        assertTrue(result.isFailure)
        assertNull(db.checkInDao().row("c1"))
        assertTrue(db.fieldClockDao().forRecord("c1").isEmpty())
        assertNull(db.metaDao().get(MetaKeys.HLC))
        assertEquals(0, db.outboxDao().count())
    }

    @Test
    fun anUpdateWritesOnlyItsFieldAndAFreshClock() = runBlocking {
        var now = t0
        val w = RecordWriter(RoomTransactor(db), nowMs = { now }, newNodeId = { "node-a" })
        w.put(RecordType.CHECK_IN, "c1", CheckInCodec.toFields(checkIn()))
        now = t0 + 1_000
        w.update(RecordType.CHECK_IN, "c1", mapOf("recovery" to JsonPrimitive(3.5)))

        assertEquals(checkIn().copy(recovery = 3.5), db.checkInDao().row("c1"))
        assertEquals(Hlc(t0 + 1_000, 0, "node-a"), db.fieldClockDao().get("c1", "recovery")?.let { Hlc(it.wallMs, it.counter, it.nodeId) })
        assertEquals(t0, db.fieldClockDao().get("c1", "note")?.wallMs)
        assertEquals("recovery", db.outboxDao().pending(100).last().field)
        assertEquals(7, db.outboxDao().count())
    }

    @Test
    fun aTombstoneStaysInTheTableButLeavesTheLiveReads() = runBlocking {
        writer.put(RecordType.CHECK_IN, "c1", CheckInCodec.toFields(checkIn("c1")))
        writer.put(RecordType.CHECK_IN, "c2", CheckInCodec.toFields(checkIn("c2")))
        writer.delete(RecordType.CHECK_IN, "c1")

        assertEquals(listOf("c2"), db.checkInDao().observeAll().first().map { it.id })
        assertTrue(db.checkInDao().row("c1")!!.deleted)
        writer.restore(RecordType.CHECK_IN, "c1")
        assertEquals(listOf("c1", "c2"), db.checkInDao().observeAll().first().map { it.id }.sorted())
    }

    @Test
    fun aSessionKeepsItsEntriesAsTypedChildRowsAndOneField() = runBlocking {
        val entries = listOf(
            LiftEntryRecord(
                "squat",
                listOf(
                    LiftSetRecord(135.0, WeightUnit.Lb, 5.0, completed = true, warmup = true),
                    LiftSetRecord(225.0, WeightUnit.Lb, 3.0, rpe = 9.0, targetRpe = 8.0, completed = true),
                ),
            ),
            LiftEntryRecord("benchPress", listOf(LiftSetRecord(155.0, WeightUnit.Lb, 10.0, completed = true))),
        )
        val bundle = LiftSessionBundle(LiftSessionEntity("s1", t0, -240, 1, false, null, 60.0, 7.0, null, false), entries)
        writer.put(RecordType.LIFT_SESSION, "s1", LiftSessionCodec.toFields(bundle))

        val stored = db.liftSessionDao().withEntries("s1")!!
        assertEquals(2, stored.entries.size)
        assertEquals(listOf(2, 1), stored.entries.sortedBy { it.entry.position }.map { it.sets.size })
        val record = stored.toRecord()
        assertEquals(entries, record.entries)
        assertEquals("2026-09-21T10:13:20-04:00", record.startedAt)
        assertEquals(1, db.outboxDao().pending(100).count { it.field == "entries" })

        // A notes write leaves the children alone; an entries write replaces them as a unit.
        writer.update(RecordType.LIFT_SESSION, "s1", mapOf("notes" to JsonPrimitive("good day")))
        assertEquals(2, db.liftSessionDao().withEntries("s1")!!.entries.size)
        val trimmed = LiftSessionCodec.toFields(bundle.copy(entries = entries.take(1))).getValue("entries")
        writer.update(RecordType.LIFT_SESSION, "s1", mapOf("entries" to trimmed))
        assertEquals(1, db.liftSessionDao().withEntries("s1")!!.entries.size)
    }

    @Test
    fun aRemoteFieldIsAppliedByClockAndNotQueued() = runBlocking {
        writer.put(RecordType.CHECK_IN, "c1", CheckInCodec.toFields(checkIn()))
        val queued = db.outboxDao().count()
        val newer = RemoteChange(RecordType.CHECK_IN, "c1", "recovery", JsonPrimitive(2.0), Hlc(t0 + 5, 0, "node-b"))
        assertEquals(ApplyResult.Applied, writer.applyRemote(newer))
        assertEquals(2.0, db.checkInDao().row("c1")!!.recovery, 0.0)
        val older = RemoteChange(RecordType.CHECK_IN, "c1", "recovery", JsonPrimitive(9.0), Hlc(t0 - 5, 0, "node-b"))
        assertEquals(ApplyResult.Stale, writer.applyRemote(older))
        assertEquals(2.0, db.checkInDao().row("c1")!!.recovery, 0.0)
        assertEquals(queued, db.outboxDao().count())
    }

    @Test
    fun aRestartedWriterContinuesFromTheStoredClock() = runBlocking {
        writer.put(RecordType.CHECK_IN, "c1", CheckInCodec.toFields(checkIn()))
        val first = Hlc.parse(db.metaDao().get(MetaKeys.HLC)!!)!!
        val behind = RecordWriter(RoomTransactor(db), nowMs = { t0 - 60_000 })
        behind.update(RecordType.CHECK_IN, "c1", mapOf("note" to JsonPrimitive("later")))
        val second = Hlc.parse(db.metaDao().get(MetaKeys.HLC)!!)!!
        assertTrue("$second after $first", second.toString() > first.toString())
        assertEquals("node-a", second.nodeId)
    }
}
