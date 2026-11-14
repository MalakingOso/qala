package com.qala.app.run

import android.util.Log
import com.qala.data.QalaJson
import com.qala.data.core.ProcessedRun
import com.qala.data.core.RunEvent
import com.qala.data.core.RunLive
import com.qala.data.core.RunOpts
import com.qala.data.db.MetaEntity
import com.qala.data.db.MetaKeys
import com.qala.data.db.QalaDatabase
import com.qala.data.db.RunFixEntity
import com.qala.data.repo.NewRun
import com.qala.data.repo.RunRepository
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** One raw position from the fix source, on the run's clock (see [LocationFixSource]). */
data class RawFix(val tMs: Long, val lat: Double, val lon: Double, val acc: Double, val ele: Double? = null)

/**
 * The run in progress, as the meta key [MetaKeys.RUN_ACTIVE] holds it. It is not a `run_session` row, which feeds the engine
 * and the schedule: an open run must never count as a logged one. [finishedAtMs] is set when Finish is pressed, so a process
 * that dies on the Summary comes back to the Summary and does not start recording again.
 */
@Serializable
data class ActiveRun(
    val id: String,
    val startedAtMs: Long,
    val title: String,
    val opts: RunOpts? = null,
    val paused: Boolean = false,
    val finishedAtMs: Long? = null,
)

sealed interface RunState {
    data object Idle : RunState

    /** Recording (or paused). [live] is null until the first fix. */
    data class Active(val run: ActiveRun, val live: RunLive?, val hr: Int?) : RunState

    /** Finished and not saved: the Summary. [elapsedSec] has the cut time back. */
    data class Finished(val run: ActiveRun, val result: ProcessedRun, val elapsedSec: Double) : RunState
}

/**
 * Everything that happens to a run goes through here, one command at a time on one coroutine, so the recorder, the stored
 * fixes and the live numbers can never disagree and nothing needs a lock (docs/android-native.md section 5, Recovery). The
 * service is only glue: it feeds this class fixes and heart rate and speaks its events.
 *
 * A fix is stored before the recorder sees it, and only a fix that is stored is pushed, so replaying the table after a
 * kill rebuilds the recorder exactly: a fix whose time is not after the last one, that is not finite, that is older than the
 * run, or that arrives while paused or after Finish is dropped whole.
 */
