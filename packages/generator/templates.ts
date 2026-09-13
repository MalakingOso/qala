// Loading templates (PLAN.md 12, RESEARCH-design-and-programming.md B2-B4).
// Linear and DUP tables are % of the block reference 1RM (fixed for the block
// per PLAN.md 6.3, so zone counts do not drift). Hypertrophy loads come from
// inverse Epley on the effective max, within 1.5 pts of the NSCA chart.
// Meet taper offsets follow Pritchard 2016 / Travis 2020-2021: step taper,
// volume -40 to -50%, intensity held >= 85% until the last heavy session.

export interface LinearWeek {
  week: number;
  sets: number;
  reps: number;
  pct: number;
  nl85: number;
  deload?: boolean;
}

// PLAN.md 12 linear strength template, squat and bench.
export const LINEAR_TABLE: LinearWeek[] = [
  { week: 1, sets: 4, reps: 5, pct: 80, nl85: 0 },
  { week: 2, sets: 4, reps: 4, pct: 83, nl85: 0 },
  { week: 3, sets: 5, reps: 3, pct: 86, nl85: 15 },
  { week: 4, sets: 5, reps: 2, pct: 89, nl85: 10 },
  { week: 5, sets: 5, reps: 1, pct: 92, nl85: 6, deload: false },
  { week: 6, sets: 3, reps: 3, pct: 75, nl85: 0, deload: true },
];

// Week 5 opens with a single at 95% before the 5x1 at 92%.
export const LINEAR_WEEK5_OPENER_PCT = 95;

export interface LinearDeadlift {
  sets: number;
  reps: number;
  pct: number;
}

// B3.1 deadlift variant (lower set count than squat/bench).
export function linearDeadlift(week: number): LinearDeadlift {
  switch (week) {
    case 1:
      return { sets: 3, reps: 5, pct: 80 };
    case 2:
      return { sets: 3, reps: 4, pct: 83 };
    case 3:
      return { sets: 3, reps: 3, pct: 86 };
    case 4:
      return { sets: 3, reps: 2, pct: 89 };
    case 5:
      return { sets: 2, reps: 1, pct: 92 };
    default:
      return { sets: 2, reps: 3, pct: 70 };
  }
}

export interface DupDay {
  sets: number;
  reps: number;
  pct: number;
}

export interface DupWeek {
  week: number;
  hypertrophy: DupDay;
  power: DupDay;
  strength: DupDay;
  nl85: number;
  deload?: boolean;
}

// PLAN.md 12 DUP template per main lift, HPS day order (Zourdos 2016). The
// strength day is RPE-capped, a Qala change from Zourdos's max-reps protocol.
export const DUP_TABLE: DupWeek[] = [
  {
    week: 1,
    hypertrophy: { sets: 4, reps: 8, pct: 72.5 },
    power: { sets: 5, reps: 2, pct: 80 },
    strength: { sets: 3, reps: 5, pct: 82 },
    nl85: 0,
  },
  {
    week: 2,
    hypertrophy: { sets: 4, reps: 8, pct: 75 },
    power: { sets: 5, reps: 2, pct: 82 },
    strength: { sets: 3, reps: 4, pct: 85 },
    nl85: 12,
  },
  {
    week: 3,
    hypertrophy: { sets: 4, reps: 7, pct: 77 },
    power: { sets: 5, reps: 1, pct: 85 },
    strength: { sets: 3, reps: 3, pct: 88 },
    nl85: 14,
  },
  {
    week: 4,
    hypertrophy: { sets: 3, reps: 6, pct: 79 },
    power: { sets: 4, reps: 1, pct: 88 },
    strength: { sets: 3, reps: 2, pct: 91 },
    nl85: 10,
  },
  {
    week: 5,
    hypertrophy: { sets: 3, reps: 6, pct: 80 },
    power: { sets: 3, reps: 1, pct: 90 },
    strength: { sets: 2, reps: 2, pct: 87 },
    nl85: 8,
  },
];

// Week 5 strength day opens with a single at 95% before the 2x2 at 87%.
export const DUP_WEEK5_OPENER_PCT = 95;

export const DUP_DELOAD: DupWeek = {
  week: 6,
  hypertrophy: { sets: 2, reps: 8, pct: 65 },
  power: { sets: 3, reps: 1, pct: 75 },
  strength: { sets: 2, reps: 3, pct: 80 },
  nl85: 0,
  deload: true,
};

// Alternative DUP (5s/3s/1s) for users wanting heavier weekly exposure.
// Day A 4x5 @ 80%, day B 5x3 @ 85%, day C 6x1 @ 90%, +2% per week; week 4 day C
// is 3 singles at 95%.
export interface AltDupDay {
  day: "A" | "B" | "C";
  sets: number;
  reps: number;
  basePct: number;
}

export const ALT_DUP_DAYS: AltDupDay[] = [
  { day: "A", sets: 4, reps: 5, basePct: 80 },
  { day: "B", sets: 5, reps: 3, basePct: 85 },
  { day: "C", sets: 6, reps: 1, basePct: 90 },
];

export function altDupWeek(week: number): Array<AltDupDay & { pct: number }> {
  const bump = 2 * (week - 1);
  return ALT_DUP_DAYS.map((d) => {
    if (d.day === "C" && week === 4) {
      return { ...d, sets: 3, reps: 1, pct: 95 };
    }
    return { ...d, pct: d.basePct + bump };
  });
}

