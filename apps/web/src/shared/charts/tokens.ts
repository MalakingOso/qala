/* Chart tokens (DESIGN 6.2). SVG charts use var(--token) directly so theme
 * changes need no re-render; the uPlot wrapper resolves tokens at mount. */

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

