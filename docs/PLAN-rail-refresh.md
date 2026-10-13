# Native phone refresh: master plan

Status 2026-10-13: done. M1 to M4 are merged into main (by 2026-10-03) and the `phone-refresh` branch is gone. The file stays where it is because DECISIONS rows (S23, U9, L19) and code comments cite it by path. Below is the plan as written, so "plan only, nothing built yet" and the Phase 0 steps are history. Still open from it: the real-phone pass (everything ran on the emulator), Haze backdrop blur (parked), the coach radial, and the Warm-up, Workout and Run screens (stubs on main, in flight on `workout`).

When written: branch `phone-refresh`, worktree `../qala-phone-refresh`, plan only, nothing
built yet. Detail docs per milestone (`docs/PLAN-m1-rust-core.md` etc.) are
written when each milestone starts, so detail isn't written against facts that
will move.

## Context

The design-exploration session (muse) handed off a phone refresh on branch
`phone-refresh`: three type faces (Qala Test for brand moments, Recursive for UI
text, DM Mono for records) and a fixed mid-screen day rail on Today, a 28dp
frosted strip of status dots at the left edge that never scrolls, with cards
notched around it. Spec: `docs/HANDOFF-rail-refresh.md`,
`mockups/rail-cutline.html`; working slice `mockups/today-rail-full.html`.

Grilling with berkley changed the scope. **This is native Android only; the web
app is not touched at all** (phone and web differ by form factor). Today has to
show real data, so the work now includes the native data layer, a Rust core and
the check-in and skip flows. Four milestones, each merged to main on its own,
built in the `phone-refresh` worktree.

## Decisions

Scope and form factor
- Web (`apps/web`, phone shell and desktop) stays as is: DM Mono, current
  tablist rail, no Recursive, no glass. It's only the content reference.
- Rail on Today only. Brand top bar scrolls away; only Today's head and the
  preview bar pin. Coach radial is a separate plan.
- No throwaway spike and no real-phone pass planned this round (emulator only).
  Accepted risk, see Risks.

Today content (native)
- Five cards: stage hero, next run, readiness, this week, body weight. The
  coach-note card is dropped until the coach route (A6).
- Rail: stage dots from data. Done dots show actual times in the menu, later
  stages show none. Recover and wind down have no doneness: "now" skips them,
  they're soft interlude dots with static-copy heroes. Rest days have three
  stages (U10), so never assume six. Skipped stage gets a hollow ring.
- Back to now is manual only. DECISIONS U9 (10 s idle snap-back) is superseded.
- Full gesture set with `systemGestureExclusion()` on the strip (200dp cap per
  edge, six dots fit): tap or swipe right opens, swipe up/down steps stages.
  Haptic tick per step and a stronger one on menu open.
- Glass: tint only (`bgSurface` at .62), behind a single modifier so Haze
  backdrop blur can drop in later (parked, not dropped).
- Recursive covers the whole native app: one retarget of `QalaType`.

Data layer
- Room + repositories (Flows) + debug seed (GZCLP golden; release starts empty
  with plain empty states). Sync endpoint later; local writes queue in a Room
  outbox now. Manual `AppContainer` DI, no library.
- **S11 marked decided and built in its shape now**: own record types
  (CheckIn, DaySkip, Availability, BodyWeight, Settings, sessions, runs,
  program), typed Room tables plus a `field_clock` sidecar, HLC
  (wallMs, counter, nodeId) with a random per-install node id, a clocked
  `deleted` field, tombstones kept. **HLC compare and merge live in Rust**
  (overrides `docs/android-native.md` §6 and `docs/rust-core.md:98`, which put
  them in Kotlin); golden vectors shared with the server later.
- Time: instants stored as UTC epoch ms plus the device offset minutes; FFI
  passes ISO 8601 with an explicit offset; skip dates are local `YYYY-MM-DD`.
- Canonical ids: engine short muscle ids ("quads"), one mapping table from
  liftosaur anatomical names with a test that every library muscle maps;
  liftosaur exercise ids ("squat", "benchPress") for lifts, taken straight from
  `get_day`.
- Today's lift day = next program day in sequence after the last logged; a
  training-weekdays setting (default Mon/Wed/Fri/Sat, picker on native
  Settings) decides lift vs rest day; skips shift per `shiftsPlan`.

