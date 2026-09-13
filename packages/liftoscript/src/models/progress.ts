// Qala port of the script-execution subset of liftosaur (AGPL-3.0)
// `src/models/progress.ts`.
//
// Only the pure liftoscript plumbing is carried over: script bindings,
// script functions, binding application, entry navigation and the update
// script runner. Workout-recording actions (timers, completion, reducer
// thunks, native bridges, dialogs) stay in the app shell. The finish-day
// entry points live in `../runtime.ts` (PLAN section 5).

import type {
  IDayData,
  IExerciseType,
  IHistoryEntry,
  IHistoryRecord,
  IPercentage,
  IProgramState,
  ISettings,
  IStats,
  IUnit,
  IWeight,
} from "../types.ts";
import type { IPlannerProgramExercise } from "../pages/planner/models/types.ts";
import {
  PlannerProgramExercise_currentDescriptionIndex,
  PlannerProgramExercise_currentEvaluatedSetVariationIndex,
  PlannerProgramExercise_currentExerciseVariationIndex,
  PlannerProgramExercise_getState,
  PlannerProgramExercise_getUpdateScript,
} from "../pages/planner/models/plannerProgramExercise.ts";
import { ObjectUtils_clone } from "../utils/object.ts";
import {
  CollectionUtils_compact,
  CollectionUtils_findIndexReverse,
} from "../utils/collection.ts";
import { UidFactory_generateUid } from "../utils/generator.ts";
import {
  Exercise_getIsUnilateral,
  Exercise_onerm,
  Exercise_toKey,
} from "./exercise.ts";
import { Equipment_getUnitForExerciseType } from "./equipment.ts";
import {
  Weight_build,
  Weight_buildAny,
  Weight_buildPct,
  Weight_convertToWeight,
  Weight_decrement,
  Weight_eq,
  Weight_getOneRepMax,
  Weight_getTrainingMax,
  Weight_increment,
  Weight_is,
  Weight_isPct,
  Weight_lt,
  Weight_op,
  Weight_round,
  Weight_roundConvertTo,
  Weight_rpeMultiplier,
} from "./weight.ts";
import { Stats_getCurrentMovingAverageBodyweight } from "./stats.ts";
import { Reps_isEmptyOrFinished } from "./set.ts";
import { ScriptRunner } from "../parser.ts";
import type { ILiftoscriptEvaluatorUpdate } from "../liftoscriptEvaluator.ts";
import type { IScriptBindings, IScriptFunctions } from "../liftoscriptFns.ts";
import type { IByTag } from "../pages/planner/plannerEvaluator.ts";

export type { IScriptBindings } from "../liftoscriptFns.ts";

export interface IScriptFnContext {
  prints: (number | IWeight | IPercentage)[][];
  unit: IUnit;
  exerciseType?: IExerciseType;
}

export interface IScriptUpdateContext {
  equipment?: string;
}

type IScriptArg = number | IWeight | IPercentage;

function applyRounding(
  num: IScriptArg | undefined,
  rounder: (n: number) => number,
): IScriptArg {
  if (num == null) {
    return 0;
  }
  return typeof num === "number"
    ? rounder(num)
    : Weight_buildAny(rounder(num.value), num.unit);
}

function isScriptValue(v: unknown): v is IScriptArg {
  return typeof v === "number" || Weight_is(v) || Weight_isPct(v);
}

function flattenScriptArgs(args: unknown[]): IScriptArg[] {
  const result: IScriptArg[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      for (const item of arg) {
        if (isScriptValue(item)) {
          result.push(item);
        }
      }
    } else if (isScriptValue(arg)) {
      result.push(arg);
    }
  }
  return result;
}

function sum(args: unknown[]): IWeight | IPercentage | number {
  const flat = flattenScriptArgs(args);
  if (flat.length === 0) {
    return 0;
  }
  return flat.reduce<IScriptArg>(
    (acc, a) => Weight_op(undefined, acc, a, (x, y) => x + y),
    0,
  );
}

function min(args: unknown[]): IWeight | IPercentage | number {
  const flat = flattenScriptArgs(args);
  if (flat.length === 0) {
    return 0;
  }
  return flat.reduce<IScriptArg>(
    (acc, a) => (Weight_lt(a, acc) ? a : acc),
    flat[0],
  );
}

