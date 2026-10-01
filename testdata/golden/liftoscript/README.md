# liftoscript golden files

Output of the TypeScript liftoscript stack (`packages/liftoscript`, the
oracle) recorded as JSON so the Rust port in `crates/qala-liftoscript` can be
checked for identical behaviour. Nothing here is hand-edited.

## Regenerate

```
deno task golden:liftoscript        # same as: deno run -A scripts/golden_liftoscript.ts
```

Run it from the repo root. It rewrites everything listed below (and nothing
else). Two runs give byte-identical output. The generator is
`scripts/golden_liftoscript.ts` with helpers in `scripts/golden_liftoscript_lib.ts`
(determinism, canonical JSON, uid scrubbing), cases in
`scripts/golden_liftoscript_cases.ts` and hand-written scripts in
`scripts/golden_liftoscript_scripts.ts`.

## Canonical JSON

- Object keys keep the insertion order TS produced. Use an ordered map in
  Rust. Caveat: JS orders integer-like keys (`"1"`, `"2"`, for example the
  `states` map keyed by tag number) ascending and first, before other keys.
- `undefined` fields are dropped. `undefined` inside an array becomes `null`
  (so optional per-set arrays such as `completedReps` carry `null` for unset
  sets).
- `-0` is written as `0`.
- `NaN`, `Infinity`, `-Infinity` are written as the strings `"NaN"`,
  `"Infinity"`, `"-Infinity"`. Case inputs that need these numbers (engine
  binding inputs) use the same strings in numeric slots, and the TS runner
  converts them back before the call.
- Numbers use JS `JSON.stringify` formatting.
- Errors become `{"$error": <class name>, "message": ..., ...own enumerable props}`.
- A live Lezer syntax node (`liftoscriptNode` on progress/update objects in an
  evaluated program) is reduced to `{"$lezerNode": <name>, "from", "to"}`. It
  is only used for error offsets during evaluation; the Rust side can ignore it.
  Without this reduction one evaluated program is 60+ MB.
- Compact (no whitespace) JSON, trailing newline. Files over about 5 MB are split.

## Case format

Files for items 2 to 5 hold `{"version": 1, "cases": [...]}` (builtins files
also carry `"program"`). A case is

```json
{"fn": "Program_nextHistoryEntry", "version": 1, "name": "...", "inputs": {...}, "output": ...}
```

- `fn` is the TS function (`runtime.ts` / `mod.ts` export name).
- `inputs` is the full argument record; the TS side ran the function on a JSON
  round trip of exactly this value, so Rust can replay from the file alone.
- If the TS function threw, `output` is `{"$throws": <class>, "message": ...}`.
- Large inputs (evaluated programs, settings) live once per file in a
  top-level `fixtures` object, `{"programs": {id: ...}, "settings": {id: ...}}`.
  A case names them with `inputs.programRef` and `inputs.settingsRef`.
  Chain steps feed the previous step's output program in as the next fixture
  (`gzclp@c2` is the program after chain step 2). Fixtures carry the real
  (seeded) ids, not `<uid>`.
- Any argument that the TS signature takes as a callback is replaced by data;
  see the per-function notes below.
- An output that exceeds about 4.5 MB of compact JSON is replaced by
  `{"$pruned": ..., "fullBytes", "fullSha256", "value"}`. `value` is the output
  with every `reuse` object nested inside another `reuse` removed;
  `fullSha256` is SHA-256 of the unpruned compact canonical JSON. Only
  `builtins/shortcut-to-size.json` hits this today.

## Nondeterminism and placeholders

TS sources of nondeterminism and how they are handled:

- `Math.random` (via `UidFactory_generateUid`) is replaced by a seeded
  mulberry32 PRNG, reseeded per case. Ids are therefore stable between runs
  but cannot be reproduced by Rust.
