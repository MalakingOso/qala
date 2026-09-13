// Loading templates (PLAN.md 12, RESEARCH B2-B4) and the meet taper table.

import { altDupWeek, ALT_DUP_DAYS, DUP_TABLE, DUP_WEEK5_OPENER_PCT, HYPERTROPHY_TABLE, LINEAR_TABLE, LINEAR_WEEK5_OPENER_PCT, linearDeadlift, pctForRepsRir, roundToPlates, rpeForRir, TAPER, TAPER_INTENSITY_FLOOR, TAPER_VOLUME_CUT, taperSchedule, weightForPct } from "./templates.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

function approx(a: number, b: number, msg: string, eps = 1e-9): void {
  if (Math.abs(a - b) > eps) throw new Error(`assert failed: ${msg} (${a} != ${b})`);
}

Deno.test("linear table matches PLAN.md 12 (squat and bench)", () => {
  const byWeek = new Map(LINEAR_TABLE.map((r) => [r.week, r]));
  const w1 = byWeek.get(1)!;
  assert(w1.sets === 4 && w1.reps === 5 && w1.pct === 80 && w1.nl85 === 0, "week 1 4x5 @ 80%");
  const w3 = byWeek.get(3)!;
  assert(w3.sets === 5 && w3.reps === 3 && w3.pct === 86 && w3.nl85 === 15, "week 3 5x3 @ 86%, NL85 15");
  const w5 = byWeek.get(5)!;
  assert(w5.pct === 92 && w5.nl85 === 6, "week 5 work sets at 92%");
  assert(LINEAR_WEEK5_OPENER_PCT === 95, "week 5 opens with a single at 95%");
  const w6 = byWeek.get(6)!;
  assert(w6.deload === true && w6.pct === 75 && w6.sets === 3, "week 6 deload 3x3 @ 75%");
  const dl1 = linearDeadlift(1);
  assert(dl1.sets === 3 && dl1.reps === 5 && dl1.pct === 80, "deadlift variant 3x5 @ 80%");
  const dl5 = linearDeadlift(5);
  assert(dl5.sets === 2 && dl5.reps === 1 && dl5.pct === 92, "deadlift week 5 2x1 @ 92%");
});

Deno.test("DUP table matches PLAN.md 12 (HPS order, RPE-capped strength day)", () => {
  const byWeek = new Map(DUP_TABLE.map((r) => [r.week, r]));
  const w1 = byWeek.get(1)!;
  assert(w1.hypertrophy.sets === 4 && w1.hypertrophy.reps === 8 && w1.hypertrophy.pct === 72.5, "H day 4x8 @ 72.5%");
  assert(w1.power.sets === 5 && w1.power.reps === 2 && w1.power.pct === 80, "P day 5x2 @ 80%");
  assert(w1.strength.sets === 3 && w1.strength.reps === 5 && w1.strength.pct === 82, "S day 3x5 @ 82%");
  assert(w1.nl85 === 0, "week 1 NL85 0");
  assert(byWeek.get(2)!.nl85 === 12, "week 2 NL85 12");
  assert(byWeek.get(3)!.nl85 === 14, "week 3 NL85 14");
  const w5 = byWeek.get(5)!;
  assert(w5.strength.sets === 2 && w5.strength.reps === 2 && w5.strength.pct === 87, "week 5 S day 2x2 @ 87%");
  assert(DUP_WEEK5_OPENER_PCT === 95, "week 5 S day opens at 95%");
});

Deno.test("alternative DUP 5-3-1 with weekly +2%", () => {
  assert(ALT_DUP_DAYS[0].sets === 4 && ALT_DUP_DAYS[0].reps === 5 && ALT_DUP_DAYS[0].basePct === 80, "day A 4x5 @ 80%");
  assert(ALT_DUP_DAYS[1].sets === 5 && ALT_DUP_DAYS[1].reps === 3 && ALT_DUP_DAYS[1].basePct === 85, "day B 5x3 @ 85%");
  assert(ALT_DUP_DAYS[2].sets === 6 && ALT_DUP_DAYS[2].reps === 1 && ALT_DUP_DAYS[2].basePct === 90, "day C 6x1 @ 90%");
  const w2 = altDupWeek(2);
  assert(w2[0].pct === 82 && w2[1].pct === 87 && w2[2].pct === 92, "week 2 adds 2%");
  const w4 = altDupWeek(4);
  const c = w4.find((d) => d.day === "C")!;
  assert(c.sets === 3 && c.reps === 1 && c.pct === 95, "week 4 day C is 3 singles at 95%");
});