function max(args: unknown[]): IWeight | IPercentage | number {
  const flat = flattenScriptArgs(args);
  if (flat.length === 0) {
    return 0;
  }
  return flat.reduce<IScriptArg>(
    (acc, a) => (Weight_lt(acc, a) ? a : acc),
    flat[0],
  );
}

function zeroOrGte(
  a: (IWeight | number | undefined | null)[],
  b: (IWeight | number | undefined | null)[],
): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const aVal = a[i];
    const bVal = b[i];
    if (
      aVal != null && bVal != null && !Weight_eq(aVal, 0) &&
      Weight_lt(aVal, bVal)
    ) {
      return false;
    }
  }
  return true;
}

/** Neutral engine-binding defaults (PLAN section 5): full readiness, no soreness/fatigue/deload, no change. */
export function Progress_defaultEngineBindings(): Pick<
  IScriptBindings,
  | "readiness"
  | "prs"
  | "soreness"
  | "fatigueLocal"
  | "deload"
  | "recWeightPct"
  | "recSets"
> {
  return {
    readiness: 1,
    prs: 0,
    soreness: 1,
    fatigueLocal: 0,
    deload: 0,
    recWeightPct: 0,
    recSets: 0,
  };
}

export function Progress_createEmptyScriptBindings(
  dayData: IDayData,
  settings: ISettings,
  exercise?: IExerciseType,
): IScriptBindings {
  const rm1 = exercise
    ? Exercise_onerm(exercise, settings)
    : Weight_build(0, "lb");
  return {
    day: dayData.day,
    week: dayData.week ?? 1,
    dayInWeek: dayData.dayInWeek ?? dayData.day,
    completedWeights: [],
    originalWeights: [],
    weights: [],
    reps: [],
    minReps: [],
    RPE: [],
    amraps: [],
    logrpes: [],
    askweights: [],
    completedReps: [],
    completedRepsLeft: [],
    completedRPE: [],
    isCompleted: [],
    timers: [],
    setTime: [],
    completedSetTime: [],
    completedSetTimeLeft: [],
    w: [],
    r: [],
    cr: [],
    cw: [],
    mr: [],
    programNumberOfSets: 0,
    numberOfSets: 0,
    completedNumberOfSets: 0,
    ns: 0,
    setVariationIndex: 1,
    exerciseVariationIndex: 1,
    descriptionIndex: 1,
    bodyweight: Weight_build(0, settings.units),
    setIndex: 1,
    rm1,
    ...Progress_defaultEngineBindings(),
  };
}

export function Progress_createScriptBindings(
  dayData: IDayData,
  entry: IHistoryEntry,
  settings: ISettings,
  programNumberOfSets: number,
  bodyweight: IWeight | undefined,
  setIndex?: number,
  setVariationIndex?: number,
  descriptionIndex?: number,
  exerciseVariationIndex?: number,
): IScriptBindings {
  const bindings = Progress_createEmptyScriptBindings(
    dayData,
    settings,
    entry.exercise,
  );
  for (const set of entry.sets) {
    bindings.weights.push(set.weight);
    bindings.originalWeights.push(
      set.originalWeight ?? Weight_build(0, settings.units),
    );
    bindings.reps.push(set.reps);
    bindings.minReps.push(set.minReps);
    bindings.completedReps.push(set.completedReps);
    bindings.completedRepsLeft.push(set.completedRepsLeft);
    bindings.completedRPE.push(set.completedRpe);
    bindings.completedWeights.push(set.completedWeight);
    bindings.RPE.push(set.rpe);
    bindings.amraps.push(set.isAmrap ? 1 : undefined);
    bindings.logrpes.push(set.logRpe ? 1 : undefined);
    bindings.askweights.push(set.askWeight ? 1 : undefined);
    bindings.timers.push(set.timer);
    bindings.setTime.push(set.setTimer);
    bindings.completedSetTime.push(set.completedSetTimer);
    bindings.completedSetTimeLeft.push(set.completedSetTimerLeft);
    bindings.isCompleted.push(set.isCompleted ? 1 : 0);
  }
  bindings.w = bindings.weights;
  bindings.r = bindings.reps;
  bindings.cr = bindings.completedReps;
  bindings.cw = bindings.completedWeights;
  bindings.mr = bindings.minReps;
  bindings.ns = entry.sets.length;
  bindings.programNumberOfSets = programNumberOfSets;
  bindings.numberOfSets = entry.sets.length;
  bindings.completedNumberOfSets =
    entry.sets.filter((s) => s.isCompleted).length;
  bindings.setIndex = setIndex ?? 1;
  bindings.setVariationIndex = setVariationIndex ?? 1;
  bindings.exerciseVariationIndex = exerciseVariationIndex ?? 1;
  bindings.descriptionIndex = descriptionIndex ?? 1;
  bindings.bodyweight = bodyweight ?? Weight_build(0, settings.units);
  return bindings;
}

