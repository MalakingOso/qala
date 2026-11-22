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

/** The weights that have a render. */
const RENDERED = [1.25, 2.5, 5, 10, 25, 35, 45, 55];
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
  if (RENDERED.includes(weight)) return String(weight);
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
  weight: number,
  inventory?: PlateEntry[],
): Sprite | undefined {
  const k = sizeKey(weight);
  const want = colorName(weight, inventory);
  for (const c of [want, "charcoal", "silver", "blue"]) {
    const s = SPRITES[`face_${k}_${c}`];
    if (s) return s;
  }
  return undefined;
}

function fmt(n: number) {
  return String(Math.round(n * 100) / 100);
}

/** Small plates for a list, from the nearly face-on renders: separate plates
 * side by side, all the same size, each with its weight under it (settings). */
export function PlateChips(
  { plates, inventory, size = 30 }: {
    plates: number[];
    inventory?: PlateEntry[];
    /** css px height of a plate */
    size?: number;
  },
) {
  if (plates.length === 0) return <span className="kbd-hint">bar only</span>;
  let x = 0;
  let prev = 0; // width of the plate before
  const items = plates.map((w, i) => {
    const sp = plateSprite(w, inventory);
    const k = sp ? size / sp.h : 0;
    if (i > 0) x += prev + 5;
    prev = sp ? sp.w * k : 0;
    return { w, sp, k, x, wpx: prev };
  });
  const width = Math.max(...items.map((it) => it.x + it.wpx));
  const H = size + 4;
  const LABEL = 12; // weights go under the plates
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
            </span>
          )
          : null
      )}
    </span>
  );
}
