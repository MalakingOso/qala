/* Lifts index (DECISIONS U21): a lede that says how the block is going across
 * the four lifts, then one card per lift with its e1RM trend, NL85 vs target
 * and a link into the full history and calibration on LiftDetailPage. */

import { E1rmLine } from "../shared/charts/index.ts";
import { sampleBlock, sampleLifts } from "../store/sample.ts";
import { PageHeader, Panel } from "./parts.tsx";

export function LiftsPage() {
  const ranked = [...sampleLifts].sort((a, b) =>
    b.weekDeltaPct - a.weekDeltaPct
  );
  const avg = sampleLifts.reduce((n, l) => n + l.weekDeltaPct, 0) /
    sampleLifts.length;
  const allUp = sampleLifts.every((l) => l.weekDeltaPct >= 0);
  const top = ranked[0];
  const last = ranked[ranked.length - 1];
  const widest = Math.max(
    1,
    ...sampleLifts.map((l) => Math.abs(l.weekDeltaPct)),
  );
  const sign = (v: number) => (v >= 0 ? "+" : "−");

  return (
    <div>
      <PageHeader
        kicker={`${sampleBlock.name} · Week ${sampleBlock.week} of ${sampleBlock.of}`}
        title="Lifts"
      >
        <div className="lede-grid even">
          <div className="lede-left">
            <div className="bigweek figure">
              {sign(avg)}
              {Math.abs(avg).toFixed(1)}%{" "}
              <small>average e1RM, this block</small>
            </div>
            <div className="block-line">
              {allUp ? "All four lifts are up" : "Mixed across the four lifts"}
              <span>
                {` · ${top.name.toLowerCase()} leads, ${last.name.toLowerCase()} has the least room`}
              </span>
            </div>
          </div>
          <div
            className="gain-rows"
            role="img"
            aria-label={`E1RM change this block: ${
              ranked.map((l) =>
                `${l.name} ${sign(l.weekDeltaPct)}${
                  Math.abs(l.weekDeltaPct)
                } percent`
              ).join(", ")
            }`}
          >
            {ranked.map((l) => (
              <div className="gain-row" key={l.id}>
                <b>{l.name}</b>
                <span className="gain-track">
                  <i
                    style={{
                      width: `${(Math.abs(l.weekDeltaPct) / widest) * 100}%`,
                    }}
                  />
                </span>
                <span className="num">
                  {sign(l.weekDeltaPct)}
                  {Math.abs(l.weekDeltaPct)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </PageHeader>
      <div className="lift-grid">
        {sampleLifts.map((l) => (
          <Panel key={l.id} className="lift-card">
            <div className="lift-top">
              <h2 className="lift-name title">
                <a href={`#/desktop/lifts/${l.id}`}>{l.name}</a>
              </h2>
              <span className="kbd-hint">
                NL85 {l.nl85.actual} / {l.nl85.target}
              </span>
            </div>
            <p className="lift-fig">
              <span className="figure">{l.e1rm}</span>{" "}
              <span className="figure-unit">lb e1RM</span>
            </p>
            <p className="lift-sub">
              <span className="up">
                {l.weekDeltaPct >= 0 ? "+" : "−"}
                {Math.abs(l.weekDeltaPct)}% this block
              </span>
              {` · Kalman ${l.kalman}`}
            </p>
            <E1rmLine lift={l.name} points={l.recent} flat />
            <p className="lift-foot">
              <a href={`#/desktop/lifts/${l.id}`}>
                Full history and calibration {"→"}
              </a>
            </p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
