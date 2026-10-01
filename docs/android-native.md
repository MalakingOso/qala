# Native Android app: plan

Status: **proposed**, 2026-09-30. Nothing here is built or approved. This replaces the Capacitor wrapper (`apps/phone`, DECISIONS S2). The shared logic comes from the Rust core in `docs/rust-core.md`; what was and wasn't verified is in `docs/rust-core-spike.md`. Open questions you can answer later are in `docs/rust-core-open-questions.md`. Decision rows are DECISIONS S6 to S17. Revised 2026-09-30: sync is records over HTTP (no Automerge), and liftoscript is ported to Rust (no quickjs).

## 1. Where things stand

The phone shell is a prototype. `apps/web/src/shell-phone` (about 3,300 lines of pages, plus about 2,300 of shared UI and charts) runs entirely on `store/sample.ts`. It calls one `packages/*` module (`core/plates.ts`). There is no `fetch`, `WebSocket` or IndexedDB anywhere in `apps/web/src`, the offline outbox in `localStorage` is write-only, and the run pages are stubs on a fake `setInterval` ticker.

The Android side is thinner still. `AndroidManifest.xml` declares `com.qala.app.RunRecordingService`, but that class doesn't exist. `MainActivity.java` is an empty `BridgeActivity`. `apps/phone/src/native/*.ts` are wrappers that no page calls. No Gradle project is checked in.

So the rewrite is mostly new work on both sides. The React pages are a design reference, not code to transliterate.

## 2. Platform targets

| Setting | Choice | Why |
|---|---|---|
| Device | Nothing Phone (4a) Pro, Android 16 (API 36), Nothing OS 4.1. Sideloaded. | Shipped March 2026. Nothing OS 5.0 on Android 17 is in open beta for it, stable expected from October. |
| minSdk | 34 | One device. Android 14 has the foreground-service type rules the recorder depends on. 33 also works; 34 removes a branch. |
| targetSdk | 36 now, 37 after retesting | Sideloaded apps aren't bound by Play's rules (the August 2026 deadline requires API 36 for Play). Android 17 hardens background audio, so test the foreground service and ducking on the Nothing OS 5.0 beta before moving up. |
| Language and UI | Kotlin, Jetpack Compose on Foundation | No Material 3 defaults. PLAN 3 already says "no component kit"; M3 fights the Beamer look. |
| ABI | `arm64-v8a` only | One phone. Cuts the Rust and MapLibre `.so` sizes. Add x86_64 only if you want an emulator. |

## 3. Module layout

Few modules. One developer, one device.

```
apps/android/
  app/         MainActivity, navigation, screens, ViewModels
  design/      tokens (generated), fonts, icons, Beamer surface modifiers, chart canvases
  core/        UniFFI bindings (qala-ffi: run, math, engine, liftoscript), golden-vector tests
  data/        Room (records, fixes), HLC and merge, HTTP sync client, blob upload, repositories
  run/         RunRecordingService, FixSource, HR client, CuePlayer, RunRepository
```

KMP and Compose Multiplatform would keep iOS open (PLAN 3 says iOS waits for a friend who wants runs). I'm not adopting it. The structure keeps `core/`, `data/` and `run/` free of Compose imports, which is the cheap part of keeping the door open.

Dependency injection: constructor injection through a hand-written `AppContainer` until it hurts. Navigation: Navigation Compose; check Navigation 3 status at A0 before choosing. Both unverified for September 2026.

## 4. Design system

The design lives in token values: border width, shadow shape, radii (DECISIONS L8; the visual-refinement pass that softened these was reverted). Port the values exactly and generate them.

