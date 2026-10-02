// Availability: skipped days and training status. Pure date-key logic over
// the core document shape: no DOM, no Deno APIs, so the web shells import
// this directly. Skipped days log no session, so fatigue decay and the
// no-guilt rule (a skip is never a miss) fall out of logSession untouched.

import type { Availability, DaySkip, SkipReason } from "../core/schema.ts";
import type { Checkin } from "./state.ts";

/** Vacation and sick push the plan out; a break or a scheduling conflict
 * rests in place and an injured day trains around the hurt muscle. */
export function shiftsPlan(reason: SkipReason): boolean {
  return reason === "vacation" || reason === "sick";
}

/** Whether a persistent status covers a YYYY-MM-DD day. */
export function coversDay(a: Availability, dateKey: string): boolean {
  if (a.status === "active" || !a.since) return false;
  if (dateKey < a.since) return false;
  if (a.until && dateKey > a.until) return false;
  return true;
}

/** Why a day is off, or null when it trains. A one-day skip wins over the
 * persistent status. */
export function reasonOn(
  dateKey: string,
  availability: Availability,
  skips: DaySkip[],
): SkipReason | null {
  const skip = skips.find((s) => s.date === dateKey);
  if (skip) return skip.reason;
  if (coversDay(availability, dateKey)) {
    return availability.status as SkipReason;
  }
  return null;
}

export type DayClass = "train" | "rest" | "shift";

/** How the plan treats a day: training as usual, a rest day in place, or a
 * day the scheduler pushes out. */
export function classifyDay(
  dateKey: string,
  availability: Availability,
  skips: DaySkip[],
): DayClass {
  const reason = reasonOn(dateKey, availability, skips);
  if (!reason) return "train";
  return shiftsPlan(reason) ? "shift" : "rest";
}

/** Muscles under the injured guard on a day (at most one: the skip's target
 * wins, else the status target). */
export function injuredOn(
  dateKey: string,
  availability: Availability,
  skips: DaySkip[],
): string[] {
  const skip = skips.find((s) => s.date === dateKey);
  if (skip) {
    return skip.reason === "injured" && skip.muscle ? [skip.muscle] : [];
  }
  if (
    availability.status === "injured" && coversDay(availability, dateKey) &&
    availability.muscle
  ) {
    return [availability.muscle];
  }
  return [];
}

const MUSCLE_ALIASES: Record<string, string> = {
  quadriceps: "quads", // body-map id vs engine id
};

/** Canonical muscle compare: lowercase, no separators, known aliases. */
export function normMuscle(muscle: string): string {
  const norm = muscle.toLowerCase().replace(/[\s_-]/g, "");
  return MUSCLE_ALIASES[norm] ?? norm;
}

export type GuardVerdict = "train" | "halve" | "skip";

/** Injured-muscle guard for one exercise: an injured direct target takes the
 * exercise out, an injured synergist halves its sets, anything else trains. */
export function guardExercise(
  targets: string[],
  synergists: string[] | undefined,
  injured: string[],
): GuardVerdict {
  if (!injured.length) return "train";
  const hurt = new Set(injured.map(normMuscle));
  if (targets.some((t) => hurt.has(normMuscle(t)))) return "skip";
  if ((synergists ?? []).some((s) => hurt.has(normMuscle(s)))) return "halve";
  return "train";
}

/** Injured muscles check in at soreness 4 (still sore now), so readiness
 * blocks them and the warm-up treats them as sore. Never lowers a rating. */
export function applyInjuryToCheckin(
  checkin: Checkin,
  injured: string[],
): Checkin {
  if (!injured.length) return checkin;
  const soreness = { ...checkin.soreness };
  for (const muscle of injured) soreness[normMuscle(muscle)] = 4;
  return { ...checkin, soreness };
}

/** The user's calendar day as YYYY-MM-DD. */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Add calendar days to a YYYY-MM-DD key (UTC math, DST-safe). */
export function addDaysKey(dateKey: string, days: number): string {
  const ms = Date.parse(`${dateKey}T00:00:00Z`) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
