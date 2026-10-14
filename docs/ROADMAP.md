# Roadmap

Where Qala stands and what comes next, in one place. Verified against main at `ee49107` on 2026-10-13 and updated after the A4 screens merged the same night. Main is ahead of `origin/main` and hasn't been pushed.

This file lists work that is decided or underway, by track, and links to the plan that holds the detail. It doesn't copy those plans. Choices still to be made are in `docs/decisions-pending.md` (grouped by what they block, below). Choices already made are in `docs/DECISIONS.md`. Every plan doc opens with a status line; if one disagrees with this file, fix both. `docs/README.md` indexes the rest of the docs.

## Where we are

The web build (desktop and the frozen phone PWA) is v1 and runs entirely on sample data: `apps/web/src` has no `fetch`, `WebSocket` or IndexedDB call. The native Android app is the active work. On main it has the Rust core and FFI, the Room data layer, Today with the day rail, check-in, the skip sheet and status, the weekday picker, the plate calculator, and the lifting loop: Warm-up, Workout and Rest (a finished workout saves real sets and advances the program), Plan, History and All exercises. Run recording, sync, charts and the Coach screen haven't started.

Everything on Android has run on the emulator only. The server still syncs through Automerge and trusts the Tailscale header. Accounts, record sync and blob upload are planned and unbuilt.

## Merge queue

In flight on 2026-10-14: the flaky `AppContainerTest`, on its own agent branch. Merged 2026-10-14: FFI exports, the vendored commit and the rename leftovers (`8e48051`); the LS++ wasm in the desktop editor and the server (`f5b88e5`); PDF and voice import (`e54e794`); the Coach route and Android screen (`90db3a6`); the `gen:lspp` memory fix (`86b6b15`). Merged 2026-10-13, in order: `plates` (`ee49107`), `docs` (`d6837a3`), `workout` (`b5e9ae9`), `plan` (`e0e6a8d`), `history` (`17c4926`), and the deploy unit fix.

Beyond the queue, the order of work is the owner's call. The tables below give each item's state and what it waits on.

## Android app

Plans: `docs/android-native.md` (the app), `docs/PLAN-rail-refresh.md` (the native refresh, M1 to M4).

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Toolchain, design system, shell (A0, A1) | done 2026-10-01 | android-native 9, 11 | |
| Capacitor removed (A7) | done 2026-10-01 | android-native 9 | |
| Rust core and FFI, Room data layer, Today with day rail, check-in, skip sheet and status, weekday picker (M1 to M4) | done, merged by 2026-10-03 | PLAN-rail-refresh | |
| Plate calculator | done 2026-10-13 | android-native 8 | |
| History and All exercises | done 2026-10-13 | one All exercises grid, opened from the Warm-up, Workout and Rest headers, live during a workout | |
| Warm-up, Workout, Rest | done 2026-10-13 | a finished workout saves real sets and advances the program through the finish-day scripts; per-side plates on the set rows and Rest; rest and warm-up planning is Kotlin, see the Rust track | |
| Plan screen | done 2026-10-13 | Start follows Today's stage order; "See what you did" opens History | |
| Flaky connected test | open | `AppContainerTest.aStartWithoutTheSeedLeavesEveryTableEmpty` crashed once in 4 runs on merged main (2026-10-13) with a Compose `SlotTable` `ArrayIndexOutOfBoundsException` while the activity's composition was disposed. The crash ends the instrumentation run, so later suites (`WorkoutFlowTest`) don't run and the gate shows 24 tests instead of 36 | |
| Rest of Settings | done 2026-10-13 | Training status (Change opens the skip sheet, Set active), Units, bars, the editable plate inventory with the 55 lb row, equipment, warm-up and rest timer, all stored as settings groups and read by the plate calculator, set rows, Rest and the warm-up. Not built, with nothing behind them: Learn from taps, Alert, Check-ins, Running, Coach, Appearance (title font and theme) | |
| Navigation library choice | at the first real back stacks | android-native 3 | D20 |
| Run recording (A2) | not started | recorder service, Room fixes, HR, cues, the four gates in android-native 5; needs R1 in Rust | D11, D14, D15 |
| Record sync client (A3) | not started | the outbox, clock sidecar and HLC wrapper exist; no HTTP client | D06, D07, D22 |
| Charts, map, stats screens (A5) | not started | Session complete, Progress, Body; Vico plus Canvas, MapLibre | D12, D13, D16 |
| Coach screen (A6) | done 2026-10-14 | the Coach tab asks `POST /api/coach/ask` over `HttpURLConnection` and shows an unavailable state when the server is unreachable, degraded or answers 401; base URL is a BuildConfig field (`-Pqala.serverUrl=`); the thread is in memory only. Owed: a live run against the real model. Owner questions: should "Use coach" change the workout's numbers; should a bare "hi" on an empty thread still be declined; should the base URL become a setting with S22 | |
| Release signing (A6) | not started | needs the owner's keystore | |
| Real-phone verification pass | next, needs the phone | the 2 h locked-screen run, Spotify ducking, a killed service resuming, the L5 check, and the A0 leftovers (Vico run-series spike). USB access is unset: it needs sudo for udev rules, and wireless debugging is untried | the owner's phone |

