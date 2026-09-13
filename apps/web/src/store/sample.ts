/* Sample day matching DESIGN 7: Sunday, Strength block 2 week 3, Lower A,
 * squat 3x4 at 245 lb, reference 1RM 280, quads rated 4, readiness 72. */

import type {
  EnvelopeCardModel,
  LiftStat,
  MemoryProposal,
  MuscleStat,
  RestPrescription,
  RunSplit,
  SessionSummary,
  SettingsModel,
  StageState,
  WeekLoadDay,
  WorkoutExercise,
} from "./types.ts";
import { bumperColorFor } from "../../../../packages/core/plates.ts";

export const sampleStages: StageState[] = [
  { id: "checkin", label: "Check-in", time: "4:30p", status: "done" },
  { id: "warmup", label: "Warm-up", time: "4:40p", status: "done" },
  { id: "lift", label: "Lift", time: "5:00p", status: "now" },
  { id: "recover", label: "Recover", time: "6:00p", status: "later" },
  { id: "run", label: "Run", time: "6:00p", status: "later" },
  { id: "winddown", label: "Wind down", time: "9:30p", status: "later" },
];

export const restDayStages: StageState[] = [
  { id: "checkin", label: "Check-in", time: "8:00a", status: "now" },
  { id: "recover", label: "Recover", time: "—", status: "later" },
  { id: "winddown", label: "Wind down", time: "9:30p", status: "later" },
];

export const sampleWeekLoad: WeekLoadDay[] = [
  { day: "M", liftDone: 420, runDone: 0, liftPlanned: 420, runPlanned: 0 },
  { day: "T", liftDone: 0, runDone: 310, liftPlanned: 0, runPlanned: 310 },
  { day: "W", liftDone: 380, runDone: 0, liftPlanned: 380, runPlanned: 0 },
  { day: "T", liftDone: 0, runDone: 0, liftPlanned: 0, runPlanned: 180 },
  { day: "F", liftDone: 450, runDone: 0, liftPlanned: 450, runPlanned: 0 },
  { day: "S", liftDone: 0, runDone: 290, liftPlanned: 0, runPlanned: 290 },
  {
    day: "S",
    liftDone: 0,
    runDone: 0,
    liftPlanned: 510,
    runPlanned: 240,
    today: true,
    label: "Lower A",
  },
];

export const sampleExercises: WorkoutExercise[] = [
  {
    id: "squat",
    name: "Back Squat",
    targetRpe: 8,
    lastTime: "245 x 4, 4, 4 @ 8.5",
    sets: [
      { w: 245, r: 4, rpe: 8, done: true },
      { w: 245, r: 4, rpe: 9, done: true },
      { w: 245, r: 4, done: false },
    ],
    note: {
      id: "n1",
      date: "Sep 6",
      text: "Knees caved on last rep. Cue: spread the floor.",
      pinned: true,
    },
  },
  {
    id: "rdl",
    name: "Romanian Deadlift",
    targetRpe: 8,
    lastTime: "205 x 8, 8 @ 8",
    sets: [
      { w: 205, r: 8, done: false },
      { w: 205, r: 8, done: false },
    ],
  },
  {
    id: "lunge",
    name: "Walking Lunge",
    targetRpe: 8,
    lastTime: "40 x 10 ea @ 7",
    sets: [{ w: 40, r: 10, done: false }],
  },
  {
    id: "calf",
    name: "Standing Calf Raise",
    targetRpe: 9,
    lastTime: "180 x 12, 12 @ 8",
    sets: [
      { w: 180, r: 12, done: false },
      { w: 180, r: 12, done: false },
    ],
  },
];

export const sampleRest: RestPrescription = {
  seconds: 225,
  base: 180,
  adjustments: [
    { label: "your pace", seconds: -15 },
    { label: "last set RPE 9 vs 8", seconds: 30 },
    { label: "set 4 of squat", seconds: 30 },
  ],
  nextLoad: 245,
  platesNow: [45, 45, 10],
  platesNext: [45, 45, 10],
};

export const sampleSplits: RunSplit[] = [
  { mile: 1, sec: 542 },
  { mile: 2, sec: 538 },
  { mile: 3, sec: 551 },
];

export const sampleEnvelopes: EnvelopeCardModel[] = [
  {
    id: "e1",
    exerciseId: "squat",
    title: "Squat top set",
    engine: "245 x 4 @ 8",
    coach: "240 x 4 @ 8",
    reason: "Quads still sore (4). Small pullback, same reps.",
    platesPerSide: "45 · 25 · 5",
    accepted: null,
  },
];

export const sampleMemory: MemoryProposal[] = [
  {
    id: "m1",
    text: "Left knee aches on deep squats past 240.",
    source: "check-in Sep 13",
    date: "Sep 13",
    accepted: null,
  },
  {
    id: "m2",
    text: "Sleeps 6 h on weeknights; worse readiness Fridays.",
    source: "coach",
    date: "Sep 12",
    accepted: null,
  },
];