Rust
- One `qala-core` crate (pure, no clock) and one `qala-ffi` crate exporting
  `qala-core` plus LS++, one `.so`, replacing `qala-lspp-ffi`. Gradle runs
  `cargo-ndk` with a job cap.
- qala-core holds: the full EngineState builder (about 900-1,000 TS lines from
  `packages/engine`: `mod.ts:72-301,475`, `decay`, `running` 1-161, `e1rm`,
  `rtsTable`, `kalman`, `state`), readiness, the full skip/availability logic
  (`availability.ts`), HLC merge, and the new pieces below.
- The **history-to-engine adapter has no TS to port** and lives in qala-core:
  stored records in, engine input out (unit conversion, muscle lookup from the
  compiled liftosaur library, `isMain`, target RPE, run grade and descent).
- Readiness decays fatigue to an explicit `now` (TS used `state.updated`).
  Deliberate divergence from the TS reference; goldens for that case are
  written against the corrected behavior and noted in DECISIONS.
- New logic with no TS source, golden-tested against hand-worked cases:
  readiness 28-day average, per-muscle ready dates (project fatigue decay to
  the threshold), planned load per weekday in engine units (lift
  set-equivalents from the upcoming program days, run load from the run plan),
  7-day weight trend with a run-length note and no verdict.

Docs
- DECISIONS rows: form-factor split, S11 decided plus the HLC details, S6
  (effectively decided by building the Rust core over UniFFI; flip it from
  proposed with that note), canonical ids, time format, decay-to-now, U9
  superseded, native type roles (Recursive never on titles or hero numerals;
  round 1 rejected it there). `docs/android-native.md` §6 gets the HLC move and
  its stale Tailscale sync URL fixed (S22).

## Phase 0: repo prep

1. berkley chose "commit main first": commit all of main's in-flight work
   (about 78 files) as a few logical commits (for example skip/sick flow, phone
   pages and icons, docs move, engine/core changes, server tests, Android
   icons), so the rebase starts from a clean main. Show berkley the proposed
   split before committing anything.
2. Commit the handoff doc and mockups on `phone-refresh`, rebase onto main.

## Parallel track: mockup options (starts at Phase 0, ready before M4)

Design-only, in `mockups/` with the refresh style: 2-3 options each for the
check-in screen, skip sheet, status banner, "Feeling better?" prompt, empty
states, Settings weekday picker, and a dark-mode pass on the strip and menu.
berkley picks; nothing is built from these until picked.

## M1: Rust core and FFI

- New crates `qala-core`, `qala-ffi`; migrate LS++ exports from
  `qala-lspp-ffi` and delete it once the Kotlin side is switched.
- Port in this order, each with goldens: decay and state, `logSession` and
  `calibrate`, the adapter, readiness (with explicit now), availability, HLC
  merge, then the new derived pieces. HLC merge has no caller until the sync
  endpoint exists, so it's golden-only this round: its API shape is locked but
  it isn't integrated.
- Goldens: reuse the pattern in `scripts/golden_liftoscript_lib.ts` (pinned
  clock, seeded random, canonical JSON) into `testdata/golden/engine/`;
  numeric tolerances for Kalman and `exp`; insertion-ordered keys. Also port the
  existing `availability_test.ts` cases and the readiness cases from
  `metrics_test.ts:68-81` and `hybrid_test.ts:47-50`.
- Gradle: `cargo-ndk` task before build, `CARGO_BUILD_JOBS` capped around 8,
  JNA aar dependency, UniFFI Kotlin generated in library mode, arm64 plus
  x86_64 under `-Pqala.abi=x86_64`. Toolchain check: rust 1.94.1, cargo-ndk
  4.1.2 and NDK 29.0.14206865 are installed; **the `x86_64-linux-android` target
  is missing** (needs `rustup target add`, ask berkley first). Release profile
  is `opt-level z` with fat LTO and 32 CPUs / 60 GB; the earlier OOMs came from
  the `qala_lspp` test binary, not a library build, but keep the job cap.
- Exit: `scripts/cargo-test-safe.sh` green (never bare `cargo test`), a loadable
  `.so` in the debug APK, one Kotlin unit test calling readiness through FFI on
  the emulator.

## M2: Room data module

