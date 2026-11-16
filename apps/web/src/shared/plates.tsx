/* Plates (DESIGN 5.8, PLAN 6.8), shown with sprites rendered in Blender
 * (`assets/3d/build_sprites.py`, packed by `pack_sprites.py` into
 * `public/plates/` and `plateSprites.json`): real geometry, lit once, so the
 * raised lettering, the recessed groove and the polished sleeve are the
 * product of actual 3D rendering rather than drawn shapes.
 *
 * One orthographic camera made every sprite, so a part is placed on the bar by
 * translating it along the bar's axis on screen. `u` is inches along the bar
 * from the collar's face toward the viewer; a sprite's `ox, oy` is the point on
 * its image that sits on the axis at `u`. A polished tube lit evenly looks the
 * same all along its length, so the sleeve and the knurled shaft are repeated
 * strips, and the sleeve is shortened so the plates stay large. Colors come
 * from the inventory (`settings.plates`): each plate is rendered in every named
 * color. */

import {
  bumperColorFor,
  type PlateEntry,
} from "../../../../packages/core/plates.ts";
import meta from "./plateSprites.json" with { type: "json" };

interface Sprite {
  file: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

const SPRITES = meta.sprites as Record<string, Sprite>;
const BASE = `${import.meta.env.BASE_URL}plates/`;

/** Thickness in inches (what the renders used). */
const THICK: Record<string, number> = {
  "55": 3.3,
  "45": 2.9,
  "35": 2.3,
  "25": 1.67,
  "10": 0.94,
  "5": 0.75,
  "2.5": 0.6,
  "1.25": 0.5,
};
const DIAMETER: Record<string, number> = {
  "55": 17.7,
  "45": 17.7,
  "35": 17.7,
  "25": 17.7,
  "10": 17.7,
  "5": 9,
  "2.5": 6.5,
  "1.25": 5,
};
const RENDERED = Object.keys(THICK).map(Number).sort((a, b) => a - b);
const COLORS = [
  "red",
  "blue",
  "yellow",
  "green",
  "white",
  "charcoal",
  "silver",
];

/** The plate size to draw for a weight: itself, or the nearest rendered one. */
function sizeKey(weight: number): string {
  if (THICK[String(weight)] !== undefined) return String(weight);
  const near = RENDERED.reduce((a, b) =>
    Math.abs(b - weight) < Math.abs(a - weight) ? b : a
  );
  return String(near);
}

/** Named color for a weight: the inventory's, else the bumper default. */
function colorName(weight: number, inventory?: PlateEntry[]): string {
  const named = inventory?.find((p) => p.weight === weight)?.color ??
    bumperColorFor(weight, "lb");
  if (COLORS.includes(named)) return named;
  if (named === "black") return "charcoal";
  if (named === "gray") return "silver";
  return "charcoal";
}

/** The sprite for a plate, in its color if rendered, else the nearest. */
function plateSprite(
  prefix: "plate" | "face",
  weight: number,
  inventory?: PlateEntry[],
): Sprite | undefined {
  const k = sizeKey(weight);
  const want = colorName(weight, inventory);
  for (const c of [want, "charcoal", "silver", "blue"]) {
    const s = SPRITES[`${prefix}_${k}_${c}`];
    if (s) return s;
  }
  return undefined;
}

function fmt(n: number) {
  return String(Math.round(n * 100) / 100);
}

/** Small plates for lists and shorthand, from the nearly face-on renders.
 *
 * - `stack` (default): the plates for one side, each in front of the last, in
 *   their real relative sizes, with the weight printed on the outermost one.
 * - `row`: separate plates side by side, all the same size, each numbered, for
 *   listing different plates (settings).
 * - `single`: one plate at the same size whatever its weight, no number, for a
 *   row that already says the weight in words (inventory). */
export function PlateChips(
  { plates, inventory, mode = "stack", size }: {
    plates: number[];
    inventory?: PlateEntry[];
    mode?: "stack" | "row" | "single";
    /** css px height of a full-size plate */
    size?: number;
  },
) {
  if (plates.length === 0) return <span className="kbd-hint">bar only</span>;
  const uniform = mode !== "stack";
  const BIG = size ?? (mode === "row" ? 30 : mode === "single" ? 38 : 38);
  const ppi = meta.face_px_per_in ?? 10.1;
  const kFull = BIG / (17.7 * ppi);
  let x = 0;
  const prev: number[] = []; // widths of the plates already placed
  const items = plates.map((w, i) => {
    const sp = plateSprite("face", w, inventory);
    const d = DIAMETER[sizeKey(w)] ?? 17.7;
    // stacked plates keep their real relative sizes; listed ones are all the same
    const k = uniform && sp ? BIG / sp.h : kFull;
    const wpx = sp ? sp.w * k : 0;
    if (i > 0) {
      x += uniform ? prev[i - 1] + 5 : d < 17
        // a small iron plate sits out beyond the bumpers, clear of them, so
        // it reads as a plate and not as a hole in the one behind
        ? Math.max(8, prev[i - 1] * 0.78)
        : plates[i - 1] === w
        ? 8 // a pair pressed together
        : Math.max(
          8,
          (THICK[sizeKey(plates[i - 1])] * 0.8 * 2 + (d / 17.7) * 7) * 0.9,
        );
    }
    const item = {
      w,
      sp,
      k,
      x,
      wpx,
      small: d < 17,
      ink: ["white", "silver"].includes(colorName(w, inventory))
        ? "#0f152a"
        : "#fff",
    };
    prev[i] = wpx;
    return item;
  });
  const width = Math.max(...items.map((it) => it.x + it.wpx));
  const H = BIG + 4;
  const LABEL = mode === "row" ? 12 : 0; // weights go under listed plates
  // Stacked plates print the weight on the outermost one, if it is a bumper
  // (a small iron plate has no room beside its hub).
  // No numbers on a stack: the weights are always written beside or under it.
  const numbered = (_i: number) => false;
  return (
    <span
      className="plate-discs"
      role="img"
      aria-label={`Per side ${plates.map(fmt).join(", ")}`}
      style={{ width, height: H + LABEL }}
    >
      {items.map((it, i) =>
        it.sp
          ? (
            <span
              key={i}
              style={{
                position: "absolute",
                left: it.x,
                top: H / 2 - it.sp.oy * it.k,
                width: it.sp.w * it.k,
                height: it.sp.h * it.k,
                zIndex: i,
              }}
            >
              <img
                src={BASE + it.sp.file}
                alt=""
                draggable={false}
                width={it.sp.w * it.k}
                height={it.sp.h * it.k}
                style={{ display: "block", maxWidth: "none" }}
              />
              {mode === "row"
                ? (
                  <span
                    className="plate-under"
                    style={{
                      left: "50%",
                      top: it.sp.h * it.k + 1,
                      zIndex: 1,
                      color: "var(--fg-secondary)",
                    }}
                  >
                    {fmt(it.w)}
                  </span>
                )
                : null}
              {numbered(i)
                ? (
                  <span
                    className="chip-num"
                    style={{
                      color: it.ink,
                      left: "25%",
                      top: "50%",
                      fontSize: Math.max(7, BIG * 0.22),
                    }}
                  >
                    {fmt(it.w)}
                  </span>
                )
                : null}
            </span>
          )
          : null
      )}
    </span>
  );
}
