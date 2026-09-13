/* Chart tokens (DESIGN 6.2). SVG charts use var(--token) directly so theme
 * changes need no re-render; the uPlot wrapper resolves tokens at mount. */

export const CATEGORICAL = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
export const ORDINAL = [
  "var(--int-1)",
  "var(--int-2)",
  "var(--int-3)",
  "var(--int-4)",
  "var(--int-5)",
];
export const EMPHASIS = "var(--accent)";
export const CONTEXT = "var(--mark-gray)";

/** Resolve CSS tokens to concrete colors for canvas (uPlot). */
export function resolveTokens(names: string[]): string[] {
  if (typeof getComputedStyle === "undefined") return names.map(() => "#888");
  const cs = getComputedStyle(document.documentElement);
  return names.map((n) => {
    const m = /^var\((--[^)]+)\)$/.exec(n.trim());
    if (!m) return n;
    return cs.getPropertyValue(m[1]).trim() || n;
  });
}

export const CHART_W = 560;
export const TICK_FILL = "var(--fg-muted)";
