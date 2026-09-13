/* Sample day matching DESIGN 7: Sunday, Strength block 2 week 3, Lower A,
 * squat 3x4 at 245 lb, reference 1RM 280, quads rated 4, readiness 72. */

import type {
  EnvelopeCardModel,
  MemoryProposal,
  RestPrescription,
  RunSplit,
  SettingsModel,
  StageState,
  WeekLoadDay,
  WorkoutExercise,
} from "./types.ts";

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
  { day: "S", liftDone: 0, runDone: 0, liftPlanned: 510, runPlanned: 240, today: true, label: "Lower A" },
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
    note: { id: "n1", date: "Sep 6", text: "Knees caved on last rep. Cue: spread the floor.", pinned: true },
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
  changeText: "Same as last set",
};

export const sampleSplits: RunSplit[] = [
  { mile: 1, sec: 542 },
  { mile: 2, sec: 538 },
  { mile: 3, sec: 551 },
];

export const sampleEnvelopes: EnvelopeCardModel[] = [
  {
    id: "e1",
    title: "Squat top set",
    engine: "245 x 4 @ 8",
    coach: "240 x 4 @ 8",
    reason: "Quads still sore (4). Small pullback, same reps.",
    platesPerSide: "45 · 25 · 5",
    accepted: null,
  },
];

export const sampleMemory: MemoryProposal[] = [
  { id: "m1", text: "Left knee aches on deep squats past 240.", source: "check-in Sep 13", date: "Sep 13", accepted: null },
  { id: "m2", text: "Sleeps 6 h on weeknights; worse readiness Fridays.", source: "coach", date: "Sep 12", accepted: null },
];

export const defaultSettings: SettingsModel = {
  units: { weight: "lb", distance: "mi" },
  theme: "light",
  titleFont: "qalaTest",
  defaultBar: 45,
  plates: [
    { weight: 45, pairs: 2 },
    { weight: 35, pairs: 1 },
    { weight: 25, pairs: 1 },
    { weight: 10, pairs: 2 },
    { weight: 5, pairs: 2 },
    { weight: 2.5, pairs: 1 },
  ],
  collarWeight: 0,
  equipment: { foamRoller: true, percussion: true, bike: true, rower: false, treadmill: false },
  warmup: { enabled: true, softTissue: true, preferPercussion: true, minutes: 15 },
  rest: { auto: true, learnFromTaps: true, showNextPlates: true, alert: "vibrate+sound" },
  run: { audioCues: true, autoPause: true, hrStrap: false, offlineMaps: true },
  coach: { status: "Runs on callisto", limits: "weight -10% to +2.5%, sets -2 to +1" },
};
