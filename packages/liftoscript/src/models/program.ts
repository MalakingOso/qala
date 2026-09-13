// Qala adapter for liftosaur (AGPL-3.0) `src/models/program.ts`.
//
// The app-side program module (redux store, navigation, storage, sharing) is
// not vendored. This file carries the evaluated-program types plus faithful
// ports of the pure evaluation and day-navigation helpers the planner chain
// needs, so the vendored files can keep their original import paths.
// Progress/finish-day entry points live in `../runtime.ts` (PLAN section 5).

import type {
  ICustomExercise,
  IDayData,
  IExerciseType,
  IHistoryEntry,
  IPlannerProgram,
  IProgram,
  IProgramContentSettings,
  IProgramState,
  ISet,
  ISettings,
  IStats,
  IWeight,
} from "../types.ts";
import type { PlannerSyntaxError } from "../pages/planner/plannerExerciseEvaluator.ts";
import type {
  IExportedPlannerProgram,
  IPlannerProgramExercise,
  IPlannerProgramExerciseWithType,
} from "../pages/planner/models/types.ts";
import type { IPlannerEvalResult } from "../pages/planner/plannerExerciseEvaluator.ts";
import {
  PlannerEvaluator_changeExerciseName,
  PlannerEvaluator_evaluate,
  PlannerEvaluator_forceEvaluate,
} from "../pages/planner/plannerEvaluator.ts";
import {
  PlannerProgramExercise_currentEvaluatedSetVariation,
  PlannerProgramExercise_getState,
  PlannerProgramExercise_programWarmups,
} from "../pages/planner/models/plannerProgramExercise.ts";
import { ProgramSet_getEvaluatedWeight } from "./programSet.ts";
import { PP_iterate, PP_iterate2 } from "./pp.ts";
import { CollectionUtils_sortBy } from "../utils/collection.ts";
import { UidFactory_generateUid } from "../utils/generator.ts";
import {
  Exercise_eq,
  Exercise_getIsUnilateral,
  Exercise_getWarmupSets,
} from "./exercise.ts";
import { Weight_build, Weight_is } from "./weight.ts";
import {
  ProgramExercise_doesUse1RM,
  ProgramExercise_doesUseRPE,
} from "./programExercise.ts";
import {
  Progress_getEntryId,
  Progress_runUpdateScriptForEntry,
} from "./progress.ts";
import type { IByTag } from "../pages/planner/plannerEvaluator.ts";
import { PlannerKey_fromFullName } from "../pages/planner/plannerKey.tsx";
import memoize from "../utils/memoize.ts";

export interface IEvaluatedProgramWeek {
  name: string;
  description?: string;
  days: IEvaluatedProgramDay[];
}

export interface IEvaluatedProgramDay {
  name: string;
  dayData: Required<IDayData>;
  description?: string;
  exercises: IPlannerProgramExercise[];
}

export interface IEvaluatedProgramError {
  error: PlannerSyntaxError;
  dayData: Required<IDayData>;
}

export interface IExportedProgram {
  program: IProgram;
  customExercises: Partial<Record<string, ICustomExercise>>;
  version: string;
  settings: IProgramContentSettings;
}

export interface IEvaluatedProgram {
  type: "evaluatedProgram";
  id: string;
  planner: IPlannerProgram;
  name: string;
  nextDay: number;
  errors: IEvaluatedProgramError[];
  weeks: IEvaluatedProgramWeek[];
  states: IByTag<IProgramState>;
}

export type IEProgram = IProgram | IEvaluatedProgram;

export type IProgramMode = "planner" | "update";

export function Program_getAllProgramExercises(
  evaluatedProgram: IEvaluatedProgram,
): IPlannerProgramExercise[] {
  return evaluatedProgram.weeks.flatMap((w) =>
    w.days.flatMap((d) => d.exercises)
  );
}

export function Program_getAllUsedProgramExercises(
  evaluatedProgram: IEvaluatedProgram,
): IPlannerProgramExerciseWithType[] {
  const used = Program_getAllProgramExercises(evaluatedProgram).filter(
    (e) => !e.notused && e.exerciseType != null,
  );
  return used as IPlannerProgramExerciseWithType[];
}

export function Program_getAllProgramExercisesWithType(
  evaluatedProgram: IEvaluatedProgram,
): IPlannerProgramExerciseWithType[] {
  const used = Program_getAllProgramExercises(evaluatedProgram).filter((e) =>
    e.exerciseType != null
  );
  return used as IPlannerProgramExerciseWithType[];
}