export function Progress_createScriptFunctions(
  settings: ISettings,
): IScriptFunctions {
  function toWeight(value: IWeight | number): IWeight {
    return Weight_is(value) ? value : Weight_build(value, settings.units);
  }

  function increment(
    vals: IWeight | IPercentage | number,
    context: IScriptFnContext,
  ): IWeight | IPercentage | number {
    if (typeof vals === "number") {
      const weight = Weight_build(vals, context.unit);
      return Weight_increment(weight, settings, context.exerciseType);
    } else if (Weight_isPct(vals)) {
      return Weight_buildPct(vals.value + 1);
    } else {
      return Weight_increment(vals, settings, context.exerciseType);
    }
  }

  function decrement(
    vals: IWeight | IPercentage | number,
    context: IScriptFnContext,
  ): IWeight | IPercentage | number {
    if (typeof vals === "number") {
      const weight = Weight_build(vals, context.unit);
      return Weight_decrement(weight, settings, context.exerciseType);
    } else if (Weight_isPct(vals)) {
      return Weight_buildPct(vals.value - 1);
    } else {
      return Weight_decrement(vals, settings, context.exerciseType);
    }
  }

  const fns: IScriptFunctions = {
    roundWeight: ([num], context) => {
      const unit = Equipment_getUnitForExerciseType(
        settings,
        context?.exerciseType,
      );
      return Weight_round(
        toWeight(num),
        settings,
        unit ?? settings.units,
        context?.exerciseType,
      );
    },
    roundConvertWeight: ([num], context) => {
      const unit = Equipment_getUnitForExerciseType(
        settings,
        context?.exerciseType,
      );
      return Weight_roundConvertTo(
        toWeight(num),
        settings,
        unit ?? settings.units,
        context?.exerciseType,
      );
    },
    calculateTrainingMax: ([weight, reps]) => {
      return Weight_getTrainingMax(toWeight(weight), reps || 0, settings);
    },
    calculate1RM: ([weight, reps]) => {
      return Weight_getOneRepMax(toWeight(weight), reps);
    },
    rpeMultiplier: ([repsRaw, rpeRaw]) => {
      const reps = Weight_is(repsRaw) ? repsRaw.value : repsRaw;
      const rpe = rpeRaw == null
        ? 10
        : Weight_is(rpeRaw)
        ? rpeRaw.value
        : rpeRaw;
      return Weight_rpeMultiplier(reps, rpe);
    },
    floor: ([num]) => applyRounding(num, Math.floor),
    ceil: ([num]) => applyRounding(num, Math.ceil),
    round: ([num]) => applyRounding(num, Math.round),
    sum: (args) => sum(args),
    min: (args) => min(args),
    max: (args) => max(args),
    increment: ([vals], context) => increment(vals, context),
    decrement: ([vals], context) => decrement(vals, context),
    zeroOrGte: ([a, b]) => zeroOrGte(a, b),
    print: (args, context) => {
      const flatArgs = [...args.flat()].map((arg) =>
        arg ?? 0
      ) as (number | IWeight | IPercentage)[];
      context.prints = context.prints || [];
      context.prints.push(flatArgs);
      return flatArgs[0];
    },
    sets: (
      [from, to, minReps, reps, isAmrap, weight, timer, rpe, logRpe],
      context,
      bindings,
    ) => {
      for (let i = 0; i < bindings.numberOfSets; i++) {
        if (i >= from - 1 && i < to) {
          const weightValue = Weight_convertToWeight(
            bindings.rm1,
            weight,
            context.unit,
          );
          bindings.minReps[i] = reps !== minReps ? minReps : undefined;
          bindings.reps[i] = reps;
          bindings.originalWeights[i] = weightValue;
          bindings.weights[i] = Weight_round(
            weightValue,
            settings,
            context.unit,
            context.exerciseType,
          );
          bindings.RPE[i] = rpe !== 0 ? rpe : undefined;
          bindings.amraps[i] = isAmrap !== 0 ? 1 : 0;
          bindings.logrpes[i] = logRpe !== 0 ? 1 : 0;
          bindings.timers[i] = timer !== 0 ? timer : undefined;
        }
      }
      return to - from;
    },
  };
  return fns;
}

