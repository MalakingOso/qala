package com.qala.data.seed

import com.qala.data.BuildConfig
import com.qala.data.QalaJson
import com.qala.data.db.MetaEntity
import com.qala.data.db.MetaKeys
import com.qala.data.db.QalaDatabase
import com.qala.data.model.SkipReason
import com.qala.data.model.wire
import com.qala.data.repo.AvailabilityRepository
import com.qala.data.repo.BodyWeightRepository
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.NewLiftSession
import com.qala.data.repo.NewRun
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.RunRepository
import com.qala.data.repo.SessionRepository
import com.qala.data.repo.SettingsRepository
import java.time.LocalDate
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/**
 * Writes the debug seed into the database through the repositories, so it takes the same path (clocks,
 * outbox) as real data. It runs only in debug builds, only once (a `meta` flag), and only when the app
 * container calls it: a release build starts empty and every card shows its plain empty state.
 *
 * The ids are deterministic, so a seed interrupted half way and run again rewrites the same records instead
 * of doubling them.
 */
class DebugSeeder(
    private val db: QalaDatabase,
    private val sessions: SessionRepository,
    private val runs: RunRepository,
    private val checkIns: CheckInRepository,
    private val weights: BodyWeightRepository,
    private val availability: AvailabilityRepository,
    private val settings: SettingsRepository,
    private val programs: ProgramRepository,
    private val env: RepoEnv = RepoEnv(),
    private val generator: SeedGenerator = SeedGenerator(),
) {
    /** Seeds the database once and returns true; false when this is not a debug build or it already ran. */
    suspend fun seedIfEmpty(today: LocalDate = LocalDate.now(env.clock.zone)): Boolean {
        if (!BuildConfig.DEBUG) return false
        if (db.metaDao().get(MetaKeys.DEBUG_SEEDED) != null) return false
        val data = withContext(env.work) { generator.generate(today, env.clock.zone) }
        write(data)
        db.metaDao().put(MetaEntity(MetaKeys.DEBUG_SEEDED, "1"))
        return true
    }

    /**
     * Writes [data] without the debug and once-only checks (the instrumented tests call it directly). The
     * environment's zone must be the one the seed was generated for: record offsets are taken from it.
     */
    suspend fun write(data: SeedData) {
        settings.setUnit(data.settings.unit)
        settings.setMainLifts(data.settings.mainLifts)
        settings.setTrainingWeekdays(data.settings.trainingWeekdays)
        settings.setRunPlan(data.runPlan)
        settings.setExerciseData(data.exerciseData)
        programs.save(data.programId, data.programName, data.programText)

        for (s in data.sessions) {
            val row = s.bundle.session
            sessions.saveLiftSession(
                NewLiftSession(
                    startedAtMs = row.startedAtMs,
                    programDayIndex = row.programDayIndex,
                    entries = s.bundle.entries,
                    minutes = row.minutes,
                    srpe = row.srpe,
                    notes = row.notes,
                    id = row.id,
                ),
            )
        }
        for (r in data.runs) {
            runs.saveRun(
                NewRun(
                    startedAtMs = r.startedAtMs,
                    distanceM = r.distanceM,
                    movingSec = r.movingSec,
                    elapsedSec = r.elapsedSec,
                    srpe = r.srpe,
                    minutes = r.minutes,
                    hrTrimp = r.hrTrimp,
                    descentM = r.descentM,
                    notes = r.notes,
                    id = r.id,
                ),
            )
        }
        for (c in data.checkIns) {
            val soreness = QalaJson.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), c.sorenessJson)
            checkIns.save(c.recovery, soreness, c.note, atMs = c.atMs, id = c.id)
        }
        for (w in data.weights) weights.log(w.date, w.kg, w.id)
        for (k in data.skips) {
            availability.skip(k.date, SkipReason.entries.first { it.wire() == k.reason }, k.muscle, k.note)
        }
    }
}
