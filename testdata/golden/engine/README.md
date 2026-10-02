# Engine golden files

Output of the TypeScript engine (`packages/engine`, the oracle) recorded as
JSON so the Rust port in `crates/qala-core` can be checked against it.
Nothing here is hand-edited.

## Regenerate

```
deno task golden:engine        # same as: deno run -A scripts/golden_engine.ts
```

Run it from the repo root. It rewrites every file listed below and nothing
else. Two runs give byte-identical output. The generator is
`scripts/golden_engine.ts`; it imports the determinism and canonical-JSON
helpers from `scripts/golden_liftoscript_lib.ts` (seeded PRNG, `canon`).

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
  only, see there).
- `name` is unique per file (per `input.fn` in multi-function files).
- `tolerance` is present only for cases whose `expected` holds floats.
  Cases without it are exact (booleans, strings, integers, table constants).

### Two input conventions

- **Multi-function files** (`decay`, `e1rm`, `kalman`, `running`, `availability`):
  `input` is `{"fn": "<TS function name>", "args": {<TS parameter name>: value, ...}}`.
  The top-level `fn` of the file is only the module name.
- **Single-function files** (`log_session`, `calibrate`, `readiness`,
  `readiness_decay`, `fatigue_local`): `input` is the argument object directly.

`args` keys are the TS parameter names (camelCase), always named, never
positional.

### Optional values, null, undefined

- A TS `undefined` / omitted optional argument is **an absent key**. `null` in
  `expected` means the TS function returned `null` (not `undefined`), for
  example `criticalSpeed` with too few efforts. Map absent keys to `None` and
  `null` to `None` in the result position.
- Optional object fields (`rpe`, `warmup`, `isMain`, `srpe`, `lastRun`, ...) are
  likewise absent when unset. TS `undefined` inside an array never occurs.
- Input objects can carry fields the engine never reads (`id`, `elapsedSec`,
  `hrTrimp`, `perf`, `targetRepsMin`, `targetRepsMax`). Ignore unknown fields,
  do not deny them.
- Numbers are plain JSON. A float field may be written as an integer
  (`"obs": 3`, `"z": 1`, `"w": 100`); parse everything numeric as `f64`.

### Non-finite numbers

`canon` writes `NaN`, `Infinity` and `-Infinity` as the **strings** `"NaN"`,
`"Infinity"`, `"-Infinity"`, in `input` and in `expected`; `-0` is written `0`.
A harness should map those strings back to `f64` wherever a number is expected
(and treat `NaN == NaN` as equal when both sides are NaN). Every case that has
a non-finite input or output has a name starting `nonfinite:`. The exported
Rust API rejects non-finite numbers, so those cases target the inner function
only and may be skipped by a harness that goes through the API.

JS `Math.min` / `Math.max` propagate NaN; Rust `f64::min` / `f64::max` return
the non-NaN operand. Cases `nonfinite: ...` in `fatigue_local.json` and
`running.json` (`gapFactor` with a NaN grade) show where this bites.

### Errors

No case throws except where listed explicitly (`availability.json`,
`addDaysKey` with an invalid key). The generator aborts if a TS call throws
anywhere else. A thrown error is recorded as
`{"$throws": "<error class>", "message": "<message>"}` in `expected`; the Rust
function must return an error for that case (the message is informational).

### Comparing floats

`tolerance` is relative. A float `a` (Rust) matches `e` (golden) when

```
a == e  ||  |a - e| <= tolerance * max(|a|, |e|) + 1e-12
```

The absolute floor 1e-12 only matters for values that are zero or denormal-ish
(P-matrix off-diagonals, fully decayed fatigue). Compare nested structures
(states, readiness) field by field with the same rule; object key order is not
significant; arrays compare in order and by length. Strings, booleans, integers
and `null` compare exactly.

