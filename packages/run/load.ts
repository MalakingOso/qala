// Grade-adjusted pace and run load: GAP factor, NGP, IF, rTSS, plus the
// VDOT and Riegel helpers the engine conventions share.
//
// Sources: RESEARCH-running.md sections 3 and 5. Everything is SI (metres,
// seconds, m/s); threshold pace is a speed in m/s. Critical speed (CS) is
// the threshold once three qualifying efforts exist; before that it comes
// from a recent race time via Riegel.

/** Minetti 2002 energy-cost polynomial Cr(i), i = grade as a fraction. */
export function minettiCost(grade: number): number {
  const i = grade;
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 +
    46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Level-running cost Cr(0) = 3.6 (the polynomial intercept). */
export const MINETTI_LEVEL_COST = 3.6;

/** Metabolic cost ratio Cr(grade)/Cr(0). */
export function minettiRatio(grade: number): number {
  return minettiCost(grade) / MINETTI_LEVEL_COST;
}

/**
 * Grade adjustment factor: the Minetti ratio uphill; downhill
 * max(Minetti, 0.88) per Strava's HR-fitted GAP curve; exactly 1.0 on
 * grades steeper than -18%, where the discount returns to level.
 */
export function gapFactor(grade: number): number {
  if (grade < -0.18) return 1.0;
  if (grade < 0) return Math.max(minettiRatio(grade), 0.88);
  return minettiRatio(grade);
}

/** Grade-adjusted speed: the flat speed costing the same effort. */
export function gradeAdjustedSpeed(speedMps: number, grade: number): number {
  if (!(speedMps > 0)) return 0;
  return speedMps * gapFactor(grade);
}

/** Grade-adjusted pace in s/m. */
export function gradeAdjustedPace(paceSecPerM: number, grade: number): number {
  if (!(paceSecPerM > 0)) return Infinity;
  return paceSecPerM / gapFactor(grade);
}

export interface GradeSegment {
  /** Flat-equivalent input: measured segment length in metres. */
  distM: number;
  /** Mean grade over the segment as a fraction (rise/run). */
  grade: number;
}

/** Total grade-adjusted distance: sum of distM * gapFactor(grade). */
export function gapDistanceM(segments: GradeSegment[]): number {
  let total = 0;
  for (const s of segments) {
    if (s.distM > 0) total += s.distM * gapFactor(s.grade);
  }
  return total;
}

/**
 * Normalised graded pace as a speed (m/s): grade-adjusted distance over
 * moving time. This is the distance-weighted mean GAP speed; TrainingPeaks'
 * exact NGP quartic weighting is proprietary, so this documented mean is
 * what both packages/run and the engine use.
 */
export function ngpMps(gapDistM: number, movingSec: number): number {
  if (!(movingSec > 0) || !(gapDistM >= 0)) return 0;
  return gapDistM / movingSec;
}

/** Intensity factor: NGP / threshold (functional threshold / critical speed). */
export function intensityFactor(
  ngpMpsValue: number,
  thresholdMps: number,
): number {
  if (!(thresholdMps > 0) || !(ngpMpsValue >= 0)) return 0;
  return ngpMpsValue / thresholdMps;
}

/** rTSS = hours * IF^2 * 100. One hour at threshold on flat ground is 100. */
export function rtss(
  movingHours: number,
  intensityFactorValue: number,
): number {
  if (!(movingHours >= 0) || !(intensityFactorValue >= 0)) return 0;
  return movingHours * intensityFactorValue * intensityFactorValue * 100;
}

/** Convenience: rTSS straight from a grade-adjusted run. */
export function rtssFromRun(args: {
  gapDistM: number;
  movingSec: number;
  thresholdMps: number;
}): number {
  const ngp = ngpMps(args.gapDistM, args.movingSec);
  const fi = intensityFactor(ngp, args.thresholdMps);
  return rtss(args.movingSec / 3600, fi);
}

/**
 * Daniels VDOT from a GPS effort (valid range 3.5-230 min; outside it the
 * formula extrapolates and the engine does not take an observation).
 * v in m/min: VO2 = -4.60 + 0.182258 v + 0.000104 v^2, divided by the
 * sustainable fraction for the duration.
 */
export function vdot(distanceM: number, seconds: number): number {
  const tMin = seconds / 60;
  const v = distanceM / seconds * 60;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const frac = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) +
    0.2989558 * Math.exp(-0.1932605 * tMin);
  return vo2 / frac;
}

/** Riegel prediction: T2 = T1 * (D2/D1)^1.06. */
export function riegelSeconds(
  knownSec: number,
  knownDistM: number,
  targetDistM: number,
): number {
  return knownSec * (targetDistM / knownDistM) ** 1.06;
}

/**
 * Threshold speed (m/s) from a recent race: Riegel-project to one hour,
 * the fastest pace sustainable ~1 h. Assumption until CS has three efforts.
 */
export function thresholdPaceFromRace(
  raceDistM: number,
  raceSec: number,
): number {
  if (!(raceDistM > 0) || !(raceSec > 0)) return 0;
  // Distance coverable in 3600 s at Riegel-equivalent effort, over 3600 s.
  const d = raceDistM * (3600 / raceSec) ** (1 / 1.06);
  return d / 3600;
}
