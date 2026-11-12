# Engine golden files

Output of the TypeScript engine (`packages/engine`, the oracle, now deleted) recorded as
JSON so the Rust port in `crates/qala-core` can be checked against it.
Nothing here is hand-edited.

## Frozen fixtures

The generator and the TypeScript oracle were deleted on 2026-11-12 (DECISIONS S28),
so these files are frozen and cannot be regenerated. When an intended behavior
change breaks a test that reads one, update the fixture from the Rust output or
delete the test. DECISIONS S28 says where the oracle and its generators are.

## File format

```json
{
 "fn": "kalman",
 "version": 1,
 "oracle": "ts",
 "cases": [
  {"name": "...", "input": {...}, "expected": ..., "tolerance": 1e-9},
  ...
 ]
}
```

- The file is pretty-printed at the top level and has **one case per line**.
- `fn` is the file name without `.json` (`log_session`, `readiness_decay`, ...).
- `oracle` is `ts` (output of the TS function) or `ts+decay` (`readiness_decay.json`
  only).
- `name` is unique per file (per `input.fn` in multi-function files).
- `tolerance` is present only for cases whose `expected` holds floats. Cases
  without it are exact (booleans, strings, integers, table constants).
- Every case is self-contained: `input` holds the full arguments, including the
  full `EngineState` for state functions. A harness can check cases
  independently and in any order.

### Two input conventions

- **Multi-function files** (`decay`, `e1rm`, `kalman`, `running`, `availability`):
  `input` is `{"fn": "<TS function name>", "args": {<TS parameter name>: value, ...}}`.
  The top-level `fn` of the file is only the module name.
- **Single-function files** (`log_session`, `calibrate`, `readiness`,
  `readiness_decay`, `fatigue_local`): `input` is the argument object directly.

`args` keys are the TS parameter names (camelCase), always named, never
positional.

### Optional values, null, undefined

- A TS `undefined` or omitted optional argument is **an absent key**. A `null`
  in `expected` means the TS function returned `null` (for example
  `criticalSpeed` with too few efforts, `observeSet` on an incomplete set, a
  `prsZ` with fewer than two history points). Map absent keys and `null` to
  `Option::None`.
- Optional object fields (`rpe`, `warmup`, `isMain`, `srpe`, `lastRun`, ...) are
  likewise absent when unset. A TS `undefined` inside an array never occurs.
- Input objects can carry fields the engine never reads (`id`, `elapsedSec`,
  `hrTrimp`, `perf`, `targetRepsMin`, `targetRepsMax`, `note`). Ignore unknown
  fields, do not deny them.
- Numbers are plain JSON. A float field may be written as an integer
  (`"obs": 3`, `"z": 1`, `"w": 100`); parse every numeric field as `f64`.
- Object key order is not significant. Maps (`fitness`, `fatigueMuscle`,
  `kalman`, ...) are JSON objects; compare by key.

### Non-finite numbers

`canon` writes `NaN`, `Infinity` and `-Infinity` as the **strings** `"NaN"`,
`"Infinity"`, `"-Infinity"`, in `input` and in `expected`; `-0` is written `0`.
A harness should map those strings back to `f64` wherever a number is expected
and treat NaN as equal to NaN. Every case with a non-finite input or output has
a name starting `nonfinite:`. The exported Rust API rejects non-finite numbers,
so those cases target the inner functions only and may be skipped by a harness
that goes through the API. No state in `log_session`, `calibrate` or the
readiness files contains a non-finite number (the generator checks).

JS `Math.min` and `Math.max` propagate NaN; Rust `f64::min` and `f64::max`
return the non-NaN operand. The `nonfinite:` cases in `fatigue_local.json` and
the NaN grade in `running.json` (`gapFactor`) are where that shows.

### Errors

No case throws except where listed (`availability.json`, `addDaysKey` with an
invalid key). The generator aborts if a TS call throws anywhere else. A thrown
error is recorded as `{"$throws": "<error class>", "message": "<message>"}` in
`expected`; the Rust function must return an error for that case (the message
is informational).

### Comparing floats

`tolerance` is relative. A float `a` (Rust) matches `e` (golden) when

```
a == e  ||  |a - e| <= tolerance * max(|a|, |e|) + 1e-12
```

The absolute floor 1e-12 only matters for values at or near zero (P-matrix
off-diagonals, fully decayed fatigue). Compare nested structures (states,
readiness) field by field with the same rule; arrays compare in order and by
length. Strings, booleans, integers and `null` compare exactly.

