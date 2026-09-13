// Readiness at session start (PLAN 6.2): derived from the check-in, not load.
// 0-1 weighted combination of PRS z-score (own rolling 4-week window),
// soreness grid, and normalised G_m / G_s. Load-driven fatigue states feed
// the Kalman observation and per-muscle bindings, not readiness directly.

import type { Checkin, EngineState } from "./state.ts";

export interface Readiness {
  score: number; // 0-1
  prsZ: number | null; // null before enough history
  prsFlag: boolean; // z <= -1.5 or prs <= 4
  soreBlockedMuscles: string[];
  reasons: string[];
}

const WINDOW_MS = 28 * 86400000;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

export function prsZScore(history: { date: string; value: number }[], nowIso: string, prs: number): number | null {
  const cutoff = Date.parse(nowIso) - WINDOW_MS;
  const vals = history.filter((h) => Date.parse(h.date) >= cutoff).map((h) => h.value);
  if (vals.length < 2) return null;
  const m = mean(vals);
  const s = sd(vals, m);
  if (s < 1e-9) return 0;
  return (prs - m) / s;
}

/** Normalised local fatigue 0-1 for bindings/rest (calibrated scale). */
export function fatigueLocal(gm: number): number {
  // ~8 hard set-equivalents ≈ 1.0; clamp to [0,1].
  return Math.min(1, Math.max(0, gm / 8));
}

export function predictReadiness(
  state: EngineState,
  checkin: Checkin,
  sessionMuscles: string[],
  nowIso: string,
): Readiness {
  const reasons: string[] = [];
  let score = 1;
  const prsZ = prsZScore(state.prsHistory, nowIso, checkin.prs);
  const prsFlag = (prsZ !== null && prsZ <= -1.5) || checkin.prs <= 4;
  if (prsFlag) {
    score -= 0.3;
    reasons.push(checkin.prs <= 4 ? "prs-low" : "prs-z-low");
  } else if (prsZ !== null && prsZ < -1) {
    score -= 0.15;
    reasons.push("prs-dipping");
  }
  const soreBlocked = sessionMuscles.filter((m) => checkin.soreness[m] === 4);
  if (soreBlocked.length > 0) {
    score -= 0.2;
    reasons.push("sore-blocked:" + soreBlocked.join(","));
  } else if (sessionMuscles.some((m) => checkin.soreness[m] === 3)) {
    score -= 0.05;
    reasons.push("sore-healing");
  }
  const gSession = sessionMuscles.length
    ? sessionMuscles.reduce((a, m) => a + (state.fatigueMuscle[m] ?? 0) + (state.fatigueDamage[m] ?? 0), 0) /
      sessionMuscles.length
    : 0;
  const localPenalty = Math.min(0.2, 0.2 * fatigueLocal(gSession));
  if (localPenalty > 0.01) {
    score -= localPenalty;
    reasons.push("local-fatigue");
  }
  const sysPenalty = Math.min(0.15, 0.15 * Math.min(1, state.fatigueSystemic / 6));
  if (sysPenalty > 0.01) {
    score -= sysPenalty;
    reasons.push("systemic-fatigue");
  }
  return { score: Math.min(1, Math.max(0, score)), prsZ, prsFlag, soreBlockedMuscles: soreBlocked, reasons };
}
