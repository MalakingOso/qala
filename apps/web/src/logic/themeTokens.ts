// Shared reader for apps/web/src/theme/tokens.css. The WCAG contrast test and
// the Kotlin generator (scripts/tokens_to_kotlin.ts) both go through it, so
// the web and Android shells cannot disagree about what a token means.
//
// tokens.css has exactly two rule blocks: `:root` (light, every token) and
// `[data-theme=dark]` (overrides only). The parser fails loudly on anything
// else (an @media block, another selector, a stray declaration) instead of
// guessing, because a silently dropped block would ship wrong colours.
//
// Everything is pure: pass the CSS text in, get values out.

export type Rgb = [number, number, number];
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** One CSS box-shadow, reduced to what the Beamer look uses: a hard offset
 * (blur is always 0) and an optional zero-offset ring. */
export interface Shadow {
  dx: number;
  dy: number;
  color: Rgba;
  ringWidth: number;
  ringColor: Rgba | null;
}

const LIGHT_SELECTOR = ":root";
const DARK_SELECTOR = "[data-theme=dark]";

// -- parsing ---------------------------------------------------------------

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Custom properties of the single rule whose selector matches `selector`
 * (a regex source; the first match wins). Comments are ignored. */
export function blockVars(css: string, selector: string): Map<string, string> {
  const m = stripComments(css).match(
    new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "s"),
  );
  if (!m) throw new Error(`missing ${selector} block in tokens.css`);
  return declarations(m[1], selector);
}

function declarations(body: string, where: string): Map<string, string> {
  const vars = new Map<string, string>();
  const rest = body.replace(
    /--([\w-]+)\s*:\s*([^;]+);/g,
    (_all, name: string, value: string) => {
      if (vars.has(name)) throw new Error(`${where}: --${name} declared twice`);
      vars.set(name, value.trim());
      return "";
    },
  );
  if (rest.trim() !== "") {
    throw new Error(
      `${where}: unparsed text, only "--name: value;" is understood: ${
        JSON.stringify(rest.trim())
      }`,
    );
  }
  return vars;
}

export interface Themes {
  /** Every token, light values. */
  light: Map<string, string>;
  /** The `[data-theme=dark]` overrides alone. */
  darkOverrides: Map<string, string>;
  /** Light with the dark overrides applied: the full dark theme. */
  dark: Map<string, string>;
}

/** Reads both themes and enforces the structure the generator relies on. */
export function parseThemes(css: string): Themes {
  const text = stripComments(css);
  const rules = new Map<string, string>();
  const rest = text.replace(
    /([^{}]+)\{([^{}]*)\}/g,
    (_all, sel: string, body: string) => {
      const selector = sel.trim().replace(/\s+/g, " ");
      if (rules.has(selector)) throw new Error(`duplicate rule ${selector}`);
      rules.set(selector, body);
      return "";
    },
  );
  if (rest.trim() !== "") {
    throw new Error(
      `tokens.css has text outside its rule blocks: ${
        JSON.stringify(rest.trim().slice(0, 60))
      }`,
    );
  }
  const selectors = [...rules.keys()].sort();
  const want = [DARK_SELECTOR, LIGHT_SELECTOR].sort();
  if (selectors.join("|") !== want.join("|")) {
    throw new Error(
      `tokens.css must hold exactly ${LIGHT_SELECTOR} and ${DARK_SELECTOR}, found: ${
        selectors.join(", ")
      }`,
    );
  }
  const light = declarations(rules.get(LIGHT_SELECTOR)!, LIGHT_SELECTOR);
  const darkOverrides = declarations(rules.get(DARK_SELECTOR)!, DARK_SELECTOR);
  for (const name of darkOverrides.keys()) {
    if (!light.has(name)) {
      throw new Error(`--${name} is overridden in dark but absent from :root`);
    }
  }
  const dark = new Map(light);
  for (const [name, value] of darkOverrides) dark.set(name, value);
  return { light, darkOverrides, dark };
}

// -- colours and contrast --------------------------------------------------

export function hexRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance([r, g, b]: Rgb): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(hexRgb(a)), luminance(hexRgb(b))].sort((x, y) =>
    y - x
  );
  return (l1 + 0.05) / (l2 + 0.05);
}

/** `#rgb`, `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)`; alpha may start with a
 * dot (`.10`). Anything else throws. */
