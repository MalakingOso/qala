package com.qala.data.sync

import kotlinx.serialization.Serializable

/**
 * A hybrid logical clock value (wall time ms, counter, node id), the JSON shape `{wallMs, counter, nodeId}`
 * of qala-core's `hlc.rs`. Compare, tick, receive and merge all run in Rust (see [com.qala.data.core.QalaCore]);
 * this class only carries the value and its canonical string form.
 *
 * The string form is `{wallMs:013}-{counter:05}-{nodeId}`. It sorts as text in the same order as the Rust
 * compare, inside the canonical range (13-digit wall time, 5-digit counter, ASCII-graphic node id).
 */
@Serializable
data class Hlc(val wallMs: Long, val counter: Int, val nodeId: String) {
    override fun toString(): String = "%013d-%05d-%s".format(wallMs, counter, nodeId)

    companion object {
        /** The clock a node starts from; any real time ticks past it. */
        fun zero(nodeId: String) = Hlc(0, 0, nodeId)

        /** Strict inverse of [toString]; null for anything else. */
        fun parse(text: String): Hlc? {
            val parts = text.split('-', limit = 3)
            if (parts.size != 3) return null
            val (wall, counter, node) = parts
            if (wall.length != 13 || !wall.all { it in '0'..'9' }) return null
            if (counter.length != 5 || !counter.all { it in '0'..'9' }) return null
            if (node.isEmpty() || !node.all { it.code in 0x21..0x7e }) return null
            return Hlc(wall.toLong(), counter.toInt(), node)
        }
    }
}

/** One synced field: its value and the clock of the write that set it (`Field<T>` in hlc.rs). */
@Serializable
data class ClockedField<T>(val value: T, val hlc: Hlc)
