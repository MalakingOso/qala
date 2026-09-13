// Qala runtime over the vendored liftoscript stack (PLAN section 5, M1).
//
// Liftosaur's program/progress entry points that the app shell owns (redux
// thunks, navigation, storage) are lifted out and rewritten here against
// `@qala/core` document types, with the vendored liftosaur model types used
// for everything the scripts themselves touch:
//
// - `forceEvaluate` / `nextDay`
// - `createScriptBindings` / `createScriptFunctions`
// - `createEngineBindings` (the new PLAN 5 numeric bindings)
// - `runUpdateScriptForEntry`
// - `runFinishDayScript` / `runAllFinishDayScripts`
//
// `@qala/core` has no `deno.json` yet so it is imported by relative path;
// the import below is the `@qala/core` surface (see `CORE_IMPORT_NOTE`).

import type {
  LiftEntry,
  LiftSession,
  Program as CoreProgram,
  Settings as CoreSettings,
} from "../../core/mod.ts";
import type {
  IDayData,
  IExerciseType,
  IHistoryEntry,
  IHistoryRecord,
  IPlannerProgram,
  IProgram,
  IProgramState,
  ISet,
  ISettings,
  IStats,
  IUnit,
  IWeight,
} from "./types.ts";
import type { IScriptBindings, IScriptFunctions } from "./liftoscriptFns.ts";
import type { ILiftoscriptEvaluatorUpdate } from "./liftoscriptEvaluator.ts";
import type { IEither } from "./utils/types.ts";
import { ScriptRunner } from "./parser.ts";
import {
  Progress_applyBindings,
  Progress_createEmptyScriptBindings,
  Progress_createScriptBindings,
  Progress_createScriptFunctions,
  Progress_defaultEngineBindings,
  Progress_getDayData,
  Progress_runUpdateScriptForEntry as Progress_runUpdateScriptForEntryImpl,
} from "./models/progress.ts";
import {
  type IEvaluatedProgram,
  Program_evaluate,
  Program_forceEvaluate,
  Program_getProgramDay,
  Program_getProgramExerciseForKeyAndDay,
  Program_nextDay,
} from "./models/program.ts";
import {
  PlannerProgramExercise_currentDescriptionIndex,
  PlannerProgramExercise_currentEvaluatedSetVariationIndex,
  PlannerProgramExercise_currentExerciseVariationIndex,
  PlannerProgramExercise_getProgressScript,
  PlannerProgramExercise_getState,
} from "./pages/planner/models/plannerProgramExercise.ts";
import type { IPlannerProgramExercise } from "./pages/planner/models/types.ts";
import type { IByTag } from "./pages/planner/plannerEvaluator.ts";
import { PlannerProgram_evaluateText } from "./pages/planner/models/plannerProgram.ts";
import { ProgramToPlanner } from "./models/programToPlanner.ts";
import { PlannerProgram_generateFullText } from "./pages/planner/models/plannerProgram.ts";
import { ProgramExercise_applyVariables } from "./models/programExercise.ts";
import {
  ObjectUtils_clone,
  ObjectUtils_diff,
  ObjectUtils_isEqual,
  ObjectUtils_keys,
} from "./utils/object.ts";
import { PP_iterate2 } from "./models/pp.ts";
import { Stats_getCurrentMovingAverageBodyweight } from "./models/stats.ts";
import { UidFactory_generateUid } from "./utils/generator.ts";
import {
  Exercise_findByName,
  Exercise_onerm,
  Exercise_toKey,
} from "./models/exercise.ts";
import { Equipment_build } from "./models/equipment.ts";
import { Weight_build, Weight_eq, Weight_roundTo005 } from "./models/weight.ts";

export type {
  IEvaluatedProgram,
  ILiftoscriptEvaluatorUpdate,
  IScriptBindings,
  IScriptFunctions,
};
export {
  Program_evaluate,
  Program_forceEvaluate,
  Program_getProgramDay,
  Program_nextDay,
  Progress_applyBindings,
  Progress_createEmptyScriptBindings,
  Progress_createScriptBindings,
  Progress_createScriptFunctions,
  Progress_getDayData,
};

