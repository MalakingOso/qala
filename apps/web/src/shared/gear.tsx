/* The owner's equipment, rendered in Blender (`assets/3d/build_gear.py`,
 * packed by `pack_gear.py` into `public/gear/` and `gearSprites.json`): the
 * foam roller, the Theragun and the treadmill, shown where the app names
 * them. Each is a transparent WebP lit once, so it sits on either theme. */

import sprites from "./gearSprites.json" with { type: "json" };

export type GearName = keyof typeof sprites;

const BASE = `${import.meta.env.BASE_URL}gear/`;

/** Which render stands for each key of `settings.equipment`; the bike and the
 * rower have none yet. */
export const GEAR_FOR: Partial<Record<string, GearName>> = {
  foamRoller: "roller",
  percussion: "theragun",
  treadmill: "treadmill",
};

/** A render scaled to fit inside `w` by `h` CSS pixels, keeping its shape. */
export function GearImage(
  { name, w, h }: { name: GearName; w: number; h: number },
) {
  const s = sprites[name];
  const k = Math.min(w / s.w, h / s.h);
  return (
    <img
      className="gear-img"
      src={BASE + s.file}
      alt=""
      draggable={false}
      width={Math.round(s.w * k)}
      height={Math.round(s.h * k)}
    />
  );
}

/** A fixed-size slot for a render, so rows line up whether or not the item has one. */
export function GearSlot({ name }: { name?: GearName }) {
  return (
    <span className="gear-slot" aria-hidden="true">
      {name ? <GearImage name={name} w={64} h={44} /> : null}
    </span>
  );
}