How much margin 1e-9 leaves: re-running the TS engine with `Math.exp` and
`Math.pow` each nudged by one ulp changes no discrete output and moves the
worst relative error over all `log_session`, `calibrate` and `readiness` cases
to about 5e-13. So an `exp` or `pow` that differs from V8 in the last bit is
fine. The Kalman filter uses only `+ - * /`; if the Rust port keeps the TS
operation order (Joseph form triple loop, then the symmetry average) it should
match TS to the last bit. `minettiCost` uses `**` on floats: use `powf`
(not `powi`) and expect last-bit differences.

### Dates

Instants are ISO 8601 strings, passed to the engine untouched and stored in
`EngineState` exactly as given. The goldens use all of these forms; the Rust
parser must accept every one:

- `2026-09-14T17:30:00.000Z` (what `Date.toISOString` writes)
- `2026-09-14T17:30:00Z` (no milliseconds)
- `2026-09-14T13:30:00-04:00` and `2026-01-05T17:30:00-05:00` (explicit offset)
- `2026-09-14T23:00:00+05:30`
- fractional seconds with an offset: `2026-03-09T23:59:59.500-04:00`,
  `2026-09-14T13:30:00.250+05:30`

All parse to epoch milliseconds (TS `Date.parse`); `daysBetween` is
`(ms_b - ms_a) / 86400000`. No golden uses a string without an offset (TS would
read it in local time). Date strings are never normalised: `state.updated`,
`prsHistory[].date`, `e1rmObs[].date`, `bestEfforts[].date` ... hold the strings
from the workout input. `initialState().updated` is `1970-01-01T00:00:00.000Z`.

Availability uses local date **keys** (`YYYY-MM-DD`) compared as strings; see
`availability.json`. Invalid keys are outside the contract (V8 even accepts
`2026-02-30` and rolls it to `2026-03-02`); no golden depends on that.

## Type reference

The shapes in `input` and `expected`, copied from `packages/engine/state.ts`
(`?` means the key is absent when unset):

```ts
SetLog      { w, r, rpe?, targetRpe?, targetRepsMin?, targetRepsMax?,
              completed, warmup?, tested1rm?, jointPain? }
LiftEntry   { exerciseId, targets: string[], synergists?: string[], sets: SetLog[], isMain? }
Checkin     { prs: number, soreness: { [muscle]: 1|2|3|4 } }
LiftWorkout { kind: "lift", id, date, entries: LiftEntry[], checkin?, perf?, srpe?, minutes? }
RunWorkout  { kind: "run", id, date, distanceM, movingSec, elapsedSec,
              gradeProfile?: [{grade, meters}], descentM?, srpe?, minutes?, hrTrimp? }
Workout     = LiftWorkout | RunWorkout          (discriminated by "kind")
KalmanState { p0, k1, k2, thetaPrior, P: number[3][3], obs, R }
BestEffort  { distanceM, seconds, date }
EngineState {
  updated, mainLifts: string[],
  fitness: {[lift]: n}, fatigueMuscle: {[m]: n}, fatigueDamage: {[m]: n},
  fatigueSystemic, fitnessRun,
  kalman: {[lift]: KalmanState}, kalmanRun: KalmanState,
  runFatigueMuscle: {[m]: n}, runFatigueDamage: {[m]: n},
  bestEfforts: BestEffort[],
  prsHistory: [{date, value}], dailyLoad: [{date, load}],
  liftSessions: [{date, quadSetEq, heavyLower, srpe?}],
  e1rmObs: {[lift]: [{date, value}]},
  runs: [{date, distanceM, movingSec, descentM, z}],
  srpeRtssPairs: [{srpeLoad, rTSS}],
  referenceRm: {[lift]: {weight, date, source: "kalman"|"tested"}},
  restProfile: {byClass: {[k]: {m, samples}}, byExercise: {[k]: {m, samples}}},
  lastCheckin?: Checkin & {date}, lastRun?: {date, minutes, distanceM, z},
  sorenessPrev?: {[m]: n}, sorenessPrevPrev?: {[m]: n},
  jointPainLog: [{date, exerciseId}], injuries: [{date, area, kind}],
  hybridPriority: "lifting"|"running"
}
Readiness   { score, prsZ: number|null, prsFlag, soreBlockedMuscles: string[], reasons: string[] }
```

