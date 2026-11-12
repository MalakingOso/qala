# Qala: adaptive lifting and running app. Handoff plan for an executing agent

This document is the build plan. It records every decision made with berkley (the owner) in design sessions on 2026-09-13, the environment facts verified on this machine, and the research numbers the engine is built on. Two companion files carry the rest: `docs/DECISIONS.md` is the owner's decision log (what was chosen, what it replaced, what's still open) and wins over older wording anywhere else; `docs/DESIGN.md` is the design system and the screen-by-screen spec behind the mockups. Evidence lives in `docs/research/RESEARCH-*.md`. Do not re-litigate settled decisions; where something is marked "assumption", it was chosen without asking and can be changed cheaply.

Status 2026-11-11: the v1 web build exists and the Android app is in progress; `docs/ROADMAP.md` says where things stand. This file is the 2026-09-13 handoff plan, trimmed the same day: sections 6 (engine rules), 12 (generator), 14 (gates) and 16a to 16f (roadmap items) are still the reference and are kept in full. Superseded sections (2, 3, 4, 7 to 10, 13, 15) are now one-paragraph pointers to the living doc that replaced them, with their headings kept so citations like "PLAN 6.3" still land. When this file and `docs/DECISIONS.md` disagree, DECISIONS wins.

## 1. Goal

A self-hosted workout app for lifting and running (strength/powerlifting, hypertrophy/bodybuilding, and Runkeeper-style run recording and run plans, all feeding one fatigue model) built around LS++ (Liftoscript++, section 5; programs as code, edited in the browser, synced to the phone), with an adaptive training engine (fitness/fatigue state, per-muscle soreness check-ins, evidence-based volume and deload rules), a local Gemma model for the conversational and explanatory layer, and a goal-driven program generator like Evolve AI's "engine". Look comes from the owner's Beamer app (off-white ground, 2px borders, hard offset shadows) with an ember accent and a dark variant, DM Mono for text and the owner's own Qala Test face for titles and big numbers, plus a light touch of Runkeeper on the run screens only (big stacked numerals, periwinkle route line). The plan and workout screens take their structure from the Volt app reference (week navigator, a tab per day, one exercise at a time with a zoomed-out overview), drawn in Beamer's style. Served from the machine `callisto` over Tailscale now; several users, some on iOS, later.

Name: **Qala**. Location: `/home/berkley/Programming/qala`. Systemd unit `qala.service`, PWA title "Qala".

## 2. Environment facts (verified 2026-09-13)

Superseded. The 2026-09-13 facts (callisto over Tailscale, the shared llama-server, Beamer tokens) described the starting point. Hosting and auth are now DECISIONS S22 and `docs/plan-accounts-logins.md`; the model hosts are in `docs/rust-core.md` section 12. Do not build from the addresses or ports that were here.

## 3. Decisions (settled; do not reopen)

Superseded as a table. Every row that was here is in `docs/DECISIONS.md`, which wins over this file. The headings below it in git history (runtime, sync, auth, phone, shells) are DECISIONS S1 to S22; LS++ is section 5 of this file and `docs/rust-core.md` section 12.

## 4. Repository layout

Superseded. The layout is in the repo itself and in the root `README.md`. One change from the tree that was here: `docs/` no longer holds the completed milestone plans (see `docs/archive/completed.md`), and LS++ is documented in `docs/rust-core.md` section 12, not in a separate file.

## 5. Milestone M1: vendor liftoscript (`packages/liftoscript`, deleted 2026-11-12, S28)

Copy from liftosaur master, keeping file names so upstream diffs stay readable:

