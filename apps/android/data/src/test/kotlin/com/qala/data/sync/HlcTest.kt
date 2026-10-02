package com.qala.data.sync

import com.qala.data.core.QalaCore
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.qala_ffi.QalaException

/** The Kotlin side of the clock: the string form, and the Rust calls through the host library. */
class HlcTest {
    private val w = 1_790_000_000_000L

    @Test
    fun theStringFormIsFixedWidthAndParsesBack() {
        val h = Hlc(w, 7, "node-a")
        assertEquals("1790000000000-00007-node-a", h.toString())
        assertEquals(h, Hlc.parse(h.toString()))
        // The node id may itself contain hyphens.
        assertEquals(Hlc(5, 0, "a-b-c"), Hlc.parse(Hlc(5, 0, "a-b-c").toString()))
        assertEquals("0000000000005-00000-a", Hlc(5, 0, "a").toString())
    }

    @Test
    fun parseIsStrict() {
        for (bad in listOf("", "1-2-3", "17900000000000-00007-n", "1790000000000-007-n", "1790000000000-00007-", "1790000000000-00007", "x790000000000-00007-n", "1790000000000-00007-n o")) {
            assertNull(bad, Hlc.parse(bad))
        }
    }

    @Test
    fun textOrderMatchesTheRustCompare() {
        val clocks = listOf(
            Hlc(w, 3, "n2"), Hlc(w + 1, 0, "n1"), Hlc(w, 3, "n1"), Hlc(w, 10, "n1"),
            Hlc(w, 9, "n9"), Hlc(w, 3, "n10"), Hlc(w - 1, 99_999, "zz"), Hlc(w, 3, "n2"),
        )
        for (a in clocks) for (b in clocks) {
            val rust = QalaCore.hlcCompare(a, b)
            assertEquals("$a vs $b", rust, a.toString().compareTo(b.toString()).coerceIn(-1, 1))
        }
    }

    @Test
    fun tickIsMonotonicAcrossForwardStandStillAndBackwardPhoneTime() {
        var h = Hlc.zero("node-a")
        val seen = mutableListOf<Hlc>()
        for (now in listOf(w, w, w, w + 50, w + 50, w - 1000, w + 51)) {
            h = QalaCore.hlcTick(h, now)
            seen += h
        }
        assertEquals(listOf(0, 1, 2, 0, 1, 2, 0), seen.map { it.counter })
        assertEquals(seen.map { it.toString() }, seen.map { it.toString() }.sorted())
        assertEquals(seen.size, seen.map { it.toString() }.toSet().size)
        assertTrue(seen.all { it.nodeId == "node-a" })
    }

    @Test
    fun receiveMovesPastTheRemoteAndRefusesADriftedOne() {
        val local = Hlc(w, 0, "node-a")
        val remote = Hlc(w + 5_000, 2, "node-b")
        val after = QalaCore.hlcReceive(local, remote, w, RecordWriter.MAX_DRIFT_MS)
        assertEquals("node-a", after.nodeId)
        assertTrue(QalaCore.hlcCompare(after, remote) > 0)
        assertTrue(QalaCore.hlcCompare(after, local) > 0)

        val drifted = Hlc(w + RecordWriter.MAX_DRIFT_MS + 1, 0, "node-b")
        assertThrows(QalaException.Evaluation::class.java) { QalaCore.hlcReceive(local, drifted, w, RecordWriter.MAX_DRIFT_MS) }
    }

    @Test
    fun mergeKeepsTheHigherClockAndTheLocalOneOnATie() {
        val older = ClockedField<kotlinx.serialization.json.JsonElement>(JsonPrimitive(1), Hlc(w, 0, "node-a"))
        val newer = ClockedField<kotlinx.serialization.json.JsonElement>(JsonPrimitive(2), Hlc(w, 1, "node-a"))
        assertEquals(newer, QalaCore.hlcMergeField(older, newer))
        assertEquals(newer, QalaCore.hlcMergeField(newer, older))
        val tie = ClockedField<kotlinx.serialization.json.JsonElement>(JsonPrimitive(9), older.hlc)
        assertEquals(older, QalaCore.hlcMergeField(older, tie))
    }

    @Test
    fun anInvalidClockIsAnEvaluationError() {
        assertThrows(QalaException.Evaluation::class.java) { QalaCore.hlcTick(Hlc(w, 0, "has space"), w) }
        assertThrows(QalaException.Evaluation::class.java) { QalaCore.hlcTick(Hlc(w, 100_000, "n"), w) }
    }

    @Test
    fun theLibraryAndTheClientSpeakTheSameEnvelopeVersion() {
        assertTrue(QalaCore.libraryMatches())
    }
}