export function Program_getProgramExerciseByTypeWeekAndDay(
  evaluatedProgram: IEvaluatedProgram,
  exerciseType: IExerciseType,
  week: number,
  dayInWeek: number,
): IPlannerProgramExercise | undefined {
  let exercise: IPlannerProgramExercise | undefined;
  PP_iterate2(
    evaluatedWeeksOf(evaluatedProgram),
    (e, weekIndex, dayInWeekIndex) => {
      if (
        weekIndex + 1 === week &&
        dayInWeekIndex + 1 === dayInWeek &&
        e.exerciseType &&
        Exercise_eq(e.exerciseType, exerciseType)
      ) {
        exercise = e;
        return true;
      }
      return false;
    },
  );
  return exercise;
}

function evaluatedWeeksOf(program: IEvaluatedProgram): IEvaluatedProgramWeek[] {
  return program.weeks;
}

function Program_emptyEvaluatedProgram(program: IProgram): IEvaluatedProgram {
  return {
    type: "evaluatedProgram",
    id: program.id,
    planner: {
      vtype: "planner",
      name: program.name,
      weeks: [{ name: "Week 1", days: [{ name: "Day 1", exerciseText: "" }] }],
    },
    name: program.name,
    errors: [],
    nextDay: program.nextDay,
    weeks: [
      {
        name: "Week 1",
        days: [
          {
            name: "Day 1",
            dayData: { day: 1, week: 1, dayInWeek: 1 },
            exercises: [],
          },
        ],
      },
    ],
    states: {},
  };
}

function Program_buildWeeks(
  planner: IPlannerProgram,
  evaluatedWeeks: IPlannerEvalResult[][],
): { weeks: IEvaluatedProgramWeek[]; errors: IEvaluatedProgramError[] } {
  let dayNum = 0;
  const errors: IEvaluatedProgramError[] = [];
  const weeks = planner.weeks.map((week, weekIndex) => {
    const evaluatedWeek = evaluatedWeeks[weekIndex];
    const days = week.days.map((day, dayInWeekIndex) => {
      dayNum += 1;
      const evaluatedDay = evaluatedWeek[dayInWeekIndex];
      const dayData = {
        day: dayNum,
        week: weekIndex + 1,
        dayInWeek: dayInWeekIndex + 1,
      };
      const evaluatedExercises = CollectionUtils_sortBy(
        evaluatedDay.success ? evaluatedDay.data : [],
        "order",
      );
      if (!evaluatedDay.success) {
        errors.push({ error: evaluatedDay.error, dayData });
      }
      return {
        name: day.name,
        description: day.description,
        dayData,
        exercises: evaluatedExercises,
      };
    });
    return { name: week.name, description: week.description, days };
  });
  return { weeks, errors };
}

function Program_buildEvaluatedProgram(
  program: IProgram,
  planner: IPlannerProgram,
  evaluatedWeeks: IPlannerEvalResult[][],
): IEvaluatedProgram {
  const { weeks, errors } = Program_buildWeeks(planner, evaluatedWeeks);
  const states: IByTag<IProgramState> = {};
  PP_iterate(evaluatedWeeks, (exercise) => {
    for (const tag of exercise.tags) {
      states[tag] = {
        ...states[tag],
        ...PlannerProgramExercise_getState(exercise),
      };
    }
  });
  return {
    type: "evaluatedProgram",
    id: program.id,
    errors,
    planner,
    name: program.name,
    nextDay: program.nextDay,
    weeks,
    states,
  };
}

export function Program_forceEvaluate(
  program: IProgram,
  settings: ISettings,
): IEvaluatedProgram {
  const planner = program.planner;
  if (!planner) {
    return Program_emptyEvaluatedProgram(program);
  }
  const { evaluatedWeeks } = PlannerEvaluator_forceEvaluate(planner, settings);
  return Program_buildEvaluatedProgram(program, planner, evaluatedWeeks);
}

function Program_evaluateCachedPlannerImpl(
  program: IProgram,
  settings: ISettings,
): IEvaluatedProgram {
  const planner = program.planner;
  if (!planner) {
    return Program_emptyEvaluatedProgram(program);
  }
  const { evaluatedWeeks } = PlannerEvaluator_evaluate(planner, settings);
  return Program_buildEvaluatedProgram(program, planner, evaluatedWeeks);
}

