/** Schema version handling and migrations for the user document. */

import { bumperColorFor, defaultBarbellStep } from "./plates.ts";
import type { QalaDocument, Settings } from "./schema.ts";

/** Current document version. v0 (no `schemaVersion`) migrates to this. */
export const CURRENT_SCHEMA_VERSION = 1;

function defaultSettings(): Settings {
  const plates = [
    { weight: 45, pairs: "enough" as const, color: bumperColorFor(45, "lb") },
    { weight: 35, pairs: "enough" as const, color: bumperColorFor(35, "lb") },
    { weight: 25, pairs: "enough" as const, color: bumperColorFor(25, "lb") },
    { weight: 10, pairs: "enough" as const, color: bumperColorFor(10, "lb") },
    { weight: 5, pairs: "enough" as const, color: bumperColorFor(5, "lb") },
    { weight: 2.5, pairs: "enough" as const, color: bumperColorFor(2.5, "lb") },
    { weight: 1.25, pairs: 0 as const, color: bumperColorFor(1.25, "lb") },
  ];
  return {
    units: { weight: "lb", distance: "mi" },
    barbellStep: defaultBarbellStep(plates),
    dumbbellStep: 5,
    mainLifts: ["squat", "bench", "deadlift", "overheadPress"],
    theme: "system",
    dailyWellness: false,
    run: {
      audioCueEvery: { distance: 1, minutes: 5 },
      autoPause: true,
      mapRegion: "",
    },
    hybridPriority: "lifting",
    injuries: [],
    plates: {
      unit: "lb",
      collarWeight: 0,
      bars: [{
        id: "bar-olympic",
        name: "Olympic bar",
        weight: 45,
        default: true,
      }],
      plates,
      colorScheme: "bumper",
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
    titleFont: "qalaTest",
  };
}

/** Baseline v1 document: every top-level section present with empty state. */
export function createBaselineDocument(): QalaDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: defaultSettings(),
    exercises: { hidden: [], custom: {}, overrides: {} },
    exerciseNotes: {},
    equipment: {
      recovery: ["foamRoller", "percussionMassager"],
      cardio: [],
      gym: [],
    },
    restProfile: { byClass: {}, byExercise: {} },
    programs: {},
    activeProgramId: "",
    runPlans: {},
    activeRunPlanId: "",
    history: [],
    engineSnapshots: [],
    coachMemory: [],
    llmLog: [],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Migrate a v0 document (missing/partial, no `schemaVersion`) to v1. */
export function migrateV0ToV1(doc: unknown): QalaDocument {
  const baseline = createBaselineDocument();
  if (!isRecord(doc)) return baseline;
  const src = doc as Record<string, unknown>;
  const merged = {
    ...baseline,
    ...src,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  } as QalaDocument;
  merged.settings = {
    ...baseline.settings,
    ...(isRecord(src.settings) ? src.settings : {}),
  } as Settings;
  if (
    isRecord((merged.settings as unknown as Record<string, unknown>).plates)
  ) {
    merged.settings.plates = {
      ...baseline.settings.plates,
      ...((merged.settings as unknown as Record<string, unknown>)
        .plates as object),
    };
  }
  if (!Array.isArray(merged.history)) merged.history = [];
  if (!isRecord(merged.exercises)) merged.exercises = baseline.exercises;
  if (!isRecord(merged.restProfile)) merged.restProfile = baseline.restProfile;
  return merged;
}

/** Migrate any stored value to the current version. Throws when newer. */
export function migrate(doc: unknown): QalaDocument {
  if (!isRecord(doc)) return createBaselineDocument();
  const version = (doc as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined || version === 0) return migrateV0ToV1(doc);
  if (version === CURRENT_SCHEMA_VERSION) return doc as unknown as QalaDocument;
  throw new RangeError(`unsupported schemaVersion: ${String(version)}`);
}
