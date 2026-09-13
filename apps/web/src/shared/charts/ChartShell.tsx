/* Chart shell (DESIGN 6.2): every chart ships a table view built from the
 * same data, tap/hover tooltips with a 24px hit area, and keyboard focus
 * that shows the same as hover. */

import { type ReactNode, useState } from "react";
import { Table2, TrendingUp } from "../icons.ts";
import { DataTable } from "../ui.tsx";

export function ChartShell({
  title,
  head,
  rows,
  label,
  flat,
  children,
}: {
  title: string;
  head: string[];
  rows: string[][];
  label: string;
  /** Skip the card chrome (border/shadow/padding) when the parent already
   * supplies it, so charts don't nest inside a second card (DESIGN 6, 7.1). */
  flat?: boolean;
  children: ReactNode;
}) {
  const [table, setTable] = useState(false);
  return (
    <section
      className={flat ? "chart-wrap" : "card flat-rest chart-wrap"}
      aria-label={title}
    >
      <div className="chart-head">
        <h3 className="card-title title">
          {title}
        </h3>
        <button
          type="button"
          className="chart-toggle"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          aria-label={`${table ? "Show chart" : "Show table"}: ${title}`}
        >
          {table ? <TrendingUp size={15} /> : <Table2 size={15} />}
          <span>{table ? "Chart" : "Table"}</span>
        </button>
      </div>
      {table
        ? <DataTable head={head} rows={rows} />
        : (
          <div className="chart-plot" role="group" aria-label={label}>
            {children}
          </div>
        )}
    </section>
  );
}

/** Focusable hit area (24px+) showing a native tooltip, same on hover. */
export function Hit({
  x,
  y,
  label,
  children,
}: {
  x: number;
  y: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <g
      tabIndex={0}
      role="img"
      aria-label={label}
      transform={`translate(${x} ${y})`}
    >
      <title>{label}</title>
      <circle r={13} fill="transparent" />
      {children}
    </g>
  );
}
