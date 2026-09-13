// Shared helpers for the liftoscript package tests.
//
// Run with read access to the seed programs and env access for the Lezer
// runtime (`process.env.LOG` is read at module load):
//   deno test --allow-read --allow-env packages/liftoscript/
import { assert } from "@std/assert";

export function builtinDir(): string {
  return new URL("../programs/builtin/", import.meta.url).pathname;
}

/** Extract the planner source from a builtin program's ```liftoscript block. */
export function loadBuiltinProgram(name: string): string {
  const text = Deno.readTextFileSync(`${builtinDir()}${name}`);
  const match = text.match(/```liftoscript\n([\s\S]*?)```/);
  assert(match, `${name} has a liftoscript block`);
  return match[1];
}

export function builtinProgramNames(): string[] {
  const names: string[] = [];
  for (const entry of Deno.readDirSync(builtinDir())) {
    if (entry.name.endsWith(".md")) {
      names.push(entry.name);
    }
  }
  return names.sort();
}
