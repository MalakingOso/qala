# Roadmap

Where Qala stands and what comes next, in one place. Last checked row by row against main at `ee49107` on 2026-10-13; the rows touched by the 2026-10-14 merges are current to `625c99f`, and the rows touched on 2026-10-30 are current to that day's merges. Main was pushed to `origin/main` on 2026-10-30.

This file lists work that is decided or underway, by track, and links to the plan that holds the detail. It doesn't copy those plans. Choices still to be made are in `docs/decisions-pending.md` (grouped by what they block, below). Choices already made are in `docs/DECISIONS.md`. Every plan doc opens with a status line; if one disagrees with this file, fix both. `docs/README.md` indexes the rest of the docs.

## Where we are

The web build (desktop and the frozen phone PWA) is v1 and runs on sample data: `apps/web/src` has no `WebSocket` or IndexedDB call, and its only `fetch` calls are the import screen's and dictation's, to `/api/import/text`, `/api/import/pdf` and `/api/transcribe` (2026-10-30). The native Android app is the active work. On main it has the Rust core and FFI, the Room data layer, Today with the day rail, check-in, the skip sheet and status, the weekday picker, the plate calculator, and the lifting loop: Warm-up, Workout and Rest (a finished workout saves real sets and advances the program), Plan, History and All exercises, and the Coach screen. Run recording, sync and charts haven't started.

Everything on Android has run on the emulator only. The server still syncs through Automerge and trusts the Tailscale header. Accounts, record sync and blob upload are planned and unbuilt.

## Merge queue

Nothing in flight. Merged 2026-10-30: the generator emitter writing valid LS++ (`13200ec`) and in workout order (`d1c041b`); the desktop import screen and Generate next block wiring (`df49ff2`); the `LLM_GATEWAY_URL` seam (`8c9eb62`); two import fixes found by the live runs, the Barbell Row and Back Squat aliases (`8feabd3`) and the import prompt's weight and unit lines (`3c25d51`); the desktop Calibration, phone sample and Add exercise fixes (`6826f37`). Merged 2026-10-14: FFI exports, the vendored commit and the rename leftovers (`8e48051`); the LS++ wasm in the desktop editor and the server (`f5b88e5`); PDF and voice import (`e54e794`); the Coach route and Android screen (`90db3a6`); the `gen:lspp` memory fix (`86b6b15`); the flaky connected test fix (`6530def`); the `qala-core` differential fuzz (`625c99f`). Merged 2026-10-13, in order: `plates` (`ee49107`), `docs` (`d6837a3`), `workout` (`b5e9ae9`), `plan` (`e0e6a8d`), `history` (`17c4926`), and the deploy unit fix.

Beyond the queue, the order of work is the owner's call. The tables below give each item's state and what it waits on.

## Android app

