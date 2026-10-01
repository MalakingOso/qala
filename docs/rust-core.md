# Rust core: migration plan

Status: **proposed**, 2026-09-30. Nothing here is built or approved. Read with `docs/rust-core-spike.md` (what was verified and what wasn't), `docs/android-native.md` (the Kotlin app) and `docs/rust-core-open-questions.md` (things you can answer later). Decision rows are DECISIONS S6 to S17. Revised 2026-09-30 after the owner asked for liftoscript in Rust and asked whether something beats Automerge: Automerge is out, record-based sync is in (section 4), and there is no quickjs interim (section 6).

## Status (2026-10-01)

The liftoscript evaluation path is ported in `crates/qala-liftoscript` (about 27k lines including tests) and matches the TS oracle on the golden suite:
- All 60 built-in programs, both stages (planner parse and full evaluation), in lb, plus 5 in kg.
- `Program_nextHistoryEntry`, every finish-day scenario including the chained GZCLP replay, and the engine-binding cases.
- Both parsers match Lezer's trees node for node on every golden and fuzz input (valid input only; error recovery is best effort).
- 132 unit tests (about 12,000 generated script cases, 2,192 planner-exercise cases, 111 program-to-planner cases) and 5 golden suites pass. Clippy is clean.
"Matches the oracle" means after these documented normalizations: `<uid>` placeholders on random ids; the Lezer node reference dropped; NaN and Infinity compared as null; a Set-typed `stateKeys` compared as an empty object; object key order ignored on `vtype: set` and `history_entry` objects; key order of `description` relaxed in 6 built-ins on the program-to-planner path; nested `reuse` pruned for `shortcut-to-size`; and parser error-recovery trees on invalid input not matched to Lezer's (about 300 script cases, counted separately).

Two bugs found while finishing it. First, a lone backslash made the planner parser loop forever, pushing empty nodes until the OOM killer fired; fixed with a progress check in `program()`. That cause is inferred from timing (the parser file changed one minute before the first OOM) and from the test inputs, and confirmed on the 34 inputs of `bad_input_does_not_panic`, not proven for every input. The second OOM at 05:12 was my own `cargo test` at the start of a session. Second, `numberOfSets` had no upper bound, so `numberOfSets = 1e9` would allocate tens of GB: it is now capped at `MAX_SETS = 30` in `script_eval.rs` (the owner's limit), with a script error past it, and index writes past the cap are dropped. This is a deliberate divergence from TS, which allows any count; the oracle's own corpus sets `numberOfSets` from weights like 135, and 14 of 12,290 generated cases are exempted for that reason in `script_eval_tests.rs`. Run tests only through `scripts/cargo-test-safe.sh -p qala-liftoscript`.

Cleanup still to do: private duplicate helpers in `program_exercise.rs` and `program_to_planner.rs` that belong in `planner_program_exercise.rs` and `program_set.rs`; the UniFFI and wasm shims (R0); a program-level differential fuzz; and test-data size (91 MB: gitignore the generated `cases_*.json` and `*_fuzz.json` and regenerate them with the Deno scripts, keep the 60 `builtins/*.json`). Nothing is committed, so about 27k lines of Rust are uncommitted.

## 1. Conclusions

1. Build a Rust workspace for the logic that has to behave identically on the phone, the web and the server: run pipeline, math (rounding, units, plates), engine, and the liftoscript evaluation path. The TS packages stay as the oracle and as the desktop's authoring runtime until each Rust module passes conformance.
2. Drop Automerge. Sync becomes immutable records with UUIDs, last-write-wins per field with a hybrid logical clock, and plain HTTP with the server as authority (section 4). The Rust core never holds a synced store; it takes state in and returns state out as JSON.
3. Raw GPS fixes never go through sync as records. They live in Room on the phone and upload as immutable content-addressed blobs (section 5). This amends the constraint "run recording writes to the local document continuously".
4. Liftoscript is ported to Rust, evaluation path only (about 9 to 11k lines of logic, reorganized into small modules, not a mirror of the TS layout). There is no quickjs interim: the phase order puts the port ahead of the phone's lifting screens (section 6).
5. Defer the generator port. The phone doesn't author programs, so the generator has no phone consumer.
6. Rust is the reason the foreground service can run guided cues with the screen locked: there is no WebView and no JS there. That is why the run pipeline goes first.

## 2. Inventory

Counts are from `find` and `grep` over `packages/` on 2026-09-30. "Tests" counts `Deno.test(` declarations, so the runner reports more because of nested steps (README says 222 total).

| Package | Source lines | Test lines | Tests | Pure and portable? | Blockers |
|---|---|---|---|---|---|
| `core` | 1,290 | 321 | 22 | Yes. Types, units, rounding, plates, migrations. | `schema.ts` is types only. `plates.ts` is the one module the phone UI already calls. |
| `engine` | 2,552 | 1,227 | 62 | Yes. `state.ts` says "no DOM, no automerge". | Date arithmetic (`daysBetween`, decay). `JSON.parse(JSON.stringify(s))` clone idiom. |
| `generator` | 2,645 | 1,109 | 41 | Yes. Emits liftoscript text. | Its tests parse and evaluate the output with liftoscript, so evaluation stays a TS check. |
| `run` | 1,534 | 612 | 28 | Yes. No DOM, no Capacitor. | The pipeline is batch (`filterFixes`, `computePauses`, `computeSplits` take the whole array). Only `GuidedRun` is stateful. Live use needs a new incremental recorder. `gpx.ts`, `tcx.ts`, `xml.ts` are exporters with no phone caller. |
| `llm` | 940 | 324 | 8 | Yes. Prompt builders and response validation. | `valibot`. Not in the port list; see section 7, R6. |
| `liftoscript` | 24,344 | 568 | 10 | Mostly. Vendored from liftosaur, upstream file names kept. | `@lezer/*` parser (the thing a Rust parser replaces). `Dialog_*` and `Storage_*` are stubs. Tests read built-ins through `Deno.readDirSync`. Large planner and mutator surface beyond `parser.ts` and the evaluator. |

Automerge: no package imports it. The only mentions are comments and stub error messages in three files (`engine/state.ts`, `core/schema.ts`, `liftoscript/src/models/storage.ts`). The packages are pure with respect to sync.

Numeric and time hotspots in core, engine, run and generator: about 45 `Math.round`, `toFixed`, `Math.trunc` and `Math.sign` call sites, and about 42 `Date` uses. Those are where Rust and JS can disagree.

What the phone actually calls today: the phone shell is a prototype on sample data. It imports `core/plates.ts` and nothing else from `packages/*`. Engine, run, generator, liftoscript and llm are not wired to any phone screen. So the port is mostly greenfield wiring, not translation of working paths.

## 3. Architecture

```
crates/
  qala-core/      pure logic, no I/O, no clock, no threads
    js.rs         js_round, js_to_fixed, number parsing helpers
    run/          filter, pauses, splits, pace, guided, load, recorder
    math/         units, rounding, plates
    engine/       state, decay, e1rm, kalman, readiness, volume, rest, warmup, running
  qala-ffi/       UniFFI proc-macro exports (Android)
  qala-wasm/      wasm-bindgen exports (web, Deno)
  qala-liftoscript/  from R5, section 8
```

`docs/spike/qcore/` is a throwaway. The real crates are written fresh against the golden vectors.

**Boundary.** Each exported function takes and returns a JSON string with a top-level `"v": 1`. Columnar fix data (the hot path) uses one `ByteArray` or `Float64Array` of little-endian f64 columns, matching the existing delta-encoded track layout. The spike showed UniFFI boxes `Vec<f64>` per element, so large arrays never cross as lists.

**Public API.** The four functions from PLAN 6, plus run and math:

- `log_session(state, workout) -> state`
- `predict_readiness(state, checkin, now) -> readiness`
- `recommend_next_session(state, context, now) -> recommendation`
- `calibrate(state) -> state`
- `run_recorder_*`: `new(config)`, `push_fix(fix) -> events`, `snapshot() -> live numbers`, `finish() -> processed run`
- `plan_plates`, `nearest_loadable`, `round_weight`

**Hard rules for the core.** These are rules, not notes.

1. `js_round(x) = (x + 0.5).floor()` everywhere TS uses `Math.round`. Rust's `f64::round` rounds half away from zero and diverges for negative halves; the spike hit it on -6.25.
2. Time enters as `i64` epoch milliseconds plus a UTC offset in minutes. The core never constructs a date or reads a clock. Day boundaries and DST are computed from the offset the caller supplies.
3. No `HashMap` iteration order in any output. Use `BTreeMap` or `Vec`.
4. `f64` only, no `f32`. Never `mul_add`. No `rayon`.
5. Non-finite numbers are an error at the boundary. `serde_json` writes NaN and Infinity as `null`, and a round trip does not restore them.
6. `toFixed` is ported deliberately (JS rounds on the exact decimal expansion), and number parsing follows `Number()` rules where strings enter.
7. Panics are `abort` in release, so every exported function validates input and returns an error value instead of panicking.

**Toolchain.** `rust-toolchain.toml` pins 1.94.1 (what is installed on this machine; the throwaway spike used 1.98.1 from a scratch rustup). The wasm-bindgen CLI is pinned to the crate version in `Cargo.lock` (0.2.129 today). Run `wasm-opt -Oz` in the wasm build. Release profile as in the spike: `opt-level = "z"`, LTO, `codegen-units = 1`, `panic = "abort"`, `strip = true`. There is no CI workflow in the repo, so the gates are tasks you run locally: `deno task test` (existing) and new `deno task test:rust`, `deno task build:wasm`, and `deno task golden`.

## 4. Sync: records, not a CRDT document

**Decision: replace Automerge with record sync.** This supersedes S3's mechanism (one automerge document per user over WebSocket) and keeps its intent: offline-first on two devices, Tailscale identity for auth. S3 was your call from the first interview, so this is a proposal.

Why: Automerge is built for many writers merging freely. You are one person on two devices, rarely editing the same thing at once. What it cost us on the Android side: a 0.0.x JNI binding, a hand-written CBOR protocol, no confirmed way to turn a document into JSON for the engine, and a second Automerge copy anywhere Rust wanted to read state. It also forced raw tracks out of the document (they would have made it unusable), which record sync handles without a special case. The web sync layer was never built and no `data/` directory exists on this machine, so nothing needs migrating.

**Model.**
- Every entity is a record: `id` (UUID), `type`, `fields`, `deleted`. Each field carries its own hybrid logical clock value `(wallMs, counter, nodeId)`.
- Sessions, sets, runs and engine inputs are created once and then immutable. Edits (session notes, PR-flag dismissal, exercise notes, settings, program text) are field writes. For two writes to the same field, the higher HLC wins. Settings are one record per group, each leaf a field. A program's text is one field; it is edited only on the desktop, so conflicts are not a real case.
- `engineSnapshots` is a derived cache, rebuildable from history (PLAN 7). It is not synced; each device rebuilds it. That removes the need to write engine state anywhere shared.

**Protocol.** `POST /api/sync` with `{ since, changes: [...] }` returns `{ cursor, changes: [...] }`. The client sends its local changes and receives everything newer than its cursor in one round trip. The server assigns a monotonically increasing sequence number per user; applying a change is idempotent on `(recordId, field, hlc)`, so retries are safe. Auth is the existing Tailscale identity header through `requireUser`; Origin is ignored. The server stores per user in SQLite (check that `node:sqlite` is solid in Deno 2.9, otherwise an append-only file).

**Clients.** Room on Android; IndexedDB on the web (replacing the `localStorage` outbox, `offlineQueue.ts` becomes the upload queue's shape). The merge rule is one comparison per field and is implemented natively on each side. The Rust core doesn't own it, but HLC ordering and merge get golden vectors so the three implementations agree.

**Clock skew.** HLC keeps the clock monotonic per device. The server rejects a write whose wall time is more than a day ahead of server time, so a bad phone clock can't win every future conflict.

**What this costs.** `server/sync.ts` and `server/ws.ts` (and their tests) are replaced, the `@automerge/*` dependencies leave `server/` and `apps/web`, and the Kotlin and web clients are new work. It is less work than a CBOR protocol client and a document hydrator. Concurrent edits to the same field lose one write silently; for one person that is acceptable, and the loser could be kept in a small history table later.

**Alternatives rejected.** Automerge with an OkHttp CBOR client (the earlier plan); samod over UniFFI (experimental); Loro or Yjs (no maintained Kotlin package found); cr-sqlite (low activity).

## 5. Raw tracks

At 1 Hz, a run is about 3,600 fixes an hour across five or six columns. Fixes are not sync records; syncing them as fields would bury the store in tiny rows.

- On the phone, each fix is written to Room (WAL, one insert per fix, `INSERT OR IGNORE` on `(runId, fixTimeMs)`) from a dedicated thread. That is the continuous, crash-safe local record.
- The run record holds the summary (distance, moving time, splits, elevation gain, HR aggregates) plus `trackBlobId`, the content hash of the encoded track.
- Tracks upload as immutable, content-addressed blobs (`PUT /api/blobs/<hash>`, `GET` to fetch), resumable, after the run ends or the app is next online. The desktop fetches a blob when it draws a map or chart.

`core/schema.ts` currently puts `track` arrays inside each `RunSession`. That moves to the blob, a `schemaVersion` migration in `packages/core/migrations.ts` that lands before any sync ships. Route matching (DECISIONS R5) runs on the server over stored raw fixes: the blobs are exactly that.

New server routes need real auth. Today only `/sync` calls `requireUser`; `/api/llm/chat`, `/api/elevation` and `/tiles` rely on the tailnet. Sync and blob routes must call `requireUser` and key everything under the user's id.

## 6. Liftoscript on the phone

PLAN 10: check-in, then `predict_readiness`, then bindings, then program evaluation, then the workout screen, at workout start, possibly offline. The phone evaluates programs with the Rust port from section 8. There is no interim runtime.

Because the phone's lifting screens (phase A4) need it, the liftoscript port starts as soon as R1 and R2 have set up the workspace, in parallel with the phone's run and sync phases, which don't depend on it. If the port runs late, the fallback is a stopgap, not a plan: embed quickjs-kt with a bundle of the TS package (0.9 MB, measured by research; one maintainer; unverified on our bundle). Don't build it unless the schedule forces it.

Also stays TS: `packages/llm`. It needs the network (the model runs on callisto), so offline use is moot. A server route builds the prompt and validates the response; the phone's Coach tab calls it (S14).

## 7. Porting order and acceptance

Each step leaves the TS package in place and passing. A Rust module counts as done only when every acceptance line is met against golden vectors (section 9).

**R0. Foundations.** Workspace, pinned toolchain, `js.rs` helpers, the vector generator and format, `qala-ffi` and `qala-wasm` shims with a `version()` call, `deno task` entries.
Accept: one trivial function round-trips the same vector through `cargo test`, Deno wasm, and a Kotlin instrumented test on the phone. arm64 `.so` under 2 MB stripped, 16 KB aligned.

**R1. `run`.** Geodesy (Vincenty, haversine), `filterFixes`, `computePauses`, `computeSplits`, pace windows, `GuidedRun`, load (GAP, rTSS, VDOT, Riegel). Then the new incremental `RunRecorder`: `push_fix` returns live numbers and cue events, and `finish` returns the batch `ProcessedRun`. Leave GPX, TCX and XML in TS: the task listed exporters under `packages/run`, but nothing on the phone exports files (they serve the desktop and the server), so porting them adds Rust surface with no consumer. Say so if you want them ported anyway. HR-zone coaching (DECISIONS R6) extends `guided.ts` and isn't built yet: build it once, in whichever language `guided` lives in when you get to it, and add its vectors then. Don't build it in both.
Accept:
- Every `run` test input becomes a vector and matches to 1e-9 (exact for integers and strings).
- The recorder fed fix by fix produces cue events and final splits identical to the batch `processRun` over the same fixes. If `filterFixes` uses lookahead, the live pass is causal by design and the summary recomputes from raw fixes (PLAN 8a already says every derived number is recomputable). Check causality first.
- 7,200 fixes (2 h at 1 Hz) pushed one at a time: under 1 ms per push on the phone.
- Replay of a 2 h recorded track in an instrumented test produces no cue gap over the configured interval.

**R2. `core` math.** Units, rounding (`roundWeight`), plates (`planPlates` knapsack, `nearestLoadable`, shorthand), `describeChange`. Can run in parallel with R1 since the phone UI wants plates first and the engine needs rounding.
Accept: every `core` test as a vector; `plates_test.ts` cases including "245 lb on a 45 lb bar", the one-pair-of-45s case and the unreachable target; fuzz 1,000,000 random targets against Deno with zero mismatches.

**R3. `engine`.** State, decay, e1rm, Kalman, readiness, volume, rest, warmup, running cross-modal, then the four public functions.
Accept:
- Every test in `engine` (62 declarations plus hybrid, crossmodal, validation) as vectors, including the spec's 3-week validation test and the synthetic Kalman recovery within the same tolerance.
- `EngineState` JSON round-trips byte-identical after canonical key ordering.
- Differential fuzz of `roundWeight`, `doubleProgression`, `e1rm` and the rest-timer multiplier over 1,000,000 inputs with half-integers, negatives and DST and month-boundary dates: zero mismatches.
- After 10 on-target early taps at 90 s with B 120, `m` equals 0.75 + 0.25 x 0.9^10 (0.837) within 0.001 (PLAN 6.6).

**R4. `generator` (deferred).** No phone consumer. Revisit after R3. If done: vectors compare emitted liftoscript text exactly, and parse-and-evaluate remains a TS check on the output.

**R5. liftoscript.** Section 8. Starts after R0 and runs in parallel with R1 to R3; the phone's lifting screens depend on it.

**R6. `llm`.** Stays TS. Server-side route for the phone (S14).

## 8. Liftoscript plan

This is a real project. Scope it to the evaluation path, because the phone doesn't author programs (PLAN 3). `packages/liftoscript` is about 24k lines, but most of that is not on the evaluation path.

**Port (about 9 to 11k lines of logic):**
- Two lexers and parsers from the 95-line `liftoscript.grammar` and the 80-line `plannerExercise.grammar`.
- `liftoscriptEvaluator.ts` (1,408), `liftoscriptFns.ts`, `parser.ts` (`ScriptRunner`).
- `plannerExerciseEvaluator.ts` (1,427), `plannerEvaluator.ts` (1,254), the evaluate half of `plannerProgram.ts`, `plannerProgramExercise.ts`.
- On the model side: `program.ts` (`Program_nextHistoryEntry`), `progress.ts` (script bindings and functions), `weight.ts`, `set.ts`, `programSet.ts`, `programExercise.ts`, `utils/*`.
- `runtime.ts` (681), the Qala adapter, which is the seam the engine feeds.

**Don't port:**
- `exercise.ts` (5,172) is mostly the seed database (211 entries in the TS source; PLAN 3 says 422, which may count equipment variants). Export it once to JSON from Deno and load it with serde.
- Authoring stays TS on the desktop: the 17 `PlannerStructure_*` mutators (1,919), `programToPlanner.ts` (1,163), `plannerExerciseEvaluatorText.ts`, `plannerExerciseStyles.ts`, `exerciseImage.ts`, `dialog.ts`, `storage.ts`.
- Confirm this split with a grep of what `apps/web/src/shell-desktop/ProgramEditorPage.tsx` imports against what `runtime.ts` uses before starting.

**Structure.** The vendored-upstream rule (same file names as liftosaur so diffs stay readable) ends for the new Rust code. The Rust crate is organized by responsibility in small modules (`lexer`, `parse_script`, `parse_planner`, `eval_script`, `eval_planner`, `weight`, `progress`, `runtime`, ...), not mirrored from the TS layout. The TS copy stays vendored and untouched as the oracle and the desktop's authoring runtime. Record the vendored upstream commit in `NOTICE` or a `VENDORED` file if it isn't already recorded; upstream fixes after that are tracked in a list and ported by hand when you ask.

**Parser.** Hand-written lexer plus recursive descent per grammar, producing a typed AST whose node kinds mirror the grammar rule names. Not an emulation of Lezer's generic tree. Error-recovery fidelity is low priority: programs reach the phone already validated by the desktop editor, which keeps Lezer. Two quirks to handle on purpose:
- The planner lexer is context-sensitive. `ExerciseName` is `NonSeparator+`, and the `@precedence` blocks decide `Weight` over `Keyword` and `SetTimer` over `Int`.
- In the liftoscript lexer, `IncAssignment` must win over `Plus`, and `Percentage` over `Number` over `Plus`.

**Oracle first.** Before porting, write `scripts/golden_liftoscript.ts` (Deno) that dumps canonical JSON into `testdata/golden/liftoscript/`:
- for each of the 60 built-in programs, the result of `forceEvaluateText` (the same call `tests/builtins_test.ts` makes, with `qalaSettingsToLiftoscript` settings);
- `Program_nextHistoryEntry` across several days;
- `runFinishDayScript` and `runAllFinishDayScripts` with synthetic completed sets, covering the GZCLP progression in `tests/gzclp_test.ts` (501 lines);
- `createEngineBindings` and `evaluateQalaProgram` from `runtime.ts`.
Check what the TS tests actually assert so the dump covers the same shape.

**Acceptance.**
- All 60 built-in programs evaluate to canonical JSON identical to the oracle, with no errors.
- The GZCLP progression matches over several simulated sessions.
- A differential fuzz of generated expressions, set schemes and `progress:` scripts matches the oracle with zero mismatches.
- A plan for the desktop: expose the Rust parser to wasm so the CodeMirror editor reports the same diagnostics. Keep Lezer for highlighting and bracket matching; diagnostics come from Rust as `{from, to, message}` with UTF-16 offsets (Rust gives byte offsets, so convert or markers drift on non-ASCII text).

**Rust-specific traps.** Use `js_round` (`(x + 0.5).floor()`) wherever TS uses `Math.round`. Write `js_number_to_string` for number-to-string (JS prints `1` and switches to exponent form at 1e21 and 1e-7, `-0` prints `0`), and `js_to_fixed` (JS rounds on the exact decimal expansion). Follow `Number()` rules where strings are parsed. Avoid `HashMap` iteration order in any output; TS object insertion order maps to an ordered map. Check `==` on weights and percentages for JS coercion.

**Estimate.** 3 to 5 weeks for a conformant port of the evaluator and planner, mostly bug-for-bug matching (research agent's estimate, not mine). It is the largest single item in the plan.

## 9. Golden vectors

Files under `testdata/golden/<package>/<function>.json`:

```json
{ "fn": "round_weight", "version": 1, "oracle": "ts",
  "cases": [ { "name": "half-integer negative", "input": {...}, "expected": {...}, "tolerance": 1e-9 } ] }
```

- Generated by `scripts/golden_gen.ts` (Deno) from the existing TS tests and from seeded random inputs. Checked in. A case edited by hand gets `"oracle": "manual"` and a reason.
- Compared at 1e-9 for floats, exactly for integers and strings, with a per-function override documented in the file.
- Consumers: Deno tests (wasm), `cargo test` (reads the files directly), Kotlin instrumented tests (Gradle copies them into assets).
- Must include: half-integers, negatives, zero and negative zero, the DST and month boundaries, the 10-tap rest timer sequence, a 2 h track.
- When TS and Rust disagree, TS is the oracle until someone reviews the case and edits the vector.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Rust and JS disagree on rounding, `toFixed`, libm last-ulp (exp, ln, pow) | `js_round`, `js_to_fixed`, 1e-9 tolerance, differential fuzz in R2 and R3. Check Kalman and decay paths for libm calls before promising bit equality. |
| Three build systems (NDK, wasm-bindgen CLI, wasm-opt) drift | Pin versions in `rust-toolchain.toml` and `Cargo.lock`, tasks in `deno.json`, check in a `docs/` build note. |
| arm64 size, 16 KB alignment, call cost unmeasured | R0 gate. |
| Concurrent edits to one field lose a write | Acceptable for one person; keep the loser in a history table later if it matters. |
| New sync and blob routes expose data if auth is missed | Every new route calls `requireUser`; test unauthenticated requests get 401. |
| Liftoscript port is the largest item and could slip | Oracle first, start early, quickjs-kt stopgap only if the schedule forces it. |
| Debugging across three runtimes | One golden vector set that every host runs. |
| Rust becomes a maintenance burden | Rust only for logic that must match across hosts. UI, networking, storage, services stay Kotlin or TS. |

## 11. What this amends

- S1 (TypeScript throughout) becomes TypeScript plus Rust for shared logic.
- S2 (Capacitor 8 wrapper) is superseded by the native Kotlin app.
- S3 (one automerge document) is replaced by record sync, S8 and S11.
- S4 (visx and uPlot) applies to the web only; Android charts are S10.
- PLAN 8a and 14: the phone gates (2 h locked-screen recording, TTS ducking) stay as written and now run against the Kotlin app.
- The "recording writes to the local document continuously" constraint, for tracks, per section 5.
