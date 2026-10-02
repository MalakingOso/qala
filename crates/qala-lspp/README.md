# qala-lspp

LS++ (Liftoscript++): the program evaluation path in Rust (DECISIONS S12, S18). The TypeScript package `packages/liftoscript` is the oracle. Plan and status: `docs/ls-plus-plus.md`, port history in `docs/rust-core.md`.

## Tests

Run tests only through the capped runner. A runaway test once used 58 GB and took the terminal down.

```sh
scripts/cargo-test-safe.sh -p qala-lspp            # whole suite, about 25 s, under 4 GB
scripts/cargo-test-safe.sh -p qala-lspp --lib planner_parse -- --test-threads=1
```

About 80 MB of the test data is generated and gitignored. On a fresh clone, regenerate it first, or the tests will not compile (they `include_str!` the unit cases) or will skip:

```sh
deno task gen:liftoscript      # runs every generator against the TS oracle, deterministic
```

Checked in: `testdata/golden/liftoscript/{builtins,builtins_kg}/`, the finish-day, next-history-entry, bindings and exercise goldens, and `data/`.