/** PLAN section 5 engine bindings: all plain numbers. */
export interface EngineBindingsInput {
  /** Derived readiness, 0-1. */
  readiness?: number;
  /** Perceived Recovery Status tap, 0-10. */
  prs?: number;
  /** Max RP soreness over the exercise's target muscles, 1-4. */
  soreness?: number;
  /** Normalised per-muscle fatigue, 0-1. */
  fatigueLocal?: number;
  /** 0 none, 1 muscle, 2 systemic. */
  deload?: number;
  /** Engine's recommended weight change, -10..2.5. */
  recWeightPct?: number;
  /** Engine's recommended set change, -2..1. */
  recSets?: number;
}

export type EngineBindings = Required<EngineBindingsInput>;

function clamp(n: number, min: number, max: number): number {
  if (!isFinite(n)) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}

/** Build clamped engine bindings; absent inputs fall back to neutral defaults. */
export function createEngineBindings(
  input?: EngineBindingsInput,
): EngineBindings {
  const defaults = Progress_defaultEngineBindings();
  return {
    readiness: clamp(input?.readiness ?? defaults.readiness, 0, 1),
    prs: clamp(input?.prs ?? defaults.prs, 0, 10),
    soreness: clamp(Math.round(input?.soreness ?? defaults.soreness), 1, 4),
    fatigueLocal: clamp(input?.fatigueLocal ?? defaults.fatigueLocal, 0, 1),
    deload: clamp(Math.round(input?.deload ?? defaults.deload), 0, 2),
    recWeightPct: clamp(input?.recWeightPct ?? defaults.recWeightPct, -10, 2.5),
    recSets: clamp(Math.round(input?.recSets ?? defaults.recSets), -2, 1),
  };
}

/** Merge engine bindings into script bindings (mutates and returns them). */
export function applyEngineBindings(
  bindings: IScriptBindings,
  engine?: EngineBindingsInput,
): IScriptBindings {
  Object.assign(bindings, createEngineBindings(engine));
  return bindings;
}

export function createScriptBindings(
  dayData: IDayData,
  entry: IHistoryEntry,
  settings: ISettings,
  programNumberOfSets: number,
  bodyweight: IWeight | undefined,
  setIndex?: number,
  setVariationIndex?: number,
  descriptionIndex?: number,
  exerciseVariationIndex?: number,
  engine?: EngineBindingsInput,
): IScriptBindings {
  const bindings = Progress_createScriptBindings(
    dayData,
    entry,
    settings,
    programNumberOfSets,
    bodyweight,
    setIndex,
    setVariationIndex,
    descriptionIndex,
    exerciseVariationIndex,
  );
  return applyEngineBindings(bindings, engine);
}

export function createScriptFunctions(settings: ISettings): IScriptFunctions {
  return Progress_createScriptFunctions(settings);
}

export function runUpdateScriptForEntry(
  entry: IHistoryEntry,
  dayData: IDayData,
  programExercise: IPlannerProgramExercise,
  otherStates: IByTag<IProgramState>,
  setIndex: number,
  settings: ISettings,
  stats: IStats,
): IHistoryEntry {
  return Progress_runUpdateScriptForEntryImpl(
    entry,
    dayData,
    programExercise,
    otherStates,
    setIndex,
    settings,
    stats,
  );
}

export interface FinishDayResult {
  state: IProgramState;
  otherStates: Record<number, IProgramState>;
  updates: ILiftoscriptEvaluatorUpdate[];
  bindings: IScriptBindings;
}

/**
 * Run one exercise's `progress: custom(state...) {~ ~}` script after the
 * workout. Faithful port of liftosaur's `Program_runFinishDayScript`, plus
 * the Qala engine bindings merged into the script bindings.
 */