`restProfile`, `injuries` and `hybridPriority` are never touched by the code
under test; they pass through unchanged (`{byClass: {}, byExercise: {}}`, `[]`,
`"lifting"`). `initialState()` is the state of `calibrate([])` and the start of
every chain that begins "on initialState"; `kalmanRun` starts as
`{p0: 40, k1: 1, k2: 2, thetaPrior: 2, P: [[1e4,0,0],[0,1e3,0],[0,0,1]], obs: 0, R: 1}`
and `mainLifts` as `["squat", "bench", "deadlift", "ohp"]`.

## decay.json

Module `decay.ts`. `input = {fn, args}`. All numbers `f64`.

| `fn` | `args` | `expected` | tolerance |
|---|---|---|---|
| `daysBetween` | `{aIso, bIso}` | number: `(Date.parse(bIso) - Date.parse(aIso)) / 86400000` | 1e-9 |
| `decayValue` | `{x, dtDays, tau}` | number: `x` when `!(dtDays > 0)` (so NaN and negative dt return `x`), else `x * exp(-dtDays / tau)` | 1e-9 |
| `applyInput` | `{x, dtDays, tau, k, input}` | number: `decayValue(x, dtDays, tau) + k * input` | 1e-9 |
| `muscleTau` | `{muscle}` | number, exactly `2` or `2.5` | exact |
| `decayRecord` | `{rec, dtDays, tauFor}` | object with the keys of `rec`, each decayed; `tauFor` is the string `"muscleTau"` (per-key tau) or a number (the same tau for every key) | 1e-9 |
| `TAU_CONSTANTS` | `{}` | `{TAU_FITNESS_LIFT: 45, TAU_SYSTEMIC: 10, TAU_FITNESS_RUN: 42, TAU_DAMAGE: 5}` | exact |

`muscleTau` normalises with `toLowerCase()`, then removes every `_` and every
whitespace character (JS `\s`, which includes U+00A0 and U+FEFF), but **not**
hyphens, then looks the result up in the set
`lats upperback upper-back back quads quadriceps hamstrings glutes calves lowerback lower-back`
(2.5 days) and otherwise returns 2.0. `availability.normMuscle` is a different
normaliser (it strips hyphens too and maps `quadriceps` to `quads`); do not
share one implementation.

## e1rm.json

Modules `e1rm.ts` and `rtsTable.ts`. `input = {fn, args}`. `w` is the load, `r`
the reps (may be fractional or 0).

| `fn` | `args` | `expected` | tolerance |
|---|---|---|---|
| `observeSet` | `{s: SetLog}` | `null` or `{e1rm: number, tested: boolean}` | 1e-9 |
| `bestObservation` | `{sets: SetLog[]}` | `null` or `{e1rm, tested}`; skips `warmup` sets and incomplete sets; ties keep the first (strict `>`) | 1e-9 |
| `rtsLookup` | `{reps, rpe}` | `{pct: number or null, verified: false, useRule3Fallback: boolean}` | exact |

Notes for the port:

- `observeSet` ignores `warmup` (only `bestObservation` skips warmups).
- `rtsLookup` returns the null cell when `reps` is not an integer in 1..6 (so
  `0`, `0.5`, `1.5`, `7`, NaN all give `{pct: null, verified: false,
  useRule3Fallback: true}`), and matches a table row when `|row.rpe - rpe| < 1e-9`.
  The percentages are table constants, compared exactly.
- Rule 2 computes `(w / pct) * 100` (divide first). Rule 3 and the RPE
  fallthrough compute `w * (1 + (r + rir) / 30)` and return exactly `w` when
  `r + rir === 1` (float equality, so 0.5 reps at RPE 9.5 and 0 reps at target
  RPE 9 both hit it).
- Grids: reps 1..12 x (no RPE, 6..10 in 0.5 steps); reps 1..12 x target-RPE-only
  6..10; off-table RPE (0, 4, 5, 5.5, 7.25, 8.75, 9.9, 10.5, 11, and values
  within and just outside 1e-9 of a table row); fractional and zero reps; tested,
  incomplete and warmup sets; 40 seeded random `bestObservation` lists.

## kalman.json

Module `kalman.ts`. `input = {fn, args}`.

