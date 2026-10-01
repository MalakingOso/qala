// Edit-list schema for text import (DECISIONS S19, docs/ls-plus-plus.md 4).
//
// The model fills this fixed schema and nothing else. It never writes program
// text. Everything it returns is untrusted: validateEditList checks every
// field, bounds every number, and rejects an item outright instead of
// clamping it (clamping would silently change a program the owner thinks they
// are copying). The evaluator does not bound these numbers itself, it
// accepts `99999x8`.

import type { JsonSchema } from "./prompts.ts";

export type WeightUnit = "lb" | "kg";

/** One exercise line from the source text, in source order. */
export interface EditItem {
  /** Week number, 1 when the source has no weeks. */
  week: number;
  /** Position of the day inside its week, 1-based. */
  day: number;
  /** Name the source gave the day ("Push", "Lower B"). Display only. */
  dayLabel?: string;
  /** Exercise name exactly as the source wrote it. Never emitted as is. */
  exercise: string;
  sets: number;
  /** Reps, or the low end of a range. */
  reps: number;
  /** High end of a range. */
  repsMax?: number;
  /** Last set is "as many reps as possible" (`8+`). */
  amrap?: boolean;
  /** Absent means "ask on the first workout" and becomes `?+`. */
  weight?: number;
  unit?: WeightUnit;
  rpe?: number;
  restSec?: number;
  /** Shown in the diff, never emitted into program text. */
  note?: string;
}

export interface RejectedItem {
  /** Index in the array the model returned. */
  index: number;
  reason: string;
  /** Short plain-text echo of what the source line said, if present. */
  exercise?: string;
}

export interface EditListResult {
  items: EditItem[];
  rejected: RejectedItem[];
}

export const IMPORT_LIMITS = {
  /** Same ceiling the LS++ evaluator uses for set counts (MAX_SETS). */
  maxSets: 30,
  maxReps: 100,
  maxWeightLb: 2000,
  maxWeightKg: 1000,
  maxWeeks: 52,
  maxDays: 14,
  maxItems: 200,
  minRestSec: 5,
  maxRestSec: 1800,
  maxNameChars: 80,
  maxLabelChars: 40,
  maxNoteChars: 200,
} as const;

/** The json_schema passed to the model. */
export const EditListSchema: JsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          week: {
            type: "integer",
            minimum: 1,
            maximum: IMPORT_LIMITS.maxWeeks,
          },
          day: { type: "integer", minimum: 1, maximum: IMPORT_LIMITS.maxDays },
          dayLabel: { type: "string" },
          exercise: { type: "string" },
          sets: { type: "integer", minimum: 1, maximum: IMPORT_LIMITS.maxSets },
          reps: { type: "integer", minimum: 1, maximum: IMPORT_LIMITS.maxReps },
          repsMax: {
            type: "integer",
            minimum: 1,
            maximum: IMPORT_LIMITS.maxReps,
          },
          amrap: { type: "boolean" },
          weight: { type: "number", minimum: 0 },
          unit: { type: "string", enum: ["lb", "kg"] },
          rpe: { type: "number", minimum: 1, maximum: 10 },
          restSec: {
            type: "integer",
            minimum: IMPORT_LIMITS.minRestSec,
            maximum: IMPORT_LIMITS.maxRestSec,
          },
          note: { type: "string" },
        },
        required: ["day", "exercise", "sets", "reps"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Collapse whitespace, drop control characters, cap the length. */
export function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // deno-lint-ignore no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ")
    .trim();
  if (s === "") return undefined;
  return s.slice(0, max);
}

function intInRange(v: unknown, lo: number, hi: number): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return v >= lo && v <= hi ? v : undefined;
}

type ItemOutcome = { item: EditItem } | { reason: string };

