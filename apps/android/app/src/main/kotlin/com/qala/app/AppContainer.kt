package com.qala.app

import android.content.Context
import androidx.compose.runtime.staticCompositionLocalOf
import com.qala.data.db.QalaDatabase
import com.qala.data.engine.EngineCompute
import com.qala.data.engine.EngineRepository
import com.qala.data.program.ProgramEngine
import com.qala.data.repo.AvailabilityRepository
import com.qala.data.repo.BodyWeightRepository
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.RunRepository
import com.qala.data.repo.SessionRepository
import com.qala.data.repo.SettingsRepository
import com.qala.data.seed.DebugSeeder
import com.qala.data.sync.RecordWriter
import com.qala.data.sync.RoomTransactor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Hand-written dependency injection (docs/PLAN-m2-room-data.md, DI): constructor injection and no library. The
 * container owns the Room database, the [RecordWriter], the repositories and the [EngineRepository], and
 * screens reach it through [LocalAppContainer].
 *
 * Building it opens nothing: Room opens the file on the first query, off the main thread, and the engine
 * repository starts collecting as soon as it exists. [start] runs the debug seed; a release build never
 * seeds and starts with empty records.
 */
class AppContainer(
    val database: QalaDatabase,
    val env: RepoEnv = RepoEnv(),
    /** Lives as long as the container: the engine collection and the seed run in it. */
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val seedInDebug: Boolean = BuildConfig.DEBUG,
) {
    val writer = RecordWriter(RoomTransactor(database))

    val sessions = SessionRepository(database, writer, env)
    val runs = RunRepository(database, writer, env)
    val checkIns = CheckInRepository(database, writer, env)
    val weights = BodyWeightRepository(database, writer, env)
    val availability = AvailabilityRepository(database, writer, env)
    val settings = SettingsRepository(database, writer, env)
    val programs = ProgramRepository(database, writer, env)

    val programEngine = ProgramEngine()

    /** The derived state the Today cards read: engine state, readiness, week load, weight trend, today's stages. */
    val engine = EngineRepository(
        sessions, runs, checkIns, weights, availability, settings, programs, scope, env,
        compute = EngineCompute(programEngine),
    )

    private val seeder = DebugSeeder(database, sessions, runs, checkIns, weights, availability, settings, programs, env)

    /** Runs the debug seed in a debug build, once per install. Safe to call again. */
    fun start() {
        if (seedInDebug) scope.launch { seeder.seedIfEmpty() }
    }

    companion object {
        @Volatile
        private var instance: AppContainer? = null

        /** The one container of the process, so a recreated activity does not open the database twice. */
        fun obtain(context: Context): AppContainer =
            instance ?: synchronized(this) {
                instance ?: AppContainer(QalaDatabase.open(context)).also { instance = it }
            }
    }
}

/** The app's container. Provided by MainActivity; a screen outside it is a bug, so there is no default. */
val LocalAppContainer = staticCompositionLocalOf<AppContainer> {
    error("No AppContainer: provide LocalAppContainer above this composable")
}
