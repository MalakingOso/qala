# Completed work

One-page record of finished plans, kept so code comments and DECISIONS rows have somewhere to point. Detail that is still the reference lives in the living docs named in each entry. Everything else about these plans is in git history.

## Native phone refresh, M1 to M4 (done 2026-10-03)

Was `PLAN-rail-refresh.md`, `PLAN-m1-rust-core.md`, `PLAN-m2-room-data.md` and `HANDOFF-rail-refresh.md`. Merged to main by 2026-10-03, `phone-refresh` branch gone. Decisions are DECISIONS S23, U9 (superseded for native), L19 and S24 to S26.

What shipped: a Rust core and FFI, a Room data layer, Today with the fixed day rail, check-in, the skip sheet and status, and the weekday picker, all native Android only. The web was not touched.

Still open, tracked in [ROADMAP.md](/home/berkley/Programming/qala/docs/ROADMAP.md): the real-phone pass (all of this ran on the emulator), Haze backdrop blur (parked, tint only today), and the coach radial. Warm-up, Workout and Run stubs from this plan have since shipped or moved: see the ROADMAP Android table.

### Type and rail, as built

Three faces: Qala Test for page titles and hero numerals only, Recursive for UI text (variable, tabular digits), DM Mono for records, set logs, tables and code. Retargeting `QalaType` is one edit.

The rail is a 28dp frosted strip at the left edge, fixed mid-screen, never scrolling. Cards notch around it by deforming the card path itself. Tint only (`bgSurface` at .62) behind one modifier so Haze can drop in later. Back to now is manual only. Gestures: tap or swipe right opens the menu, swipe up and down step stages, with `systemGestureExclusion()` on the strip. Motion: menu open 260 ms expo-out (`CubicBezierEasing(.25f, 1f, .5f, 1f)`), close 200 ms ease-in, rows stagger 25 ms from 40 ms, preview bar expands in 220 ms. All frozen under reduced motion. Glass only on floating chrome, never on content.

### M1, Rust core and FFI, as built

Crates: `qala-core` (pure, no I/O, no clock) and `qala-ffi` (one UniFFI `.so` exporting `qala-core` and the LS++ API, replacing `qala-lspp-ffi`). Goldens in `testdata/golden/engine/` from `scripts/golden_engine.ts`. Run Rust tests only through `scripts/cargo-test-safe.sh`, never bare `cargo test`.

Rules that still bind new core code:

- `js_round` wherever TS uses `Math.round`. It is not `(x + 0.5).floor()`. `f64` only, no `mul_add`, no `rayon`.
- No clock, no `HashMap` in output. `BTreeMap` or `Vec`. `serde_json` with `float_roundtrip`.
- Instants cross as ISO 8601 with an explicit offset. Skip dates and availability spans are local `YYYY-MM-DD` keys compared as strings.
- Every exported function takes a JSON string and returns `{"v":1,"result":...}` or an error. No panics in exported paths, non-finite numbers are an error.
- Weights cross in the user's unit. Muscle ids are the engine short ids (`quads`, `chest`) through `muscles.rs`.

Module map: `js`, `time`, `engine/` (state, decay, e1rm, kalman, running, session, readiness), `availability`, `hlc`, `muscles`, `records`, `adapter` (records to engine state), `derived` (Today numbers), `api`. The adapter drops stub sessions before the engine, attaches a check-in to the lift session starting closest after it within 3 hours, and converts weights to the settings unit. Derived numbers are readiness summary with a 28-day mean, per-muscle ready dates, planned and done week load, and the 7-day weight trend with no verdict.

Deliberate divergence: native readiness decays fatigue and fitness to an explicit `now` before scoring. TS reads them as of `state.updated`. Goldens for that case use the `ts+decay` oracle (DECISIONS S26).

