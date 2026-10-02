// Generate the Android icon set from Lucide (docs/android-native.md section 4).
// The icons are the ones DESIGN.md section 4 lists, as 24 dp ImageVectors.
//
//   deno task gen:android                                         # this script plus tokens_to_kotlin.ts
//   deno run --allow-all scripts/lucide_to_kotlin.ts              # write Icons.kt
//   deno run --allow-all scripts/lucide_to_kotlin.ts --check      # exit 1 if Icons.kt is stale
//   deno run --allow-all scripts/lucide_to_kotlin.ts --out FILE   # write somewhere else
//
// Needs `npm install` in apps/web first: the paths come from
// apps/web/node_modules/lucide-react/dist/esm/icons/*.mjs. Those files are
// read as text and never imported (they pull React). Each one holds an
// `__iconData = { name, node: [[tag, attrs], ...], aliases }` literal; this
// script slices that literal out and evaluates it with `new Function`.
// Alias files (`history` re-exports `rotate-ccw-clock`) are followed.
//
// Compose's PathParser reads path data only, so circle, rect (with rx and
// ry), line, polyline, polygon and ellipse are turned into path `d` strings
// here, and every `d` is rewritten with explicit commands and spaced arc
// flags so no parser has to guess at compact SVG syntax. Colour is left to
// the caller: the vectors stroke black at width 2 with round caps and joins,
// and a tint recolours them.
//
// Licences: Lucide is ISC; the icons Lucide inherited from Feather are MIT.
// Both texts ship under apps/android/app/src/main/assets/licenses/. The
// Feather-derived icons among ours are listed in the generated header, read
// from lucide-react's own LICENSE.

const LUCIDE = new URL(
  "../apps/web/node_modules/lucide-react/",
  import.meta.url,
).pathname;
const DEFAULT_OUT = new URL(
  "../apps/android/design/src/main/kotlin/com/qala/design/Icons.kt",
  import.meta.url,
).pathname;

// DESIGN.md section 4, in table order, repeats dropped. `table-2` (the week
// strip's table view) is not listed there and waits for the stats screens.
export const ICONS = [
  "sun",
  "calendar-range",
  "activity",
  "trending-up",
  "message-square-text",
  "history",
  "settings",
  "chevron-left",
  "chevron-down",
  "ellipsis-vertical",
  "dumbbell",
  "sport-shoe",
  "bed",
  "circle-check",
  "flame",
  "hourglass",
  "moon",
  "info",
  "arrow-left-right",
  "sticky-note",
  "pin",
  "check",
  "layout-grid",
  "calculator",
  "minus",
  "plus",
  "triangle-alert",
  "bike",
  "play",
  "pause",
  "route",
  "signal-high",
  "volume-2",
  "zap",
  "heart-pulse",
  "mountain",
  "timer",
  "gauge",
  "list-checks",
  "clock",
  "x",
];

type Attrs = Record<string, string | number>;
type Node = [string, Attrs];
interface IconData {
  name: string;
  size: number;
  node: Node[];
  aliases?: string[];
}

// -- reading the Lucide sources ---------------------------------------------

/** From `src[start]` (an opening { or [) to its matching close, skipping strings. */
function sliceBalanced(src: string, start: number): string {
  const open = src[start];
  const close = open === "{" ? "}" : "]";
  if (open !== "{" && open !== "[") throw new Error("not a literal start");
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) {
        if (src[i] === "\\") i++;
      }
    } else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced literal");
}

