// PLAN.md section 14, look gate: every text/background token pair in
// tokens.css must meet WCAG contrast (4.5 for text; current tokens all
// qualify as text, so large-figure 3.0 needs no separate allowance).
// --fg-faint is decorative-only by design and is excluded by name.

import { assert } from "@std/assert";

const CSS_URL = new URL("../theme/tokens.css", import.meta.url);

function blockVars(css: string, selector: string): Map<string, string> {
  const m = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "s"));
  if (!m) throw new Error(`missing ${selector} block in tokens.css`);
  const vars = new Map<string, string>();
  for (const hit of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(hit[1], hit[2].trim());
  }
  return vars;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(hexRgb(a)), luminance(hexRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

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
  const themes: Record<string, Map<string, string>> = {
    light: blockVars(css, ":root"),
    dark: blockVars(css, String.raw`\[data-theme=dark\]`),
  };
  const failures: string[] = [];
  for (const [theme, text, bgName] of PAIRS) {
    const vars = themes[theme];
    const t = vars.get(text);
    const b = vars.get(bgName);
    if (!t || !b) {
      failures.push(`${theme}: --${text} or --${bgName} missing from tokens.css`);
      continue;
    }
    if (!HEX.test(t) || !HEX.test(b)) {
      failures.push(`${theme}: --${text}=${t} / --${bgName}=${b} not opaque hex, add an opaque check`);
      continue;
    }
    const r = ratio(t, b);
    if (r < 4.5) failures.push(`${theme}: --${text} on --${bgName} = ${r.toFixed(2)} (< 4.5)`);
  }
  if (failures.length > 0) throw new Error(`contrast failures:\n${failures.join("\n")}`);
});
