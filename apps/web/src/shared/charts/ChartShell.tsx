/* Chart shell (DESIGN 6.2): every chart ships a table view built from the
 * same data, tap/hover tooltips with a 24px hit area, and keyboard focus
 * that shows the same as hover. */

import { useState, type ReactNode } from "react";

export function ChartShell({
  title,
  head,
  rows,
  label,
  children,
}: {
  title: string;
  head: string[];
  rows: string[][];
  label: string;
  children: ReactNode;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className="card flat-rest chart-wrap" aria-label={title}>
      <div className="page-head" style={{ marginBottom: 4 }}>
        <h3 className="card-title title" style={{ margin: 0 }}>
          {title}
        </h3>
        <button
          type="button"
          className="link-btn"
          onClick={() => setTable((t) => !t)}
          aria-expanded={table}
        >
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {table ? (
        <table className="data">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div tabIndex={0} role="img" aria-label={label}>
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
    <g tabIndex={0} role="img" aria-label={label} transform={`translate(${x} ${y})`}>
      <title>{label}</title>
      <circle r={13} fill="transparent" />
      {children}
    </g>
  );
}