Where the comparison is not bit-exact in practice: `exp` (decay, VDOT), `pow`
(`**` and `Math.pow` in `minettiCost`, `riegel`) and `sqrt`-free arithmetic are
all within a few ulp, so 1e-9 is generous. The Kalman filter uses only
`+ - * /`; if the Rust port keeps the TS operation order (Joseph form triple
loop, then the symmetry average) it matches TS to the last bit. Rust has no
`**` on floats: use `powf` for the integer exponents in `minettiCost` to match
V8, not `powi`.

### Dates

Instants are ISO 8601 strings, passed to the engine untouched and stored in
`EngineState` exactly as given. The goldens use all of these forms (the Rust
parser must accept every one):

- `2026-09-14T17:30:00.000Z` (what `Date.toISOString` writes)
- `2026-09-14T17:30:00Z` (no milliseconds)
- `2026-09-14T13:30:00-04:00` and `2026-01-05T17:30:00-05:00` (explicit offset)
- `2026-09-14T23:00:00+05:30`
- fractional seconds with an offset, e.g. `2026-09-14T13:30:00.250-04:00`

All parse to epoch milliseconds (TS `Date.parse`); `daysBetween` is
`(ms_b - ms_a) / 86400000`. No golden uses a string without an offset (TS would
read it in local time). Dates strings are never normalised: `state.updated`,
`prsHistory[].date`, `e1rmObs[].date` ... hold the strings from the workout
input.

Availability uses local date **keys** (`YYYY-MM-DD`) compared as strings; see
`availability.json`. Invalid keys are outside the contract (V8 even accepts
`2026-02-30`).

## decay.json

Module `decay.ts`. `input = {fn, args}`. All numbers `f64`.

| `fn` | `args` | `expected` | tolerance |
|---|---|---|---|
| `daysBetween` | `{aIso, bIso}` | number: `(Date.parse(bIso) - Date.parse(aIso)) / 86400000` | 1e-9 |
| `decayValue` | `{x, dtDays, tau}` | number: `x` when `!(dtDays > 0)` (so NaN and negative dt return `x`), else `x * exp(-dtDays / tau)` | 1e-9 |
| `applyInput` | `{x, dtDays, tau, k, input}` | number: `decayValue(x, dtDays, tau) + k * input` | 1e-9 |
| `muscleTau` | `{muscle}` | number, exactly `2` or `2.5` | exact |
| `decayRecord` | `{rec, dtDays, tauFor}` | object: same keys as `rec`, each decayed; `tauFor` is the string `"muscleTau"` (per-key tau by `muscleTau(key)`) or a number (constant tau for every key) | 1e-9 |
| `TAU_CONSTANTS` | `{}` | `{TAU_FITNESS_LIFT: 45, TAU_SYSTEMIC: 10, TAU_FITNESS_RUN: 42, TAU_DAMAGE: 5}` | exact |

`muscleTau` normalises with `toLowerCase()` then removes every `_` and every
whitespace character (JS `\s`, which includes U+00A0 and U+FEFF), but **not**
hyphens, then looks the result up in the set
`lats upperback upper-back back quads quadriceps hamstrings glutes calves lowerback lower-back`
(2.5 days) and otherwise returns 2.0. `availability.normMuscle` is a different
normaliser (it strips hyphens too and maps `quadriceps` to `quads`); do not
share one implementation.

## e1rm.json

Modules `e1rm.ts` and `rtsTable.ts`. `input = {fn, args}`. A `SetLog` is
`{w, r, completed, rpe?, targetRpe?, warmup?, tested1rm?, jointPain?,
targetRepsMin?, targetRepsMax?}` (`w` load, `r` reps, may be fractional or 0).

| `fn` | `args` | `expected` | tolerance |
|---|---|---|---|
| `observeSet` | `{s: SetLog}` | `null` or `{e1rm: number, tested: boolean}` | 1e-9 |
| `bestObservation` | `{sets: SetLog[]}` | `null` or `{e1rm, tested}`; skips `warmup` sets and incomplete sets; ties keep the first (strict `>`) | 1e-9 |
| `rtsLookup` | `{reps, rpe}` | `{pct: number or null, verified: false, useRule3Fallback: boolean}` | exact |