Deno.test("hypertrophy RIR ramp matches PLAN.md 12", () => {
  const byWeek = new Map(HYPERTROPHY_TABLE.map((r) => [r.week, r]));
  const w1 = byWeek.get(1)!;
  assert(w1.rirCompound.join() === "3,3" && w1.rirIsolation.join() === "3,3", "week 1 RIR 3/3");
  assert(w1.compoundReps.join() === "8,12" && w1.isolationReps.join() === "12,15", "owner 8-15 band");
  const w5 = byWeek.get(5)!;
  assert(w5.rirCompound.join() === "1,1" && w5.rirIsolation.join() === "0,1", "week 5 peaks at RIR 1 / 0-1");
  const w6 = byWeek.get(6)!;
  assert(w6.deload === true && w6.rirCompound.join() === "4,4" && w6.loadDeltaPct === -10, "deload RIR 4, load -10%");
});

Deno.test("inverse Epley and plate rounding", () => {
  approx(pctForRepsRir(10, 2), 71.428, "10 reps RIR 2 loads 71.4%", 0.01);
  approx(pctForRepsRir(8, 3), 73.17, "8 reps RIR 3 loads 73.2%", 0.01);
  assert(rpeForRir(2) === 8, "RIR 2 is RPE 8");
  assert(weightForPct(200, 80) === 160, "200 x 80% loads 160");
  assert(weightForPct(200, 77) === 155, "200 x 77% rounds 154 to 155");
  assert(roundToPlates(212, 5) === 210, "212 rounds to 210 on 5 lb steps");
});

Deno.test("taper offsets sit inside the Pritchard/Travis ranges", () => {
  assert(TAPER.deadlift.lastHeavyDaysOut.join() === "8,10", "deadlift last heavy 8-10 d");
  assert(TAPER.squat.lastHeavyDaysOut.join() === "7,9", "squat last heavy 7-9 d");
  assert(TAPER.bench.lastHeavyDaysOut.join() === "5,7", "bench last heavy 5-7 d");
  assert(TAPER.deadlift.finalScheme === "3x1" && TAPER.squat.finalScheme === "3x2" && TAPER.bench.finalScheme === "3x3", "final schemes 3x1/3x2/3x3");
  assert(TAPER_VOLUME_CUT[0] === 0.4 && TAPER_VOLUME_CUT[1] === 0.5, "volume cut 40-50%");
  assert(TAPER_INTENSITY_FLOOR === 85, "intensity held at 85%+");
});

Deno.test("taper dates land the right days before the meet", () => {
  const sched = taperSchedule("2026-10-10");
  const get = (lift: string, kind: string) => sched.find((s) => s.lift === lift && s.kind === kind)!;
  const dlH = get("deadlift", "lastHeavy");
  assert(dlH.daysOut >= 8 && dlH.daysOut <= 10 && dlH.dateISO === "2026-10-01", "deadlift opener 9 d out");
  const dlL = get("deadlift", "lastSession");
  assert(dlL.daysOut === 6 && dlL.dateISO === "2026-10-04", "deadlift final 6 d out");
  const sqH = get("squat", "lastHeavy");
  assert(sqH.daysOut >= 7 && sqH.daysOut <= 9, "squat opener 7-9 d out");
  const sqL = get("squat", "lastSession");
  assert(sqL.daysOut >= 4 && sqL.daysOut <= 5, "squat final 4-5 d out");
  const bpH = get("bench", "lastHeavy");
  assert(bpH.daysOut >= 5 && bpH.daysOut <= 7, "bench opener 5-7 d out");
  const bpL = get("bench", "lastSession");
  assert(bpL.daysOut >= 3 && bpL.daysOut <= 4, "bench final 3-4 d out");
  assert(new Date(dlH.dateISO) < new Date(dlL.dateISO), "opener before final session");
});
