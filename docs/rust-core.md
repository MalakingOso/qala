# Rust core: migration plan

Status 2026-10-13: in progress. Built and merged: LS++ (R5, section 8); `qala-core` with the engine port (state, decay, e1RM, Kalman, running, readiness, `log_session`, `calibrate`), availability, HLC, the record types, the history-to-engine adapter, the Today numbers, and plate math with rounding (2026-10-13, vectors in `testdata/golden/plates`), all exported to Kotlin through `qala-ffi`. Built on branch `r1-run` (2026-11-11, not merged yet): the run pipeline and `RunRecorder` (R1, section 7). Not built: the engine's volume, rest and warm-up modules and `recommend_next_session` (the rest of R3), record sync and blob routes on the server, and the generator (R4, deferred). Read with `docs/android-native.md` (the Kotlin app). Section 12 is the LS++ language reference (it replaces the old `ls-plus-plus.md`). Open questions are the appendix. Decision rows are DECISIONS S6 to S17, plus S18 to S21 for LS++ and S22 for accounts (S22 will change the auth sentences in sections 4 and 5 when it ships; `docs/plan-accounts-logins.md` 10). Revised 2026-09-30 after the owner asked for liftoscript in Rust and asked whether something beats Automerge: Automerge is out, record-based sync is in (section 4), and there is no quickjs interim (section 6).

## Status note

The LS++ port landed 2026-10-01 and was approved as built 2026-11-11 (D09). It matches the TS oracle on all 60 built-in programs in lb plus 5 in kg, on `Program_nextHistoryEntry` and the finish-day scenarios, and on both parsers for valid input. Two divergences are deliberate and kept: `MAX_SETS = 30` caps `numberOfSets` in Rust where TS allows any count, and native readiness decays to an explicit `now` (DECISIONS S26). Exact normalizations and the FFI and wasm status are in section 12. Run Rust tests only through `scripts/cargo-test-safe.sh`.

## 1. Conclusions

1. Build a Rust workspace for the logic that has to behave identically on the phone, the web and the server: run pipeline, math (rounding, units, plates), engine, and the LS++ evaluation path. The TS oracle was deleted on 2026-11-12 (DECISIONS S28); the goldens it left are frozen fixtures.
2. Drop Automerge. Sync becomes immutable records with UUIDs, last-write-wins per field with a hybrid logical clock, and plain HTTP with the server as authority (section 4). The Rust core never holds a synced store; it takes state in and returns state out as JSON.
3. Raw GPS fixes never go through sync as records. They live in Room on the phone and upload as immutable content-addressed blobs (section 5). This amends the constraint "run recording writes to the local document continuously".
4. LS++ is the Rust port of liftosaur's liftoscript, evaluation path only (about 9 to 11k lines of logic, reorganized into small modules, not a mirror of the TS layout). There is no quickjs interim: the phase order puts the port ahead of the phone's lifting screens (section 6). Built and merged; section 12 below is the language reference now.
5. Defer the generator port (owner, 2026-10-14). The phone will later pull generated workouts from the server, which runs the TS generator, so the generator still has no consumer that needs it in Rust.
6. Rust is the reason the foreground service can run guided cues with the screen locked: there is no WebView and no JS there. That is why the run pipeline goes first.

## 2. Inventory (2026-09-30 snapshot)

Counts from `packages/` when the port was scoped. `liftoscript` was 24,344 source lines (mostly off the evaluation path), `engine` 2,552, `generator` 2,645, `run` 1,534, `core` 1,290 and `llm` 940. No package imported Automerge. About 45 `Math.round` and `toFixed` sites and about 42 `Date` uses across core, engine, run and generator are where Rust and JS can disagree, which is why section 3 has the `js_round` rule. At the time the phone called only `core/plates.ts`; the rest was greenfield wiring. Current state is section 7, not this table.

## 3. Architecture

```
crates/
  qala-core/      pure logic, no I/O, no clock, no threads
    js.rs         js_round, js_to_fixed, number parsing helpers
    run/          filter, pauses, splits, pace, guided, load, recorder
    math/         units, rounding, plates
    engine/       state, decay, e1rm, kalman, readiness, volume, rest, warmup, running
  qala-ffi/       UniFFI proc-macro exports (Android)
  qala-wasm/      wasm-bindgen exports (web, Bun)
  qala-lspp/  from R5, section 8
```

The 2026-09-30 spike (see `docs/archive/completed.md`) was throwaway. The real crates are written fresh against the golden vectors.

As built (2026-10-13): `qala-core`, `qala-ffi`, `qala-lspp`, `qala-lspp-json` and `qala-lspp-wasm`. `qala-lspp-ffi` was folded into `qala-ffi`. There is no `qala-wasm`: `qala-core` has no wasm shim. The LS++ wasm build (`qala-lspp-wasm`) is loaded since 2026-10-14 by the desktop editor (`apps/web/src/lspp/load.ts`) and the server (`server/lspp.ts`), from one `--target web` build in `target/wasm-out/web/`, through the typed client in `packages/lspp`. The wasm isn't committed: `bun run build:wasm` makes it, and the editor and the server run without it (the editor's checks go off, the import route answers 500 until it is built).

