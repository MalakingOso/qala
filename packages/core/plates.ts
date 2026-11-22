/** The plate entry type and the bumper color table. The plate math itself is
 * in `crates/qala-core/src/plates.rs`. */

export type PlateUnit = "lb" | "kg";

export interface PlateEntry {
  weight: number;
  pairs: number | "enough";
  color: string;
}

export const IRON_COLOR = "charcoal";

/** Default bumper colors by plate weight, per inventory unit. */
export const BUMPER_COLORS: {
  lb: Record<string, string>;
  kg: Record<string, string>;
} = {
  kg: {
    "25": "red",
    "20": "blue",
    "15": "yellow",
    "10": "green",
    "5": "white",
    "2.5": "red",
    "2": "blue",
    "1.5": "yellow",
    "1": "green",
    "0.5": "white",
  },
  lb: {
    "55": "red",
    "45": "blue",
    "35": "yellow",
    "25": "green",
    "10": "white",
    "5": "charcoal",
    "2.5": "silver",
    "1.25": "silver",
  },
};

export function bumperColorFor(weight: number, unit: PlateUnit): string {
  return BUMPER_COLORS[unit][String(Math.round(weight * 100) / 100)] ??
    IRON_COLOR;
}