export const Program_evaluateCachedPlanner = memoize(
  Program_evaluateCachedPlannerImpl,
  { maxSize: 10 },
);

export const Program_evaluate = memoize(Program_forceEvaluate, { maxSize: 10 });

export function Program_evaluatePlannerWeeks(
  planner: IPlannerProgram,
  settings: ISettings,
): IEvaluatedProgramWeek[] {
  const { evaluatedWeeks } = PlannerEvaluator_evaluate(planner, settings);
  return Program_buildWeeks(planner, evaluatedWeeks).weeks;
}

export function Program_findPlannerExercise(
  planner: IPlannerProgram,
  settings: ISettings,
  fullName: string,
): IPlannerProgramExercise | undefined {
  const key = PlannerKey_fromFullName(fullName, settings.exercises);
  for (const week of Program_evaluatePlannerWeeks(planner, settings)) {
    for (const day of week.days) {
      const exercise = day.exercises.find((e) => e.key === key);
      if (exercise != null) {
        return exercise;
      }
    }
  }
  return undefined;
}

export function Program_getNumberOfExerciseInstances(
  program: IEvaluatedProgram,
  exerciseKey: string,
): number {
  let count = 0;
  PP_iterate2(program.weeks, (exercise) => {
    if (exercise.key === exerciseKey) {
      count += 1;
    }
  });
  return count;
}

export function Program_changeExerciseName(
  from: string,
  to: string,
  program: IProgram,
  settings: ISettings,
): IProgram {
  const planner = program.planner;
  if (!planner) {
    return program;
  }
  return {
    ...program,
    planner: {
      ...planner,
      weeks: planner.weeks.map((week) => {
        return {
          ...week,
          days: week.days.map((day) => {
            return {
              ...day,
              exerciseText: PlannerEvaluator_changeExerciseName(
                day.exerciseText,
                from,
                to,
                settings,
              ),
            };
          }),
        };
      }),
    },
  };
}

export const Program_uses1RM = memoize(
  (program: IEvaluatedProgram): boolean => {
    const allExercises = Program_getAllProgramExercises(program);
    return allExercises.some((e) => ProgramExercise_doesUse1RM(e));
  },
  { maxSize: 10 },
);

export const Program_usesRPE = memoize(
  (program: IEvaluatedProgram): boolean => {
    const allExercises = Program_getAllProgramExercises(program);
    return allExercises.some((e) => ProgramExercise_doesUseRPE(e));
  },
  { maxSize: 10 },
);

export function Program_numberOfDays(program: IEvaluatedProgram): number {
  return program.weeks.reduce((memo, week) => memo + week.days.length, 0);
}

export function Program_getWeekFromDay(
  program: IEvaluatedProgram,
  day: number,
): number {
  let daysTotal = 0;
  for (let i = 0; i < program.weeks.length; i += 1) {
    const weekDays = program.weeks[i].days.length;
    daysTotal += weekDays;
    if (daysTotal >= day) {
      return i + 1;
    }
  }
  return 1;
}

export function Program_getDayNumber(
  program: IPlannerProgram | IEvaluatedProgram,
  week: number,
  dayInWeek: number,
): number {
  let dayIndex = 1;
  for (let w = 0; w < program.weeks.length; w += 1) {
    for (let d = 0; d < program.weeks[w].days.length; d += 1) {
      if (w === week - 1 && d === dayInWeek - 1) {
        return dayIndex;
      }
      dayIndex += 1;
    }
  }
  return -1;
}

export function Program_getDayData(
  program: IEvaluatedProgram,
  day: number,
): Required<IDayData> {
  return {
    day,
    week: Program_getWeekFromDay(program, day),
    dayInWeek: Program_getDayInWeek(program, day),
  };
}

export function Program_getDayInWeek(
  program: IEvaluatedProgram,
  day: number,
): number {
  let daysTotal = 0;
  for (const week of program.weeks) {
    daysTotal += week.days.length;
    if (daysTotal >= day) {
      return day - (daysTotal - week.days.length);
    }
  }
  return 1;
}

export function Program_getDayName(
  program: IEvaluatedProgram,
  day: number,
): string {
  const dayData = Program_getDayData(program, day);
  const programDay = Program_getProgramDay(program, day);
  const week = program.weeks[(dayData.week || 1) - 1];
  const isMultiweek = program.weeks.length > 1 && week != null;
  return `${isMultiweek ? `${week.name} - ` : ""}${programDay?.name}`;
}