function fullHistory(
  base: number,
): { session: number; dailyBest: number; kalman: number }[] {
  return Array.from({ length: 60 }, (_, i) => {
    const n = i + 1;
    const dailyBest = base + n * 0.35 + 2 * Math.sin(n / 5);
    return { session: n, dailyBest, kalman: dailyBest - 1.5 };
  });
}

function residualCurve(n: number, amp: number): number[] {
  return Array.from(
    { length: n },
    (_, i) => amp * Math.sin(i / 3) * Math.exp(-i / 30),
  );
}

export const sampleLifts: LiftStat[] = [
  {
    id: "squat",
    name: "Squat",
    e1rm: 283,
    kalman: 283,
    weekDeltaPct: 4,
    recent: [
      { label: "w1", e1rm: 272 },
      { label: "w2", e1rm: 276 },
      { label: "w3", e1rm: 279, tested: true },
      { label: "now", e1rm: 283 },
    ],
    fullHistory: fullHistory(262),
    nl85: { actual: 27, target: 33 },
    calibration: { p0: 248.1, k1: 0.62, theta: "4.0 (prior)", obs: 34 },
    residuals: residualCurve(34, 4),
  },
  {
    id: "bench",
    name: "Bench",
    e1rm: 245,
    kalman: 243,
    weekDeltaPct: 2,
    recent: [
      { label: "s5", e1rm: 241 },
      { label: "s6", e1rm: 243 },
      { label: "today", e1rm: 245 },
    ],
    fullHistory: fullHistory(224),
    nl85: { actual: 18, target: 24 },
    calibration: { p0: 211.4, k1: 0.55, theta: "4.0 (prior)", obs: 31 },
    residuals: residualCurve(31, 3.2),
  },
  {
    id: "deadlift",
    name: "Deadlift",
    e1rm: 320,
    kalman: 322,
    weekDeltaPct: 3,
    recent: [
      { label: "w2", e1rm: 308 },
      { label: "w3", e1rm: 314, tested: true },
      { label: "now", e1rm: 320 },
    ],
    fullHistory: fullHistory(299),
    nl85: { actual: 12, target: 14 },
    calibration: { p0: 302.7, k1: 0.71, theta: "4.0 (prior)", obs: 22 },
    residuals: residualCurve(22, 4.8),
  },
  {
    id: "press",
    name: "Press",
    e1rm: 155,
    kalman: 154,
    weekDeltaPct: 1,
    recent: [
      { label: "w2", e1rm: 150 },
      { label: "w3", e1rm: 152 },
      { label: "now", e1rm: 155 },
    ],
    fullHistory: fullHistory(134),
    nl85: { actual: 8, target: 10 },
    calibration: { p0: 141.2, k1: 0.48, theta: "4.0 (prior)", obs: 18 },
    residuals: residualCurve(18, 2.6),
  },
];

export const sampleMuscles: MuscleStat[] = [
  {
    muscle: "quads",
    earlier: 8,
    today: 5,
    band: [10, 20],
    weeklyHistory: [11, 13, 12, 14, 13, 13],
    lifting: 4.2,
    running: 1.1,
    readyDay: "Wed",
  },
  {
    muscle: "chest",
    earlier: 12,
    today: 0,
    band: [10, 20],
    weeklyHistory: [10, 11, 13, 12, 12, 12],
    lifting: 1.6,
    running: 0,
    readyDay: "Tue",
  },
  {
    muscle: "back",
    earlier: 14,
    today: 0,
    band: [10, 20],
    weeklyHistory: [12, 13, 14, 14, 15, 14],
    lifting: 2.4,
    running: 0.2,
    readyDay: "Wed",
  },
  {
    muscle: "hamstrings",
    earlier: 4,
    today: 2,
    band: [10, 20],
    weeklyHistory: [5, 6, 5, 6, 6, 6],
    lifting: 1.8,
    running: 0.9,
    readyDay: "Tue",
  },
  {
    muscle: "glutes",
    earlier: 6,
    today: 3,
    band: [10, 20],
    weeklyHistory: [7, 8, 8, 9, 9, 9],
    lifting: 3.1,
    running: 0.6,
    readyDay: "Tue",
  },
  {
    muscle: "calves",
    earlier: 5,
    today: 2,
    band: [10, 20],
    weeklyHistory: [6, 6, 7, 6, 7, 7],
    lifting: 0.9,
    running: 1.4,
    readyDay: "now",
  },
];

/** Shared with the phone Body/Progress pages' inline copies of the same
 * sample week (DESIGN 7.9/7.10); desktop reads it from here so Overview,
 * Body and the muscle drill-down agree with each other. */
export const sampleReadiness = {
  values: [78, 74, 80, 76, 71, 69, 72],
  avg: 76,
  low: 64,
};

export const sampleVdot = [38.5, 39.1, 39.0, 39.8, 40.2, 40.5];

const RUN_T = Array.from({ length: 120 }, (_, i) => i * 15);

