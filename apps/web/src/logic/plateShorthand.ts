/* Plate shorthand for the logging card, rest screen and warm-up ramp rows
 * (PLAN 6.8, DESIGN 5.8/7.12). The exact knapsack lives in the engine
 * (@qala/core plates.ts); this is the display-level greedy over the
 * standard bumper inventory, used when the engine value is unavailable. */

export const STANDARD_PLATES = [45, 35, 25, 10, 5, 2.5];

/** Greedy per-side plates, heaviest innermost. Returns [] when under the bar. */
export function platesPerSide(total: number, bar = 45, collar = 0): number[] {
  const target = (total - bar - 2 * collar) / 2;
  if (target <= 0) return [];
  const out: number[] = [];
  let rest = target;
  for (const p of STANDARD_PLATES) {
    while (rest + 1e-9 >= p) {
      out.push(p);
      rest -= p;
    }
  }
  return out;
}

/** "per side 45 · 45 · 10" shorthand (DESIGN 5.8). */
export function formatShorthand(perSide: number[]): string {
  if (perSide.length === 0) return "bar only";
  return `per side ${perSide.join(" · ")}`;
}

/** Between-set change instruction, e.g. "add 10 + 2.5 each side". */
export function changeInstruction(from: number[], to: number[]): string {
  const count = (xs: number[]) => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const a = count(from);
  const b = count(to);
  const off: string[] = [];
  const on: string[] = [];
  for (const [w, n] of a) {
    const keep = Math.min(n, b.get(w) ?? 0);
    for (let i = 0; i < n - keep; i++) off.push(String(w));
  }
  for (const [w, n] of b) {
    const keep = Math.min(n, a.get(w) ?? 0);
    for (let i = 0; i < n - keep; i++) on.push(String(w));
  }
  if (off.length === 0 && on.length === 0) return "Same as last set";
  const parts: string[] = [];
  if (off.length > 0) parts.push(`take off ${off.join(" + ")}`);
  if (on.length > 0) parts.push(`add ${on.join(" + ")}`);
  return `${parts.join(", ")} each side`;
}

/** Plate color defaults (DESIGN 5.8 / PLAN 6.8). Editable in Settings. */
export function plateColor(weight: number): { bg: string; ink: string } {
  switch (weight) {
    case 55:
      return { bg: "#d64541", ink: "#fff" };
    case 45:
      return { bg: "#2f6bd1", ink: "#fff" };
    case 35:
      return { bg: "#e9b824", ink: "#0f152a" };
    case 25:
      return { bg: "#2f9c5a", ink: "#fff" };
    case 10:
      return { bg: "#eef0f4", ink: "#0f152a" };
    case 5:
      return { bg: "#3b404c", ink: "#fff" };
    default:
      return { bg: "#b9bfca", ink: "#0f152a" };
  }
}
