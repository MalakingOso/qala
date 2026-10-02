package com.qala.data.sync

import com.qala.data.db.CheckInEntity
import com.qala.data.db.MetaKeys
import com.qala.data.db.SettingsEntity
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * RecordWriter against the in-memory storage and the host build of the Rust clock: what one write puts in
 * the outbox, the field clocks and meta, and what a failure leaves behind.
 */
class RecordWriterTest {
    private val t0 = 1_790_000_000_000L
    private val node = "node-a"

    private fun checkIn(id: String = "c1", recovery: Double = 7.0) =
        CheckInEntity(id, t0, -240, recovery, """{"quads":2,"lats":1}""", "slept ok", false)

    private fun fields(e: CheckInEntity) = CheckInCodec.toFields(e)

    private fun writer(
        store: InMemoryStorage,
        now: () -> Long = { t0 },
        nodeIds: () -> String = { node },
    ) = RecordWriter(store, RustHlc, now, nodeIds)

    @Test
    fun aCreateWritesTheRowClocksAndOutboxTogether() = runBlocking {
        val store = InMemoryStorage()
        writer(store).put(RecordType.CHECK_IN, "c1", fields(checkIn()))

        val expected = listOf("atMs", "offsetMin", "recovery", "soreness", "note", "deleted")
        assertEquals(expected, store.outbox.map { it.field })
        assertEquals(listOf(1L, 2L, 3L, 4L, 5L, 6L), store.outbox.map { it.seq })
        assertTrue(store.outbox.all { it.recordType == "check_in" && it.recordId == "c1" })
        assertTrue(store.outbox.all { it.createdAtMs == t0 })

        val clock = Hlc(t0, 0, node)
        assertEquals(setOf(clock.toString()), store.outbox.map { it.hlc }.toSet())
        assertEquals(expected.toSet(), store.clocks.keys.map { it.second }.toSet())
        assertTrue(store.clocks.values.all { it == clock })
        assertEquals(clock.toString(), store.meta[MetaKeys.HLC])
        assertEquals(node, store.meta[MetaKeys.NODE_ID])
        assertEquals("""{"quads":2,"lats":1}""", store.outbox.first { it.field == "soreness" }.valueJson)
        assertEquals("7.0", store.outbox.first { it.field == "recovery" }.valueJson)
        assertEquals("false", store.outbox.last().valueJson)
    }

    @Test
    fun aNewRecordGetsDeletedFalseEvenWhenTheCallerLeavesItOut() = runBlocking {
        val store = InMemoryStorage()
        writer(store).put(RecordType.BODY_WEIGHT, "w1", linkedMapOf("date" to JsonPrimitive("2026-10-02"), "kg" to JsonPrimitive(81.3)))
        assertEquals(listOf("date", "kg", "deleted"), store.outbox.map { it.field })
        assertEquals(JsonPrimitive(false), store.records.getValue(RecordType.BODY_WEIGHT to "w1")["deleted"])
    }

    @Test
    fun anUpdateTouchesOnlyTheFieldsItNames() = runBlocking {
        val store = InMemoryStorage()
        var now = t0
        val w = writer(store, { now })
        w.put(RecordType.CHECK_IN, "c1", fields(checkIn()))
        val before = store.outbox.size

        now = t0 + 5_000
        w.update(RecordType.CHECK_IN, "c1", mapOf("recovery" to JsonPrimitive(4.5)))

        assertEquals(before + 1, store.outbox.size)
        val row = store.outbox.last()
        assertEquals("recovery", row.field)
        assertEquals("4.5", row.valueJson)
        assertEquals(Hlc(t0 + 5_000, 0, node).toString(), row.hlc)
        assertEquals(Hlc(t0 + 5_000, 0, node), store.clocks["c1" to "recovery"])
        assertEquals(Hlc(t0, 0, node), store.clocks["c1" to "note"])
        assertEquals(JsonPrimitive(4.5), store.records.getValue(RecordType.CHECK_IN to "c1")["recovery"])
    }

