#!/usr/bin/env bash
# Regenerate every generated liftoscript test file from the TS oracle (packages/liftoscript).
# These files are gitignored (about 80 MB); the small goldens and builtins/ stay checked in.
# The output is deterministic, so a clean second run changes nothing.
# Usage: scripts/gen_liftoscript_testdata.sh        (or: deno task gen:liftoscript)
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=packages/liftoscript/deno.json
UNIT=crates/qala-lspp/testdata/unit
run() { echo "== deno run -A $*"; deno run -A --v8-flags=--max-old-space-size=7168 "$@"; }

run scripts/golden_liftoscript.ts                      # builtins, lezer_trees, finish_day, bindings
run --config "$CFG" scripts/export_exercise_golden.ts  # exercise_lookup, exercise_functions
run scripts/gen_script_parse_cases.ts                  # lezer_trees/scripts_fuzz.json
run scripts/gen_planner_parse_cases.ts                 # lezer_trees/planner_fuzz.json
run scripts/gen_program_fuzz.ts                        # fuzz/programs_fuzz_*.json
for g in planner_eval planner_exercise_eval script_eval program_to_planner; do
  run --config "$CFG" "$UNIT/gen_${g}_cases.ts"
done
(cd packages/liftoscript && echo "== gen_unit_cases" && deno run -A --v8-flags=--max-old-space-size=7168 --config deno.json ../../$UNIT/gen_unit_cases.ts)
echo "done"
