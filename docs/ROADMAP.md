# Roadmap

Where Qala stands and what comes next, in one place. Verified against main at `ee49107` on 2026-10-13 and updated after the A4 screens merged the same night. Main is ahead of `origin/main` and hasn't been pushed.

This file lists work that is decided or underway, by track, and links to the plan that holds the detail. It doesn't copy those plans. Choices still to be made are in `docs/decisions-pending.md` (grouped by what they block, below). Choices already made are in `docs/DECISIONS.md`. Every plan doc opens with a status line; if one disagrees with this file, fix both. `docs/README.md` indexes the rest of the docs.

## Where we are

The web build (desktop and the frozen phone PWA) is v1 and runs entirely on sample data: `apps/web/src` has no `fetch`, `WebSocket` or IndexedDB call. The native Android app is the active work. On main it has the Rust core and FFI, the Room data layer, Today with the day rail, check-in, the skip sheet and status, the weekday picker, the plate calculator, and the lifting loop: Warm-up, Workout and Rest (a finished workout saves real sets and advances the program), Plan, History and All exercises. Run recording, sync, charts and the Coach screen haven't started.

Everything on Android has run on the emulator only. The server still syncs through Automerge and trusts the Tailscale header. Accounts, record sync and blob upload are planned and unbuilt.

## Merge queue

Empty as of 2026-10-13. Merged that day, in order: `plates` (`ee49107`), `docs` (`d6837a3`), `workout` (`b5e9ae9`), `plan` (`e0e6a8d`), `history` (`17c4926`), and the deploy unit fix.

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
| Coach screen, release signing (A6) | not started | needs the server Coach route | D10 |
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
| FFI exports of `dry_run`, `unresolved_sets`, `lint_planner`, `format_planner` | next | wasm has them; `qala-ffi` has `diagnose_*` only | |
| Load the wasm build in the desktop editor and the server | next | diagnostics, dry run, fmt; neither `apps/web` nor `server/` loads it | |
| PDF import through MinerU | next | ls-plus-plus 4 | |
| Speech import: `POST /api/transcribe`, mic capture | next | ls-plus-plus 4, 5 | V02 |
| Record the vendored liftosaur commit (S17) | open chore | no hash on record | |
| Rename leftovers | open | `gen:liftoscript`, `testdata/golden/liftoscript/`, pre-rename names in `target/wasm-out/` | |
| Generator port (R4) | deferred | rust-core 7 | D03 |
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
| Coach route that builds the prompt and validates the reply | not started | android-native 10 | D10 |
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
| Overall register and desktop sans | open | D01, D02 | owner |

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

All 30 items in `docs/decisions-pending.md` are open as of 2026-10-13. Grouped by what they block:

| Blocks | Items |
|---|---|
| Run recording (A2) | D11 run stack, D14 devices and SDKs, D15 test process |
| Record sync and the server rewrite (A3) | D06 record sync, D07 tracks as blobs, D08 engine state as a cache, D22 sync DDL and transport |
| Accounts | D21 public domain and DNS date, D23 hosted LLM fallback |
| Charts, map, stats (A5) | D12 maps, D13 charts, D16 chart accessibility |
| Coach (A6) | D10 Coach stays TypeScript |
| Android navigation | D20 navigation library and screenshot tool |
| Rust core scope and rules | D03 approve the plan, D04 TS and Rust coexistence, D05 platform direction, D09 review of the LS++ port |
| Run extras (PLAN 16a) | D19 HR-zone timing |
| Look and feel | D01 overall register, D02 desktop sans |
| Equipment renders | D24 bars |
| Content | D25 run plans, D26 breathing fallback, D27 beginner exposition, D28 podcast audio, D29 blog home, D30 body photos |
| Built already, awaiting confirmation | D17 fonts and icons, D18 process leftovers |

The queue and the log disagree in places. For example D06 is open while S11 is marked decided and built for the native app. This file follows the queue. Two real-data checks sit beside the queue: V01 (route-matching thresholds) and V02 (voice recheck on the owner's own voice).

One decision is made and not in the log: Deno is replaced by Bun (2026-10-13, `docs/PLAN-bun-migration.md`). S1 still says Deno 2.

`docs/desktop-look-update-notes.md` holds seven questions recorded nowhere else:

| Question | Overlap |
|---|---|
| 1 Which sans for desktop UI text | D02 |
| 2 Chip shape, 4px rounded or pills | none |
| 3 No avatar; the toolbar search and week switcher are new behavior | none |
| 4 Past versus future look in the week chart | U27 rebuilt the chart |
| 5 Deload in week 6 | U27's sample has the deload in week 6 |
| 6 Muse's numbers not used | none |
| 7 Chart title kept in the load zoom | U27 may have overtaken it |
