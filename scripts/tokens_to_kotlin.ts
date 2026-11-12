// Generate the Android design tokens from the web ones (docs/android-native.md
// section 4): one source of truth, apps/web/src/theme/tokens.css.
//
//   bun run gen:android                                        # this script plus lucide_to_kotlin.ts
//   bun scripts/tokens_to_kotlin.ts             # write Tokens.kt
//   bun scripts/tokens_to_kotlin.ts --check     # exit 1 if Tokens.kt is stale
//   bun scripts/tokens_to_kotlin.ts --out FILE  # write somewhere else
//
// The parser and the Kotlin emit function live in
// apps/web/src/logic/themeTokens.ts so the contrast test and the staleness
// test (tokensKotlin.test.ts) import the same code. This file only reads and
// writes.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { emitTokensKotlin } from "../apps/web/src/logic/themeTokens.ts";

const CSS = new URL("../apps/web/src/theme/tokens.css", import.meta.url);
const DEFAULT_OUT = new URL(
  "../apps/android/design/src/main/kotlin/com/qala/design/Tokens.kt",
  import.meta.url,
).pathname;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.slice(2).findIndex((a) => a === `--${name}`);
  if (i >= 0) return process.argv.slice(2)[i + 1] ?? def;
  const kv = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const flag = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);

const out = arg("out", DEFAULT_OUT) ?? DEFAULT_OUT;
const kotlin = emitTokensKotlin(await readFile(CSS, "utf8"));

if (flag("check")) {
  let current = "";
  try {
    current = await readFile(out, "utf8");
  } catch {
    // a missing file is stale
  }
  if (current !== kotlin) {
    console.error(
      `tokens check: ${out} is stale; run \`bun run gen:android\``,
    );
    process.exit(1);
  }
  console.log("tokens check: Tokens.kt matches tokens.css");
  process.exit(0);
}

await mkdir(new URL(".", `file://${out}`).pathname, { recursive: true });
await writeFile(out, kotlin);
console.log(`wrote ${out}`);
