package com.qala.app

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import com.qala.data.QalaJson
import com.qala.data.core.QalaCore
import com.qala.data.db.MetaKeys
import com.qala.data.core.shiftsPlan
import com.qala.data.model.SkipReason
import com.qala.data.db.QalaDatabase
import com.qala.data.engine.EngineCompute
import com.qala.data.engine.EngineRepository
import com.qala.data.program.LiftService
import com.qala.data.program.PlanStarter
import com.qala.data.plan.PlanCompute
import com.qala.data.program.ProgramEngine
import com.qala.data.repo.AvailabilityRepository
import com.qala.data.repo.BodyWeightRepository
import com.qala.data.repo.CheckInRepository
import com.qala.data.repo.ProgramRepository
import com.qala.data.repo.RepoEnv
import com.qala.data.repo.RunRepository
import com.qala.data.repo.SessionRepository
import com.qala.data.repo.SettingsRepository
import com.qala.data.repo.WorkoutDraftStore
import com.qala.app.coach.CoachClient
import com.qala.app.coach.CoachStore
import com.qala.app.coach.HttpCoachClient
import com.qala.app.run.RunRecording
import com.qala.app.workout.AndroidRestAlarm
import com.qala.app.workout.AndroidWorkoutNotifier
import com.qala.app.workout.RestAlarm
import com.qala.app.workout.WorkoutNotifier
import com.qala.app.workout.WorkoutStore
import com.qala.data.seed.DebugSeeder
import com.qala.data.sync.RecordWriter
import com.qala.data.sync.RoomTransactor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.coroutines.launch

/**
 * Hand-written dependency injection (docs/archive/completed.md, M2 as built): constructor injection and no library. The
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
    /** Where the Coach tab asks. The app makes no request until the athlete sends a question, so building the container touches no network. */
    coachClient: CoachClient = HttpCoachClient(BuildConfig.COACH_BASE_URL),
    /** The OS alarm behind the rest-end notification; the default does nothing, so tests and previews set none. */
    restAlarm: RestAlarm = RestAlarm.None,
    /** The ongoing notification of a workout; the default shows nothing. */
    notifier: WorkoutNotifier = WorkoutNotifier.None,
) {
    val writer = RecordWriter(RoomTransactor(database))

    val sessions = SessionRepository(database, writer, env)
    val runs = RunRepository(database, writer, env)
    val checkIns = CheckInRepository(database, writer, env)
    val weights = BodyWeightRepository(database, writer, env)
    val availability = AvailabilityRepository(database, writer, env)
    val settings = SettingsRepository(database, writer, env)
    val programs = ProgramRepository(database, writer, settings, env)

    val programEngine = ProgramEngine()

    /** Picks a plan from the built-ins (Plan's picker). Its writes run on [scope], so leaving the screen cannot cut them short. */
    val planStarter = PlanStarter(programs, settings, WorkoutDraftStore(database, env), env)

    /**
     * The workout in progress and everything around it: the program's day, the update script, the finish. Process-wide, so
     * Workout, Rest and Today share one workout, and it is kept in the database so a killed process loses none of it.
     */
    val workout = WorkoutStore(
        LiftService(programs, settings, sessions, programEngine, env),
        WorkoutDraftStore(database, env),
        checkIns,
        settings,
        env,
        scope,
        restAlarm,
        notifier,
        fatigueByMuscle = { engine.snapshot.value.stateView?.fatigueMuscle.orEmpty() },
    )

    /**
     * A screen something outside the app asked for (a tapped notification): MainActivity puts it here and the shell takes
     * it, shows it and clears it. A state, not an event, so one that arrives before the shell exists is not lost.
     */
    val pendingRoute = MutableStateFlow<Route?>(null)

    /** The run in progress: the recorder, the stored fixes and the live numbers. Process-wide, like the workout, and the service is only glue to it. */
    val runRecording = RunRecording(database, runs, scope, now = { env.clock.nowMs() })

    /** The heart-rate strap the lifter picked, or null; this install's, in the meta table. */
    suspend fun strapAddress(): String? =
        database.metaDao().get(MetaKeys.RUN_STRAP)?.let { (QalaJson.parseToJsonElement(it) as? JsonObject)?.get("address")?.jsonPrimitive?.contentOrNull }

    /** The conversation with the coach (A6). Process-wide, so the thread survives a visit to another tab. */
    val coach = CoachStore(coachClient, scope)

    /** Lays out any week for the Plan screen from the records behind the engine snapshot. */
    val planCompute = PlanCompute(programEngine)

    /** Whether each skip reason pushes the plan out, as the core's `shifts_plan` answers (vacation and sick do). Five tiny calls, made once. */
    val shiftRules: Map<SkipReason, Boolean> by lazy { SkipReason.entries.associateWith { QalaCore.shiftsPlan(it) } }

    /**
     * Whether "Feeling better?" has been answered this session. A plain in-memory flag: the container lives as long as the
     * process, so it holds across a recreated activity and is forgotten with the process, which is "once per session".
     */
    var feelingBetterAsked by mutableStateOf(false)

    /** The derived state the Today cards read: engine state, readiness, week load, weight trend, today's stages. */
    val engine = EngineRepository(
        sessions, runs, checkIns, weights, availability, settings, programs, scope, env,
        compute = EngineCompute(programEngine),
    )

    private val seeder = DebugSeeder(database, sessions, runs, checkIns, weights, availability, settings, programs, env)

    /**
     * Runs the debug seed in a debug build, once per install, unless [seed] is false. Safe to call again. [seed] only
     * ever turns the seed off: a container built without it (a release build) stays empty.
     */
    fun start(seed: Boolean = true) {
        if (seedInDebug && seed) scope.launch { seeder.seedIfEmpty() }
    }

    companion object {
        @Volatile
        private var instance: AppContainer? = null

        /** The one container of the process, so a recreated activity does not open the database twice. */
        fun obtain(context: Context): AppContainer =
            instance ?: synchronized(this) {
                instance ?: AppContainer(QalaDatabase.open(context), restAlarm = AndroidRestAlarm(context), notifier = AndroidWorkoutNotifier(context)).also { instance = it }
            }
    }
}

/** The app's container. Provided by MainActivity; a screen outside it is a bug, so there is no default. */
val LocalAppContainer = staticCompositionLocalOf<AppContainer> {
    error("No AppContainer: provide LocalAppContainer above this composable")
}