export function parseColor(value: string): Rgba {
  const v = value.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    const [r, g, b] = hexRgb(v);
    return { r, g, b, a: 1 };
  }
  const m = v.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/,
  );
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (r > 255 || g > 255 || b > 255 || a > 1) {
      throw new Error(`colour out of range: ${v}`);
    }
    return { r, g, b, a };
  }
  throw new Error(`not a colour this parser understands: ${v}`);
}

// -- lengths, motion, shadows ----------------------------------------------

/** `12px` or a bare `0`, as a number of CSS pixels (dp on Android). */
export function parsePx(value: string): number {
  const m = value.trim().match(/^(-?\d*\.?\d+)(px)?$/);
  if (!m || (m[2] === undefined && Number(m[1]) !== 0)) {
    throw new Error(`not a px length: ${value}`);
  }
  return Number(m[1]);
}

export function parseMs(value: string): number {
  const m = value.trim().match(/^(\d*\.?\d+)ms$/);
  if (!m) throw new Error(`not a duration in ms: ${value}`);
  return Number(m[1]);
}

export function parseCubicBezier(
  value: string,
): [number, number, number, number] {
  const m = value.trim().match(/^cubic-bezier\(([^)]*)\)$/);
  const nums = m ? m[1].split(",").map((s) => Number(s.trim())) : [];
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`not a cubic-bezier(a, b, c, d): ${value}`);
  }
  return nums as [number, number, number, number];
}

