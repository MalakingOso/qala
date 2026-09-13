/* Lifts index: one card per main lift with its recent trend, current e1RM
 * and NL85 vs target, linking into the full history and calibration on
 * LiftDetailPage. Replaces the old Graphs page's single stacked column of
 * every lift's charts mixed together. */

import { E1rmLine } from "../shared/charts/index.ts";
import { sampleLifts } from "../store/sample.ts";
import { Card } from "../shared/ui.tsx";

export function LiftsPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Lifts</h1>
      </div>
      <div className="card-grid">
        {sampleLifts.map((l) => (
          <Card key={l.id}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <h2 className="card-title title" style={{ margin: 0 }}>
                <a href={`#/desktop/lifts/${l.id}`}>{l.name}</a>
              </h2>
              <span className="kbd-hint">
                NL85 {l.nl85.actual}/{l.nl85.target}
              </span>
            </div>
            <p style={{ margin: "2px 0 8px" }}>
              <span className="figure" style={{ fontSize: 28 }}>
                {l.e1rm}
              </span>{" "}
              <span className="kbd-hint">
                lb e1RM · Kalman {l.kalman} · {l.weekDeltaPct >= 0 ? "+" : ""}
                {l.weekDeltaPct}% this block
              </span>
            </p>
            <E1rmLine lift={l.name} points={l.recent} flat />
            <p>
              <a className="link-btn" href={`#/desktop/lifts/${l.id}`}>
                Full history &amp; calibration
              </a>
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
