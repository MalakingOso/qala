// PLAN 6.5 Kalman: synthetic recovery + theta lock until 20 observations.
// Scales are engine-consistent: p0 ~ e1RM, k1*F ~ block gain, k2*G ~ 1-5%
// of p0 (per-session fatigue against a ~200 baseline).
import { initKalman, kalmanUpdate, thetaOf } from "./kalman.ts";
import { assert, assertClose } from "./testutil.ts";

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("filter recovers p0,k1 within 10% after 30 obs; theta locked to 20", () => {
  const p0 = 200;
  const k1 = 0.5;
  const theta = 4;
  const k2 = k1 * theta;
  const rand = mulberry(42);
  let k = initKalman(170, 0.35, 4, 9);
  for (let i = 0; i < 30; i++) {
    const F = 6.7 * i; // accumulating fitness, 0 -> ~200
    const G = 6 + 5 * Math.sin(i * 1.7) + (i % 3 === 0 ? 3 : 0); // session spikes
    const noise = (rand() + rand() + rand() - 1.5) * 2 * 3; // ~N(0,3)
    const y = p0 + k1 * F - k2 * G + noise;
    k = kalmanUpdate(k, F, G, y, 1);
    if (k.obs <= 20) assert(thetaOf(k) === 4, `theta locked at obs ${k.obs}`);
  }
  assert(k.obs === 30, "30 obs");
  assertClose(k.p0, p0, 0.1 * p0, "p0 within 10%");
  assertClose(k.k1, k1, 0.1 * k1, "k1 within 10%");
});

Deno.test("tested 1RM uses quarter noise (adapts faster)", () => {
  const seed = (ns: number) =>
    kalmanUpdate(initKalman(150, 15, 4, 4), 1, 1, 200, ns);
  const base1 = seed(1);
  const base2 = seed(1);
  const a = kalmanUpdate(base1, 1, 1, 250, 1);
  const b = kalmanUpdate(base2, 1, 1, 250, 0.25);
  assert(
    Math.abs(b.p0 - base2.p0) > Math.abs(a.p0 - base1.p0),
    "quarter noise adapts faster",
  );
});
