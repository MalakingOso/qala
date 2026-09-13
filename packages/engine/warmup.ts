// Warm-up generator (PLAN 6.7, RESEARCH-rest-and-warmup.md part 2).
// Blocks: general, soft tissue, dynamic mobility, ramp sets.

import type { Approach } from "./state.ts";

export type WarmupTier = "T0" | "T1" | "T2" | "T3" | "T4";

export interface RampStep {
  load: number | "bar"; // "bar" = empty 45 lb bar x 8
  reps: number;
  restSec: number;
}

const TIERS: { tier: WarmupTier; min: number; steps: { pct: number; reps: number; restSec: number }[] }[] = [
  { tier: "T0", min: 0, steps: [{ pct: 50, reps: 10, restSec: 45 }] },
  { tier: "T1", min: 0.6, steps: [{ pct: 50, reps: 8, restSec: 45 }, { pct: 80, reps: 4, restSec: 90 }] },
  {
    tier: "T2",
    min: 0.75,
    steps: [{ pct: 45, reps: 6, restSec: 45 }, { pct: 65, reps: 4, restSec: 60 }, { pct: 85, reps: 2, restSec: 90 }],
  },
  {
    tier: "T3",
    min: 0.85,
    steps: [
      { pct: 40, reps: 5, restSec: 45 },
      { pct: 60, reps: 3, restSec: 60 },
      { pct: 75, reps: 2, restSec: 90 },
      { pct: 88, reps: 1, restSec: 120 },
    ],
  },
  {
    tier: "T4",
    min: 0.92,
    steps: [
      { pct: 40, reps: 5, restSec: 45 },
      { pct: 55, reps: 3, restSec: 60 },
      { pct: 70, reps: 2, restSec: 90 },
      { pct: 82, reps: 1, restSec: 120 },
      { pct: 91, reps: 1, restSec: 120 },
    ],
  },
];

export const BAR_WEIGHT = 45;

/** Round to 5 lb, .5 up (PLAN 6.7). */
export function round5(w: number): number {
  return Math.floor((w + 2.5) / 5) * 5;
}

/** Tier by I = W / reference (or e1RM; else inverse Epley). Isolation -> T0. */
export function tierFor(intensity: number, isolation: boolean): WarmupTier {
  if (isolation || intensity < 0.6) return "T0";
  if (intensity < 0.75) return "T1";
  if (intensity < 0.85) return "T2";
  if (intensity < 0.92) return "T3";
  return "T4";
}

export function intensityOf(args: { w: number; reference?: number; reps?: number; rir?: number }): number {
  if (args.reference && args.reference > 0) return args.w / args.reference;
  const reps = args.reps ?? 5;
  const rir = args.rir ?? 0;
  return 1 / (1 + (reps + rir) / 30); // inverse Epley
}

export interface RampInput {
  w: number; // top working load
  intensity: number; // I of top work set
  isolation?: boolean;
  firstForMuscle?: boolean; // T0: 1x10@50% only for first exercise of a muscle today
  alreadyTrainedSecondary?: boolean; // -> 1x4 @ 80% W
  extraStep?: boolean; // soreness 4 on targets or prs <= 4
}

/** Ramp sets per exercise (PLAN 6.7 rules). */
export function rampSets(input: RampInput): RampStep[] {
  if (input.alreadyTrainedSecondary) {
    return [{ load: round5(input.w * 0.8), reps: 4, restSec: 90 }];
  }
  const tier = tierFor(input.intensity, input.isolation ?? false);
  if (tier === "T0") {
    if (!input.firstForMuscle) return [];
    return [{ load: round5(input.w * 0.5), reps: 10, restSec: 45 }];
  }
  const def = TIERS.find((t) => t.tier === tier)!.steps;
  const steps: RampStep[] = [];
  for (const s of def) {
    const raw = (input.w * s.pct) / 100;
    if (raw < BAR_WEIGHT) {
      if (!steps.some((x) => x.load === "bar")) steps.push({ load: "bar", reps: 8, restSec: 45 });
      continue; // under-bar steps become one merged "bar x 8"
    }
    const load = round5(raw);
    const prev = steps[steps.length - 1];
    const prevLoad = prev ? (prev.load === "bar" ? BAR_WEIGHT : prev.load) : null;
    if (prevLoad === load) continue; // drop step equal to previous
    if (load >= round5(input.w)) continue; // drop step equal to W
    steps.push({ load, reps: s.reps, restSec: s.restSec });
  }
  if (input.extraStep && steps.length >= 2) {
    const l0 = steps[0].load === "bar" ? BAR_WEIGHT : (steps[0].load as number);
    const l1 = steps[1].load === "bar" ? BAR_WEIGHT : (steps[1].load as number);
    const mid = round5((l0 + l1) / 2);
    if (mid !== l0 && mid !== l1 && mid < round5(input.w)) {
      steps.splice(1, 0, { load: mid, reps: 5, restSec: 60 });
    }
  }
  return steps;
}

