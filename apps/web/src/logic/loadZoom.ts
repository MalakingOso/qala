/* Load zoom (DESIGN 6.3, 6.5, DECISIONS U27): one workouts chart that zooms
 * Day, Week, Month and Block, drawn in the U25 look. Everything here is pure:
 * the model is the block's 42 days, a camera is {z, anchor, offset}, and
 * `frame` turns the two into pieces, labels and hit slots in pixels. The
 * component only draws and moves the camera.
 *
 * A day is up to two pieces, lift under run (U25), and a piece keeps its key
 * from Day to Block. z runs 0 Day, 1 Week, 2 Month, 3 Block:
 *   0 to 1: a day's lift and run pieces slide together and the run rises onto
 *           the lift.
 *   1 to 2: the window widens from 7 to 28 days (four whole weeks), nothing
 *           changes height.
 *   2 to 3: the window widens to the whole block (42 days). Each week's lift pieces rise into a
 *           stack, its run pieces into a stack above all of its lift, the
 *           y-scale grows from the largest day to the largest week, the stacks
 *           slide into the week's column and crossfade into the week's two
 *           pieces: its lift added up under its run added up. */

import type { StageState, WeekLoad, WeekLoadDay } from "../store/types.ts";
import { type DayTime, dayTime, weekSummary } from "./weekRibbon.ts";
import { weekTotals } from "./weeklyLoad.ts";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const DAYS_PER_WEEK = 7;
export type Level = 0 | 1 | 2 | 3;
export const LEVEL_LABELS = ["Day", "Week", "Month", "Block"] as const;
export const LEVEL_NAMES = ["Day", "Week", "Month", "Block"] as const;

/** How thick a bar may be at each level: thick where a slot is wide (a single
 * day, a whole week of the block), slimmer where many days share the chart. */
export const LEVEL_BAR_MAX = [48, 28, 18, 48] as const;
/** The thickest any level allows. */
export const MAX_BAR = 48;
export const MIN_BAR = 3;
export const BAR_GAP = 6;
export const REST_H = 4;
/** Weeks other than the one in focus go quiet at the Month level (U25). */
export const QUIET = 0.55;
/** Where in a transition the stacked pieces crossfade into the week's pieces. */
const CROSSFADE_FROM = 0.9;
/** Day level: how far apart a day's lift and run pieces sit, in pixels. */
export const SESSION_GAP = 104;
/** A lift-run join bulges by this share of the bar's width, at most
 * JOINT_MAX px: a little more curve than flat. */
const JOINT_SHARE = 0.14;
const JOINT_MAX = 5;

export const PINCH_PER_LEVEL = 1.8;
export const TWEEN_MS_PER_LEVEL = 380;
export const TWEEN_MS_MAX = 900;
export const SETTLE_MS = 240;

/* ---------- Day views (moved from WeeklyLoad) ---------- */

export type DayKind = "lift" | "run" | "both" | "rest";
export type DayState = "done" | "partial" | "today" | "later" | "rest";

export interface DayView {
  index: number;
  name: string;
  letter: string;
  kind: DayKind;
  state: DayState;
  done: number;
  planned: number;
  size: number;
  session: string;
  today: boolean;
  liftDone: number;
  runDone: number;
  liftPlanned: number;
  runPlanned: number;
}

export function n(v: number) {
  return v.toLocaleString("en-US");
}

export function describe(days: WeekLoadDay[]): DayView[] {
  return days.map((d, i) => {
    const done = d.liftDone + d.runDone;
    const planned = d.liftPlanned + d.runPlanned;
    const lifts = d.liftPlanned + d.liftDone > 0;
    const runs = d.runPlanned + d.runDone > 0;
    const kind: DayKind = lifts && runs
      ? "both"
      : lifts
      ? "lift"
      : runs
      ? "run"
      : "rest";
    const size = Math.max(done, planned);
    const state: DayState = kind === "rest"
      ? "rest"
      : d.today
      ? "today"
      : done > 0 && done >= planned
      ? "done"
      : done > 0
      ? "partial"
      : "later";
    const session = d.label ??
      (kind === "both"
        ? "Lift + run"
        : kind === "lift"
        ? "Lift"
        : kind === "run"
        ? "Run"
        : "Rest");
    return {
      index: i,
      name: days.length === 7 ? DAY_NAMES[i] : d.day,
      letter: d.day,
      kind,
      state,
      done,
      planned,
      size,
      session,
      today: d.today === true,
      liftDone: d.liftDone,
      runDone: d.runDone,
      liftPlanned: d.liftPlanned,
      runPlanned: d.runPlanned,
    };
  });
}

/** "420 done", "750 planned" or "300 of 750 done". The lift/run split lives
 * in the table view. */
export function captionNums(v: { done: number; planned: number }) {
  if (v.done === 0) return `${n(v.planned)} planned`;
  if (v.done >= v.planned) return `${n(v.done)} done`;
  return `${n(v.done)} of ${n(v.planned)} done`;
}