- `scripts/tokens_to_kotlin.ts` reads `apps/web/src/theme/tokens.css` and emits `Tokens.kt` (light and dark, zone colors, plate colors). One source of truth. The existing WCAG contrast test (`themeContrast.test.ts`) runs against the same file.
- Beamer surface: `Modifier.beamerSurface()` draws the 2px border, 4/6/8 radii and the hard offset shadow with `drawBehind`. No elevation, no blur.
- Fonts need TTF or OTF, not woff2. Qala Test TTFs are already in `assets/fonts/` (`QalaTest-Medium.ttf`, `QalaTestV2-Bold.ttf`). A Faustina variable TTF is in `assets/fonts/qala-test/work/`. DM Mono only has woff2 in the repo: convert with fonttools or fetch from Google Fonts. Both are OFL; read `DMMono-OFL.txt` for reserved-name terms before renaming anything.
- Icons: Lucide as Compose `ImageVector`s, generated from the Lucide SVG paths for only the icons DESIGN 4 lists. Runs use `sport-shoe`.
- Tabs: Today, Plan, Body, Progress, Coach (DECISIONS U2).

## 5. Run recorder

This is the hardest part and the owner's original reason for going native, so it is built first (phase A2). All of it follows the research reports; the first four rows are the hard requirements.

| Concern | Design |
|---|---|
| Service | `RunRecordingService`, `foregroundServiceType="location|connectedDevice"`, `START_STICKY`, persistent notification. Started from the visible activity on the Start button, never from the background. |
| Permissions | At first run start, in this order: fine location, `POST_NOTIFICATIONS`, then background location last (it sends the user to Settings). Declare `FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `BLUETOOTH_SCAN` (`neverForLocation`), `BLUETOOTH_CONNECT`. |
| Location | `FusedLocationProviderClient`, `PRIORITY_HIGH_ACCURACY`, 1000 ms, no `setMaxUpdateDelayMillis`. One position stream only (PLAN 8a rule 2). A `LocationManager` `GPS_PROVIDER` implementation sits behind the same `FixSource` interface as a fallback. Fixes are timed by `elapsedRealtimeNanos`, not by callback time. |
| Persistence | Each fix is one Room insert, `INSERT OR IGNORE` on `(runId, fixTimeMs)`, on a dedicated single-thread dispatcher. WAL survives process death; at most the last uncommitted row is lost. |
| Pipeline | Fix goes to Room, then to the Rust `RunRecorder.push_fix`, which returns live numbers and cue events. A process-wide `RunRepository` exposes `StateFlow<RunState>` to Compose. No bound service. |
| Cues | `CuePlayer`: `TextToSpeech` plus `AudioFocusRequest(AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)` with `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE`. Focus is requested before speaking and abandoned in `onDone` and `onError`. `SoundPool` tones are the fallback and use the same focus request. |
| Heart rate | Native `BluetoothGatt`, not Nordic's Kotlin-BLE-Library v2 (still alpha). `connectGatt(autoConnect = true)`, write the CCCD, parse 0x2A37 (handle both uint8 and uint16 formats), reconnect with backoff, HR-lost event after 30 s. HR samples go to Room with the fixes. Android 16 drops a lost bond with a re-pair dialog and doesn't auto re-pair; handle it. |
| Battery | Request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, hold a `PARTIAL_WAKE_LOCK` while recording (release in `finally`). Nothing OS is near-stock, and dontkillmyapp.com has no Nothing page, so this is secondary evidence; the 2 h gate is the real test. |
| Recovery | On start, any run with `endedAt IS NULL` is resumed: replay stored fixes into a new `RunRecorder`, mark the gap. |
| Elevation | Server DEM (Copernicus GLO-30) after upload, never GPS altitude (PLAN 3). Unchanged. |

Don't put recording in WorkManager or JobScheduler; Android 16 tightened their runtime quotas, including for jobs alongside a foreground service. WorkManager is fine for blob upload.

**Gates** (PLAN 14, now on the Kotlin app):
1. A 2 h run with the screen locked and the phone in a pocket: no gap over 10 s in raw fixes.
2. Spotify ducks for a cue over the speaker and over Bluetooth headphones. Retest on Nothing OS 5.0.
3. A killed service resumes and marks the gap.
4. A 5-minute `GnssStatus.getCarrierFrequencyHz()` check to find out whether the phone tracks L5 (about 1176 MHz). The spec sheets don't say.

## 6. Data layer

- **Records.** Room holds synced records (sessions, sets, runs, notes, settings) with a hybrid logical clock per field, merged by "higher HLC wins" (rust-core.md section 4). Repositories expose typed reads as `Flow`s. The engine call needs JSON, which the repository builds straight from rows; there is no document to hydrate.
- **Engine state.** A derived cache rebuilt from history on the device. Not synced.
- **Tracks.** Room per fix, then content-addressed blob upload (rust-core.md section 5).
- **Sync.** `POST /api/sync` over HTTPS to `https://callisto.taila63f23.ts.net:8443`, one round trip sending local changes and receiving everything past the cursor. Runs on app open, run end and workout end. No background sync in v1. The web's `offlineQueue.ts` shape (enqueue, acknowledge, backoff 1 s doubling to 60 s) becomes a Room outbox table plus a WorkManager job for blob uploads.
- **Workout flow owner.** A `WorkoutPlanner` in `data/` runs PLAN 10 on the phone: read the check-in, call Rust `predict_readiness`, build the engine bindings, call the Rust liftoscript evaluator for today's program, then map the result to screen state and call Rust `recommend_next_session` for the numbers. Phase A4 builds it; nothing else owns the sequence.
- **Hot path.** Rust calls are synchronous and cheap per call. Engine and liftoscript calls happen at workout start, set logged, session end and check-in, not per frame, so a JSON boundary is fine. Plates and clock formatting are the only per-render calls and are pure Rust or plain Kotlin.
- **Coach.** A server route builds the prompt and validates the response (S14); the phone sends context and gets a validated, enveloped suggestion. Needs the network, so offline behavior is "coach offline", as PLAN 14 already says.

