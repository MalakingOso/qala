# Rust core spike report

2026-09-30. Companion to `docs/rust-core.md` (the plan) and `docs/android-native.md`. The spike crate is `docs/spike/qcore/` (throwaway; the real crates are specified in the plan). Nothing in `packages/` was touched.

The spike was a few hours of work by a research agent plus my own re-run of the cheap parts, not the full day the task allowed. It answers question 2c and part of 2b. It does not answer 2a at all, and 2b stops short of an arm64 build. The "Not done" section is as important as the results.

## Environment

- Machine: Ubuntu, x86_64. System toolchain `cargo 1.94.1` (rustup, `~/.cargo`). The spike used `rustc 1.98.1` from a scratch rustup. The plan pins 1.98.1 in a `rust-toolchain.toml`, so run `rustup toolchain install 1.98.1` first.
- Deno 2.9.6. Node present. No JDK, Android SDK, NDK, Gradle or adb.
- Locked versions (`docs/spike/qcore/Cargo.lock`): wasm-bindgen 0.2.129, uniffi 0.32.2, automerge 0.12.0. The wasm-bindgen CLI must match the crate version exactly.

## What the spike crate does

One crate, `crate-type = ["cdylib", "rlib"]`, release profile `opt-level = "z"`, LTO, `codegen-units = 1`, `panic = "abort"`, `strip = true`. A plain-Rust core (`step_json`, `sum_fixes`) with two feature-gated shims: `wasm` (wasm-bindgen) and `ffi` (UniFFI proc-macros). An optional `am` feature pulls in automerge. On wasm32 it adds `getrandom 0.4` with the `wasm_js` feature.

## Verified

Items marked "re-run" I ran myself today; the rest are from the research agent's run and its saved artifacts.

| Claim | Evidence |
|---|---|
| One crate builds to native and wasm32 from feature-gated shims | Agent: `cargo build --release --target wasm32-unknown-unknown --features wasm`. Saved artifact `target/wasm32-unknown-unknown/release/qcore.wasm` is 825,524 bytes (with the `am` feature), 743,005 bytes after `wasm-bindgen`, 241,614 bytes gzipped. Agent's build without automerge: about 110 KB. No `wasm-opt` run, so these are upper bounds. |
| `wasm-bindgen --target deno` output loads and runs under Deno 2 | Re-run: `deno run -A t.ts` in the output directory. 200,000 `Float64Array` elements summed 20 times in 3.98 ms total. |
| JS and Rust disagree on rounding | Re-run: plate step on -6.25 (`(w / 2.5).round() * 2.5`) gives -7.5 from the wasm build and -5 from `Math.round(-6.25 / 2.5) * 2.5` in JS. `Math.round(-2.5)` is -2 in JS; Rust `(-2.5f64).round()` is -3. Re-run `cargo test --lib`: the native assertion `(-2.5).round() == -3.0` passes, so native and wasm agree with each other and both disagree with JS. |
| automerge-rs builds on wasm32 only with a getrandom feature | Agent: the first build failed asking for `wasm_js`; adding `getrandom = { version = "0.4", features = ["wasm_js"] }` under `cfg(target_arch = "wasm32")` fixed it. Automerge costs about 715 KB raw. |
| UniFFI 0.32.2 proc-macro mode generates Kotlin | The saved `kt/uniffi/qcore/qcore.kt` is 1,047 lines. `Vec<f64>` becomes `List<Double>` through a per-element converter, so large arrays are boxed and copied. Pass fixes as one `ByteArray` or a JSON string. |
| Host x86_64 `.so` size | 454,240 bytes stripped with `z` and LTO for a toy crate. A proxy only, not an arm64 number. |

Registry facts (agent, crates.io API, 2026-09-30): uniffi 0.32.2, wasm-bindgen 0.2.129, automerge 0.12.0 (2026-09-16), autosurgeon 0.14.0, samod 0.15.0, pest 2.9.2, chumsky 0.13.0, lalrpop 0.23.1, tree-sitter 0.27.0. gobley's UniFFI Gradle plugin 0.3.7, per its docs.

## Not done (assumed, or untested)

