// Re-vendor liftoscript sources from upstream liftosaur (docs/PLAN.md section 5).
//
//   deno run --allow-all scripts/vendor_liftosaur.ts --check        # offline: verify the mapped set exists locally
//   deno run --allow-all scripts/vendor_liftosaur.ts [--src DIR] [--ref REF]
//
// With --src missing, clones --depth 1 at --ref (default origin/master) into
// a scratch dir outside the repo, then copies the mapped files into
// packages/liftoscript keeping upstream file names. Local-only files
// (mod.ts, runtime.ts, deno.json, tests/) are never touched.
//
// The upstream commit that was copied goes into packages/liftoscript/VENDORED (docs/DECISIONS.md
// S17): the script reads it with `git rev-parse HEAD` in the source checkout and refuses to copy
// anything when it can't, so --src must be a git checkout.
//
// After copying, reapply the documented local patches (the script lists them
// and exits nonzero until you confirm with --patched):
//   - src/parser.ts: stub `rollbar` and `utils/dialog` imports
//   - src/liftoscriptFns.ts: engine bindings (see docs/ls-plus-plus.md 7)

import { join } from "node:path";

const REPO = new URL("../packages/liftoscript/", import.meta.url).pathname;

// [upstream path, local path relative to packages/liftoscript]
const FILES: Array<[string, string]> = [
  ["liftoscript.grammar", "liftoscript.grammar"],
  ["src/liftoscript.ts", "src/liftoscript.ts"],
  ["src/liftoscriptEvaluator.ts", "src/liftoscriptEvaluator.ts"],
  ["src/liftoscriptFns.ts", "src/liftoscriptFns.ts"],
  ["src/parser.ts", "src/parser.ts"],
  [
    "src/pages/planner/plannerExercise.grammar",
    "src/pages/planner/plannerExercise.grammar",
  ],
  [
    "src/pages/planner/plannerExerciseParser.ts",
    "src/pages/planner/plannerExerciseParser.ts",
  ],
  [
    "src/pages/planner/plannerExerciseEvaluator.ts",
    "src/pages/planner/plannerExerciseEvaluator.ts",
  ],
  [
    "src/pages/planner/plannerEvaluator.ts",
    "src/pages/planner/plannerEvaluator.ts",
  ],
  [
    "src/pages/planner/models/plannerStructure.ts",
    "src/pages/planner/models/plannerStructure.ts",
  ],
  [
    "src/pages/planner/models/plannerProgram.ts",
    "src/pages/planner/models/plannerProgram.ts",
  ],
  ["src/models/programToPlanner.ts", "src/models/programToPlanner.ts"],
  ["src/models/weight.ts", "src/models/weight.ts"],
  ["src/models/set.ts", "src/models/set.ts"],
  ["src/models/muscle.ts", "src/models/muscle.ts"],
  ["src/models/exercise.ts", "src/models/exercise.ts"],
  ["src/types.ts", "src/types.ts"],
  ["src/utils/math.ts", "src/utils/math.ts"],
  ["src/utils/collection.ts", "src/utils/collection.ts"],
  ["images/front-muscles.svg", "images/front-muscles.svg"],
  ["images/back-muscles.svg", "images/back-muscles.svg"],
];

const PROGRAMS_DIR = "programs/builtin";

const PATCHES = [
  "src/parser.ts: stub `rollbar` and `utils/dialog` imports",
  "src/liftoscriptFns.ts: engine bindings (docs/ls-plus-plus.md 7)",
];