class RunRecording(
    private val db: QalaDatabase,
    private val runs: RunRepository,
    scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val _state = MutableStateFlow<RunState>(RunState.Idle)
    val state: StateFlow<RunState> = _state

    private val _events = MutableSharedFlow<RunEvent>(extraBufferCapacity = 32)

    /** The guided and periodic cues the live run produces. A replay after a kill produces none: they were spoken already. */
    val events: SharedFlow<RunEvent> = _events

    private sealed interface Cmd {
        class Start(val title: String, val opts: RunOpts?, val done: CompletableDeferred<Unit>) : Cmd
        class Attach(val done: CompletableDeferred<Unit>) : Cmd
        class Fix(val fix: RawFix) : Cmd
        data object Advance : Cmd
        data object Pause : Cmd
        data object Resume : Cmd
        data object Finish : Cmd
        class Save(val srpe: Double?, val done: CompletableDeferred<Unit>) : Cmd
        class Discard(val done: CompletableDeferred<Unit>) : Cmd
    }

    private val commands = Channel<Cmd>(Channel.UNLIMITED)

    // The actor's own state. Only the actor coroutine touches it.
    private var active: ActiveRun? = null
    private var feed: RunFeed? = null
    private var lastTMs = Long.MIN_VALUE
    private var gapNext = false
    private var finished: RunState.Finished? = null

    /** The newest heart rate and when it arrived; it rides on a fix when it is under [HrFreshMs] old. */
    @Volatile
    private var hr: Pair<Int, Long>? = null

    init {
        scope.launch(Dispatchers.Default) {
            for (cmd in commands) {
                try {
                    handle(cmd)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "run command ${cmd::class.simpleName} failed", e)
                    if (cmd is Cmd.Start) cmd.done.completeExceptionally(e)
                    if (cmd is Cmd.Attach) cmd.done.completeExceptionally(e)
                    if (cmd is Cmd.Save) cmd.done.completeExceptionally(e)
                    if (cmd is Cmd.Discard) cmd.done.completeExceptionally(e)
                }
            }
        }
    }

    // ---- what the screens and the service call ----

    /** Begins a run. The record of it is stored before this returns, so a service that starts next finds it. */
    suspend fun start(title: String, opts: RunOpts?) = CompletableDeferred<Unit>().also { commands.trySend(Cmd.Start(title, opts, it)) }.await()

    /** Picks up a stored run (a recovery after a kill, or a first look at launch); a no-op when the process already has it. */
    suspend fun attach() = CompletableDeferred<Unit>().also { commands.trySend(Cmd.Attach(it)) }.await()

    fun fix(fix: RawFix) { commands.trySend(Cmd.Fix(fix)) }
    fun advance() { commands.trySend(Cmd.Advance) }
    fun pause() { commands.trySend(Cmd.Pause) }
    fun resume() { commands.trySend(Cmd.Resume) }
    fun finish() { commands.trySend(Cmd.Finish) }
    fun heartRate(bpm: Int) { hr = bpm to now() }

    /** Saves the finished run as a session and closes the record. [srpe] is the effort picked, null when none was. */
    suspend fun save(srpe: Double?) = CompletableDeferred<Unit>().also { commands.trySend(Cmd.Save(srpe, it)) }.await()

    /** Throws the run away: its fixes and its record. */
    suspend fun discard() = CompletableDeferred<Unit>().also { commands.trySend(Cmd.Discard(it)) }.await()

    /** Whether a run is waiting to be recorded, so launch can put the service back. A finished run waits on its Summary instead. */
    suspend fun needsService(): Boolean = load()?.let { it.finishedAtMs == null && !runs.exists(it.id) } ?: false

    // ---- the actor ----

    private suspend fun handle(cmd: Cmd) {
        when (cmd) {
            is Cmd.Start -> {
                val a = ActiveRun(newId(), now(), cmd.title, cmd.opts)
                store(a)
                begin(a)
                cmd.done.complete(Unit)
            }
            is Cmd.Attach -> {
                if (active == null && finished == null) recover()
                cmd.done.complete(Unit)
            }
            is Cmd.Fix -> onFix(cmd.fix)
            Cmd.Advance -> {
                val a = active ?: return
                if (a.paused || finished != null) return
                db.runFixDao().advanceLast(a.id)
                val r = feed?.advance() ?: return
                r.events.forEach { _events.tryEmit(it) }
                _state.value = RunState.Active(a, r.live, freshHr())
            }
            Cmd.Pause -> setPaused(true)
            Cmd.Resume -> setPaused(false)
            Cmd.Finish -> finishNow()
            is Cmd.Save -> {
                val f = finished ?: error("no finished run to save")
                val run = f.result
                runs.saveRun(
                    NewRun(
                        id = f.run.id,
                        startedAtMs = f.run.startedAtMs,
                        distanceM = run.distanceM,
                        movingSec = run.movingSec,
                        elapsedSec = f.elapsedSec,
                        srpe = cmd.srpe,
                        minutes = f.elapsedSec / 60.0,
                    ),
                )
                clear()
                cmd.done.complete(Unit)
            }
            is Cmd.Discard -> {
                val id = active?.id ?: finished?.run?.id ?: load()?.id
                if (id != null) db.runFixDao().deleteRun(id)
                clear()
                cmd.done.complete(Unit)
            }
        }
    }

    private fun begin(a: ActiveRun) {
        feed?.close()
        feed = RunFeed(a.opts, a.startedAtMs)
        active = a
        finished = null
        lastTMs = Long.MIN_VALUE
        gapNext = false
        _state.value = RunState.Active(a, null, null)
    }

    private suspend fun onFix(f: RawFix) {
        val a = active ?: return
        val feed = feed ?: return
        if (a.paused || finished != null) return
        if (!f.lat.isFinite() || !f.lon.isFinite() || !f.acc.isFinite() || f.tMs < a.startedAtMs || f.tMs <= lastTMs) return
        val hr = freshHr(f.tMs)
        val gap = gapNext
        val row = RunFixEntity(a.id, f.tMs, f.lat, f.lon, f.acc, hr?.toDouble(), f.ele, if (gap) 1 else 0, 0)
        if (db.runFixDao().insert(row) == -1L) return           // not stored, so not pushed
        lastTMs = f.tMs
        gapNext = false
        val r = feed.push(f.tMs, f.lat, f.lon, f.acc, hr?.toDouble(), f.ele, gap) ?: return
        r.events.forEach { _events.tryEmit(it) }
        _state.value = RunState.Active(a, r.live, hr)
    }

    private suspend fun setPaused(paused: Boolean) {
        val a = active ?: return
        if (a.paused == paused || finished != null) return
        val next = a.copy(paused = paused)
        store(next)
        active = next
        if (!paused) gapNext = true                              // the first fix after a pause is a gap
        _state.value = RunState.Active(next, feed?.live, freshHr())
    }

    private suspend fun finishNow() {
        val a = active ?: return
        val f = feed ?: return
        val done = a.copy(finishedAtMs = now())
        store(done)
        val result = f.finish()
        val elapsed = f.elapsedSec(result)
        f.close()
        feed = null
        active = null
        finished = RunState.Finished(done, result, elapsed)
        _state.value = finished!!
    }

    /** Rebuilds a stored run: the fixes in time order through a fresh feed, each manual advance at the fix it followed. */
    private suspend fun recover() {
        val a = load()
        if (a == null) {
            _state.value = RunState.Idle
            return
        }
        if (runs.exists(a.id)) {                                  // saved just before the process died
            clear()
            return
        }
        val f = RunFeed(a.opts, a.startedAtMs)
        var last = Long.MIN_VALUE
        for (row in db.runFixDao().fixes(a.id)) {
            f.push(row.tMs, row.lat, row.lon, row.acc, row.hr, row.ele, row.gap == 1)
            repeat(row.advances) { f.advance() }
            last = row.tMs
        }
        feed = f
        active = a
        lastTMs = last
        gapNext = true                                            // whatever comes next follows a stretch with no recording
        Log.i(TAG, "recovered run ${a.id}: ${f.live?.points ?: 0} points, ${f.live?.distM ?: 0.0} m, cut ${f.cutMs} ms, finished=${a.finishedAtMs != null}")
        if (a.finishedAtMs != null) {
            finishNow()
        } else {
            _state.value = RunState.Active(a, f.live, null)
        }
    }

    private suspend fun clear() {
        feed?.close()
        feed = null
        active = null
        finished = null
        hr = null
        db.metaDao().remove(MetaKeys.RUN_ACTIVE)
        _state.value = RunState.Idle
    }

    private suspend fun store(a: ActiveRun) {
        db.metaDao().put(MetaEntity(MetaKeys.RUN_ACTIVE, QalaJson.encodeToString(ActiveRun.serializer(), a)))
    }

    private suspend fun load(): ActiveRun? =
        db.metaDao().get(MetaKeys.RUN_ACTIVE)?.let { QalaJson.decodeFromString(ActiveRun.serializer(), it) }

    /** The newest heart rate within [HrFreshMs] of [atMs], either side: a sample that arrived after the fix was taken still belongs to it. */
    private fun freshHr(atMs: Long = now()): Int? = hr?.takeIf { kotlin.math.abs(atMs - it.second) <= HrFreshMs }?.first

    companion object {
        private const val TAG = "RunRecording"

        /** A heart-rate sample further than this from a fix's time is not put on it. */
        const val HrFreshMs = 5_000L
    }
}
