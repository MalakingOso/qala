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
  surface = "light",
  children,
}: {
  title: string;
  head: string[];
  rows: string[][];
  label: string;
  /** Skip the card chrome (border/shadow/padding) when the parent already
   * supplies it, so charts don't nest inside a second card (DESIGN 6, 7.1). */
  flat?: boolean;
  /** "night" seats the plot in a flush dark panel (Board 3); the header and
   * the table view stay on the card. Charts that draw their own light
   * surface keep the default. */
  surface?: "night" | "light";
  children: ReactNode;
}) {
  const [table, setTable] = useState(false);
  const night = surface === "night";
  return (
    <section
      className={`${flat ? "chart-wrap" : "card flat-rest chart-wrap"}${
        night ? " chart-night" : ""
      }`}
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
      {table ? <DataTable head={head} rows={rows} /> : (
        <div
          className={night ? "chart-plot chart-night-panel" : "chart-plot"}
          role="group"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </section>
  );
}
