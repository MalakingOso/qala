// e1RM observation rules (PLAN 6.2, RESEARCH B6). Epley tracks the RTS RPE
// table within 2% from 2 to 10 reps; Brzycki runs away above 10.

import { rtsLookup } from "./rtsTable.ts";
import type { SetLog } from "./state.ts";

export interface E1rmObservation {
  e1rm: number;
  tested: boolean; // tested 1RM: observation noise is one quarter of an e1RM's
}

function rirOf(rpe: number): number {
  return 10 - rpe;
}

export function observeSet(s: SetLog): E1rmObservation | null {
  if (!s.completed) return null;
  // Rule 1: singles at RPE >= 9.5, or flagged test/meet attempt.
  if (s.tested1rm || (s.r === 1 && s.rpe !== undefined && s.rpe >= 9.5)) {
    return { e1rm: s.w, tested: true };
  }
  // Rule 2: RPE logged and reps + RIR <= 10.
  if (s.rpe !== undefined) {
    const total = s.r + rirOf(s.rpe);
    if (total <= 10) {
      const look = rtsLookup(s.r, s.rpe);
      if (look.pct !== null && !look.useRule3Fallback) {
        return { e1rm: (s.w / look.pct) * 100, tested: false };
      }
      // Flagged cell or off-table RPE: fall through to rule 3 per PLAN 6.2.
    } else {
      return null; // reps + RIR > 10 with RPE: no observation (rule 4 logic)
    }
    if (s.r > 10) return null;
    const rirEst = rirOf(s.rpe);
    if (s.r + rirEst === 1) return { e1rm: s.w, tested: false };
    return { e1rm: s.w * (1 + (s.r + rirEst) / 30), tested: false };
  }
  // Rule 3: no RPE, reps <= 10.
  if (s.r <= 10) {
    const rirEst = s.targetRpe !== undefined ? 10 - s.targetRpe : 0;
    if (s.r + rirEst === 1) return { e1rm: s.w, tested: false };
    return { e1rm: s.w * (1 + (s.r + rirEst) / 30), tested: false };
  }
  // Rule 4: reps > 10 -> no observation (rep-range PRs only).
  return null;
}

/** Best completed set's e1RM across sets (max), plus whether it was tested. */
export function bestObservation(sets: SetLog[]): E1rmObservation | null {
  let best: E1rmObservation | null = null;
  for (const s of sets) {
    if (s.warmup) continue;
    const o = observeSet(s);
    if (o && (!best || o.e1rm > best.e1rm)) best = o;
  }
  return best;
}