## 7. Charts and map

Vico 3.3.x for the ordinary charts; hand-drawn Compose Canvas for the rest. The owner objected to hand-rolled charts on the web, so the split is explicit and written down (S10): where a library can satisfy DESIGN 6 it is used; where none can, the Canvas code is small and shares the tokens.

| Chart | Where | Why |
|---|---|---|
| e1RM line, readiness line, sets-by-muscle bars, time-split bar | Vico | Per-column fill and stroke, rounded ends, markers, stacked columns, zoom, custom `TextComponent` fonts all exist. |
| Seven-day week strip (U13) | Canvas | Already HTML and CSS on the web, no plotting library. Partial fill, outlined later days, rail colors, today named. |
| Readiness ring | Canvas | `drawArc`, about 40 lines. Vico has no radial chart. |
| Run series (pace, HR, elevation, 7,000+ points, zoom, synced crosshair) | Canvas, in a spike first | Min/max decimation to pixel width, `detectTransformGestures`, a shared `StateFlow<Float>` for the crosshair. Vico is unproven at this size with a live crosshair; if a spike shows 60 fps on 7,000 points it can move into Vico. |

Every chart gets TalkBack semantics and a table view built from the same data (DESIGN 6.2). No library supplies this, and Vico's docs say it isn't supported out of the box, so it is hand-built in all cases. Hit areas of 24 dp or more are enforced in our code. Vico's custom fonts go through a `Typeface` conversion, so Qala Test and DM Mono need a small bridge.

Runner-up for the standard charts: Koala Plot (better-documented zoom, less per-bar styling).

**Map.** MapLibre Native Android with `maplibre-compose` 0.18.0 (Beta, breaking-change policy in minors, so pin it). Two native lines were in flight (13.5.2 stable and a 13.6.x line); pin one deliberately. PMTiles is native: download the region's `.pmtiles` once and read it with `pmtiles://file://`. That also removes the reason PLAN 8a pre-caches z/x/y (a service worker can't cache 206s). The server needs glyph and sprite routes, or the app bundles them in assets; today it serves neither, and a Protomaps style needs both. Run routes are a GeoJSON source plus a `LineLayer`, with mile markers colored by pace. Alternatives were rejected: Google Maps breaks the no-Google rule, osmdroid is raster and stale, Mapbox is proprietary. The `.so` files are large (estimated 10 MB or more); `arm64-v8a` only.