- New `apps/android/data` module (Room, KSP, minSdk 34): entities per record
  type, `field_clock`, outbox, node id, repositories as Flows, `AppContainer`
  built in `MainActivity` and exposed by a CompositionLocal.
- Engine state is a derived cache (S8): recompute by replaying history on launch
  through qala-core and keep it in memory; a local non-synced Room cache table
  only if replay time shows up as a problem.
- Debug seed: GZCLP program (`testdata/golden/liftoscript/builtins/gzclp.json`
  `inputs.text`), a few weeks of sessions, check-ins, weights, a run plan with
  `dayOfWeek`, one skip. Empty states per card for release. **The program's
  progression state lives inside its text**, so the seed text and the seeded
  sessions must be generated together (evaluate, log, finish the day, repeat) or
  hand-checked to agree; otherwise the hero's top set won't match the week card
  or fatigue.
- Stub-stage records: warm-up, lift and run each get a minimal "done" record
  (time, program day index, `stub: true`, no sets or distance) written by the
  Mark done button on their stub screens in M3. The engine adapter treats a
  `stub` session as "day logged" for the program sequence and contributes no
  fatigue; real logging in A2/A4 replaces them.
- Today's-day logic and the stage deriver (`DayStage` with Done / Now / Later /
  Skipped plus passive interlude, mirroring `StageState` in
  `apps/web/src/store/types.ts`) live in qala-core or `data/` per the M1 API;
  pure and JVM-testable either way.
- Exit: `testDebugUnitTest` green with HLC/outbox/stage tests, repositories
  verified against the seed on the emulator.

## M3: Type, Today, rail, notch, menu

- Type: Recursive TTF via `scripts/woff2_to_ttf.py` into the design module,
  `RecursiveFamily` with `FontVariation.Settings` per weight (check
  `FontVariation` is stable at BOM 2026.09.00), retarget `QalaType` to the
  nine-level ladder (`mockups/font-levels.html`). `Type.kt` is hand-written, so
  it's edited by hand; `deno task gen:android` only emits `Tokens.kt` and icons.
  Re-measure heights on the emulator against the CSS reference as was done for
  Qala Test.
- Shell (`QalaApp.kt`): wrap the route scroll column in a `Box` so a screen can
  host fixed layers (strip, pinned head, menu, scrim) and expose the
  `ScrollState`.
- Pinned head with `Modifier.offset { }` riding up under the scrolling top bar
  then sticking; the preview bar expands in 220 ms when `viewing != now`.
- `DayRail` in the design module: 28dp strip, 9dp dots (11dp for now), tint-only
  glass, hit slop around it, `systemGestureExclusion()`, one `pointerInput` for
  tap and drags, semantics (Button role, description like "Day stages: lift now,
  2 of 6 done", custom actions Next/Previous stage), haptics, height follows
  stage count, centered in the band between pinned head and tab bar.
- **Notch by deforming the card itself**: `beamerSurface()` takes an optional
  notch and builds fill, shadow and border from one `Path` (rounded rect minus
  the bite, inner radius `min(8, h/2 - 1)`), with reused `Path` objects. Cards
  read the rail band and scroll value inside the draw lambda, so scroll only
  invalidates draw and the bite lands on the same frame. This removes the web
  prototype's paint-over weaknesses (one-frame trail, dependence on matching
  background, shadow fragment under the notch). The seam stroke uses the card's
  own border color, not the mockup's darker one. Geometry is a pure function
  (card rect + band rect → bite or null under 10dp) with JVM tests. Today cards
  get 44dp start padding.
- Menu: 252dp panel over a `fg`-at-.22 scrim, header, rows, selected row
  inverted, Back to now pinned; open 260 ms `CubicBezierEasing(.25f, 1f, .5f,
  1f)`, close 200 ms ease-in, 25 ms row stagger from 40 ms, offset/alpha lambdas
  only; `BackHandler(enabled = menuOpen)` composed inside Today so it beats the
  shell's; pane semantics and focus to the selected row. No Navigation Compose
  vs Nav 3 decision needed (A4).
- Cards: stage hero per stage, next run, readiness (score, 28-day average, ready
  dates), this week (planned/done cells in engine load units), body weight
  (latest, 7-day trend, run note). CTAs go to titled stubs (Warm-up, Workout,
  Run, Plan) with a real back stack. The Warm-up, Workout and Run stubs carry a
  Mark done button that writes the stub record from M2, so the rail advances
  after a real check-in instead of parking on warm-up.
