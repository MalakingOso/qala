// Discrete-time decay per PLAN 6.2: x_t = x_{t-1} * exp(-dt/tau) + k*input.
// dt in days from ISO 8601 timestamps (exact ms, so DST/month safe).

export function daysBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / 86400000;
}

export function decayValue(x: number, dtDays: number, tau: number): number {
  if (!(dtDays > 0)) return x;
  return x * Math.exp(-dtDays / tau);
}

export function applyInput(x: number, dtDays: number, tau: number, k: number, input: number): number {
  return decayValue(x, dtDays, tau) + k * input;
}

export function decayRecord(
  rec: Record<string, number>,
  dtDays: number,
  tauFor: (key: string) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(rec)) out[key] = decayValue(rec[key], dtDays, tauFor(key));
  return out;
}

/** Per-muscle fatigue tau (PLAN 6.2): 2.0 d default, 2.5 d for posterior/large groups. */
const TAU_2_5 = new Set(["lats", "upperback", "upper-back", "back", "quads", "quadriceps", "hamstrings", "glutes", "calves", "lowerback", "lower-back"]);

export function muscleTau(muscle: string): number {
  const key = muscle.toLowerCase().replace(/[_\s]/g, "");
  return TAU_2_5.has(key) ? 2.5 : 2.0;
}

export const TAU_FITNESS_LIFT = 45;
export const TAU_SYSTEMIC = 10;
export const TAU_FITNESS_RUN = 42;
export const TAU_DAMAGE = 5;
