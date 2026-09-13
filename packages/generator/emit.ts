// Deterministic liftoscript program text (PLAN.md 12: output is planner text
// with progress: scripts, double progression by default, so it opens in the
// editor as a normal program). Deterministic: exercises sorted, fixed number
// formatting, no randomness, no dates except meet-taper sessions.

import type {
  BlockDef,
  BlockWeek,
  DayPlan,
  GeneratorInput,
  PlannedExercise,
} from "./types.ts";

function fmtLoad(ex: PlannedExercise): string {
  if (ex.load !== undefined) return `${ex.load}lb`;
  return `${ex.loadPct}%`;
}

// Double-progression script for hypertrophy/maintenance accessories (PLAN 6.3:
// top of rep range hit at or below target RPE on two consecutive sessions adds
// upper +2.5%/plate step, lower +5%). Strength slots progress by weekly
// percentage steps with Helms 2018 RPE autoregulation (+/-2% per 0.5 RPE,
// capped +/-6%).
function progressScript(ex: PlannedExercise): string {
  if (ex.progression === "double") {
    return `progress: double(${ex.repsLow}, ${ex.repsHigh}, rpe<=${ex.rpe})`;
  }
  if (ex.progression === "rpeAuto") {
    return `progress: percent(auto, helms2pct, cap6) // RPE ${ex.rpe}`;
  }
  return `progress: percent(+weekly) // RPE ${ex.rpe}`;
}

function exerciseLine(ex: PlannedExercise): string {
  const reps = ex.repsLow === ex.repsHigh
    ? `${ex.repsLow}`
    : `${ex.repsLow}-${ex.repsHigh}`;
  return `${ex.name} / ${ex.sets}x${reps} @ ${fmtLoad(ex)} / RPE ${ex.rpe} / ${
    progressScript(ex)
  }`;
}

function dayBlock(day: DayPlan, dayIndex: number): string {
  const lines = [`### Day ${dayIndex} - ${day.label} (${day.focus})`];
  const sorted = [...day.exercises].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const ex of sorted) lines.push(exerciseLine(ex));
  return lines.join("\n");
}

function weekBlock(week: BlockWeek): string {
  const lines = [
    ``,
    `## Week ${week.week}${week.deload ? " - deload" : ""}`,
    ``,
  ];
  week.days.forEach((day, i) => lines.push(dayBlock(day, i + 1), ``));
  return lines.join("\n").trimEnd();
}

export function emitProgram(block: BlockDef, input: GeneratorInput): string {
  const refs = Object.entries(input.referenceRm)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const header = [
    `# ${block.name}`,
    `# goal: ${block.goal} | approach: ${block.approach} | periodization: ${block.periodization}`,
    `# daysPerWeek: ${input.daysPerWeek} | sessionMinutes: ${input.sessionMinutes} | experience: ${input.experience}`,
    `# referenceRm: ${refs}`,
  ];
  if (input.meetDate) header.push(`# meetDate: ${input.meetDate}`);
  if (block.reasonCodes.length > 0) {
    header.push(`# reasons: ${[...block.reasonCodes].sort().join(", ")}`);
  }
  const body = block.weeks.map(weekBlock).join("\n");
  return header.join("\n") + "\n" + body + "\n";
}
