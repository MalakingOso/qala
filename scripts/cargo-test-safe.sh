#!/usr/bin/env bash
# Run cargo test inside a memory- and time-capped cgroup scope so a runaway test is
# killed on its own instead of taking the whole terminal session down with it.
# The build runs outside the cap (rustc needs the memory); only the tests are capped.
#
# Usage: scripts/cargo-test-safe.sh -p qala-liftoscript --lib planner_parse::tests::x -- --exact
# Env:   QALA_TEST_MEM (default 2G), QALA_TEST_SECS (default 60)
# Stop a stuck run:  systemctl --user kill --signal=KILL "qala-test-*.scope"
set -euo pipefail
LIMIT="${QALA_TEST_MEM:-2G}"
SECS="${QALA_TEST_SECS:-60}"
if ! command -v systemd-run >/dev/null 2>&1; then
  echo "systemd-run not found; refusing to run without a memory cap" >&2
  exit 1
fi
pre=()
for a in "$@"; do
  [ "$a" = "--" ] && break
  pre+=("$a")
done
cargo test "${pre[@]}" --no-run
exec systemd-run --user --scope --quiet --unit="qala-test-$$" \
  -p MemoryMax="$LIMIT" -p MemorySwapMax=0 -p RuntimeMaxSec="$SECS" \
  cargo test "$@"