export function dayLabel(v: DayView) {
  const when = v.today ? ", today" : "";
  if (v.state === "rest") return `${v.name}${when}: rest`;
  return `${v.name}${when}, ${v.session}: ${n(v.done)} done of ${
    n(v.planned)
  } planned`;
}

/* ---------- The block ---------- */

export interface Session {
  kind: "lift" | "run";
  name: string;
  planned: number;
  done: number;
  size: number;
  state: DayState;
}

export interface BlockDay extends DayView {
  /** Day index in the block, 0 to 41. */
  abs: number;
  /** Week index in the block, 0 to 5. */
  week: number;
  time: DayTime;
  sessions: Session[];
  /** Lift and run load of the day, each the larger of done and planned. The
   * day's `size` is their sum: the pieces stack. */
  liftSize: number;
  runSize: number;
  /** Lift (run) load of the earlier days of this week, for the Block stack. */
  liftBefore: number;
  runBefore: number;
}

export interface BlockWeek {
  index: number;
  id: string;
  name: string;
  range: string;
  relation: WeekLoad["relation"];
  deload: boolean;
  days: BlockDay[];
  done: number;
  planned: number;
  /** The days' sizes added up: the Block column's height. */
  size: number;
  /** Lift and run added up separately: the Block column's two pieces. */
  liftSize: number;
  runSize: number;
  liftDone: number;
  runDone: number;
  state: DayState;
  summary: string;
}

export interface BlockModel {
  weeks: BlockWeek[];
  days: BlockDay[];
  /** Today's day index, or -1. */
  today: number;
  maxDay: number;
  maxWeek: number;
}

function sessionsOf(d: WeekLoadDay, today: boolean): Session[] {
  const out: Session[] = [];
  const both = d.liftPlanned + d.liftDone > 0 && d.runPlanned + d.runDone > 0;
  const parts: [Session["kind"], number, number][] = [
    ["lift", d.liftPlanned, d.liftDone],
    ["run", d.runPlanned, d.runDone],
  ];
  for (const [kind, planned, done] of parts) {
    if (planned + done <= 0) continue;
    const name = kind === "lift"
      ? (d.label ?? "").replace(/\s*\+\s*run$/i, "").trim() || "Lift"
      : d.runLabel ?? (both ? "Run" : d.label ?? "Run");
    const state: DayState = done > 0 && done >= planned
      ? "done"
      : today
      ? "today"
      : done > 0
      ? "partial"
      : "later";
    out.push({
      kind,
      name,
      planned,
      done,
      size: Math.max(done, planned),
      state,
    });
  }
  return out;
}

/** Flatten the loaded weeks into the block's days. */
export function blockModel(weeks: WeekLoad[]): BlockModel {
  const days: BlockDay[] = [];
  let flagged = -1;
  const out: BlockWeek[] = weeks.map((week, wi) => {
    const views = describe(week.days);
    let liftBefore = 0;
    let runBefore = 0;
    let liftDone = 0;
    let runDone = 0;
    const rows: BlockDay[] = views.map((v, di) => {
      const abs = wi * DAYS_PER_WEEK + di;
      if (v.today && flagged < 0) flagged = abs;
      const liftSize = Math.max(v.liftDone, v.liftPlanned);
      const runSize = Math.max(v.runDone, v.runPlanned);
      const row: BlockDay = {
        ...v,
        size: liftSize + runSize,
        abs,
        week: wi,
        time: dayTime(week, di),
        sessions: sessionsOf(week.days[di], v.today),
        liftSize,
        runSize,
        liftBefore,
        runBefore,
      };
      liftBefore += liftSize;
      runBefore += runSize;
      liftDone += v.liftDone;
      runDone += v.runDone;
      days.push(row);
      return row;
    });
    const t = weekTotals(week.days);
    const size = liftBefore + runBefore;
    const state: DayState = size === 0
      ? "rest"
      : week.relation === "current"
      ? "today"
      : week.relation === "future"
      ? "later"
      : t.done >= t.planned && t.done > 0
      ? "done"
      : t.done > 0
      ? "partial"
      : "later";
    return {
      index: wi,
      id: week.id,
      name: week.name,
      range: week.range,
      relation: week.relation,
      deload: week.deload === true,
      days: rows,
      done: t.done,
      planned: t.planned,
      size,
      liftSize: liftBefore,
      runSize: runBefore,
      liftDone,
      runDone,
      state,
      summary: weekSummary(week),
    };
  });
  return {
    weeks: out,
    days,
    today: flagged,
    maxDay: Math.max(1, ...days.map((d) => d.size)),
    maxWeek: Math.max(1, ...out.map((w) => w.size)),
  };
}

/** Today's done state comes from the timeline rail, not the series (phone).
 * A stage that is done means its session's planned load is done; a stage the
 * day does not have means no such session today, so a rest day (no lift and
 * no run stage) has no load at all. */