## Rust core and LS++

Plans: `docs/rust-core.md`, `docs/ls-plus-plus.md`.

| Item | State | Detail | Waiting on |
|---|---|---|---|
| LS++ port, S21 extensions, rename (R5) | done 2026-10-01 | ls-plus-plus 2, 3 | D09 (review) |
| `qala-core`: engine, availability, HLC, records, adapter, Today numbers | done | rust-core 7 (R3 part) | |
| Plate math with rounding and golden vectors | done 2026-10-13 | `testdata/golden/plates` | |
| R1 run pipeline and `RunRecorder` | not started | rust-core 7; A2 needs it | |
| R3 remainder: volume, rest, warm-up, `recommend_next_session` | not in Rust | rust-core 7 still puts them in Rust; rest and warm-up planning shipped in Kotlin (`app/.../workout/RestPlan.kt`, `Warmup.kt`, ports of `rest.ts` and `warmup.ts`); Rust port or keep Kotlin is the owner's call | |
| Differential fuzz for the R2 and R3 acceptance lines | not done | none in the repo | |
| FFI exports of `dry_run`, `unresolved_sets`, `lint_planner`, `format_planner` | done 2026-10-14 | Kotlin bindings generate; `LsppToolsFfiTest` covers them; the app doesn't call them yet | |
| Load the wasm build in the desktop editor and the server | done 2026-10-14 | the editor shows diagnostics and lint inline, Format and a dry run; the server's import check uses it; `packages/lspp` is the typed client. The wasm isn't committed: run `deno task build:wasm` before `deno task test` (server tests load it), and the import route answers 500 until it's built. Open owner questions: should the dry run replace the static Week preview, and should "desktop authoring runtime" for `packages/liftoscript` be reworded now that the editor's checks run on Rust | |
| PDF import through MinerU | built 2026-10-14, tested with fakes only | `POST /api/import/pdf`: MinerU through Sonoro's `mineru_adapter.py` as a subprocess (the sidecar's only PDF route is the magazine pipeline, which can send text off the machine), `pdftotext -layout` fallback, chunked per week and day, same proposal and confirm step as text import. Owed: a live run with vLLM on :30000. Owner questions: keep the subprocess or add a raw MinerU route to Sonoro; caps of 10 MB and 40 pages | |
| Speech import: `POST /api/transcribe`, mic capture | built 2026-10-14, tested with fakes only | E4B-mm on :8083 first, whisper.cpp on :8082 as fallback; returns the transcript and the client calls `/api/import/text` next; a Dictate button in the desktop program editor shows an editable transcript. Owed: a live run on both engines, an import screen that sends a transcript or PDF result to the confirm step, phone mic capture. Owner questions: caps of 8 MB and 30 s; transcript then a separate import call | V02 |
| Upload and import routes skip `requireUser` | open | `/api/import/text`, `/api/import/pdf` and `/api/transcribe` rely on the tailnet, while android-native 10 says new routes call `requireUser`; uploads are capped by size, time, four shared read slots and one per identity. Rate limiting beyond that goes with accounts (S22) | D21 |
| Record the vendored liftosaur commit (S17) | done 2026-10-14 | `5a73c87`, the newest of 26 master commits whose files match; `packages/liftoscript/VENDORED` has the method and the 14 locally changed files, and the vendor script records the hash from now on | |
| Rename leftovers | done 2026-10-14 | `testdata/golden/lspp/`, `gen:lspp`; names that run the TS oracle (`golden:liftoscript`, `fuzz:liftoscript`) keep them, per S18 | |
| `gen:lspp` runs out of memory | fixed 2026-10-14 | the planner eval generator copied live Lezer nodes through their parent chains before collapsing them (not a Deno regression); now 15 s at about 300 MB. 13 of 555 cases in the gitignored `cases_planner_eval.json` changed, from expanded parse trees and two RangeError records to real data; no test reads that file | |
| Generator port (R4) | deferred 2026-10-14 (owner) | rust-core 7; later the phone pulls generated workouts from the server instead | |
| Retire `packages/liftoscript` as the oracle | not started | gate for the Bun move | |

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
| Desktop leftovers | open | "Generate next block" isn't wired, "Add exercise" doesn't exist, the phone's Today stages and the desktop sample disagree, Calibration shows a prior next to lifts with observations | |
| Overall register and desktop sans | done | serious and minimal (DECISIONS L18, 2026-10-13); desktop UI text in DM Sans (L16, 2026-10-14) | |