export function Progress_isFullyEmptyOrFinishedSet(
  progress: IHistoryRecord,
): boolean {
  return progress.entries.every((entry) =>
    Progress_isEmptyOrFinishedSet(entry)
  );
}

export function Progress_isEmptyOrFinishedSet(entry: IHistoryEntry): boolean {
  return Reps_isEmptyOrFinished(entry.sets);
}

export function Progress_getSupersetGroups(
  entries: IHistoryEntry[],
): Partial<Record<string, IHistoryEntry[]>> {
  const groups: Partial<Record<string, IHistoryEntry[]>> = {};
  for (const entry of entries) {
    if (entry.superset != null) {
      if (!groups[entry.superset]) {
        groups[entry.superset] = [];
      }
      groups[entry.superset]!.push(entry);
    }
  }
  return groups;
}

export function Progress_getNextEntry(
  progress: IHistoryRecord,
  entry: IHistoryEntry,
  mode: "workout" | "warmup",
  shouldGoToNextEntry: boolean,
): IHistoryEntry | undefined {
  if (Progress_isFullyEmptyOrFinishedSet(progress)) {
    return undefined;
  }
  const visitedAndFinished = new Set<IHistoryEntry>();
  let currentEntry: IHistoryEntry | undefined = entry;
  let isInitial = true;
  const supersetGroups = Progress_getSupersetGroups(progress.entries);
  while (currentEntry != null) {
    let index = progress.entries.findIndex((e) =>
      e.id != null && e.id === currentEntry?.id
    );
    if (index === -1) {
      index = progress.entries.findIndex((e) => e === currentEntry);
    }
    const superset: string | undefined = currentEntry.superset;
    if (
      mode === "workout" && superset != null &&
      !visitedAndFinished.has(currentEntry)
    ) {
      const supersetGroup: IHistoryEntry[] = supersetGroups?.[superset] ?? [];
      if (supersetGroup.length > 1) {
        const supersetIndex = supersetGroup?.findIndex((e) =>
          e.id === currentEntry?.id
        );
        currentEntry =
          supersetGroup[(supersetIndex + 1) % supersetGroup.length];
      } else {
        if (shouldGoToNextEntry) {
          currentEntry =
            progress.entries[(index + 1) % progress.entries.length];
        } else {
          return currentEntry;
        }
      }
    } else if (Reps_isEmptyOrFinished(currentEntry.sets)) {
      if (shouldGoToNextEntry) {
        const prevEntry: IHistoryEntry = currentEntry;
        currentEntry = progress.entries[(index + 1) % progress.entries.length];
        if (currentEntry === prevEntry) {
          return undefined;
        }
      } else {
        return undefined;
      }
    }
    if (currentEntry == null) {
      return undefined;
    }
    if (!Reps_isEmptyOrFinished(currentEntry.sets)) {
      return currentEntry;
    } else if (!isInitial) {
      visitedAndFinished.add(currentEntry);
    }
    isInitial = false;
  }
  return undefined;
}

export function Progress_getNextEntryIndex(
  progress: IHistoryRecord,
  entry: IHistoryEntry,
  mode: "workout" | "warmup",
): number | undefined {
  const nextEntry = Progress_getNextEntry(progress, entry, mode, false);
  if (nextEntry != null) {
    let index = progress.entries.findIndex((e) =>
      e.id != null && e.id === nextEntry.id
    );
    if (index === -1) {
      index = progress.entries.findIndex((e) => e === nextEntry);
    }
    return index === -1 ? undefined : index;
  }
  return undefined;
}

