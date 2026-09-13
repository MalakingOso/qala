// Running plans (PLAN.md 12): easy share, quality count, growth caps, down
// weeks, race taper.

import { easyTimeShare, EASY_CS_FRACTION, generateRunPlan, LONG_RUN_CAP, thresholdPaceMps, TWO_WEEK_GROWTH_CAP, weeklyDistances } from "./runplans.ts";
import type { RunPlanInput } from "./runplans.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

const BASE: RunPlanInput = {
  goal: "base",
  runsPerWeek: 4,
  currentWeeklyKm: 20,
  longestRunKm: 8,
  weeks: 8,
  criticalSpeedMps: 4.0,
};

function weekKm(plan: ReturnType<typeof generateRunPlan>, w: number): number {
  return plan.weeks[w].days.reduce((s, d) => s + d.workout.targetKm, 0);
}

Deno.test("weekly distance respects the two-week 30% cap, not the 10% rule", () => {
  const dists = weeklyDistances(BASE);
  for (let w = 2; w < dists.length; w++) {
    assert(
      dists[w] <= dists[w - 2] * TWO_WEEK_GROWTH_CAP + 1e-9,
      `week ${w + 1} within 30% of two weeks earlier`,
    );
  }
  assert(dists[1] > dists[0] * 1.1, "growth above 10% is allowed (no 10% rule)");
});

Deno.test("long run never exceeds 1.10x the previous 30-day longest", () => {
  const plan = generateRunPlan(BASE);
  const recent: number[] = [BASE.longestRunKm];
  for (const week of plan.weeks) {
    if (week.taperWeek) continue;
    const long = week.days.find((d) => d.workout.type === "long");
    if (!long) continue;
    const cap = Math.max(...recent.slice(-4)) * LONG_RUN_CAP;
    assert(long.workout.targetKm <= cap + 1e-9, `week ${week.week} long run within 1.10x cap`);
    recent.push(long.workout.targetKm);
  }
});

Deno.test("easy running stays at or above 80% of time", () => {
  const plan = generateRunPlan(BASE);
  for (const week of plan.weeks) {
    if (week.taperWeek) continue;
    assert(easyTimeShare(week) >= 0.8 - 1e-9, `week ${week.week} easy share >= 80%`);
  }
});

Deno.test("quality count: one at 3 runs/wk, two at 4+", () => {
  // Quality sessions are tempo/intervals work plus surges as the entry
  // workout; surges stay easy effort while holding the quality slot.
  const isQuality = (t: string) => t === "tempo" || t === "intervals" || t === "surges";
  const three = generateRunPlan({ ...BASE, runsPerWeek: 3 });
  for (const week of three.weeks) {
    const n = week.days.filter((d) => isQuality(d.workout.type)).length;
    assert(n === 1, `3/wk week ${week.week} has one quality session`);
  }
  const five = generateRunPlan({ ...BASE, runsPerWeek: 5 });
  for (const week of five.weeks) {
    const n = week.days.filter((d) => isQuality(d.workout.type)).length;
    assert(n === 2, `5/wk week ${week.week} has two quality sessions`);
  }
});

Deno.test("down week every fourth week", () => {
  const plan = generateRunPlan(BASE);
  assert(plan.weeks[3].downWeek, "week 4 is a down week");
  assert(weekKm(plan, 3) < weekKm(plan, 2), "down week volume drops");
});

Deno.test("race taper cuts 41-60% over two weeks and keeps intensity", () => {
  const plan = generateRunPlan({
    ...BASE,
    goal: "race",
    raceDistanceM: 21097,
    raceDate: "2026-10-10",
  });
  const weeks = plan.weeks;
  assert(weeks[weeks.length - 1].taperWeek && weeks[weeks.length - 2].taperWeek, "final two weeks taper");
  const trainingKm = weeks.map((w) => w.days.reduce((s, d) => s + d.workout.targetKm, 0));
  const peak = Math.max(...trainingKm.slice(0, weeks.length - 2));
  const firstTaper = trainingKm[weeks.length - 2] / trainingKm[weeks.length - 3];
  assert(firstTaper >= 0.4 - 1e-9 && firstTaper <= 0.6 + 1e-9, "first taper week cuts 41-60%");
  const raceWeek = weeks[weeks.length - 1];
  const support = raceWeek.days.filter((d) => d.workout.type !== "race")
    .reduce((s, d) => s + d.workout.targetKm, 0);
  assert(support <= peak * 0.6 + 1e-9, "race-week support running stays tapered");
  assert(raceWeek.days.every((d) => d.workout.type === "race" || !d.workout.hard), "only the race is hard in race week");
  const preTaper = weeks[weeks.length - 3];
  assert(preTaper.days.some((d) => d.workout.hard), "intensity kept into the taper");
  assert(weeks[weeks.length - 2].days.some((d) => d.workout.hard), "intensity kept during the taper");
  const raceDay = raceWeek.days.find((d) => d.workout.type === "race");
  assert(raceDay !== undefined, "race week contains the race");
});

Deno.test("easy pace sits below 0.78 CS, threshold falls back to Riegel", () => {
  assert(EASY_CS_FRACTION === 0.78, "easy threshold is 0.78 CS");
  assert(thresholdPaceMps(BASE) === 4.0, "CS used directly when known");
  const noCS = thresholdPaceMps({ ...BASE, criticalSpeedMps: undefined, recentRace: { distanceM: 5000, seconds: 1200 } });
  assert(noCS !== undefined && noCS < 5000 / 1200, "Riegel 10 km equivalent is slower than 5 km pace");
  const plan = generateRunPlan(BASE);
  const easy = plan.weeks[0].days.find((d) => d.workout.type === "easy")!;
  assert(easy.workout.steps[0].paceZone!.includes("0.78 CS"), "easy zone names the 0.78 CS ceiling");
});
