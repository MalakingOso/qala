// Metrics (PLAN 6.3): zones, VL_m, PRs, 1RM progression + readiness flags.
import { intensityZones, volumeLoad, updatePrs, oneRmProgression, bodyweightLoad } from "./metrics.ts";
import { predictReadiness } from "./mod.ts";
import { initialState } from "./state.ts";
import { initKalman } from "./kalman.ts";
import { assert, assertClose } from "./testutil.ts";

Deno.test("intensity zones NL85/T85/NL/ARI", () => {
  const z = intensityZones(
    [{ load: 150, reps: 5 }, { load: 170, reps: 3 }, { load: 180, reps: 2 }],
    200,
  );
  assert(z.nl === 10, "NL");
  assert(z.tonnage === 750 + 510 + 360, "T");
  assert(z.nl85 === 5 && z.t85 === 870, "NL85/T85");
  assert(z.nl90 === 2 && z.t90 === 360, "90+");
  assertClose(z.ari, 1620 / 10 / 200, 1e-9, "ARI");
  assert(z.byZone["70-79.9"] === 5 && z.byZone["85-89.9"] === 3 && z.byZone["90+"] === 2, "buckets");
});

Deno.test("VL_m target/synergist weighting", () => {
  const vl = volumeLoad([{ load: 100, reps: 10, muscles: [{ muscle: "quads", w: 1 }, { muscle: "hams", w: 0.5 }] }]);
  assert(vl["quads"] === 1000 && vl["hams"] === 500, "VL weights");
});

Deno.test("bodyweight factors (assumptions)", () => {
  assert(bodyweightLoad("pullup", 180, 25) === 205, "pullup 1.0");
  assertClose(bodyweightLoad("pushup", 180, 0), 117, 1e-9, "pushup 0.65");
});

Deno.test("PRs: rep at load, load at reps; >10 reps never e1RM", () => {
  let prs = updatePrs([], "bench", 135, 10, 180, "2026-01-01T00:00:00Z");
  assert(prs.some((p) => p.kind === "e1rm"), "e1RM at 10 reps recorded");
  prs = updatePrs(prs, "bench", 135, 12, null, "2026-01-08T00:00:00Z");
  assert(prs.some((p) => p.kind === "rep" && p.reps === 12), "rep PR at 12");
  assert(!prs.some((p) => p.kind === "e1rm" && p.reps === 12), "no e1RM over 10 reps");
  prs = updatePrs(prs, "bench", 140, 12, null, "2026-01-15T00:00:00Z");
  assert(prs.some((p) => p.kind === "load" && p.load === 140), "load PR");
});

Deno.test("1RM progression vs reference", () => {
  const k = initKalman(180, 20, 4);
  const p = oneRmProgression(185, k, 1, 0.5, [180], 175);
  assert(p.dailyBest === 185 && p.tested.length === 1, "fields");
  assertClose(p.pctChangeVsReference!, (185 - 175) / 175, 1e-9, "% block");
  assert(p.kalman !== null, "kalman estimate present");
});

Deno.test("readiness: prs flag, sore block, low line behaviour", () => {
  const s = initialState();
  const low = predictReadiness(s, { prs: 3, soreness: {} }, []);
  assert(low.prsFlag && low.score < 1, "prs<=4 flags");
  const sore = predictReadiness(s, { prs: 8, soreness: { quads: 4 } }, ["quads"]);
  assert(sore.soreBlockedMuscles.includes("quads"), "sore 4 blocks");
  const ok = predictReadiness(s, { prs: 8, soreness: { quads: 1 } }, ["quads"]);
  assert(ok.score === 1 && !ok.prsFlag, "fresh session scores 1");
  // Low PRS history -> z-score path with variance.
  s.prsHistory = [7, 7, 7, 8, 7, 8, 7].map((v, i) => ({ date: `2026-01-0${i + 1}T00:00:00Z`, value: v }));
  const dip = predictReadiness(s, { prs: 4, soreness: {} }, []);
  assert(dip.prsZ !== null && dip.prsZ <= -1.5 && dip.prsFlag, "z<=-1.5 flags");
});