- Exit: emulator screenshots light and dark at several scroll offsets (bite on
  different cards, no text under the strip), gesture nav on, Remove animations
  on, `testDebugUnitTest` green.

## M4: Check-in and skip flows

- Check-in screen from the picked mockup: recovery 0-10, soreness 1-4 for the
  muscles today's program trains (muscle ids from the mapping table; the four
  fixed muscles on rest days), one line of text. Saves a CheckIn record, which
  feeds readiness and marks the stage done.
- Skip sheet (reason, muscle for injuries, note, span day / 3 / 7 / open), Today
  status banner with Undo, "Feeling better?" prompt from the second sick day,
  once per session. Logic from qala-core (`classifyDay`, `reasonOn`,
  `shiftsPlan`).
- Settings stub gains the training-weekdays picker.
- Exit: end-to-end on the emulator: check in, readiness changes, skip a day,
  undo it, change weekdays, plan shifts.

## Out of scope

Everything under `apps/web`. Coach radial and its trigger icon. Warm-up, workout
and run screens (stubs). Coach-note card. Real record sync and the server side of
S11. Haze backdrop blur. True tight-wrap text reflow. Ember focus ground. A
weight goal and any "on track" verdict.

## Risks

- **Scope.** The engine port (900-1,000 lines) plus an adapter with no spec is
  the largest unknown; the goldens are the safeguard, and M1 should not start M2
  until they pass.
- **Unvalidated on a real phone.** Emulator frame timing is software-rendered and
  says nothing about a real device; the gesture-vs-back check on the emulator is
  meaningful, perf is not. M3 merges without a phone pass, so fling smoothness
  and thumb accuracy on a 28dp strip are untested at merge. Cheapest mitigation
  later: one `dumpsys gfxinfo` run over scripted flings on the phone.
- **Decay-to-now diverges from the TS engine.** Native and web readiness will
  differ for the same history until the TS side is fixed.
- **S11 is built before the server speaks it.** The server is still the
  Automerge one; the client shape may need adjusting when the endpoint is built.
- **Muscle-id mismatch fails silently** (readiness reads zero fatigue); the
  mapping test is mandatory.
- **Stub "done" records are placeholders.** A Mark done session has no sets, so
  it advances the program sequence and the rail without feeding fatigue; if the
  adapter mishandles `stub: true`, empty sessions could corrupt history. A golden
  covers it.

## Critique of the handoff

- "Main untouched" held, but main carries uncommitted Android and docs changes
  this work builds on.
- Its implementation guidance is web-first; with web out, the measured perf
  (headless desktop Chromium) doesn't apply and wasn't a phone anyway.
- Swipe-right starts at x=0, Android's back-gesture zone; it needs
  `systemGestureExclusion`, which the handoff doesn't mention.
- 28dp is under the 48dp touch minimum; needs hit slop.
- "Six dots" is fixed, but rest days have three stages and skipped stages have no
  dot state.
- The mockup has no dark values for the strip, menu or seam.
- The mockup header drops the real top bar (settled: it scrolls away).
- U9 snap-back wasn't addressed (now superseded).
- The seam line is darker than the card border in the mockup.
- Native frosted glass has no cheap equivalent; tint-only differs from the
  mockups.
- The mockups render in desktop Chromium, so their text runs about 6% wider than
  Android (earlier emulator comparison); judge wrapping on the emulator.
- The handoff says Recursive replaces the desktop stand-in; overridden, web is
  untouched.
- The mockup's coach note and body-weight verdict have no source behind them; the
  first is dropped, the second shows trend only.

## Verification

- Rust: `scripts/cargo-test-safe.sh` only. Never a bare `cargo test` (it
  OOM-killed the terminal twice).
- Android: `source scripts/android-env.sh && apps/android/gradlew -p apps/android
  assembleDebug lintDebug testDebugUnitTest`; emulator build with
  `-Pqala.abi=x86_64`, AVD `qala-test`, `wm size 1024x2200`, `wm density 420`,
  screenshots via `adb exec-out screencap -p`.
- Each milestone's exit criteria above gate its merge to main.