export interface WarmupExercise {
  exerciseId: string;
  cls: "main" | "secondary" | "isolation";
  muscles: string[];
  w: number;
  reference?: number;
  reps?: number;
  rir?: number;
  secondaryCompound?: boolean;
}

export interface WarmupInput {
  exercises: WarmupExercise[]; // in order
  approach: Approach;
  soreness: Record<string, number>;
  prs: number;
  equipment: { recovery?: string[]; cardio?: string[] };
  recentRun?: { endedAtIso: string; minutes: number; distanceM: number; easy: boolean };
  nowIso: string;
  timeBudgetMin?: number; // T for blocks 1-3, default 8 (15 when block 1 is 10)
  preferPercussion?: boolean;
  topSetPctRef?: number; // first main lift top set as fraction of reference
}

export interface WarmupBlock {
  kind: "general" | "softTissue" | "mobility";
  items: { name: string; tool?: string; muscle?: string; seconds?: number; reps?: number }[];
  minutes: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface WarmupPlan {
  blocks: WarmupBlock[];
  ramps: { exerciseId: string; steps: RampStep[] }[];
}

const ROLLER_BAD_MUSCLES = new Set(["chest", "frontdelts", "front-delts", "uppertraps", "forearms", "pecs"]);

const MOBILITY: { match: string[]; drills: string[] }[] = [
  { match: ["quads", "glutes"], drills: ["bodyweight squats", "walking lunges", "front-to-back leg swings"] },
  { match: ["hamstrings", "lowerback", "lower-back"], drills: ["bodyweight good mornings", "glute bridges", "straight-leg kicks"] },
  { match: ["calves", "ankles"], drills: ["knee-to-wall ankle rocks", "calf raises", "low pogo hops"] },
  { match: ["chest", "frontdelts", "triceps"], drills: ["incline push-ups", "scapular push-ups", "band pass-throughs"] },
  { match: ["lats", "upperback", "biceps", "reardelts"], drills: ["band pull-aparts", "scapular pulls", "thoracic open-books"] },
  { match: ["shoulders", "overhead"], drills: ["wall slides", "band pass-throughs", "prone Y-T-W"] },
  { match: ["abs", "trunk", "core"], drills: ["dead bugs", "bird dogs"] },
];

function mobilityRows(muscles: string[]): string[][] {
  // Each trained muscle maps to its first matching drill row; quads+glutes
  // share one row (1 min), a full-body day maps to up to 3 rows (3 min).
  const norm = muscles.map((m) => m.toLowerCase().replace(/[_\s]/g, ""));
  const picked: string[][] = [];
  for (const m of norm) {
    if (picked.length >= 3) break;
    const row = MOBILITY.find((r) => r.match.some((k) => m.includes(k.replace("-", ""))));
    if (row && !picked.some((p) => p === row.drills)) picked.push(row.drills);
  }
  if (!picked.length) return [["bodyweight squats", "walking lunges"]];
  return picked.map((drills) => drills.slice(0, 2));
}

/** Easy run <= 15 min or <= 3 km ended within 15 min counts as general (2.7). */
export function runCoversGeneral(
  run: { endedAtIso: string; minutes: number; distanceM: number; easy: boolean } | undefined,
  nowIso: string,
): boolean {
  if (!run || !run.easy) return false;
  const gapMin = (Date.parse(nowIso) - Date.parse(run.endedAtIso)) / 60000;
  if (!(gapMin >= 0 && gapMin <= 15)) return false;
  return run.minutes <= 15 || run.distanceM <= 3000;
}

export function planWarmup(input: WarmupInput): WarmupPlan {
  const T = input.timeBudgetMin ?? (input.topSetPctRef !== undefined && input.topSetPctRef >= 0.85 ? 15 : 8);
  const blocks: WarmupBlock[] = [];
  const heavy = (input.topSetPctRef ?? 0) >= 0.85;

  // Block 1: general.
  const covered = runCoversGeneral(input.recentRun, input.nowIso);
  if (covered) {
    blocks.push({ kind: "general", items: [], minutes: 0, skipped: true, skipReason: "recent easy run covers general" });
  } else {
    const mins = heavy ? 10 : 5;
    const cardio = input.equipment.cardio ?? [];
    const mode = cardio.includes("bike") || cardio.includes("rower") || cardio.includes("treadmill")
      ? cardio.find((c) => c === "bike" || c === "rower" || c === "treadmill")!
      : "brisk walking + bodyweight squats";
    blocks.push({
      kind: "general",
      items: [{ name: `${mins} min easy (${mode})`, seconds: mins * 60 }],
      minutes: mins,
    });
  }

  // Block 2: soft tissue (optional; tool owned and T >= 8).
  const recovery = input.equipment.recovery ?? [];
  const hasTool = recovery.includes("foamRoller") || recovery.includes("percussionMassager");
  const trainedToday = new Set(input.exercises.flatMap((e) => e.muscles));
  const firstTwo = new Set(input.exercises.slice(0, 2).flatMap((e) => e.muscles));
  const soreOnes = [...trainedToday].filter((m) => (input.soreness[m] ?? 0) >= 3);
  const targets = [...new Set([...firstTwo, ...soreOnes])].slice(0, 4);
  if (hasTool && T >= 8 && targets.length > 0) {
    const items: WarmupBlock["items"] = [];
    for (const m of targets) {
      const sore = (input.soreness[m] ?? 0) >= 3;
      const rollerBad = ROLLER_BAD_MUSCLES.has(m.toLowerCase().replace(/[_\s]/g, ""));
      const primeHeavy = heavy && firstTwo.has(m);
      let tool: string;
      if (sore) tool = "foamRoller"; // never percussion on sore muscles
      else if (primeHeavy && !rollerBad) tool = "foamRoller"; // neutral strength effect
      else if (rollerBad && recovery.includes("percussionMassager")) tool = "percussionMassager";
      else if (input.preferPercussion && recovery.includes("percussionMassager") && !primeHeavy) tool = "percussionMassager";
      else if (recovery.includes("foamRoller")) tool = "foamRoller";
      else tool = "percussionMassager";
      if (tool === "percussionMassager") items.push({ name: `percussion ${m}`, tool, muscle: m, seconds: 60 });
      else items.push({ name: `foam roll ${m}`, tool, muscle: m, seconds: sore ? 120 : 90 });
    }
    blocks.push({ kind: "softTissue", items, minutes: items.reduce((a, i) => a + (i.seconds ?? 0), 0) / 60 });
  }

  // Block 3: dynamic mobility, 2 drills x 8-10 for up to 3 groups (~1 min each).
  const groups = [...new Set(input.exercises.flatMap((e) => e.muscles))];
  const rows = mobilityRows(groups);
  const mobItems = rows.flatMap((drills) => drills.map((d) => ({ name: d, reps: 10 })));
  blocks.push({ kind: "mobility", items: mobItems, minutes: rows.length });

  // Cut order when over budget: soft tissue, mobility to 1 drill, general to 3.
  let used = blocks.reduce((a, b) => a + b.minutes, 0);
  if (used > T) {
    const st = blocks.find((b) => b.kind === "softTissue");
    if (st) {
      used -= st.minutes;
      st.items = [];
      st.minutes = 0;
      st.skipped = true;
      st.skipReason = "cut for time";
    }
  }
  if (used > T) {
    const mob = blocks.find((b) => b.kind === "mobility")!;
    mob.items = mob.items.slice(0, 1);
    mob.minutes = 1;
    used = blocks.reduce((a, b) => a + b.minutes, 0);
  }
  if (used > T) {
    const gen = blocks.find((b) => b.kind === "general")!;
    if (!gen.skipped) {
      gen.items = [{ name: "3 min easy", seconds: 180 }];
      gen.minutes = 3;
    }
  }

  // Block 4: ramp sets per exercise, never cut.
  const trained = new Set<string>();
  const ramps = input.exercises.map((e, idx) => {
    const isolation = e.cls === "isolation";
    const intensity = intensityOf({ w: e.w, reference: e.reference, reps: e.reps, rir: e.rir });
    const alreadyTrained = idx > 0 && e.secondaryCompound === true &&
      e.muscles.every((m) => trained.has(m));
    const extraStep = e.muscles.some((m) => (input.soreness[m] ?? 0) === 4) || input.prs <= 4;
    const firstForMuscle = e.muscles.some((m) => !trained.has(m));
    e.muscles.forEach((m) => trained.add(m));
    return { exerciseId: e.exerciseId, steps: rampSets({ w: e.w, intensity, isolation, firstForMuscle, alreadyTrainedSecondary: alreadyTrained, extraStep }) };
  });
  return { blocks, ramps };
}

/** Warm-up before runs: easy -> slower first 5 min; quality -> 10-15 easy + drills + strides. */
export function planRunWarmup(type: "easy" | "tempo" | "intervals" | "race"): string[] {
  if (type === "easy") return ["first 5 min slower than target"];
  return ["10-15 min easy", "3 min dynamic drills", "strides"];
}
