// Running plans (PLAN.md 12, evidence RESEARCH-running.md 6).
// Rules: most running easy (below 0.78 CS; default ~80% of time easy); one
// quality session/week at 3 runs/wk, two at 4+ (tempo near CS, intervals above
// CS, surges as the entry workout); the long run never exceeds 1.10x the
// longest run of the previous 30 days; weekly distance never grows more than
// 30% across two weeks; a down week every 3-4 weeks; a two-week race taper
// with volume cut 41-60% and intensity kept. No 10% rule (failed its trial).

import type {
  RunPlan,
  RunPlanDay,
  RunPlanWeek,
  RunWorkout,
  RunWorkoutType,
} from "./types.ts";

export const EASY_CS_FRACTION = 0.78;
export const EASY_TIME_SHARE = 0.8;
export const LONG_RUN_CAP = 1.1;
export const TWO_WEEK_GROWTH_CAP = 1.3;
export const TAPER_CUT: [number, number] = [0.41, 0.6];

export interface RunPlanInput {
  goal: "base" | "distance" | "race";
  runsPerWeek: number; // 2-7
  currentWeeklyKm: number;
  longestRunKm: number; // longest run in the previous 30 days
  weeks: number;
  criticalSpeedMps?: number; // CS when three qualifying efforts exist
  recentRace?: { distanceM: number; seconds: number };
  raceDistanceM?: number;
  raceDate?: string;
}

function riegelPredict(
  knownM: number,
  knownSec: number,
  targetM: number,
): number {
  return knownSec * Math.pow(targetM / knownM, 1.06);
}

// Threshold pace before CS exists: Riegel-convert a recent race to a ~10 km
// equivalent and use its pace (assumption, PLAN.md 6.4).
export function thresholdPaceMps(input: RunPlanInput): number | undefined {
  if (input.criticalSpeedMps) return input.criticalSpeedMps;
  if (input.recentRace) {
    const eq10k = riegelPredict(
      input.recentRace.distanceM,
      input.recentRace.seconds,
      10000,
    );
    return 10000 / eq10k;
  }
  return undefined;
}

export function easyPaceZoneMps(input: RunPlanInput): string {
  const t = thresholdPaceMps(input);
  if (!t) return "easy, conversational";
  const easy = t * EASY_CS_FRACTION;
  return `easy below ${(easy * 3.6).toFixed(1)} km/h (0.78 CS)`;
}

function qualityCount(runsPerWeek: number): number {
  return runsPerWeek >= 4 ? 2 : 1;
}

function qualityKinds(weekIdx: number): RunWorkoutType[] {
  // Surges are the entry workout; tempo near CS, intervals above CS.
  const rotation: RunWorkoutType[][] = [
    ["tempo", "intervals"],
    ["surges", "tempo"],
    ["intervals", "tempo"],
  ];
  return rotation[weekIdx % rotation.length];
}

function makeWorkout(
  type: RunWorkoutType,
  targetMin: number,
  targetKm: number,
  input: RunPlanInput,
): RunWorkout {
  const easy = easyPaceZoneMps(input);
  if (type === "easy" || type === "recovery" || type === "long") {
    return {
      type,
      steps: [{
        kind: "work",
        seconds: Math.round(targetMin * 60),
        paceZone: easy,
      }],
      targetMin,
      targetKm,
      hard: false,
    };
  }
  if (type === "surges") {
    return {
      type,
      steps: [
        { kind: "warmup", seconds: 600, paceZone: easy },
        { kind: "work", seconds: 60, paceZone: "fast, relaxed", repeat: 6 },
        { kind: "recover", seconds: 120, paceZone: easy, repeat: 6 },
        { kind: "cooldown", seconds: 600, paceZone: easy },
      ],
      targetMin,
      targetKm,
      hard: false,
    };
  }
  if (type === "tempo") {
    return {
      type,
      steps: [
        { kind: "warmup", seconds: 600, paceZone: easy },
        {
          kind: "work",
          seconds: Math.round(targetMin * 0.6 * 60),
          paceZone: "tempo near CS",
        },
        { kind: "cooldown", seconds: 600, paceZone: easy },
      ],
      targetMin,
      targetKm,
      hard: true,
    };
  }
  // intervals above CS
  return {
    type,
    steps: [
      { kind: "warmup", seconds: 900, paceZone: easy },
      { kind: "work", seconds: 240, paceZone: "interval above CS", repeat: 5 },
      { kind: "recover", seconds: 180, paceZone: easy, repeat: 5 },
      { kind: "cooldown", seconds: 600, paceZone: easy },
    ],
    targetMin,
    targetKm,
    hard: true,
  };
}

