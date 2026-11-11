package com.qala.data.engine

import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.ProgramEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.model.Availability
import com.qala.data.model.RunPlan
import com.qala.data.model.SettingsRecord
import com.qala.data.program.ProgramEngine
import com.qala.data.repo.AvailabilityRepository
import com.qala.data.repo.BodyWeightRepository
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.RunRepository
import com.qala.data.repo.SessionRepository
import com.qala.data.repo.SettingsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/**
 * The in-memory engine snapshot (docs/archive/completed.md, M2 as built). It is rebuilt on launch and
 * whenever sessions, runs, check-ins, weights, skips, the status, the settings or the program change: the
 * records are collected, debounced by [debounceMs] so a burst of writes costs one build, and handed to
 * [EngineCompute] on `Dispatchers.Default`. The snapshot holds the engine state, the readiness summary,
 * planned and done week load, the weight trend and today's stages. It is derived data and is not persisted;
 * if replay time ever shows up as a problem a local cache table can sit behind it.
 *
 * The snapshot also depends on the time of day, so call [refresh] when the app returns to the foreground
 * (a new day moves "today" and the week).
 */
@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
class EngineRepository(
    sessions: SessionRepository,
    runs: RunRepository,
    checkIns: CheckInRepository,
    weights: BodyWeightRepository,
    availability: AvailabilityRepository,
    settings: SettingsRepository,
    programs: ProgramRepository,
    scope: CoroutineScope,
    private val env: RepoEnv = RepoEnv(),
    private val compute: EngineCompute = EngineCompute(ProgramEngine()),
    private val debounceMs: Long = 250,
) {
    private val _snapshot = MutableStateFlow(EngineSnapshot())

    /** The latest snapshot; [EngineSnapshot.loaded] is false until the first build finishes. */
    val snapshot: StateFlow<EngineSnapshot> = _snapshot

    private val refreshTick = MutableStateFlow(0)

    /** Rebuilds the snapshot for the current time without a record change. */
    fun refresh() = refreshTick.update { it + 1 }

    private val inputs: Flow<EngineInput> = combine(
        sessions.liftSessions,
        runs.runs,
        checkIns.checkIns,
        weights.weights,
        availability.skips,
        availability.status,
        settings.settings,
        settings.runPlan,
        settings.exerciseData,
        programs.active,
        refreshTick,
    ) { v ->
        @Suppress("UNCHECKED_CAST")
        EngineInput(
            liftSessions = v[0] as List<LiftSessionWithEntries>,
            runs = v[1] as List<RunSessionEntity>,
            checkIns = v[2] as List<CheckInEntity>,
            weights = v[3] as List<BodyWeightEntity>,
            skips = v[4] as List<DaySkipEntity>,
            availability = v[5] as Availability,
            settings = v[6] as SettingsRecord,
            runPlan = v[7] as RunPlan,
            exerciseData = v[8] as JsonObject,
            program = v[9] as ProgramEntity?,
        )
    }

    init {
        scope.launch {
            inputs
                .debounce(debounceMs)
                .mapLatest { input ->
                    withContext(env.work) {
                        val now = env.clock.nowMs()
                        try {
                            compute.compute(input, now, env.clock.zone)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            EngineSnapshot(loaded = true, builtAtMs = now, error = e.message ?: e.javaClass.simpleName)
                        }
                    }
                }
                .collect { _snapshot.value = it }
        }
    }
}
