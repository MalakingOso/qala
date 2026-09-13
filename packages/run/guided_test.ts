// guided_test.ts: step machine transitions, zone prompts, hysteresis.

import { expandWorkout, GuidedRun } from "./guided.ts";
import type { RunWorkout } from "./types.ts";
import { assert } from "./testutil.ts";

const INTERVALS: RunWorkout = {
  type: "intervals",
  steps: [
    { kind: "warmup", seconds: 60 },
    { kind: "work", seconds: 120, paceLoMps: 2.9, paceHiMps: 3.1 },
    { kind: "recover", seconds: 60 },
    { kind: "work", seconds: 120, paceLoMps: 2.9, paceHiMps: 3.1 },
    { kind: "recover", seconds: 60 },
    { kind: "cooldown" },
  ],
};

function drive(
  guided: GuidedRun,
  seconds: number,
  speed: number,
  from: { dist: number; time: number },
): { dist: number; time: number } {
  let { dist, time } = from;
  for (let i = 0; i < seconds; i++) {
    dist += speed;
    time += 1;
    guided.update({ cueSpeedMps: speed, distM: dist, timeSec: time });
  }
  return { dist, time };
}

Deno.test("on-pace intervals step through with no nagging", () => {
  const guided = new GuidedRun(INTERVALS);
  const events = [];
  let st = { dist: 0, time: 0 };
  // Drive second by second to collect every event.
  for (let i = 0; i < 60; i++) {
    st = { dist: st.dist + 3, time: st.time + 1 };
    events.push(
      ...guided.update({ cueSpeedMps: 3, distM: st.dist, timeSec: st.time }),
    );
  }
  for (let i = 0; i < 120; i++) {
    st = { dist: st.dist + 3, time: st.time + 1 };
    events.push(
      ...guided.update({ cueSpeedMps: 3, distM: st.dist, timeSec: st.time }),
    );
  }
  const kinds = events.map((e) => e.type);
  assert(kinds[0] === "stepStart", "workout opens with stepStart");
  assert(kinds.includes("stepEnd"), "warmup ends");
  assert(
    events.filter((e) => e.type === "speedUp" || e.type === "slowDown")
      .length === 0,
    "no prompts while in zone",
  );
  // Drain the rest of the workout; durations are measured from the first
  // update's clock, so run until the cooldown step starts, bounded.
  let guard = 0;
  while (guided.currentStepIndex < 5 && guard++ < 600) {
    st = { dist: st.dist + 3, time: st.time + 1 };
    events.push(
      ...guided.update({ cueSpeedMps: 3, distM: st.dist, timeSec: st.time }),
    );
  }
  assert(guided.currentStepIndex === 5, "reached the cooldown step");
  assert(guided.complete === false, "cooldown holds the workout open");
  const tail = guided.advance(st.dist, st.time);
  assert(
    tail.some((e) => e.type === "workoutComplete"),
    "manual advance completes",
  );
  assert(guided.stepSummaries.length === 6, "one summary per step");
});

Deno.test("slow work pace prompts speedUp, rate-limited, then backInZone", () => {
  const guided = new GuidedRun(INTERVALS, { promptCooldownSec: 45 });
  // Warmup ends one tick after 60 s (durations run from the first update).
  let st = drive(guided, 61, 3, { dist: 0, time: 0 });
  assert(guided.currentStepIndex === 1, "work step started");
  const events = [];
  for (let i = 0; i < 60; i++) {
    st = { dist: st.dist + 2.5, time: st.time + 1 };
    events.push(
      ...guided.update({ cueSpeedMps: 2.5, distM: st.dist, timeSec: st.time }),
    );
  }
  const nags = events.filter((e) => e.type === "speedUp");
  assert(
    nags.length >= 1 && nags.length <= 4,
    `rate-limited nags, got ${nags.length}`,
  );
  const back = [];
  for (let i = 0; i < 60; i++) {
    st = { dist: st.dist + 3, time: st.time + 1 };
    back.push(
      ...guided.update({ cueSpeedMps: 3, distM: st.dist, timeSec: st.time }),
    );
  }
  assert(
    back.some((e) => e.type === "backInZone"),
    "re-entering the zone reports",
  );
});

Deno.test("hysteresis: edge pace does not flap, repeats expand per step", () => {
  const w: RunWorkout = {
    type: "intervals",
    steps: [{ kind: "work", seconds: 60, targetMps: 3 }],
  };
  const guided = new GuidedRun(w, { toleranceMps: 0.1 });
  guided.update({ cueSpeedMps: 3, distM: 0, timeSec: 0 });
  // 2.95 sits inside the 2.9-3.1 zone: silence. 2.85 is inside the band edge.
  for (let i = 1; i <= 30; i++) {
    const ev = guided.update({
      cueSpeedMps: 2.85,
      distM: i * 2.85,
      timeSec: i,
    });
    assert(
      ev.every((e) => e.type !== "speedUp" && e.type !== "slowDown"),
      `quiet at the edge (t=${i})`,
    );
  }
  const rep: RunWorkout = {
    type: "intervals",
    steps: [{ kind: "work", seconds: 60, repeat: 3 }],
  };
  assert(expandWorkout(rep).length === 3, "repeat expands to 3 steps");
  assert(expandWorkout(INTERVALS).length === 6, "no-repeat steps expand to 1");
});