- **No arm64 build.** No NDK on this machine. Unmeasured: real `.so` size with run and engine code, `cargo-ndk` behaviour, 16 KB page alignment, call latency on the phone.
- **No Vite load.** The same wasm under Vite (`vite-plugin-wasm` or `--target web` with an explicit `init(url)`) is assumed to work and is untested.
- **No sync of any kind.** Not tested: a Rust or Kotlin client against `server/ws.ts`; samod against the Deno server; `org.automerge:automerge` 0.0.9 opening a document and exchanging sync messages on Android; whether it exposes the sync-state API or incremental save; whether it can hydrate a whole document to a tree or JSON.
- **No Kotlin ran anywhere.** Codegen output was read, never compiled or executed on a device.
- **samod on wasm32** is unlikely (tokio, rand, chrono in its dependency list) but not tried.
- **wasm-opt** and gzip numbers for the shipping build are unmeasured.
- The `p0`/Kalman and generator code were not ported; conformance is untested beyond the rounding case.

## Answers to the task's spike questions

**2a. Rust automerge on Android, sync against the Deno server.** Not tested, and superseded: Automerge is dropped (DECISIONS S3 amended, S8, S11). What follows is the earlier analysis, kept for the record. The research said not to build it that way. The Rust core never holds a document on any platform. On Android the document owner is the Kotlin binding `org.automerge:automerge` (0.0.x, wraps Rust through JNI). Sync is a small OkHttp WebSocket adapter that does the automerge-repo v1 handshake (CBOR `join`, `peer`) and relays `request` and `sync` messages, using the binding's sync-state calls for the payloads. `server/ws.ts` already implements the stock v1 protocol, so no server change is expected. samod (Rust, v0.15, experimental) probably speaks the same wire protocol and has a sans-IO core meant for FFI, but driving it from Kotlin is a large surface for one document. Revisit it when it has a stable release and a wasm or Android story. Automerge in the spike's wasm build exists only to size it: about 715 KB, a cost the web does not need to pay because JS automerge already ships there.

**2b. UniFFI.** Codegen works and produces idiomatic Kotlin for records and enums. The boundary guidance is above: JSON strings for state, one `ByteArray` for columnar fixes. Gradle integration is gobley or a hand-built `cargo ndk` plus `uniffi-bindgen generate --library` step; the pairing of gobley with UniFFI 0.32 is unchecked. The arm64 and APK-size half is not done.

**2c. Same crate with Vite and Deno.** Deno: yes, verified. Vite: assumed.

## Go/no-go criterion after the next spike

The next spike (milestone A0 in `docs/android-native.md`) must pass these before any porting starts. All five are on-device or against the real server.

| # | Check | Pass |
|---|---|---|
| 1 | arm64 build with NDK, loaded from a Kotlin test, 20,000-fix `ByteArray` through a stub `step` | `.so` under 2 MB stripped, call under 5 ms, 16 KB aligned |
| 2 | Differential fuzz of `roundWeight`, `doubleProgression` and `e1rm` (Rust against Deno) over 1,000,000 random inputs including half-integers and negatives | zero mismatches, with `js_round` in place |
| 3 | Sync round trip: a throwaway `POST /api/sync` in the Deno server and a Kotlin client against it, one record edited offline on a JS peer and on the phone | both converge; the higher HLC wins the conflicting field; 1,000 records sync in under 1 s |
| 4 | Port `filterFixes` and `computeSplits` into `crates/qala-core` as the R0 and R1 scaffold (not the throwaway spike crate), compare to fixtures captured from TS | equal to 1e-9 on every fixture |
| 5 | Oracle dump: `scripts/golden_liftoscript.ts` writes canonical JSON for all 60 built-ins; a Rust lexer and parser for `liftoscript.grammar` evaluates the first five programs identically | identical canonical JSON, no errors |

Checks 3 and 5 changed on 2026-09-30: sync is records over HTTP (Automerge dropped) and liftoscript is a Rust port with no quickjs interim. If check 5 shows the port is much bigger than 3 to 5 weeks, the stopgap is quickjs-kt (0.92 MB `.so`, one maintainer, unverified on our bundle).
