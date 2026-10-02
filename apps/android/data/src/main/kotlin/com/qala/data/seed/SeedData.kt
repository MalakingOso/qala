package com.qala.data.seed

import com.qala.data.db.BodyWeightEntity
import com.qala.data.db.CheckInEntity
import com.qala.data.db.DaySkipEntity
import com.qala.data.db.LiftEntryEntity
import com.qala.data.db.LiftEntryWithSets
import com.qala.data.db.LiftSessionWithEntries
import com.qala.data.db.LiftSetEntity
import com.qala.data.db.ProgramEntity
import com.qala.data.db.RunSessionEntity
import com.qala.data.engine.EngineInput
import com.qala.data.model.Availability
import com.qala.data.model.RunPlan
import com.qala.data.model.SettingsRecord
import com.qala.data.model.childRows
import com.qala.data.program.EvaluatedProgram
import com.qala.data.sync.LiftSessionBundle
import java.time.ZoneId
import kotlinx.serialization.json.JsonObject

/** One seeded lift session and what the generator did to it. */
class SeededSession(
    val bundle: LiftSessionBundle,
    /** The 1-based program day the session ran. */
    val programDay: Int,
    /** The day the finish-day script said comes next. */
    val nextDay: Int,
    /** Sets completed below their target reps. */
    val missedSets: Int,
    /** Sets logged at RPE 9. */
    val rpe9Sets: Int,
)

/**
 * A few weeks of history generated together with the program text that goes with it. The program's
 * progression state lives inside its text, so each session was logged against the day the text prescribed,
 * and the text was advanced by the finish-day script before the next one: [programText] is the text after
 * the last session, and [sessions] are what was lifted on the way.
 */
class SeedData(
    /** The local day the seed was built for: history runs up to the day before. */
    val today: String,
    val zone: ZoneId,
    val programId: String,
    val programName: String,
    /** The program text after the last seeded session. */
    val programText: String,
    /** LS++ `exerciseData`: the 1RMs the program evaluates under. */
    val exerciseData: JsonObject,
    val sessions: List<SeededSession>,
    val runs: List<RunSessionEntity>,
    val checkIns: List<CheckInEntity>,
    val weights: List<BodyWeightEntity>,
    val skips: List<DaySkipEntity>,
    val runPlan: RunPlan,
    val settings: SettingsRecord,
    /** The program as the last finish-day call returned it, not re-evaluated from [programText]. */
    val chainProgram: EvaluatedProgram,
) {
    val program: ProgramEntity get() = ProgramEntity(programId, programName, programText, deleted = false)

    /** The program day of the last seeded lift: the next one in the rotation is what Today shows. */
    val lastProgramDay: Int get() = sessions.last().programDay

    /** Everything as [com.qala.data.engine.EngineCompute] takes it, as the repositories would hand it out. */
    fun engineInput(): EngineInput = EngineInput(
        liftSessions = sessions.map { it.bundle.asRows() },
        runs = runs,
        checkIns = checkIns,
        weights = weights,
        skips = skips,
        availability = Availability(),
        settings = settings,
        runPlan = runPlan,
        exerciseData = exerciseData,
        program = program,
    )
}

/** A bundle as Room would read it back: the session row with its entry and set rows. */
internal fun LiftSessionBundle.asRows(): LiftSessionWithEntries {
    val (entryRows, setRows) = childRows(session.id, entries)
    return LiftSessionWithEntries(
        session = session,
        entries = entryRows.map { e: LiftEntryEntity ->
            LiftEntryWithSets(e, setRows.filter { s: LiftSetEntity -> s.entryId == e.id })
        },
    )
}
