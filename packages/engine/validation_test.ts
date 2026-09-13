// PLAN 6.5 bullet 1: 3-week validation via logSession.
import { calibrate, logSession } from "./mod.ts";
import { initialState, type LiftWorkout } from "./state.ts";
import { assert } from "./testutil.ts";

function session(
  date: string,
  sets: number,
  load: number,
  rpe: number,
  srpe: number,
): LiftWorkout {
  return {
    kind: "lift",
    id: date,
    date,
    entries: [{
      exerciseId: "squat",
      targets: ["quads", "glutes"],
      synergists: ["hamstrings"],
      isMain: true,
      sets: Array.from(
        { length: sets },
        () => ({ w: load, r: 5, rpe, completed: true }),
      ),
    }],
    checkin: { prs: 7, soreness: { quads: 2 } },
    srpe,
    minutes: 60,
  };
}

function day(base: Date, off: number, h = 18): string {
  const d = new Date(base.getTime() + off * 86400000);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
}

Deno.test("3-week validation: fatigue spikes week 3, decays on rest, fitness monotonic", () => {
  const base = new Date("2026-01-05T00:00:00Z"); // Monday
  let s = initialState();
  const fit: number[] = [];
  const gm: number[] = [];
  const gs: number[] = [];
  // Weeks 1-2: moderate (3x/wk, 8 sets, RPE 8, sRPE 6). Week 3: heavy (5x, 14 sets, RPE 9.5, sRPE 9).
  for (let wk = 0; wk < 3; wk++) {
    const heavy = wk === 2;
    const days = heavy ? [0, 1, 2, 3, 4] : [0, 2, 4];
    for (const d of days) {
      s = logSession(
        s,
        session(
          day(base, wk * 7 + d),
          heavy ? 14 : 8,
          100,
          heavy ? 9.5 : 8,
          heavy ? 9 : 6,
        ),
      );
    }
    fit.push(s.fitness["squat"]);
    gm.push(s.fatigueMuscle["quads"] ?? 0);
    gs.push(s.fatigueSystemic);
  }
  assert(fit[1] > fit[0] && fit[0] > 0, `fitness accumulates w1-2: ${fit}`);
  assert(fit[2] > fit[1], `fitness accumulates w3: ${fit}`);
  assert(gm[2] > gm[1], `per-muscle fatigue spikes week 3: ${gm}`);
  assert(gs[2] > gs[1], `systemic fatigue spikes week 3: ${gs}`);

  // Capture week-3-end fatigue, then rest 3 days.
  const spikeG = s.fatigueMuscle["quads"] ?? 0;
  const spikeS = s.fatigueSystemic;
  for (let d = 0; d < 3; d++) {
    // rest: advance time with an empty check-in-free day is modelled by decay
    // on next logSession; emulate by logging a zero-input day via calibrate gap:
    s = logSession(s, {
      kind: "lift",
      id: `rest${d}`,
      date: day(base, 21 + d),
      entries: [],
      srpe: 0,
      minutes: 0,
    });
  }
  assert(
    (s.fatigueMuscle["quads"] ?? 0) < spikeG,
    "per-muscle fatigue decays on rest",
  );
  assert(s.fatigueSystemic < spikeS, "systemic fatigue decays on rest");
  assert(spikeS > 0 && spikeG > 0, "week 3 heavy load produced fatigue");
});

Deno.test("a tested 1RM writes referenceRm (CONTEXT.md: block boundary or new tested 1RM)", () => {
  let s = initialState();
  s.mainLifts = ["squat"];
  const tested: LiftWorkout = {
    kind: "lift",
    id: "t1",
    date: "2026-01-05T18:00:00Z",
    entries: [{
      exerciseId: "squat",
      targets: ["quads", "glutes"],
      isMain: true,
      sets: [{ w: 315, r: 1, rpe: 10, completed: true, tested1rm: true }],
    }],
    srpe: 9,
    minutes: 20,
  };
  s = logSession(s, tested);
  assert(
    s.referenceRm["squat"]?.weight === 315,
    `referenceRm is set from the tested 1RM: ${JSON.stringify(s.referenceRm)}`,
  );
  assert(
    s.referenceRm["squat"]?.source === "tested",
    "source is recorded as tested, not kalman",
  );
});

Deno.test("calibrate replays history in date order", () => {
  const base = new Date("2026-01-05T00:00:00Z");
  const w1 = session(day(base, 2), 8, 100, 8, 6);
  const w2 = session(day(base, 0), 8, 100, 8, 6);
  const s = calibrate([w1, w2]); // shuffled input
  assert(s.updated === w1.date, "ends at latest date");
  assert((s.fitness["squat"] ?? 0) > 0, "fitness accumulated");
  assert(s.prsHistory.length === 2, "both checkins recorded");
});