export function runFinishDayScript(
  programExercise: IPlannerProgramExercise,
  program: IEvaluatedProgram,
  dayData: IDayData,
  entry: IHistoryEntry,
  settings: ISettings,
  stats: IStats,
  opts?: {
    userPromptedStateVars?: IProgramState;
    engine?: EngineBindingsInput;
  },
): IEither<FinishDayResult, string> {
  const state = PlannerProgramExercise_getState(programExercise);
  const setVariationIndex =
    PlannerProgramExercise_currentEvaluatedSetVariationIndex(programExercise);
  const descriptionIndex = PlannerProgramExercise_currentDescriptionIndex(
    programExercise,
  );
  const exerciseVariationIndex =
    PlannerProgramExercise_currentExerciseVariationIndex(programExercise);
  const bindings = createScriptBindings(
    dayData,
    entry,
    settings,
    programExercise.evaluatedSetVariations[setVariationIndex]?.sets.length ?? 0,
    Stats_getCurrentMovingAverageBodyweight(stats, settings),
    undefined,
    setVariationIndex + 1,
    descriptionIndex + 1,
    exerciseVariationIndex + 1,
    opts?.engine,
  );
  const fns = createScriptFunctions(settings);

  const newState: IProgramState = {
    ...state,
    ...opts?.userPromptedStateVars,
  };
  const otherStates = ObjectUtils_clone(program.states);

  const script = PlannerProgramExercise_getProgressScript(programExercise) ||
    "";
  let updates: ILiftoscriptEvaluatorUpdate[] = [];
  try {
    const runner = new ScriptRunner(
      script,
      newState,
      otherStates,
      bindings,
      fns,
      settings.units,
      {
        exerciseType: programExercise.exerciseType,
        unit: settings.units,
        prints: [],
      },
      "planner",
    );
    runner.execute();
    updates = runner.getUpdates();
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { success: false, error: e.message };
    } else {
      throw e;
    }
  }

  const diffOtherStates = ObjectUtils_keys(otherStates).reduce<
    IByTag<IProgramState>
  >((memo, key) => {
    if (!ObjectUtils_isEqual(otherStates[key], program.states[key])) {
      const diffState = ObjectUtils_keys(otherStates[key]).reduce<
        IProgramState
      >((memo2, key2) => {
        if (!Weight_eq(otherStates[key][key2], program.states[key][key2])) {
          memo2[key2] = otherStates[key][key2];
        }
        return memo2;
      }, {});
      memo[key] = diffState;
    }
    return memo;
  }, {});

  const stateDiff = ObjectUtils_diff(state, newState);
  return {
    success: true,
    data: { state: stateDiff, otherStates: diffOtherStates, updates, bindings },
  };
}

export interface RunAllFinishDayScriptsResult {
  evaluatedProgram: IEvaluatedProgram;
  /** Planner source text with the new states folded back in. */
  plannerText: string;
  nextDay: number;
  exerciseData: Record<string, { rm1: IWeight }>;
  errors: string[];
}

/**
 * Run every completed entry's finish-day script, fold state updates back into
 * a cloned evaluated program, and advance the day. Headless port of
 * liftosaur's `Program_runAllFinishDayScripts`: instead of the app store it
 * returns the updated evaluated program plus its planner text.
 */