Plans: `docs/android-native.md` (the app). The native refresh M1 to M4 is done; see `docs/archive/completed.md`.

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Toolchain, design system, shell (A0, A1) | done 2026-10-01 | android-native 9, 11 | |
| Capacitor removed (A7) | done 2026-10-01 | android-native 9 | |
| Rust core and FFI, Room data layer, Today with day rail, check-in, skip sheet and status, weekday picker (M1 to M4) | done, merged by 2026-10-03 | archive/completed | |
| Plate calculator | done 2026-10-13 | android-native 8 | |
| History and All exercises | done 2026-10-13 | one All exercises grid, opened from the Warm-up, Workout and Rest headers, live during a workout | |
| Warm-up, Workout, Rest | done 2026-10-13 | a finished workout saves real sets and advances the program through the finish-day scripts; per-side plates on the set rows and Rest; rest and warm-up planning is Kotlin, see the Rust track | |
| Plan screen | done 2026-10-13 | Start follows Today's stage order; "See what you did" opens History | |
| Flaky connected test | done 2026-10-14 | the `SlotTable` crash blamed on `AppContainerTest` came from the legacy `createAndroidComposeRule`, which recomposes on whatever thread sets a `StateFlow`, so the engine snapshot set on a worker thread raced the main thread. The eight UI tests now use the `v2` rule, which queues recomposition on the UI thread. Before: 3 of 9 full runs failed. After: 10 clean runs on the branch and 1 on main, each app 52 and data 23 with no race signatures in logcat. App code is unchanged | |
| Rest of Settings | done 2026-10-13 | Training status (Change opens the skip sheet, Set active), Units, bars, the editable plate inventory with the 55 lb row, equipment, warm-up and rest timer, all stored as settings groups and read by the plate calculator, set rows, Rest and the warm-up. Not built, with nothing behind them: Learn from taps, Alert, Check-ins, Running, Coach, Appearance (title font and theme) | |
| Navigation library choice | at the first real back stacks | android-native 3 | D20 |
| Run recording (A2) | not started | recorder service, Room fixes, HR, cues, the four gates in android-native 5; R1 is done on `r1-run` (merge first) | D11, D14, D15 |
| Record sync client (A3) | not started | the outbox, clock sidecar and HLC wrapper exist; no HTTP client | D06, D07, D22 |
| Charts, map, stats screens (A5) | not started | Session complete, Progress, Body; Vico plus Canvas, MapLibre | D12, D13, D16 |
| Coach screen (A6) | done 2026-10-14 | the Coach tab asks `POST /api/coach/ask` over `HttpURLConnection` and shows an unavailable state when the server is unreachable, degraded or answers 401; base URL is a BuildConfig field (`-Pqala.serverUrl=`); the thread is in memory only. Live run 2026-10-30, the route against `gemma-4-E4B` on the :8080 router: the golden request, a sore-knee question (a validated 5% cut, 245 to 232.5 lb, inside the limits), an off-topic ask and a bare "hi" (both declined) and a request with no identity (401) all answered as the contract says, in 1.4 s warm and 7.4 s cold. The phone itself was not pointed at the live server: with nothing in front of it to add the Tailscale header it gets a 401 by design until S22. Two things to know: the reply to "Why 245 on squat today?" was thin ("We are sticking to the planned weight") with the sore quads in context, and 232.5 lb can't be loaded with the default plates (D33). Owner questions: should "Use coach" change the workout's numbers; should a bare "hi" on an empty thread still be declined; should the base URL become a setting with S22 | |
| Release signing (A6) | not started | needs the owner's keystore | |
| Real-phone verification pass | next, needs the phone | the 2 h locked-screen run, Spotify ducking, a killed service resuming, the L5 check, and the A0 leftovers (Vico run-series spike). USB access is unset: it needs sudo for udev rules, and wireless debugging is untried | the owner's phone |

## Rust core and LS++

Plans: `docs/rust-core.md` (the core, and section 12 for the LS++ language).

