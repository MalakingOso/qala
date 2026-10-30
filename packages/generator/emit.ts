// Deterministic LS++ program text (docs/PLAN.md 12: output is planner text that
// opens in the editor as a normal program). Deterministic: exercises in workout order,
// fixed number formatting, no randomness, no dates except meet-taper sessions.
//
// The shape follows the LS++ planner grammar (packages/liftoscript/src/pages/
// planner/plannerExercise.grammar): `# Week N`, `## Day N: label`, and
// `Exercise / 4x8 180lb @7.5`. A `///` line is a comment the evaluator drops;
// a `//` line becomes the description of the exercise under it, which the
// lifter sees on the workout screen. So the block's metadata goes in `///`
// lines, and the notes about one exercise go in `//` lines right above it.
//
// The progression rules are written as `// progress:` notes in words, not as
// LS++ `progress:` clauses. Which LS++ form they take is an open owner decision
// (D37).

import type {
  BlockDef,
  BlockWeek,
  DayPlan,
  GeneratorInput,
  PlannedExercise,
} from "./types.ts";

export interface LsppExercise {
  /** Name as LS++ writes it: a built-in catalog name (packages/liftoscript
   * allExercisesList), with `, Equipment` when the generator means other kit
   * than the catalog's default, and `label: ` when the lift has no entry of
   * its own. */
  name: string;
  /** What the generator meant, when the catalog has no exact entry. */
  meant?: string;
}

/**
 * Generator exercise id to its LS++ name. A bare catalog name evaluates with
 * that exercise's default equipment, and a weight is rounded to what that
 * equipment can load, so the suffix matters wherever a weight is written:
 * bare `Romanian Deadlift` is a dumbbell lift and dry-runs 185 lb as 40 lb.
 */
export const LSPP_EXERCISES: Readonly<Record<string, LsppExercise>> = {
  squat: { name: "Squat" },
  bench: { name: "Bench Press" },
  deadlift: { name: "Deadlift" },
  ohp: { name: "Overhead Press" },
  // The label keeps it apart from plain Squat on the same day (LS++ refuses a
  // name twice in one day) and gives it its own weights.
  pauseSquat: {
    name: "pause: Squat",
    meant:
      "Pause Squat. The catalog has no entry, so it is Squat under the label pause.",
  },
  closeGripBench: { name: "Bench Press Close Grip" },
  rdl: { name: "Romanian Deadlift, Barbell" },
  row: { name: "Bent Over Row" },
  pullup: { name: "Pull Up" },
  legPress: { name: "Leg Press" },
  lunge: { name: "Lunge, Dumbbell" },
  hipThrust: { name: "Hip Thrust" },
  inclineDb: { name: "Incline Bench Press, Dumbbell" },
  lateralRaise: { name: "Lateral Raise" },
  curl: { name: "Bicep Curl" },
  pushdown: { name: "Triceps Pushdown" },
  calfRaise: {
    name: "Standing Calf Raise, Leverage Machine",
    meant:
      "Calf Raise. The generator names no variant, so standing on a machine.",
  },
  legCurl: { name: "Leg Curl" },
  facePull: { name: "Face Pull, Cable" },
};

export function lsppExercise(exerciseId: string): LsppExercise {
  const found = LSPP_EXERCISES[exerciseId];
  if (!found) throw new Error(`no LS++ name for exercise: ${exerciseId}`);
  return found;
}

function repsText(ex: PlannedExercise): string {
  return ex.repsLow === ex.repsHigh
    ? `${ex.repsLow}`
    : `${ex.repsLow}-${ex.repsHigh}`;
}

// A set with RPE and no weight gets a weight inferred from the 1RM in the
// lifter's settings (ProgramSet_isEligibleForInferredWeight), which would hide
// the `?+` blank. So a line with no reference 1RM is `?+` alone and its RPE
// goes in the progress note.
function setsText(ex: PlannedExercise): string {
  const sets = `${ex.sets}x${repsText(ex)}`;
  if (ex.load === undefined) return `${sets} ?+`;
  return `${sets} ${ex.load}lb @${ex.rpe}`;
}

// The rules the generator intends (docs/PLAN.md 6.3), in words. Double
// progression for hypertrophy and maintenance work and strength accessories;
// weekly percentage steps for strength slots, the top sets autoregulated by
// Helms 2018.
function progressNote(ex: PlannedExercise): string {
  if (ex.progression === "double") {
    const step = ex.lowerBody ? "5%" : "2.5% or one plate step";
    return `// progress: double progression, ${
      repsText(ex)
    } reps at RPE ${ex.rpe} or below. The top of the range on two sessions in a row adds ${step}.`;
  }
  if (ex.progression === "rpeAuto") {
    return `// progress: weekly percentage step from the block table, target RPE ${ex.rpe}. Autoregulated (Helms 2018): each 0.5 RPE off target moves the next same-type session 2%, at most 6%.`;
  }
  return `// progress: weekly percentage step from the block table, target RPE ${ex.rpe}.`;
}

function exerciseLines(ex: PlannedExercise): string[] {
  const { name, meant } = lsppExercise(ex.exerciseId);
  const lines: string[] = [];
  if (meant) lines.push(`// ${meant}`);
  lines.push(progressNote(ex), `${name} / ${setsText(ex)}`);
  return lines;
}

const CLASS_ORDER: Record<PlannedExercise["klass"], number> = {
  main: 0,
  secondary: 1,
  isolation: 2,
};

/**
 * The order lines appear in is the order the lifter does them, so main lifts
 * come first, then secondary, then isolation (PLAN 12); name breaks ties so
 * the output stays deterministic.
 */
export function workoutOrder(
  exercises: readonly PlannedExercise[],
): PlannedExercise[] {
  return [...exercises].sort((a, b) =>
    CLASS_ORDER[a.klass] - CLASS_ORDER[b.klass] || a.name.localeCompare(b.name)
  );
}

function dayBlock(day: DayPlan, dayIndex: number): string {
  const lines = [`## Day ${dayIndex}: ${day.label}`];
  for (const ex of workoutOrder(day.exercises)) {
    lines.push(...exerciseLines(ex));
  }
  return lines.join("\n");
}

function weekBlock(week: BlockWeek): string {
  const lines = [`# Week ${week.week}${week.deload ? " - deload" : ""}`];
  lines.push(week.days.map((day, i) => dayBlock(day, i + 1)).join("\n\n"));
  return lines.join("\n");
}

export function emitProgram(block: BlockDef, input: GeneratorInput): string {
  const refs = Object.entries(input.referenceRm)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const header = [
    `/// ${block.name}`,
    `/// goal: ${block.goal} | approach: ${block.approach} | periodization: ${block.periodization}`,
    `/// daysPerWeek: ${input.daysPerWeek} | sessionMinutes: ${input.sessionMinutes} | experience: ${input.experience}`,
    `/// referenceRm: ${refs}`,
  ];
  if (input.meetDate) header.push(`/// meetDate: ${input.meetDate}`);
  if (block.reasonCodes.length > 0) {
    header.push(`/// reasons: ${[...block.reasonCodes].sort().join(", ")}`);
  }
  const body = block.weeks.map(weekBlock).join("\n\n");
  return header.join("\n") + "\n\n" + body + "\n";
}
