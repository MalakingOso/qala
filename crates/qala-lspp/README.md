# qala-lspp

LS++ (Liftoscript++): the program evaluation path in Rust (DECISIONS S12, S18). The TypeScript oracle (`packages/liftoscript`) was deleted on 2026-11-12 (DECISIONS S28). Plan and status: `docs/ls-plus-plus.md`, port history in `docs/rust-core.md`.

## Tests

Run tests only through the capped runner. A runaway test once used 58 GB and took the terminal down.

```sh
scripts/cargo-test-safe.sh -p qala-lspp            # whole suite, about 25 s, under 4 GB
scripts/cargo-test-safe.sh -p qala-lspp --lib planner_parse -- --test-threads=1
```

The tests need no generated data. The tracked goldens are frozen fixtures; when an intended behavior change breaks one, update the fixture from the Rust output or delete the test.

Checked in: `testdata/golden/lspp/{builtins,builtins_kg}/`, the finish-day, next-history-entry, bindings and exercise goldens, and `data/`.
