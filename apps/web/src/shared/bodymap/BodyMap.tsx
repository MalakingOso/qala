/* Front or back body drawn from liftosaur's artwork (data.ts). Every muscle
 * is its own group, so callers colour them by state: pass fill and opacity
 * per liftosaur screen muscle (shoulders, triceps, back, abs, glutes,
 * hamstrings, quadriceps, chest, biceps, calves, forearms). Unlisted muscles
 * draw in the quiet default so the outline always reads as a body. */

import { BODY } from "./data.ts";

export interface MuscleStyle {
  fill?: string;
  opacity?: number;
  /** Outline, to mark the selected muscle. */
  stroke?: string;
}

export function BodyMap({ view, muscles, contour, label, onSelect, asGroup }: {
  view: "front" | "back";
  muscles?: Partial<Record<string, MuscleStyle>>;
  contour?: MuscleStyle;
  label: string;
  onSelect?: (muscle: string) => void;
  /** Return just the artwork group, to nest inside a caller's own <svg>. */
  asGroup?: boolean;
}) {
  const { viewBox, parts } = BODY[view];
  const art = (
      <g stroke="none" fillRule="evenodd">
        {parts.map((p) => {
          const s = p.id === "contour" ? contour : muscles?.[p.id];
          const fill = s?.fill ??
            (p.id === "contour" ? "var(--fg-faint)" : "var(--mark-gray)");
          const opacity = s?.opacity ?? 1;
          const hit = onSelect && p.id !== "contour";
          return (
            <g
              key={p.id}
              data-muscle={p.id}
              fill={fill}
              opacity={opacity}
              stroke={s?.stroke}
              strokeWidth={s?.stroke ? 0.4 : undefined}
              strokeLinejoin="round"
              style={hit ? { cursor: "pointer" } : undefined}
              onClick={hit ? () => onSelect(p.id) : undefined}
            >
              {p.groups.map((g, i) => (
                <g key={i} transform={`translate(${g.tx} ${g.ty})`}>
                  {g.paths.map((d, j) => <path key={j} d={d} />)}
                </g>
              ))}
            </g>
          );
        })}
      </g>
  );
  if (asGroup) return art;
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={label}
      style={{ width: "100%", height: "auto", aspectRatio: "112 / 234" }}
    >
      {art}
    </svg>
  );
}