export async function readIcon(
  name: string,
  seen = new Set<string>(),
): Promise<IconData> {
  if (seen.has(name)) throw new Error(`alias loop at ${name}`);
  seen.add(name);
  const file = `${LUCIDE}dist/esm/icons/${name}.mjs`;
  let src: string;
  try {
    src = await Deno.readTextFile(file);
  } catch {
    throw new Error(
      `lucide icon "${name}" not found at ${file}; run \`npm install\` in apps/web`,
    );
  }
  const alias = src.match(
    /export\s*\{\s*default\s*\}\s*from\s*['"]\.\/([\w-]+)\.mjs['"]/,
  );
  if (alias) return readIcon(alias[1], seen);
  const at = src.indexOf("__iconData = ");
  if (at < 0) throw new Error(`${file}: no __iconData literal`);
  const literal = sliceBalanced(src, src.indexOf("{", at));
  const data = new Function(`return (${literal});`)() as IconData;
  if (data.size !== 24 || !Array.isArray(data.node)) {
    throw new Error(`${file}: unexpected icon data (size ${data.size})`);
  }
  return data;
}

/** The icon names the Feather project originally drew, from lucide-react's LICENSE. */
async function featherNames(): Promise<Set<string>> {
  const text = await Deno.readTextFile(`${LUCIDE}LICENSE`);
  const m = text.match(
    /derived from the Feather project:\s*([\s\S]*?)\n\s*\nThe MIT License/,
  );
  if (!m) throw new Error("lucide-react LICENSE: Feather list not found");
  return new Set(m[1].split(",").map((s) => s.trim()).filter(Boolean));
}

// -- shapes to path data -----------------------------------------------------

function num(attrs: Attrs, key: string, def?: number): number {
  const raw = attrs[key];
  if (raw === undefined) {
    if (def === undefined) throw new Error(`missing attribute ${key}`);
    return def;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`bad ${key}="${raw}"`);
  return n;
}

const fmt = (n: number): string => String(Math.round(n * 10000) / 10000);

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${fmt(cx - rx)} ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${
    fmt(cx + rx)
  } ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`;
}

function rectPath(a: Attrs): string {
  const x = num(a, "x", 0), y = num(a, "y", 0);
  const w = num(a, "width"), h = num(a, "height");
  let rx = a.rx === undefined ? undefined : num(a, "rx");
  let ry = a.ry === undefined ? undefined : num(a, "ry");
  rx ??= ry ?? 0;
  ry ??= rx;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (rx === 0 || ry === 0) {
    return `M ${fmt(x)} ${fmt(y)} H ${fmt(x + w)} V ${fmt(y + h)} H ${
      fmt(x)
    } Z`;
  }
  const arc = (ex: number, ey: number) =>
    `A ${fmt(rx!)} ${fmt(ry!)} 0 0 1 ${fmt(ex)} ${fmt(ey)}`;
  return [
    `M ${fmt(x + rx)} ${fmt(y)}`,
    `H ${fmt(x + w - rx)}`,
    arc(x + w, y + ry),
    `V ${fmt(y + h - ry)}`,
    arc(x + w - rx, y + h),
    `H ${fmt(x + rx)}`,
    arc(x, y + h - ry),
    `V ${fmt(y + ry)}`,
    arc(x + rx, y),
    "Z",
  ].join(" ");
}

function pointsPath(a: Attrs, close: boolean): string {
  const nums = String(a.points ?? "").trim().split(/[\s,]+/).map(Number);
  if (
    nums.length < 4 || nums.length % 2 || nums.some((n) => !Number.isFinite(n))
  ) {
    throw new Error(`bad points="${a.points}"`);
  }
  const pts: string[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    pts.push(`${i === 0 ? "M" : "L"} ${fmt(nums[i])} ${fmt(nums[i + 1])}`);
  }
  return pts.join(" ") + (close ? " Z" : "");
}

const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Rewrites path data with one explicit command per parameter group, spaces
 * between every number, and arc flags as separate 0 or 1 tokens. */
export function normalizePath(d: string): string {
  const out: string[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  skip();
  while (i < d.length) {
    const cmd = d[i++];
    const arity = ARITY[cmd.toUpperCase()];
    if (arity === undefined) {
      throw new Error(`bad path command "${cmd}" in: ${d}`);
    }
    if (arity === 0) {
      out.push("Z");
      skip();
      continue;
    }
    let first = true;
    for (;;) {
      skip();
      if (i >= d.length || /[a-zA-Z]/.test(d[i])) {
        if (first) throw new Error(`"${cmd}" without parameters in: ${d}`);
        break;
      }
      const args: string[] = [];
      for (let k = 0; k < arity; k++) {
        skip();
        if (cmd.toUpperCase() === "A" && (k === 3 || k === 4)) {
          if (d[i] !== "0" && d[i] !== "1") {
            throw new Error(`bad arc flag in: ${d}`);
          }
          args.push(d[i++]);
        } else {
          const m = d.slice(i).match(NUMBER);
          if (!m) throw new Error(`bad number at ${i} in: ${d}`);
          args.push(m[0]);
          i += m[0].length;
        }
      }
      // extra parameter groups repeat the command, except M and m, which repeat as L and l
      const letter = first ? cmd : cmd === "M" ? "L" : cmd === "m" ? "l" : cmd;
      out.push(`${letter} ${args.join(" ")}`);
      first = false;
    }
  }
  return out.join(" ");
}

/** One Lucide node as path data. */
export function nodePath([tag, a]: Node): string {
  switch (tag) {
    case "path":
      return normalizePath(String(a.d));
    case "circle":
      return ellipsePath(
        num(a, "cx", 0),
        num(a, "cy", 0),
        num(a, "r"),
        num(a, "r"),
      );
    case "ellipse":
      return ellipsePath(
        num(a, "cx", 0),
        num(a, "cy", 0),
        num(a, "rx"),
        num(a, "ry"),
      );
    case "rect":
      return rectPath(a);
    case "line":
      return `M ${fmt(num(a, "x1", 0))} ${fmt(num(a, "y1", 0))} L ${
        fmt(num(a, "x2", 0))
      } ${fmt(num(a, "y2", 0))}`;
    case "polyline":
      return pointsPath(a, false);
    case "polygon":
      return pointsPath(a, true);
    default:
      throw new Error(`unsupported svg element <${tag}>`);
  }
}

// -- Kotlin emit -------------------------------------------------------------

const pascal = (name: string): string =>
  name.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("");

const kString = (s: string): string =>
  `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;

export async function emitIconsKotlin(): Promise<string> {
  const feather = await featherNames();
  const fromFeather: string[] = [];
  const members: string[] = [];
  for (const name of ICONS) {
    const data = await readIcon(name);
    const names = [name, data.name, ...(data.aliases ?? [])];
    if (names.some((n) => feather.has(n))) fromFeather.push(name);
    const paths = data.node.map(nodePath).map((d) =>
      `            ${kString(d)},`
    );
    members.push(
      `    /** Lucide \`${name}\`. */
    val ${pascal(name)}: ImageVector by lazy {
        qalaIcon(
            ${kString(name)},
${paths.join("\n")}
        )
    }`,
    );
  }
  if (new Set(ICONS).size !== ICONS.length) {
    throw new Error("duplicate icon in ICONS");
  }
  return `// Generated by scripts/lucide_to_kotlin.ts from lucide-react. Do not edit; run \`deno task gen:android\`.
// Lucide is ISC licensed. ${fromFeather.length} of these icons are derived from Feather (MIT): ${
    fromFeather.join(", ")
  }.
// Both licence texts are in app/src/main/assets/licenses/.

package com.qala.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** A 24 dp Lucide icon: stroke 2, round caps and joins, no fill. The stroke is black; tint it. */
private fun qalaIcon(name: String, vararg paths: String): ImageVector =
    ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        for (d in paths) {
            addPath(
                pathData = PathParser().parsePathString(d).toNodes(),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()

/** The icons DESIGN.md section 4 lists. Built on first use. */
object QalaIcons {
${members.join("\n\n")}
}
`;
}

// -- CLI ---------------------------------------------------------------------

function arg(name: string, def?: string): string | undefined {
  const i = Deno.args.findIndex((a) => a === `--${name}`);
  if (i >= 0) return Deno.args[i + 1] ?? def;
  const kv = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const flag = (name: string): boolean => Deno.args.includes(`--${name}`);

if (import.meta.main) {
  const out = arg("out", DEFAULT_OUT) ?? DEFAULT_OUT;
  let kotlin: string;
  try {
    kotlin = await emitIconsKotlin();
  } catch (e) {
    console.error(`lucide_to_kotlin: ${(e as Error).message}`);
    Deno.exit(1);
  }
  if (flag("check")) {
    let current = "";
    try {
      current = await Deno.readTextFile(out);
    } catch {
      // a missing file is stale
    }
    if (current !== kotlin) {
      console.error(
        `icons check: ${out} is stale; run \`deno task gen:android\``,
      );
      Deno.exit(1);
    }
    console.log(
      `icons check: Icons.kt matches lucide-react (${ICONS.length} icons)`,
    );
    Deno.exit(0);
  }
  await Deno.mkdir(new URL(".", `file://${out}`).pathname, { recursive: true });
  await Deno.writeTextFile(out, kotlin);
  console.log(`wrote ${ICONS.length} icons to ${out}`);
}