export function runAllFinishDayScripts(
  program: IEvaluatedProgram,
  day: number,
  entries: IHistoryEntry[],
  settings: ISettings,
  stats: IStats,
  opts?: {
    onError?: (message: string) => void;
    engineFor?: (entry: IHistoryEntry) => EngineBindingsInput | undefined;
    userPromptedStateVars?: Record<string, IProgramState | undefined>;
  },
): RunAllFinishDayScriptsResult {
  const exerciseData: Record<string, { rm1: IWeight }> = {};
  const errors: string[] = [];
  const newEvaluatedProgram = ObjectUtils_clone(program);
  const dayData: IDayData = {
    day,
    week: program.weeks.length > 0 ? 1 : 1,
    dayInWeek: day,
  };
  const programDay = Program_getProgramDay(newEvaluatedProgram, day);
  if (!programDay) {
    return {
      evaluatedProgram: program,
      plannerText: "",
      nextDay: day,
      exerciseData,
      errors,
    };
  }
  const resolvedDayData = programDay.dayData ?? dayData;
  for (const entry of entries) {
    if (
      entry != null && !entry.isSuppressed &&
      entry.sets.some((s) => s.isCompleted)
    ) {
      const programExercise = entry.programExerciseId != null
        ? Program_getProgramExerciseForKeyAndDay(
          newEvaluatedProgram,
          day,
          entry.programExerciseId,
        )
        : undefined;
      if (programExercise) {
        const newStateResult = runFinishDayScript(
          programExercise,
          newEvaluatedProgram,
          resolvedDayData,
          entry,
          settings,
          stats,
          {
            userPromptedStateVars: opts?.userPromptedStateVars
              ?.[programExercise.key],
            engine: opts?.engineFor?.(entry),
          },
        );
        if (newStateResult.success) {
          const { state, updates, bindings, otherStates } = newStateResult.data;
          const exerciseKey = Exercise_toKey(entry.exercise);
          const onerm = Exercise_onerm(entry.exercise, settings);
          if (!Weight_eq(bindings.rm1, onerm)) {
            exerciseData[exerciseKey] = {
              rm1: Weight_roundTo005(bindings.rm1),
            };
          }
          PP_iterate2(newEvaluatedProgram.weeks, (exercise) => {
            if (exercise.key === programExercise.key && exercise.progress) {
              exercise.progress.state = {
                ...exercise.progress.state,
                ...entry.state,
                ...state,
              };
            }
          });
          ProgramExercise_applyVariables(
            programExercise.key,
            newEvaluatedProgram,
            updates,
            settings,
          );
          for (const key of ObjectUtils_keys(otherStates || {})) {
            PP_iterate2(newEvaluatedProgram.weeks, (exercise) => {
              if (exercise.tags?.includes(Number(key)) && exercise.progress) {
                exercise.progress.state = {
                  ...exercise.progress.state,
                  ...otherStates[key],
                };
              }
            });
          }
        } else {
          const message =
            `There was an error executing progress script: ${newStateResult.error}`;
          errors.push(message);
          if (opts?.onError) {
            opts.onError(message);
          } else {
            console.error(message);
          }
        }
      }
    }
  }
  const theNextDay = Program_nextDay(newEvaluatedProgram, day);
  newEvaluatedProgram.nextDay = theNextDay;
  const plannerText = PlannerProgram_generateFullText(
    new ProgramToPlanner(newEvaluatedProgram, settings).convertToPlanner()
      .weeks,
  );
  return {
    evaluatedProgram: newEvaluatedProgram,
    plannerText,
    nextDay: theNextDay,
    exerciseData,
    errors,
  };
}

/** Evaluate a planner-text program into an evaluated program (fresh recompute). */
export function forceEvaluateText(
  programText: string,
  name: string,
  settings: ISettings,
): IEvaluatedProgram {
  const planner: IPlannerProgram = {
    vtype: "planner",
    name,
    weeks: PlannerProgram_evaluateText(programText),
  };
  const program: IProgram = {
    vtype: "program",
    id: UidFactory_generateUid(8),
    name,
    url: "",
    author: "",
    shortDescription: "",
    description: "",
    nextDay: 1,
    weeks: [],
    isMultiweek: planner.weeks.length > 1,
    days: [],
    exercises: [],
    tags: [],
    planner,
  };
  return Program_forceEvaluate(program, settings);
}

/** Day-indexed view of an evaluated program for the runner UI. */
export function getDay(
  program: IEvaluatedProgram,
  day: number,
): { dayData: IDayData; exercises: IPlannerProgramExercise[] } | undefined {
  const programDay = Program_getProgramDay(program, day);
  if (!programDay) {
    return undefined;
  }
  return { dayData: programDay.dayData, exercises: programDay.exercises };
}

function defaultBarbellEquipment(): ReturnType<typeof Equipment_build> {
  const equipment = Equipment_build("Barbell");
  equipment.bar = { lb: Weight_build(45, "lb"), kg: Weight_build(20, "kg") };
  equipment.plates = [
    ...[45, 35, 25, 10, 5, 2.5].map((value) => ({
      weight: Weight_build(value, "lb"),
      num: 8,
    })),
    ...[25, 20, 15, 10, 5, 2.5, 1.25].map((value) => ({
      weight: Weight_build(value, "kg"),
      num: 8,
    })),
  ];
  return equipment;
}

