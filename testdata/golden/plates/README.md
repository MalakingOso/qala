# Plate golden files

Output of the TypeScript plate math (`packages/core/plates.ts` and
`packages/core/rounding.ts`, the oracle) recorded as JSON so the Rust port in
`crates/qala-core` can be checked against it. Nothing here is hand-edited.

## Frozen fixtures

The generator and the TypeScript oracle were deleted on 2026-11-12 (DECISIONS S28),
so these files are frozen and cannot be regenerated. When an intended behavior
change breaks a test that reads one, update the fixture from the Rust output or
delete the test. DECISIONS S28 says where the oracle and its generators are.

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

## Differential fuzz (deleted)

A 1,000,000-case differential fuzz against the oracle had zero mismatches
(2026-10-14). The generator, the corpus and the replay test were deleted on
2026-11-12 (DECISIONS S28). Anything it found is in `plates.json` as a normal
vector, so the plain golden test keeps covering it.