export function withRail(weeks: WeekLoad[], stages: StageState[]): WeekLoad[] {
  const lift = stages.find((s) => s.id === "lift");
  const run = stages.find((s) => s.id === "run");
  return weeks.map((week) => {
    if (!week.days.some((d) => d.today)) return week;
    return {
      ...week,
      days: week.days.map((d) => {
        if (!d.today) return d;
        const liftPlanned = lift ? d.liftPlanned : 0;
        const runPlanned = run ? d.runPlanned : 0;
        const rest = liftPlanned + runPlanned === 0;
        return {
          day: d.day,
          today: true,
          liftPlanned,
          runPlanned,
          liftDone: lift && lift.status === "done" ? liftPlanned : 0,
          runDone: run && run.status === "done" ? runPlanned : 0,
          label: rest ? undefined : d.label,
          runLabel: rest ? undefined : d.runLabel,
        };
      }),
    };
  });
}

/* ---------- Camera ---------- */

export interface Camera {
  /** Continuous level, 0 Day to 3 Block. */
  z: number;
  /** The day in focus, a day index into the block. */
  anchor: number;
  /** Days added to the window's centre: a pan in flight (see `centerShift`). */
  offset?: number;
}

export interface Box {
  width: number;
  /** The plot's height, without the ruler and label gutters. */
  height: number;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** 0 at or below `a`, 1 at or above `b`. */
function ramp(v: number, a: number, b: number) {
  return clamp((v - a) / (b - a), 0, 1);
}

/** Closely follows the `--ease` token, cubic-bezier(0.25, 1, 0.5, 1). */
export function easeOutQuart(t: number) {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u * u;
}

export function snapLevel(z: number): Level {
  return clamp(Math.round(z), 0, 3) as Level;
}

/** Fingers spreading (ratio > 1) zoom in, so z falls. */
export function zFromPinch(z0: number, ratio: number) {
  if (!(ratio > 0)) return clamp(z0, 0, 3);
  return clamp(z0 - Math.log(ratio) / Math.log(PINCH_PER_LEVEL), 0, 3);
}

/** Ease time for a level change: about 380 ms a level, 900 at most. */
export function tweenMs(from: number, to: number) {
  return Math.min(
    TWEEN_MS_MAX,
    Math.round(TWEEN_MS_PER_LEVEL * Math.abs(to - from)),
  );
}

/** Days a sideways swipe moves at a level. Block is fixed. */
export function panStep(level: number) {
  return level < 0.5 ? 1 : level > 2.5 ? 0 : DAYS_PER_WEEK;
}

export function weekOf(abs: number) {
  return Math.floor(abs / DAYS_PER_WEEK);
}

function weekStart(abs: number) {
  return weekOf(abs) * DAYS_PER_WEEK;
}

function clampDay(model: BlockModel, abs: number) {
  return clamp(Math.round(abs), 0, Math.max(0, model.days.length - 1));
}

/** The anchor `dir` steps on at `level`, clamped to the loaded days. */
export function panAnchor(
  model: BlockModel,
  anchor: number,
  level: number,
  dir: number,
) {
  const step = panStep(level);
  if (step === 0 || dir === 0) return clampDay(model, anchor);
  const next = anchor + (dir > 0 ? step : -step);
  // A week step that would run off the block stays inside its own week.
  return clampDay(model, next) === next ? next : clampDay(model, anchor);
}

/** The day a week inspects first: today if it is in the week, else the last
 * day of a past week and the first of one still to come. */
export function inspectDay(model: BlockModel, week: number) {
  const w = model.weeks[clamp(week, 0, model.weeks.length - 1)];
  if (!w) return 0;
  const today = w.days.findIndex((d) => d.today);
  const i = today >= 0 ? today : w.relation === "past" ? w.days.length - 1 : 0;
  return w.days[i]?.abs ?? 0;
}

export function defaultAnchor(model: BlockModel) {
  return model.today >= 0 ? model.today : 0;
}

/** Keyboard: the inspected day one step on. A day at Day, Week and Month; a
 * whole week at Block. */
export function stepInspect(
  model: BlockModel,
  level: number,
  abs: number,
  dir: number,
) {
  const by = level > 2.5 ? DAYS_PER_WEEK : 1;
  const next = clampDay(model, abs + (dir > 0 ? by : -by));
  return level > 2.5 ? inspectDay(model, weekOf(next)) : next;
}

/** The anchor after inspecting `abs`: the window follows when the day leaves
 * the visible week. */
export function anchorFor(
  model: BlockModel,
  level: number,
  anchor: number,
  abs: number,
) {
  if (level < 0.5 || level > 2.5) return clampDay(model, abs);
  return weekOf(abs) === weekOf(anchor) ? anchor : clampDay(model, abs);
}

/** The window's width in days at each level: 1, 7, 28 and the whole block. */
function levelDays(count: number) {
  return [1, Math.min(7, count), Math.min(28, count), count];
}

/** Window width in days, interpolated geometrically so a pinch zooms at an
 * even rate. */
export function windowDays(z: number, count: number) {
  const ld = levelDays(Math.max(1, count));
  const zc = clamp(z, 0, 3);
  const k = Math.min(2, Math.floor(zc));
  const f = zc - k;
  if (f <= 0) return ld[k];
  if (f >= 1) return ld[k + 1];
  return Math.exp(lerp(Math.log(ld[k]), Math.log(ld[k + 1]), f));
}

function levelCenter(level: number, anchor: number, count: number) {
  if (level === 0) return anchor + 0.5;
  if (level === 3) return count / 2;
  // Week: the focus week. Month: four whole weeks, the one before the focus
  // week, the focus week and the two after it.
  if (level === 1) return weekStart(anchor) + DAYS_PER_WEEK / 2;
  return weekStart(anchor) + DAYS_PER_WEEK;
}

/** Where the window is centred, in days, at a camera that is not panning. */
export function cameraCenter(count: number, z: number, anchor: number) {
  const zc = clamp(z, 0, 3);
  const k = Math.min(2, Math.floor(zc));
  return lerp(
    levelCenter(k, anchor, count),
    levelCenter(k + 1, anchor, count),
    zc - k,
  );
}

/** The offset that keeps the picture still when the anchor changes, to ease
 * back to 0: add it to the offset in flight. */
export function centerShift(
  count: number,
  z: number,
  from: number,
  to: number,
) {
  return cameraCenter(count, z, from) - cameraCenter(count, z, to);
}

/** `?z=1.5` pins the camera for screenshots. Null when absent or not a number. */
export function parseZ(search: string): number | null {
  const raw = new URLSearchParams(search).get("z");
  if (raw === null || raw.trim() === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? clamp(v, 0, 3) : null;
}

/* ---------- Frame ---------- */

export type PieceKind = "lift" | "run" | "rest";

/** One piece of a day or week column, in pixels (U25): lift (teal) or run
 * (steel blue) with its planned tint and the part done filled from the
 * baseline, or the dash of a rest day. */
export interface Bar {
  key: string;
  layer: "day" | "week";
  kind: PieceKind;
  /** Day index (day layer) or week index (week layer). */
  slot: number;
  week: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height of the filled part, from the baseline up. 0 for a week to come. */
  fillH: number;
  /** A week still to come is a plan, hatched with nothing filled (U25). */
  future: boolean;
  /** 0 to 1: how much of the top hairline and rounded corners shows. Falls to
   * 0 as another piece covers the top. */
  cap: number;
  /** Px: how far the join to the neighbouring piece bulges. The lift's top
   * domes up into the run, whose bottom hollows to match, so a day's two
   * pieces meet along one gentle curve instead of a flat line. 0 is flat. */
  joint: number;
  opacity: number;
}

export type LabelRow = "ruler" | "text";

export interface Label {
  key: string;
  row: LabelRow;
  /** Centre for text, left edge for the ruler. */
  x: number;
  opacity: number;
  text: string;
  /** The week's dates, after its name in the ruler. */
  sub: string;
  today: boolean;
  /** Today's letter is reversed out of an ember square (U25). */
  knockout: boolean;
  muted: boolean;
  /** A workout's name under its bar; it leads the row (bigger and bolder than
   * the day letters). */
  session: boolean;
}

export interface Divider {
  key: string;
  x: number;
  opacity: number;
}

/** A slot the pointer can land on. `day` is the day it inspects. */
export interface Hit {
  key: string;
  x: number;
  w: number;
  /** The slot's highest piece, for anchoring a tooltip. */
  top: number;
  day: number;
  week: number;
}

/** Where today's chip hangs: above its column, hidden when its week is not
 * the one in focus. */
export interface TodayMark {
  x: number;
  top: number;
  opacity: number;
  text: string;
}

export interface Frame {
  bars: Bar[];
  labels: Label[];
  dividers: Divider[];
  hits: Hit[];
  today: TodayMark | null;
  /** The first visible day and how many days are in view. */
  window: { start: number; days: number };
  /** The y-scale's top, in load. */
  yMax: number;
}

/** The join's bulge for a bar this wide over a run piece this tall. */
function jointFor(width: number, runH: number) {
  return Math.max(0, Math.min(JOINT_MAX, width * JOINT_SHARE, runH / 2));
}

/** Bar thickness for a slot width: the slot less a gap, at most `max`. */
export function barWidth(slot: number, max = MAX_BAR) {
  return clamp(slot - BAR_GAP, MIN_BAR, max);
}

/** The thickest a bar may be at a continuous level. */
export function barMax(z: number) {
  const zc = clamp(z, 0, 3);
  const k = Math.min(2, Math.floor(zc));
  return lerp(LEVEL_BAR_MAX[k], LEVEL_BAR_MAX[k + 1], zc - k);
}

const NO_LABEL = {
  sub: "",
  today: false,
  knockout: false,
  muted: false,
  session: false,
};

export function frame(model: BlockModel, cam: Camera, box: Box): Frame {
  const count = model.days.length;
  const out: Frame = {
    bars: [],
    labels: [],
    dividers: [],
    hits: [],
    today: null,
    window: { start: 0, days: 1 },
    yMax: 1,
  };
  if (count === 0) return out;

  const z = clamp(cam.z, 0, 3);
  const anchor = clampDay(model, cam.anchor);
  const win = windowDays(z, count);
  const center = cameraCenter(count, z, anchor) + (cam.offset ?? 0);
  const start = clamp(center - win / 2, 0, Math.max(0, count - win));
  const ppd = box.width / win;
  const mapX = (u: number) => (u - start) * ppd;
  // A column's pieces reach half the session gap and half a bar from its
  // centre.
  const reach = (MAX_BAR + SESSION_GAP) / 2;
  const onScreen = (cx: number) => cx > -reach && cx < box.width + reach;

  // Stacking is two moves so pieces never overlap in flight: they rise to
  // their place in the stack beside each other (the y-scale grows with them,
  // so the stack always fits), then slide together over it. s runs 2 to 3 for
  // days into weeks; z runs 0 to 1 for a day's lift and run into the day.
  const s = clamp(z - 2, 0, 1);
  const rise = ramp(s, 0, 0.5);
  const slide = ramp(s, 0.45, 0.9);
  const sessionRise = ramp(z, 0, 0.6);
  const sessionSlide = ramp(z, 0.35, 1);
  const yMax = lerp(model.maxDay, model.maxWeek, rise);
  const ppl = box.height / yMax;
  const slotBar = barWidth(ppd, barMax(z));
  const weekBar = barWidth(box.width / model.weeks.length);
  const dayBar = lerp(slotBar, weekBar, slide);
  out.window = { start, days: win };
  out.yMax = yMax;

  // The focused week at full strength, the others quiet at Month (U25).
  const focusWeek = weekOf(anchor) + (cam.offset ?? 0) / DAYS_PER_WEEK;
  const quietAmt = z <= 2 ? ramp(z, 1, 2) : 1 - s;
  const weekOpacity = (w: number) =>
    1 - quietAmt * (1 - QUIET) * (1 - clamp(1 - Math.abs(w - focusWeek), 0, 1));

  const weekIn = ramp(s, CROSSFADE_FROM, 1);
  const dayIn = 1 - weekIn;
  const sessionLabels = 1 - ramp(z, 0, 0.5);
  const dayLabels = ramp(z, 0.5, 1) * (1 - ramp(s, 0, 0.4));
  const letterFit = ramp(ppd, 7, 10);
  const gap = Math.min(SESSION_GAP, ppd * 0.6) * (1 - sessionSlide);

  // The piece that tops a week's column when the days stack: the last run, or
  // the last lift in a week with no run.
  const topOfWeek = model.weeks.map((w) => {
    const last = (key: "runSize" | "liftSize") =>
      w.days.reduce((at, d) => d[key] > 0 ? d.abs : at, -1);
    return w.runSize > 0
      ? { kind: "run" as const, abs: last("runSize") }
      : { kind: "lift" as const, abs: last("liftSize") };
  });

  for (const day of model.days) {
    const wo = weekOpacity(day.week);
    const week = model.weeks[day.week];
    const future = week.relation === "future";
    const dayU = day.abs + 0.5;
    const weekU = day.week * DAYS_PER_WEEK + DAYS_PER_WEEK / 2;
    const cx = mapX(lerp(dayU, weekU, slide));
    if (!onScreen(cx)) continue;

    if (day.kind === "rest") {
      // A rest day is a dash at every level, and adds nothing to a stack.
      const op = dayIn * wo * (1 - ramp(s, 0, 0.3));
      if (op > 0) {
        out.bars.push({
          key: `r${day.abs}`,
          layer: "day",
          kind: "rest",
          slot: day.abs,
          week: day.week,
          x: cx - dayBar / 2,
          y: box.height - REST_H,
          w: dayBar,
          h: REST_H,
          fillH: 0,
          future: false,
          cap: 1,
          joint: 0,
          opacity: op,
        });
      }
      if (sessionLabels > 0) {
        out.labels.push({
          ...NO_LABEL,
          key: `st${day.abs}-rest`,
          row: "text",
          x: cx,
          opacity: sessionLabels * wo,
          text: "Rest",
          muted: true,
          session: true,
        });
      }
    } else if (dayIn > 0) {
      const sessions = day.sessions;
      sessions.forEach((sess, i) => {
        const kind = sess.kind;
        const sx = cx + (i - (sessions.length - 1) / 2) * gap;
        const restBase = kind === "run" ? sessionRise * day.liftSize : 0;
        const weekBase = kind === "lift"
          ? day.liftBefore
          : week.liftSize + day.runBefore;
        const base = lerp(restBase, weekBase, rise);
        const h = sess.size * ppl;
        const covered = kind === "lift" && day.runSize > 0 ? sessionSlide : 0;
        const top = topOfWeek[day.week];
        const isTop = top.kind === kind && top.abs === day.abs;
        const joint = day.liftSize > 0 && day.runSize > 0
          ? jointFor(dayBar, day.runSize * ppl) * sessionSlide * (1 - rise)
          : 0;
        out.bars.push({
          key: `p${day.abs}-${kind}`,
          layer: "day",
          kind,
          slot: day.abs,
          week: day.week,
          x: sx - dayBar / 2,
          y: box.height - base * ppl - h,
          w: dayBar,
          h,
          fillH: future || sess.size <= 0 ? 0 : (sess.done / sess.size) * h,
          future,
          cap: (1 - covered) * (isTop ? 1 : 1 - rise),
          joint,
          opacity: dayIn * wo,
        });
        if (sessionLabels > 0) {
          out.labels.push({
            ...NO_LABEL,
            key: `st${day.abs}-${kind}`,
            row: "text",
            x: sx,
            opacity: sessionLabels * wo,
            text: sess.name,
            today: sess.state === "today",
            session: true,
          });
        }
      });
    }

    if (dayLabels > 0 && letterFit > 0) {
      out.labels.push({
        ...NO_LABEL,
        key: `dt${day.abs}`,
        row: "text",
        x: cx,
        opacity: dayLabels * letterFit * wo,
        text: day.letter,
        today: day.today,
        knockout: day.today,
      });
    }
  }

  // Week pieces, and week numbers under them, appear as the stack finishes.
  const numbersIn = ramp(s, 0.6, 1);
  for (const week of model.weeks) {
    const weekU = week.index * DAYS_PER_WEEK + DAYS_PER_WEEK / 2;
    const cx = mapX(weekU);
    const future = week.relation === "future";
    if (weekIn > 0) {
      const piece = (
        kind: PieceKind,
        base: number,
        size: number,
        done: number,
        cap: number,
      ) => {
        const h = size * ppl;
        out.bars.push({
          key: `w${week.index}-${kind}`,
          layer: "week",
          kind,
          slot: week.index,
          week: week.index,
          x: cx - dayBar / 2,
          y: box.height - base * ppl - h,
          w: dayBar,
          h,
          fillH: future || size <= 0 ? 0 : (done / size) * h,
          future,
          cap,
          joint: week.liftSize > 0 && week.runSize > 0
            ? jointFor(dayBar, week.runSize * ppl)
            : 0,
          opacity: weekIn,
        });
      };
      if (week.size === 0) {
        out.bars.push({
          key: `w${week.index}-rest`,
          layer: "week",
          kind: "rest",
          slot: week.index,
          week: week.index,
          x: cx - dayBar / 2,
          y: box.height - REST_H,
          w: dayBar,
          h: REST_H,
          fillH: 0,
          future: false,
          cap: 1,
          joint: 0,
          opacity: weekIn,
        });
      } else {
        if (week.liftSize > 0) {
          piece(
            "lift",
            0,
            week.liftSize,
            week.liftDone,
            week.runSize > 0 ? 0 : 1,
          );
        }
        if (week.runSize > 0) {
          piece("run", week.liftSize, week.runSize, week.runDone, 1);
        }
      }
    }
    if (numbersIn > 0) {
      out.labels.push({
        ...NO_LABEL,
        key: `wn${week.index}`,
        row: "text",
        x: cx,
        opacity: numbersIn,
        text: week.deload ? "D" : String(week.index + 1),
        today: week.relation === "current",
        knockout: week.relation === "current",
      });
    }

    // Ruler: the week's name and dates, sticking to the left edge when its
    // start has scrolled out of view.
    const left = mapX(week.index * DAYS_PER_WEEK);
    const right = mapX(week.index * DAYS_PER_WEEK + DAYS_PER_WEEK);
    const visible = Math.min(right, box.width) - Math.max(left, 0);
    const rulerOp = ramp(visible, 40, 90) * (1 - ramp(s, 0, 0.35)) *
      weekOpacity(week.index);
    if (rulerOp > 0) {
      out.labels.push({
        ...NO_LABEL,
        key: `r${week.index}`,
        row: "ruler",
        x: Math.max(left, 0) + 6,
        opacity: rulerOp,
        text: week.deload ? `${week.name} · deload` : week.name,
        sub: right - left >= 150 ? week.range : "",
        today: week.relation === "current",
      });
    }
  }

  // Week dividers: the Month level's rule between weeks, leaving as days stack.
  const dividerIn = ramp(z, 1, 2) * (1 - ramp(s, 0, 0.5));
  if (dividerIn > 0) {
    for (let k = 1; k < model.weeks.length; k++) {
      const x = mapX(k * DAYS_PER_WEEK);
      if (x > 0 && x < box.width) {
        out.dividers.push({ key: `div${k}`, x, opacity: dividerIn });
      }
    }
  }

  // The highest piece of each slot, for tooltips and today's chip.
  const dayTop = new Map<number, number>();
  const weekTop = new Map<number, number>();
  for (const b of out.bars) {
    weekTop.set(b.week, Math.min(weekTop.get(b.week) ?? box.height, b.y));
    if (b.layer === "day") {
      dayTop.set(b.slot, Math.min(dayTop.get(b.slot) ?? box.height, b.y));
    }
  }

  // Slots the pointer lands on: days until the stack is half done, then weeks.
  if (s < 0.5) {
    for (const day of model.days) {
      const x0 = mapX(day.abs);
      const x1 = mapX(day.abs + 1);
      if (x1 <= 0 || x0 >= box.width) continue;
      out.hits.push({
        key: `h${day.abs}`,
        x: x0,
        w: x1 - x0,
        top: dayTop.get(day.abs) ?? box.height,
        day: day.abs,
        week: day.week,
      });
    }
  } else {
    for (const week of model.weeks) {
      const x0 = mapX(week.index * DAYS_PER_WEEK);
      const x1 = mapX(week.index * DAYS_PER_WEEK + DAYS_PER_WEEK);
      if (x1 <= 0 || x0 >= box.width) continue;
      out.hits.push({
        key: `hw${week.index}`,
        x: x0,
        w: x1 - x0,
        top: weekTop.get(week.index) ?? box.height,
        day: inspectDay(model, week.index),
        week: week.index,
      });
    }
  }

  if (model.today >= 0) {
    const day = model.days[model.today];
    const x = mapX(
      lerp(day.abs + 0.5, day.week * DAYS_PER_WEEK + DAYS_PER_WEEK / 2, slide),
    );
    const focus = clamp((weekOpacity(day.week) - QUIET) / (1 - QUIET), 0, 1);
    out.today = {
      x,
      top: dayTop.get(day.abs) ?? box.height,
      // Fades out as its column crosses an edge instead of being clipped; a
      // column inside the window (centre half a slot in) is fully shown.
      opacity: (1 - ramp(s, 0, 0.4)) * focus *
        ramp(x, 0, Math.min(60, ppd / 2)) *
        ramp(box.width - x, 0, Math.min(60, ppd / 2)),
      text: `Today · ${day.session}`,
    };
  }
  return out;
}

/** The slot under x: the one that contains it, else the nearest by centre. */
export function hitAt(f: Frame, x: number): Hit | null {
  let best: Hit | null = null;
  let gap = Infinity;
  for (const hit of f.hits) {
    if (x >= hit.x && x < hit.x + hit.w) return hit;
    const d = Math.abs(hit.x + hit.w / 2 - x);
    if (d < gap) {
      gap = d;
      best = hit;
    }
  }
  return best;
}

/* ---------- Captions, titles and tooltips ---------- */

export interface Caption {
  /** "Today", "Monday", "Week 2 · Monday" or "Week 3". */
  when: string;
  today: boolean;
  /** The session, or at Day every session with its numbers. */
  head: string;
  nums: string;
  /** The whole line as plain text, for screen readers. */
  text: string;
}

function join(head: string, nums: string) {
  return head && nums ? `${head} · ${nums}` : head || nums;
}

/** The inspector line for the inspected day `abs` at `level`; `anchor` is the
 * focus day, so another week's days name their week. */
export function describeInspected(
  model: BlockModel,
  level: number,
  abs: number,
  anchor: number,
): Caption {
  const day = model.days[clampDay(model, abs)];
  if (!day) return { when: "", today: false, head: "", nums: "", text: "" };
  const week = model.weeks[day.week];
  if (level > 2.5) {
    const head = week.deload ? "deload" : "";
    return {
      when: week.name,
      today: week.relation === "current",
      head,
      nums: week.summary,
      text: `${week.name} · ${join(head, week.summary)}`,
    };
  }
  const rest = day.state === "rest";
  const when = day.today
    ? "Today"
    : level > 1.5 && day.week !== weekOf(anchor)
    ? `${week.name} · ${day.name}`
    : day.name;
  let head: string;
  let nums = "";
  if (rest) {
    // Day reads "Today · rest"; the strip's "Today · Rest" at Week and up.
    head = level < 0.5 ? "rest" : day.session;
  } else if (level < 0.5) {
    // Day: every session with its own numbers.
    head = day.sessions.map((s, i) =>
      i === 0 ? `${s.name} · ${captionNums(s)}` : `${s.name} ${captionNums(s)}`
    ).join(" · ");
  } else {
    head = day.session;
    nums = captionNums(day);
  }
  return {
    when,
    today: day.today,
    head,
    nums,
    text: `${when} · ${join(head, nums)}`,
  };
}

/** The page title for the view: what the chart is showing. `level` is the
 * resting level the picker is on; `anchor` the focus day. */
export function zoomTitle(
  model: BlockModel,
  level: Level,
  anchor: number,
  blockName: string,
) {
  const at = clampDay(model, anchor);
  const day = model.days[at];
  if (!day) return blockName;
  if (level === 3) return blockName;
  const here = model.days[model.today]?.week ?? -1;
  if (level === 0) {
    if (day.today) return "Today";
    const week = model.weeks[day.week];
    return day.week === here
      ? day.name
      : `${day.name}, ${week.name.toLowerCase()}`;
  }
  if (level === 1) {
    if (here < 0) return model.weeks[day.week].name;
    if (day.week === here) return "This week";
    if (day.week === here - 1) return "Last week";
    if (day.week === here + 1) return "Next week";
    return model.weeks[day.week].name;
  }
  return monthOf(model.weeks[day.week].range) ?? model.weeks[day.week].name;
}

const MONTHS: Record<string, string> = {
  Jan: "January",
  Feb: "February",
  Mar: "March",
  Apr: "April",
  May: "May",
  Jun: "June",
  Jul: "July",
  Aug: "August",
  Sep: "September",
  Oct: "October",
  Nov: "November",
  Dec: "December",
};

/** The month a week belongs to, from its range ("Sep 7-13", "Aug 31-Sep 6"):
 * the month holding most of its seven days (so the one with its Thursday). */
export function monthOf(range: string): string | null {
  const m = /^([A-Z][a-z]{2}) \d+-(?:([A-Z][a-z]{2}) )?(\d+)$/.exec(range);
  if (!m) return null;
  const [, from, to, endDay] = m;
  const month = to && 7 - Number(endDay) < 4 ? to : from;
  return MONTHS[month] ?? null;
}

/** "lift + run", "lift" or "run": which kinds a slot carries. */
function kindsOf(lift: number, run: number) {
  return lift > 0 && run > 0 ? "lift + run" : lift > 0 ? "lift" : "run";
}

/** "300 of 750 load", "750 planned load" or "430 load". */
function loadNums(done: number, planned: number) {
  if (done === 0) return `${n(planned)} planned load`;
  if (done >= planned) return `${n(done)} load`;
  return `${n(done)} of ${n(planned)} load`;
}

/** The tooltip for the slot `abs` inspects at `level` (U25): a title naming
 * the session and labeled numbers under it. */
export function tipFor(
  model: BlockModel,
  level: number,
  abs: number,
  anchor: number,
) {
  const day = model.days[clampDay(model, abs)];
  if (!day) return { title: "", numbers: "" };
  const week = model.weeks[day.week];
  if (level > 2.5) {
    const kinds = kindsOf(week.liftSize, week.runSize);
    return {
      title: week.deload ? `${week.name} · deload` : week.name,
      numbers: week.size === 0
        ? "rest"
        : `${kinds} · ${loadNums(week.done, week.planned)}`,
    };
  }
  const when = day.today
    ? "Today"
    : level > 1.5 && day.week !== weekOf(anchor)
    ? `${week.name} · ${day.name}`
    : day.name;
  return {
    title: `${when} · ${day.session}`,
    numbers: day.state === "rest"
      ? "rest"
      : `${kindsOf(day.liftSize, day.runSize)} · ${
        loadNums(day.done, day.planned)
      }`,
  };
}

/** Half a tooltip's width: a pointer closer to an edge than this aligns the
 * tooltip to that edge, so it never leaves the chart. */
export const TIP_HALF = 110;

export function tipAlign(x: number, width: number): "start" | "center" | "end" {
  if (x < TIP_HALF) return "start";
  if (x > width - TIP_HALF) return "end";
  return "center";
}

/** The line under the caption: the focus week's totals, or the block's. */
export function totalLine(model: BlockModel, level: number, anchor: number) {
  if (level > 2.5) {
    let done = 0;
    let planned = 0;
    for (const w of model.weeks) {
      done += w.done;
      planned += w.planned;
    }
    return `Block: ${n(done)} done of ${n(planned)} planned`;
  }
  const week = model.weeks[weekOf(clampDay(model, anchor))];
  return week ? `${week.name}: ${week.summary}` : "";
}

/** The window at a resting level: first day and day count. */
export function restWindow(model: BlockModel, level: Level, anchor: number) {
  const count = model.days.length;
  const win = windowDays(level, count);
  const c = cameraCenter(count, level, clampDay(model, anchor));
  return {
    start: Math.round(clamp(c - win / 2, 0, Math.max(0, count - win))),
    days: Math.round(win),
  };
}

/** Table view for a level: days for Day, Week and Month, weeks for Block. */
export function tableFor(model: BlockModel, level: Level, anchor: number) {
  if (level === 3) {
    return {
      head: ["Week", "Dates", "Done", "Planned"],
      rows: model.weeks.map((w) => [
        `${w.name}${w.deload ? " (deload)" : ""}${
          w.relation === "current" ? " (this week)" : ""
        }`,
        w.range,
        n(w.done),
        n(w.planned),
      ]),
    };
  }
  const { start, days } = restWindow(model, level, anchor);
  return {
    head: ["Week", "Day", "Session", "Done", "Planned"],
    rows: model.days.slice(start, start + days).map((d) => [
      `${model.weeks[d.week].name}${d.today ? " (today)" : ""}`,
      d.name,
      d.session,
      n(d.done),
      n(d.planned),
    ]),
  };
}

/** The chart's name for assistive tech. */
export function groupLabel(model: BlockModel, level: Level, anchor: number) {
  return `Workout load, ${LEVEL_NAMES[level].toLowerCase()} view. ${
    totalLine(model, level, anchor)
  }.`;
}
