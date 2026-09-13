# Qala: adaptive lifting and running app. Handoff plan for an executing agent

This document is the build plan. It records every decision made with berkley (the owner) in design sessions on 2026-09-13, the environment facts verified on this machine, and the research numbers the engine is built on. Two companion files carry the rest: `DECISIONS.md` is the owner's decision log (what was chosen, what it replaced, what's still open) and wins over older wording anywhere else; `DESIGN.md` is the design system and the screen-by-screen spec behind the mockups. Evidence lives in `RESEARCH-*.md`. Do not re-litigate settled decisions; where something is marked "assumption", it was chosen without asking and can be changed cheaply.

## 1. Goal

A self-hosted workout app for lifting and running (strength/powerlifting, hypertrophy/bodybuilding, and Runkeeper-style run recording and run plans, all feeding one fatigue model) built around liftosaur's liftoscript (programs as code, edited in the browser, synced to the phone), with an adaptive training engine (fitness/fatigue state, per-muscle soreness check-ins, evidence-based volume and deload rules), a local Gemma model for the conversational and explanatory layer, and a goal-driven program generator like Evolve AI's "engine". Look comes from the owner's Beamer app (off-white ground, 2px borders, hard offset shadows) with an ember accent and a dark variant, DM Mono for text and the owner's own Qala Test face for titles and big numbers, plus a light touch of Runkeeper on the run screens only (big stacked numerals, periwinkle route line). The plan and workout screens take their structure from the Volt app reference (week navigator, a tab per day, one exercise at a time with a zoomed-out overview), drawn in Beamer's style. Served from the machine `callisto` over Tailscale now; several users, some on iOS, later.

Name: **Qala**. Location: `/home/berkley/Programming/qala`. Systemd unit `qala.service`, PWA title "Qala".

## 2. Environment facts (verified 2026-09-13)