function validateItem(raw: unknown, defaultUnit: WeightUnit): ItemOutcome {
  if (!isRecord(raw)) return { reason: "not an object" };
  const exercise = cleanText(raw["exercise"], IMPORT_LIMITS.maxNameChars);
  if (exercise === undefined) return { reason: "missing exercise name" };

  const week = raw["week"] === undefined
    ? 1
    : intInRange(raw["week"], 1, IMPORT_LIMITS.maxWeeks);
  if (week === undefined) return { reason: "week out of range" };
  const day = intInRange(raw["day"], 1, IMPORT_LIMITS.maxDays);
  if (day === undefined) return { reason: "day missing or out of range" };
  const sets = intInRange(raw["sets"], 1, IMPORT_LIMITS.maxSets);
  if (sets === undefined) {
    return { reason: `sets missing or outside 1-${IMPORT_LIMITS.maxSets}` };
  }
  const reps = intInRange(raw["reps"], 1, IMPORT_LIMITS.maxReps);
  if (reps === undefined) {
    return { reason: `reps missing or outside 1-${IMPORT_LIMITS.maxReps}` };
  }

  const item: EditItem = { week, day, exercise, sets, reps };

  if (raw["repsMax"] !== undefined) {
    const repsMax = intInRange(raw["repsMax"], 1, IMPORT_LIMITS.maxReps);
    if (repsMax === undefined) return { reason: "repsMax out of range" };
    if (repsMax < reps) return { reason: "repsMax is below reps" };
    if (repsMax > reps) item.repsMax = repsMax;
  }
  if (raw["amrap"] !== undefined) {
    if (typeof raw["amrap"] !== "boolean") {
      return { reason: "amrap not boolean" };
    }
    if (raw["amrap"]) {
      if (item.repsMax !== undefined) {
        return { reason: "amrap with a rep range" };
      }
      item.amrap = true;
    }
  }

  const unit = raw["unit"] === undefined ? undefined : raw["unit"];
  if (unit !== undefined && unit !== "lb" && unit !== "kg") {
    return { reason: "unit is not lb or kg" };
  }
  if (raw["weight"] !== undefined) {
    const w = raw["weight"];
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
      return { reason: "weight is not a non-negative number" };
    }
    const u: WeightUnit = (unit as WeightUnit | undefined) ?? defaultUnit;
    const cap = u === "lb"
      ? IMPORT_LIMITS.maxWeightLb
      : IMPORT_LIMITS.maxWeightKg;
    if (w > cap) return { reason: `weight above ${cap}${u}` };
    // 0 means "no weight given" (bodyweight, or the model had nothing).
    if (w > 0) {
      item.weight = Math.round(w * 100) / 100;
      item.unit = u;
    }
  }
  if (raw["rpe"] !== undefined) {
    const r = raw["rpe"];
    if (typeof r !== "number" || !Number.isFinite(r) || r < 1 || r > 10) {
      return { reason: "rpe outside 1-10" };
    }
    item.rpe = Math.round(r * 2) / 2;
  }
  if (raw["restSec"] !== undefined) {
    const rest = intInRange(
      raw["restSec"],
      IMPORT_LIMITS.minRestSec,
      IMPORT_LIMITS.maxRestSec,
    );
    if (rest === undefined) return { reason: "restSec out of range" };
    item.restSec = rest;
  }
  const dayLabel = cleanText(raw["dayLabel"], IMPORT_LIMITS.maxLabelChars);
  if (dayLabel !== undefined) item.dayLabel = dayLabel;
  const note = cleanText(raw["note"], IMPORT_LIMITS.maxNoteChars);
  if (note !== undefined) item.note = note;
  return { item };
}

/**
 * Validate whatever the model (or a client round-trip) handed back. Never
 * throws. Items that fail any check go to `rejected` with a reason, and the
 * owner sees them in the diff view so a dropped line is never silent.
 */
export function validateEditList(
  raw: unknown,
  defaultUnit: WeightUnit = "lb",
): EditListResult {
  if (!isRecord(raw) || !Array.isArray(raw["items"])) {
    return {
      items: [],
      rejected: [{ index: -1, reason: "response is not an edit list" }],
    };
  }
  const items: EditItem[] = [];
  const rejected: RejectedItem[] = [];
  const list = raw["items"] as unknown[];
  for (let i = 0; i < list.length; i++) {
    if (i >= IMPORT_LIMITS.maxItems) {
      rejected.push({ index: i, reason: "too many items, rest dropped" });
      break;
    }
    const out = validateItem(list[i], defaultUnit);
    if ("item" in out) {
      items.push(out.item);
    } else {
      const ex = isRecord(list[i])
        ? cleanText((list[i] as Record<string, unknown>)["exercise"], 80)
        : undefined;
      rejected.push(
        ex === undefined
          ? { index: i, reason: out.reason }
          : { index: i, reason: out.reason, exercise: ex },
      );
    }
  }
  return { items, rejected };
}