- Expression language: `liftoscript.grammar` (Lezer, ~95 lines), `src/liftoscript.ts` (generated LR parser), `src/liftoscriptEvaluator.ts` (~1400 lines, tree-walking, emits `ILiftoscriptEvaluatorUpdate` records), `src/liftoscriptFns.ts` (valibot `VScriptBindings` + builtins), `src/parser.ts` (`ScriptRunner`; stub its `rollbar` and `utils/dialog` imports).
- Program text language: `src/pages/planner/plannerExercise.grammar`, `plannerExerciseParser.ts`, `plannerExerciseEvaluator.ts`, `plannerEvaluator.ts`, `src/models/plannerStructure.ts`, `plannerProgram.ts`, `programToPlanner.ts` (serialises an evaluated program back to text).
- Models: `src/models/weight.ts` (imports `exercise.ts` for `Exercise_onerm`, `Exercise_defaultRounding`), `set.ts`, `muscle.ts`, `exercise.ts` (the DB: id, name, defaultEquipment, types, startingWeight, plus `metadata` with `targetMuscles`, `synergistMuscles`, `bodyParts`, `sortedEquipment`), `src/types.ts`, `utils/math`, `utils/collection`. Skip `exerciseDescriptions.ts` (862 KB text).
- Seed data: `programs/builtin/*.md` (60 programs, YAML frontmatter + ```liftoscript block). SVGs: `images/front-muscles.svg`, `images/back-muscles.svg`.
- Runtime to lift out and rewrite (they import ducks, lens-shmens, navigation thunks, api/service): `Program_runFinishDayScript` (program.ts ~line 529), `Program_runAllFinishDayScripts` (~652), `Program_forceEvaluate`, `Program_nextDay`, `Progress_createScriptBindings` (progress.ts ~243), `Progress_createScriptFunctions`, `Progress_runUpdateScriptForEntry` (~959). Put them in `packages/liftoscript/runtime.ts` against `@qala/core` types.
- LS++ semantics to preserve (liftosaur's, from their docs): `progress: custom(state...) {~ ~}` runs once after the workout per exercise and may write `weights[week:day:variation:set]`, `reps`, `RPE`, `timers`, `numberOfSets`, `rm1`, `setVariationIndex`, `exerciseVariationIndex`, `descriptionIndex`, `state.*`; `update: custom() {~ ~}` runs at `setIndex == 0` and after every set and writes only the current entry. Built-in progressions `lp(...)`, `dp(...)`, `sum(...)`. Bindings: `day, week, dayInWeek, weights/w, originalWeights, completedWeights/cw, rm1, reps/r, minReps/mr, completedReps/cr, completedRepsLeft, RPE, completedRPE, amraps, askweights, logrpes, timers, setTime, completedSetTime, completedSetTimeLeft, isCompleted, ns/numberOfSets, programNumberOfSets, completedNumberOfSets, setIndex, setVariationIndex, exerciseVariationIndex, descriptionIndex, bodyweight`, `state.<name>`, `var.<name>`.
- New engine bindings added to `VScriptBindings`, all numbers so the evaluator's type system is untouched: `readiness` (0-1), `prs` (0-10), `soreness` (max RP score over the exercise's target muscles, 1-4), `fatigueLocal` (0-1 normalised per-muscle fatigue), `deload` (0 none, 1 muscle, 2 systemic), `recWeightPct` (engine's recommended weight change, -10..2.5), `recSets` (-2..1). Documented in `docs/rust-core.md` section 12.
- Tests: parse and evaluate all 60 builtin programs without error; simulate 3 training days of GZCLP and assert next-day weights match liftosaur's documented progression.

## 6. Milestone M2: engine (`packages/engine`, only `availability.ts` is left)

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
2. RPE logged and reps + RIR <= 10: `e1RM = load / RTS_pct(reps, RPE)`. `RTS_pct` is the RTS/Tuchscherer %1RM-by-reps-and-RPE table in `docs/research/RESEARCH-design-and-programming.md` B2, copied into `packages/engine/rtsTable.ts`. That table is a third-party reproduction not checked against RTS's original; its 6 reps @ RPE 10 = 83.7% agrees with Helms 2016, but spot-check the other rows against a second source before shipping, and use rule 3 for any cell that disagrees by more than 1 point.
3. RPE not logged and reps <= 10: `e1RM = load * (1 + (reps + RIR_est) / 30)`, `RIR_est = 10 - target RPE` if the program set one, else 0; if reps + RIR_est = 1, e1RM = load.
4. Reps > 10: no observation. Those sets feed rep-range PRs, not the filter.
Put these in `packages/engine/e1rm.ts`; liftoscriptFns' `calculate1RM` stays for LS++ compatibility only. A linear Kalman update on each observation; `calibrate(history)` replays history through `logSession` and the filter. No least squares anywhere.

Readiness at session start (0-1) = weighted combination of: PRS z-score over the athlete's own rolling 4-week window (flag z <= -1.5 or PRS <= 4), soreness grid (any 4 on a muscle the session hits), normalised `G_m` and `G_s`. Readiness is derived from the check-in, not from load; the load-driven fatigue states are inputs to the Kalman observation and to the per-muscle bindings.

### 6.3 Rules (citations inline; the `docs/engine.md` stub is gone, this section is the reference)

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

Volume counting and the owner's 10-20 band (`docs/research/RESEARCH-design-and-programming.md` B4-B5). RP counts direct sets for intermediates; the 10-20 band comes from studies counting sets per muscle, which fit best with indirect work at half (Pelland 2026, Sports Med 56:481). They measure different things, so track both per muscle per Monday-Sunday week:
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

Evidence and derivations are in `docs/research/RESEARCH-running.md`. Engine internals use metres and seconds; the UI converts to miles. `logSession(state, workout)` accepts both history kinds (section 7) and replays them in date order, so a run's leg fatigue decays into the next lift and vice versa.

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
- Per-muscle, in lifting set-equivalents (all derived, anchored on knee-extensor force loss after runs compared with a scored squat session; mark as assumptions in the code). Per km, intensity factor `z = 0.5` below 0.78 CS, `1.0` at 0.78-1.0 CS, `1.5` above CS; `q = 0.18 * z`. Into `G_m`: quads q, calves 0.8q, glutes 0.5q, hamstrings 0.4q (0.8q at z 1.5). Kilometres after minute 120 go into `D_m` instead.
- Eccentric damage: per 100 m descended on grades steeper than -5%, quads 0.4 and calves 0.25 into `D_m`, times the repeated bout factor `RBE = max(0.65, 1 - 0.035 * n)` where n = runs with >= 200 m descent in the last 42 d.
- Running set-equivalents are fatigue only. They never count toward MEV/MRV targets or the RP set progression. Run sRPE-load does join the monotony and strain flags.
- Held-out check as in 6.1: after 20 VDOT observations, compare F_run-only prediction against F_run with the fatigue term; keep the simpler model if it predicts as well (Imbach 2025 logic).

Cross-modal rules (each emits a `ReasonCode`; each tagged [expert] or derived):

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

Owner request 2026-09-13: rest should set itself from how the lifter is doing. Evidence and every derivation: `docs/research/RESEARCH-rest-and-warmup.md` part 1. Tags: [meta] [RCT] [obs] are sourced; [derived] numbers are assumptions to tune.

Exercise class: `main` = on the main-lift list; `isolation` = one target muscle group and no synergists from another body part (DB `bodyParts`); `secondary` = everything else. Derived, overridable per exercise in the overlay.

Base rest `B` (s, end of set to start of next) and clamps:

| approach | main | secondary | isolation |
|---|---|---|---|
| strength (1-6 reps) | 180 [120, 300] | 150 [90, 240] | 90 [60, 150] |
| hypertrophy (8-15), maintenance | 150 [90, 240] | 120 [90, 180] | 90 [60, 150] |

When the LS++ entry sets `timers` explicitly, that value is `B` for the exercise; the clamps, the adjustments below and the personal multiplier still apply (assumption; keeps a program author's intent without losing the adaptive part). Programs without `timers` use the table.

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

Owner request 2026-09-13: warm-ups are key, using the owner's foam roller and Theragun plus cardio before lifting. Evidence: `docs/research/RESEARCH-rest-and-warmup.md` part 2. Inputs: today's exercises in order with class, muscles, working load W and reference 1RM or e1RM; approach; check-in soreness and PRS; `equipment` (section 7); a run finished within 15 min; time budget T for blocks 1-3 (default 8 min, 15 min when block 1 is 10 min). Output, in order:

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

Superseded. The Automerge document and WebSocket sync that were specified here are replaced by record sync: DECISIONS S11, `docs/rust-core.md` sections 4 and 5, and `docs/android-native.md` section 6. The server still runs the old code; the ROADMAP Server and sync table says what is built.

## 8. Milestone M4: phone shell (logger)

Superseded. The React phone shell is frozen as a PWA (DECISIONS S13) and the phone app is native Kotlin: `docs/android-native.md`. The screens this section specified are the design reference in `docs/DESIGN.md` section 7.

## 8a. Milestone M4a: run recorder (`packages/run` + Android phone app)

> Decided 2026-10-01 (DECISIONS S7): the Capacitor phone app below was replaced by a native Kotlin app (`apps/android`) and deleted; the run pipeline moves to the Rust core, still proposed (S6). The pipeline rules, the screens and the verification gates in this section still apply; the platform notes about the Capacitor plugins and writing fixes to the local automerge document do not (fixes go to Room, `docs/DECISIONS.md` S9, S15). See `docs/rust-core.md` and `docs/android-native.md`.

Numbered 8a rather than renumbering, so every existing section reference stays valid. Depends on M3 (document and sync); shares the phone shell and tabs with M4.

Numbers below are defaults from `docs/research/RESEARCH-run-tracking.md` section 3. Running apps don't publish theirs, so tune each against replayed real runs.

`packages/run` (pure TS, no DOM, no platform imports; the fix source is injected):
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

Phone app (Android first; written for the Capacitor wrapper, which is removed; see the note under the section heading):
- Android foreground service with `FOREGROUND_SERVICE_LOCATION` and a persistent notification while recording; request `ACCESS_BACKGROUND_LOCATION` and `POST_NOTIFICATIONS` at first run start, not at install.
- Fixes and the run-in-progress are written to the local Room database continuously (one insert per fix, DECISIONS S9, S15), so a killed process loses at most the last row. Sync happens when the run ends or the app opens.
- Screens: Start (map, GPS signal indicator, audio-cue toggle, workout picker, Start button), Live (stacked numerals: time, distance, current pace, average pace; swipe pages for splits and map; pause/resume, long-press stop), Summary (map with mile markers colored by pace, splits table, pace and elevation charts, sRPE tap, notes).
- Audio cues every 0.5 or 1 mi or every 5 min (settings): time, distance, average pace, and for guided workouts the step and speed-up/slow-down call. Test ducking against Spotify before building guided workouts; the native cue player requests transient ducking focus (`docs/android-native.md` 5).
- HR strap over BLE Heart Rate Service 0x180D, characteristic 0x2A37. Optional.
- Maps: MapLibre GL JS. Online, from self-hosted Protomaps PMTiles served by the Bun server (`Bun.file().slice()` handles Range requests). Offline, the service worker can't cache 206 responses, so the server also unpacks the owner's region to plain `/tiles/{z}/{x}/{y}.mvt` and the app pre-caches the tiles around recent routes. Measure the extract with `pmtiles extract --bbox --maxzoom 15` before picking the region; a metro area is tens to low hundreds of MB, the whole US ~13-16 GB at z15 (estimate). OSM's public raster tiles forbid prefetching, so don't use them.

Tests:
- Replay tests: recorded raw-fix fixtures fed through the pipeline; assert distance within 1% of the fixture's known route length, split count and times, auto-pause intervals.
- Synthetic regression cases for jara's four bugs (github.com/jakobbjelver/jara, read 2026-09-13): the same fix delivered twice counts once; a 60 m accuracy fix is dropped; batched late fixes give the same pace as on-time ones; a 4 h run at 1 Hz keeps its first point.
- GPX and TCX round-trip.

Gate before building the rest of M4a (on the real Nothing Phone): a 2 h background recording with the screen locked (does Nothing's battery management kill the foreground service?), and TTS over Spotify (does music duck?). If the first fails, document the battery-optimisation exemption flow before going further.

## 9. Milestone M5: desktop shell (stats-first, revised 2026-09-13 per DECISIONS U11)

Built. The desktop shell is DECISIONS U11 and `docs/DESIGN.md` 7.15, with the refined look (U21) and the load zoom (U27) on top. Sample data still drives it; see the ROADMAP Web and desktop table.

## 10. Milestone M6: wire check-in, engine, and the default adaptive program

Built on Android, not on the web. The phone sequence (check-in, readiness, engine bindings, LS++ evaluation, workout) is `docs/android-native.md` section 6. The web app still runs on sample data.

## 11. Milestone M7: LLM layer

`server/llm.ts` proxies to `http://127.0.0.1:8080/v1/chat/completions`, model `gemma-4-E4B_q4_0-it`, temperature 0, `response_format: {type: 'json_schema', ...}` for structured calls, 60 s timeout, and the same degrade-gracefully rule as Beamer: every feature works without the model, the model only adds words or a bounded nudge. `packages/llm` builds prompts from: coach memory, computed profile (calibrated parameters, per-muscle recovery pattern, adherence, PR trend), last 4 weeks summary, today's engine output and envelope. Features:

1. Check-in free text -> `{sleepHours?, stress?, injury?, timeLimitMin?, notes}` JSON.
2. Envelope adjustment -> `{weightPct, sets, reason}`; validated, clamped, logged, shown next to the engine value.
3. Prescription explanation: today's lift session or run workout in plain words from the reason codes, including cross-modal ones (6.4), such as why a planned interval run became easy.
4. Recovery nudges and injury flags phrased from engine flag codes (e.g. "four sessions at sRPE 8+ this week; consider a deload").
5. Weekly summary narrative from the computed numbers only (sessions, runs, distance, TRIMP with the lift/run split, performance % change, VDOT trend).
6. Goal parsing for the generator: free text -> generator parameters JSON, for lifting (goal, days, priorities) and running (race distance and date, runs per week, hybrid priority).
7. Coach-memory proposals after check-ins; shown for accept/reject before saving.

The Coach tab wraps these in open-ended conversation, not fenced to the seven prompts above, staying within fitness/training/health/recovery topics and declining unrelated requests; every actionable suggestion it makes still resolves to one of the features above and passes through the same envelope (decided 2026-09-13; `docs/DECISIONS.md` U8; `docs/adr/0001-coach-open-chat.md`). All LLM calls and outputs land in `llmLog` with `accepted`. Future, not built: speech input (Web Speech API on the phone, or the Voxtral path prototyped in Beamer's `src/bin/voxtral_test.rs`).

## 12. Milestone M8: generator (`packages/generator`)

Inputs: goal (hypertrophy | strength | meetPrep with date | athleticMaintenance), daysPerWeek, sessionMinutes, experience, equipment (matched against the DB's `sortedEquipment`), musclePriorities (emphasise | grow | maintain), exclusions/injuries, blockWeeks 4-6 with the last week a deload. Rules: split by days (2-3 full body, 4 upper/lower, 5-6 push/pull/legs); exercise selection from the tagged DB honouring equipment and exclusions, stable across the block, main lifts first; per-muscle weekly sets by the 6.3 volume rules (fractional-set band inside RP caps, +2 per week, deload x0.5) scaled by priority and fitted to the time budget (per work set: base rest B from 6.6 plus 40 s of set time for hypertrophy and maintenance or 30 s for strength, which lands near the old 2.5 min per set and 4 min per main-lift set; plus the warm-up from 6.7); rep ranges by goal from the owner's numbers (strength 1-6 at 80-95%; hypertrophy 8-15 at 60-80%, compounds 8-12 and isolation 12-15; maintenance 6-10); per-week parameters from the templates below; meet prep tapers per the taper table below. Output is planner text with `progress:` scripts (double progression by default), so it opens in the editor as a normal program. Tests: every generated program parses and evaluates; sets per muscle within MEV..MRV; time budget respected within 10%; meet prep ends on the date.

Splits and blocks as Evolve structures them (evolvetrainingapp.com "What are training splits" and "What is a training block", read 2026-09-13; neither cites studies, so treat as [expert/product practice] and prefer the cited rules above where they conflict):
- A **split** (microcycle) is the weekly layout; a **block** (mesocycle) sets the programming characteristics; several blocks form a **macrocycle**. Splits and blocks are chosen independently, and each block may carry its own split (Evolve's example: higher-frequency splits in strength blocks, lower frequency in hypertrophy blocks). `runPlans` weeks line up with the same block calendar.
- **Main-lift frequency** (times per week a lift or close variation is trained) by experience: beginner 2-3x; intermediate 2-4x; advanced same as intermediate by default, with two alternatives the generator may offer: 3-5x at lower per-session volume, or 1-2x at higher per-session volume. The generator's split choice must satisfy this per main lift, not only per muscle.
- **Slots.** A day is a list of slots. Movement slots are the user's main lifts (squat, bench, deadlift, or others they mark); muscle slots are accessory groups by primary muscle (upper back, biceps...). Each slot has a programming type: `strength` (lower reps, heavier; the default for main-lift slots), `accessoryLow` (moderate reps and load), `accessoryHigh` (higher reps, lower load), and `equipped` (out of scope for v1). When the goal is a main lift, add accessory work as extra main-lift slots (variations) before adding muscle slots; add muscle slots only when the goal isn't served by the main lift. Slots map onto LS++ exercises, so the generated text stays a normal program.
- **Block types:** `workCapacity` (build tolerance for training while keeping squat/bench/deadlift skill), `hypertrophy` (moderate-rep accessories, low-moderate-rep strength work), `strength` (heavy, specific), `peaking` (strength-like programming with fatigue managed into one final session; this is the meet-prep taper above). `athleticMaintenance` stays a Qala addition. Block length **2-7 weeks**, set by the distance to the goal date; with no date, the generator sequences blocks for long-term development (default order workCapacity -> hypertrophy -> strength, repeat; peaking only with a date).
- **Volume across blocks.** Evolve holds weekly volume roughly constant across blocks and changes rep ranges and proximity to failure (RPE/RIR) between them. That conflicts with the within-block +2 sets/week ramp in 6.3. Resolution (decided 2026-09-13; `docs/DECISIONS.md` T5): across blocks, volume carries over at the level the per-muscle rules reached rather than resetting to MEV; within a block, the ramp applies only in hypertrophy blocks, while strength and peaking blocks hold volume and move intensity and RPE.

Periodization choice (`docs/research/RESEARCH-design-and-programming.md` B1-B3): novices get linear (Moesgaard 2022 meta: undulating vs linear ES 0.06 untrained, 0.61 trained); trained lifters on a strength goal get DUP in hypertrophy-power-strength day order (Zourdos 2016, doi:10.1519/JSC.0000000000001165); meet prep gets blocks ending in the taper. For hypertrophy the model doesn't matter (ES 0.05), so default to linear RIR ramps. The user can override with `periodization`.

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

Running plans (`goal: base | distance | race`, evidence in `docs/research/RESEARCH-running.md` section 6). Inputs: runs per week, current weekly distance and longest run (from history, or asked), race distance and date, optional recent race time. Rules: most running easy (below 0.78 CS; polarized or pyramidal distributions are both acceptable, default roughly 80% of time easy); one quality session per week for 3 runs/wk, two for 4+ (tempo near CS, intervals above CS, surges as the entry workout); the long run grows gradually and never exceeds 1.10 x the longest run of the previous 30 days (the same threshold the engine flags); weekly distance never grows more than 30% across two weeks; a down week every 3-4 weeks; race taper two weeks with volume cut 41-60% and intensity kept. No 10% rule. Output is a `runPlans` entry of typed `RunWorkout`s with paces derived from CS or VDOT, recomputed when `kalmanRun` updates. Tests: every generated plan satisfies both growth limits, tapers into the race date, and keeps the easy share at or above the target.

Hybrid scheduler (runs whenever both `activeProgramId` and `activeRunPlanId` are set). Takes the lifting program and the run plan for the same weeks and places runs against lifting days using the section 6.4 table: intervals and tempo on lower-body days with the run at least 6 h after lifting (24 h apart when strength is the priority), easy runs on upper-body or rest days, no hard run in the 24 h after a heavy lower-body day, no heavy lower body within 48 h of a half marathon or 5 d of a marathon. When the week can't satisfy every constraint, the user's stated priority (lifting or running) wins and the violated rule is shown as a reason. Tests: generated hybrid weeks satisfy the spacing rules or report exactly which rule was traded and why.

## 13. Milestone M9: polish, deploy, docs

Superseded by the ROADMAP. Deploy is `deploy/qala.service` plus `docs/plan-accounts-logins.md` section 7 for the VPS move; nothing in the checklist that was here is still the reference.

## 14. Verification

- `bun run test` runs every package's tests (core, generator, llm, lspp, engine availability, server, web logic).
- Engine: the spec's 3-week validation test passes; synthetic Kalman recovery within tolerance.
- LS++: all 60 builtin programs evaluate in the Rust port and match the frozen goldens; GZCLP simulation matches documented progression.
- End to end: `bun run dev`; open the desktop shell on callisto; write a program; install the signed APK from `apps/android` on the Nothing Phone (sync target `wss://callisto.taila63f23.ts.net:8443`); log a session in airplane mode; reconnect; confirm the desktop shows the session and the engine snapshot updated.
- Run recording, on the Nothing Phone: a run of 60 min or more with the screen locked and the phone in a pocket records continuously (no gap > 10 s in raw fixes); distance on a known measured route within 2%; an audio cue is heard with the screen locked and music playing; auto-pause triggers at a stoplight and resumes; airplane mode for the whole run, then the run appears on the desktop after reconnect with elevation and splits filled in; the map renders offline for an area loaded once online.
- LLM: with `llama-beamer` running, check-in text yields valid JSON and an in-envelope adjustment; with it stopped, logging and recommendations still work and the UI says the coach is offline.
- Look: a test computes WCAG contrast for every text/background token pair in `tokens.css`, light and dark, and fails below 4.5 (3.0 for large figures); screenshots of Today in all three stages, the Plan day view, the workout, rest, session complete and Settings screens compared against the mockup canvas and Beamer's Home and Settings pages, checking Qala Test on titles and figures, DM Mono elsewhere, 2px borders, flat-at-rest cards and the CTA shadow; a ticking number keeps the same width from 9:59 to 1:11; every chart palette passes the dataviz validator in both themes and every chart renders its table view.

## 15. Assumptions made without asking (cheap to change)

Folded into `docs/DECISIONS.md`, where each one carries its status (decided, recommended, assumption or open). Anything still genuinely open is in `docs/decisions-pending.md`.

## 15a. Mockups (owner review before any build)

Done. The mockup rounds and what the owner picked in each are recorded in `docs/DECISIONS.md` section 8. The canvas is private and the files are not in this repo's docs.

## 16. Later (explicitly out of v1)

Accounts (now planned on the VPS with no Tailscale at all, `docs/DECISIONS.md` S22 and `docs/adr/0002-friends-family-auth.md`; the Tailscale Funnel idea is dropped); speech check-in; exercise illustrations (draw, license, or generate); importers (GymRun CSV, liftosaur JSON, GPX/TCX run import; PDF and voice import are `docs/rust-core.md` section 12); watch app (owner said no). Date-range controls with previous-period comparisons on the desktop workspace, and matching empty, loading and offline states for new screens (kept from the retired visual-refinement notes). Running extras: iOS native build (waits for a friend who wants runs), Runkeeper-style Feed and Challenges (social; v1 has one user), Strava upload (new API apps start at 1 connected athlete, self-upgradable to 10), Health Connect / HealthKit write-back, weather on runs, shoe mileage.

## 16a. Roadmap: run additions from the Stride review (added 2026-09-30)

Taken from `stride-design-document.md` after checking it against this plan. Not in v1; `docs/DECISIONS.md` R5 and R6. Everything else in Stride was already covered here or conflicts with a settled decision (ACWR, Flutter/Rust/Dioxus, Claude SDK, no dark mode, the Happier look).

1. **Route library and matching (R5).** New `Route` record (id, name, distance, simplified polyline, favorite flag) and a nullable `routeId` on a run. After sync, the server simplifies the run's raw fixes (Douglas-Peucker) and compares them to saved routes: about 80% overlap inside a 50 m corridor counts as a match; Fréchet distance is the fallback if out-and-back or shared-segment routes misfire. A match links the run; no match prompts "Save as a new route?". UI: a route list on the desktop Running page with run count and best/average pace, and a route detail page charting pace across its runs. Tests: replay fixtures with GPS drift, an out-and-back, and two routes sharing a segment; re-running the matcher over old runs gives the same links.
2. **HR-zone coaching (R6).** Extend the guided-workout step machine in `packages/run/guided.ts`: a step may target an HR zone (`hrZone` already exists on run samples and in the workout step schema), and the machine emits "ease up" / "push a bit" from a rolling HR average with hysteresis, the same way it does for pace. Add a quiet mode that cues only on leaving the zone, and an HR-lost alert when the strap drops for more than 30 s. Zones come from `settings.run.hrMax` and `hrRest`. Tests: HR traces that wander at a zone edge must not nag. Distinct tonal cues in place of TTS stay blocked on the 8a ducking gate.

## 16b. Roadmap: bar renders (added 2026-10-01)

Status 2026-10-01: the EZ-curl bar is rendered and `PlateDrawing` can draw it (`bar="ez"`, DESIGN 5.8a, DECISIONS L13). The EZ bar's weight is 25 lb (`settings.ezBar`) and the plate calculator's picker offers it (a choice local to that screen). Still open: a per-exercise bar so an EZ-curl exercise plans with it, the trap bar, and densities for the Android app. The `.blend` question below is settled: the scenes are scripts, there are no `.blend` files.

Add Blender renders of the bars, starting with the EZ-curl bar, for the plate calculator and the bar picker. Today the plate drawing is vector art (`PlateDrawing`, PLAN 6.8, DESIGN 5.8) and the bar inventory in `settings.plates.bars` already allows an EZ bar and a trap bar whose weights are still to be entered (PLAN 6.8). The owner wants the plates to look like real bumpers, so rendered bars should match that look. Open before it starts: the other bars to render (straight barbell, trap bar, others), render size and format for web and the Android app (PNG or WebP at a fixed set of densities), how a rendered bar lines up with the per-side plate drawing, and where the `.blend` sources live (they are binary, so likely outside the repo or in git LFS). Not in v1. `docs/DECISIONS.md` L9.

## 16c. Roadmap: run plans for beginners and for race distances

Added 2026-10-02 (owner: bring in Couch to 5K, plus 10K and marathon prep). Evidence brief: `docs/research/BRIEFS.md` brief 4. Not in v1; `docs/DECISIONS.md` R7. Two distinct tracks, because they are different products.

**Track 1, getting to a continuous run.** The NHS Couch to 5K is the reference shape, borrowed as a public-health programme and not as evidence: 9 weeks, 3 runs a week, a brisk 5-minute walk to start, alternating run and walk intervals, a rest day between runs, and a last week of 25, 28 and 30 minute continuous runs with day 1 repeated. Qala's own version has three things the NHS version does not: it knows what the person actually did, it adjusts the next session, and it knows whether they are also lifting.

1. **The plan cannot be built yet.** Section 12's run rules need a threshold pace, and 6.4's flags need 30 days of history. A first-time runner has neither. The generator needs a beginner branch that prescribes *interval durations and run:walk ratios*, not paces, and the engine needs defined "no baseline" behaviour for the 1.10x long-run rule and the 30% two-week rule rather than evaluating them against zero. Both rules keep their current values for anyone with history; they are heuristics and the UI must not present them as findings. Frandsen 2025 (PMC12421110) reports from its review that the "too much too soon" model is widely accepted and thinly evidenced, with high-risk distance jumps the one factor it supports; confirm against the full text before this sentence goes near a screen.
2. **Schema.** `RunWorkout` (section 7) gains a `walk` step kind, because a walk break is not a `recover` step and colouring it as recovery would put a recovery band on every interval chart. Steps carry an intensity tag so "conversational" becomes a number the engine can check against an sRPE the beginner actually gives.
3. **The repeat rule.** C25K's own logic is "repeat any week you did not finish, and repeat the last week twice". Today `runPlans` is a fixed list of weeks and cannot say "stay here". Add `advance` to the week (`{when: 'completed'}` or `{when: 'continuousRun', seconds}`) rather than duplicating weeks, so Today can explain why it is still on week 3. Automatic detection depends on the recorder's auto-pause (8a: 0.6 m/s for 5 s) not splitting a clean interval, which has to be checked against walk pace before it is trusted; a manual "I got through it" tap is the fallback. Skips (U24) shift rather than repeat: a shifted week never re-runs a week already passed.
4. **Adherence is a requirement, not a feature.** Relph 2023 (PMC10487403) reports 64% dropout in its cohort and links non-completion to musculoskeletal injury, and the programme "lacks an evidence base" by the authors' own statement. So the beginner plan ships with: planned sessions that survive a week of bad nights, a one-tap "couldn't make it" that does not cost the plan, and an early and quiet exit from any run that hurts (the joint-pain tap from 6.3, not a warning the user swipes past).
5. **Tests.** Week 3 does not advance on a run with a walk break in the middle; a completed run advances; a skipped week shifts and does not repeat; every interval step is emitted as a `walk` or a run step with no `recover` steps; no pace is prescribed anywhere in the first block; both growth rules report "no baseline" rather than a violation.

**Track 2, race distances.** Two distances, different evidence. 10K is mostly coach consensus (one quality session a week, easy otherwise, a long run to about 75-80% of race time, a down week every third or fourth) and needs its taper written for someone without a base, not copied from section 12's trained-runner taper. Marathon is better sourced: Knopp 2024 (PMC11065819) pools 92 sub-elite 12-week plans and is the best available base for the final twelve weeks. Read the pool before writing the plan, not one author's habits.

6. **No recent race, no estimate.** `settings.run.recentRace` (section 7) plus Riegel (6.4) is how the generator gets a starting pace. Riegel is fitted on marathon and 10 km performances, so a first-timer's goal pace built from it carries an explicit caveat, and the generator has to ask for either a recent time or a comfortable pace and say which one the plan was built on.
7. **Long run in time or distance.** Qala records both. Decide it from the injury literature, and make the decision once so the 1.10x rule and the plan agree.
8. **Fuelling** is its own gap: carbohydrate per hour, gut training, what is drinkable at 30 km. `RunWorkout` steps can carry text today; decide whether a `fueling` field is better than a note, and whether the beginner marathon block carries it at all.
9. **Race week against the hybrid table.** 6.4 already says no heavy lower body for 48 h after a half marathon and 5 days after 42 km. A race week needs those as calendar rules, not post-hoc flags, and it is where "lift first, 24 h apart when strength is the priority" does the most work.
10. **Tests.** A 10K plan from no history builds and states its assumption; a marathon plan's last 12 weeks match the pooled review's consensus; the taper lands on the race date; the race-week spacing rules are calendar-satisfied; a plan from an insufficient base is refused rather than generated.

## 16d. Roadmap: starting strength, for people who have never lifted

Added 2026-10-02 (owner: starting strength for beginning lifters, with more exposition). Evidence brief: `docs/research/BRIEFS.md` brief 1. Not in v1; `docs/DECISIONS.md` T12.

The plan today is written for someone who already trains. Section 6.3 uses RP's landmarks "for intermediate lifters", section 12's templates open at 4x5 or 4x8 with a `referenceRm` in hand, and the default progression is double progression with a deload every 5-6 weeks. None of that is wrong for a beginner; it is wrong *for* a beginner, in three specific ways: there is no reference 1RM to freeze, the volume table is the wrong column, and a cold lifter needs the load to go up often enough to keep proving the muscle is trainable rather than a deload.

1. **Volume.** Bring RP's novice column into 6.3, either as three columns or as one table plus the experience scalar. The generator already takes `experience` (section 12) and currently uses it only for main-lift frequency; decide how much of the volume model it reaches. Check the fractional-set weighting (target 1.0, synergist 0.5) at novice volumes, where indirect work from two full-body days is most of the training.
2. **Split and frequency.** Faigenbaum 2009 (ACSM, MSSE 41:857) gives novice 2-3 d/wk for the whole body, intermediate 3-4, advanced 4-5, and section 12's "2-3 full body" rule does not say what a 2-day and a 3-day novice week look like. The novice day needs its own slot composition: which movement slots, which muscle slots, and which movements are safe to teach from cold.
3. **Progression.** Open question, not a default: double progression, or add load every session for the first block. Read Zourdos 2016 and Colquhoun 2017 (near-equivalent in trained lifters, which says nothing about novices) alongside the existing Moesgaard 2022 citation before writing anything. In-session autoregulation (Helms 2018, 6.3) presumes an RPE judgement a novice may not have; the first block may need a fixed prescription with RPE recorded and not steering.
4. **Starting weights, no 1RM.** The real product work. Evaluate: a self-reported best, a percentage of bodyweight for the main lifts, a fixed starting load that climbs on the +5 lb cadence, or a "work up to a good set" first session. Whatever wins, section 6.7's ramp generator should exercise its no-1RM branch (`I = 1 / (1 + (reps + RIR) / 30)`) from day one, and `programs[id].referenceRm.source` grows a fourth value so the block-frozen reference has an honest provenance instead of a borrowed one.
5. **A cold-start pass over 6.3.** The per-muscle reactive deload fires when e1RM observations fall below their 4-week median, and readiness flags z-scores against a 4-week window. Neither has a baseline on day one. Every rule in 6.3 and 6.6 has to state what it does with no history, the same work 16c item 1 does for the running flags.
6. **The exposition.** The owner asked for more exposition, and the honest answer is that it is content, not code, and it has to be written from the brief rather than from memory:
   - The **Coach** already answers inside the envelope (section 11, U8) and is the right place for "what should I do if I miss a rep" during a session. It must not become the curriculum.
   - The **long-form exposition** is the podcast and the blog (16f). One effort, both surfaces.
   - The **in-block copy**: a first-run program's `description` lines, the rest and warm-up reasons the app already prints (6.6, 6.7), and the week-4 expectation, which is the single most useful sentence the app can show a beginner and the hardest to write honestly.
7. **Nutrition.** The numbers the Coach may state, each tagged and each with a ceiling on the claim: protein 1.4-2.0 g/kg/day (Jäger 2017, doi:10.1186/s12970-017-0177-8), energy surplus for hypertrophy, and whether creatine is in or out of the envelope. No number reaches the Coach without a source in the brief.
8. **Injury.** What actually injures beginners, which is not only "too much too soon": unfamiliar movement, technique under fatigue, the load added on the last set, training through joint pain, no sleep. Each of the app's existing guards (joint-pain tap, soreness grid, reactive deload, injury skip from U24) gets checked against a cold start.
9. **Tests.** A generated beginner program parses and evaluates; weekly `directSets_m` sits inside the novice column; the first session contains no percentage above the top of the novice range; two consecutive weeks at the top of the rep range advance the load by one plate step; every 6.3 rule either fires correctly or reports no-baseline on a fresh state; a self-reported starting weight lands the block's week 1 inside the rep range at the prescribed RPE.

## 16e. Roadmap: mindfulness at the start of a workout

Added 2026-10-02 (owner: recommend Headspace and Sam Harris's app as a starting point). Evidence brief: `docs/research/BRIEFS.md` brief 3. Not in v1; `docs/DECISIONS.md` R8.

The owner's instruction is a recommendation, not a feature, and the shape should follow from that: **Headspace** and **Waking Up** (Sam Harris's app), one tap to open each, and no attempt to replace them. Qala is a log, a planner and an engine; it has no standing to teach meditation, and the sport evidence for mindfulness is thin and mostly about anxiety and performance surrogates rather than anything Qala measures.

1. **Where.** Not a new Today rail stage. The rail (`docs/CONTEXT.md`) already has a wind-down stage, and an optional habit that leaves most stages empty is worse than a line on a screen. The recommendation goes on the pre-workout screen, where the session has not started and the warm-up's time budget (6.7) is untouched.
2. **What it says.** One sentence on each app, what each is, and that either, both or neither is fine. Deep-link to a beginner track in each app if both support it on Android; a link to the store listing is the fallback.
3. **No affiliate links and no referral codes** unless the owner decides otherwise. Recommending a paid app to beginners is precisely where that has to be a decision rather than a default (queued in `docs/decisions-pending.md`).
4. **No engine coupling.** Nothing here touches `readiness`, `prs`, `fatigueLocal` or any binding in section 6.2. Say so in the plan so a later agent does not wire a mood score into the workout.
5. **The optional in-app fallback.** A 60-second paced breathing routine, which is the one piece Qala can honestly ship without becoming a meditation app. It needs the separate breath-work read in the brief (section 2 of it), because acute breathing effects are a different literature from mindfulness practice over weeks. Decide yes or no, and if yes it is a timer and an animation, nothing more.
6. **What the copy must not say.** That it prevents injury, that it replaces sleep, that it makes an amateur faster. The brief lists the sourced version of what it does do, and the same text serves the app and the podcast.
7. **Tests.** Recommendation shows on the pre-workup screen and not on a new stage; both deep links resolve on the device; nothing it does touches an engine input; the copy contains no claim that fails the brief's source list.

## 16f. Roadmap: the beginner podcast, body composition, and the blog

Added 2026-10-02 (owner: podcasts for beginners to listen to; a blog about the owner's experience and struggles; DEXA and reference body specs instead of weighing every morning). Not in v1; `docs/DECISIONS.md` P7 and P8. All three are content first and code second.

**The podcast.** Eight short episodes, five to eight minutes, aimed at someone in their first six months of lifting who is about to do something avoidable. The first four are the owner's: doing too much too soon, avoiding injury, the importance of nutrition, and body fat and DEXA against the daily scale. The rest: picking a first program, what soreness does and does not mean, starting to run from a walk, and settling in before a session.

1. **Scripts before audio, and sources before scripts.** Every claim in a script carries a marker pointing at a line in one of the briefs in `docs/research/`. A marker that has not been resolved blocks recording. This is the same discipline as the rest of the plan: no number reaches the app or the microphone without a tag and a source. `docs/podcast/README.md` holds the format and the episode list; `docs/podcast/scripts/01-doing-too-much.md` is the worked example.
2. **Audio is produced locally.** The owner already runs TTS in other repos: a Kokoro sidecar (`Sonoro/sidecar/tts.py`, `KPipeline`, sentence chunking, 24 kHz, then ffmpeg to MP3) and an OpenAI-compatible `/v1/audio/speech` served by OpenArc-glimmer, with Qwen3-TTS and Vibe Voice also present. Qala writes the scripts and reuses one of those paths; it does not add a TTS dependency. Note the bug Sonoro hit: do not round-robin the voice per request, or a re-run produces a different narrator.
3. **Audio is not in git.** Scripts are text and live in the repo. Episodes are binaries: served by the Bun server from outside the working tree, or content-addressed like GPS tracks (S9) if they ever need per-user access. Pick one when the first episode is finished.
4. **In-app listening is later than the audio.** A player inside the workout flow needs the audio served, cached and played on the phone with the screen locked, which is the same class of problem as the run recorder (8a). Not before there are episodes.
5. **Body composition is a product thread too**, not only an episode. Record shape sketched in the brief: `bodyScans` (method, fat mass, fat-free mass, bone mineral content, protocol, machine) and `bodyMeasures` (weight, circumferences, photo ids), with the daily weight shown as a 7-day rolling mean and band and never as a single number. Three positions the app must hold, each sourced: DXA's lean mass is not muscle (Tavoian 2019 found only a modest relationship between DXA-derived lean-mass change and MRI cross-sectional muscle area change), DXA assumes a fixed hydration of fat-free tissue, and the daily scale swings by a pound or several a day, which is the same size as the change a beginner is trying to detect in a month. `packages/engine` stays out of it: body composition is not fatigue and gets no engine input. Photos are the most sensitive thing this app will hold, so the retention story is decided before the field exists.
6. **Tests.** Every claim marker in every script resolves to a sourced line in a brief; no unsourced number survives review; the trend window is the stated window; nothing in `packages/engine` imports the body records.

**The blog.** The owner writes it; the agent researches and edits. Decided 2026-10-02: drafts live in `docs/blog/` in this repo for now, published later, public, first person, bylined berkley. The subject is the experience and the struggles behind building this, including the parts that did not work, written in the owner's plain voice with no em dashes and no agent fingerprints (section 2's prose rules).

7. `docs/blog/README.md` holds the format, the voice rules and the topic queue; `docs/blog/TEMPLATE.md` is the post skeleton. Topics come from the owner, not from the agent. The queue starts from what has already come up in planning and is a suggestion, not an assignment: why one app for lifting and running, what the fatigue model got wrong before it got anything right, the decisions that got reverted, the beginner material the podcast is built from, and what it is like to be the first user of an engine you wrote yourself.
8. Publication target is open and queued (`docs/decisions-pending.md`): the drafts stay in the repo until the owner picks a home, and nothing is published before then. Any choice has to keep the blog out of the app's user data and out of the AGPL product copy, and has to work without a build step for writing.
9. The blog and the podcast share research: one brief serves both, which is the reason the briefs are briefs and not scripts.