export function Progress_applyBindings(
  oldEntry: IHistoryEntry,
  bindings: IScriptBindings,
  settings: ISettings,
): IHistoryEntry {
  const keys = [
    "RPE",
    "minReps",
    "reps",
    "weights",
    "amraps",
    "logrpes",
    "timers",
    "setTime",
    "originalWeights",
    "askweights",
  ] as const;
  const lastCompletedIndex =
    CollectionUtils_findIndexReverse(bindings.completedReps, (r) => r != null) +
    1;
  const entry: IHistoryEntry = {
    ...oldEntry,
    sets: ObjectUtils_clone(
      oldEntry.sets.slice(
        0,
        Math.max(lastCompletedIndex, bindings.numberOfSets, 0),
      ),
    ),
  };
  for (const key of keys) {
    for (let i = 0; i < bindings[key].length; i += 1) {
      if (entry.sets[i] == null) {
        entry.sets[i] = {
          vtype: "set",
          id: UidFactory_generateUid(6),
          index: i,
          isUnilateral: Exercise_getIsUnilateral(entry.exercise, settings),
          reps: 0,
          weight: Weight_build(0, "lb"),
          originalWeight: Weight_build(0, "lb"),
          askWeight: false,
          isCompleted: false,
        };
      }
      if (!entry.sets[i].isCompleted) {
        if (key === "RPE") {
          const value = bindings.RPE[i];
          entry.sets[i].rpe = value !== 0 ? value : undefined;
        } else if (key === "reps") {
          const value = bindings.reps[i];
          entry.sets[i].reps = value;
        } else if (key === "minReps") {
          const value = bindings.minReps[i];
          entry.sets[i].minReps = value !== 0 ? value : undefined;
        } else if (key === "weights") {
          const value = bindings.weights[i];
          entry.sets[i].weight = value;
        } else if (key === "originalWeights") {
          const value = bindings.originalWeights[i];
          entry.sets[i].originalWeight = value;
        } else if (key === "amraps") {
          const value = bindings.amraps[i];
          entry.sets[i].isAmrap = !!value;
        } else if (key === "logrpes") {
          const value = bindings.logrpes[i];
          entry.sets[i].logRpe = !!value;
        } else if (key === "askweights") {
          const value = bindings.askweights[i];
          entry.sets[i].askWeight = !!value;
        } else if (key === "timers") {
          const value = bindings.timers[i];
          entry.sets[i].timer = value != null && value >= 0 ? value : undefined;
        } else if (key === "setTime") {
          const value = bindings.setTime[i];
          entry.sets[i].setTimer = value != null && value >= 0
            ? value
            : undefined;
        }
      }
    }
  }
  return entry;
}

export function Progress_getEntryId(
  exerciseType: IExerciseType,
  label?: string,
): string {
  return CollectionUtils_compact([label, Exercise_toKey(exerciseType)]).join(
    "_",
  );
}

export function Progress_getDayData(progress: IHistoryRecord): IDayData {
  return {
    day: progress.day,
    week: progress.week,
    dayInWeek: progress.dayInWeek,
  };
}

export function Progress_runUpdateScriptForEntry(
  entry: IHistoryEntry,
  dayData: IDayData,
  programExercise: IPlannerProgramExercise,
  otherStates: IByTag<IProgramState>,
  setIndex: number,
  settings: ISettings,
  stats: IStats,
): IHistoryEntry {
  if (setIndex !== -1 && !entry?.sets[setIndex]?.isCompleted) {
    return entry;
  }
  const script = PlannerProgramExercise_getUpdateScript(programExercise);
  if (!script) {
    return entry;
  }
  const exercise = programExercise.exerciseType;
  const state = ObjectUtils_clone(
    PlannerProgramExercise_getState(programExercise),
  );
  const setVariationIndex =
    PlannerProgramExercise_currentEvaluatedSetVariationIndex(programExercise);
  const descriptionIndex = PlannerProgramExercise_currentDescriptionIndex(
    programExercise,
  );
  const exerciseVariationIndex =
    PlannerProgramExercise_currentExerciseVariationIndex(programExercise);
  const bindings = Progress_createScriptBindings(
    dayData,
    entry,
    settings,
    programExercise.evaluatedSetVariations[setVariationIndex]?.sets.length ?? 0,
    Stats_getCurrentMovingAverageBodyweight(stats, settings),
    setIndex + 1,
    setVariationIndex,
    descriptionIndex,
    exerciseVariationIndex,
  );
  const fnContext: IScriptFnContext = {
    exerciseType: exercise,
    unit: settings.units,
    prints: [],
  };
  const runner = new ScriptRunner(
    script,
    state,
    ObjectUtils_clone(otherStates),
    bindings,
    Progress_createScriptFunctions(settings),
    settings.units,
    fnContext,
    "update",
  );
  runner.execute();
  const newEntry = Progress_applyBindings(entry, bindings, settings);
  newEntry.state = { ...newEntry.state, ...state };
  if (fnContext.prints.length > 0) {
    newEntry.updatePrints = fnContext.prints;
  }
  return newEntry;
}

export type { ILiftoscriptEvaluatorUpdate };