    @Test
    fun theClockCounterRisesWhileTheWallTimeStandsStillAndResetsWhenItAdvances() = runBlocking {
        val store = InMemoryStorage()
        var now = t0
        val w = writer(store, { now })
        w.put(RecordType.BODY_WEIGHT, "w1", mapOf("kg" to JsonPrimitive(80.0)))
        w.put(RecordType.BODY_WEIGHT, "w2", mapOf("kg" to JsonPrimitive(80.5)))
        now = t0 + 1
        w.put(RecordType.BODY_WEIGHT, "w3", mapOf("kg" to JsonPrimitive(81.0)))

        val perRecord = store.outbox.groupBy { it.recordId }.mapValues { (_, rows) -> rows.map { it.hlc }.toSet().single() }
        assertEquals(Hlc(t0, 0, node).toString(), perRecord["w1"])
        assertEquals(Hlc(t0, 1, node).toString(), perRecord["w2"])
        assertEquals(Hlc(t0 + 1, 0, node).toString(), perRecord["w3"])
    }

    @Test
    fun aBatchIsOneTickAndKeepsTheOrderGiven() = runBlocking {
        val store = InMemoryStorage()
        writer(store).write(
            RecordWrite(RecordType.BODY_WEIGHT, "w1", mapOf("date" to JsonPrimitive("2026-10-01"), "kg" to JsonPrimitive(80.0))),
            RecordWrite(RecordType.CHECK_IN, "c1", fields(checkIn())),
        )
        assertEquals(
            listOf("w1", "w1", "w1", "c1", "c1", "c1", "c1", "c1", "c1"),
            store.outbox.map { it.recordId },
        )
        assertEquals(1, store.outbox.map { it.hlc }.toSet().size)
    }

    @Test
    fun aDeleteIsAClockedTombstoneAndARestoreIsALaterWrite() = runBlocking {
        val store = InMemoryStorage()
        var now = t0
        val w = writer(store, { now })
        w.put(RecordType.CHECK_IN, "c1", fields(checkIn()))

        now = t0 + 10
        w.delete(RecordType.CHECK_IN, "c1")
        assertEquals(JsonPrimitive(true), store.records.getValue(RecordType.CHECK_IN to "c1")["deleted"])
        assertEquals(Hlc(t0 + 10, 0, node), store.clocks["c1" to "deleted"])
        assertEquals("deleted" to "true", store.outbox.last().let { it.field to it.valueJson })

        now = t0 + 20
        w.restore(RecordType.CHECK_IN, "c1")
        assertEquals(JsonPrimitive(false), store.records.getValue(RecordType.CHECK_IN to "c1")["deleted"])
        assertEquals(Hlc(t0 + 20, 0, node), store.clocks["c1" to "deleted"])
    }

    @Test
    fun updatingARecordThatDoesNotExistWritesNothing() {
        val store = InMemoryStorage()
        assertThrows(IllegalStateException::class.java) {
            runBlocking { writer(store).update(RecordType.CHECK_IN, "nope", mapOf("recovery" to JsonPrimitive(1.0))) }
        }
        assertTrue(store.outbox.isEmpty() && store.clocks.isEmpty() && store.records.isEmpty())
        assertTrue("the rolled-back call leaves no node id or clock behind", store.meta.isEmpty())
    }

    @Test
    fun aFailureMidWayLeavesNothingBehind() {
        val store = InMemoryStorage()
        store.failOutboxAfter = 2
        assertThrows(IllegalStateException::class.java) {
            runBlocking { writer(store).put(RecordType.CHECK_IN, "c1", fields(checkIn())) }
        }
        assertTrue("row", store.records.isEmpty())
        assertTrue("clocks", store.clocks.isEmpty())
        assertTrue("outbox", store.outbox.isEmpty())
        assertTrue("meta", store.meta.isEmpty())
    }

