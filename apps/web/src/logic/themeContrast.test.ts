// PLAN.md section 14, look gate: every text/background token pair in
// tokens.css must meet WCAG contrast (4.5 for text; current tokens all
// qualify as text, so large-figure 3.0 needs no separate allowance).
// --fg-faint is decorative-only by design and is excluded by name.

import { parseThemes, ratio } from "./themeTokens.ts";

const CSS_URL = new URL("../theme/tokens.css", import.meta.url);

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// [theme, text token, background token]
const PAIRS: Array<[string, string, string]> = [
  ["light", "fg", "bg"],
  ["light", "fg-secondary", "bg"],
  ["light", "fg-muted", "bg"],
  ["light", "fg", "bg-surface"],
  ["light", "fg-secondary", "bg-surface"],
  ["light", "fg-muted", "bg-surface"],
  ["light", "accent", "bg"],
  ["light", "accent", "bg-surface"],
  ["light", "danger", "bg"],
  ["light", "success", "bg"],
  ["light", "note-ink", "note"],
  ["light", "on-accent", "accent"],
  ["dark", "fg", "bg"],
  ["dark", "fg-secondary", "bg"],
  ["dark", "fg-muted", "bg"],
  ["dark", "fg", "bg-surface"],
  ["dark", "fg-secondary", "bg-surface"],
  ["dark", "fg-muted", "bg-surface"],
  ["dark", "accent", "bg"],
  ["dark", "accent", "bg-surface"],
  ["dark", "danger", "bg"],
  ["dark", "success", "bg"],
  ["dark", "note-ink", "note"],
  ["dark", "on-accent", "accent"],
];

Deno.test("theme text/background pairs meet WCAG 4.5", async () => {
  const css = await Deno.readTextFile(CSS_URL);
  // dark is light with the dark overrides applied, as the apps see it
  const { light, dark } = parseThemes(css);
  const themes: Record<string, Map<string, string>> = { light, dark };
  const failures: string[] = [];
  for (const [theme, text, bgName] of PAIRS) {
    const vars = themes[theme];
    const t = vars.get(text);
    const b = vars.get(bgName);
    if (!t || !b) {
      failures.push(
        `${theme}: --${text} or --${bgName} missing from tokens.css`,
      );
      continue;
    }
    if (!HEX.test(t) || !HEX.test(b)) {
      failures.push(
        `${theme}: --${text}=${t} / --${bgName}=${b} not opaque hex, add an opaque check`,
      );
      continue;
    }
    const r = ratio(t, b);
    if (r < 4.5) {
      failures.push(
        `${theme}: --${text} on --${bgName} = ${r.toFixed(2)} (< 4.5)`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`contrast failures:\n${failures.join("\n")}`);
  }
});