export interface HyperWeek {
  week: number;
  fracDelta: number; // +2 ramp, capped (PLAN.md 6.3)
  rirCompound: [number, number];
  rirIsolation: [number, number];
  compoundReps: [number, number];
  isolationReps: [number, number];
  loadDeltaPct: number;
  deload?: boolean;
}

// PLAN.md 12 hypertrophy template (owner 8-15 band: compounds 8-12,
// isolation 12-15; loads from inverse Epley, B2).
export const HYPERTROPHY_TABLE: HyperWeek[] = [
  {
    week: 1,
    fracDelta: 0,
    rirCompound: [3, 3],
    rirIsolation: [3, 3],
    compoundReps: [8, 12],
    isolationReps: [12, 15],
    loadDeltaPct: 0,
  },
  {
    week: 2,
    fracDelta: 2,
    rirCompound: [2, 3],
    rirIsolation: [2, 2],
    compoundReps: [8, 12],
    isolationReps: [12, 15],
    loadDeltaPct: 0,
  },
  {
    week: 3,
    fracDelta: 4,
    rirCompound: [2, 2],
    rirIsolation: [1, 2],
    compoundReps: [8, 12],
    isolationReps: [12, 15],
    loadDeltaPct: 0,
  },
  {
    week: 4,
    fracDelta: 6,
    rirCompound: [1, 2],
    rirIsolation: [1, 1],
    compoundReps: [8, 12],
    isolationReps: [12, 15],
    loadDeltaPct: 0,
  },
  {
    week: 5,
    fracDelta: 8,
    rirCompound: [1, 1],
    rirIsolation: [0, 1],
    compoundReps: [8, 12],
    isolationReps: [12, 15],
    loadDeltaPct: 0,
  },
  {
    week: 6,
    fracDelta: 0,
    rirCompound: [4, 4],
    rirIsolation: [4, 4],
    compoundReps: [8, 12],
    isolationReps: [12, 15],
    loadDeltaPct: -10,
    deload: true,
  },
];

// Inverse Epley on the effective max: pct = 100 / (1 + (reps + RIR) / 30).
export function pctForRepsRir(reps: number, rir: number): number {
  return 100 / (1 + (reps + rir) / 30);
}

export function rpeForRir(rir: number): number {
  return 10 - rir;
}

export interface TaperLift {
  lastHeavyDaysOut: [number, number];
  lastSessionDaysOut: [number, number];
  finalScheme: string;
  finalPct: [number, number];
  openerPct: [number, number];
}

// Meet-prep taper (Pritchard 2016, Travis 2020/2021): one 7-10 day step, volume
// cut 40-50%, intensity held at 85%+ until the last heavy session, then 2-3
// days of full rest. Typical final schemes: squat 3x2, bench 3x3, deadlift 3x1.
export const TAPER: Record<"deadlift" | "squat" | "bench", TaperLift> = {
  deadlift: {
    lastHeavyDaysOut: [8, 10],
    lastSessionDaysOut: [6, 6],
    finalScheme: "3x1",
    finalPct: [70, 75],
    openerPct: [90, 92.5],
  },
  squat: {
    lastHeavyDaysOut: [7, 9],
    lastSessionDaysOut: [4, 5],
    finalScheme: "3x2",
    finalPct: [75, 80],
    openerPct: [90, 92.5],
  },
  bench: {
    lastHeavyDaysOut: [5, 7],
    lastSessionDaysOut: [3, 4],
    finalScheme: "3x3",
    finalPct: [75, 80],
    openerPct: [90, 92.5],
  },
};

export const TAPER_VOLUME_CUT: [number, number] = [0.4, 0.5];
export const TAPER_INTENSITY_FLOOR = 85;
export const TAPER_FULL_REST_DAYS: [number, number] = [2, 3];

export interface TaperSession {
  lift: "deadlift" | "squat" | "bench";
  kind: "lastHeavy" | "lastSession";
  dateISO: string;
  daysOut: number;
}

function addDays(dateISO: string, delta: number): string {
  const d = new Date(dateISO + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Deterministic taper dates from a meet date, using the midpoint of each
// offset range (rounded toward the meet for last-heavy, away for rest-safe
// last sessions is not needed; midpoint keeps every date inside its range).
export function taperSchedule(meetDateISO: string): TaperSession[] {
  const mid = (r: [number, number]) => Math.round((r[0] + r[1]) / 2);
  const lifts: Array<"deadlift" | "squat" | "bench"> = ["deadlift", "squat", "bench"];
  const out: TaperSession[] = [];
  for (const lift of lifts) {
    const heavy = mid(TAPER[lift].lastHeavyDaysOut);
    const last = mid(TAPER[lift].lastSessionDaysOut);
    out.push({
      lift,
      kind: "lastHeavy",
      dateISO: addDays(meetDateISO, -heavy),
      daysOut: heavy,
    });
    out.push({
      lift,
      kind: "lastSession",
      dateISO: addDays(meetDateISO, -last),
      daysOut: last,
    });
  }
  return out;
}

// Round a prescribed weight to the user's barbell plate step (default 5 lb,
// PLAN.md 6.3 ACSM increments; same inventory rule as core plates).
export function roundToPlates(weight: number, step = 5): number {
  return Math.round(weight / step) * step;
}

export function weightForPct(referenceRm: number, pct: number, step = 5): number {
  return roundToPlates((referenceRm * pct) / 100, step);
}
