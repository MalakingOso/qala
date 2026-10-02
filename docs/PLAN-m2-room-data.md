# M2: Room data module

Detail doc for milestone M2 of `docs/PLAN-rail-refresh.md`. Needs M1 merged (the `qala-ffi` library, records and `api` functions in `docs/PLAN-m1-rust-core.md`). Read `docs/android-native.md` section 4 (data) and `docs/rust-core.md` section 4 (records and HLC).

## Deliverables

A new Gradle module `apps/android/data` (Android library, namespace `com.qala.data`) with typed Room tables, a clock sidecar, an outbox, repositories exposed as `Flow`s, an engine-state cache, a debug seed, and a hand-written `AppContainer` in the app. No network code: the sync endpoint is out of scope, writes queue in the outbox.

Exit gate: `testDebugUnitTest` green for the pure logic (HLC wrapper, outbox ordering, stage deriver, record mapping), repositories verified against the seed through an instrumented test on the emulator.

## Verified toolchain (2026-10-02 spike)

Room 2.8.5 (`room-runtime`, `room-ktx`, `room-compiler` via KSP) with the KSP plugin 2.3.12 builds on AGP 9.4.1, Gradle 9.8.0 and Kotlin 2.4.x. The library module needs `buildToolsVersion = "36.1.0"` (same as the app) or `extractDebugAnnotations` fails to find build tools 36.0.0. KSP goes in the root `build.gradle.kts` plugins block with `apply false`.

## Tables

One typed table per record type, mirroring `qala-core::records` field for field so JSON crosses to Rust without mapping surprises. Ids are UUID strings. Instants are stored as `startedAtMs` (UTC epoch ms) plus `offsetMin` (device offset at write time); the Kotlin layer renders ISO 8601 with that offset when calling Rust. Local calendar dates (`date`, skip dates) are `YYYY-MM-DD` text.

- `lift_session`, `lift_entry`, `lift_set`: a session owns entries, an entry owns sets. Immutable once created except `notes` (a field write).
- `run_session`: summary only (distance, moving, elapsed, srpe, grade profile JSON, descent). Raw fixes are a later table (A2).
- `check_in`, `body_weight`, `day_skip`, `availability` (single row), `settings` (one row per group, each leaf a field), `program` (id, name, text).
- Every record has `deleted` as a clocked field (tombstones are kept, repositories filter them).
- `field_clock (recordId, field, wallMs, counter, nodeId)`, primary key `(recordId, field)`: the HLC of the last write to each field.
- `outbox (seq autoincrement, recordType, recordId, field, valueJson, hlc, createdAtMs)`: one row per field write, drained by the future sync client in `seq` order.
- `meta (key, value)`: `nodeId` (random 128-bit hex, generated once per install, never derived from device data) and the last issued HLC (so a restart never goes backwards).

Schema export on, version 1, `exportSchema` directory checked in so migrations can be tested later.

## Write path

`RecordWriter` is the only code that writes record tables. One call is one transaction: tick the HLC through `qala-ffi` (`hlc_tick` with `now = System.currentTimeMillis()`), write the entity row, upsert a `field_clock` row for every field written, append one outbox row per field, persist the new HLC to `meta`. An update touches only the fields it names. `applyRemote(change)` (merge through `hlc_merge_field`, keep the higher clock) exists and is unit tested but nothing calls it until the sync endpoint.

## Repositories

`SessionRepository`, `CheckInRepository`, `BodyWeightRepository`, `AvailabilityRepository` (skips and status), `SettingsRepository`, `ProgramRepository`, `RunRepository` (summary only). Each exposes `Flow` reads of non-deleted records and suspend writes through `RecordWriter`. All Rust calls (and any JSON work) run on `Dispatchers.Default`, never on the main thread.

`EngineRepository`: an in-memory `StateFlow<EngineSnapshot>` rebuilt on launch and whenever session, check-in or settings records change (collect, debounce 250 ms, then `build_engine_state`). It holds the state, the readiness summary (`readiness_summary`), planned and done week load (`week_load`) and the weight trend (`weight_trend`). A persisted cache table only if replay time shows up as a problem (it is derived data, S8).

Serialization: `kotlinx.serialization` (plugin `org.jetbrains.kotlin.plugin.serialization`, same version as the Compose plugin) with `@Serializable` DTOs that match the Rust serde shapes. Do not hand-build JSON strings.

## Stub-stage records

Warm-up, lift and run each get a minimal done record written by the Mark done button on their stub screens (M3): `stub = true`, the program day index, a start time, no sets or distance. The adapter treats a stub as "day logged" for sequencing and adds no fatigue (already implemented in M1). The stage deriver treats a stub like a real record.

## Today's day and stages

Pure Kotlin in `data/` (JVM testable), mirroring `StageState` in `apps/web/src/store/types.ts`:

- `DayStage` with state `Done | Now | Later | Skipped` for the stage list, plus passive interlude stages (recover, wind down: no doneness, "now" skips them, static-copy heroes).
- Today's kind: lift day when the local weekday is in `trainingWeekdays` (default Mon, Wed, Fri, Sat) and the day is not skipped, else rest day. Rest days have three stages (check-in, recover, wind down), lift days have six (check-in, warm-up, lift, run, recover, wind down); never assume six.
- Today's lift day is the next program day in sequence after the last logged lift (including stubs), from `next_history_entry` / `get_day` of the LS++ API. A skip shifts the plan per `shiftsPlan` (vacation and sick shift, break, scheduling and injured do not).
- A skipped stage gets the `Skipped` state (rendered as a hollow ring in M3).

## Debug seed

`DebugSeeder` (debug builds only, behind a `BuildConfig.DEBUG` check and an explicit call from the app container, never in release) writes: the GZCLP program (`testdata/golden/liftoscript/builtins/gzclp.json` `inputs.text`), a few weeks of sessions, check-ins, body weights, a run plan with a weekday, one skip. **The program's progression state lives inside its text**, so the seed must be generated together: evaluate the program with the LS++ FFI, complete the day's sets, log the session, run the finish-day script to advance the program text, repeat per training day. A hand-checked or generated mismatch between the program text and the sessions is a bug (the hero's top set would disagree with the week card). Release builds start empty and every card shows a plain empty state.

## DI

`AppContainer` in the app module, built in `MainActivity` and exposed through a `CompositionLocal`. Constructor injection, no library. The container owns the Room database, the `RecordWriter`, repositories and the `EngineRepository`.

## Tests

- JVM: HLC wrapper over the host `libqala_ffi` (tick monotonicity, restart persistence with a fake `meta` store), outbox ordering and field-level contents with fake DAOs, stage deriver cases (lift day, rest day, skipped day, stub done, sequence after a skip), record DTO to Rust JSON round trips.
- Instrumented (emulator): in-memory Room database, `RecordWriter` transaction writes clock and outbox rows together, repositories against the seed, engine snapshot non-empty after seeding.

## Out of scope

The sync endpoint and client, raw GPS fixes, a persisted engine cache, Room migrations beyond v1.
