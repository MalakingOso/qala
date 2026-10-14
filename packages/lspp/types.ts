// Shapes returned by the LS++ wasm build (crates/qala-lspp-json, crates/qala-lspp-wasm).
// Hand-written to match the Rust structs; the wasm smoke test and the real-wasm tests
// in server/lspp_test.ts are what keep them honest.

/** A syntax error. `from` and `to` are UTF-16 offsets, `line` and `col` are 1-based. */
export interface LsppDiagnostic {
  from: number;
  to: number;
  message: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** A one-line fix idea. Absent when the Rust side has none. */
  suggestion?: string | null;
}

/** A lint warning: text that parses but is probably wrong. */
export interface LsppLint extends LsppDiagnostic {
  /** Stable rule id: `empty-program`, `too-many-sets`, `mixed-units`, `unused-state`. */
  code: string;
}

export type LsppFormatResult =
  | { ok: true; text: string; changed: boolean }
  | {
    ok: false;
    /** `"syntax"`, or a sentence saying why formatting could not be proven safe. */
    reason: string;
    /** The syntax errors when `reason` is `"syntax"`, otherwise empty. */
    diagnostics: LsppDiagnostic[];
  };

export interface LsppWeight {
  value: number;
  unit: "lb" | "kg";
}

export interface LsppDrySet {
  reps: number | null;
  minReps: number | null;
  weight: LsppWeight | null;
  isAmrap: boolean;
  askWeight: boolean;
  /** `?+` with no weight: the lifter fills it in on the day. */
  blank: boolean;
  rpe: number | null;
}

export interface LsppDryExercise {
  key: string;
  name: string;
  sets: LsppDrySet[];
}

export interface LsppDrySession {
  /** 0-based position in this dry run. */
  session: number;
  /** 1-based day number over the whole program. */
  day: number;
  week: number;
  dayInWeek: number;
  name: string;
  exercises: LsppDryExercise[];
  /** Finish-day script errors for this session. */
  errors: string[];
}

export interface LsppDryRunResult {
  sessions: LsppDrySession[];
  blankSets: number;
  /** The program text after the last simulated session. */
  finalText: string;
}

export interface LsppDryRunRequest {
  programText: string;
  name?: string;
  /** Liftosaur-style settings, from `settingsFromCore`. */
  settings: unknown;
  fromDay?: number;
  sessions?: number;
  throughWeek?: number;
}

/** One evaluation error, as `forceEvaluateText` reports them (it never throws). */
export interface LsppEvalError {
  error: {
    message: string;
    line: number;
    offset: number;
    from: number;
    to: number;
    details: { type?: string; subject?: string; data?: unknown };
  };
  dayData: { day: number; week: number; dayInWeek: number };
}

export interface LsppEvaluatedProgram {
  errors: LsppEvalError[];
  [key: string]: unknown;
}

export interface LsppEvaluateRequest {
  programText: string;
  name: string;
  settings: unknown;
}

/** The wasm module's exports this package calls: a string in, a JSON envelope string out. */
export interface LsppWasm {
  diagnosePlanner(text: string): string;
  lintPlanner(text: string): string;
  formatPlanner(text: string): string;
  dryRun(request: string): string;
  forceEvaluateText(request: string): string;
  qalaSettingsToLiftoscript(request: string): string;
}

export type LsppResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: string; message: string };