| `fn` | `args` | `expected` | tolerance |
|---|---|---|---|
| `initKalman` | `{p0, k1, thetaPrior, R?}` (`R` absent means the default 4) | `KalmanState` | 1e-9 |
| `kalmanUpdate` | `{k: KalmanState, fitness, fatigue, y, noiseScale?}` (`noiseScale` absent means 1) | `KalmanState` | 1e-9 |
| `kalmanPredict` | `{k, fitness, fatigue}` | number `p0 + k1*fitness - k2*fatigue` | 1e-9 |
| `thetaOf` | `{k}` | number: `k2 / k1`, or `thetaPrior` when `k1 === 0` | 1e-9 |

`kalmanUpdate` cases named `<prefix> step NN (obs a -> b ...)` form **chains**:
the `k` of step n is exactly the `expected` of step n-1 (same file, consecutive
lines), so a harness can check every step from the TS state. Chains:

- `recovery chain (kalman_test)`: 30 updates of the kalman_test synthetic
  recovery (`initKalman(170, 0.35, 4, 9)`); crosses the 20-observation theta
  unlock (while `obs < 20` the third gain is zeroed and `k2 = thetaPrior * k1`;
  the 21st update is the first that moves theta). `kalmanPredict` and `thetaOf`
  are also checked on its states 0, 1, 2, 10, 19, 20, 21, 25, 30.
- `noiseScale 0.25 chain` (24 updates), `noiseScale 2 chain` (23 updates),
  `mixed noise chain` (28 updates; noiseScale cycles absent, 1, 0.25, 2).
- `run filter chain from initialState().kalmanRun` (25 updates). Its start state
  is the literal `kalmanRun` of `initialState()`, which is **not**
  `initKalman(40, 1, 2, 1)` (P differs).

The first update of a state with `obs === 0` is the anchor: it sets
`p0 = y - k1*fitness + k2*fatigue`, `obs = 1`, keeps `P`, and ignores
`noiseScale`. Individual cases cover the anchor with noiseScale 0.25 and absent,
the second update after an anchor for noiseScale 0.25 / 1 / 2 / 4 / absent, and
the unlock boundary (updates from obs 18, 19, 20, 21).

## running.json

Module `running.ts`, lines 1-264. `input = {fn, args}`. Grades are fractions
(0.05 = 5%).

| `fn` | `args` | `expected` | tolerance |
|---|---|---|---|
| `minettiCost` | `{grade}` | number (polynomial, uses `**`) | 1e-9 |
| `minettiRatio` | `{grade}` | number `minettiCost(grade) / minettiCost(0)` | 1e-9 |
| `gapFactor` | `{grade}` | number: `grade >= 0` Minetti ratio; `<= -0.18` exactly 1; else `max(ratio, 0.88)` | 1e-9 |
| `ngp` | `{speedMps, grade}` | number | 1e-9 |
| `meanGapFactor` | `{profile?: [{grade, meters}]}` (key absent = `undefined`) | number; 1 when absent, empty, or total meters `<= 0` | 1e-9 |
| `intensityFactor` | `{ngpMps, thresholdPaceMps}` | number (can be `"Infinity"` / `"NaN"`) | 1e-9 |
| `rtss` | `{hours, IF}` | number `hours * IF * IF * 100` | 1e-9 |
| `vdotFromEffort` | `{distanceM, seconds}` | number | 1e-9 |
| `riegel` | `{seconds1, d1, d2}` | number | 1e-9 |
| `criticalSpeed` | `{efforts: [{distanceM, seconds, date}], nowIso}` | number or `null` | 1e-9 |
| `runZone` | `{ngpMps, csMps}` | number, exactly `0.5`, `1` or `1.5` | exact |
| `runSetEquivalents` | `{km, z}` (`z` is 0.5, 1 or 1.5) | `{quads, calves, glutes, hamstrings}` | 1e-9 |
| `rbeFactor` | `{n}` | number `max(0.65, 1 - 0.035 n)` | 1e-9 |
| `descentDamage` | `{descentM, rbe}` | `{quads, calves}` | 1e-9 |
| `srpeLoadRatio` | `{pairs: [{srpeLoad, rTSS}]}` | number; the 3.6 prior when fewer than 10 pairs or the sum of `rTSS` is `<= 0` | 1e-9 |
| `SRPE_PER_100_RTSS_PRIOR` | `{}` | `3.6` | exact |
| `gradeAdjustedSpeed` | `{speedMps, grade}` | number; 0 unless `speedMps > 0` | 1e-9 |
| `gradeAdjustedPace` | `{paceSecPerM, grade}` | number; `"Infinity"` unless `paceSecPerM > 0` | 1e-9 |
| `gapDistanceM` | `{segments: [{grade, meters}]}` | sum of `meters * gapFactor(grade)` over segments with `meters > 0` | 1e-9 |
| `ngpFromGapDistance` | `{gapDistM, movingSec}` | number; 0 unless `movingSec > 0` and `gapDistM >= 0` | 1e-9 |
| `rtssFromRun` | `{gapDistM, movingSec, thresholdMps}` | number; 0 when the threshold is not positive or the time or distance is negative or NaN | 1e-9 |
| `thresholdPaceFromRace` | `{raceDistM, raceSec}` | number; 0 unless both are positive | 1e-9 |