export function Program_getListOfDays(
  program: IEvaluatedProgram,
): [string, string][] {
  const days: [string, string][] = [];
  const isReallyMultiweek = program.weeks.length > 1;
  let dayIndex = 0;
  for (const week of program.weeks) {
    for (const day of week.days) {
      dayIndex += 1;
      days.push([
        `${dayIndex}`,
        `${isReallyMultiweek ? `${week.name} - ` : ""}${day.name}`,
      ]);
    }
  }
  return days;
}

export function Program_getProgramWeek(
  program: IEvaluatedProgram,
  day?: number,
): IEvaluatedProgramWeek {
  return program.weeks[Program_getWeekFromDay(program, day || 1) - 1] ||
    program.weeks[0];
}

export function Program_getProgramDay(
  program: IEvaluatedProgram,
  day: number,
): IEvaluatedProgramDay | undefined {
  let aDay = 0;
  for (const week of program.weeks || []) {
    for (const d of week.days) {
      aDay += 1;
      if (day === aDay) {
        return d;
      }
    }
  }
  return undefined;
}

export function Program_getProgramDayExercises(
  programDay: IEvaluatedProgramDay,
): IPlannerProgramExerciseWithType[] {
  const list = programDay.exercises.filter((e) => e.exerciseType != null);
  return list as IPlannerProgramExerciseWithType[];
}

export function Program_getProgramDayUsedExercises(
  programDay: IEvaluatedProgramDay,
): IPlannerProgramExerciseWithType[] {
  const list = programDay.exercises.filter((e) =>
    !e.notused && e.exerciseType != null
  );
  return list as IPlannerProgramExerciseWithType[];
}

export function Program_getProgramExercise(
  day: number,
  program?: IEvaluatedProgram,
  key?: string,
): IPlannerProgramExercise | undefined {
  if (key == null || program == null) {
    return undefined;
  }
  const programDay = Program_getProgramDay(program, day);
  return programDay?.exercises.find((e) => e.key === key);
}

export function Program_getFirstProgramExercise(
  program?: IEvaluatedProgram,
  key?: string,
): IPlannerProgramExercise | undefined {
  if (key == null || program == null) {
    return undefined;
  }
  return Program_getAllProgramExercises(program).find((e) =>
    e.key === key || e.fullName === key
  );
}

export function Program_getProgramExerciseFromDay(
  programDay?: IEvaluatedProgramDay,
  key?: string,
): IPlannerProgramExercise | undefined {
  if (key == null || programDay == null) {
    return undefined;
  }
  return programDay?.exercises.find((e) => e.key === key);
}

export function Program_getProgramExerciseForKeyAndDay(
  program: IEvaluatedProgram,
  day: number,
  key: string,
): IPlannerProgramExerciseWithType | undefined {
  const programDay = program ? Program_getProgramDay(program, day) : undefined;
  const dayExercises = programDay
    ? Program_getProgramDayUsedExercises(programDay)
    : [];
  let programExercise = dayExercises.find((pe) => pe.key === key);
  if (programExercise == null) {
    const allExercises = program
      ? Program_getAllProgramExercisesWithType(program)
      : [];
    programExercise = allExercises.find((pe) => pe.key === key);
    if (programExercise != null) {
      programExercise = {
        ...programExercise,
        dayData: Program_getDayData(program, day),
      };
    }
  }
  return programExercise;
}

export function Program_getProgramExerciseForKeyAndShortDayData(
  program: IEvaluatedProgram,
  dayData: { week: number; dayInWeek: number },
  key: string,
): IPlannerProgramExerciseWithType | undefined {
  const day = Program_getDayNumber(program, dayData.week, dayData.dayInWeek);
  return Program_getProgramExerciseForKeyAndDay(program, day, key);
}

export function Program_getEvaluatedExercise(
  program: IProgram,
  day: number,
  key: string,
  settings: ISettings,
): IPlannerProgramExercise | undefined {
  const { weeks: evaluatedWeeks } = Program_evaluate(program, settings);
  let plannerProgramExercise: IPlannerProgramExercise | undefined;
  PP_iterate2(
    evaluatedWeeks,
    (exercise, _weekIndex, _dayInWeekIndex, dayIndex) => {
      if (dayIndex === day - 1 && exercise.key === key) {
        plannerProgramExercise = exercise;
        return true;
      } else {
        return undefined;
      }
    },
  );
  return plannerProgramExercise;
}

