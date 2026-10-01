#!/usr/bin/env bash
# Launch whisper.cpp's whisper-server (SYCL) for LS++ speech import.
# Pinned to the Arc B570 (level_zero:0); the B60 is left to Sonoro and the llama router.
# Override with WHISPER_MODEL, WHISPER_PORT, WHISPER_DEVICE (a level_zero index).
set -eo pipefail

WHISPER_DIR="${WHISPER_DIR:-$HOME/Programming/whisper.cpp}"
WHISPER_MODEL="${WHISPER_MODEL:-$HOME/models/whisper/ggml-large-v3-turbo-q5_0.bin}"
WHISPER_PORT="${WHISPER_PORT:-8082}"
WHISPER_DEVICE="${WHISPER_DEVICE:-0}"

# oneapi-vars.sh trips on unset variables, so no `set -u` here.
# shellcheck disable=SC1091
source /home/berkley/intel/oneapi-2026/2026.1/oneapi-vars.sh >/dev/null 2>&1 || true

# Hide every GPU except the chosen one, so the server cannot touch the B60.
# After filtering, the only visible device is index 0 for -dev.
export ONEAPI_DEVICE_SELECTOR="level_zero:${WHISPER_DEVICE}"

exec "$WHISPER_DIR/build-sycl-2026/bin/whisper-server" \
  -m "$WHISPER_MODEL" \
  --host 127.0.0.1 --port "$WHISPER_PORT" \
  -dev 0 -l en