    @Test
    fun anUnknownFieldIsRefusedBeforeAnythingIsWritten() {
        val store = InMemoryStorage()
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { writer(store).put(RecordType.CHECK_IN, "c1", mapOf("bogus" to JsonPrimitive(1))) }
        }
        assertTrue(store.records.isEmpty() && store.outbox.isEmpty())
    }

    @Test
    fun settingsLeavesAreOpenFieldNames() = runBlocking {
        val store = InMemoryStorage()
        writer(store).put(RecordType.SETTINGS, "settings-training", mapOf("unit" to JsonPrimitive("kg")))
        assertEquals(listOf("unit", "deleted"), store.outbox.map { it.field })
        val entity = SettingsCodec.withField(SettingsEntity("settings-training", "{}", false), "unit", JsonPrimitive("kg"))
        assertEquals("""{"unit":"kg"}""", entity.valuesJson)
    }

    // ---- restart persistence ----

    @Test
    fun aRestartNeverGoesBackwardsEvenWhenThePhoneClockDoes() = runBlocking {
        val store = InMemoryStorage()
        writer(store, { t0 }).put(RecordType.BODY_WEIGHT, "w1", mapOf("kg" to JsonPrimitive(80.0)))
        val first = Hlc.parse(store.meta.getValue(MetaKeys.HLC))!!

        // A new writer on the same storage (a restart) whose clock is ten seconds behind.
        writer(store, { t0 - 10_000 }).put(RecordType.BODY_WEIGHT, "w2", mapOf("kg" to JsonPrimitive(80.2)))
        val second = Hlc.parse(store.meta.getValue(MetaKeys.HLC))!!

        assertEquals(first.wallMs, second.wallMs)
        assertEquals(first.counter + 1, second.counter)
        assertTrue(second.toString() > first.toString())
    }

    @Test
    fun theNodeIdIsMadeOnceAndKept() = runBlocking {
        val store = InMemoryStorage()
        var made = 0
        val ids = { "n${++made}".padEnd(8, 'x') }
        writer(store, nodeIds = ids).put(RecordType.BODY_WEIGHT, "w1", mapOf("kg" to JsonPrimitive(80.0)))
        writer(store, nodeIds = ids).put(RecordType.BODY_WEIGHT, "w2", mapOf("kg" to JsonPrimitive(80.1)))
        assertEquals(1, made)
        assertEquals(setOf("n1xxxxxx"), store.clocks.values.map { it.nodeId }.toSet())
    }

    @Test
    fun theRealNodeIdIs128BitsOfHexAndAValidClockNode() {
        val id = RecordWriter.randomNodeId()
        assertEquals(32, id.length)
        assertTrue(id.all { it in '0'..'9' || it in 'a'..'f' })
        assertEquals(Hlc(0, 0, id), Hlc.parse(Hlc(0, 0, id).toString()))
        assertTrue(RecordWriter.randomNodeId() != id)
    }

    // ---- applyRemote ----

    private val remoteNode = "node-b"

    private fun remote(field: String, value: Double, wall: Long, counter: Int = 0) =
        RemoteChange(RecordType.CHECK_IN, "c1", field, JsonPrimitive(value), Hlc(wall, counter, remoteNode))

    @Test
    fun aRemoteFieldWithNoLocalClockIsApplied() = runBlocking {
        val store = InMemoryStorage()
        val result = writer(store).applyRemote(remote("recovery", 3.0, t0 - 1000))
        assertEquals(ApplyResult.Applied, result)
        assertEquals(JsonPrimitive(3.0), store.records.getValue(RecordType.CHECK_IN to "c1")["recovery"])
        assertEquals(Hlc(t0 - 1000, 0, remoteNode), store.clocks["c1" to "recovery"])
        assertTrue("a remote write is not sent back", store.outbox.isEmpty())
    }

    @Test
    fun theHigherClockWinsAndAnOlderOrEqualOneIsStale() = runBlocking {
        val store = InMemoryStorage()
        val w = writer(store)
        w.put(RecordType.CHECK_IN, "c1", fields(checkIn(recovery = 7.0))) // local clock (t0, 0, node-a)
        val outbox = store.outbox.size

        assertEquals(ApplyResult.Stale, w.applyRemote(remote("recovery", 1.0, t0 - 1)))
        assertEquals(JsonPrimitive(7.0), store.records.getValue(RecordType.CHECK_IN to "c1")["recovery"])

        // Same wall time and counter: the node id decides, and node-b sorts after node-a.
        assertEquals(ApplyResult.Applied, w.applyRemote(remote("recovery", 2.0, t0, 0)))
        assertEquals(JsonPrimitive(2.0), store.records.getValue(RecordType.CHECK_IN to "c1")["recovery"])
        assertEquals(Hlc(t0, 0, remoteNode), store.clocks["c1" to "recovery"])

        // The very same clock again changes nothing.
        assertEquals(ApplyResult.Stale, w.applyRemote(remote("recovery", 9.0, t0, 0)))
        assertEquals(JsonPrimitive(2.0), store.records.getValue(RecordType.CHECK_IN to "c1")["recovery"])

        // Another field is judged by its own clock.
        assertEquals(ApplyResult.Applied, w.applyRemote(remote("atMs", 123.0, t0 + 1)))
        assertEquals(outbox, store.outbox.size)
    }

    @Test
    fun aRemoteTombstoneDeletesTheRecordUntilALaterWriteRestoresIt() = runBlocking {
        val store = InMemoryStorage()
        var now = t0
        val w = writer(store, { now })
        w.put(RecordType.CHECK_IN, "c1", fields(checkIn()))
        val tomb = RemoteChange(RecordType.CHECK_IN, "c1", "deleted", JsonPrimitive(true), Hlc(t0 + 100, 0, remoteNode))
        assertEquals(ApplyResult.Applied, w.applyRemote(tomb))
        assertEquals(JsonPrimitive(true), store.records.getValue(RecordType.CHECK_IN to "c1")["deleted"])

        now = t0 + 200
        w.restore(RecordType.CHECK_IN, "c1")
        assertEquals(JsonPrimitive(false), store.records.getValue(RecordType.CHECK_IN to "c1")["deleted"])
        // The older remote tombstone arriving again is stale.
        assertEquals(ApplyResult.Stale, w.applyRemote(tomb))
    }

    @Test
    fun anUnknownRemoteFieldIsRejected() = runBlocking {
        val store = InMemoryStorage()
        val result = writer(store).applyRemote(remote("bogus", 1.0, t0))
        assertTrue(result is ApplyResult.Rejected)
        assertTrue(store.records.isEmpty() && store.clocks.isEmpty() && store.meta.isEmpty())
    }

    @Test
    fun aClockMoreThanADayAheadIsRejectedAndChangesNothing() = runBlocking {
        val store = InMemoryStorage()
        val w = writer(store)
        w.put(RecordType.CHECK_IN, "c1", fields(checkIn()))
        val metaBefore = store.meta.toMap()
        val result = w.applyRemote(remote("recovery", 1.0, t0 + RecordWriter.MAX_DRIFT_MS + 1))
        assertTrue(result is ApplyResult.Rejected)
        assertEquals(metaBefore, store.meta.toMap())
        assertEquals(JsonPrimitive(7.0), store.records.getValue(RecordType.CHECK_IN to "c1")["recovery"])
    }

    @Test
    fun aLocalWriteAfterAReceiveIsAfterTheRemoteClock() = runBlocking {
        val store = InMemoryStorage()
        val w = writer(store, { t0 })
        val ahead = Hlc(t0 + 3_600_000, 4, remoteNode)
        assertEquals(
            ApplyResult.Applied,
            w.applyRemote(RemoteChange(RecordType.CHECK_IN, "c1", "recovery", JsonPrimitive(6.0), ahead)),
        )
        w.put(RecordType.BODY_WEIGHT, "w1", mapOf("kg" to JsonPrimitive(80.0)))
        val local = store.clocks.getValue("w1" to "kg")
        assertTrue("$local after $ahead", local.toString() > ahead.toString())
        assertEquals(node, local.nodeId)
    }

    @Test
    fun aNullFieldValueIsStoredAsNull() = runBlocking {
        val store = InMemoryStorage()
        writer(store).put(RecordType.CHECK_IN, "c1", fields(checkIn()))
        writer(store).update(RecordType.CHECK_IN, "c1", mapOf("note" to JsonNull))
        assertEquals(JsonNull, store.records.getValue(RecordType.CHECK_IN to "c1")["note"])
        assertEquals("null", store.outbox.last().valueJson)
        assertNull(CheckInCodec.withField(checkIn(), "note", JsonNull).note)
    }
}