## Content

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Blog | no drafts yet | `docs/blog/` has the README and a template | D29 |
| Podcast | one script, no audio | `docs/podcast/`; a script can't be recorded until its source markers resolve | D28 |
| Research briefs (beginner lifting, body composition, mindfulness, run plans) | written 2026-10-02, "nothing in this file is a finding" | `docs/research/`; the sources still need reading in full | |
| Starting-strength path (T12) | planned, nothing built | PLAN 16d | D27 |
| Beginner and race run plans (R7) | planned, nothing built | PLAN 16c | D25 |
| Mindfulness recommendation (R8) | planned | PLAN 16e | D26 |
| Body composition records (P7) | planned | PLAN 16f | D30 |
| Route library (R5), HR-zone coaching (R6) | planned, not built | PLAN 16a | V01, D19 |
| More bar renders, per-exercise bar (L13) | EZ bar done | PLAN 16b | D24 |

## Tooling

| Item | State | Detail | Waiting on |
|---|---|---|---|
| Deno to Bun | decided 2026-10-13, not started | `docs/PLAN-bun-migration.md` | the LS++ port finished and `packages/liftoscript` retired as the oracle |
| Elixir model gateway | later | same file, "Later" | queue waits over a couple of seconds, a second model host, or several people streaming coach chat |

Run Rust tests only through `scripts/cargo-test-safe.sh -p <crate>`. A bare `cargo test` has OOM-killed the owner's terminal twice.

## Owner decisions

30 of the 36 items in `docs/decisions-pending.md` are open as of 2026-10-14; D01 was decided 2026-10-13, D02 to D05 and D10 on 2026-10-14, and D36 was added from D03's answer. D03 to D06, D08, D14, D15 and D20 were rewritten 2026-10-14 to ask only what the build left open. Grouped by what they block:

| Blocks | Items |
|---|---|
| Run recording (A2) | D11 run stack, D14 targetSdk 37, D15 L5 check, gates and HR strap |
| Record sync and the server rewrite (A3) | D06 record sync, server side, D07 tracks as blobs, D22 sync DDL and transport |
| Accounts | D21 public domain and DNS date, D23 hosted LLM fallback |
| Charts, map, stats (A5) | D12 maps, D13 charts, D16 chart accessibility |
| Android navigation | D20 keep the hand-written `Nav` or adopt a library, and the screenshot tool |
| Rust core scope and rules | D09 review of the LS++ port |
| Phone authoring (later) | D36 workouts from the phone |
| Run extras (PLAN 16a) | D19 HR-zone timing |
| Equipment renders | D24 bars |
| Content | D25 run plans, D26 breathing fallback, D27 beginner exposition, D28 podcast audio, D29 blog home, D30 body photos |
| Built already, awaiting confirmation | D08 engine state as a cache, D17 fonts and icons, D18 process leftovers |
| Tooling | D31 record the Deno to Bun move |
| Rust core parity | D32 rest and warm-up planning in Kotlin or Rust, with appendix B question 36 |
| Lifting-flow polish (A4 follow-ups) | D33 prescriptions the plates can't load, D34 rest alert, Resume workout, manual rest, save errors, D35 Settings follow-ons |

The queue and the log disagree in places (S6 is marked decided while its leftovers sit in D03 and D04). This file follows the queue. Two real-data checks sit beside the queue: V01 (route-matching thresholds) and V02 (voice recheck on the owner's own voice).

One decision is made and not in the log: Deno is replaced by Bun (2026-10-13, `docs/PLAN-bun-migration.md`). S1 still says Deno 2.

`docs/desktop-look-update-notes.md` holds seven questions recorded nowhere else:

| Question | Overlap |
|---|---|
| 1 Which sans for desktop UI text | D02, decided: DM Sans |
| 2 Chip shape, 4px rounded or pills | none |
| 3 No avatar; the toolbar search and week switcher are new behavior | none |
| 4 Past versus future look in the week chart | U27 rebuilt the chart |
| 5 Deload in week 6 | U27's sample has the deload in week 6 |
| 6 Muse's numbers not used | none |
| 7 Chart title kept in the load zoom | U27 may have overtaken it |