The last six are the run-load helpers merged in from `packages/run/load.ts`
(R1, `testdata/golden/run/README.md`). Unlike `intensityFactor` and `rtss`
they guard NaN and zero, so a zero threshold gives rTSS 0, not `Infinity`.
They were appended to the file, so the cases before them are unchanged.

`criticalSpeed` keeps efforts with `distanceM === 400 | 800 | 5000` (exact
float equality) and `Date.parse(date) >= Date.parse(nowIso) - 90 days` (no upper
bound: an effort dated after `nowIso` counts; exactly 90 days old is included,
90 days plus 1 ms is not), takes the fastest (smallest `seconds`) per distance,
needs all three, and returns the least-squares slope of distance on time, or
`null` when the time variance is 0.

`runZone` compares `r = ngpMps / csMps`: `r < 0.78` is 0.5, `r <= 1.0` is 1.0,
else 1.5 (NaN falls through to 1.5).

## log_session.json

`logSession(state, workout)` from `mod.ts`. `input = {state: EngineState,
workout: Workout}`, `expected` = the next `EngineState` (all fields, tolerance
1e-9).

Case names are `<scenario>/<step> <what> <date>`. Cases within a scenario are a
**chain**: the `state` of step n is the `expected` of step n-1, so Rust can both
check each step from the TS state and replay a whole chain from the first
state. A scenario's `a`, `b`, `d`, `e` final state equals the `expected` of the
matching `calibrate.json` case (the generator checks this).

| scenario | steps | what it covers |
|---|---|---|
| `a lift block` | 14 | 3 weeks, 4 main lifts plus accessories; RPE logged on some sets and `targetRpe` only on others; warmup and incomplete sets; a tested single (`tested1rm`, sets `referenceRm`); `jointPain` (on a working set; on a warmup and an incomplete set it is ignored); check-ins with soreness (`sorenessPrev`, `sorenessPrevPrev`); sRPE with minutes, sRPE without minutes, minutes without sRPE; the unused `perf` field; mixed `Z` / `-05:00` / no-ms date forms |
| `b lift+run block` | 45 | lifts and runs: a 40 min run ending 6 h 50 min before a squat (run-before-lift, noise x2 with `obs > 0`); a 130 min run (km split into damage) with descent and a grade profile, then deadlift and bench (only the lower lift is affected); 10 sRPE/rTSS pairs then a run without sRPE (fitted ratio, which differs from the 3.6 prior); best efforts at exactly 400, 800 and 5000 m so critical speed exists and zones 0.5, 1 and 1.5 all occur; VDOT window edges (3.4 min excluded, 3.5 min included, 230 min included, 230.1 min excluded, sRPE 7.5 excluded, sRPE 8 included); 12 daily runs with descent so the repeated-bout factor reaches its 0.65 floor; two final runs at exactly 90 days and 90 days + 1 s after the 400 m effort (critical speed present, then null) |
| `d squat series` | 30 | 30 squat sessions on a synthetic e1RM series; `kalman.squat.obs` crosses 20 (theta unlock) |
| `e run block` | 35 | 35 runs over 40 days with 400, 800, 5000 m efforts, 28+ VDOT observations (run theta unlock), descent, all three zones |
| `c01`, `c02` | 1 each | first ever lift / run on `initialState()` (`updated` = epoch 0) |
| `c03` | 2 | `initialState(["backSquat", "benchPress"])`: custom `mainLifts` (`squat` is then not main) |
| `c04` | 3 | a workout dated **before** `state.updated` (no decay, `updated` moves backwards), then one after it, then a run 10 days earlier |
| `c05` | 4 | four workouts at the same instant written in `Z`, `-05:00`, no-ms and `+05:30` forms (dt 0) |
| `c06`, `c07`, `c08` | 5, 5, 10 | DST spring forward (2026-03-08) and fall back (2026-11-01), month, year (2027-01-01) and leap day (2028-02-29) boundaries, a date going back in time |
| `c09` | 7 | empty `entries`; `minutes: 0` and sRPE 0 on lifts and runs |
| `c10` | 2 | half-integer reps and RPE (4.5 @ 8.5, 0.5 @ 9.5, 0 reps, 8.25 RPE, 10.5 reps) |
| `c11` | 4 | entries with no targets, no synergists key, odd muscle spellings (`Quadriceps`, `Lower Back`), duplicate targets, then a later session that decays those keys |
| `c12` | 5 | tested 1RM on a main lift, on a non-main lift (ignored), incomplete attempt, RPE 9.5 single without the flag, attempt logged at RPE 7 |
| `c13` | 1 | `jointPain` on working, warmup, incomplete and accessory sets |
| `c14` | 3 | `isMain` true on an accessory and false on a main lift; two squat entries in one session; a promoted accessory with a Kalman entry |
| `c15 run-before-lift NN` | 18 pairs | each pair is a run step then a lift step from the same start state; hits at 6 h and 7 h 59 min 59 s, misses at exactly 8 h and 12 h, bench and ohp (upper body) miss, deadlift hits, `lunge` with `isMain` hits, a negative gap hits (see quirks), run minutes 29.9 vs 30 vs `movingSec / 60`, tested single (noise 0.25 x 2), first observation of a new lift (anchor ignores noise) |
| `c16` | 13 | run edge cases: zero distance, zero `movingSec`, empty and zero-meter grade profiles, grades beyond -18% and +30%, 100 km, then 400, 800 and 5000 m efforts and the first run scored against a critical speed |
| `c17 long run NN` | 6 | minutes 120 (no split), 121, 240, `minutes` field vs `movingSec`; each from the same start state |
| `c18` | 2 + 4 | repeated-bout window: a descent run exactly 42 d, 42 d + 1 s and 42 d - 1 s after the first one, and a run dated before both (later runs still count) |
| `c19` | 3 | mixed offset forms inside one chain |