- Machine `callisto`, Ubuntu, Tailscale installed. Tailnet hostname `callisto.taila63f23.ts.net`, IP `100.105.14.62`. Owner's phone `nothing-phone-4a-pro` (Android) is on the tailnet.
- `tailscale serve` already maps `https://callisto.taila63f23.ts.net/` -> `127.0.0.1:8080` (llama-server) and `/sync` -> `127.0.0.1:8081` (Beamer sync server). Qala must use its own port: `tailscale serve --bg --https=8443 http://127.0.0.1:8500`.
- llama-server (llama.cpp SYCL build on an Intel Arc Pro B60) runs as systemd user unit `llama-beamer` on `127.0.0.1:8080`, OpenAI-compatible, models in `~/models/beamer/`: `gemma-4-E4B_q4_0-it.gguf` (default), `gemma-4-E2B_q4_0-it.gguf`. Preset `/home/berkley/Programming/Beamer/deploy/llama-models.ini` sets `temp = 0`, thinking disabled, `sleep-idle-seconds = 300`. Qala shares this server; do not spawn another.
- Beamer (`/home/berkley/Programming/Beamer`) is Rust + Dioxus desktop. Reuse from it: design tokens in `assets/styles.css` lines 13-55, DM Mono in `assets/fonts/` (Qala copies it; Beamer's Recursive is not used), the LLM client shape in `src/llm/` (60 s request timeout, 5 s connect, degrade gracefully when the server is absent), the systemd unit shape in `deploy/llama-beamer.service`. Beamer tokens: `--bg #f5f5f7; --bg-surface #fff; --fg #0f152a; --fg-secondary #64708b; --fg-muted #94a0b8; --accent #4B0082; --border rgba(75,0,130,.12); --radius 4/6/8px; --shadow-card 2px 4px 0 0 rgba(75,0,130,.12); --shadow-cta 2px 4px 0 0 #4a4a4a, 0 0 0 1px #4B0082`. Qala keeps the token names, swaps the accent to ember `#C2410C`, and derives borders and card shadows from the neutral ink `#0f152a` instead of Beamer's indigo (`DESIGN.md` section 2).
- No liftosaur checkout exists locally. Clone `https://github.com/astashov/liftosaur` (AGPL-3.0) into a scratch dir when vendoring.
- Owner's prose rules for commits, docs, README: no em dashes, no "Co-Authored-By: Claude" or similar trailers, plain colleague voice.

## 3. Decisions (settled; do not reopen)

| Area | Decision |
|---|---|
| Build route | New TypeScript codebase. Vendor liftosaur's two grammars, evaluator, planner chain, exercise DB (as seed), built-in programs, muscle SVGs. Not a fork of their app. |
| License | AGPL-3.0, public repo, NOTICE crediting liftosaur. Owner accepted this explicitly. |
| Runtime | Deno 2 for server, tooling, tests. Frontend React 19 + Vite (revised 2026-09-13 from Preact: liftosaur's own frontend is React 19.2, so vendored UI ports without compat shims; `@automerge/automerge-repo-react-hooks` is official; Capacitor's docs and plugin examples target React). Synced state through `useDocument`/`useHandle`; the live run store through `useSyncExternalStore`. No component kit (Ionic's look fights the design). CodeMirror 6 editor. |
| Sync | One automerge document per user; `@automerge/automerge-repo` on the server with filesystem storage; WebSocket transport; offline-first on both devices. |
| Auth v1 | Tailscale identity headers (`Tailscale-User-Login`) injected by `tailscale serve`. Server keys every document by a stable user id from day one so passkeys/magic-link behind Tailscale Funnel is a module swap later. |
| Phone | Revised 2026-09-13: the Capacitor fallback fired. Run recording needs GPS with the screen locked, and the W3C Geolocation spec (CR 2026-03-26) delivers position only to visible pages; Chromium enforces it and WebKit stops updates for inactive pages. Wake Lock keeps the screen on but one power-button press ends the recording. So the phone shell is one Capacitor 8 app with the React build bundled into the APK (not loaded from a URL), sideloaded on the Nothing Phone, sync still over Tailscale. GPS via `@capgo/background-geolocation` (MPL-2.0, free; `@capacitor-community/background-geolocation` MIT as fallback; Transistorsoft rejected at $399/app). TTS via `@capacitor-community/text-to-speech`, HR via `@capacitor-community/bluetooth-le`. The desktop author shell stays a PWA, and the phone shell still builds as a PWA for iOS users who only lift. iOS native waits until a friend wants runs ($99/yr, a Mac, TestFlight rebuild every 90 days). No Dioxus mobile, no watch. Evidence: `RESEARCH-run-tracking.md` section 1. |
| Shells | One codebase, two distinct shells. Desktop is stats-first (DECISIONS U11): an Overview dashboard home, then Lifts/Running/Body/History stats with drill-downs, grouped above the author tools (editor + live preview, exercise DB, coach memory, calibration). Phone = logger and run recorder (check-in, set table with big steppers, RPE, rest timer, GPS run recording, guided runs, read-only program and run plan). No authoring on the phone. |
| Authority | The liftoscript program is the source of truth for weights. The engine exposes numeric bindings into liftoscript and ships a default adaptive program that uses them. |
| LLM bounds | Gemma may adjust the engine recommendation inside an envelope: weight -10% to +2.5%, sets -2 to +1. Adjusted and engine values are both shown; one tap reverts; every adjustment is logged with the model's one-sentence reason. Out-of-envelope or unparseable output is clamped/discarded and logged. |
| Check-in | Session start: per relevant muscle group, RP 4-point soreness (1 never sore, 2 healed well before, 3 healed just in time, 4 still sore now); one Perceived Recovery Status tap 0-10; optional free-text line parsed by Gemma. After each muscle group's last set: one tap performance (1 exceeded, 2 hit, 3 struggled, 4 could not match last time). Session end: session RPE (CR-10) and auto duration. Daily sleep/stress 1-7 optional, off by default. |
| Model | Evidence-based variant with the spec's API surface kept (section 6). |
| Deloads | Reactive per-muscle, reactive whole-body, and planned block deloads (section 6). |
| Generator | Deterministic rules engine emits a real liftoscript program; Gemma maps free text to parameters and explains. Block types: hypertrophy, strength, powerlifting meet prep (taper to a date), athletic in-season maintenance. |
| Training approaches (added 2026-09-13) | Every liftoscript program carries `approach: 'strength' \| 'hypertrophy' \| 'maintenance'` and `periodization: 'linear' \| 'dup' \| 'block'`. Running lives in `runPlans`, never in programs. Hybrid training is an active program plus an active run plan plus `settings.hybridPriority`. Owner's numbers are authoritative. Strength/powerlifting: squat, bench, deadlift and variations, 1-6 reps at 80-95% 1RM, linear or DUP, key metrics 1RM progression and volume at >85%. Hypertrophy/bodybuilding: 8-15 reps at 60-80%, 10-20 sets per muscle per week, key metrics weekly volume per muscle and progressive overload. Section 6.3 and 12 carry the rules. |
| Running (added 2026-09-13) | Qala records runs itself, Runkeeper-style: live time, distance, current and average pace, splits, route map with mile markers, audio cues, guided workouts, running plans. Owner's complaint that forced this: lifting apps can't also record the run. Runs feed the same fatigue engine as lifting (section 6.4). |
| Run plan representation | Runs are not liftoscript. The planner grammar knows nothing about distance or pace and extending it buys nothing. Runs get a small typed schema in the user document (`runPlans`, section 7), produced by the same generator, edited on the desktop with a form editor, and shown next to the liftoscript program in one week view. Liftoscript stays the source of truth for weights; `runPlans` is the source of truth for runs. |
| Units | Display: `settings.units = { weight: 'lb', distance: 'mi' }`, pace in min/mi. Storage: lifting weights as liftosaur's `{value, unit}`; everything running in SI (metres, seconds, m/s) in the document and the engine, converted only in the UI and when placing split boundaries. |
| Maps and elevation | MapLibre GL JS over self-hosted Protomaps PMTiles for the owner's region, served by the Deno server; elevation from Copernicus GLO-30 on the server, never GPS altitude. No Google, no OSM public tile servers. |
| Gemma learning | Visible, editable per-user coach-memory document (dated, sourced facts) plus a computed profile injected into every prompt. Numeric learning is the calibration step. No fine-tuning. |
| Exercise DB | Liftosaur's 422-entry DB is read-only seed; each user has an overlay: custom exercises (must carry target/synergist muscle tags), hidden list, per-exercise overrides (increment, rounding). Editing happens on the desktop shell. |
| Weight steps | Barbell 5 lb steps (2.5 lb plates), dumbbells 5 lb steps. |
| History | Starts cold. Population defaults for ~6 weeks, then calibrate. Importers are "later". |
| Look | Beamer first, light and breezy (owner after round 1: "we really leaned in super hard to runkeeper"). `#f5f5f7` ground, white surfaces, 2px borders, hard offset shadows, 4/6/8px radii, no pills, ember `#C2410C` as the one action color. Runkeeper survives only on run screens: big stacked numerals, the route line, heart-rate zone colors. No ASICS font, stripes, wordmark or badge art. `DESIGN.md` sections 1-2. |
| Type | Titles and big numbers in **Qala Test**, the owner's own face (a Muse-made OFL fork of Faustina); Faustina is the fallback and the alternate. Everything else in **DM Mono**. Ticking numbers use tabular lining figures. Rejected along the way: Recursive, Recursive oblique, Archivo condensed, DM Mono titles, and the open stand-ins for Trade Gothic, FF Scala and PMN Caecilia. `DESIGN.md` section 3. |
| Icons | Lucide (`lucide-react`, ISC). Runs use `sport-shoe`, not `footprints` (owner). Phosphor was considered and dropped. `DESIGN.md` section 4. |
| Charts | A real TypeScript charting stack (owner): visx 4 (`@visx/*`, MIT, React 19) for every in-app chart, built directly on the design tokens; uPlot 1.6 (MIT, canvas, 21 KB) for dense or zoomable time series such as a run's pace, heart rate and elevation or years of e1RM. Recharts, ECharts, Observable Plot and Chart.js rejected for size or styling control. Mockups stay hand-drawn. `DESIGN.md` section 6. |
| Navigation | Tabs follow Qala's capabilities, not Runkeeper's: Today, Plan, Body, Progress, Coach (decided 2026-09-13; `DECISIONS.md` U2). `DESIGN.md` 7.0. |
| Today | A hero card per stage of the day with this week's load (today outlined, highlighted and named, "Lower A · Squat day"), a readiness ring out of 100 with the owner's average and a low line, a large Start button, and a timeline rail on the left that flicks between stages; the card changes after the workout. `DESIGN.md` 7.1. |
| Workout flow | Plan after the Volt reference (week arrows, a tab per day, overview grid); warm-up before lifting (6.7); one exercise at a time with zoom-out; adaptive rest (6.6); plate calculator (6.8); exercise notes that come back; session complete as charts. `DESIGN.md` 7.2-7.8. |
| Illustrations | None in v1 (liftosaur serves theirs from a CDN; they are not in the AGPL repo). Their `images/front-muscles.svg` and `back-muscles.svg` are in the repo and are used for the soreness grid. |

## 4. Repository layout (Deno workspace)

```
qala/
  deno.json                 workspace; tasks: dev, build, test, serve, vendor, build:android (web build, cap sync, Gradle release, apksigner), tiles:extract (pmtiles extract + unpack to z/x/y), dem:fetch (GLO-30 tiles for the region)
  LICENSE (AGPL-3.0), NOTICE (liftosaur, fonts, Lucide, visx, uPlot attributions), README.md
  PLAN.md, DECISIONS.md, DESIGN.md, RESEARCH-*.md    this plan, the owner's decision log, the design system and screens, the evidence
  assets/fonts/             QalaTest-*, DMMono-*, Faustina-* faces; qala-test/work/ (font build scripts)
  mockups/                  build.mjs and the generated review canvas; not app code
  packages/
    liftoscript/            vendored from liftosaur, same file names; runtime.ts is ours
    core/                   data model, automerge doc schema + migrations, exercise seed + overlay, units/rounding
    engine/                 adaptive engine, pure TS, no DOM, no automerge
    generator/              rules -> liftoscript program text
    llm/                    prompt builders, JSON schemas, response validation; transport injected
    run/                    pure TS: GPS fix filter, distance, pace smoothing, auto-pause, splits, grade-adjusted pace, run load, guided-workout step machine
  apps/web/                 React 19 PWA: src/shell-desktop, src/shell-phone, src/shared (charts/ on visx and uPlot), src/theme (tokens.css, fonts.css)
  apps/phone/               Capacitor 8 project wrapping apps/web's phone shell build; android/ now, ios/ later; native plugin glue only
  server/                   Deno: automerge-repo sync, auth, /api/llm proxy, static files, tiles/ (PMTiles + unpacked z/x/y), elevation.ts (GLO-30)
  deploy/                   qala.service (systemd --user), tailscale-serve.md
  docs/                     engine.md (math + rules + citations), liftoscript-extensions.md
```

## 5. Milestone M1: vendor liftoscript (`packages/liftoscript`)

Copy from liftosaur master, keeping file names so upstream diffs stay readable:

- Expression language: `liftoscript.grammar` (Lezer, ~95 lines), `src/liftoscript.ts` (generated LR parser), `src/liftoscriptEvaluator.ts` (~1400 lines, tree-walking, emits `ILiftoscriptEvaluatorUpdate` records), `src/liftoscriptFns.ts` (valibot `VScriptBindings` + builtins), `src/parser.ts` (`ScriptRunner`; stub its `rollbar` and `utils/dialog` imports).
- Program text language: `src/pages/planner/plannerExercise.grammar`, `plannerExerciseParser.ts`, `plannerExerciseEvaluator.ts`, `plannerEvaluator.ts`, `src/models/plannerStructure.ts`, `plannerProgram.ts`, `programToPlanner.ts` (serialises an evaluated program back to text).
- Models: `src/models/weight.ts` (imports `exercise.ts` for `Exercise_onerm`, `Exercise_defaultRounding`), `set.ts`, `muscle.ts`, `exercise.ts` (the DB: id, name, defaultEquipment, types, startingWeight, plus `metadata` with `targetMuscles`, `synergistMuscles`, `bodyParts`, `sortedEquipment`), `src/types.ts`, `utils/math`, `utils/collection`. Skip `exerciseDescriptions.ts` (862 KB text).
- Seed data: `programs/builtin/*.md` (60 programs, YAML frontmatter + ```liftoscript block). SVGs: `images/front-muscles.svg`, `images/back-muscles.svg`.
- Runtime to lift out and rewrite (they import ducks, lens-shmens, navigation thunks, api/service): `Program_runFinishDayScript` (program.ts ~line 529), `Program_runAllFinishDayScripts` (~652), `Program_forceEvaluate`, `Program_nextDay`, `Progress_createScriptBindings` (progress.ts ~243), `Progress_createScriptFunctions`, `Progress_runUpdateScriptForEntry` (~959). Put them in `packages/liftoscript/runtime.ts` against `@qala/core` types.
- Liftoscript semantics to preserve (from liftosaur docs): `progress: custom(state...) {~ ~}` runs once after the workout per exercise and may write `weights[week:day:variation:set]`, `reps`, `RPE`, `timers`, `numberOfSets`, `rm1`, `setVariationIndex`, `exerciseVariationIndex`, `descriptionIndex`, `state.*`; `update: custom() {~ ~}` runs at `setIndex == 0` and after every set and writes only the current entry. Built-in progressions `lp(...)`, `dp(...)`, `sum(...)`. Bindings: `day, week, dayInWeek, weights/w, originalWeights, completedWeights/cw, rm1, reps/r, minReps/mr, completedReps/cr, completedRepsLeft, RPE, completedRPE, amraps, askweights, logrpes, timers, setTime, completedSetTime, completedSetTimeLeft, isCompleted, ns/numberOfSets, programNumberOfSets, completedNumberOfSets, setIndex, setVariationIndex, exerciseVariationIndex, descriptionIndex, bodyweight`, `state.<name>`, `var.<name>`.
- New engine bindings added to `VScriptBindings`, all numbers so the evaluator's type system is untouched: `readiness` (0-1), `prs` (0-10), `soreness` (max RP score over the exercise's target muscles, 1-4), `fatigueLocal` (0-1 normalised per-muscle fatigue), `deload` (0 none, 1 muscle, 2 systemic), `recWeightPct` (engine's recommended weight change, -10..2.5), `recSets` (-2..1). Document in `docs/liftoscript-extensions.md`.
- Tests: parse and evaluate all 60 builtin programs without error; simulate 3 training days of GZCLP and assert next-day weights match liftosaur's documented progression.

## 6. Milestone M2: engine (`packages/engine`)

Public API keeps the owner's spec: `logSession(state, workout) -> state`, `predictReadiness(state, checkin) -> Readiness`, `recommendNextSession(state, exercises, targetDate) -> Recommendation`, `calibrate(history) -> state`. Pure functions over an `EngineState` value; persistence belongs to the caller.

### 6.1 Why not the spec's model as written

Research (Hellard 2006; Imbach 2025 Sci Rep doi:10.1038/s41598-025-88153-7; Peng and Swartz; Liversedge/GoldenCheetah): the two time constants correlate 0.99 and the two gains 0.91 in estimation; with informative priors only 1-4 of 10 MCMC chains converge; a fitness-only model predicts held-out data equally well; least squares on ~14 performances gives meaningless confidence intervals. Kolossa 2017 (IJCSS doi:10.1515/ijcss-2017-0010) cut error from 3.35% to 2.31% MAPE by writing the model as a state space and correcting with a Kalman filter even with poorly identified taus. Recovery data (Goulart 2020, Bartolomei 2017) show lower-body volume load back by 48 h and perception by 72 h, so a 7-day per-muscle fatigue tau is too slow (65% left at 72 h); Busso 2003's fast fatigue factor had tau 2.3 d.

### 6.2 State and equations

Discrete-time decay per the spec, `dt` in days from ISO 8601 timestamps:

```
x_t = x_{t-1} * exp(-dt / tau) + k * input_t
```

```
fitness[lift]           F_l, tau 45 d (prior; Imbach 43.3, Busso 40.8, Hellard 38). input = volume load for that lift / current e1RM (dimensionless)
fatigueMuscle[group]    G_m. tau 2.0 d for chest, front/side/rear delts, triceps, biceps, forearms, abs; 2.5 d for lats/upper back, quads, hamstrings, glutes, calves, lower back.
                        input = sum over sets of setFactor, target muscle weight 1.0, synergist 0.5, setFactor = 1 + 0.1*(RPE-8) clamped 0.5..1.5
fatigueSystemic         G_s, tau 10 d. input = sRPE (CR-10) * minutes / 100
kalman[lift]            {p0, k1, theta = k2/k1 (prior 4.0 from Peng/Swartz; fixed until >= 20 observations for that lift), P (3x3 covariance)}
```

Observation per main lift (default main lifts: squat, bench press, deadlift, overhead press; user-editable): `e1RM_obs = p0 + k1*F_l - k1*theta*(G_weighted + G_s)` where `G_weighted` is the target/synergist-weighted sum of `G_m` for that lift and `e1RM_obs` is the best completed set's e1RM by these rules (Epley tracks the RTS RPE table within 2% from 2 to 10 reps; Brzycki runs away above 10; Reynolds 2006):
1. Reps = 1 at RPE >= 9.5, or a set flagged as a test or meet attempt: e1RM = load, marked **tested 1RM**, observation noise one quarter of an e1RM's.
2. RPE logged and reps + RIR <= 10: `e1RM = load / RTS_pct(reps, RPE)`. `RTS_pct` is the RTS/Tuchscherer %1RM-by-reps-and-RPE table in `RESEARCH-design-and-programming.md` B2, copied into `packages/engine/rtsTable.ts`. That table is a third-party reproduction not checked against RTS's original; its 6 reps @ RPE 10 = 83.7% agrees with Helms 2016, but spot-check the other rows against a second source before shipping, and use rule 3 for any cell that disagrees by more than 1 point.
3. RPE not logged and reps <= 10: `e1RM = load * (1 + (reps + RIR_est) / 30)`, `RIR_est = 10 - target RPE` if the program set one, else 0; if reps + RIR_est = 1, e1RM = load.
4. Reps > 10: no observation. Those sets feed rep-range PRs, not the filter.
Put these in `packages/engine/e1rm.ts`; liftoscriptFns' `calculate1RM` stays for liftoscript compatibility only. A linear Kalman update on each observation; `calibrate(history)` replays history through `logSession` and the filter. No least squares anywhere.

Readiness at session start (0-1) = weighted combination of: PRS z-score over the athlete's own rolling 4-week window (flag z <= -1.5 or PRS <= 4), soreness grid (any 4 on a muscle the session hits), normalised `G_m` and `G_s`. Readiness is derived from the check-in, not from load; the load-driven fatigue states are inputs to the Kalman observation and to the per-muscle bindings.

### 6.3 Rules (document with citations in `docs/engine.md`)

Per-muscle weekly set targets (RP landmarks, intermediate lifters; MV / MEV / MAV / MRV, sets per week):

| Muscle | MV | MEV | MAV | MRV |
|---|---|---|---|---|
| Chest | 2-4 | 4-6 | 6-16 | 16-24 |
| Back | 10-12 | 12-14 | 16-22 | 22-30 |
| Quads | 2-4 | 4-6 | 6-14 | 14-18 |
| Hamstrings | 0-2 | 2-4 | 2-8 | 8-14 |
| Glutes | 2-6 | 6-8 | 8-24 | 24-30 |
| Side delts | 2-6 | 6-8 | 8-24 | 24-30 |
| Biceps | 6-8 | 8-10 | 14-20 | 20-26 |
| Triceps | 0-4 | 4-6 | 6-16 | 16-20 |
| Calves | 2-4 | 4-6 | 6-16 | 16-24 |

Muscles without a row use chest's numbers.

Volume counting and the owner's 10-20 band (`RESEARCH-design-and-programming.md` B4-B5). RP counts direct sets for intermediates; the 10-20 band comes from studies counting sets per muscle, which fit best with indirect work at half (Pelland 2026, Sports Med 56:481). They measure different things, so track both per muscle per Monday-Sunday week:
- Hard set: completed work set with logged RPE >= 7 (or program target RPE >= 7 if none logged). Main-lift work sets also need load >= 50% of the reference 1RM.
- `directSets_m` = hard sets where m is a target muscle. `fracSets_m` = `directSets_m + 0.5 * hard sets where m is a synergist` (same weighting as the fatigue input).
- The owner's band constrains `fracSets_m`: grow [10, 20], emphasise [14, 20], maintain has no fractional floor and keeps `directSets_m` in [MV hi, MEV hi].
- RP constrains `directSets_m`: at least MEV lo when the muscle is trained, at most MRV lo.
- Conflicts: RP's MRV beats the owner's floor (it is a recovery guard); the owner's 20 beats RP's MAV/MRV (evidence above 20 is thin, Baz-Valle 2022). Hamstrings reach 10 fractional only with hinge and squat credit, else plan fewer and log `VOLUME_CAPPED_BY_MRV`. Back starts at 14.
- Block start `fracSets = max(band lo, MEV hi + indirect credit)`, +2 per week, capped. The RP set-progression rule below can slow or hold the ramp but never pass a cap.
- Strength blocks: MEV to about 10 fractional sets per muscle (1RM gains flatten beyond about 5, Pelland 2026); the time goes to intensity and main-lift practice.
- Running set-equivalents (6.4) never count here.

RP set progression (per muscle, evaluated at the next session that hits the muscle): soreness and performance both 1 -> +2 sets; both <= 2 -> +1 set; any 3, or soreness 3-4 -> hold; performance 4 or PRS <= 4 -> per-muscle reactive deload session (50% sets, +2 RIR, one session), logged with reason code.

Whole-body reactive deload: e1RM observations on two main lifts below their own 4-week median on two consecutive sessions -> deload 5-7 days: sets -40%, load -10%, keep frequency (Bell 2023 Delphi consensus, doi:10.1186/s40798-023-00633-0). Planned deloads come from the program (generator emits them every 5-6 weeks; Bell 2024 survey mean 5.6 wk).

Progression between sessions (double progression, ACSM 2009 increments): when the top of the rep range is hit at or below target RPE on two consecutive sessions, +2.5% or the smallest plate step (5 lb barbell) for upper body, +5% for lower body, rounded to the user's plate settings via `roundWeight`. In-session (Helms 2018, doi:10.3389/fphys.2018.00247): 2% load per 0.5 RPE outside the target range, capped at +/-6%. RPE prescriptions use the RIR scale: 10 = 0 RIR, 9 = 1, 8 = 2, 7 = 3; treat reported RIR > 3 as unreliable.

Double progression is the hypertrophy path. Strength programs (1-6 reps at 80-95%) progress differently. Percentages are of a **reference 1RM** fixed for the block, so intensity-zone counts don't drift when e1RM moves mid-block. It updates at each block boundary to the Kalman e1RM, or to a newer tested 1RM. Within a block, the strength-day top set autoregulates by Helms 2018: more than 0.5 RPE off target moves the next same-type session's load 2% per 0.5 RPE, capped at +/-6%, rounded to plates. Isolation exercises that can't move by a 5 lb step add reps to 15, then 20, before load.

Flags (rule-based, never diagnostic): `recoveryNudge` when weekly monotony (mean/SD of daily sRPE-load) > 2.0, or weekly strain z > 1.5 vs the athlete's 4-week baseline, or >= 4 sessions in 7 days with sRPE >= 8; `injuryRisk` when the same muscle scores soreness 4 on two consecutive check-ins, or an exercise gets the joint-pain tap twice in 7 days.

Weekly summary numbers: sessions, tonnage, sRPE-load (label it "TRIMP" in the UI), composite performance score (mean over main lifts of `p0 + k1*F - k1*theta*G`, each normalised to its 4-week baseline, reported as % change), PRs, per-muscle sets vs target.

The owner's key metrics, computed in `packages/engine/metrics.ts`:
- **1RM progression** (strength): per main lift, daily best e1RM, Kalman estimate, and tested 1RMs, plus % change over the block against the reference 1RM.
- **Volume at >85%** (strength): intensity zones by load / reference 1RM (<70, 70-79.9, 80-84.9, 85-89.9, 90+). Report `NL85` = reps at >= 85% per lift per week, `T85` = tonnage at >= 85%, and the 90+ counts. Also `NL` = reps of work sets and average relative intensity `ARI = T / NL / reference 1RM`. No paper sets an optimal NL85; the block tables in section 12 are the targets and Prilepin's ranges are per-session warnings only.
- **Weekly volume per muscle** (hypertrophy): `directSets_m` and `fracSets_m` against the band and RP caps, plus per-muscle volume load `VL_m = sum(load * reps * w)`, w 1.0 target, 0.5 synergist. Bodyweight movements use `bodyweight * factor + added load` (pull-up 1.0, dip 1.0, push-up 0.65; assumptions).
- **Progressive overload** (hypertrophy): rep PRs at a given load and load PRs at a given rep count per exercise, and volume load per exercise week over week. Sets over 10 reps show rep PRs, never an e1RM.

`Recommendation = {action: 'progression'|'maintenance'|'deload', lifts: [{exerciseId, targetWeight, targetSets, targetReps, targetRpe}], envelope: {weightPctMin: -10, weightPctMax: 2.5, setsMin: -2, setsMax: 1}, reasons: ReasonCode[]}`. Reason codes are enumerated so the LLM narrates them and the UI can show them without the LLM.

### 6.4 Running in the engine

Evidence and derivations are in `RESEARCH-running.md`. Engine internals use metres and seconds; the UI converts to miles. `logSession(state, workout)` accepts both history kinds (section 7) and replays them in date order, so a run's leg fatigue decays into the next lift and vice versa.

What the research says to protect. Concurrent running barely touches maximal strength (pooled SMD -0.06) or hypertrophy (-0.01); explosive strength takes a small hit (-0.28), and trained lifters doing both in one session a larger one (-0.66). Frequency and duration of running are the only dose variables with evidence. No running-versus-cycling penalty (the meta-analyses disagree). So the engine protects lower-body strength and power, not muscle size.

New and changed states:

```
fitnessRun              F_run, tau 42 d (Morton's runners fit 40 and 50 d). input = rTSS / 100
fatigueMuscleDamage[m]  D_m for quads, calves, hamstrings, glutes; tau 5 d. Added into G_weighted with G_m.
kalmanRun               observation = VDOT (Daniels) from any GPS effort of 3.5-230 min rated sRPE >= 8.
                        theta prior 2.0 (Morton k2/k1), fixed until 20 observations. Same filter as kalman[lift].
criticalSpeed           CS, slope of distance vs time through the best grade-adjusted 400, 800 and 5000 m efforts in the last 90 d.
```

Inputs per run:
- Systemic: `G_s += sRPE * minutes / 100`, the same formula as lifting, from one sRPE tap after the run. With no tap, use a per-user sRPE-load / rTSS ratio fitted after 10 paired runs; prior 3.6 per 100 rTSS (derived).
- External load: grade-adjusted speed with Minetti's energy-cost ratio uphill and `max(Minetti, 0.88)` downhill (1.0 below -18%); normalised graded pace NGP; `IF = NGP / thresholdPace`; `rTSS = hours * IF^2 * 100`. `thresholdPace` = CS once three qualifying efforts exist; before that, from a recent race time the user enters, converted by Riegel (assumption). Banister TRIMP only when HR is recorded; otherwise rTSS and sRPE-load carry it and HR-zone charts are hidden.
- Per-muscle, in lifting set-equivalents (all derived, anchored on knee-extensor force loss after runs compared with a scored squat session; mark as assumptions in `docs/engine.md`). Per km, intensity factor `z = 0.5` below 0.78 CS, `1.0` at 0.78-1.0 CS, `1.5` above CS; `q = 0.18 * z`. Into `G_m`: quads q, calves 0.8q, glutes 0.5q, hamstrings 0.4q (0.8q at z 1.5). Kilometres after minute 120 go into `D_m` instead.
- Eccentric damage: per 100 m descended on grades steeper than -5%, quads 0.4 and calves 0.25 into `D_m`, times the repeated bout factor `RBE = max(0.65, 1 - 0.035 * n)` where n = runs with >= 200 m descent in the last 42 d.
- Running set-equivalents are fatigue only. They never count toward MEV/MRV targets or the RP set progression. Run sRPE-load does join the monotony and strain flags.
- Held-out check as in 6.1: after 20 VDOT observations, compare F_run-only prediction against F_run with the fatigue term; keep the simpler model if it predicts as well (Imbach 2025 logic).

Cross-modal rules (each emits a `ReasonCode`; tagged [expert] or derived in `docs/engine.md`):

| Condition | Action |
|---|---|
| Run >= 30 min ended < 8 h before a session with squat, deadlift, lunge or leg press | Expected reps -1 per set on those lifts; doubled observation noise for their e1RM in the Kalman update |
| >= 8 quad set-equivalents lifted in the previous 24 h | Planned run at z 1.5 or > 90 min becomes easy; reason shown on the Start screen |
| Run and lift on the same day | Lift first. Warn if the gap is < 6 h, or < 24 h when the active program's approach is `strength` |
| Running-derived quad or calf fatigue (G_m + D_m from runs) above one typical lifting session for that muscle | No load increase on lower-body lifts that session |
| Run >= 21 km at z >= 1 | No heavy lower body for 48 h |
| Run >= 42 km | No heavy lower body for 5 d, then one lower-body session at 50% sets |
| Heavy lower-body session in the previous 24 h | Next planned hard run is suggested as easy (running economy stays impaired ~24 h) |

Running flags (rule-based, never diagnostic): a single run longer than 1.10 x the longest run in the previous 30 days (HRR 1.64); weekly distance up more than 30% across two weeks (HR 1.59, CI crosses 1); both weighted up when the user has logged a running injury. No acute:chronic workload ratio anywhere, computed or displayed (Impellizzeri and Lolli critiques); the UI shows acute and chronic load side by side instead. The 10% weekly rule is not used (it failed its only trial, Buist 2008).

Weekly summary adds: run count, distance, moving time, rTSS, VDOT trend, and lifting plus running sRPE-load as one TRIMP number with the split shown.

### 6.5 Tests

- The spec's validation test: simulate 3 weeks, weeks 1-2 moderate load and normal RPE, week 3 heavy load and high RPE; assert per-muscle and systemic fatigue spike in week 3 and decay over simulated rest days; assert fitness accumulates monotonically across the 3 weeks.
- Hybrid week: a 10 km tempo run the evening before squat day lowers expected squat reps and quad readiness; the same run 30 h earlier does not trigger the < 8 h rule; a 400 m-descent trail run adds to `D_m` and a repeat within 42 d adds less.
- Running inputs: rTSS equals 100 for one hour at threshold pace on flat ground; grade adjustment is monotonic uphill and floored downhill; VDOT from a synthetic 5 km at known time matches Daniels' table within 0.5.
- Cross-modal table: each row fires on its boundary and not just below it; running set-equivalents never change a muscle's weekly set count.
- Kalman: synthetic e1RM series from known `p0, k1, theta` plus noise; the filter recovers `p0` and `k1` within 10% after 30 observations; `theta` stays at prior until observation 20.
- RP rule table, both deload triggers, in-session RPE adjustment cap, envelope clamping, plate rounding to 5 lb, `dt` across DST and month boundaries.

### 6.6 Automatic rest timer (`packages/engine/rest.ts`)

Owner request 2026-09-13: rest should set itself from how the lifter is doing. Evidence and every derivation: `RESEARCH-rest-and-warmup.md` part 1. Tags: [meta] [RCT] [obs] are sourced; [derived] numbers are assumptions to tune.

Exercise class: `main` = on the main-lift list; `isolation` = one target muscle group and no synergists from another body part (DB `bodyParts`); `secondary` = everything else. Derived, overridable per exercise in the overlay.

Base rest `B` (s, end of set to start of next) and clamps:

| approach | main | secondary | isolation |
|---|---|---|---|
| strength (1-6 reps) | 180 [120, 300] | 150 [90, 240] | 90 [60, 150] |
| hypertrophy (8-15), maintenance | 150 [90, 240] | 120 [90, 180] | 90 [60, 150] |

When the liftoscript entry sets `timers` explicitly, that value is `B` for the exercise; the clamps, the adjustments below and the personal multiplier still apply (assumption; keeps a program author's intent without losing the adaptive part). Programs without `timers` use the table.

Sources: strength main 180 (Grgic 2018 [meta], Senna 2016 [obs], Ratamess 2007 [RCT]); hypertrophy secondary 120 (Rosa 2023, Kassiano 2020 [RCT]); isolation 90 and the 60/90 floors (Singer 2024 [meta]: benefit above 60 s, plateau above 90 s); strength floor 120 (Scudese 2015, Willardson and Burkett 2008 [RCT]); 300 cap (de Salles 2009 [secondary]). The other cells are midpoints [derived].

Adjustments after each logged work set, `d = RPE_logged - RPE_target` (top of a range):
1. Effort: `A_effort = clamp(30 * d, -30, +45)` (15 s per 0.5 RPE) if RPE logged and no failure [derived; direction from Scudese 2015, Ratamess 2007, Santos 2021].
2. Failure: RPE >= 10, or reps short with RPE >= 9.5: `+60` main and secondary, `+30` isolation, replacing A_effort [derived; Fonseca 2020, Santos 2021].
3. Reps below the bottom of the range without failure: `+30` [derived].
4. Session fatigue, the larger of: set 4 or later of a strength main lift `+30` (Ratamess 2007: sets 4-5 fell ~21% at 3 min [RCT]); rep drift `1 - reps_this / reps_first >= 0.20` at the same load (hypertrophy, maintenance) or `RPE_this - RPE_first >= 1` (strength) `+30` [derived].
5. Readiness: `+30` if soreness 4 on the exercise's target muscles, `prs <= 4`, or `fatigueLocal >= 0.7` (0.7 to calibrate). Never negative [derived, no study].
6. Personal multiplier `m` per (approach, class), start 1.0, bounds [0.75, 1.5].

`R = clamp(round_to_15(B * m + A_effort_or_fail + A_short + A_cum + A_ready), min, max)`. Antagonist supersets: 90 s inside the pair (60 s when more than 10% over time budget), 120 s after it (Paz 2019, Behenck 2022 [obs]); strength main lifts never pair.

Taps: "Ready early" starts the next set any time (below the min clamp on a strength main lift, one warning line); "+30 s" extends; from the min clamp an optional "ready?" prompt (Wolfe 2024 [obs, small]). Learning `m` (alpha 0.1, about 10 rests of memory) [derived]: after the next set, `m_obs = clamp((actual - adjustments) / B, 0.75, 1.5)`; if that set hit target (reps in range, RPE <= target + 0.5) `m += 0.1 * (m_obs - m)`; if it missed after an early start, no update; if it missed after resting the full R, `m += 0.1 * (min(1.5, 1.15 * m) - m)`. Warm-up sets never update `m`. After 20 rests on one exercise, a per-exercise `m` overrides the class value. Stored in `restProfile` (section 7).

The rest row always says why: "3:15 · base 3:00, your pace -15 s, last set RPE 9 vs 8 +30 s". Reason codes: `REST_FAILURE`, `REST_EFFORT_HIGH`, `REST_EFFORT_LOW`, `REST_REPS_SHORT`, `REST_LATE_SET`, `REST_DRIFT`, `REST_LOW_READINESS`, `REST_SUPERSET`.

Tests: every table cell and clamp; the failure rule replaces effort; an early start that fails never lowers `m`; `m` after 10 on-target early taps at 90 s with B 120 equals 0.75 + 0.25 x 0.9^10 (0.837) within 0.001; warm-up sets don't touch `m`.

### 6.7 Warm-up generator (`packages/engine/warmup.ts`)

Owner request 2026-09-13: warm-ups are key, using the owner's foam roller and Theragun plus cardio before lifting. Evidence: `RESEARCH-rest-and-warmup.md` part 2. Inputs: today's exercises in order with class, muscles, working load W and reference 1RM or e1RM; approach; check-in soreness and PRS; `equipment` (section 7); a run finished within 15 min; time budget T for blocks 1-3 (default 8 min, 15 min when block 1 is 10 min). Output, in order:

1. **General** (RAMP "raise" [expert]; Barroso 2013 [RCT], Abad 2011 [obs]): 5 min easy on hypertrophy and maintenance days (skippable); 10 min easy when the first main lift's top set is >= 85% of reference 1RM. Easy = conversational, about 60% HRmax. Owned bike, rower or treadmill; with none, 3 min brisk walking or marching plus bodyweight squats. Skipped when an easy run of <= 15 min or <= 3 km (below 0.78 CS) ended within 15 min (Ribeiro 2018: 3 km at 90% threshold cost no leg-press volume, 5 km cost 12% [obs]).
2. **Soft tissue** (optional; only with a tool owned and T >= 8 min): target muscles of the first two exercises plus any trained-today muscle with soreness >= 3, capped at 4. Foam roller 90 s per muscle or side, 120 s at soreness >= 3 (Nakamura 2021 [RCT]; the soreness bump is [expert]). Percussion 60 s per muscle, never on sore muscles (Leabeater 2024 [obs]: slightly more soreness), never on prime movers before a top set >= 85% [weak]. One tool per muscle. Research default gives percussion only the muscles the roller can't reach; the owner likes the Theragun, so Settings has "Prefer Theragun where allowed", which moves any non-excluded muscle to percussion.
3. **Dynamic mobility** (no static or PNF holds before lifting; Behm 2016 [review]): 2 drills x 8-10 reps for up to 3 muscle groups, about 1 min each. Quads and glutes: bodyweight squats, walking lunges, front-to-back leg swings. Hamstrings, glutes, lower back: bodyweight good mornings, glute bridges, straight-leg kicks. Calves and ankles: knee-to-wall ankle rocks, calf raises, low pogo hops. Chest, front delts, triceps: incline push-ups, scapular push-ups, band pass-throughs. Lats, upper back, biceps, rear delts: band pull-aparts, scapular pulls, thoracic open-books. Overhead days: wall slides, band pass-throughs, prone Y-T-W. Trunk: dead bugs, bird dogs.
4. **Ramp sets** per exercise, counted in lifting time, never cut. Tier by `I = W / reference 1RM` (or e1RM; with neither, `1 / (1 + (reps + RIR) / 30)`):

| Tier | I of top work set | Ramp, % of W x reps | Rest after each step |
|---|---|---|---|
| T0 | < 0.60, or isolation | none; first exercise for a muscle group today: 1 x 10 @ 50% | 45 s |
| T1 | 0.60-0.749 | 50% x 8, 80% x 4 | 45, 90 s |
| T2 | 0.75-0.849 | 45% x 6, 65% x 4, 85% x 2 | 45, 60, 90 s |
| T3 | 0.85-0.919 | 40% x 5, 60% x 3, 75% x 2, 88% x 1 | 45, 60, 90, 120 s |
| T4 | >= 0.92 | 40% x 5, 55% x 3, 70% x 2, 82% x 1, 91% x 1 | 45, 60, 90, 120, 120 s |

The last step near 80-90% of W is anchored on crossover trials (Ribeiro 2020, Viveiros 2024 [obs]); earlier steps and rests are coach practice [expert]. Rules [derived]: round to 5 lb (.5 up); steps under the 45 lb bar become "bar x 8" and merge; drop a step equal to the previous one or to W; a secondary compound whose muscles were already trained today gets 1 x 4 @ 80% W; soreness 4 on the lift's target muscles or `prs <= 4` inserts an extra step at the mean of the first two loads x 5 [expert, no study]; a lower-body main lift after upper-body work gets its full ramp (Neves 2025).

When time is short, cut soft tissue first, then mobility to 1 drill per group, then general to 3 min. Before runs: easy runs need no warm-up beyond a slower first 5 min; tempo, interval and race efforts get 10-15 min easy, 3 min dynamic drills, then a few strides (Mortimer 2026 protocol [obs]). The UI labels soft-tissue dosing and check-in-driven changes as coach-practice rules.

Tests: the worked examples in the research file (strength squat 225 x 5 at 1RM 265 ramps 100 x 6, 145 x 4, 190 x 2; bench 240 at 1RM 250 ramps 95/130/170/195/220; overhead press 95 x 8 at e1RM 125 gives bar x 8, 60 x 4, 80 x 2); soreness 4 inserts the extra step; a 12 min easy run 10 min before lifting removes block 1; cut order under T = 5 min.

### 6.8 Plate calculator (`packages/core/plates.ts`)

Owner request 2026-09-13: show what goes on each side, color-coded, during rest for the next set, with a shorthand on the logging screen. Reference screenshots the owner shared: a barbell drawing with color plates and a per-side summary.

**Inventory** (`settings.plates`, per user, editable on first barbell exercise and in Settings): the unit; bars `[ { id, name, weight, default } ]` (default a 45 lb bar; the owner adds others such as a 35 lb bar, a trap bar or an EZ bar, weights unknown until entered); plates `[ { weight, pairs, color } ]` where `pairs` may be "enough"; optional collar weight (default 0). An exercise's bar comes from `exercises.overrides[id].bar`, defaulting to the default bar for DB equipment `barbell` and asking once for trap and EZ bars. Dumbbell and machine exercises get no calculator.

**Algorithm.** Per-side target `t = (W - bar - 2 * collar) / 2`. A bounded knapsack over plate pairs, in 0.25 lb (or 0.25 kg) units, picks the multiset that minimizes, in order: `|achieved - t|`, plate count, then prefers heavier plates. Greedy is wrong once pair counts are limited (for example no 45s left). If `t` can't be hit exactly, show the nearest loadable weight below and above, with one tap to switch the logged weight. The engine's `roundWeight` uses the same inventory, so a prescribed weight is always loadable, and `barbellStep` defaults to twice the smallest plate pair (2 x 2.5 = 5 lb). Plates go heaviest innermost.

**Between sets.** Given what's on the bar now, choose the next set's configuration that keeps the longest shared run of inner plates, then minimizes plates moved (ties broken as above). Show it as an instruction, for example "add 10 + 2.5 each side" or "take off 5, add 25". This matters most on warm-up ramps: 100 -> 125 -> 145 -> 185 -> 215 -> 245 with a 45 lb bar is 25+2.5 -> 35+5 -> 45+5 -> 45+25 -> 45+35+5 -> 45+45+10 per side.

**Colors** (the plate always carries its number; color is never the only cue):

| Plate | Default color | Basis |
|---|---|---|
| 25 kg / 55 lb | red | IWF kg colors; lb color bumpers mirror them (Vulcan Strength) [convention] |
| 20 kg / 45 lb | blue | same |
| 15 kg / 35 lb | yellow | same |
| 10 kg / 25 lb | green | same |
| 5 kg | white | IWF [convention] |
| 10 lb | white | no fixed lb convention; follows the 5 kg slot [assumption] |
| 2.5 kg, 2 kg, 1.5 kg, 1 kg, 0.5 kg | red, blue, yellow, green, white | IWF change plates [convention] |
| 5 lb, 2.5 lb, 1.25 lb | charcoal, silver, silver | no convention [assumption] |

Plates the owner actually owns may be black iron or another scheme, so each plate's color is editable; "iron" sets every plate to charcoal. Plate height in the drawing steps down with weight (full height for 25/20/15/10 kg and 55-25 lb, then smaller), as on a real bar.

**Where it shows:** (1) the logging screen, a one-line shorthand under the weight, "per side 45 · 45 · 10", as small colored plate chips, tap to open the full calculator; (2) the rest screen, the barbell drawing for the next set plus the change instruction; (3) warm-up ramp rows, shorthand chips per step; (4) a standalone calculator sheet with a weight field and the inventory.

Tests: 245 lb on a 45 lb bar gives 45+45+10 per side; with only one pair of 45s it gives 45+35+10+10 or the nearest loadable; an unreachable target returns the nearest below and above; the between-set chooser keeps inner plates across the example ramp; `roundWeight` never prescribes an unloadable weight.

## 7. Milestone M3: core data model, server, sync

`packages/core` document shape (automerge, one per user):

```
{ schemaVersion,
  settings: { units: { weight: 'lb', distance: 'mi' }, barbellStep: 5, dumbbellStep: 5, mainLifts: [ids], theme: 'light'|'dark'|'system', dailyWellness: false,
              run: { hrMax?, hrRest?, audioCueEvery: { distance?: 0.5|1 /* in settings.units.distance */, minutes?: 5 }, autoPause: true, mapRegion, recentRace?: { distanceM, seconds, date } },
              hybridPriority: 'lifting'|'running', injuries: [ { date, area, kind: 'lifting'|'running', resolved? } ],
              plates: { unit: 'lb'|'kg', collarWeight: 0, bars: [ { id, name, weight, default? } ],                 // 6.8; owner's real inventory still to enter
                        plates: [ { weight, pairs: number|'enough', color } ], colorScheme: 'bumper'|'iron'|'custom' },
              warmup: { enabled: true, softTissue: true, preferPercussion: true, minutes: 15 },                       // 6.7; preferPercussion is the owner's preference
              rest: { auto: true, learnFromTaps: true, showNextPlates: true, alert: 'vibrate+sound' },                   // 6.6
              titleFont: 'qalaTest'|'faustina' },                                                                         // DESIGN 3.3
  exercises: { hidden: [ids], custom: { [id]: Exercise with targetMuscles/synergistMuscles/equipment }, overrides: { [id]: { increment?, rounding?, bar?, restClass?: 'main'|'secondary'|'isolation' } } },
  exerciseNotes: { [exerciseId]: [ { id, date, sessionId, text, showNext: true, pinned: false, resolved: false } ] },
  equipment: { recovery: ['foamRoller', 'percussionMassager'], cardio: [ 'bike'|'rower'|'treadmill'|'jumpRope'|'outdoor' ], gym: [ids] },   // owner owns a foam roller and a Theragun
  restProfile: { byClass: { [approachAndClass]: { m, samples } }, byExercise: { [exerciseId]: { m, samples } } },   // 6.6 multiplier; per-exercise m takes over after 20 rests
  programs: { [id]: { name, text, state, approach: 'strength'|'hypertrophy'|'maintenance', periodization,
                      referenceRm: { [exerciseId]: { weight, date, source: 'kalman'|'tested' } } } }, activeProgramId,   // reference 1RM fixed per block (6.3)
  runPlans: { [id]: { name, goal: { kind: 'distance'|'race'|'base', raceDate?, raceDistanceM?, targetSec? },
                      weeks: [ { days: [ { dayOfWeek, workout: RunWorkout } ] } ] } }, activeRunPlanId,
  // RunWorkout = { type: 'easy'|'long'|'tempo'|'intervals'|'surges'|'recovery'|'race',
  //               steps: [ { kind: 'warmup'|'work'|'recover'|'cooldown', distanceM? | seconds?, paceZone?, hrZone?, repeat? } ] }
  history: [ { id, kind: 'lift', date, programId, day, entries: [ { exerciseId, sets: [ { w, r, rpe, completed, note, jointPain, tested1rm?, warmup?: true, restPrescribedSec?, restActualSec?, restReasons? } ] } ],
               warmup?: { blocks: [ { kind: 'general'|'softTissue'|'mobility', items: [ { name, tool?, muscle?, seconds?, reps? } ], done } ], skipped? },
               exerciseOrder?: [exerciseId],   // actual order when done out of plan order
               checkin: { prs, soreness: { [muscle]: 1..4 }, text, parsed? }, perf: { [muscle]: 1..4 }, srpe, minutes }
           | { id, kind: 'run', date, runPlanId?, workout?: RunWorkout, checkin?,
               track: { encoding: 'delta-v1', t, lat, lon, alt, acc, hr? },   // columnar delta-encoded arrays, not per-point objects
               distanceM, movingSec, elapsedSec, elevGainM, elevLossM, gapSpeedMps, rTSS?, cadence?,   // all SI; UI converts
               splits: [ { index, distM, sec, gapSec, elevGainM, hr? } ],   // boundaries at each unit of settings.units.distance when recorded
               hrAvg?, hrMax?, trimp?, srpe, minutes, notes } ],
  engineSnapshots: [ { date, state } ],          // derived cache, rebuildable from history
  coachMemory: [ { id, date, source: 'user'|'gemma'|'engine', text, accepted } ],
  llmLog: [ { date, kind, promptHash, output, accepted } ] }
```

`server/` is one Deno 2 process on `127.0.0.1:8500`:
- `@automerge/automerge-repo` with `NodeFSStorageAdapter` under Deno's Node compat; if it fails, a ~40-line `DenoFSStorageAdapter`. WebSocket transport via `@automerge/automerge-repo-network-websocket`; its server side assumes Node `ws`, so expect to write a ~60-line adapter over `Deno.upgradeWebSocket` (known risk, budget half a day).
- Auth middleware: read `Tailscale-User-Login`; map to `data/users/<login>.json` holding the user's document id; refuse any document id not owned by the requester; refuse non-loopback binds (same rule as Beamer's sync_server). The Capacitor app's origin is `https://localhost`, not the tailnet hostname. The phone is still a tailnet peer, so `tailscale serve` injects the identity header on its WebSocket; auth is the header only, never Origin.
- Serves the built PWA from `apps/web/dist`.
- `deploy/qala.service` (systemd --user, `WantedBy=default.target`, restart on failure). `deploy/tailscale-serve.md` with `tailscale serve --bg --https=8443 http://127.0.0.1:8500`.
- Tests: two in-memory repos edit the same document offline and merge cleanly; auth rejects cross-user access; server refuses to bind non-loopback; a WebSocket upgrade with `Origin: https://localhost` and a valid identity header is accepted, and one without the header is rejected.

## 8. Milestone M4: phone shell (logger)

Screens, in the owner's words and choices, are specified in `DESIGN.md` section 7; the decisions behind them are in `DECISIONS.md` (U1-U8, T6-T10). What M4 builds, in order:
1. **Tab shell.** Option A recommended (Today, Plan, Body, Progress, Coach); Option B folds Today into Plan; the owner hasn't picked. Settings and history are header buttons. No Start tab: a lift or run starts from Today or a Plan day.
2. **Today** (`DESIGN.md` 7.1): the timeline rail of the day's stages and one hero card per stage (before the lift, after the lift, evening), fed by readiness (6.2), daily session load done and planned, and the day's plan. Before the lift the card carries "Lower A · Squat day", the readiness ring with the 28-day average and the low line, this week's load with today outlined and named, and a 64px Start warm-up button; after the lift it shows the result and what's next.
3. **Plan** (7.2): week navigator, a tab per day, Start workout, overview grid and details.
4. **Check-in** (7.3), then **Warm-up** (7.4) from 6.7 with plate chips on every ramp step.
5. **Workout** (7.5): one exercise at a time; swipe, progress segments or the All exercises overview (7.7) to move between exercises; returning exercise notes; plate shorthand.
6. **Rest** (7.6) from 6.6 with its reasons, the next set's plate drawing and the change to the next exercise.
7. **Session complete** (7.8) as charts, then the two quick questions and the day's run handoff.
8. **Body, Progress, Coach, Plate calculator, Settings** (7.9-7.13).

Exercise notes belong to an exercise, not a session, with "show next time" on by default: the next time that exercise opens, the note shows as a dismissible dated card above the numbers; notes can be pinned or resolved; the coach can cite them in memory proposals. Charts are visx components in `apps/web/src/shared/charts/`, uPlot only for dense time series (`DESIGN.md` 6.1), each with a table view.

Components (anatomy in `DESIGN.md` section 5):
- Check-in grid drawn over liftosaur's front/back muscle SVGs; tapping a region cycles 1-4; only muscles the session hits plus anything scored >= 3 last time are active; PRS 0-10 row with anchors (0-2 worse session expected, 3-7 normal, 8-10 better); one free-text line parsed by the coach into removable chips.
- Logger: big weight x reps figures with -/+ steppers (weight by the exercise's increment, reps by 1), RPE chips 7-10 in half steps, Info / Swap / Note / Log set, joint-pain toggle, per-set note, plate shorthand chips with a calculator button (6.8).
- Post-muscle-group performance tap (4 options) when a muscle's last set completes; session RPE and auto duration at the end.
- Rest timer from 6.6 with its reasons and the next set's plate drawing; a program's explicit `timers` value replaces the base rest (assumption). Screen Wake Lock during a workout; notification on expiry.
- Engine banner: recommendation, engine vs coach numbers, revert tap, reason text.
- Service worker, web manifest and icons for the PWA build (desktop, and iOS users who only lift); the Capacitor build bundles the same assets.

## 8a. Milestone M4a: run recorder (`packages/run` + Capacitor phone app)

Numbered 8a rather than renumbering, so every existing section reference stays valid. Depends on M3 (document and sync); shares the phone shell and tabs with M4.

Numbers below are defaults from `RESEARCH-run-tracking.md` section 3. Running apps don't publish theirs, so tune each against replayed real runs.

`packages/run` (pure TS, no DOM, no Capacitor imports; the plugin is injected as a fix source):
1. Store raw fixes as captured, columnar and delta-encoded (section 7). Every derived number is recomputable from raw fixes, so a better filter later can reprocess old runs.
2. One owner of location. Deduplicate by fix timestamp. Never merge two position streams.
3. Time everything by the fix's own timestamp, never by callback wall clock. Fixes arrive batched after the screen locks.
4. Accuracy gate: drop fixes with horizontal accuracy > 25 m (Android accuracy is a 68% radius).
5. Speed gate: reject a jump implying > 7 m/s, unless 3 consecutive fixes agree on the new position.
6. Constant-velocity Kalman filter on position and velocity, measurement noise = accuracy squared.
7. Distance by Vincenty on the filtered track (haversine error up to 0.3%).
8. Current pace over a 20 s window; audio-cue pace over 30 s; average pace = distance / moving time.
9. Auto-pause below 0.6 m/s held 5 s; resume above 1.0 m/s held 3 s. Paused time is excluded from moving time, not from elapsed.
10. Splits at each mile, interpolated between the two fixes straddling the boundary.
11. No cap on stored points.
12. Guided-workout step machine: consumes a `RunWorkout`, emits step changes and pace-zone "speed up / slow down" events from the 30 s pace, with hysteresis so it doesn't nag at zone edges.
13. Exporters: GPX 1.1 with Garmin TrackPointExtension (HR), TCX with one Lap per workout step. No FIT: Garmin's SDK license forbids source-disclosure licenses, and Qala is AGPL.

Server side: after sync, `server/elevation.ts` looks up elevation from Copernicus GLO-30 tiles for the filtered track (GPS altitude is not used), with a 3 m hysteresis band for gain. Grade-adjusted pace and run load come from that elevation profile (section 6.4).

Phone app (Capacitor 8, Android first):
- Android foreground service with `FOREGROUND_SERVICE_LOCATION` and a persistent notification while recording; request `ACCESS_BACKGROUND_LOCATION` and `POST_NOTIFICATIONS` at first run start, not at install.
- Fixes and the run-in-progress are written to the local automerge document continuously, so a killed app loses at most a few seconds. Android throttles WebView network after ~5 min backgrounded; sync happens when the run ends or the app returns to the foreground.
- Screens: Start (map, GPS signal indicator, audio-cue toggle, workout picker, Start button), Live (stacked numerals: time, distance, current pace, average pace; swipe pages for splits and map; pause/resume, long-press stop), Summary (map with mile markers colored by pace, splits table, pace and elevation charts, sRPE tap, notes).
- Audio cues every 0.5 or 1 mi or every 5 min (settings): time, distance, average pace, and for guided workouts the step and speed-up/slow-down call. Test ducking against Spotify before building guided workouts; the plugin docs don't say.
- HR strap over BLE Heart Rate Service 0x180D, characteristic 0x2A37. Optional.
- Maps: MapLibre GL JS. Online, from self-hosted Protomaps PMTiles served by Deno (`serveDir` handles Range requests). Offline, the service worker can't cache 206 responses, so the server also unpacks the owner's region to plain `/tiles/{z}/{x}/{y}.mvt` and the app pre-caches the tiles around recent routes. Measure the extract with `pmtiles extract --bbox --maxzoom 15` before picking the region; a metro area is tens to low hundreds of MB, the whole US ~13-16 GB at z15 (estimate). OSM's public raster tiles forbid prefetching, so don't use them.

Tests:
- Replay tests: recorded raw-fix fixtures fed through the pipeline; assert distance within 1% of the fixture's known route length, split count and times, auto-pause intervals.
- Synthetic regression cases for jara's four bugs (github.com/jakobbjelver/jara, read 2026-09-13): the same fix delivered twice counts once; a 60 m accuracy fix is dropped; batched late fixes give the same pace as on-time ones; a 4 h run at 1 Hz keeps its first point.
- GPX and TCX round-trip.

Gate before building the rest of M4a (on the real Nothing Phone): a 2 h background recording with the screen locked (does Nothing's battery management kill the foreground service?), and TTS over Spotify (does music duck?). If the first fails, document the battery-optimisation exemption flow before going further.

## 9. Milestone M5: desktop shell (stats-first, revised 2026-09-13 per DECISIONS U11)

Stats group: an Overview dashboard home (stat tiles, readiness, this week's load, squat trend, sets by muscle, recent sessions); Lifts (index cards linking into per-lift e1RM history, NL85 and calibration); Running (VDOT trend, run list linking into pace/HR/elevation detail); Body (readiness, sets by muscle linking into per-muscle volume-vs-band and fatigue detail); History (every session, linking into a set-by-set breakdown with editable notes and dismissible PR flags). Author group below it, unchanged in substance: program list; CodeMirror 6 editor with Lezer highlighting for both grammars and inline parse errors; live evaluated preview beside it (weeks, days, sets, computed weights, reps at 85%+, sets per muscle, time including warm-ups); exercise DB table (seed + custom, hide/edit, muscle tags required on custom entries, per-exercise bar and rest-class overrides); coach-memory editor with accept/reject for Gemma-proposed facts; calibration view (per-lift `p0, k1, theta`, residuals, observation count). Screen spec: `DESIGN.md` 7.15-7.16.

Graphs (library split and chart rules in `DESIGN.md` section 6; visx for most, uPlot where marked): e1RM per main lift with daily best dots, the Kalman line and tested-1RM diamonds (uPlot, zoomable over the full history); weekly NL85/T85 per main lift against the block table; weekly `directSets_m`/`fracSets_m` per muscle against the band and RP caps; rep and load PRs per exercise; fitness and fatigue curves for lifting and running (uPlot); VDOT trend; readiness with the average and low line; combined sRPE-load with the lift/run split; weekly distance with long-run and growth flags; run detail pace, heart rate and elevation (uPlot); calibration residuals (uPlot). Every chart has a table view.

Theme, type, icons and components are specified once in `DESIGN.md` (tokens section 2, type section 3, icons section 4, components section 5, charts section 6) and implemented in `apps/web/src/theme/tokens.css`, `apps/web/src/theme/fonts.css` and `apps/web/src/shared/charts/`, shared by both shells. Font files are already in the repo: `assets/fonts/QalaTest-*.woff2` (the owner's Qala Test face; build scripts in `qala-test/work/`), `assets/fonts/DMMono-*.woff2`, and `assets/fonts/Faustina-*-qala.woff2` as the fallback; checksums in `DESIGN.md` 3.2. `assets/fonts/Recursive-*` was removed 2026-09-13. Add the OFL texts (Qala Test, Faustina, DM Mono) and the Lucide, visx and uPlot licenses to NOTICE.

## 10. Milestone M6: wire check-in, engine, and the default adaptive program

Check-in -> `predictReadiness` -> bindings -> program evaluation -> workout screen. Ship `programs/adaptive-default.md`: upper/lower 4-day, double progression, `update:` and `progress:` scripts that read `deload`, `recWeightPct`, `recSets`, `soreness`. Both deload paths visible in the workout screen with the reason text. Engine snapshot appended to `engineSnapshots` after each session; rebuild from history if the schema changes.

Runs take the same path: run saved -> server fills elevation -> `logSession` applies the 6.4 inputs -> engine snapshot -> cross-modal reason codes reach both the Start screen (a planned hard run shown as easy, with the reason) and the next lift's bindings (`fatigueLocal`, lower expected reps). The default program's lower-body `progress:` scripts read `recWeightPct`, which the 6.4 no-load-increase rule sets to 0. Test end to end: log a tempo run, open the next day's squat session, and see the lower rep target and the reason.

## 11. Milestone M7: LLM layer

`server/llm.ts` proxies to `http://127.0.0.1:8080/v1/chat/completions`, model `gemma-4-E4B_q4_0-it`, temperature 0, `response_format: {type: 'json_schema', ...}` for structured calls, 60 s timeout, and the same degrade-gracefully rule as Beamer: every feature works without the model, the model only adds words or a bounded nudge. `packages/llm` builds prompts from: coach memory, computed profile (calibrated parameters, per-muscle recovery pattern, adherence, PR trend), last 4 weeks summary, today's engine output and envelope. Features:

1. Check-in free text -> `{sleepHours?, stress?, injury?, timeLimitMin?, notes}` JSON.
2. Envelope adjustment -> `{weightPct, sets, reason}`; validated, clamped, logged, shown next to the engine value.
3. Prescription explanation: today's lift session or run workout in plain words from the reason codes, including cross-modal ones (6.4), such as why a planned interval run became easy.
4. Recovery nudges and injury flags phrased from engine flag codes (e.g. "four sessions at sRPE 8+ this week; consider a deload").
5. Weekly summary narrative from the computed numbers only (sessions, runs, distance, TRIMP with the lift/run split, performance % change, VDOT trend).
6. Goal parsing for the generator: free text -> generator parameters JSON, for lifting (goal, days, priorities) and running (race distance and date, runs per week, hybrid priority).
7. Coach-memory proposals after check-ins; shown for accept/reject before saving.

The Coach tab wraps these in open-ended conversation, not fenced to the seven prompts above, staying within fitness/training/health/recovery topics and declining unrelated requests; every actionable suggestion it makes still resolves to one of the features above and passes through the same envelope (decided 2026-09-13; `DECISIONS.md` U8; `docs/adr/0001-coach-open-chat.md`). All LLM calls and outputs land in `llmLog` with `accepted`. Future, not built: speech input (Web Speech API on the phone, or the Voxtral path prototyped in Beamer's `src/bin/voxtral_test.rs`).

## 12. Milestone M8: generator (`packages/generator`)

Inputs: goal (hypertrophy | strength | meetPrep with date | athleticMaintenance), daysPerWeek, sessionMinutes, experience, equipment (matched against the DB's `sortedEquipment`), musclePriorities (emphasise | grow | maintain), exclusions/injuries, blockWeeks 4-6 with the last week a deload. Rules: split by days (2-3 full body, 4 upper/lower, 5-6 push/pull/legs); exercise selection from the tagged DB honouring equipment and exclusions, stable across the block, main lifts first; per-muscle weekly sets by the 6.3 volume rules (fractional-set band inside RP caps, +2 per week, deload x0.5) scaled by priority and fitted to the time budget (per work set: base rest B from 6.6 plus 40 s of set time for hypertrophy and maintenance or 30 s for strength, which lands near the old 2.5 min per set and 4 min per main-lift set; plus the warm-up from 6.7); rep ranges by goal from the owner's numbers (strength 1-6 at 80-95%; hypertrophy 8-15 at 60-80%, compounds 8-12 and isolation 12-15; maintenance 6-10); per-week parameters from the templates below; meet prep tapers per the taper table below. Output is planner text with `progress:` scripts (double progression by default), so it opens in the editor as a normal program. Tests: every generated program parses and evaluates; sets per muscle within MEV..MRV; time budget respected within 10%; meet prep ends on the date.

Splits and blocks as Evolve structures them (evolvetrainingapp.com "What are training splits" and "What is a training block", read 2026-09-13; neither cites studies, so treat as [expert/product practice] and prefer the cited rules above where they conflict):
- A **split** (microcycle) is the weekly layout; a **block** (mesocycle) sets the programming characteristics; several blocks form a **macrocycle**. Splits and blocks are chosen independently, and each block may carry its own split (Evolve's example: higher-frequency splits in strength blocks, lower frequency in hypertrophy blocks). `runPlans` weeks line up with the same block calendar.
- **Main-lift frequency** (times per week a lift or close variation is trained) by experience: beginner 2-3x; intermediate 2-4x; advanced same as intermediate by default, with two alternatives the generator may offer: 3-5x at lower per-session volume, or 1-2x at higher per-session volume. The generator's split choice must satisfy this per main lift, not only per muscle.
- **Slots.** A day is a list of slots. Movement slots are the user's main lifts (squat, bench, deadlift, or others they mark); muscle slots are accessory groups by primary muscle (upper back, biceps...). Each slot has a programming type: `strength` (lower reps, heavier; the default for main-lift slots), `accessoryLow` (moderate reps and load), `accessoryHigh` (higher reps, lower load), and `equipped` (out of scope for v1). When the goal is a main lift, add accessory work as extra main-lift slots (variations) before adding muscle slots; add muscle slots only when the goal isn't served by the main lift. Slots map onto liftoscript exercises, so the generated text stays a normal program.
- **Block types:** `workCapacity` (build tolerance for training while keeping squat/bench/deadlift skill), `hypertrophy` (moderate-rep accessories, low-moderate-rep strength work), `strength` (heavy, specific), `peaking` (strength-like programming with fatigue managed into one final session; this is the meet-prep taper above). `athleticMaintenance` stays a Qala addition. Block length **2-7 weeks**, set by the distance to the goal date; with no date, the generator sequences blocks for long-term development (default order workCapacity -> hypertrophy -> strength, repeat; peaking only with a date).
- **Volume across blocks.** Evolve holds weekly volume roughly constant across blocks and changes rep ranges and proximity to failure (RPE/RIR) between them. That conflicts with the within-block +2 sets/week ramp in 6.3. Resolution (decided 2026-09-13; `DECISIONS.md` T5): across blocks, volume carries over at the level the per-muscle rules reached rather than resetting to MEV; within a block, the ramp applies only in hypertrophy blocks, while strength and peaking blocks hold volume and move intensity and RPE.

Periodization choice (`RESEARCH-design-and-programming.md` B1-B3): novices get linear (Moesgaard 2022 meta: undulating vs linear ES 0.06 untrained, 0.61 trained); trained lifters on a strength goal get DUP in hypertrophy-power-strength day order (Zourdos 2016, doi:10.1519/JSC.0000000000001165); meet prep gets blocks ending in the taper. For hypertrophy the model doesn't matter (ES 0.05), so default to linear RIR ramps. The user can override with `periodization`.

Linear strength template, squat and bench (% of reference 1RM):

| Week | Sets x reps @ load | NL85 |
|---|---|---|
| 1 | 4x5 @ 80% | 0 |
| 2 | 4x4 @ 83% | 0 |
| 3 | 5x3 @ 86% | 15 |
| 4 | 5x2 @ 89% | 10 |
| 5 | 1 @ 95% + 5x1 @ 92% | 6 |
| 6 | deload 3x3 @ 75% | 0 |

DUP strength template, per main lift (strength day capped by RPE rather than sets to failure, a Qala change from Zourdos's protocol):

| Week | Hypertrophy day | Power day | Strength day | NL85 |
|---|---|---|---|---|
| 1 | 4x8 @ 72.5% | 5x2 @ 80% | 3x5 @ 82% | 0 |
| 2 | 4x8 @ 75% | 5x2 @ 82% | 3x4 @ 85% | 12 |
| 3 | 4x7 @ 77% | 5x1 @ 85% | 3x3 @ 88% | 14 |
| 4 | 3x6 @ 79% | 4x1 @ 88% | 3x2 @ 91% | 10 |
| 5 | 3x6 @ 80% | 3x1 @ 90% | 1 @ 95% + 2x2 @ 87% | 8 |

Alternative DUP (`dupScheme: '5-3-1'`): 4x5 @ 80%, 5x3 @ 85%, 6x1 @ 90%, +2% per week. The hypertrophy day sits below the owner's 80% floor on purpose; it's a variation day inside a strength block.

Hypertrophy template (loads from inverse Epley on effective max, `pct = 100 / (1 + (reps + RIR) / 30)`, within 1.5 points of the NSCA chart):

| Week | fracSets target | RIR (RPE) compound | RIR (RPE) isolation | Compound reps (~%1RM) | Isolation reps (~%1RM) |
|---|---|---|---|---|---|
| 1 | block start (10-14) | 3 (7) | 3 (7) | 8-12 (67-73%) | 12-15 (62-67%) |
| 2 | +2 | 2-3 (7.5) | 2 (8) | 8-12 (68-75%) | 12-15 (64-68%) |
| 3 | +2 | 2 (8) | 1-2 (8.5) | 8-12 (68-75%) | 12-15 (64-70%) |
| 4 | +2 | 1-2 (8.5) | 1 (9) | 8-12 (69-77%) | 12-15 (65-70%) |
| 5 | +2, capped | 1 (9) | 0-1 (9-10) | 8-12 (70-77%) | 12-15 (65-71%) |
| 6 deload | x0.5 | 4 (6) | 4 (6) | same reps, load -10% | same |

Meet-prep taper (Pritchard 2016 doi:10.1519/JSC.0000000000001292, Travis 2020 doi:10.3390/sports8090125, Travis 2021 survey doi:10.1519/JSC.0000000000004177): one 7-10 day step with volume cut 40-50% and intensity held at 85%+ until the last heavy session. Last heavy session before the meet: deadlift 8-10 d, squat 7-9 d, bench 5-7 d. Last session of any kind: deadlift 6 d, squat 4-5 d, bench 3-4 d (typical final schemes squat 3x2, bench 3x3, deadlift 3x1). Then 2-3 days of full rest (3.5 vs 5.5 days' cessation made no difference, Pritchard 2018). This replaces the earlier Bell 2025 lift-specific rest numbers.

Generator tests add: linear and DUP output matches the tables for a given reference 1RM after plate rounding; every hypertrophy week's `fracSets_m` stays inside the band and RP caps or carries `VOLUME_CAPPED_BY_MRV`; the taper's last heavy and last sessions fall on the right days before a meet date.

Running plans (`goal: base | distance | race`, evidence in `RESEARCH-running.md` section 6). Inputs: runs per week, current weekly distance and longest run (from history, or asked), race distance and date, optional recent race time. Rules: most running easy (below 0.78 CS; polarized or pyramidal distributions are both acceptable, default roughly 80% of time easy); one quality session per week for 3 runs/wk, two for 4+ (tempo near CS, intervals above CS, surges as the entry workout); the long run grows gradually and never exceeds 1.10 x the longest run of the previous 30 days (the same threshold the engine flags); weekly distance never grows more than 30% across two weeks; a down week every 3-4 weeks; race taper two weeks with volume cut 41-60% and intensity kept. No 10% rule. Output is a `runPlans` entry of typed `RunWorkout`s with paces derived from CS or VDOT, recomputed when `kalmanRun` updates. Tests: every generated plan satisfies both growth limits, tapers into the race date, and keeps the easy share at or above the target.

Hybrid scheduler (runs whenever both `activeProgramId` and `activeRunPlanId` are set). Takes the lifting program and the run plan for the same weeks and places runs against lifting days using the section 6.4 table: intervals and tempo on lower-body days with the run at least 6 h after lifting (24 h apart when strength is the priority), easy runs on upper-body or rest days, no hard run in the 24 h after a heavy lower-body day, no heavy lower body within 48 h of a half marathon or 5 d of a marathon. When the week can't satisfy every constraint, the user's stated priority (lifting or running) wins and the violated rule is shown as a reason. Tests: generated hybrid weeks satisfy the spacing rules or report exactly which rule was traded and why.

## 13. Milestone M9: polish, deploy, docs

Desktop PWA install prompt, icons, offline check; iOS home-screen PWA test for lift-only users on a real device or simulator; Android release build of `apps/phone` via `deno task build:android` with the signing keystore kept outside the repo; `deploy/android-sideload.md` (install from unknown sources, battery-optimisation exemption for Qala, which permissions to grant and when); README with AGPL notice and liftosaur attribution, `docs/engine.md` complete with citations, `deploy/` docs, systemd unit enabled.

## 14. Verification

- `deno task test` runs every package's tests (engine, liftoscript, generator, core, server).
- Engine: the spec's 3-week validation test passes; synthetic Kalman recovery within tolerance.
- Liftoscript: all 60 builtin programs evaluate; GZCLP simulation matches documented progression.
- End to end: `deno task dev`; open the desktop shell on callisto; write a program; install the signed APK from `apps/phone` on the Nothing Phone (sync target `wss://callisto.taila63f23.ts.net:8443`); log a session in airplane mode; reconnect; confirm the desktop shows the session and the engine snapshot updated.
- Run recording, on the Nothing Phone: a run of 60 min or more with the screen locked and the phone in a pocket records continuously (no gap > 10 s in raw fixes); distance on a known measured route within 2%; an audio cue is heard with the screen locked and music playing; auto-pause triggers at a stoplight and resumes; airplane mode for the whole run, then the run appears on the desktop after reconnect with elevation and splits filled in; the map renders offline for an area loaded once online.
- LLM: with `llama-beamer` running, check-in text yields valid JSON and an in-envelope adjustment; with it stopped, logging and recommendations still work and the UI says the coach is offline.
- Look: a test computes WCAG contrast for every text/background token pair in `tokens.css`, light and dark, and fails below 4.5 (3.0 for large figures); screenshots of Today in all three stages, the Plan day view, the workout, rest, session complete and Settings screens compared against the mockup canvas and Beamer's Home and Settings pages, checking Qala Test on titles and figures, DM Mono elsewhere, 2px borders, flat-at-rest cards and the CTA shadow; a ticking number keeps the same width from 9:59 to 1:11; every chart palette passes the dataviz validator in both themes and every chart renders its table view.

## 15. Assumptions made without asking (cheap to change)

Vite as the bundler (React itself is a decision, section 3); Deno's built-in test runner; ports 8500 (server) and 8443 (tailscale); default main lifts squat, bench, deadlift, overhead press; set-time estimates in the generator; per-set `setFactor` RPE weighting in section 6.2. Added 2026-09-13: every running set-equivalent weight and threshold in 6.4 (derived, no study reports running in set units); the 3.6 sRPE-load per 100 rTSS prior; Riegel as the threshold-pace fallback before CS exists; the GPS pipeline parameters in 8a (25 m accuracy gate, 7 m/s jump gate, 20/30 s pace windows, auto-pause 0.6/1.0 m/s); bodyweight load factors in 6.3; the DUP strength day capped by RPE; observation noise for a tested 1RM at one quarter of an e1RM's; the 1-point disagreement threshold for RTS table cells; a program's explicit `timers` value replacing the 6.6 base rest; the readiness low line at 50 before 14 check-ins; plate colors for 10, 5 and 2.5 lb; which charts use uPlot (past about 2,000 points or needing zoom). `DECISIONS.md` lists these; nav Option A, the Today rail's 10 s snap-back and rest-day stages, and the cross-block volume carry-over rule were assumptions here but are now decided (`DECISIONS.md` U2, U9, U10, T5).

## 15a. Mockups (owner review before any build)

`mockups/build.mjs` generates the review canvas `mockups/qala-app-mockups.html`, published at https://claude.ai/code/artifact/250bf70f-3bed-4593-ad17-afc44bb14a0c (version 5 on 2026-09-13; made private 2026-09-13, `DECISIONS.md` section 7). Regenerate with `LUCIDE_JSON=<extracted Lucide paths> node mockups/build.mjs`, then assemble and republish with the design canvas tool. Four review rounds so far; what each round changed and the owner's comments are in `DECISIONS.md` section 8, and the current screen spec is `DESIGN.md` section 7. The mockups are hand-drawn HTML and SVG with sample data: they don't use the production chart libraries. Fold owner comments into `DECISIONS.md`, `DESIGN.md` and this plan before building.

## 16. Later (explicitly out of v1)

Accounts + Tailscale Funnel; speech check-in; exercise illustrations (draw, license, or generate); importers (GymRun CSV, liftosaur JSON, GPX/TCX run import); watch app (owner said no). Running extras: iOS native build (waits for a friend who wants runs), Runkeeper-style Feed and Challenges (social; v1 has one user), Strava upload (new API apps start at 1 connected athlete, self-upgradable to 10), Health Connect / HealthKit write-back, weather on runs, shoe mileage.
