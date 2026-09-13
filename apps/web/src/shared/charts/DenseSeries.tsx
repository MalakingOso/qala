/* Dense time series resize with the workspace and redraw when tokens change.
 * A separate plot component remounts correctly after switching to table view. */

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

interface PlotProps {
  x: number[];
  xLabel: string;
  series: DenseSeriesInput[];
  height: number;
  syncKey?: string;
}

function DensePlot({ x, xLabel, series, height, syncKey }: PlotProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let plot: uPlot | undefined;
    const draw = () => {
      if (el.clientWidth === 0) return;
      plot?.destroy();
      const colors = resolveTokens(series.map((s) => s.color));
      const [grid, ink] = resolveTokens(["var(--grid)", "var(--fg-muted)"]);
      plot = new uPlot(
        {
          width: el.clientWidth,
          height,
          padding: [16, 16, 0, 0],
          legend: { show: true },
          scales: { x: { time: false } },
          cursor: {
            sync: syncKey ? { key: syncKey, scales: ["x", null] } : undefined,
          },
          axes: [
            {
              stroke: ink,
              grid: { show: false },
              ticks: { show: false },
              font: "11px DM Mono, monospace",
              space: 80,
              size: 36,
            },
            {
              stroke: ink,
              grid: { stroke: grid, width: 1 },
              ticks: { show: false },
              font: "11px DM Mono, monospace",
              size: 48,
              space: 48,
            },
          ],
          series: [
            { label: xLabel },
            ...series.map((s, i) => ({
              label: s.label,
              stroke: colors[i],
              width: 2,
              paths: uPlot.paths.spline?.(),
              points: { show: false },
              spanGaps: false,
            })),
          ],
        },
        [x, ...series.map((s) => s.values)],
        el,
      );
    };
    draw();
    const resize = new ResizeObserver(() => {
      if (el.clientWidth === 0) return;
      if (!plot) draw();
      else if (plot.width !== el.clientWidth) {
        plot.setSize({ width: el.clientWidth, height });
      }
    });
    resize.observe(el);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
      plot?.destroy();
    };
  }, [x, xLabel, series, height, syncKey]);
  return <div ref={host} className="dense-plot" />;
}

export function DenseSeries(
  { title, x, xLabel, series, height = 240, syncKey, head, rows, label }:
    & Omit<PlotProps, "height">
    & {
      title: string;
      height?: number;
      head: string[];
      rows: string[][];
      label: string;
    },
) {
  return (
    <ChartShell title={title} head={head} rows={rows} label={label}>
      <DensePlot
        x={x}
        xLabel={xLabel}
        series={series}
        height={height}
        syncKey={syncKey}
      />
    </ChartShell>
  );
}
