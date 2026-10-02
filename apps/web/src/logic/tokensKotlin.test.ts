// The Android tokens are generated from tokens.css (scripts/tokens_to_kotlin.ts).
// This is the gate behind "contrast passes on generated tokens": the contrast
// test checks the CSS the generator reads, and this test fails when the
// checked-in Tokens.kt no longer matches it. Fix with `deno task gen:android`.

import {
  emitTokensKotlin,
  parseColor,
  parseCubicBezier,
  parseShadow,
  parseThemes,
} from "./themeTokens.ts";

const CSS_URL = new URL("../theme/tokens.css", import.meta.url);
const KT_URL = new URL(
  "../../../android/design/src/main/kotlin/com/qala/design/Tokens.kt",
  import.meta.url,
);

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("Tokens.kt is up to date with tokens.css", async () => {
  const css = await Deno.readTextFile(CSS_URL);
  const fresh = emitTokensKotlin(css);
  let current = "";
  try {
    current = await Deno.readTextFile(KT_URL);
  } catch {
    // reported below
  }
  assert(current === fresh, "Tokens.kt is stale; run `deno task gen:android`");
});

Deno.test("both themes carry the same tokens and the dark merge is complete", async () => {
  const { light, dark, darkOverrides } = parseThemes(
    await Deno.readTextFile(CSS_URL),
  );
  assert(light.size > 0 && darkOverrides.size > 0, "empty theme block");
  assert(
    [...light.keys()].join() === [...dark.keys()].join(),
    "dark lost a token",
  );
  assert(dark.get("bg") !== light.get("bg"), "dark did not override --bg");
  // a token dark leaves alone keeps its light value
  assert(
    dark.get("radius") === light.get("radius"),
    "radius should not differ",
  );
});

Deno.test("colour parsing accepts hex, rgba and a leading-dot alpha", () => {
  assert(parseColor("#fff").r === 255, "short hex");
  const c = parseColor("rgba(15,21,42,.10)");
  assert(c.r === 15 && c.b === 42 && Math.abs(c.a - 0.1) < 1e-9, "rgba .10");
  let threw = false;
  try {
    parseColor("hsl(10 20% 30%)");
  } catch {
    threw = true;
  }
  assert(threw, "hsl must be rejected, not guessed");
});

Deno.test("shadows parse into an offset and an optional ring", async () => {
  const { light, dark } = parseThemes(await Deno.readTextFile(CSS_URL));
  const card = parseShadow(light.get("shadow-card")!, light);
  assert(card.dx === 2 && card.dy === 4 && card.ringColor === null, "card");
  const cta = parseShadow(light.get("shadow-cta")!, light);
  assert(cta.ringWidth === 1 && cta.ringColor !== null, "cta ring");
  // var(--border) in the modal ring resolves per theme
  const modalLight = parseShadow(light.get("shadow-modal")!, light);
  const modalDark = parseShadow(dark.get("shadow-modal")!, dark);
  assert(modalLight.ringWidth === 2 && modalDark.ringWidth === 2, "modal ring");
  assert(
    modalLight.ringColor!.r === 15,
    "light modal ring uses the light border",
  );
  assert(
    modalDark.ringColor!.r === 232,
    "dark modal ring uses the dark border",
  );
  let threw = false;
  try {
    parseShadow("0 2px 8px 0 rgba(0,0,0,.2)", light);
  } catch {
    threw = true;
  }
  assert(threw, "a blurred shadow must be rejected");
});

Deno.test("cubic-bezier parses to four numbers", () => {
  const b = parseCubicBezier("cubic-bezier(0.25, 1, 0.5, 1)");
  assert(b.join() === "0.25,1,0.5,1", "bezier");
});