## calibrate.json

`calibrate(history)` from `mod.ts`. `input = {history: Workout[]}`, `expected`
= the final `EngineState` (tolerance 1e-9).

`calibrate` sorts a copy of `history` by `Date.parse(date)` ascending and
replays it through `logSession` from `initialState()`. The sort is **stable**:
workouts with equal instants keep their input order (use `sort_by`, not
`sort_unstable_by`; instants written in different offset forms are equal when
they are the same moment). Cases: empty history, single workouts, the four
scenarios of `log_session.json` in order, reversed and shuffled (deliberately
unsorted), the 3-week `validation_test.ts` block with and without its three
rest-day sessions (empty `entries`, `srpe: 0`, `minutes: 0`), its tested-1RM
case, its out-of-order case, ties in both orders (the two orders give
different states), a tie in the middle of an unsorted history, and the DST
spring-forward block in order and shuffled. `d: synthetic Kalman recovery` is
the 30-observation filter run through `calibrate`.

## readiness.json

`predictReadiness(state, checkin, sessionMuscles)` from `mod.ts`. `input =
{state, checkin, sessionMuscles?, now}`, `expected` = `Readiness` (tolerance
1e-9; `reasons` and `soreBlockedMuscles` compare exactly and keep their order).

- `now` equals `state.updated` in every case (the generator checks). TS reads
  fatigue as of `state.updated` and ignores `now`; Rust's
  `predict_readiness(state, checkin, session_muscles, now)` decays first, which
  is a no-op here. The prs window is `[now - 28 d, +inf)`.
- `sessionMuscles` **absent** means `Object.keys(checkin.soreness)` (TS
  `undefined`); `sessionMuscles: []` is an empty list (nothing is blocked,
  local fatigue is 0). Keep `Option<Vec<_>>` apart from `Some(vec![])`.
- Muscle names are used verbatim as keys (`fatigueMuscle["quads"]` is not
  `fatigueMuscle["Quads"]`); there is no normalisation here.
- `soreBlockedMuscles` is `sessionMuscles.filter(m => soreness[m] === 4)`, so it
  keeps `sessionMuscles` order and duplicates.
- The `metrics_test.ts` (lines 68-81) and `hybrid_test.ts` (lines 47-50) cases are
  included by name. The metrics z-score case uses `initialState()` with
  `updated` = epoch 0 and a history dated 2026: see the quirks.