export function Program_nextHistoryEntry(
  program: IEvaluatedProgram,
  dayData: IDayData,
  index: number,
  programExercise: IPlannerProgramExerciseWithType,
  stats: IStats,
  settings: ISettings,
): IHistoryEntry {
  const exercise = programExercise.exerciseType;
  const programSets = PlannerProgramExercise_currentEvaluatedSetVariation(
    programExercise,
  )?.sets;
  const warmupSets = PlannerProgramExercise_programWarmups(
    programExercise,
    settings,
  );
  const sets: ISet[] = [];
  for (let i = 0; i < programSets.length; i++) {
    const programSet = programSets[i];
    const minReps =
      programSet.minrep != null && programSet.minrep !== programSet.maxrep
        ? programSet.minrep
        : undefined;
    const weight = ProgramSet_getEvaluatedWeight(
      programSet,
      programExercise.exerciseType,
      settings,
    );
    sets.push({
      vtype: "set",
      id: UidFactory_generateUid(6),
      reps: programSet.maxrep,
      index: i,
      minReps,
      weight,
      isUnilateral: Exercise_getIsUnilateral(exercise, settings),
      rpe: programSet.rpe,
      timer: programSet.timer,
      setTimer: programSet.setTimer,
      isOverflowSetTimer: programSet.isOverflowSetTimer,
      auto: programSet.auto,
      logRpe: programSet.logRpe,
      askWeight: programSet.askWeight,
      originalWeight: programSet.weight,
      isAmrap: programSet.isAmrap,
      label: programSet.label,
      isCompleted: false,
      programSetIndex: i,
    });
  }

  const entry: IHistoryEntry = {
    vtype: "history_entry",
    id: Progress_getEntryId(exercise, programExercise.label),
    index,
    exercise: exercise,
    programExerciseId: programExercise.key,
    sets,
    superset: programExercise.superset?.name,
    warmupSets: Exercise_getWarmupSets(
      exercise,
      sets[0]?.weight,
      settings,
      warmupSets,
    ),
  };
  try {
    return Progress_runUpdateScriptForEntry(
      entry,
      dayData,
      programExercise,
      program.states,
      -1,
      settings,
      stats,
    );
  } catch (error) {
    console.error(error);
    return entry;
  }
}

export function Program_nextDay(
  program: IEvaluatedProgram,
  day?: number,
): number {
  const nd = (day != null ? day % Program_numberOfDays(program) : 0) + 1;
  return isNaN(nd) ? 1 : nd;
}

export function Program_create(name: string, id?: string): IProgram {
  return {
    vtype: "program" as const,
    id: id || UidFactory_generateUid(8),
    name: name,
    url: "",
    author: "",
    shortDescription: "",
    description: "",
    nextDay: 1,
    weeks: [],
    isMultiweek: false,
    days: [{ id: UidFactory_generateUid(8), name: "Day 1", exercises: [] }],
    exercises: [],
    tags: [],
    deletedDays: [],
    deletedWeeks: [],
    deletedExercises: [],
    clonedAt: Date.now(),
  };
}

export function Program_exportedPlannerProgramToExportedProgram(
  exportedPlannerProgram: IExportedPlannerProgram,
  aNextDay?: number,
): IExportedProgram {
  const program = {
    ...Program_create(
      exportedPlannerProgram.program.name,
      exportedPlannerProgram.id,
    ),
    planner: exportedPlannerProgram.program as IPlannerProgram,
  };
  if (aNextDay != null) {
    program.nextDay = aNextDay;
  }
  const exportedProgram = {
    customExercises: exportedPlannerProgram.settings.exercises,
    program,
    version: exportedPlannerProgram.version,
    settings: {
      timers: {
        workout: exportedPlannerProgram.settings.timer,
      },
      planner: exportedPlannerProgram.plannerSettings,
    },
  };
  return exportedProgram;
}

export function Program_stateValue(
  state: IProgramState,
  key: string,
  value?: string,
): number | IWeight | { value: number; unit: "%" } | undefined {
  if (value == null) {
    return undefined;
  }
  const numValue = parseFloat(value);
  const oldValue = state[key];
  if (oldValue == null) {
    return numValue;
  } else if (Weight_is(oldValue)) {
    return Weight_build(numValue, oldValue.unit);
  } else if (
    typeof oldValue === "object" && (oldValue as { unit?: string }).unit === "%"
  ) {
    return { value: numValue, unit: "%" };
  } else {
    return numValue;
  }
}
