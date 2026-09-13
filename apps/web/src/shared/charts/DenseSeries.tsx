/* uPlot wrapper for dense or zoomable time series (DESIGN 6.1): run pace /
 * heart rate / elevation, full-history e1RM, fitness-fatigue curves,
 * calibration residuals. Resolves CSS tokens at mount (canvas cannot use
 * var()) and re-creates the plot when the theme changes. */

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { resolveTokens } from "./tokens.ts";
import { ChartShell } from "./ChartShell.tsx";

export interface DenseSeriesInput {
  label: string;
  color: string;
  values: (number | null)[];
}

export function DenseSeries({
  title,
  x,
  xLabel,
  series,
  height = 220,
  head,
  rows,
  label,
}: {
  title: string;
  x: number[];
  xLabel: string;
  series: DenseSeriesInput[];
  height?: number;
  head: string[];
  rows: string[][];
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const theme = typeof document !== "undefined"
    ? document.documentElement.dataset.theme
    : "light";

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = "";
    const colors = resolveTokens(series.map((s) => s.color));
    const grid = resolveTokens(["var(--grid)"])[0];
    const ink = resolveTokens(["var(--fg-muted)"])[0];
    const opts: uPlot.Options = {
      width: Math.max(280, el.clientWidth || 520),
      height,
      legend: { show: true },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: ink,
          grid: { stroke: grid, width: 1 },
          font: "10px DM Mono, monospace",
        },
        {
          stroke: ink,
          grid: { stroke: grid, width: 1 },
          font: "10px DM Mono, monospace",
        },
      ],
      series: [
        { label: xLabel },
        ...series.map((s, i) => ({
          label: s.label,
          stroke: colors[i],
          width: 2,
          points: { show: false },
        })),
      ],
    };
    const data: uPlot.AlignedData = [
      x,
      ...series.map((s) => s.values.map((v) => v ?? NaN)),
    ];
    const plot = new uPlot(opts, data, el);
    return () => plot.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    theme,
    title,
    height,
    JSON.stringify(x),
    JSON.stringify(series.map((s) => s.values)),
  ]);

  return (
    <ChartShell title={title} head={head} rows={rows} label={label}>
      <div ref={host} style={{ width: "100%" }} />
    </ChartShell>
  );
}