API, as built: `log_session`, `calibrate`, `predict_readiness`, `build_engine_state`, `readiness_summary`, `week_load`, `weight_trend`, the availability calls (`classify_day`, `reason_on`, `injured_on`, `guard_exercise`, `shifts_plan`) and the HLC calls (`hlc_compare`, `hlc_tick`, `hlc_receive`, `hlc_merge_field`). Exact JSON shapes are in the Rust doc comments and the golden files.

Out of scope then, still open in [rust-core.md](/home/berkley/Programming/qala/docs/rust-core.md) section 7: volume, rest and warm-up ports, `recommend_next_session`, the run pipeline, and the sync endpoint.

### M2, Room data module, as built

Gradle module `apps/android/data`, namespace `com.qala.data`: typed Room tables, a `field_clock` sidecar, an outbox, repositories as `Flow`s, an in-memory engine-state cache, a debug seed, and a hand-written `AppContainer`. Merged in `8597550`. Room 2.8.5 with KSP 2.3.12 on AGP 9.4.1; the module needs `buildToolsVersion = "36.1.0"`.

Tables: `lift_session`, `lift_entry`, `lift_set` (immutable except `notes`), `run_session` (summary only), `check_in`, `body_weight`, `day_skip`, `availability` (single row), `settings` (one row per group), `program`. Every record has a clocked `deleted` field, tombstones kept. `field_clock (recordId, field, wallMs, counter, nodeId)` holds the HLC of the last write per field. `outbox` holds one row per field write in sequence order. `meta` holds the install `nodeId` and the last issued HLC.

`RecordWriter` is the only writer: one call, one transaction, ticking the HLC through `qala-ffi`, writing the row, the clock rows and the outbox rows together. Repositories run Rust calls on `Dispatchers.Default`. Stub records (`stub: true`, no sets or distance) advance the program sequence and the rail without feeding fatigue. Today's stages derive in pure Kotlin: lift days have six stages, rest days three, recover and wind down are passive interludes, a skipped stage is `Skipped`. The debug seed generates the GZCLP program text and its sessions together, or the hero top set disagrees with the week card.

Out of scope then, still open: the sync endpoint and client, raw GPS fixes, and a persisted engine cache. See the ROADMAP Server and sync table.

## Desktop look update (done 2026-10-01)

Was `desktop-look-update-notes.md`. The refined desktop look is on main. Decisions are DECISIONS L16 and U20 to U23, rebuilt in part by the load zoom (U27). Its unresolved sample-data conflicts were fixed 2026-10-30 (phone and desktop samples now agree that Lower A is complete, and Calibration shows the observed theta past 20 observations). Six questions from that file are now queue item D40 in [decisions-pending.md](/home/berkley/Programming/qala/docs/decisions-pending.md). What a real build still needs from it is in the ROADMAP Web and desktop table.

## Landing intro dust (done 2026-10-02)

Was `archive/handoff-intro-dust.md`. The plate-drop intro ships on the landing page (DECISIONS U26). The dust is driven by the slap itself: a solid proxy of the plate as a Mantaflow collision effector blows a thin dust layer laid under the plate at the contact frame. The wider 60-inch domain box and the shader radial falloff keep the cloud edge from ever reading as the box edge, and a shader settle clears the haze before the poster frame. Grains: 4,500 at 0.055 inch. The build is `assets/3d/build_intro.py`.

## M4 mockup options (historical)

Was `archive/mockups-m4-options.md`. M4 is built and merged, so the options record has no open content. The build may differ from the recommendations that were in it.

## Rust spike (throwaway, 2026-09-30)

Was `archive/spike-qcore/`. A few-hours spike that proved one crate builds to native and wasm from feature-gated shims, that UniFFI generates usable Kotlin, that JS and Rust round halves differently (the reason for `js_round`), and that Automerge on wasm costs about 715 KB for no benefit here. The real crates were written fresh against golden vectors. Its verified numbers are in [rust-core.md](/home/berkley/Programming/qala/docs/rust-core.md) section 3 where they still matter.
