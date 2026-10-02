package com.qala.data.repo

import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/**
 * What the repositories and the engine need from the device: the time and the zone. Everything that
 * reads "now" goes through here so tests can pin it.
 */
interface DeviceClock {
    fun nowMs(): Long
    val zone: ZoneId
}

object SystemDeviceClock : DeviceClock {
    override fun nowMs(): Long = System.currentTimeMillis()
    override val zone: ZoneId get() = ZoneId.systemDefault()
}

/** Mints record ids: random UUIDs in the app, deterministic ones in the seed and in tests. */
fun interface IdSource {
    fun next(): String

    companion object {
        val Random = IdSource { UUID.randomUUID().toString() }
    }
}

/** Shared by every repository: where JSON and Rust work runs, the clock and the id source. */
class RepoEnv(
    val clock: DeviceClock = SystemDeviceClock,
    val ids: IdSource = IdSource.Random,
    /** All JSON and Rust work runs here, never on the main thread. */
    val work: CoroutineDispatcher = Dispatchers.Default,
)
