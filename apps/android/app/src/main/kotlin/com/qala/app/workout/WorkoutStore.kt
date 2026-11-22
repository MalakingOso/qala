package com.qala.app.workout

import android.util.Log
import com.qala.data.IsoTime
import com.qala.data.QalaJson
import com.qala.data.core.QalaCore
import com.qala.data.core.exerciseMuscles
import com.qala.data.core.roundWeight
import com.qala.data.model.GymSettings
import com.qala.data.model.RestSettings
import com.qala.data.model.PlateSettings
import com.qala.data.model.WeightUnit
import com.qala.data.program.FinishOutcome
import com.qala.data.program.exerciseClassOf
import com.qala.data.program.LiftService
import com.qala.data.program.PlannedDay
import com.qala.data.program.PlannedSet
import com.qala.data.program.oneRepMax
import com.qala.data.program.plannedSets
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.SettingsRepository
import com.qala.data.repo.WorkoutDraftStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/** How a day opened. [NoDay] is a program that has no exercise on the day, or no program at all. */
enum class Opened { Ready, NoDay }

/**
 * What the app-wide timers say, whichever screen is showing (S45). Each is sent once per rest or countdown: a relaunch into a
 * rest that ended long ago says nothing.
 */
sealed interface WorkoutEvent {
    /** [seconds] are left of the rest: one short buzz and a soft tick. */
    data class RestWarning(val seconds: Int) : WorkoutEvent

    /** The rest reached zero. It stays open until the next set is logged. [next] is the set to open. */
    data class RestOver(val next: SetRef?) : WorkoutEvent

    /** The warm-up's cardio countdown reached zero. */
    data object CardioOver : WorkoutEvent
}

/**
 * The workout in progress, held for the life of the process (like the container's other long-lived state), so it
 * survives the screens: Workout to Rest and back, Back to Today and returning, a rotation. Each change is also written
 * to the draft store, so a killed process picks the workout up where it was. Nothing here touches Compose: the model is
 * [WorkoutState], this class is the I/O around it (the program, the update script, the finish).
 *
 * What Settings holds for the lifting flow ([GymSettings]: the bar and plates, the equipment, the warm-up, automatic rest
 * and showing plates) is followed here as it changes, so a set logged, a plate hint or a warm-up built a moment after a
 * change already uses it.
 *
 * All of it is meant to be called from the main thread; the Rust and database work runs off it, on [env]'s dispatcher
 * or the container's scope, which outlives any screen: a finish started from a screen that is then left is not cancelled.
 */