function splitTopLevel(s: string, isSep: (ch: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && isSep(ch)) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** Replaces `var(--name)` with that token's value in `vars`. */
export function resolveVars(value: string, vars: Map<string, string>): string {
  let out = value;
  for (let pass = 0; pass < 5 && out.includes("var("); pass++) {
    out = out.replace(/var\(\s*--([\w-]+)\s*\)/g, (_all, name: string) => {
      const hit = vars.get(name);
      if (hit === undefined) throw new Error(`var(--${name}) is not defined`);
      return hit;
    });
  }
  if (out.includes("var(")) throw new Error(`unresolved var() in: ${value}`);
  return out;
}

interface Layer {
  dx: number;
  dy: number;
  blur: number;
  spread: number;
  color: Rgba;
}

function parseLayer(layer: string): Layer {
  const toks = splitTopLevel(layer, (ch) => /\s/.test(ch));
  if (toks.includes("inset")) throw new Error(`inset shadow: ${layer}`);
  const color = toks.pop();
  if (color === undefined || toks.length < 2 || toks.length > 4) {
    throw new Error(`shadow layer wants 2 to 4 lengths and a colour: ${layer}`);
  }
  const [dx, dy, blur = 0, spread = 0] = toks.map(parsePx);
  return { dx, dy, blur, spread, color: parseColor(color) };
}

/** A `--shadow-*` value: one hard offset layer (zero blur, zero spread),
 * optionally followed by a ring (zero offset, zero blur, positive spread).
 * `var(--x)` references resolve against `vars`. Anything else throws. */
export function parseShadow(value: string, vars: Map<string, string>): Shadow {
  const layers = splitTopLevel(resolveVars(value, vars), (ch) => ch === ",")
    .map(parseLayer);
  if (layers.length < 1 || layers.length > 2) {
    throw new Error(
      `shadow wants an offset layer and at most one ring: ${value}`,
    );
  }
  const [off, ring] = layers;
  if (off.blur !== 0 || off.spread !== 0) {
    throw new Error(`offset layer must have zero blur and spread: ${value}`);
  }
  if (!ring) {
    return {
      dx: off.dx,
      dy: off.dy,
      color: off.color,
      ringWidth: 0,
      ringColor: null,
    };
  }
  if (ring.dx !== 0 || ring.dy !== 0 || ring.blur !== 0 || ring.spread <= 0) {
    throw new Error(`ring layer must be "0 0 0 <width> <colour>": ${value}`);
  }
  return {
    dx: off.dx,
    dy: off.dy,
    color: off.color,
    ringWidth: ring.spread,
    ringColor: ring.color,
  };
}

// -- Kotlin emit -----------------------------------------------------------

type Kind = "color" | "shadow" | "length" | "space" | "duration" | "ease";

function kindOf(name: string): Kind {
  if (name.startsWith("shadow-")) return "shadow";
  if (/^radius(-|$)/.test(name) || name === "border-width") return "length";
  if (/^space-\d+$/.test(name)) return "space";
  if (/^duration(-|$)/.test(name)) return "duration";
  if (name === "ease") return "ease";
  return "color";
}

export function camel(name: string): string {
  return name.replace(/-(\w)/g, (_all, c: string) => c.toUpperCase());
}

const hex2 = (n: number): string =>
  n.toString(16).toUpperCase().padStart(2, "0");

function kColor(c: Rgba): string {
  if (c.a === 1) return `Color(0xFF${hex2(c.r)}${hex2(c.g)}${hex2(c.b)})`;
  return `Color(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 255)})`;
}
const kDp = (n: number): string => `${n}.dp`;
const kFloat = (n: number): string => `${n}f`;

function kShadow(s: Shadow): string {
  return `QalaShadow(dx = ${kDp(s.dx)}, dy = ${kDp(s.dy)}, color = ${
    kColor(s.color)
  }, ringWidth = ${kDp(s.ringWidth)}, ringColor = ${
    s.ringColor ? kColor(s.ringColor) : "Color.Transparent"
  })`;
}

/** The text of `Tokens.kt` for the given tokens.css. */
export function emitTokensKotlin(css: string): string {
  const themes = parseThemes(css);
  const names = [...themes.light.keys()];
  const byKind = (kind: Kind): string[] =>
    names.filter((n) => kindOf(n) === kind);

  const colorNames = byKind("color");
  const shadowNames = byKind("shadow");
  const colorsOf = (vars: Map<string, string>): Map<string, Rgba> => {
    const out = new Map<string, Rgba>();
    for (const n of colorNames) {
      try {
        out.set(n, parseColor(vars.get(n)!));
      } catch (e) {
        throw new Error(`--${n}: ${(e as Error).message}`);
      }
    }
    return out;
  };

  const paletteBody = (vars: Map<string, string>): string => {
    const colors = colorsOf(vars);
    const lines = colorNames.map((n) =>
      `            ${camel(n)} = ${kColor(colors.get(n)!)},`
    );
    for (const n of shadowNames) {
      lines.push(
        `            ${camel(n)} = ${
          kShadow(parseShadow(vars.get(n)!, vars))
        },`,
      );
    }
    return lines.join("\n");
  };

  const fields = [
    ...colorNames.map((n) => `    val ${camel(n)}: Color,`),
    ...shadowNames.map((n) => `    val ${camel(n)}: QalaShadow,`),
  ].join("\n");

  const L = themes.light;
  const dp = (n: string): string =>
    `    val ${camel(n)}: Dp = ${kDp(parsePx(L.get(n)!))}`;
  const radii = byKind("length").filter((n) => n.startsWith("radius"));
  const borders = byKind("length").filter((n) => !n.startsWith("radius"));
  const durations = byKind("duration").map((n) =>
    `    const val ${camel(n)} = ${parseMs(L.get(n)!)}`
  );
  const ease = byKind("ease");
  if (ease.length !== 1) throw new Error("tokens.css needs exactly one --ease");
  const bez = parseCubicBezier(L.get(ease[0])!).map(kFloat).join(", ");

  return `// Generated by scripts/tokens_to_kotlin.ts from apps/web/src/theme/tokens.css. Do not edit; run \`deno task gen:android\`.

package com.qala.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * A Beamer shadow: a hard offset with no blur, plus an optional ring drawn
 * outside the box ([ringWidth] is 0.dp and [ringColor] transparent when there
 * is none). Elevation and blur are never used.
 */
@Immutable
data class QalaShadow(
    val dx: Dp,
    val dy: Dp,
    val color: Color,
    val ringWidth: Dp,
    val ringColor: Color,
)

/** Every colour and shadow token of tokens.css for one theme. Dark is light with the dark overrides applied. */
@Immutable
data class QalaPalette(
${fields}
) {
    companion object {
        val Light = QalaPalette(
${paletteBody(themes.light)}
        )

        val Dark = QalaPalette(
${paletteBody(themes.dark)}
        )
    }
}

/** Theme-independent shape, spacing and motion tokens. Durations are milliseconds. */
object QalaTokens {
${radii.map(dp).join("\n")}
${borders.map(dp).join("\n")}
${byKind("space").map(dp).join("\n")}
${durations.join("\n")}
    val ease: Easing = CubicBezierEasing(${bez})
}
`;
}