- Coverage: no / one / two history points, sd 0, a point exactly 28 d old
  (included) and 28 d + 1 ms (excluded) in `Z`, `-05:00` and `+05:30` forms, a
  future-dated point, z exactly -1.5 / -1 / just above -1.5, prs <= 4 with and
  without a z, soreness 4 and 3 together, local fatigue at 0.3 / 0.4 / 0.41 / 1 /
  2 / 4 / 8 / 20 (the `> 0.01` threshold sits between 0.4 and 0.41), systemic
  fatigue at 0 / 0.3 / 0.4 / 0.41 / 0.5 / 3 / 6 / 12, the maximum penalty
  (score 0.15), and five check-in variants against six realistic states taken
  from the `log_session` scenarios.

## fatigue_local.json

`fatigueLocal(gm)` from `readiness.ts`. `input = {gm}`, `expected` = number
`min(1, max(0, gm / 8))` (tolerance 1e-9). Three `nonfinite:` cases: NaN gives
`"NaN"` (JS semantics), `Infinity` gives 1, `-Infinity` gives 0.

## readiness_decay.json

Oracle `ts+decay`. Same `input` shape as `readiness.json`, but `now` is **not**
`state.updated`. `expected` is built in the generator by:

1. `s = clone(state)` and `dt = daysBetween(state.updated, now)`;
2. `decayAll(s, dt)`, a copy of the non-exported `decayAll` in
   `packages/engine/mod.ts` lines 81-96 (nothing happens when `!(dt > 0)`):
   `fitness` values with `TAU_FITNESS_LIFT` (45), `fatigueMuscle` and
   `runFatigueMuscle` with `decayRecord(..., muscleTau)`, `fatigueDamage` and
   `runFatigueDamage` with `TAU_DAMAGE` (5), `fatigueSystemic` with
   `TAU_SYSTEMIC` (10), `fitnessRun` with `TAU_FITNESS_RUN` (42);
3. the TS readiness core `readiness.ts predictReadiness(s, checkin,
   sessionMuscles ?? Object.keys(checkin.soreness), now)`.

The generator asserts that the copy gives exactly the decay `logSession` applies
(an empty session at `now`), and that a 1e-12 relative nudge of the decayed
fatigue flips no `reasons` entry, so no case sits on a threshold where `exp`
rounding could change a branch.

`now` is later than `updated` by 1 h to 21 d (and 200 d, and 1 ms) in `Z`,
`-05:00`, `+05:30` and no-ms forms; there are cases with `now == updated`, and
with `now` **before** `updated` (no decay; the prs window is still anchored at
`now`). Hand-built states cross the 2026-03-08 and 2026-11-01 DST changes, a
month boundary and a year boundary, and use fatigue keys with different
spellings (`Lower Back`, `upper_back`, `upper-back`, `UpperBack`, `Quadriceps`,
`lower-back`) to exercise `muscleTau`'s normalisation. `prs window` cases show
points leaving the 28 d window as `now` advances. `Readiness.score` and `prsZ`
carry tolerance 1e-9; the discrete fields are exact.

## availability.json

Module `availability.ts`. `input = {fn, args}`. Types:
`Availability {status: "active"|"break"|"vacation"|"sick"|"injured"|"scheduling",
since?, until?, muscle?, note?}`, `DaySkip {date, reason: SkipReason, muscle?,
note?}`, dates are `YYYY-MM-DD` keys. All outputs are exact.

| `fn` | `args` | `expected` |
|---|---|---|
| `shiftsPlan` | `{reason}` | boolean (true for `vacation` and `sick`) |
| `coversDay` | `{a: Availability, dateKey}` | boolean: false when `status === "active"` or `since` is absent; false when `dateKey < since`; false when `until` is present and `dateKey > until`; else true. String comparison |
| `reasonOn` | `{dateKey, availability, skips}` | `SkipReason` or `null`: the **first** skip with `date === dateKey` wins, else the status if it covers the day, else `null` |
| `classifyDay` | `{dateKey, availability, skips}` | `"train"`, `"rest"` or `"shift"` |
| `injuredOn` | `{dateKey, availability, skips}` | `string[]` with at most one muscle, as stored (not normalised). If any skip matches the date, only that first skip counts: `[skip.muscle]` when it is `injured` with a muscle, else `[]` (so a `sick` skip hides an injured status). With no skip: `[availability.muscle]` when the status is `injured`, covers the day and has a muscle, else `[]` |
| `normMuscle` | `{muscle}` | string: lowercase, remove whitespace, `_` and `-`, then `quadriceps` becomes `quads` |
| `guardExercise` | `{targets, synergists?, injured}` | `"skip"` (a target matches an injured muscle after `normMuscle`), `"halve"` (only a synergist matches), `"train"` (also when `injured` is empty). `synergists` absent behaves as `[]` |
| `applyInjuryToCheckin` | `{checkin, injured}` | `Checkin`: unchanged when `injured` is empty; else `soreness` is a copy with `soreness[normMuscle(m)] = 4` for each injured `m` (existing keys keep their original spelling, so `{Quadriceps: 2}` plus injured `quads` gives both keys); `prs` untouched |
| `addDaysKey` | `{dateKey, days}` | string `YYYY-MM-DD`: UTC math on `dateKey` at 00:00Z plus `days * 86400000` ms |