class WorkoutStore(
    private val service: LiftService,
    private val drafts: WorkoutDraftStore,
    private val checkIns: CheckInRepository,
    private val settings: SettingsRepository,
    private val env: RepoEnv,
    private val scope: CoroutineScope,
    /** The OS alarm that tells a lifter in another app the rest is over (D34). */
    private val restAlarm: RestAlarm = RestAlarm.None,
    /** The ongoing workout notification (S45). */
    private val notifier: WorkoutNotifier = WorkoutNotifier.None,
    /** The engine's G_m per muscle, as of the last build: where the rest planner's local fatigue comes from (D32). */
    private val fatigueByMuscle: () -> Map<String, Double> = { emptyMap() },
) {
    private val _state = MutableStateFlow<WorkoutState?>(null)

    /** The workout in progress, null before one is opened and after it is finished or discarded. */
    val state: StateFlow<WorkoutState?> = _state

    private val _plateHints = MutableStateFlow<Map<Double, PlateHint>>(emptyMap())

    /**
     * The plates for every weight a barbell set shows, by weight (pounds on a barbell only), filled in off the main
     * thread as weights appear: a stepper that lands on a new weight shows its plates a moment later.
     */
    val plateHints: StateFlow<Map<Double, PlateHint>> = _plateHints

    /** What the rest planner reads for each exercise of the open workout (by exercise key); filled in the background when a workout opens. */
    @Volatile
    private var restContexts: Map<String, RestContext> = emptyMap()

    private val _summary = MutableStateFlow<SessionSummary?>(null)

    /** The workout just finished, for Session complete: set when the finish starts, so it shows while the save runs. */
    val summary: StateFlow<SessionSummary?> = _summary

    /**
     * Whether a half-logged workout is waiting: the one open in memory, which a stored draft becomes as the store is made (the
     * same program, started within [DraftHours], not saved yet). Today's hero reads it as "Resume workout".
     */
    val hasDraft: StateFlow<Boolean> = _state.map { it != null }.stateIn(scope, SharingStarted.Eagerly, false)

    /** The waiting draft is only a warm-up in progress, with no lifting begun: Resume then leads to the warm-up. */
    val resumeAtWarmup: StateFlow<Boolean> = _state.map { it != null && !it.liftStarted }.stateIn(scope, SharingStarted.Eagerly, false)

    private val _events = MutableSharedFlow<WorkoutEvent>(extraBufferCapacity = 8)

    /** The warning, the end of a rest and the end of the cardio countdown, for the shell to buzz and navigate on. */
    val events: SharedFlow<WorkoutEvent> = _events

    private val _saved = MutableStateFlow<SetRef?>(null)

    /** The set whose row says "Saved" for a moment after an edit of it was saved. */
    val saved: StateFlow<SetRef?> = _saved

    /** Completes once a stored draft has been taken up (or found to be none), so nothing acts on the empty state of a cold start. */
    private val loaded = CompletableDeferred<Unit>()

    /** Waits for the draft left by a killed process to be loaded: what a tapped notification needs before it can say where to go. */
    suspend fun awaitLoaded() = loaded.await()

    private val _saveError = MutableStateFlow<String?>(null)

    /** Set when a finish could not save the workout (the draft is kept), cleared by the next finish that does. Today shows it. */
    val saveError: StateFlow<String?> = _saveError

    private val plateTried = HashSet<Double>()
    private var hintsFor: PlateSettings? = null

    private val _gym = MutableStateFlow(GymSettings())

    /** The lifting settings as the store last saw them; the screens read what to show and hide from it. */
    val gym: StateFlow<GymSettings> = _gym

    /** Completes when the first read of the settings has landed, so a workout or a warm-up never starts from the defaults by mistake. */
    private val gymLoaded = CompletableDeferred<Unit>()

    private val openLock = Mutex()
    private val scriptLock = Mutex()
    private val diskLock = Mutex()

    init {
        scope.launch {
            settings.gym.collect {
                _gym.value = it
                gymLoaded.complete(Unit)
            }
        }
        // The hints are for one bar and one inventory: when either changes they are asked for again.
        scope.launch {
            combine(_state.filterNotNull(), _gym.map { it.plates }.distinctUntilChanged()) { s, plates -> s to plates }
                .collect { (s, plates) -> fillPlateHints(s, plates) }
        }
        // A draft left by a killed process is the workout again, so a rest that was running goes on running (its alarm is kept,
        // its notification stays) and Rest opens from the notification.
        scope.launch {
            try {
                val saved = withContext(env.work) { drafts.load()?.let(WorkoutState::fromJson) }
                if (saved != null) {
                    val programId = withContext(env.work) { service.activeProgramId() }
                    val valid = saved.isFor(programId, saved.day, env.clock.nowMs()) && !withContext(env.work) { service.sessionExists(saved.sessionId) }
                    if (valid && _state.compareAndSet(null, saved)) loadRestContexts(saved)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("WorkoutStore", "the stored workout could not be read", e)
            } finally {
                loaded.complete(Unit)
            }
        }
        // Two alarms for the running rest: the warning and the end, set when it starts or is lengthened, dropped when it ends or is already over.
        scope.launch {
            loaded.await()
            combine(_state, _gym.map { it.rest }.distinctUntilChanged()) { s, rest -> alarmPlan(s, rest) }
                .distinctUntilChanged()
                .collect { plan ->
                    if (plan == null || plan.endAtMs <= env.clock.nowMs()) restAlarm.cancel() else restAlarm.schedule(plan)
                }
        }
        // The timers the whole app answers to: the warning and the end of a rest, and the end of the cardio.
        scope.launch {
            loaded.await()
            _state.map { s -> s?.rest?.let { RestKey(it.startedAtMs, it.seconds, it.ramp, it.next) } }.distinctUntilChanged().collectLatest { key -> if (key != null) watchRest(key) }
        }
        // The cardio countdown only matters until the lifting begins. In the app it buzzes; out of it (the screen sleeps on a bike) an alarm does.
        scope.launch {
            loaded.await()
            _state.map { s -> s?.takeIf { !it.liftStarted }?.cardio?.let { it.startedAtMs to it.budgetSec } }.distinctUntilChanged().collectLatest { cardio ->
                if (cardio != null && sleepUntil(cardio.first + cardio.second * 1000L)) _events.emit(WorkoutEvent.CardioOver)
            }
        }
        scope.launch {
            loaded.await()
            combine(_state.map { s -> s?.takeIf { !it.liftStarted }?.cardio?.endsAtMs }, _gym.map { it.rest.alert }.distinctUntilChanged()) { at, alert -> at to alert }
                .distinctUntilChanged()
                .collect { (at, alert) -> if (at == null || at <= env.clock.nowMs()) restAlarm.cancelCardio() else restAlarm.scheduleCardio(at, alert) }
        }
        // One ongoing notification from the workout's first action to its end.
        scope.launch {
            loaded.await()
            _state.map { s -> s?.notice(env.clock.nowMs()) }.distinctUntilChanged().collect { notifier.update(it) }
        }
        // One writer for the draft. A write that is no longer the current state is skipped, so a late write never
        // brings back a draft that a finish has just cleared.
        scope.launch {
            _state.collect { s ->
                if (s != null) diskLock.withLock { if (_state.value == s) drafts.save(s.toJson()) }
            }
        }
    }

    private data class RestKey(val startedAtMs: Long, val seconds: Int, val ramp: Int?, val next: SetRef?)

    /** What the OS needs to warn and tell the lifter, with the process gone, when [s]'s rest ends; null without a rest. */
    private fun alarmPlan(s: WorkoutState?, rest: RestSettings): RestAlarmPlan? {
        val r = s?.rest ?: return null
        val end = r.endsAtMs
        val warnAt = if (rest.warnSec > 0 && rest.warnSec < r.seconds) end - rest.warnSec * 1000L else null
        return RestAlarmPlan(end, warnAt, rest.warnSec, rest.alert, s.restAlarmText(), s.copy(rest = null).notice(end))
    }

    /** Waits until [atMs]; false when it is already more than [LateMs] past, which a relaunch into an old rest is, so it says nothing. */
    private suspend fun sleepUntil(atMs: Long): Boolean {
        val wait = atMs - env.clock.nowMs()
        if (wait < -LateMs) return false
        if (wait > 0) delay(wait)
        return true
    }

    /** Says the warning and the end of the rest [k] once each, and flips the notification to counting up when it is over. */
    private suspend fun watchRest(k: RestKey) {
        val end = k.startedAtMs + k.seconds * 1000L
        val warn = _gym.value.rest.warnSec
        if (warn > 0 && warn < k.seconds && sleepUntil(end - warn * 1000L)) _events.emit(WorkoutEvent.RestWarning(warn))
        if (sleepUntil(end)) _events.emit(WorkoutEvent.RestOver(k.next))
        notifier.update(_state.value?.notice(env.clock.nowMs()))
    }

    /**
     * Asks the plate math (Rust, so off the main thread) on [plates] for each barbell weight in [s] it has not answered yet.
     * The answers already there stay until their replacements come, so a plate change never blanks a sleeve.
     */
    private suspend fun fillPlateHints(s: WorkoutState, plates: PlateSettings) {
        if (plates != hintsFor) {
            hintsFor = plates
            plateTried.clear()
        }
        val missing = s.plateWeights().filter { plateTried.add(it) }
        if (missing.isEmpty()) return
        val answers = withContext(env.work) { missing.mapNotNull { w -> PlateMath.hint(w, plates)?.let { w to it } }.toMap() }
        if (answers.isNotEmpty()) _plateHints.update { it + answers }
    }

    /** True when a stored workout still stands for this day: the same program and day, started in the last [DraftHours] hours. */
    private fun WorkoutState.isFor(programId: String?, day: Int, nowMs: Long) =
        this.programId == programId && this.day == day && nowMs - startedAtMs in 0 until DraftHours * 3_600_000L

    /**
     * Makes the workout for program [day] the one in progress: the one already open (a draft of a killed process was taken up as
     * the store was made), or a new one from the program's prescription. A draft of another day, an old one, or one whose
     * session was already saved was dropped. With [forWarmup] the draft is opened for the warm-up, which starts its clock and
     * leaves the lifting unstarted; opening it for the workout starts the lifting, so the workout's own clock runs from there.
     */
    suspend fun open(day: Int, forWarmup: Boolean = false): Opened {
        gymLoaded.await()
        loaded.await()
        return openLock.withLock {
            val now = env.clock.nowMs()
            val programId = service.activeProgramId()
            _state.value?.let {
                if (it.isFor(programId, day, now)) {
                    _state.update { s -> if (forWarmup) s?.warmupStarted(now) else s?.beginLift(now, WarmupLongestSec) }
                    return@withLock Opened.Ready
                }
            }
            val planned = service.plan(day) ?: return@withLock Opened.NoDay
            val rounded = roundedPrescriptions(planned)
            val ramps = rampsFor(planned)
            val opened = WorkoutState.open(
                planned, env.ids.next(), now,
                prescribed = { rounded[it.key] ?: it.sets },
                lastTime = { id -> planned.lastTime[id]?.let(::lastTimeLine) },
                ramps = { ramps[it.key].orEmpty() },
                forWarmup = forWarmup,
            )
            _summary.value = null
            _state.value = opened
            loadRestContexts(opened)
            Opened.Ready
        }
    }

    /** The ramp steps of each exercise of [planned] by exercise key: the warm-up planner's, kept in the workout so the sets can show them. */
    private suspend fun rampsFor(planned: PlannedDay): Map<String, List<RampSetState>> =
        try {
            val plan = withContext(env.work) { buildWarmup(planned) }
            planned.plan.exercises.mapIndexedNotNull { i, ex ->
                val ramp = plan.ramps.getOrNull(i)?.takeIf { it.workWeight != null } ?: return@mapIndexedNotNull null
                ex.key to ramp.steps.map { RampSetState(it.load, it.reps, it.restSec, it.bar, it.extra) }
            }.toMap()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w("WorkoutStore", "the warm-up ramps could not be planned", e)
            emptyMap()
        }

    /** Reads, in the background, what the rest planner needs for each exercise of [s]: today's check-in, the engine's fatigue and the past rests (D32). */
    private fun loadRestContexts(s: WorkoutState) {
        scope.launch {
            // A read that fails leaves the rests planned without readiness or a learned pace, which is a fine rest.
            restContexts = try {
                withContext(env.work) { buildRestContexts(s) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("WorkoutStore", "the rest context could not be read", e)
                emptyMap()
            }
        }
    }

    private suspend fun buildRestContexts(s: WorkoutState): Map<String, RestContext> {
        val learn = _gym.value.rest.learn
        val samples = if (learn) restSamples(service.history()) else emptyList()
        val muscles = QalaCore.exerciseMuscles((s.exercises.map { it.exerciseId } + samples.map { it.first }).distinct())
        val mainLifts = settings.settings.first().mainLifts
        val nowMs = env.clock.nowMs()
        val today = IsoTime.localDateKey(nowMs, IsoTime.offsetMinAt(env.clock.zone, nowMs))
        val checkIn = checkIns.checkIns.first().lastOrNull { IsoTime.localDateKey(it.atMs, it.offsetMin) == today }
        val soreness = checkIn?.let { QalaJson.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), it.sorenessJson) }.orEmpty()
        val fatigue = fatigueByMuscle()
        return s.exercises.associate { ex ->
            val targets = muscles[ex.exerciseId]?.targets.orEmpty()
            ex.key to RestContext(
                exercise = samples.filter { it.first == ex.exerciseId }.map { it.second }.takeLast(RestMemory),
                cls = samples.filter { exerciseClassOf(it.first, mainLifts, muscles[it.first]) == ex.cls }.map { it.second }.takeLast(RestMemory),
                soreness = targets.maxOfOrNull { soreness[it] ?: 0 }?.takeIf { it > 0 },
                prs = checkIn?.recovery,
                // G_m over 8 hard set-equivalents is 1, as the engine reads it (readiness.rs fatigue_local); G_m is as of the last build.
                fatigueLocal = targets.mapNotNull { fatigue[it] }.maxOrNull()?.let { (it / 8.0).coerceIn(0.0, 1.0) },
            )
        }
    }

    /**
     * The program's [day] as a workout not yet started, every set at its prescription: what the All exercises grid shows
     * before the workout is opened (during the warm-up). It is not kept and starts nothing. Null when the day has no exercise.
     */
    suspend fun preview(day: Int): WorkoutState? {
        gymLoaded.await()
        val planned = service.plan(day) ?: return null
        val rounded = roundedPrescriptions(planned)
        return WorkoutState.open(planned, sessionId = "preview", startedAtMs = env.clock.nowMs(), prescribed = { rounded[it.key] ?: it.sets })
    }

    /**
     * The sets of each barbell lift in [day] with their weights rounded to what the saved plates can load, by exercise key
     * (D33; pounds on a barbell only, other lifts keep the program's numbers). Rust, so off the main thread.
     */
    private suspend fun roundedPrescriptions(day: PlannedDay): Map<String, List<PlannedSet>> {
        val setup = _gym.value.plates
        return withContext(env.work) {
            day.plan.exercises.filter { PlateMath.applies(day.unit, it.equipment == "barbell") }.associate { it.key to roundSets(it.sets, setup) }
        }
    }

    /** Only a set whose own unit is pounds is rounded: a kilogram set in a pound program has no inventory to round to. */
    private fun roundSets(sets: List<PlannedSet>, setup: PlateSettings): List<PlannedSet> =
        sets.map { s ->
            val w = s.weight
            if (w != null && PlateMath.applies(s.unit, true)) s.copy(weight = QalaCore.roundWeight(w, setup.defaultBar, setup.plates)) else s
        }

    private fun edit(change: (WorkoutState) -> WorkoutState) = _state.update { it?.let(change) }

    // ---- moving about and the logger ----

    /**
     * Moving off a done set whose numbers were changed saves it (S46): the update script reads it again and its row says "Saved".
     * The numbers themselves are already in the workout, as the steppers write them as they go.
     */
    private fun saveEdit() {
        val ref = _state.value?.unsaved() ?: return
        edit { it.saved() }
        runUpdateScript(ref)
        flashSaved(ref)
    }

    /**
     * Shows "Saved" on the row of [ref] for a moment. Then the logger goes back to [back], the set that was open, unless the lifter
     * has already moved off the saved set by then.
     */
    private fun flashSaved(ref: SetRef, back: SetRef? = null) {
        _saved.value = ref
        scope.launch {
            delay(SavedFlashMs)
            _saved.compareAndSet(ref, null)
            if (back != null) edit { s -> if (s.current == ref.exercise && s.exercise.selected == ref.set) s.show(back.exercise, back.set) else s }
        }
    }

    fun show(exercise: Int, set: Int? = null) { saveEdit(); edit { it.show(exercise, set) } }
    fun prev() { saveEdit(); edit { it.prev() } }
    fun next() { saveEdit(); edit { it.next() } }
    fun pickSet(set: Int) { saveEdit(); edit { it.pickSet(set) } }
    fun stepWeight(direction: Int) = edit { it.stepWeight(direction) }
    fun stepReps(direction: Int) = edit { it.stepReps(direction) }
    fun pickRpe(rpe: Double) = edit { it.pickRpe(rpe) }
    fun toggleJointPain() = edit { it.toggleJointPain() }

    /**
     * Logs the selected set. The first logging of a set starts the rest after it (unless it was the last set of the
     * workout, or automatic rest is off in Settings: then the logger only moves to the next set), runs the program's
     * update script, which may rewrite the sets still to come, and lets a grind lower or drop the sets still to come (S47).
     * Logging a set already done saves it and goes back to the set that was open.
     */
    fun log(): AfterLog {
        val now = env.clock.nowMs()
        val autoRest = _gym.value.rest.auto
        val adjust = _gym.value.rest.adjustLoad
        var result = AfterLog.Stay
        var logged: SetRef? = null
        var back: SetRef? = null
        _state.update { s ->
            result = AfterLog.Stay
            logged = null
            back = null
            if (s == null) return@update s
            val key = s.exercise.key
            val l = s.log(now, restContexts[key] ?: RestContext(), adjust, ::lowerLoad) ?: return@update s
            logged = l.ref
            back = l.next
            val settled = l.settle(now, autoRest, restContexts)
            result = settled.after
            settled.state
        }
        logged?.let { runUpdateScript(it) }
        if (result == AfterLog.Saved) logged?.let { saved -> flashSaved(saved, back) }
        if (result == AfterLog.Rest) _state.value?.rest?.let { restPlates(it.logged, it.next) }
        return result
    }

    /** [weight] of [ex] rounded down to what its plates (or its dumbbell steps) can make. */
    private fun lowerLoad(ex: ExerciseState, weight: Double): Double {
        if (ex.barbell) return PlateMath.floor(weight, _gym.value.plates)
        val step = weightStep(ex.unit)
        return Math.floor(weight / step + 1e-9) * step
    }

    /** Ticks ramp step [step] of exercise [exercise] (or takes the tick back); ticking starts its short rest on the same timer as any rest. */
    fun tickRamp(exercise: Int, step: Int) = edit { it.tickRamp(exercise, step, env.clock.nowMs()) }

    private fun runUpdateScript(ref: SetRef) {
        scope.launch {
            scriptLock.withLock {
                val s = _state.value ?: return@withLock
                val ex = s.exercises.getOrNull(ref.exercise) ?: return@withLock
                val entry = ex.completedEntry()
                val updated = withContext(env.work) { service.afterSet(s.day, ex.key, entry, ref.set) }
                if (updated != entry) {
                    val planned = if (ex.barbell) withContext(env.work) { roundSets(plannedSets(updated, ex.unit), _gym.value.plates) } else null
                    _state.update { it?.withUpdatedEntry(ref.exercise, updated, planned) }
                }
            }
        }
    }

    /**
     * The plates for the set the rest is for, and how to get there from the set just done, put into the running rest. Both
     * need a barbell in pounds: moving to a dumbbell or a cable leaves them out, and the instruction needs the set before it
     * to have been on a bar too.
     */
    private fun restPlates(logged: SetRef, next: SetRef?) {
        if (next == null) return
        scope.launch {
            val s = _state.value ?: return@launch
            val nextEx = s.exercises.getOrNull(next.exercise) ?: return@launch
            val nextWeight = nextEx.sets.getOrNull(next.set)?.weight
            if (!nextEx.barbell || nextWeight == null) return@launch
            val setup = _gym.value.plates
            val answer = withContext(env.work) {
                val hint = PlateMath.hint(nextWeight, setup) ?: return@withContext null
                val doneEx = s.exercises[logged.exercise]
                val doneWeight = doneEx.sets.getOrNull(logged.set)?.weight
                val change = if (doneEx.barbell && doneWeight != null) {
                    PlateMath.hint(doneWeight, setup)?.let { PlateMath.change(it.perSide, nextWeight, setup)?.instruction }
                } else {
                    null
                }
                Triple(hint.perSide, change, hint.total)
            }
            if (answer != null) _state.update { it?.withRestPlates(logged, answer.first, answer.second, answer.third) }
        }
    }

    // ---- rest ----

    fun addRest(seconds: Int) = edit { it.addRest(seconds) }
    fun endRest() = edit { it.endRest(env.clock.nowMs()) }

    /**
     * Starts the rest after the done set at [ref] by hand, for a lifter who has Automatic rest off (D34). True when a rest
     * started, which the caller follows by opening Rest.
     */
    fun startRest(ref: SetRef): Boolean {
        val now = env.clock.nowMs()
        var started = false
        _state.update { s ->
            started = false
            if (s == null || s.exercises.getOrNull(ref.exercise)?.sets?.getOrNull(ref.set)?.done != true) return@update s
            started = true
            s.startRest(ref, s.nextOpen(ref), now, restContexts[s.exercises[ref.exercise].key] ?: RestContext())
        }
        if (started) _state.value?.rest?.let { restPlates(it.logged, it.next) }
        return started
    }

    // ---- finishing ----

    /**
     * Saves the workout: the session with its sets and the program moved on, in one transaction (see
     * [LiftService.finish]). Then the draft is cleared. A failure leaves the draft, so Start workout on Today picks the
     * workout up again. Returns null when no workout is open or the save failed.
     */
    suspend fun finish(): FinishOutcome? {
        val s = _state.value ?: return null
        val now = env.clock.nowMs()
        val muscles = try {
            QalaCore.exerciseMuscles(s.exercises.map { it.exerciseId })
        } catch (e: Exception) {
            emptyMap()
        }
        _summary.value = s.summary(now, muscles)
        val outcome = try {
            service.finish(s.toLifted(now))
        } catch (e: Exception) {
            Log.e("WorkoutStore", "saving the workout failed", e)
            _saveError.value = SaveFailed
            return null
        }
        if (outcome.errors.isNotEmpty()) Log.w("WorkoutStore", "the program was not advanced: ${outcome.errors}")
        _saveError.value = null
        close()
        return outcome
    }

    /** The user took the message in (Resume was tapped): the banner goes, the workout stays. */
    fun clearSaveError() { _saveError.value = null }

    /** Throws the workout in progress away without saving anything. */
    fun discard() {
        scope.launch { close() }
    }

    private suspend fun close() = diskLock.withLock {
        _state.value = null
        drafts.clear()
    }

    // ---- the warm-up ----

    /**
     * Opens the draft for [day]'s warm-up on its first action, so the cardio countdown, the ticks and the warm-up's clock are kept
     * with the workout. Looking at the warm-up opens nothing: [warmup] only reads.
     */
    suspend fun startWarmup(day: Int): Boolean = open(day, forWarmup = true) == Opened.Ready

    /** Starts the cardio countdown at [budgetSec] seconds, the first action of a warm-up that has one. */
    suspend fun startCardio(day: Int, budgetSec: Int) {
        if (startWarmup(day)) edit { it.startCardio(env.clock.nowMs(), budgetSec) }
    }

    /** Lengthens (or shortens) the running cardio countdown by [seconds]. */
    fun addCardio(seconds: Int) = edit { it.addCardio(seconds) }

    /** Ticks a soft-tissue or mobility row, or takes the tick back; the first tick opens the draft. */
    suspend fun flipWarmup(day: Int, id: String) {
        if (startWarmup(day)) edit { it.flipWarmup(id) }
    }

    /**
     * The warm-up for program [day]: the day's exercises, their working weights against the 1RMs, and today's
     * check-in (soreness and recovery). Null when the day has nothing to lift.
     */
    suspend fun warmup(day: Int): WarmupView? = withContext(env.work) {
        gymLoaded.await()
        val gym = _gym.value
        val planned = service.plan(day) ?: return@withContext null
        val plan = buildWarmup(planned)
        WarmupView(
            dayName = planned.plan.dayName,
            programName = planned.plan.programName,
            unit = planned.unit,
            plan = plan,
            blocksOff = !gym.warmup.enabled,
        )
    }

    private suspend fun buildWarmup(planned: PlannedDay): WarmupPlan {
        val gym = _gym.value
        val nowMs = env.clock.nowMs()
        val today = IsoTime.localDateKey(nowMs, IsoTime.offsetMinAt(env.clock.zone, nowMs))
        val checkIn = checkIns.checkIns.first().lastOrNull { IsoTime.localDateKey(it.atMs, it.offsetMin) == today }
        val soreness = checkIn?.let { QalaJson.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), it.sorenessJson) }.orEmpty()
        val exercises = planned.plan.exercises.map { ex ->
            val top = ex.sets.withIndex().filter { it.value.weight != null }.maxWithOrNull(compareBy({ it.value.weight }, { it.index }))?.value
            WarmupExercise(
                exerciseId = ex.exerciseId,
                name = ex.name,
                cls = ex.cls,
                muscles = planned.muscles[ex.exerciseId]?.targets.orEmpty(),
                weight = top?.weight,
                reps = top?.reps ?: ex.sets.firstOrNull()?.reps ?: 5.0,
                repsLabel = top?.let { repsTarget(it) } ?: ex.sets.firstOrNull()?.let { repsTarget(it) }.orEmpty(),
                reference = oneRepMax(planned.exerciseData, ex, planned.unit),
                barbell = ex.equipment == "barbell",
            )
        }
        return planWarmup(warmupInput(exercises, planned.unit, soreness, checkIn?.recovery, gym))
    }

    companion object {
        /** A stored workout older than this is a forgotten one, not a half-finished one. */
        const val DraftHours = 16

        /** How many past rests the learned pace looks back over, about ten rests of memory at a rate of 0.1 (PLAN 6.6), with room to spare. */
        const val RestMemory = 40

        /** A warm-up measured at more than this was a break, not a warm-up. */
        const val WarmupLongestSec = 90 * 60

        /** An event later than this after its moment is not sent: the lifter was away, and the notification said it. */
        const val LateMs = 3_000L

        /** How long a saved set's row says "Saved". */
        const val SavedFlashMs = 1_000L

        const val SaveFailed = "Couldn't save the workout. It's kept, tap Resume to try again."
    }
}

/** The warm-up screen's content. */
class WarmupView(
    val dayName: String,
    val programName: String,
    val unit: WeightUnit,
    val plan: WarmupPlan,
    /** "Build a warm-up" is off in Settings, so only the ramp sets are here. */
    val blocksOff: Boolean = false,
)