function arg(name: string, def?: string): string | undefined {
  const i = Deno.args.findIndex((a) => a === `--${name}`);
  if (i >= 0) return Deno.args[i + 1] ?? def;
  const kv = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const flag = (name: string): boolean => Deno.args.includes(`--${name}`);

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

const VENDORED = join(REPO, "VENDORED");

/** Output of `git -C dir args`, trimmed, or null when git fails or dir isn't a checkout. */
async function git(dir: string, args: string[]): Promise<string | null> {
  const out = await new Deno.Command("git", {
    args: ["-C", dir, ...args],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).output();
  return out.success ? new TextDecoder().decode(out.stdout).trim() : null;
}

/**
 * Rewrites the header of VENDORED (everything up to the first blank line) for the checkout
 * in `dir` (checked out at `commit`) and keeps the notes after it.
 */
async function recordCommit(dir: string, commit: string): Promise<void> {
  const committed = await git(dir, ["log", "-1", '--format=%cI, "%s"']);
  const ref = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty =
    (await git(dir, ["status", "--porcelain", "--untracked-files=no"])) !== "";
  const old = await readText(VENDORED);
  const previous = old?.match(/^commit: ([0-9a-f]{40})/m)?.[1];
  const split = old === null ? -1 : old.search(/\n\n/);
  const notes = old === null || split < 0 ? "" : old.slice(split + 2);
  const header = [
    "upstream: https://github.com/astashov/liftosaur (AGPL-3.0)",
    `commit: ${commit}${
      dirty ? " (the checkout had uncommitted changes)" : ""
    }`,
    `committed: ${committed ?? "unknown"}`,
    `ref: ${ref ?? "unknown"}`,
    `vendored: ${new Date().toISOString().slice(0, 10)}`,
    ...(previous && previous !== commit ? [`previous: ${previous}`] : []),
  ];
  await Deno.writeTextFile(
    VENDORED,
    header.join("\n") + "\n" + (notes ? "\n" + notes : ""),
  );
}

if (flag("check")) {
  const missing = [];
  for (const [, local] of FILES) {
    if (!(await exists(join(REPO, local)))) missing.push(local);
  }
  let programs = 0;
  try {
    for await (const e of Deno.readDir(join(REPO, PROGRAMS_DIR))) {
      if (e.isFile && e.name.endsWith(".md")) programs++;
    }
  } catch {
    missing.push(`${PROGRAMS_DIR}/ (*.md)`);
  }
  if (programs < 60) {
    missing.push(`${PROGRAMS_DIR}/ (only ${programs} programs, want 60)`);
  }
  const recorded = await readText(VENDORED);
  if (recorded === null || !/^commit: [0-9a-f]{40}\b/m.test(recorded)) {
    missing.push("VENDORED (needs a `commit: <40 hex>` line)");
  }
  if (missing.length > 0) {
    console.error(`vendor check: missing ${missing.length} vendored file(s):`);
    for (const m of missing) console.error(`  ${m}`);
    Deno.exit(1);
  }
  console.log(
    `vendor check: ${FILES.length} files + ${programs} programs present`,
  );
  Deno.exit(0);
}

let src = arg("src");
if (!src) {
  const ref = arg("ref", "master")!;
  src = await Deno.makeTempDir({ prefix: "liftosaur-vendor-" });
  console.log(`cloning liftosaur ${ref} into ${src}`);
  const cmd = new Deno.Command("git", {
    args: [
      "clone",
      "--depth",
      "1",
      "--branch",
      ref,
      "https://github.com/astashov/liftosaur",
      src,
    ],
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  });
  const st = await cmd.output();
  if (!st.success) {
    console.error("clone failed; pass --src <existing checkout> instead");
    Deno.exit(1);
  }
}

const missingUpstream = (await Promise.all(
  FILES.map(async ([up]) => (await exists(join(src!, up))) ? null : up),
)).filter((x): x is string => x !== null);
if (missingUpstream.length > 0) {
  console.error(
    `upstream checkout lacks ${missingUpstream.length} file(s) (wrong ref?):`,
  );
  for (const m of missingUpstream) console.error(`  ${m}`);
  Deno.exit(1);
}

const commit = await git(src, ["rev-parse", "HEAD"]);
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error(
    `${src} is not a git checkout, so its commit can't be recorded in VENDORED; nothing copied`,
  );
  Deno.exit(1);
}

for (const [up, local] of FILES) {
  const dest = join(REPO, local);
  await Deno.mkdir(join(dest, ".."), { recursive: true });
  await Deno.copyFile(join(src, up), dest);
}
let copiedPrograms = 0;
await Deno.mkdir(join(REPO, PROGRAMS_DIR), { recursive: true });
for await (const e of Deno.readDir(join(src, "programs", "builtin"))) {
  if (!e.isFile || !e.name.endsWith(".md")) continue;
  await Deno.copyFile(
    join(src, "programs", "builtin", e.name),
    join(REPO, PROGRAMS_DIR, e.name),
  );
  copiedPrograms++;
}
await recordCommit(src, commit);
console.log(
  `copied ${FILES.length} files + ${copiedPrograms} programs from ${src} at ${commit}, recorded in packages/liftoscript/VENDORED`,
);
if (!flag("patched")) {
  console.log("reapply local patches, then rerun with --patched to confirm:");
  for (const p of PATCHES) console.log(`  - ${p}`);
  Deno.exit(2);
}
console.log("local patches confirmed via --patched");
