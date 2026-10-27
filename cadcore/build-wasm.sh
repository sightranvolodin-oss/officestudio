#!/bin/sh
# Builds the drawing engine to WebAssembly and generates JS bindings into src/renderer/cadcore/.
# Needs: rustup target wasm32-unknown-unknown (or rust-src + RUSTC_BOOTSTRAP=1 -Zbuild-std), wasm-bindgen-cli 0.2.104
set -e
cd "$(dirname "$0")"
if rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
  cargo build --release --lib --target wasm32-unknown-unknown
else
  RUSTC_BOOTSTRAP=1 cargo build --release --lib --target wasm32-unknown-unknown -Zbuild-std=std,panic_abort
fi
wasm-bindgen --target no-modules --no-typescript --out-dir ../src/renderer/cadcore target/wasm32-unknown-unknown/release/cadcore.wasm
ls -la ../src/renderer/cadcore