/** Default liftoscript settings bridged from `@qala/core` settings. */
export function qalaSettingsToLiftoscript(core: CoreSettings): ISettings {
  const units: IUnit = core.units.weight === "kg" ? "kg" : "lb";
  return {
    timers: {},
    gyms: [
      {
        vtype: "gym",
        id: "default",
        name: "Default",
        equipment: {
          barbell: defaultBarbellEquipment(),
          dumbbell: Equipment_build("Dumbbells"),
        },
      },
    ],
    currentGymId: "default",
    deletedGyms: [],
    graphs: { vtype: "graphs", graphs: [] },
    graphOptions: {},
    graphsSettings: {},
    exerciseStatsSettings: {},
    exercises: {},
    statsEnabled: { weight: {}, length: {}, percentage: {} },
    units,
    lengthUnits: "in",
    volume: 0,
    exerciseData: {},
    planner: {
      synergistMultiplier: 0.5,
      strengthSetsPct: 0.85,
      hypertrophySetsPct: 0.7,
      weeklyRangeSets: {},
      weeklyFrequency: {},
    },
    workoutSettings: { targetType: "target" },
    muscleGroups: { vtype: "muscle_groups_settings", data: {} },
  };
}

/** Resolve a core exercise id to a liftoscript exercise type by name, falling back to the raw id. */
export function qalaExerciseIdToType(exerciseId: string): IExerciseType {
  const found = Exercise_findByName(exerciseId, {});
  if (found) {
    return { id: found.id };
  }
  return { id: exerciseId } as IExerciseType;
}

/** Map one core lift entry to a liftoscript history entry (planned targets filled by the caller). */
export function qalaLiftEntryToHistoryEntry(
  liftEntry: LiftEntry,
  index: number,
  planned?: { weight?: { value: number; unit: "lb" | "kg" }; reps?: number }[],
): IHistoryEntry {
  const exercise = qalaExerciseIdToType(liftEntry.exerciseId);
  const sets: ISet[] = liftEntry.sets.map((s, i) => {
    const target = planned?.[i];
    const completed = s.completed;
    const targetWeight = target?.weight;
    return {
      vtype: "set",
      id: UidFactory_generateUid(6),
      index: i,
      reps: target?.reps ?? s.r,
      weight: targetWeight
        ? Weight_build(targetWeight.value, targetWeight.unit)
        : Weight_build(s.w.value, s.w.unit),
      originalWeight: targetWeight
        ? Weight_build(targetWeight.value, targetWeight.unit)
        : undefined,
      rpe: s.rpe,
      isCompleted: completed,
      completedReps: completed ? s.r : undefined,
      completedWeight: completed
        ? Weight_build(s.w.value, s.w.unit)
        : undefined,
      completedRpe: completed ? s.rpe : undefined,
    };
  });
  return {
    vtype: "history_entry",
    id: `${liftEntry.exerciseId}_${index}`,
    index,
    exercise,
    programExerciseId: liftEntry.exerciseId,
    sets,
    warmupSets: [],
  };
}

/** Build a history record shell for one core lift session day. */
export function qalaLiftSessionToHistoryRecord(
  session: LiftSession,
  day: number,
  programName: string,
): IHistoryRecord {
  return {
    vtype: "history_record",
    date: session.date,
    programId: session.programId,
    programName,
    day,
    dayName: session.day,
    entries: session.entries.map((e, i) => qalaLiftEntryToHistoryEntry(e, i)),
    startTime: Date.parse(session.date),
    id: 0,
  };
}

/**
 * Evaluate a `@qala/core` program's liftoscript text with core settings.
 * The program text is the source of truth for weights (PLAN section 3).
 */
export function evaluateQalaProgram(
  coreProgram: CoreProgram,
  coreSettings: CoreSettings,
): IEvaluatedProgram {
  return forceEvaluateText(
    coreProgram.text,
    coreProgram.name,
    qalaSettingsToLiftoscript(coreSettings),
  );
}

export { Weight_build };
export type { CoreProgram, CoreSettings, LiftEntry, LiftSession };
export type {
  IDayData,
  IHistoryEntry,
  IHistoryRecord,
  IPlannerProgram,
  IProgram,
  ISettings,
  IStats,
  IUnit,
};
