# Plate golden files

Output of the TypeScript plate math (`packages/core/plates.ts` and
`packages/core/rounding.ts`, the oracle) recorded as JSON so the Rust port in
`crates/qala-core` can be checked against it. Nothing here is hand-edited.

## Regenerate

```
deno task golden:plates        # same as: deno run -A scripts/golden_plates.ts
```

Run it from the repo root. It rewrites `plates.json` and nothing else. Two
runs give byte-identical output.

## File format

```json
{
 "fn": "plates",
 "version": 1,
 "oracle": "ts",
 "cases": [
  {"name": "...", "input": {"call": "plan_plates", ...}, "expected": ...}
 ]
}
```

- `input.call` names the function: `plan_plates`, `nearest_loadable`,
  `round_weight`, `choose_next`, `describe_change`, `shorthand` or
  `barbell_step`. The rest of `input` holds the full arguments, including the
  plate inventory (`pairs` is a count or the string `"enough"`).
- `expected` is the TS return value. For `choose_next` it is the load's
  per-side plates and total plus the instruction, kept-inner length and
  plates-moved count.
- Cases are exact: every value is a multiple of 0.25 or rounded to two
  decimals by the oracle, so the Rust test compares parsed JSON with no
  tolerance.
- JSON has no NaN or Infinity, so an input that is one travels as the string
  `"NaN"`, `"Infinity"` or `"-Infinity"` (the Rust test revives them). A
  result that is one is `null`, as `JSON.stringify` writes it.
- Every case in `packages/core/plates_test.ts` appears, plus the
  deterministic cases in `packages/core/rounding_test.ts` and one collared
  plan. The two loadability loops in `rounding_test.ts` are properties; the
  Rust test checks them directly instead of listing hundreds of vectors.

## Differential fuzz

`deno task fuzz:plates` writes 1,000,000 random cases with the oracle's answers
to `testdata/golden/plates/fuzz/` (gitignored, about 80 MB, 1.5 minutes on a
few cores). `crates/qala-core/tests/fuzz_core.rs` replays them and skips with a
note when the directory is absent. The line formats are in
`scripts/gen_plates_fuzz.ts`. Anything the fuzz finds goes into `plates.json`
as a normal vector, so the plain golden test keeps covering it.