export const sampleSessions: SessionSummary[] = [
  {
    id: "sep13-lower-a",
    date: "Sep 13",
    type: "lift",
    label: "Lower A",
    loadLb: 20400,
    sRPE: 8,
    prCount: 1,
    flagged:
      "Squat 245×4 confirms e1RM 283 (+4% this block). Dismiss once you've checked the last rep was clean.",
    exercises: [
      { name: "Back Squat", sets: "245×4, 4, 4 @ 8.5" },
      { name: "Romanian Deadlift", sets: "205×8, 8 @ 8" },
      { name: "Walking Lunge", sets: "40×10 ea @ 7" },
      { name: "Standing Calf Raise", sets: "180×12, 12 @ 8" },
    ],
    notes: "",
  },
  {
    id: "sep12-long-run",
    date: "Sep 12",
    type: "run",
    label: "Long run",
    sRPE: 7,
    prCount: 0,
    run: {
      distanceMi: 7.0,
      splits: sampleSplits,
      pace: RUN_T.map((t) => 545 + 20 * Math.sin(t / 300)),
      hr: RUN_T.map((t) => 138 + 8 * Math.sin(t / 420)),
      elev: RUN_T.map((t) => 300 + 12 * Math.sin(t / 500)),
      rtss: 84,
      sRpeLoad: 49,
      hrStrap: false,
    },
    notes: "",
  },
  {
    id: "sep11-upper-b",
    date: "Sep 11",
    type: "lift",
    label: "Upper B",
    loadLb: 14100,
    sRPE: 7,
    prCount: 0,
    exercises: [
      { name: "Press", sets: "135×5, 5, 5 @ 7" },
      { name: "Bench variation", sets: "205×6, 6, 6 @ 7" },
    ],
    notes: "",
  },
  {
    id: "sep9-lower-b",
    date: "Sep 9",
    type: "lift",
    label: "Lower B",
    loadLb: 18900,
    sRPE: 8,
    prCount: 0,
    exercises: [
      { name: "Deadlift", sets: "315×3, 3, 3 @ 8" },
      { name: "Front Squat", sets: "185×5, 5, 5 @ 7" },
    ],
    notes: "",
  },
  {
    id: "sep8-easy-run",
    date: "Sep 8",
    type: "run",
    label: "Easy run",
    sRPE: 4,
    prCount: 0,
    run: {
      distanceMi: 4.0,
      splits: [
        { mile: 1, sec: 612 },
        { mile: 2, sec: 605 },
        { mile: 3, sec: 609 },
        { mile: 4, sec: 598 },
      ],
      pace: RUN_T.slice(0, 60).map((t) => 605 + 10 * Math.sin(t / 260)),
      hr: RUN_T.slice(0, 60).map((t) => 128 + 6 * Math.sin(t / 400)),
      elev: RUN_T.slice(0, 60).map((t) => 280 + 6 * Math.sin(t / 480)),
      rtss: 41,
      sRpeLoad: 22,
      hrStrap: false,
    },
    notes: "",
  },
  {
    id: "sep6-upper-a",
    date: "Sep 6",
    type: "lift",
    label: "Upper A",
    loadLb: 15200,
    sRPE: 7,
    prCount: 0,
    exercises: [
      { name: "Bench", sets: "225×5, 5, 5, 5 @ 8" },
      { name: "Row", sets: "135×8, 8, 8 @ 7" },
      { name: "Overhead Press", sets: "95×8, 8, 8 @ 7" },
      { name: "Curl", sets: "65×12, 12 @ 7" },
    ],
    notes: "Knees caved on last squat rep last time; cue spread the floor.",
  },
];

export const defaultSettings: SettingsModel = {
  units: { weight: "lb", distance: "mi" },
  theme: "light",
  titleFont: "qalaTest",
  defaultBar: 45,
  // Deliberately limited (owner's real inventory is still to enter, PLAN
  // 6.8): a 45 lb bar with only two 45s means 315 lb can't be 45+45+45 per
  // side, so the plate math has to actually reach for 45+45+35+10.
  plates: [
    { weight: 45, pairs: 2, color: bumperColorFor(45, "lb") },
    { weight: 35, pairs: 1, color: bumperColorFor(35, "lb") },
    { weight: 25, pairs: 1, color: bumperColorFor(25, "lb") },
    { weight: 10, pairs: 2, color: bumperColorFor(10, "lb") },
    { weight: 5, pairs: 2, color: bumperColorFor(5, "lb") },
    { weight: 2.5, pairs: 1, color: bumperColorFor(2.5, "lb") },
  ],
  collarWeight: 0,
  equipment: {
    foamRoller: true,
    percussion: true,
    bike: true,
    rower: false,
    treadmill: false,
  },
  warmup: {
    enabled: true,
    softTissue: true,
    preferPercussion: true,
    minutes: 15,
  },
  rest: {
    auto: true,
    learnFromTaps: true,
    showNextPlates: true,
    alert: "vibrate+sound",
  },
  run: { audioCues: true, autoPause: true, hrStrap: false, offlineMaps: true },
  coach: {
    status: "Runs on callisto",
    limits: "weight -10% to +2.5%, sets -2 to +1",
  },
};
