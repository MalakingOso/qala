# qcore spike (throwaway)

Proves one crate can build to wasm32 and native from feature-gated shims, load in Deno, and generate Kotlin through UniFFI. The real crates are written fresh in `crates/` (see `docs/rust-core.md`). Results and what wasn't tested are in `docs/rust-core.md` appendix A.

Toolchain: rustc 1.98.1, wasm-bindgen CLI 0.2.129 (must match `Cargo.lock`), uniffi 0.32.2.

```sh
# wasm32 (needs: rustup target add wasm32-unknown-unknown)
cargo build --release --target wasm32-unknown-unknown --features wasm,am
wasm-bindgen --target deno --out-dir out target/wasm32-unknown-unknown/release/qcore.wasm
deno run -A t.ts

# native + Kotlin bindings
cargo build --release --features ffi
cargo run --features ffi --bin uniffi-bindgen -- generate --library target/release/libqcore.so --language kotlin --out-dir kt

# native rounding test: --lib is required, the uniffi-bindgen bin needs the ffi feature
cargo test --lib
```

`kt/uniffi/qcore/qcore.kt` is the generated output from the run on 2026-09-30 (1,047 lines), kept as evidence for the boundary shape. The exact flags above are reconstructed from the agent's build, not re-run end to end today; I re-ran `t.ts` and `cargo test --lib`.