Notes for the port:

- `observeSet` ignores `warmup` (only `bestObservation` skips warmups).
- `rtsLookup` returns the null cell when `reps` is not an integer in 1..6 (so
  `0`, `0.5`, `1.5`, `7`, NaN all give `{pct: null, ...useRule3Fallback: true}`),
  and matches a table row when `|row.rpe - rpe| < 1e-9`. The percentages are
  table constants, compared exactly.
- Rule 2 computes `(w / pct) * 100` (divide first). Rule 3 and the RPE
  fallthrough compute `w * (1 + (r + rir) / 30)` and return exactly `w` when
  `r + rir === 1` (float equality, so `0.5` reps at RPE 9.5 and `0` reps at
  target RPE 9 both hit it).
- Grids covered: reps 1..12 x (no RPE, 6..10 in 0.5 steps); reps 1..12 x
  target-RPE-only 6..10; off-table RPE (0, 4, 5, 5.5, 7.25, 8.75, 9.9, 10.5, 11,
  and values within and just outside 1e-9 of a table row); fractional and zero
  reps; tested, incomplete and warmup sets; 40 seeded random `bestObservation`
  lists.

## kalman.json

Module `kalman.ts`. `input = {fn, args}`. A `KalmanState` is
`{p0, k1, k2, thetaPrior, P: number[3][3], obs: integer, R}`.

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
  unlock (`obs < 20` keeps `k2 = thetaPrior * k1` and zeroes the third gain).
- `noiseScale 0.25 chain` (24 updates), `noiseScale 2 chain` (23 updates),
  `mixed noise chain` (28 updates, noiseScale cycles absent, 1, 0.25, 2).
- `run filter chain from initialState().kalmanRun` (25 updates). Its start state
  is the literal `kalmanRun` of `initialState()` (P = diag(1e4, 1e3, 1)), which
  is **not** `initKalman(40, 1, 2, 1)`.

The first update of a state with `obs === 0` is the anchor: it sets
`p0 = y - k1*fitness + k2*fatigue`, `obs = 1`, keeps `P`, and ignores
`noiseScale`. Individual cases cover the anchor with noiseScale 0.25 / absent,
the second update after an anchor for noiseScale 0.25 / 1 / 2 / 4 / absent, and
the unlock boundary (updates from obs 18, 19, 20, 21).

## running.json

Module `running.ts`, lines 1-161. `input = {fn, args}`. Grades are fractions
(0.05 = 5%).

| `fn` | `args` | `expected` | tolerance |
|---|---|---|---|
| `minettiCost` | `{grade}` | number (polynomial; uses `**`, see the pow note above) | 1e-9 |
| `minettiRatio` | `{grade}` | number `minettiCost(grade) / minettiCost(0)` | 1e-9 |
| `gapFactor` | `{grade}` | number: `>= 0` Minetti ratio; `<= -0.18` exactly 1; else `max(ratio, 0.88)` | 1e-9 |
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
| `srpeLoadRatio` | `{pairs: [{srpeLoad, rTSS}]}` | number; the 3.6 prior when fewer than 10 pairs or sum of `rTSS <= 0` | 1e-9 |
| `SRPE_PER_100_RTSS_PRIOR` | `{}` | `3.6` | exact |

`criticalSpeed` keeps efforts with `distanceM === 400 | 800 | 5000` (exact
float equality) and `Date.parse(date) >= Date.parse(nowIso) - 90 days` (no upper
bound; an effort dated after `nowIso` counts; exactly 90 days old is included,
90 days plus 1 ms is not), takes the fastest (`seconds` smallest) per distance,
needs all three, and returns the least-squares slope of distance on time, or
`null` when the time variance is 0.

`runZone` compares `r = ngpMps / csMps`: `r < 0.78` is 0.5, `r <= 1.0` is 1.0,
else 1.5 (NaN falls through to 1.5).

## Planned files

`log_session`, `calibrate`, `readiness`, `fatigue_local`, `readiness_decay`,
`availability` are being written; this README is extended as each lands.