## 8. Screens

Sequence by dependency, not by line count. Line counts are the existing React pages and measure the reference, not the Kotlin effort.

| Phase | Screens | Notes |
|---|---|---|
| A1 shell | Navigation, tabs, Settings (250), All exercises (61), History (32) | Sample data. Proves the design system. |
| A2 run | Start, Live, Guided, Summary (the 358-line `RunPages.tsx`, all stubs) | Real recorder, no sample data. |
| A4 lifting | Today (280, timeline rail, ring, week strip, 10 s snap-back from U9), Check-in (171), Warm-up (103), Workout (311, swipe between exercises with `HorizontalPager`, U5), Rest (88, 1 s timer), Plate calc (103, `PlateDrawing` on Canvas), Plan (185) | The web has no swipe code, so U5's swipe is new. |
| A5 stats | Session complete (145, four charts), Progress (71), Body (66) | Needs charts. |
| A6 coach | Coach (119) | Needs the server route. |
| skip | Landing (150) | Marketing page, not part of the phone logger. |

## 9. Phases and gates

Sizes are relative (S, M, L), not calendar estimates, except where a research report gave one.

| Phase | Work | Gate | Size |
|---|---|---|---|
| A0 | Provision the Android toolchain (below). Run the five spike checks in `rust-core-spike.md`. Run the Vico and Canvas run-series spike. Run the L5 check. | All five spike checks pass, or the documented exit is taken. | M |
| A1 | Design system, tokens generator, fonts, icons, navigation shell on sample data. In parallel with A2. | Contrast test passes on generated tokens; screenshots of Settings and a stub Today against DESIGN. | M |
| A2 | `qala-core` R0 and R1 (run), recorder service, Room, live and summary screens, HR, cues. | The four gates in section 5. | L |
| A3 | `schemaVersion` migration (tracks out), Room records with HLC, `POST /api/sync` and blob routes on the server (both with `requireUser`), web and Kotlin clients. | Phone and desktop converge on edits made offline on both; a conflicting field edit resolves to the higher HLC; airplane-mode session syncs on reconnect (PLAN 14). | L |
| R5 (parallel with A2 and A3) | The Rust liftoscript port, oracle first (rust-core.md section 8). Not an Android phase; it must land before A4. | 60 built-ins and the GZCLP progression match the oracle. | L |
| A4 | R2 and R3 (math, engine), lifting screens wired to the Rust evaluator. | Golden vectors pass on-device; check-in to workout end to end with no network. | L |
| A5 | Charts, map, stats screens. | Charts have table views and TalkBack labels; map works with the radio off. | M |
| A6 | Coach route and screen, release signing, sideload build. | Coach offline state; signed APK installs. | S |
| A7 | Retire `apps/phone` and the Capacitor dependencies. Freeze the React phone shell as a PWA (S13). | Native run gate passed on the phone. | S |

## 10. Server changes

The existing server needs additions, not rewrites. Auth stays Tailscale identity headers.

- `POST /api/sync` (records, cursor, idempotent on record, field and HLC) with per-user SQLite storage, replacing `server/sync.ts` and `server/ws.ts`. The server rejects writes more than a day ahead of its own clock.
- Content-addressed blob upload and download for tracks: resumable, immutable, keyed by hash under the user. Both new routes must call `requireUser`; today only the old `/sync` socket does, and `/api/llm/chat`, `/api/elevation` and `/tiles` rely on the tailnet.
- Glyph and sprite routes for the map style (or bundle them in the app).
- A Coach route that builds the prompt and validates the response.
- Serving the region `.pmtiles` file for download (the route already supports Range requests).

## 11. Toolchain (milestone A0)