**Boundary.** Each exported function takes and returns a JSON string with a top-level `"v": 1`. Columnar fix data (the hot path) was planned to use one `ByteArray` or `Float64Array` of little-endian f64 columns, matching the existing delta-encoded track layout. The spike showed UniFFI boxes `Vec<f64>` per element, so large arrays never cross as lists. R1 does not need it: the recorder takes one fix as a JSON string per push, and recovery replays fix by fix. Add a byte array only if replaying a long run measures slow.

**Public API.** The four functions from PLAN 6, plus run and math:

- `log_session(state, workout) -> state`
- `predict_readiness(state, checkin, now) -> readiness`
- `recommend_next_session(state, context, now) -> recommendation`
- `calibrate(state) -> state`
- `RunRecorder`, built (R1): `new(config)`, `push_fix(fix) -> {events, live}`, `advance() -> {events, live}`, `finish() -> processed run`, plus the stateless `process_run(fixes, opts)`. No separate `snapshot()`: every push returns the live numbers.
- `plan_plates`, `nearest_loadable`, `round_weight`

**`RunRecorder` as built (R1, 2026-11-11).** The first stateful export (DECISIONS S27): a UniFFI object holding `qala_core::run::Recorder` behind a mutex, an exception to "state in, state out" because a JSON round trip of the whole state per fix would cost more than the push. Requests and results are in `qala_core::run_api`; `Opts` is `{filter, autopause, splits, splitM, workout, guided, cues}`, all optional.
- `push_fix` takes `{v, t, lat, lon, acc, hr?, cad?, ele?}`. One push appends zero to `reanchorCount` points (a re-anchor flushes the buffered fixes that agreed), and each point goes through the auto-pause clock, the guided machine and the periodic cues in order against the prefix ending at it. It returns `events` (guided events and `distanceCue`/`timeCue`, one `type` discriminator) and `live`: point count, distance, moving and elapsed time, the 20 s pace, the 30 s cue pace, the average pace, the auto-pause state, the current guided step with what is left of it, and whether the workout is complete. Per-push work is O(1) in the track length apart from two binary searches (the pace windows).
- The periodic cues (every N metres, every N moving seconds; the app converts the user's 0.5 or 1 mile setting) have no TS original: Rust is the definition (S6: Rust is the main implementation) and `run/cues.rs` tests are the spec. Counters only move forward, so the clock stepping back cannot repeat a cue, and a push that crosses several marks reads out the latest once. They are a separate stream from the guided events and never change the processed run.
- `advance()` ends an open-ended guided step (or skips one) at the last point's distance and the causal clock, with no wall time; before the first accepted fix, with no workout, or after the workout completes it does nothing. A replay of stored fixes cannot know about an advance, so recovery must replay the advances too: the foreground service persists them (A2).
- `finish()` returns the batch `ProcessedRun` and is repeatable; a push or `advance` after it is an `Evaluation` error. `process_run` is "push every fix, then finish", so the live and batch passes cannot drift.
- Non-finite numbers are an error at this boundary (JSON cannot carry them anyway); the inner functions drop a non-finite fix as TS does. Unknown option keys are an error, so a typo cannot fall back to a default.

**Hard rules for the core.** These are rules, not notes.

1. `js_round` everywhere TS uses `Math.round`: halves round toward +infinity, computed as `floor(x)` plus one when `x - floor(x) >= 0.5`. Rust's `f64::round` rounds half away from zero and diverges for negative halves (the spike hit it on -6.25). Do not write it as `(x + 0.5).floor()`: the addition rounds up for `0.49999999999999994` and for odd integers at or above 2^52, where `Math.round` does not.
2. Time enters as `i64` epoch milliseconds plus a UTC offset in minutes. The core never constructs a date or reads a clock. Day boundaries and DST are computed from the offset the caller supplies.
3. No `HashMap` iteration order in any output. Use `BTreeMap` or `Vec`.
4. `f64` only, no `f32`. Never `mul_add`. No `rayon`.
5. Non-finite numbers are an error at the boundary. `serde_json` writes NaN and Infinity as `null`, and a round trip does not restore them.
6. `toFixed` is ported deliberately (JS rounds on the exact decimal expansion), and number parsing follows `Number()` rules where strings enter.
7. Panics are `abort` in release, so every exported function validates input and returns an error value instead of panicking.

**Toolchain.** `rust-toolchain.toml` pins 1.94.1 (what is installed on this machine; the throwaway spike used 1.98.1 from a scratch rustup). The wasm-bindgen CLI is pinned to the crate version in `Cargo.lock` (0.2.129 today). Run `wasm-opt -Oz` in the wasm build (the script does when it is on PATH; it isn't installed here, so the build is 1.5 MB unoptimized). The wasm target and CLI are one-time user-level installs: `rustup target add wasm32-unknown-unknown --toolchain 1.94.1` and `cargo install wasm-bindgen-cli --version 0.2.129 --locked`. Release profile as in the spike: `opt-level = "z"`, LTO, `codegen-units = 1`, `panic = "abort"`, `strip = true`. There is no CI workflow in the repo, so the gates are commands you run locally: `bun run test`, `scripts/cargo-test-safe.sh`, and `bun run build:wasm`.

## 4. Sync: records, not a CRDT document

**Decision: replace Automerge with record sync.** This supersedes S3's mechanism (one automerge document per user over WebSocket) and keeps its intent: offline-first on two devices, Tailscale identity for auth. S3 was your call from the first interview, so this is a proposal.

Why: Automerge is built for many writers merging freely. You are one person on two devices, rarely editing the same thing at once. What it cost us on the Android side: a 0.0.x JNI binding, a hand-written CBOR protocol, no confirmed way to turn a document into JSON for the engine, and a second Automerge copy anywhere Rust wanted to read state. It also forced raw tracks out of the document (they would have made it unusable), which record sync handles without a special case. The web sync layer was never built and no `data/` directory exists on this machine, so nothing needs migrating.

**Model.**
- Every entity is a record: `id` (UUID), `type`, `fields`, `deleted`. Each field carries its own hybrid logical clock value `(wallMs, counter, nodeId)`.
- Sessions, sets, runs and engine inputs are created once and then immutable. Edits (session notes, PR-flag dismissal, exercise notes, settings, program text) are field writes. For two writes to the same field, the higher HLC wins. Settings are one record per group, each leaf a field. A program's text is one field; it is edited only on the desktop, so conflicts are not a real case.
- `engineSnapshots` is a derived cache, rebuildable from history (PLAN 7). It is not synced; each device rebuilds it (decided 2026-11-11, D08). That removes the need to write engine state anywhere shared.

**Protocol.** `POST /api/sync` with `{ since, changes: [...] }` returns `{ cursor, changes: [...] }`. The client sends its local changes and receives everything newer than its cursor in one round trip. The server assigns a monotonically increasing sequence number per user; applying a change is idempotent on `(recordId, field, hlc)`, so retries are safe. Auth is the existing Tailscale identity header through `requireUser`; Origin is ignored. The server stores per user in SQLite (decided 2026-11-11, D06; check `bun:sqlite`, otherwise an append-only file). Sync runs in the foreground on app open, run end, workout end, and any in-app change such as a history edit; no background sync in v1 (decided 2026-11-11, D06).

**Clients.** Room on Android; IndexedDB on the web (replacing the `localStorage` outbox, `offlineQueue.ts` becomes the upload queue's shape). HLC compare, tick, receive and field merge live in `qala-core` (`hlc.rs`) with golden vectors in `testdata/golden/hlc/`. Kotlin calls them through UniFFI; the web and the server replay the same vectors when the sync endpoint is built (DECISIONS S11).

**Clock skew.** HLC keeps the clock monotonic per device. The server rejects a write whose wall time is more than a day ahead of server time, so a bad phone clock can't win every future conflict.

**What this costs.** `server/sync.ts` and `server/ws.ts` (and their tests) are replaced, the `@automerge/*` dependencies leave `server/` and `apps/web`, and the Kotlin and web clients are new work. It is less work than a CBOR protocol client and a document hydrator. Concurrent edits to the same field lose one write silently; decided 2026-11-11 (D06) for one person, with the loser kept in a small history table later if it ever matters.

**Alternatives rejected.** Automerge with an OkHttp CBOR client (the earlier plan); samod over UniFFI (experimental); Loro or Yjs (no maintained Kotlin package found); cr-sqlite (low activity).

## 5. Raw tracks

Decided 2026-11-11 (D07): approve as written. At 1 Hz, a run is about 3,600 fixes an hour across five or six columns. Fixes are not sync records; syncing them as fields would bury the store in tiny rows.

- On the phone, each fix is written to Room (WAL, one insert per fix, `INSERT OR IGNORE` on `(runId, fixTimeMs)`) from a dedicated thread. That is the continuous, crash-safe local record.
- The run record holds the summary (distance, moving time, splits, elevation gain, HR aggregates) plus `trackBlobId`, the content hash of the encoded track.
- Tracks upload as immutable, content-addressed blobs (`PUT /api/blobs/<hash>`, `GET` to fetch), resumable, after the run ends or the app is next online. The desktop fetches a blob when it draws a map or chart.

`core/schema.ts` currently puts `track` arrays inside each `RunSession`. That moves to the blob, a `schemaVersion` migration in `packages/core/migrations.ts` that lands before any sync ships. Route matching (DECISIONS R5) runs on the server over stored raw fixes: the blobs are exactly that.

New server routes need real auth. Today only `/sync` calls `requireUser`; `/api/llm/chat`, `/api/elevation` and `/tiles` rely on the tailnet. Sync and blob routes must call `requireUser` and key everything under the user's id.

## 6. LS++ on the phone

PLAN 10: check-in, then `predict_readiness`, then bindings, then program evaluation, then the workout screen, at workout start, possibly offline. The phone evaluates programs with the Rust port from section 8. There is no interim runtime.

Because the phone's lifting screens (phase A4) need it, the LS++ port starts as soon as R1 and R2 have set up the workspace, in parallel with the phone's run and sync phases, which don't depend on it. Landed 2026-10-01, ahead of A4; the quickjs-kt stopgap below was never needed. It was: embed quickjs-kt with a bundle of the TS package (0.9 MB, measured by research; one maintainer; unverified on our bundle). Don't build it unless the schedule forces it.

Also stays TS: `packages/llm` (owner, 2026-10-14). It needs the network (the model runs on callisto), so offline use is moot. A server route builds the prompt and validates the response; the phone's Coach tab calls it (S14).

## 7. Porting order and acceptance

Each step leaves the TS package in place and passing. A Rust module counts as done only when every acceptance line is met against golden vectors (section 9).

Status by step, 2026-10-14:

- R0 is partly done. `qala-core`, `js.rs` and the `qala-ffi` shim exist and build for Android. There is no wasm shim for `qala-core`, so the server and web legs of the round-trip acceptance have not been run.
- R1 (`run`) was built 2026-11-11 and merged to main 2026-11-12: `qala-core/src/run` (geodesy, filter, auto-pause, splits, pace, guided, cues, recorder), `run_api`, the `RunRecorder` object in `qala-ffi`, and `QalaCoreRun.kt`. Vectors are in `testdata/golden/run` (806 cases across eight files, from a generator deleted 2026-11-12, S28; the load helpers' vectors are appended to `testdata/golden/engine/running.json`); every case also runs with the trig functions one ulp off in the generator, and none flips a decision. A differential fuzz (1,000,000 geodesy pairs and 20,000 random fix streams, since deleted with its corpus, S28) replayed with zero mismatches. Two things came out of it. The guided clock is now causal (below). And the old TS filter broke across the antimeridian (the local-metre frame has no longitude wrap, so the filtered track jumps and distance explodes); Rust matches it bug for bug and one vector pins it. Only the Rust side is left to fix. Libm: the host's glibc matches V8 bit for bit in position and speed (and 83% of distance steps, worst 6e-12); the pure-Rust `libm` crate matched worse (worst 8e-10) because V8's `sin` and `cos` come from glibc, so `run/trig.rs` calls the platform libm and is the one file to change if a target exceeds 1e-9. On the x86_64 emulator (bionic) the 2 h replay differs from the TS vector by at most 2.5e-10 relative in `distM` and not at all in position and speed; an arm64 phone is unmeasured. Numbers: 7,200 pushes cost 0.4 us each on the host (test profile) and 183 us on average on the x86_64 emulator including the JSON round trip (p99 0.4 ms, one 1.4 ms spike); the under-1 ms figure on the phone waits for the phone pass (D15). HR zones (R6) are not built, and GPX, TCX and XML stay in TS, so `packages/run` stays for now. "Matches to 1e-9" is loosened in four places, all stated in `testdata/golden/run/README.md`: an absolute floor of 1e-9 (the engine files use 1e-12), `2e-8` over the length in metres for Vincenty segments under 20 m, 1e-7 within a metre of the antipode in the fuzz, and 1e-6 in the emulator test.
- R2 (`core` math): plates, `round_weight` and `describe_change` are ported with vectors (`testdata/golden/plates`). A 1,000,000-case differential fuzz against the TS (generator, corpus and replay test deleted 2026-11-12, S28) had zero mismatches (2026-10-14). It found three Rust bugs, now fixed and kept as golden vectors: an integer overflow and a wrong nearest load for targets past 2^53 units or infinite, and non-JS number formatting in `describe_change` and `plates_shorthand` (`inf`, no exponent form from 1e21).
- R3 (`engine`): ported are state, decay, e1RM with the RTS table, Kalman, running, readiness, `log_session` and `calibrate`, with vectors in `testdata/golden/engine`. Native readiness decays to an explicit `now` (DECISIONS S26). Not ported: volume, rest, warm-up and `recommend_next_session`. Rest and warm-up planning shipped in Kotlin instead (merged 2026-10-13; D32 asks whether they move). A 1,000,000-case e1RM fuzz (`observe_set`, `best_observation`, `rts_lookup`) and a 500,000-case date, decay and readiness fuzz (`days_between`, `add_days_key`, `critical_speed`, `prs_z_score`, readiness with and without decay to `now`, across DST, month, leap and year boundaries) had zero mismatches against the TS (2026-10-14; the fuzz was deleted with the oracle, S28); the only differences are one-ulp `exp` noise inside the 1e-9 tolerance. The R3 fuzz line is met for e1RM and decay only: its `roundWeight` (the one in the deleted TS `engine/volume.ts`), `doubleProgression` and the rest multiplier aren't ported, so they aren't fuzzed.
- R4 (`generator`) is deferred. R5 (LS++) is done. R6 (`llm`) stays TS.

**R0. Foundations.** Workspace, pinned toolchain, `js.rs` helpers, the vector generator and format, `qala-ffi` and `qala-wasm` shims with a `version()` call, `package.json` scripts.
Accept: one trivial function round-trips the same vector through `cargo test`, Bun wasm, and a Kotlin instrumented test on the phone. arm64 `.so` under 2 MB stripped, 16 KB aligned.

**R1. `run`.** Geodesy (Vincenty, haversine), `filterFixes`, `computePauses`, `computeSplits`, pace windows, `GuidedRun`, load (GAP, rTSS, VDOT, Riegel). Then the new incremental `RunRecorder`: `push_fix` returns live numbers and cue events, and `finish` returns the batch `ProcessedRun`. Leave GPX, TCX and XML out: the task listed exporters under the old `packages/run` (deleted, S28), but nothing on the phone exports files (they serve the desktop and the server), so porting them adds Rust surface with no consumer. Say so if you want them ported anyway. HR-zone coaching (DECISIONS R6) extends `guided.ts` and isn't built yet: build it once, in whichever language `guided` lives in when you get to it, and add its vectors then. Don't build it in both.
Accept:
- Every `run` test input becomes a vector and matches to 1e-9 (exact for integers and strings).
- The recorder fed fix by fix produces cue events and final splits identical to the batch `processRun` over the same fixes. Amended 2026-11-11 (owner): `filterFixes` has no lookahead, but the old batch pass fed `GuidedRun` a clock built from whole-run pauses, which a live recorder cannot know. The guided clock is now the moving time known at each fix (closed pauses plus the open pause back-dated to its start); it steps back up to 5 s when a pause is confirmed, which the `>=` step checks tolerate. So batch equals push every fix then `finish()`, the events for the first k fixes are a prefix of the events for all of them, and a recovery replay gives the same cues. Met: the recorder tests push every whole-run vector fix by fix and match the TS result.
- 7,200 fixes (2 h at 1 Hz) pushed one at a time: under 1 ms per push on the phone.
- Replay of a 2 h recorded track in an instrumented test produces no cue gap over the configured interval.

**R2. `core` math.** Units, rounding (`roundWeight`), plates (`planPlates` knapsack, `nearestLoadable`, shorthand), `describeChange`. Can run in parallel with R1 since the phone UI wants plates first and the engine needs rounding.
Accept: every `core` test as a vector; `plates_test.ts` cases including "245 lb on a 45 lb bar", the one-pair-of-45s case and the unreachable target; fuzz 1,000,000 random targets against the TS with zero mismatches (done, then deleted with the oracle, S28).

**R3. `engine`.** State, decay, e1rm, Kalman, readiness, volume, rest, warmup, running cross-modal, then the four public functions.
Accept:
- Every test in `engine` (62 declarations plus hybrid, crossmodal, validation) as vectors, including the spec's 3-week validation test and the synthetic Kalman recovery within the same tolerance.
- `EngineState` JSON round-trips byte-identical after canonical key ordering.
- Differential fuzz of `roundWeight`, `doubleProgression`, `e1rm` and the rest-timer multiplier over 1,000,000 inputs with half-integers, negatives and DST and month-boundary dates: zero mismatches. (The `roundWeight` named here is the deleted TS `engine/volume.ts`'s, which isn't ported; `packages/core/rounding.ts`'s is covered under R2.)
- After 10 on-target early taps at 90 s with B 120, `m` equals 0.75 + 0.25 x 0.9^10 (0.837) within 0.001 (PLAN 6.6).

**R4. `generator` (deferred, owner 2026-10-14).** No Rust consumer: when the phone gets generated workouts it pulls them from the server, which runs the TS generator. Revisit after R3. If done: vectors compare emitted liftoscript text exactly, and parse-and-evaluate remains a TS check on the output.

**R5. LS++.** Section 8. Starts after R0 and runs in parallel with R1 to R3; the phone's lifting screens depend on it. Done and merged.

**R6. `llm`.** Stays TS. Server-side route for the phone (S14).

## 8. LS++ plan, as built

Status 2026-11-11: built, merged and approved as built by the owner (D09); the TS package was deleted 2026-11-12 (S28). Section 12 is the language reference.

The port covers the evaluation path only, about 9 to 11k lines of logic: both parsers, the script and planner evaluators, `program.ts` progression entry points, `progress.ts` bindings, `weight`, `set` and the Qala `runtime.ts` adapter. Not ported: the exercise database (exported once to JSON), and authoring, which stays TS on the desktop (the `PlannerStructure_*` mutators and `programToPlanner`). The Rust crate is organized by responsibility in small modules, not mirrored from the TS layout. The vendored upstream commit was `5a73c877ea` (named in NOTICE); upstream is not followed (DECISIONS S17).

Oracle first, as built: the oracle script (deleted 2026-11-12, S28) dumped canonical JSON for all 60 built-ins, `Program_nextHistoryEntry`, the finish-day scripts including GZCLP, and the engine bindings, into `testdata/golden/lspp/`. Acceptance was all 60 matching with no errors, the GZCLP progression matching over simulated sessions, and a differential fuzz with zero mismatches. The desktop editor now draws this parser's diagnostics through wasm, with UTF-16 offsets converted on the Rust side. Rust traps (`js_round`, `js_number_to_string`, `js_to_fixed`, ordered maps, JS `==` on weights) are section 3's rules; they apply here unchanged.

## 9. Golden vectors

Files under `testdata/golden/<package>/<function>.json`:

```json
{ "fn": "round_weight", "version": 1, "oracle": "ts",
  "cases": [ { "name": "half-integer negative", "input": {...}, "expected": {...}, "tolerance": 1e-9 } ] }
```

- Generated once by scripts from the existing TS tests and from seeded random inputs, then checked in. Those generators were deleted 2026-11-12 (S28), so the files are frozen fixtures: edit one by hand (give it `"oracle": "manual"` and a reason) or delete its test. (The LS++ goldens are documented in `testdata/golden/lspp/README.md`.)
- Compared at 1e-9 for floats, exactly for integers and strings, with a per-function override documented in the file.
- Consumers: Bun tests (wasm), `cargo test` (reads the files directly), Kotlin instrumented tests (Gradle copies them into assets).
- Must include: half-integers, negatives, zero and negative zero, the DST and month boundaries, the 10-tap rest timer sequence, a 2 h track.
- Rust is the main implementation (owner, 2026-10-14). TS is the reference only while a port is checked: when the two disagree, someone reviews the case and edits the vector. Once a package passes on every target its TS is deleted, and the checked-in vectors stay as Rust's regression suite.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Rust and JS disagree on rounding, `toFixed`, libm last-ulp (exp, ln, pow) | `js_round`, `js_to_fixed`, 1e-9 tolerance, differential fuzz in R2 and R3. Check Kalman and decay paths for libm calls before promising bit equality. |
| Three build systems (NDK, wasm-bindgen CLI, wasm-opt) drift | Pin versions in `rust-toolchain.toml` and `Cargo.lock`, scripts in `package.json`, check in a `docs/` build note. |
| arm64 size, 16 KB alignment, call cost unmeasured | R0 gate. |
| Concurrent edits to one field lose a write | Acceptable for one person; keep the loser in a history table later if it matters. |
| New sync and blob routes expose data if auth is missed | Every new route calls `requireUser`; test unauthenticated requests get 401. |
| The LS++ port was the largest item; it landed 2026-10-01. R2 and R3 (math, engine) are the remaining large ports | Oracle first, golden vectors on all three targets. The quickjs-kt stopgap is no longer needed for LS++. |
| Debugging across three runtimes | One golden vector set that every host runs. |
| Rust becomes a maintenance burden | Rust only for logic that must match across hosts. UI, networking, storage, services stay Kotlin or TS. |

## 11. What this amends

- S1 (TypeScript throughout) becomes TypeScript plus Rust for shared logic.
- S2 (Capacitor 8 wrapper) is superseded by the native Kotlin app.
- S3 (one automerge document) is replaced by record sync, S8 and S11.
- S4 (visx and uPlot) applies to the web only; Android charts are S10.
- PLAN 8a and 14: the phone gates (2 h locked-screen recording, TTS ducking) stay as written and now run against the Kotlin app.
- The "recording writes to the local document continuously" constraint, for tracks, per section 5.

## 12. LS++ language

Status 2026-10-30: built and merged, with leftovers. The name is decided (DECISIONS S18). The port and the S21 extensions are in `crates/qala-lspp`. The text import (S19) has its TS half merged (`POST /api/import/text`) and both front ends built on it (`POST /api/import/pdf`, `POST /api/transcribe`, dictation on the desktop) and run live 2026-10-30; see the ROADMAP Rust track for those rows. The wasm build is loaded by the desktop editor (checks, Format, dry run, `apps/web/src/lspp/load.ts`) and by the server (`server/lspp.ts`), from one build in `target/wasm-out/web/`. The import screen is `apps/web/src/shell-desktop/ImportPanel.tsx`; its confirm step posts `{ editList: { items }, resolutions, units }` back to the text route. Open: phone and Android mic capture (D36), equipment on imported lifts (D38), a blank weight with an RPE (D39), and suggestions for evaluation-time errors and fmt for standalone scripts. Decision rows are DECISIONS S18 to S21.

LS++ is liftosaur's liftoscript plus additive extensions. Programs are plain text. The frozen goldens pin the 60 built-in programs (S28), so every extension leaves them evaluating exactly as before.

### What already works

A set with no weight is valid, and the language already has a way to say "ask for the weight":

```
Split Squat / 3x8 ?+          -> askWeight: true, no weight
Split Squat / 3x8 0lb+        -> askWeight: true, weight 0 lb
Split Squat / 3x8             -> no weight, askWeight: false
```

The built-in `lp` script treats `weights[i] == 0` with a nonzero completed weight as an initial weight and builds on it. So a blank weight needs no language change: importers emit `?+`, the workout screen shows an empty required field, and the entered value becomes the starting weight.

A `?+` set that also carries an RPE is not blank (found 2026-10-30): the evaluator infers a weight from the 1RM through the RPE table, and `unresolved_sets` does not list it. With default settings that gave "Pull Up @ 0 lb" and "Bent Over Row @ 57.5 lb". The generator now writes `?+` alone and keeps the RPE in its note; the import emitter still writes `?+ / @8`. Whether `?+` should win over the RPE is D39.

### Language improvements (S21)

All additive, all built and merged (`32cb81c`). Error messages carry line, column, span and a one-line fix suggestion; note the TS evaluator returns `errors[]` rather than throwing, and its error lines are relative to the day block. TS also accepts `99999x8` where only Rust caps sets, so importers bound every number themselves. `fmt` is one canonical text form and never adds, removes or merges blank lines, because blank lines are meaningful to the evaluator; `fmt(fmt(x)) == fmt(x)` and `evaluate(fmt(x)) == evaluate(x)` over the 60 built-ins. Lint has four rules after checking the built-ins: `too-many-sets`, `unused-state`, `empty-program`, `mixed-units`. A read-only dry run shows upcoming weeks with no history written. Partial prescriptions (`?+`) are a state to resolve, not an error, and `unresolved_sets` lists the sets still waiting.

### Name and rename scope (S18)

Display name Liftoscript++, short form LS++, file extension `.lspp`. Crates and the wasm and Kotlin namespaces use `lspp` or `ls_pp`. Done: the crates are renamed (`415fb07`), goldens live in `testdata/golden/lspp/`, and NOTICE and the liftosaur credit were never touched. `qala_settings_to_liftoscript` and `liftoscriptSettings` keep the name because they build liftosaur's `ISettings`. Liftosaur programs stay importable; programs using LS++ extensions do not export back.

### Import: PDF and voice (S19)

One pipeline, two front ends. A small model never writes program text.

```
PDF  -> MinerU (layout, tables, scans) -> markdown chunks \
                                                            -> callisto agent, json_schema -> edit list
voice -> Gemma 4 E4B audio -> transcript                    /
edit list -> exercise matching (fuzzy, confirm ambiguous) -> emitter (LS++ text) -> parser + lint
          -> diff shown to the owner -> confirm -> applied
```

Merged (`8f5bd5c`): the edit-list schema, matcher and emitter in `packages/llm`, and `POST /api/import/text` in `server/import.ts`, with the confirm step on the same endpoint via `resolutions`. Built since and run live 2026-10-30: `POST /api/import/pdf` (`server/importPdf.ts`, chunking in `packages/llm/importChunk.ts`), `POST /api/transcribe` (`server/transcribe.ts`), and the desktop import screen. Open: equipment on imported lifts (D38). Neither PDF nor transcribe calls `requireUser`; they rely on the tailnet, capped at one in-flight read per identity when the header is present.

The edit list is the schema: day or week, exercise name, sets, reps, optional weight, RPE, rest, notes. A missing weight becomes `?+`. The model sees chunks, not the whole PDF (the callisto context is 8192 tokens): `chunkProgramText` splits on `Week N` and `Day N` headings into chunks of at most 3000 characters, `importChunks` runs them one at a time, and code owns the week and day numbers. One failed chunk fails the whole import. A merged list holds up to 600 items. Validation failures go back to the model once with the parser's messages, then to manual entry; a down or slow backend never blocks the user. "Split squat" is ambiguous, so the matcher asks.

PDF text is untrusted: the model only fills a fixed schema, nothing it returns is executed, and the owner confirms a diff. Caps are 10 MB and 40 pages, helper programs run from an argument array with a scrubbed environment and a timeout, and uploads are read with a byte cap counted while reading, a total deadline, a shared pool of four read slots and one per identity. MinerU runs on Sonoro; if it is down, `pdftotext -layout` stands in for born-digital PDFs with a notice, and scans fail clearly. MinerU is reached by running Sonoro's `sidecar/mineru_adapter.py` as a subprocess from `server/mineru.ts`, not through the sidecar's magazine `/ingest` route, which would send text off the machine. If that should become HTTP, the sidecar needs a raw `/mineru` route.

### Models (S20)

| Job | Pick | Why |
|---|---|---|
| PDF to text and tables | MinerU (Sonoro) | One path for text PDFs, tables and scans; already served. `pdftotext` is the degraded path. |
| Speech to text | Gemma 4 E4B with its mmproj (llama-server :8083) | One model covers dictation, page photos and extraction. Whisper.cpp is the fallback. |
| Edit-list extraction | Gemma 4 E4B on callisto, `json_schema` | Already the Qala agent. |

E4B accepts image and audio through its mmproj, but the callisto router loads it without one, so the mmproj build runs as its own llama-server on the B60 at :8083 (alias `gemma-4-E4B-mm`). Only the open-weight Voxtral Mini 4B Realtime would be self-hosted; Mistral's hosted Voxtral API sends audio off the machine and is not used.

Benchmark 2026-10-01: 20 synthetic gym clips, two Kokoro voices, a clip right only if every number is right. E4B 20 of 20 unprompted at about 0.85 s median; whisper.cpp 15 of 20 unprompted (spoken weights came out as times), 20 of 20 with an initial prompt of example weights, at about 0.4 s. Whisper adds punctuation, E4B does not. Neither has been rechecked on the owner's real voice in gym noise; that is V02 in `docs/decisions-pending.md`. Whisper stays on :8082 (`scripts/whisper-serve.sh`) as the fallback.

### Build order, as built

Rename done (`415fb07`). Error positions, `fmt`, lint, dry run and `unresolved_sets` done in Rust (`32cb81c`); `qala-ffi` exports all six S21 functions plus the evaluation calls, the Gradle build generates their Kotlin bindings, and `LsppToolsFfiTest` calls each one. No Kotlin wrapper uses them yet. Edit-list schema, emitter and validator done (`8f5bd5c`). `POST /api/import/text` merged, PDF and transcribe built and run live. `POST /api/transcribe` takes webm, ogg, mp4, mp3, flac or wav, caps 8 MB and 30 s, converts with ffmpeg and returns `{ text, engine, fallback }`; it returns the transcript only and the client calls `/api/import/text` next, so a misheard number is visible first. Desktop mic capture is built in the program editor with a 30 s cap; phone and Android capture are open (D36).

### Engine bindings

Added to `VScriptBindings` (`src/liftoscriptFns.ts`) as plain numbers, so the evaluator's type system is untouched:

| Binding | Range | Neutral | Meaning |
|---|---|---|---|
| `readiness` | 0-1 | 1 | Derived session readiness from the check-in. |
| `prs` | 0-10 | 0 | Perceived Recovery Status tap at session start. |
| `soreness` | 1-4 | 1 | Max RP soreness over the exercise's target muscles. |
| `fatigueLocal` | 0-1 | 0 | Normalised per-muscle fatigue for the prime movers. |
| `deload` | 0, 1, 2 | 0 | None, per-muscle reactive, systemic. |
| `recWeightPct` | -10 to 2.5 | 0 | Engine's recommended weight change, percent. |
| `recSets` | -2 to 1 | 0 | Engine's recommended set-count change. |

Semantics preserved from liftosaur: `progress: custom(state...) {~ ~}` runs once after the workout per exercise and may write `weights[...]`, `reps`, `RPE`, `timers`, `numberOfSets`, `rm1`, the variation indexes and `state.*`; `update: custom() {~ ~}` runs at `setIndex == 0` and after every set and writes only the current entry. Built-in progressions `lp(...)`, `dp(...)`, `sum(...)` are unchanged.

Wiring in the deleted TS oracle, mirrored by Rust through `qala-lspp-json`: `createEngineBindings(input)` in `src/runtime.ts` builds clamped bindings with the neutral defaults above; `createScriptBindings` and `applyEngineBindings` merge them before a run; `Progress_defaultEngineBindings()` in `src/models/progress.ts` is the single source of the defaults, so scripts reading a binding without the engine attached see neutral values, not errors; `runFinishDayScript` accepts `{ engine }` and `runAllFinishDayScripts` accepts `engineFor(entry)`. Oracle notes: `rollbar` and `utils/dialog` are stubbed to console output in `src/parser.ts`, `micro-memoize` is replaced by `src/utils/memoize.ts`, the exercise database and pure helpers are unchanged, `exerciseDescriptions.ts` (862 KB of prose) is skipped, and the Lezer grammars ship as liftosaur's prebuilt parsers with no codegen step.

## Appendix. Open questions

Collected 2026-09-30. Settled items are one line each; open items keep their default. The session queue for anything that needs an owner call is `docs/decisions-pending.md`, which wins if the two disagree.

Settled: phone shell frozen as a PWA (S13); Android only, no Compose Multiplatform, Compose kept out of `data/` and the core (2026-10-14); only tokens shared between the UIs; Rust only for logic that must match across platforms; TS deleted per package once its port checks out, Rust is the main implementation (S6); upstream liftosaur not followed (S17); tracks are blobs, not sync records (D07, S9); per-user SQLite and silent same-field loss (D06, S11); foreground sync only (D06); Fused location with `LocationManager` fallback, TTS ducking with tones fallback, resume silently with the gap marked (D11, S15); Gradle wrapper checked in; generator port deferred, the phone pulls generated workouts from the server (D36); Coach stays TypeScript behind a server route (S14).

Open, with the default the build assumes until told otherwise:

- targetSdk: 36 now, move to 37 after retesting the foreground service and ducking on Nothing OS 5.0 (D14). minSdk stays 34 unless another device appears.
- L5 check: does the phone track L5 (about 1176 MHz)? Part of the real-phone pass (D15).
- Testing: owner at gates only; the toolchain is provisioned (D15).
- HR strap: a standard 0x180D strap when one exists (D15).
- Charts: TalkBack plus a table view on every chart, hand-built for Canvas (D16). Vico plus Canvas split, with a run-series spike at 7,000 points (D13).
- Maps: downloaded region `.pmtiles`; glyphs and sprites bundled or served, and one pinned MapLibre native line (D12).
- Fonts and icons: DM Mono and Qala Test TTFs converted locally from the repo woff2; Lucide as generated Compose vectors, `sport-shoe` for runs. Both built, awaiting confirmation (D17).
- Process leftovers: Android on main with no long branch, the decision log written with the plan and approved through the queue, nothing else from the Stride review changing with Kotlin (D18).
- HR-zone coaching: build it once, in whichever language `guided` lives in then (D19).
- Rest and warm-up planning in Kotlin or Rust (D32, with PLAN section 6.6 and 6.7 as the TS reference).

