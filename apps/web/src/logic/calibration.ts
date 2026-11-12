/* Which theta the calibration views show (PLAN 6.2, the deleted TS engine/kalman.ts).
 * theta = k2/k1 starts at the population prior and the filter holds it there
 * until a lift has 20 observations; from then on it is the filter's estimate.
 * So a lift at 20 or more shows its estimate, and a lift under 20 shows the
 * prior, labelled as the starting point it is held at. */

/** Observations a lift needs before theta is free to move. */
export const THETA_FREE_AT = 20;
/** The lifts' theta prior (Peng/Swartz). Runs use 2.0 (Morton k2/k1). */
export const THETA_PRIOR = 4;

export interface ThetaShown {
  value: number;
  source: "estimate" | "prior";
  /** The table cell: "3.6", or "4.0 (prior until 20)". */
  text: string;
}

export function thetaFree(obs: number): boolean {
  return obs >= THETA_FREE_AT;
}

/** The theta to show for a lift's calibration. Under 20 observations the
 * engine holds theta exactly at the prior, so the prior is shown whatever the
 * stored value says. */
export function thetaShown(
  c: { theta: number; obs: number },
  prior = THETA_PRIOR,
): ThetaShown {
  if (thetaFree(c.obs)) {
    return { value: c.theta, source: "estimate", text: c.theta.toFixed(1) };
  }
  return {
    value: prior,
    source: "prior",
    text: `${prior.toFixed(1)} (prior until ${THETA_FREE_AT})`,
  };
}
