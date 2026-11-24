/* Dense time series on a night panel: a white line over a teal fade, one
 * baseline, mono axes and an ember cursor dot with a white ring. They resize
 * with the workspace. A separate plot component remounts correctly after
 * switching to table view. A second series (the Kalman line next to the daily
 * best) is a teal line with no fade. */

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { NIGHT } from "./tokens.ts";
import { ChartShell } from "./ChartShell.tsx";

export interface DenseSeriesInput {
  label: string;
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
      const stroke = (i: number) => (i === 0 ? NIGHT.line : NIGHT.teal);
      plot = new uPlot(
        {
          width: el.clientWidth,
          height,
          padding: [16, 16, 0, 0],
          legend: {
            show: true,
            markers: {
              width: 2,
              stroke: (_, i) => stroke(i - 1),
              fill: (_, i) => stroke(i - 1),
            },
          },
          scales: { x: { time: false } },
          cursor: {
            y: false,
            sync: syncKey ? { key: syncKey, scales: ["x", null] } : undefined,
            points: {
              size: 10,
              width: 2,
              stroke: NIGHT.ring,
              fill: NIGHT.ember,
            },
          },
          axes: [
            {
              stroke: NIGHT.axis,
              grid: { show: false },
              ticks: { show: false },
              border: { show: true, stroke: NIGHT.baseline, width: 1 },
              font: "11px DM Mono, monospace",
              space: 80,
              size: 36,
            },
            {
              stroke: NIGHT.axis,
              grid: { show: false },
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
              stroke: stroke(i),
              width: 2,
              fill: i === 0
                ? (u: uPlot) => {
                  const fade = u.ctx.createLinearGradient(
                    0,
                    u.bbox.top,
                    0,
                    u.bbox.top + u.bbox.height,
                  );
                  fade.addColorStop(0, NIGHT.fadeTop);
                  fade.addColorStop(1, NIGHT.fadeBottom);
                  return fade;
                }
                : undefined,
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
    return () => {
      resize.disconnect();
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
    <ChartShell
      title={title}
      surface="night"
      head={head}
      rows={rows}
      label={label}
    >
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