// Weekly distance targets: hold/grow within the two-week 30% cap, down week
// every 4th week (x0.7), two-week race taper cutting 41-60% with intensity kept.
export function weeklyDistances(input: RunPlanInput): number[] {
  const out: number[] = [];
  const peakIdx = input.goal === "race" ? input.weeks - 3 : -1;
  for (let w = 0; w < input.weeks; w++) {
    let d: number;
    if (w === 0) {
      d = input.currentWeeklyKm;
    } else if (input.goal === "race" && w === input.weeks - 2) {
      d = out[w - 1] * 0.5; // taper week 1: -50%
    } else if (input.goal === "race" && w === input.weeks - 1) {
      d = out[peakIdx >= 0 ? peakIdx : 0] * 0.4; // race week: -60% of peak
    } else if ((w + 1) % 4 === 0) {
      d = out[w - 1] * 0.7; // down week every 4th
    } else {
      // Steady 12% growth: deliberately not the 10% rule (it failed its only
      // trial, Buist 2008); the two-week 30% cap still binds above this.
      d = out[w - 1] * 1.12;
    }
    if (w >= 2) d = Math.min(d, out[w - 2] * TWO_WEEK_GROWTH_CAP);
    if (w >= 1 && input.goal !== "race") {
      d = Math.min(d, out[w - 1] * TWO_WEEK_GROWTH_CAP);
    }
    out.push(Math.round(d * 10) / 10);
  }
  return out;
}

export function generateRunPlan(input: RunPlanInput): RunPlan {
  const distances = weeklyDistances(input);
  const kinds = input.goal === "race" ? "race" : input.goal;
  const weeks: RunPlanWeek[] = [];
  const recentLongs: number[] = [input.longestRunKm];
  const nQuality = qualityCount(input.runsPerWeek);

  for (let w = 0; w < input.weeks; w++) {
    const taperWeek = input.goal === "race" && w >= input.weeks - 2;
    const downWeek = !taperWeek && (w + 1) % 4 === 0;
    const totalKm = distances[w];
    const window = recentLongs.slice(-4);
    const longCap = Math.max(...window) * LONG_RUN_CAP;
    let longKm = Math.min(totalKm * 0.3, longCap);
    longKm = Math.round(longKm * 10) / 10;

    const days: RunPlanDay[] = [];
    const quals = qualityKinds(w).slice(0, nQuality);
    const longIdx = input.runsPerWeek - 1;
    const qualIdxs = new Set<number>();
    if (input.runsPerWeek >= 2) qualIdxs.add(1);
    // NOTE (see DECISIONS.md / report): at runsPerWeek === 4, longIdx is 3,
    // the same slot this would use for a second quality session, so the
    // `.delete(longIdx)` below silently drops back to one quality session
    // here even though `qualityCount(4)` says two. Moving the second
    // session to a free slot (index 2) is possible but was reverted: it
    // pushes two of this test suite's other specified invariants below
    // their stated bounds for a 4-day week (easyTimeShare's 80% floor, and
    // the race-taper week's "only the race is hard" rule) — a genuine
    // conflict between "two quality sessions at 4+" and those two rules,
    // not a one-line fix. Left as documented, owner-facing behavior
    // pending a decision on which rule gives way for a 4-day week.
    if (nQuality === 2 && input.runsPerWeek >= 4) qualIdxs.add(3);
    qualIdxs.delete(longIdx);

    const runDays = daySpread(input.runsPerWeek);
    let easyKm = totalKm - longKm;
    const qualKmEach = Math.min(totalKm * 0.12, easyKm * 0.3);
    easyKm -= qualKmEach * qualIdxs.size;

    const sortedQuals = [...qualIdxs].sort((a, b) => a - b);
    for (let i = 0; i < input.runsPerWeek; i++) {
      let workout: RunWorkout;
      if (i === longIdx && !taperWeek) {
        workout = makeWorkout("long", 60 + (longKm / 10) * 55, longKm, input);
      } else if (
        i === longIdx && input.goal === "race" && w === input.weeks - 1
      ) {
        const rd = (input.raceDistanceM ?? 5000) / 1000;
        workout = makeWorkout("race", 30 + rd * 5, rd, input);
      } else if (qualIdxs.has(i)) {
        const q = quals[sortedQuals.indexOf(i) % quals.length];
        workout = makeWorkout(q, 45, Math.round(qualKmEach * 10) / 10, input);
      } else {
        const share = easyKm /
          Math.max(1, input.runsPerWeek - qualIdxs.size - 1);
        workout = makeWorkout(
          "easy",
          30 + share * 5,
          Math.round(share * 10) / 10,
          input,
        );
      }
      days.push({ dayOfWeek: runDays[i], workout });
    }
    if (!taperWeek) {
      recentLongs.push(longKm);
    } else {
      recentLongs.push(longKm * 0.6);
    }
    weeks.push({ week: w + 1, downWeek, taperWeek, days });
  }
  return {
    name: `${kinds} plan, ${input.runsPerWeek} runs/wk`,
    goal: kinds,
    weeks,
  };
}

// Spread run days across the week: long run Sunday, quality mid-week.
function daySpread(n: number): number[] {
  const pools: Record<number, number[]> = {
    2: [2, 0],
    3: [2, 4, 0],
    4: [1, 3, 5, 0],
    5: [1, 2, 4, 5, 0],
    6: [1, 2, 3, 4, 5, 0],
    7: [1, 2, 3, 4, 5, 6, 0],
  };
  return pools[n] ?? pools[3];
}

// Share of weekly running time at easy effort (below 0.78 CS). Quality work
// is the only non-easy time; warmups/cooldowns count as easy.
export function easyTimeShare(week: RunPlanWeek): number {
  let easy = 0;
  let total = 0;
  for (const d of week.days) {
    total += d.workout.targetMin;
    if (!d.workout.hard) {
      easy += d.workout.targetMin;
    } else {
      easy += 20; // warmup + cooldown of a quality session
    }
  }
  return total === 0 ? 1 : easy / total;
}
