// Generate the Android design tokens from the web ones (docs/android-native.md
// section 4): one source of truth, apps/web/src/theme/tokens.css.
//
//   deno task gen:android                                        # this script plus lucide_to_kotlin.ts
//   deno run --allow-all scripts/tokens_to_kotlin.ts             # write Tokens.kt
//   deno run --allow-all scripts/tokens_to_kotlin.ts --check     # exit 1 if Tokens.kt is stale
//   deno run --allow-all scripts/tokens_to_kotlin.ts --out FILE  # write somewhere else
//
// The parser and the Kotlin emit function live in
// apps/web/src/logic/themeTokens.ts so the contrast test and the staleness
// test (tokensKotlin.test.ts) import the same code. This file only reads and
// writes.

import { emitTokensKotlin } from "../apps/web/src/logic/themeTokens.ts";

const CSS = new URL("../apps/web/src/theme/tokens.css", import.meta.url);
const DEFAULT_OUT = new URL(
  "../apps/android/design/src/main/kotlin/com/qala/design/Tokens.kt",
  import.meta.url,
).pathname;

function arg(name: string, def?: string): string | undefined {
  const i = Deno.args.findIndex((a) => a === `--${name}`);
  if (i >= 0) return Deno.args[i + 1] ?? def;
  const kv = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const flag = (name: string): boolean => Deno.args.includes(`--${name}`);

const out = arg("out", DEFAULT_OUT) ?? DEFAULT_OUT;
const kotlin = emitTokensKotlin(await Deno.readTextFile(CSS));

if (flag("check")) {
  let current = "";
  try {
    current = await Deno.readTextFile(out);
  } catch {
    // a missing file is stale
  }
  if (current !== kotlin) {
    console.error(
      `tokens check: ${out} is stale; run \`deno task gen:android\``,
    );
    Deno.exit(1);
  }
  console.log("tokens check: Tokens.kt matches tokens.css");
  Deno.exit(0);
}

await Deno.mkdir(new URL(".", `file://${out}`).pathname, { recursive: true });
await Deno.writeTextFile(out, kotlin);
console.log(`wrote ${out}`);
