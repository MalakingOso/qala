/* Draw in CSS pixels. Labels, hit targets and strokes keep their size as
 * cards resize. Legends live in normal flow so they can wrap independently. */

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/** Square baseline, rounded data end. Zero-width segments draw nothing. */
export function roundedBar(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (width <= 0) return "";
  const r = Math.min(4, width / 2, height / 2);
  return `M${x},${y} H${x + width - r} Q${x + width},${y} ${x + width},${
    y + r
  } V${y + height - r} Q${x + width},${y + height} ${x + width - r},${
    y + height
  } H${x} Z`;
}

export function Plot({ height, children }: {
  height: number;
  children: (width: number) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} className="plot-frame" style={{ height }}>
      {width > 0 ? children(width) : null}
    </div>
  );
}

export function ChartLegend({ items }: {
  items: { label: string; color: string; outline?: boolean; line?: boolean }[];
}) {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span key={item.label}>
          <i
            aria-hidden="true"
            className={item.line ? "legend-line" : "legend-swatch"}
            style={{
              background: item.outline ? "transparent" : item.color,
              border: item.outline ? `2px solid ${item.color}` : undefined,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
