#!/usr/bin/env bash
# Builds crates/qala-lspp-wasm to wasm32 and runs wasm-bindgen for deno and web.
# Output: target/wasm-out/{deno,web}/ (gitignored). Needs the wasm32-unknown-unknown target
# and a wasm-bindgen CLI whose version equals the wasm-bindgen crate in Cargo.lock.
# If the pinned toolchain lacks the target, set RUSTUP_TOOLCHAIN, RUSTUP_HOME and CARGO_HOME
# (and PATH) to one that has it before calling. wasm-opt -Oz runs when it is on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -p qala-lspp-wasm --release --target wasm32-unknown-unknown
wasm=target/wasm32-unknown-unknown/release/qala_lspp_wasm.wasm
out=target/wasm-out
rm -rf "$out"
wasm-bindgen --target deno --out-dir "$out/deno" "$wasm"
wasm-bindgen --target web --out-dir "$out/web" "$wasm"
if command -v wasm-opt >/dev/null 2>&1; then
  for t in deno web; do
    f="$out/$t/qala_lspp_wasm_bg.wasm"
    wasm-opt -Oz "$f" -o "$f.opt" && mv "$f.opt" "$f"
  done
fi
ls -l "$out"/*/qala_lspp_wasm_bg.wasm
