# Run golden files

Output of the TypeScript run pipeline (`packages/run`, the oracle, now deleted) recorded as
JSON so the Rust port in `crates/qala-core/src/run` can be checked against it.
Nothing here is hand-edited.

## Frozen fixtures

The generator and the TypeScript oracle were deleted on 2026-11-12 (DECISIONS S28),
so these files are frozen and cannot be regenerated. When an intended behavior
change breaks a test that reads one, update the fixture from the Rust output or
delete the test. DECISIONS S28 says where the oracle and its generators are.

## Comparing floats

```
a == e  ||  |a - e| <= tolerance * max(|a|, |e|) + 1e-9
```

The engine files use 1e-12 for the absolute part. Here it is 1e-9, because a
stationary run's speed and distance step are what is left over from a difference
of large numbers: a speed of 6.5e-6 m/s moves in its 6th digit when the last bit
of one `sin` changes, and means nothing. The relative part is 1e-9 on every case
except a Vincenty segment shorter than about 20 m in `geodesy.json`, which is
widened to `2e-8 / metres` because `sinSigma` is a difference of two products
near 1 (a last-bit change in any trig result moves a segment of `d` metres by
about `1e-16 * 6.4e6 / d`).

Everything else compares exactly: strings, booleans, integers, array lengths,
event types, step indices, the point count, which points carry `gap`, pause
interval timestamps (copies of input timestamps), split counts and indices.
Whole-run files compare that structure first, so a discrete difference reads as
one, and the numbers second.

## One-ulp nudge

After writing, the generator re-runs every case with `sin`, `cos`, `tan`, `atan`,
`atan2`, `asin` and `Math.hypot` nudged one ulp up, then down, and aborts if any
discrete output changes or a number moves by more than 1e-6 relative (above the
1e-9 floor). So no vector sits on a decision (a pause threshold, a speed gate,
a split boundary, a prompt) that another libm could flip. The worst relative
move it sees is printed (2e-8, the trailing partial split of a run, a remainder
of two large numbers).

## Inputs

Every input of the 28 tests in `packages/run` (deleted, S28) is a vector (the
pipeline, filter, auto-pause, pace, splits and guided tests; the GPX and TCX
exporters stay in TS and are not ported), as are jara's four bugs (a fix
delivered twice, a 60 m accuracy fix, batched late fixes, a 4 h run keeping its
first point). Around them are seeded generators for GPS noise, accuracy jitter,
spikes, relocations that re-anchor, duplicate and backwards timestamps, late
batches, dropouts, stops and resumes, optional fields, non-finite and missing
fields, and empty or one-fix runs.

Three conventions to know:

- `filter.json` input is `{fixes, opts?}` and `expected` is `{points, emitted}`:
  `emitted[i]` is how many points the i-th push appended (0, 1, or up to
  `reanchorCount`). The 4 h run is stored as a generator (`line`, the arithmetic
  of `lineFixes` in `packages/run/testutil.ts`) with `summary: N`, and its
  `expected` is `{count, first, last, sampled, gaps, emittedTotal}` with every
  Nth point: 14,400 points would have added 3 MB for no extra coverage.
- `process_run*.json` `expected` is the TS `ProcessedRun` plus `clock`: the
  guided clock (`causalClockTrace`) at each point, which the TS result does not
  carry. `opts.splitM` is the shorthand that wins over `opts.splits.splitM`.
- `guided.json` `guidedRun` input is `{workout, opts?, ops}` with each op
  `{update: {cueSpeedMps, distM, timeSec}}` or `{advance: {distM, timeSec}}`;
  `expected` is `{events: [per-op event list], summaries, currentStepIndex,
  complete}`.

## The guided clock

`processRun` feeds `GuidedRun` the moving time as known at each fix, with no
look-ahead (`causalMovingSec`): the closed pauses plus the open pause back-dated
to its start. It steps back by up to 5 s at the fix that confirms a pause and
holds while paused. That is a change from the earlier batch pass (owner,
2026-11-11), made so a live recorder and the batch pipeline agree; a prefix of
the fixes gives a prefix of the events.

## Fuzz (deleted)

A much larger gitignored corpus was replayed against the oracle with zero
mismatches. The generator, the corpus and the replay test were deleted on
2026-11-12 (DECISIONS S28).