- Each case is executed twice under two seeds. Any string that differs between
  the two runs is replaced by `"<uid>"` in `output`. The exact field paths
  found are listed in `uid_fields.json` (array indices written as `[]`).
  Currently: `forceEvaluateText` / `evaluateQalaProgram` `id`,
  every `weeks[].days[].exercises[].id` (also inside nested `reuse.exercise`),
  `Program_nextHistoryEntry` `sets[].id` and `warmupSets[].id`,
  `qalaLiftEntryToHistoryEntry` `sets[].id`,
  `qalaLiftSessionToHistoryRecord` `entries[].sets[].id`.
  Rust tests should treat these fields as "any non-empty string".
- `Date.now()` is pinned to 1700000000000 (appears as `clonedAt` in
  `Program_clone`, which none of these cases hit; also used by a script-error
  throttle that never reaches output).
- `qalaLiftSessionToHistoryRecord` calls `Date.parse(session.date)`, which is
  deterministic but gives `"NaN"` for an unparseable date.

## Files

- `lezer_trees/`: Lezer trees, see `lezer_trees/README.md`.
- `builtins/<program>.json`: for each of the 60 builtin programs, case
  `stage_planner` (`PlannerProgram_evaluateText(text)`) and case `evaluated`
  (`forceEvaluateText(text, "<program>.md", qalaSettingsToLiftoscript({units:{weight:"lb",distance:"mi"}}))`,
  the full `IEvaluatedProgram` including `errors`).
- `builtins_kg/<program>.json`: the same evaluation with kg/km settings, for
  gzclp, starting-strength, arnold-split, gzcl-uhf-9-weeks, sheiko-29-32.
- `next_history_entry.json`: `Program_nextHistoryEntry` for every used
  exercise of every day of gzclp, smolov-jr (4 weeks), texasmethod, madcow,
  basicBeginner, ss3, gzclp in kg, and the same programs after 1 to 3
  finish-day sessions (the "with prior history" cases). Inputs
  `{programRef, settingsRef, day, exerciseKey, index, stats}`: the day data is
  `Program_getProgramDay(program, day).dayData` and the program exercise is the
  one with `key == exerciseKey` on that day. Also `Program_nextDay` and
  `getDay` cases (`getDay` returns `null` for a missing day).
- `finish_day*.json`: `runAllFinishDayScripts`, `runFinishDayScript` and
  `runUpdateScriptForEntry`. `finish_day.json` (and `_2`, `_3`, `_4`) holds the
  scenarios from `tests/gzclp_test.ts` (all four days hit, T1 miss moving to
  stage 2, T3 AMRAP 27, fallback key miss, bridge entry with resolved key,
  invalid day 99, engine bindings) plus extras (failing sets, partial
  completion, suppressed entry, kg, user prompted state, engine clamping,
  `runFinishDayScript` direct calls, madcow `update:` script at set indexes).
  `finish_day_chain_<program>.json` and `finish_day_rotation_gzclp.json` chain
  sessions: each call's `evaluatedProgram` output is the next call's program
  fixture. Entries are inline in `inputs.entries`/`inputs.entry` and carry
  real (seeded) set ids.
  Callback replacements: `opts.engineByKey` is a map programExerciseId ->
  engine bindings input and stands for `opts.engineFor`; `onError` is a no-op.
  `runFinishDayScript` takes `{programRef, day, exerciseKey, entry, opts}`.
  `runUpdateScriptForEntry` takes `{programRef, day, exerciseKey, entry,
  otherStates, setIndex}`.
- `bindings.json`: `createEngineBindings`, `applyEngineBindings` (applied to
  `Progress_createEmptyScriptBindings`), `createScriptBindings`,
  `createScriptFunctions` (function names only), `liftoscriptFnSignatures`
  (arg names and arity), `qalaSettingsToLiftoscript`, `qalaExerciseIdToType`,
  `qalaLiftEntryToHistoryEntry`, `qalaLiftSessionToHistoryRecord`,
  `evaluateQalaProgram` (including error programs).
- `uid_fields.json`: generated list of `<uid>` field paths per function.

`exercise_functions.json` and `exercise_lookup.json` in this directory come
from a different generator and are not touched by this script.