| Item | State | Detail | Waiting on |
|---|---|---|---|
| LS++ port, S21 extensions, rename (R5) | done 2026-10-01, approved 2026-11-11 (D09) | rust-core 12 | |
| `qala-core`: engine, availability, HLC, records, adapter, Today numbers | done | rust-core 7 (R3 part) | |
| Plate math with rounding and golden vectors | done 2026-10-13 | `testdata/golden/plates` | |
| R1 run pipeline and `RunRecorder` | done on branch `r1-run` 2026-11-11, not merged | rust-core 3 and 7; golden vectors and a 1,020,000-case fuzz match the TS; Kotlin `RunRecorder` replays 2 h on the emulator with no cue gap; the under-1 ms-per-push figure waits for the phone pass | S27 |
| R1 follow-up: merge `r1-run` | open | seven commits on top of `main` `0aaa7ed`, pushed as a branch; fast-forwards onto `main`; nothing merged | the owner's OK |
| R1 follow-up: time the recorder on the phone | open | under 1 ms per push on arm64 and the bionic drift from the TS vector (x86_64 emulator: mean 182 us per push including JSON, worst 2.5e-10 in `distM`; `RunRecorderInstrumentedTest` logs both under `RunRecorderPerf` and `RunRecorderDrift`) | the phone pass, D15 |
| R1 follow-up: the TS filter breaks across the antimeridian | open, found 2026-11-11 | `toLocal` has no longitude wrap, so a run crossing 180 degrees jumps and its distance explodes; Rust matches it bug for bug and one vector in `testdata/golden/run/filter.json` pins it. Fix `filter.ts` and `run/filter.rs` together and regenerate the vector (`deno task golden:run`) | |
| R1 follow-up: persist manual `advance()` calls (A2) | open | a replay of stored fixes cannot know about an advance, so the foreground service stores each one with the fix it followed and replays it at the same point (android-native 5, Recovery) | A2 |
| R1 follow-up: HR-zone coaching (R6) | not built | extends the guided machine, which now lives in `run/guided.rs`: build it there once, add its vectors then, and do not build it in both languages | D19 |
| R1 follow-up: Deno and web legs | not started | `qala-core` has no wasm shim, so the round-trip acceptance in rust-core 7 R0 and R1 has only the cargo and Kotlin legs; nothing on the web calls the run code yet | |
| R1 follow-up: `packages/run` stays for now | open | gpx, tcx and xml stay in TS and import its types; delete the package once those move or their types are split out | |
| R1 follow-up: run vector tolerances | note | loosened in four places (1e-9 absolute floor, `2e-8` over metres for short Vincenty segments, 1e-7 near the antipode in the fuzz, 1e-6 in the emulator test) and the 4 h vector is stored as a generator with a sampled expected output; all in `testdata/golden/run/README.md`. If a target exceeds 1e-9, change `run/trig.rs` only | |
| R3 remainder: volume, rest, warm-up, `recommend_next_session` | not in Rust | rust-core 7 still puts them in Rust; rest and warm-up planning shipped in Kotlin (`app/.../workout/RestPlan.kt`, `Warmup.kt`, ports of `rest.ts` and `warmup.ts`); Rust port or keep Kotlin is the owner's call | |
| Differential fuzz for the R2 and R3 acceptance lines | done 2026-10-14 for the ported code | 1,000,000 plate cases (`deno task fuzz:plates`) and 1,500,000 e1RM, date, decay and readiness cases (`fuzz:engine`), replayed by `crates/qala-core/tests/fuzz_core.rs` with zero mismatches; it fixed three plate bugs at huge and infinite targets and in number formatting. The corpora (about 250 MB) are gitignored, and the test skips when they're absent. `qala-core` tests now build at `opt-level = 2` so the replay fits the safe runner's time cap. Not fuzzed because not ported: volume's `roundWeight`, `doubleProgression`, the rest multiplier | D32 for the rest |
| FFI exports of `dry_run`, `unresolved_sets`, `lint_planner`, `format_planner` | done 2026-10-14 | Kotlin bindings generate; `LsppToolsFfiTest` covers them; the app doesn't call them yet | |
| Load the wasm build in the desktop editor and the server | done 2026-10-14 | the editor shows diagnostics and lint inline, Format and a dry run; the server's import check uses it; `packages/lspp` is the typed client. The wasm isn't committed: run `deno task build:wasm` before `deno task test` (server tests load it), and the import route answers 500 until it's built. Open owner questions: should the dry run replace the static Week preview, and should "desktop authoring runtime" for `packages/liftoscript` be reworded now that the editor's checks run on Rust | |
| PDF import through MinerU | built 2026-10-14, run live 2026-10-30 | `POST /api/import/pdf`: MinerU through Sonoro's `mineru_adapter.py` as a subprocess (the sidecar's only PDF route is the magazine pipeline, which can send text off the machine), `pdftotext -layout` fallback, chunked per week and day, same proposal and confirm step as text import. Live run 2026-10-30 with vLLM on :30000 (Sonoro's `serve.sh`) and E4B on :8080: a two-week program with tables and the same page as an image only both came back as all 8 rows on MinerU in about 11 s; with vLLM down, pdftotext stood in with its notice, and the image-only PDF reads as empty text there. MinerU's output was identical on every run. The extraction model was not: it dropped stated weights from a table chunk in 18 of 20 calls and never kept a written kg, so 140 kg imported as 140 lb; the prompt fix (`3c25d51`) took both to 20 of 20 with no invented weights in a harness on the same prompt and transport, and three fresh runs of the PDF route afterwards came back with all 8 weights and nothing to confirm. "Barbell Row" didn't list Bent Over Row among its candidates at all; it's an alias now (`8feabd3`). Owner questions: keep the subprocess or add a raw MinerU route to Sonoro; caps of 10 MB and 40 pages | |
| Speech import: `POST /api/transcribe`, mic capture | built 2026-10-14, run live 2026-10-30 | E4B-mm on :8083 first, whisper.cpp on :8082 as fallback; returns the transcript and the client calls `/api/import/text` next; a Dictate button in the desktop program editor shows an editable transcript. Live run 2026-10-30 on 12 synthetic gym phrases (Kokoro, two voices) plus webm and ogg copies: E4B-mm 16 of 16 right at about 0.5 s; whisper.cpp as the fallback, with E4B stopped, also 16 of 16 at about 0.4 s; both down gives the 502 with `degraded: true`; random bytes get a 415. A transcript sent on to `/api/import/text` came back with "bench" to confirm, and the confirm step emitted the LS++ text. V02 (the owner's own voice in gym noise) is still open. The desktop import screen is built (2026-10-30, Programs, Import): paste text, dictate into the same box (the Dictate button moved there from the editor), or upload a PDF; answer the name questions; check again; review a diff against the editor; the result loads as an unsaved draft with Revert. Phone mic capture waits on D36, since nothing on the phone imports a program. Owner questions: caps of 8 MB and 30 s; transcript then a separate import call | V02 |
| Import picks each lift's default equipment | open, found 2026-10-30 | a bare catalog name evaluates with the catalog's default equipment: "RDL 3x8 at 185" dry-runs at 40 lb because Romanian Deadlift defaults to dumbbell; nothing warns | D38 |
| A blank weight with an RPE gets a guessed weight | open, found 2026-10-30 | `?+ @8` evaluates a weight from the 1RM and the RPE table instead of staying blank ("Pull Up @ 0 lb"); the generator writes `?+` alone now, the import emitter doesn't | D39 |
| Upload and import routes skip `requireUser` | open | `/api/import/text`, `/api/import/pdf` and `/api/transcribe` rely on the tailnet, while android-native 10 says new routes call `requireUser`; uploads are capped by size, time, four shared read slots and one per identity. Rate limiting beyond that goes with accounts (S22) | D21 |
| Record the vendored liftosaur commit (S17) | done 2026-10-14 | `5a73c87`, the newest of 26 master commits whose files match; `packages/liftoscript/VENDORED` has the method and the 14 locally changed files, and the vendor script records the hash from now on | |
| Rename leftovers | done 2026-10-14 | `testdata/golden/lspp/`, `gen:lspp`; names that run the TS oracle (`golden:liftoscript`, `fuzz:liftoscript`) keep them, per S18 | |
| `gen:lspp` runs out of memory | fixed 2026-10-14 | the planner eval generator copied live Lezer nodes through their parent chains before collapsing them (not a Deno regression); now 15 s at about 300 MB. 13 of 555 cases in the gitignored `cases_planner_eval.json` changed, from expanded parse trees and two RangeError records to real data; no test reads that file | |
| Generator port (R4) | deferred 2026-10-14 (owner) | rust-core 7; later the phone pulls generated workouts from the server instead | |
| Retire `packages/liftoscript` as the oracle | not started | gate for the Bun move. Not unblocked: S17 keeps the TS copy as the desktop's authoring runtime until D36 settles where authoring runs, and the server's import still reads the exercise catalog from it (`server/import.ts`), so a JSON catalog export comes first. The port's review (D09) was approved 2026-11-11 | D36 |

## Server and sync

Plans: `docs/android-native.md` 10, `docs/rust-core.md` 4 and 5, `docs/plan-accounts-logins.md`, `docs/adr/0002-friends-family-auth.md`.

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Text import, LLM proxy, tiles, elevation | done | `server/` | |
| Record sync: `POST /api/sync`, per-user SQLite, replacing `sync.ts` and `ws.ts` | not started | rust-core 4; the server still runs Automerge | D06, D22 |
| Blob routes for tracks, and the `schemaVersion` migration that moves tracks out of `RunSession` | not started | rust-core 5 | D07 |
| Accounts: passwords, passkeys, invites, sessions in place of the Tailscale header | planned, not started | plan-accounts-logins; no branch exists | D21 |
| How the Coach model is reached from the VPS | open | ADR 0002 open question | D23 |
| Coach route that builds the prompt and validates the reply | done 2026-10-14 | `POST /api/coach/ask` in `server/coach.ts`: `requireUser`, a capped body (`server/body.ts`), the prompt and reply schema from `packages/llm/coach.ts`, a degraded 502 when the model is down, slow or off-schema; contract fixtures in `testdata/golden/coach/`, checked by the Deno and Kotlin tests. Not built: "Remember this?" memory proposals, a rate limit | |
| Glyph and sprite routes for the map style, or bundle them in the app | not started | android-native 7, 10 | D12 |
| Serve the region `.pmtiles` for download | route already supports Range | android-native 10 | A5 |
| Fix `deploy/qala.service` | done 2026-10-13 | `ExecStart` now runs `deno run server/mod.ts`; it named `server/main.ts`, which never existed | |

## Web and desktop

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Refined desktop look, load zoom, landing intro, body map | done | DECISIONS U21 to U27 | |
| Phone PWA frozen | done | DECISIONS S13 | |
| Real data in the web app | not started | `apps/web` runs on `store/sample.ts`; the desktop load zoom reads `sampleBlockWeeks` | a sync client (D06) |
| Desktop leftovers | partly done 2026-10-30 | Done: the phone's Today stages and week strip now stand where the desktop sample does, just after Lower A (sample data only, the frozen phone UI is unchanged); Calibration shows the observed theta from 20 observations and labels the prior below that; Add exercise works for the session (target and synergist tags required, built-in names refused) and the Programs dry run resolves customs through liftosaur's `settings.exercises`. "Generate next block" is wired: it builds the generator input from the sample block and the Kalman e1RMs, runs `generateBlock` and `emitProgram`, and loads the text as an unsaved draft with Revert; the emitter now writes valid LS++ (the sample went from 936 diagnostics to 0, and the dry run plays all 24 sessions), with catalog names (seven substitutions, each with a `//` note where the generator meant something else, e.g. Pause Squat as `pause: Squat`), barbell suffixes where the catalog default isn't barbell (Romanian Deadlift), `?+` for lines with no reference 1RM, and main lifts first in each day. Its progression rules are `// progress:` notes until D37 picks the LS++ form. The editor box is now capped at 640 px and scrolls. Open: customs aren't stored anywhere (no data layer) and the Rust settings bridge (`CoreSettings`) doesn't carry them, so only the TS merge does | D37; customs: a sync client (D06) |
| Overall register and desktop sans | done | serious and minimal (DECISIONS L18, 2026-10-13); desktop UI text in DM Sans (L16, 2026-10-14) | |

## Content

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Blog | no drafts yet | `docs/blog/` has the README and a template | D29 |
| Podcast | one script, no audio | `docs/podcast/`; a script can't be recorded until its source markers resolve | D28 |
| Research briefs (beginner lifting, body composition, mindfulness, run plans) | written 2026-10-02, "nothing in this file is a finding" | `docs/research/BRIEFS.md`; the sources still need reading in full | |
| Starting-strength path (T12) | planned, nothing built | PLAN 16d | D27 |
| Beginner and race run plans (R7) | planned, nothing built | PLAN 16c | D25 |
| Mindfulness recommendation (R8) | planned | PLAN 16e | D26 |
| Body composition records (P7) | planned | PLAN 16f | D30 |
| Route library (R5), HR-zone coaching (R6) | planned, not built | PLAN 16a | V01, D19 |
| More bar renders, per-exercise bar (L13) | EZ bar done | PLAN 16b | D24 |

## Tooling

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Deno to Bun | decided 2026-10-13, not started | this section | the LS++ port finished and `packages/liftoscript` retired as the oracle |
| Elixir model gateway | later | this section. The seam is in: `server/llm.ts` reads `LLM_GATEWAY_URL` for the coach, import and chat routes (2026-10-30); `X-Qala-*` headers aren't passed yet, and transcription keeps its own `QALA_E4B_URL` and `QALA_WHISPER_URL` | queue waits over a couple of seconds, a second model host, or several people streaming coach chat |

### Deno to Bun (decided 2026-10-13, owner)

Replace Deno with Bun. One binary covers what Deno does here: `bun test`, `bun fmt`, `bun lint`, `bun check`, `Bun.serve` and `bun:sqlite`. Fallback if the first check fails: Node with Vitest and tsx. Bun is not installed on this machine, and none of its commands have been run here. D31 in `docs/decisions-pending.md` still has to record this in DECISIONS; S1 still says Deno 2.

Why wait: Bun runs JavaScriptCore, Deno and Node run V8, and the Rust ports are matched to V8 behavior (`crates/qala-lspp/src/js.rs` takes expected values from V8, for example `Math.round(-2.5)`). Retiring `packages/liftoscript` as the oracle removes the largest surface for that difference. Float-heavy goldens that stay TS can still differ in the last digit between engines. Bun 1.4 was also the first release written in Rust, which is a reason to re-read its docs at the time, not to rush.

What Deno touches (2026-10-13 counts): 295 `Deno.test` declarations in 53 files, 34 `Deno.*` calls in the server outside tests (20 of them in `sync.ts` and `ws.ts`, which S11 replaces anyway), 16 scripts plus 5 generators, the root `deno.json` with 14 tasks and 8 workspace members, and the wasm bridge. About 10 of the 16 scripts are liftoscript-specific and go with the oracle.

Steps, in order: (1) first check, record the `deno test` pass count, install Bun, re-run what remains and diff any surviving oracle output; (2) tooling base, `bunfig.toml`, a root `package.json`, `bun.lock`; (3) pure packages first (`engine`, `generator`, `run`, `llm`, web logic); (4) surviving scripts and the wasm load, through `Bun.file`; (5) record sync, then the server on `Bun.serve`; (6) cut over `deploy/qala.service`, run `bun fmt` as its own commit, drop `deno.json` and `deno.lock`; (7) record it in DECISIONS and a new ADR. Later, and separate: try Vite under Bun, swap `tsc --noEmit` for `bun check` once they agree, and revisit a Rust server.

Open: whether Deno stays usable until the gate opens (the installed binary keeps running, new installs may not), which TS packages retire with LS++ and which retire later under S6, and whether the S22 VPS is live by then, which decides how much deploy risk the unit change carries.

### Elixir model gateway (later)

A small Elixir service between the app server and the model hosts (llama-server :8080, E4B-mm :8083, whisper.cpp :8082, Sonoro and MinerU), for queueing, fairness, streaming and fallback as the user count grows. Not part of the Deno exit, and Elixir is not installed here. Build it when queue waits pass a couple of seconds, a second model host appears, or several people stream coach chat at once.

The split: the app server keeps session auth, prompts, schemas, matching and LS++ emit, and maps gateway failures to the existing 502 `{ degraded: true }` body. The gateway owns per-backend queues and concurrency limits, per-user fairness with interactive over batch, SSE passthrough that aborts upstream when the client drops, health checks and circuit breaking, and the E4B-to-whisper fallback. Contract: `POST /v1/chat/completions`, `POST /v1/transcribe`, `POST /v1/pdf`, and `GET /healthz` per backend. Between the services, `X-Qala-User`, `X-Qala-Ts` and an HMAC `X-Qala-Sig`, plus `X-Qala-Priority`. The gateway binds only to the private interface and never sees a cookie or passkey. One new client case: 429 with `Retry-After` when a user's queue cap is hit.

It runs on callisto next to the GPUs, with the VPS app server calling in over a private link. That private link is the open item in ADR 0002: the VPS cannot reach callisto's loopback today, so `/api/llm/chat` there returns 502 degraded. S22 drops Tailscale for users, which a server-to-server link does not affect. A Phoenix app for the whole server was considered and rejected: it re-ports auth, tiles and elevation, and cannot share `qala-core` without Rustler NIFs.

Run Rust tests only through `scripts/cargo-test-safe.sh -p <crate>`. A bare `cargo test` has OOM-killed the owner's terminal twice.

## Owner decisions

33 of the 39 items in `docs/decisions-pending.md` are open as of 2026-10-30; D01 was decided 2026-10-13, D02 to D05 and D10 on 2026-10-14, D36 was added from D03's answer, and D37 to D39 were added 2026-10-30 from the Generate next block work and the import live runs. D03 to D06, D08, D14, D15 and D20 were rewritten 2026-10-14 to ask only what the build left open. Grouped by what they block:

| Blocks | Items |
|---|---|
| Run recording (A2) | D11 run stack, D14 targetSdk 37, D15 L5 check, gates and HR strap |
| Record sync and the server rewrite (A3) | D06 record sync, server side, D07 tracks as blobs, D22 sync DDL and transport |
| Accounts | D21 public domain and DNS date, D23 hosted LLM fallback |
| Charts, map, stats (A5) | D12 maps, D13 charts, D16 chart accessibility |
| Android navigation | D20 keep the hand-written `Nav` or adopt a library, and the screenshot tool |
| Phone authoring (later) | D36 workouts from the phone |
| Run extras (PLAN 16a) | D19 HR-zone timing |
| Equipment renders | D24 bars |
| Content | D25 run plans, D26 breathing fallback, D27 beginner exposition, D28 podcast audio, D29 blog home, D30 body photos |
| Built already, awaiting confirmation | D08 engine state as a cache, D17 fonts and icons, D18 process leftovers |
| Tooling | D31 record the Deno to Bun move |
| Rust core parity | D32 rest and warm-up planning in Kotlin or Rust, with appendix B question 36 |
| Generated blocks that progress | D37 generator progression in LS++ |
| Import correctness | D38 equipment on imported lifts, D39 a blank weight with an RPE |
| Lifting-flow polish (A4 follow-ups) | D33 prescriptions the plates can't load, D34 rest alert, Resume workout, manual rest, save errors, D35 Settings follow-ons |

The queue and the log disagree in places (S6 is marked decided while its leftovers sit in D03 and D04). This file follows the queue. Two real-data checks sit beside the queue: V01 (route-matching thresholds) and V02 (voice recheck on the owner's own voice).

One decision is made and not in the log: Deno is replaced by Bun (2026-10-13, Tooling above and queue item D31). S1 still says Deno 2.

The desktop look update's seven questions are settled or queued: question 1 (which sans) was decided as DM Sans (D02, DECISIONS L16); the other six are queue item D40.
