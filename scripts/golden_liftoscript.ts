// deno-lint-ignore-file no-explicit-any no-unused-vars ban-unused-ignore
// Golden-file oracle for the Rust port of the liftoscript evaluation path.
//
//   deno run -A scripts/golden_liftoscript.ts
//
// Writes testdata/golden/liftoscript/**. See testdata/golden/liftoscript/README.md
// for the file formats and the canonical JSON rules. Output is deterministic:
// Math.random is replaced by a seeded PRNG and Date.now is pinned.

import {
  builtinProgramNames,
  loadBuiltinProgram,
} from "../packages/liftoscript/tests/helpers.ts";
import {
  forceEvaluateText,
  liftoscriptParser,
  plannerExerciseParser,
} from "../packages/liftoscript/mod.ts";
import {
  dumpTree,
  type ITreeNode,
  liftSettings,
  reseed,
  scriptSink,
  toLog,
  uidPaths,
  wrapParser,
  writeGolden,
} from "./golden_liftoscript_lib.ts";
import { EXTRA_SCRIPTS } from "./golden_liftoscript_scripts.ts";

function stepLezerTrees(): void {
  const settings = liftSettings("lb");
  for (const file of builtinProgramNames()) {
    const name = file.replace(/\.md$/, "");
    const text = loadBuiltinProgram(file);
    reseed();
    writeGolden(
      `lezer_trees/planner/${name}.json`,
      {
        program: name,
        input: text,
        tree: dumpTree(plannerExerciseParser.parse(text)),
      },
      0,
    );
    const calls = new Map<string, ITreeNode>();
    const unwrap = wrapParser(plannerExerciseParser, calls);
    try {
      forceEvaluateText(text, file, settings);
    } finally {
      unwrap();
    }
    writeGolden(
      `lezer_trees/planner_calls/${name}.json`,
      toLog(calls),
      0,
    );
  }
}

function stepScriptTrees(): void {
  writeGolden("lezer_trees/scripts.json", toLog(scriptSink), 0);
  const extra = new Map<string, ITreeNode>();
  const unwrap = wrapParser(liftoscriptParser, extra);
  try {
    for (const s of EXTRA_SCRIPTS) liftoscriptParser.parse(s);
  } finally {
    unwrap();
  }
  writeGolden("lezer_trees/scripts_extra.json", toLog(extra), 0);
}

stepLezerTrees();
// Cases for items 2-5 run before the script trees are written so the
// scripts they trigger land in scripts.json too.
const cases = await import("./golden_liftoscript_cases.ts");
cases.runCases();
stepScriptTrees();

writeGolden(
  "uid_fields.json",
  Object.fromEntries(
    [...uidPaths.entries()].sort(([a], [b]) => a < b ? -1 : 1).map((
      [fn, set],
    ) => [fn, [...set].sort()]),
  ),
);