`addDaysKey` with an unparsable key throws in TS (`RangeError: Invalid time
value`); two cases record `{"$throws": "RangeError", "message": "Invalid time
value"}`. Not ported: `todayKey` (clock dependent) and the
`recommendNextSession` case of `availability_test.ts` (out of scope for M1).

## TS quirks

The TS behaviour is the oracle; none of these was changed.

1. **Run-before-lift has no lower bound on the gap.** In `applyLift` the test is
   `(Date.parse(w.date) - lastRunEnd) / 3600000 < 8` (no `>= 0` check, unlike
   `checkRunBeforeLift` in `running.ts`). A lower-body main lift dated before the
   last run's end, even days before its start, counts as run-before-lift and
   doubles the Kalman noise (`c15` variants 8 and 9). It only has an effect when
   that lift's Kalman `obs > 0`; the first observation anchors and ignores noise.
2. **`lastRun.minutes` is the `minutes` field when present** (even `0`, since TS
   uses `??`), else `movingSec / 60`. It drives both the `>= 30` test and the run
   end time (`date + minutes * 60000`), so `minutes: 35` with `movingSec: 1500`
   qualifies and `minutes: 0` never does.
3. **`minutes: 0` is falsy on a lift**: `srpe` is then ignored for systemic load and
   `dailyLoad`, but `liftSessions[].srpe` still records it. `srpe: 0` with
   minutes adds a zero-load `dailyLoad` entry. On a run `minutes` uses `??`, so 0
   is kept.
4. **`state.updated` can move backwards.** A workout dated before `updated`
   decays nothing (dt clamps to 0) but still sets `updated = workout.date`
   (`c04`).
5. **Repeated-bout count has no lower bound either**: `runs` dated after the new
   run satisfy `new.date - r.date <= 42 d` (negative) and count (`c18`).
6. **`prsZScore` has no upper bound**: history points dated after `now` count.
   The `metrics_test` case relies on it (`updated` is epoch 0, history is 2026).
7. **`Math.min` and `Math.max` propagate NaN** (see above).
8. **Muscle keys are case-sensitive in state but normalised for decay**:
   `fatigueMuscle["Quadriceps"]` and `["quads"]` are separate keys that decay
   with `muscleTau` (2.5 d for both). `quadSetEq` counts a set when any target
   lowercased contains `"quad"`.
9. **`isMain` default is exact-case membership in `state.mainLifts`**, while
   `isLowerBodyLift` lowercases and matches substrings (`squat`, `deadlift`,
   `lunge`, `legpress`, `leg-press`, `leg_press`), so `romanian_deadlift` and
   `front_squat` are lower body. Only main entries touch `fitness`, `kalman`,
   `e1rmObs`, `referenceRm`.
10. **`criticalSpeed` is computed before the current run is added to
    `bestEfforts`**, and `applyRun` treats the result as absent when it is null or
    falsy (`cs ? runZone(...) : 1.0`, so 0 and NaN also give zone 1.0).
11. **Duplicate main entries** in one session each snapshot fitness before their
    own sets, so the second sees the first's added fitness (`c14`).
12. **A tie in `bestObservation`** keeps the first set, which decides the `tested`
    flag (`e1rm.json`, two cases).
13. **`checkRunBeforeLift`'s 8 h rule and `applyLift`'s differ in strictness**:
    exactly 8 h is a miss in both (`< 8`).

## Differential fuzz (deleted)

A 1,500,000-case differential fuzz (1,000,000 e1RM cases and 500,000 date, decay
and readiness cases) was replayed against the oracle with zero mismatches under
the tolerance rule above (2026-10-14). The generator, the corpus and the replay
test were deleted on 2026-11-12 (DECISIONS S28).
