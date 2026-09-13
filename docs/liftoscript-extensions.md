# liftoscript extensions

Qala vendors liftosaur's liftoscript language (expression language plus
planner program language, `packages/liftoscript`) and extends the expression
language with numeric engine bindings. Full vendoring notes: PLAN.md
section 5.

## Engine bindings (PLAN section 5)

Added to `VScriptBindings` (`src/liftoscriptFns.ts`) as plain numbers, so
the evaluator's type system is untouched. A program can read them like any
other binding, for example:

```liftoscript
// Back off when the lifter is sore or the engine calls a deload.
if (soreness >= 3 || deload > 0) {
  weights = weights * 0.9
}
```

| Binding | Range | Neutral default | Meaning |
|---|---|---|---|
| `readiness` | 0-1 | 1 | Derived session readiness from the check-in (PRS z-score, soreness grid, normalised fatigue). |
| `prs` | 0-10 | 0 | Perceived Recovery Status tap at session start. |
| `soreness` | 1-4 | 1 | Max RP soreness score over the exercise's target muscles (1 never sore, 2 healed well before, 3 healed just in time, 4 still sore now). |
| `fatigueLocal` | 0-1 | 0 | Normalised per-muscle fatigue for the exercise's prime movers. |
| `deload` | 0, 1, 2 | 0 | 0 none, 1 per-muscle reactive deload, 2 systemic deload. |
| `recWeightPct` | -10 to 2.5 | 0 | Engine's recommended weight change in percent (same envelope Gemma may use). |
| `recSets` | -2 to 1 | 0 | Engine's recommended set-count change. |

Semantics preserved from liftosaur: `progress: custom(state...) {~ ~}` runs
once after the workout per exercise and may write `weights[...]`, `reps`,
`RPE`, `timers`, `numberOfSets`, `rm1`, `setVariationIndex`,
`exerciseVariationIndex`, `descriptionIndex` and `state.*`; `update:
custom() {~ ~}` runs at `setIndex == 0` and after every set and writes only
the current entry. Built-in progressions `lp(...)`, `dp(...)`, `sum(...)`
are unchanged (see `PlannerProgramExercise_buildDpRangeScript` and the
`sets` script function).

## Wiring

- `createEngineBindings(input)` (`src/runtime.ts`) builds clamped engine
  bindings; absent inputs fall back to the neutral defaults above.
- `createScriptBindings(..., engine?)` and `applyEngineBindings` merge them
  into the script bindings before a run.
- `Progress_defaultEngineBindings()` (`src/models/progress.ts`) is the
  single source of the neutral defaults, also used by
  `Progress_createEmptyScriptBindings`, so scripts that read an engine
  binding without the engine attached see neutral values rather than
  `unknownVariable` errors.
- `runFinishDayScript` accepts `{ engine }` and `runAllFinishDayScripts`
  accepts `engineFor(entry)`, so per-exercise engine state (e.g. soreness
  over that exercise's targets) flows into progress scripts.
- `LiftoscriptFns_bindingStaticType` reports the new bindings as `number`.

## Qala-specific adaptations (not language changes)

- `src/parser.ts`: `rollbar` and `utils/dialog` imports stubbed to console
  output, `micro-memoize` replaced by `src/utils/memoize.ts`.
- `src/models/program.ts` and the script subset in
  `src/models/progress.ts` are headless ports of the pure evaluation and
  script helpers; finish-day entry points live in `src/runtime.ts` against
  `@qala/core` document types.
- App-shell custom-exercise mutators needing the redux store were omitted
  from `src/models/exercise.ts`; the exercise DB, metadata and all pure
  helpers are unchanged. `exerciseDescriptions.ts` (862 KB prose) is skipped.
- Lezer grammars ship with liftosaur's prebuilt generated parsers
  (`src/liftoscript.ts`, `src/pages/planner/plannerExerciseParser.ts`),
  loaded through the `npm:@lezer/*` specifiers in `deno.json`; no codegen
  step is needed and no hand-ported parser was required.