Installed 2026-10-01, all under the home directory with no system-wide changes. `source scripts/android-env.sh` puts it on PATH.

| Piece | Version | Location |
|---|---|---|
| JDK | Temurin 21.0.12 | `~/.local/jdk21` |
| Gradle | 9.8.0 (8.14.3 also kept) | `~/.local/gradle-9.8.0` |
| Android SDK | platforms 36 and 37.0, build-tools 36.1.0, platform-tools 37.0.1 (adb), cmdline-tools 16111833 | `~/Android/Sdk` |
| NDK | r29 (29.0.14206865) | `~/Android/Sdk/ndk/` |
| Rust target and tool | `aarch64-linux-android`, `cargo-ndk` 4.1.2 | `~/.cargo` |

Verified: Gradle 9.8.0 reports Kotlin 2.4.10; `cargo ndk -t arm64-v8a build -p qala-lspp-ffi --release` produces a 1.8 MB stripped `.so` (771 KB gzipped) whose LOAD segments are 16 KB aligned (spike check 1, size and alignment; call latency still untested). Not verified: an Android app build. A throwaway Compose app was started and abandoned at the owner's request.

Version notes found on the way, so the real project starts right: Compose BOM 2026.09.00 (Compose 1.12.1) requires Android Gradle Plugin 9.1 or newer, which needs Gradle 9.x. AGP 9.4.1 has built-in Kotlin, so do not apply `org.jetbrains.kotlin.android`; the `org.jetbrains.kotlin.plugin.compose` plugin is still needed (latest Kotlin plugin 2.4.20). AGP 8.13.2 works only with an older Compose BOM.

Still manual, needs sudo: adb access to the phone over USB. No Nothing phone is attached now and no android udev rules exist. Run `sudo apt install android-sdk-platform-tools-common` (it ships the udev rules), replug the phone, enable USB debugging, and check `adb devices`. Wireless debugging is the alternative.

Decisions: the Gradle wrapper jar will be checked in once `apps/android` exists (the old "no Gradle binaries in the repo" rule costs more than it saves). The signing keystore stays outside the repo. The `build:android` task in `deno.json` still assumes the Capacitor flow and is replaced when `apps/android` is created. An x86_64 emulator with KVM may work on this machine; untested.

## 12. Testing

- Rust: `cargo test` over the golden vectors, plus differential fuzz against Deno.
- Kotlin unit tests for ViewModels and repositories.
- Instrumented tests on the phone for golden vectors through the FFI, and for a 2 h track replay through the recorder.
- Compose UI tests for the logging flow. Pick a screenshot tool at A1.
- Device gates are manual and listed in section 5 and PLAN 14.

## 13. Risks

| Risk | Mitigation |
|---|---|
| The Rust liftoscript port is the largest item and A4 waits on it | Oracle first, start in parallel with A2 and A3; a quickjs-kt stopgap only if the schedule forces it. |
| Concurrent edits to one field lose a write | Acceptable for one person; add a history table later if it matters. |
| Spotify ignores or inconsistently honors ducking, especially over Bluetooth | Test early; tones plus the same focus request as fallback. |
| Android 17 changes background audio and foreground-service behavior | Test on Nothing OS 5.0 beta now and again after the October stable release. |
| Nothing OS kills the service around 2 h | Battery exemption, wake lock, `START_STICKY`, Room replay, the 2 h gate. |
| No L5 band, so poorer urban accuracy | Verify with `GnssStatus`; keep the 25 m accuracy gate. |
| Vico can't meet DESIGN 6 or the run series | Canvas fallbacks cost about 100 lines per bar chart and about 300 for the run series. |
| `maplibre-compose` is Beta; two MapLibre native lines | Pin versions. |
| Native `.so` sizes (Rust, MapLibre) add up | `arm64-v8a` only; measure at A0 and A5. |
| Two UI codebases drift | One generated token file and the shared validation script; nothing else shared. |
| Accessibility is hand-built regardless of library | Budgeted in A5; table view per chart. |
