/* Run screens (DESIGN 7.14): Start (map, GPS, plan, Start), Live (stacked
 * numerals, pause square, swipe pages), Guided (step, target band, cues),
 * Summary (map with mile markers, six figures, splits, effort, save).
 * Run glyphs use sport-shoe. Live numbers come from the useSyncExternalStore
 * run store so ticks never re-render the shell. */

import { useState, useSyncExternalStore } from "react";
import { liveRunStore, useQala } from "../../store/qalaStore.tsx";
import { Card, Chip, PrimaryButton, SecondaryButton } from "../../shared/ui.tsx";
import { SplitsTable } from "../../shared/charts/index.ts";
import { sampleSplits } from "../../store/sample.ts";
import { formatElapsed, formatPace } from "../../logic/pace.ts";
import { Pause, Play, Route, SignalHigh, SportShoe, Volume2, Zap } from "../../shared/icons.ts";

export function StartRunPage() {
  const { queueOp } = useQala();
  const [cues, setCues] = useState(true);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Easy run · 3.0 mi</h1>
      </div>
      <Card hero>
        <div
          style={{ height: 180, background: "var(--bg-recessed)", border: "var(--border-width) solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}
          role="img"
          aria-label="Route map preview"
        >
          <Route size={32} />
        </div>
        <p>
          <SignalHigh size={16} /> GPS good · <Volume2 size={16} /> {cues ? "cues every 0.5 mi" : "cues off"}
        </p>
        <p className="kbd-hint">Legs lifted today: keep it easy. Conversational pace.</p>
        <p>
          <button type="button" className="chip" aria-pressed={cues} onClick={() => setCues((c) => !c)}>
            Audio cues {cues ? "on" : "off"}
          </button>{" "}
          <Chip>Workout: easy 3.0 mi</Chip>
        </p>
        <PrimaryButton
          large
          href="#/phone/run/live"
          onClick={() => {
            liveRunStore.start();
            queueOp("run-start", { plan: "easy-3mi" });
          }}
        >
          <SportShoe size={22} /> Start run
        </PrimaryButton>
      </Card>
    </div>
  );
}

export function LiveRunPage() {
  const snap = useSyncExternalStore(liveRunStore.subscribe, liveRunStore.getSnapshot);
  const [page, setPage] = useState<"main" | "splits" | "map">("main");
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Live</h1>
        <span className="kbd-hint ticking">{formatElapsed(snap.elapsedSec)}</span>
      </div>
      <Card hero>
        {page === "main" ? (
          <div style={{ textAlign: "center" }}>
            <div className="group-label">Time</div>
            <div className="figure ticking" style={{ fontSize: 64 }}>{formatElapsed(snap.elapsedSec)}</div>
            <div className="group-label">Distance</div>
            <div className="figure ticking" style={{ fontSize: 96, lineHeight: 1.05 }}>{snap.miles.toFixed(2)}</div>
            <div className="kbd-hint">miles</div>
            <div style={{ display: "flex", gap: 24, justifyContent: "center", marginTop: 8 }}>
              <div>
                <div className="group-label">Pace</div>
                <div className="figure ticking" style={{ fontSize: 32 }}>{formatPace(snap.paceSecPerMi)}</div>
              </div>
              <div>
                <div className="group-label">Avg</div>
                <div className="figure ticking" style={{ fontSize: 32 }}>{formatPace(snap.avgSecPerMi)}</div>
              </div>
            </div>
          </div>
        ) : page === "splits" ? (
          <SplitsTable splits={sampleSplits} />
        ) : (
          <div style={{ height: 240, background: "var(--bg-recessed)", display: "flex", alignItems: "center", justifyContent: "center" }} role="img" aria-label="Live route map">
            <Route size={32} />
          </div>
        )}
        <div className="row-btns" style={{ marginTop: 12 }}>
          {(["main", "splits", "map"] as const).map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={page === p} onClick={() => setPage(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="row-btns" style={{ marginTop: 12 }}>
          {snap.paused ? (
            <PrimaryButton onClick={() => liveRunStore.resume()}>
              <Play size={20} /> Resume
            </PrimaryButton>
          ) : (
            <button
              type="button"
              aria-label={snap.running ? "Pause" : "Start"}
              onClick={() => (snap.running ? liveRunStore.pause() : liveRunStore.start())}
              style={{ flex: 1, minHeight: 64, background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: "var(--radius)", boxShadow: "var(--shadow-cta)" }}
            >
              {snap.running ? <Pause size={24} /> : <Play size={24} />}
            </button>
          )}
          <SecondaryButton
            onClick={() => {
              liveRunStore.stop();
              window.location.hash = "#/phone/run/summary";
            }}
          >
            Stop (hold)
          </SecondaryButton>
        </div>
      </Card>
    </div>
  );
}

export function GuidedRunPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Guided · Tempo</h1>
      </div>
      <Card hero>
        <p className="group-label" style={{ color: "var(--accent)" }}>Step 2 of 5 · Tempo 10:00</p>
        <div className="figure ticking" style={{ fontSize: 72 }}>7:32</div>
        <p className="kbd-hint">left in step</p>
        <div style={{ height: 26, background: "var(--bg-active)", position: "relative", margin: "12px 0" }} role="img" aria-label="Target pace band 8:50 to 9:10, current 9:02">
          <div style={{ position: "absolute", left: "20%", right: "20%", top: 0, bottom: 0, background: "var(--run)", opacity: 0.5 }} />
          <div style={{ position: "absolute", left: "46%", top: -4, bottom: -4, width: 4, background: "var(--accent)" }} />
        </div>
        <p><Zap size={16} /> Speed up a little · 9:02 in an 8:50-9:10 band</p>
        <p className="kbd-hint">1.8 mi · 16:40 total</p>
        <PrimaryButton href="#/phone/run/live">Back to live</PrimaryButton>
      </Card>
    </div>
  );
}

export function RunSummaryPage() {
  const { queueOp } = useQala();
  const [srpe, setSrpe] = useState<number | null>(null);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Easy run · 3.0 mi</h1>
      </div>
      <Card hero>
        <div style={{ height: 180, background: "var(--bg-recessed)", border: "var(--border-width) solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }} role="img" aria-label="Route with mile markers colored by pace">
          <Route size={32} />
        </div>
        <div className="stat-tiles" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {[
            { v: "27:24", l: "time" },
            { v: "3.01", l: "miles" },
            { v: "9:06", l: "avg pace" },
            { v: "142", l: "avg HR" },
            { v: "38", l: "rTSS" },
            { v: "+12 m", l: "climb" },
          ].map((s) => (
            <div className="stat-tile" key={s.l}>
              <div className="v figure ticking">{s.v}</div>
              <div className="l">{s.l}</div>
            </div>
          ))}
        </div>
      </Card>
      <SplitsTable splits={sampleSplits} />
      <Card>
        <p className="group-label">Effort (sRPE)</p>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {Array.from({ length: 11 }, (_, v) => (
            <button key={v} type="button" aria-pressed={srpe === v} onClick={() => setSrpe(v)} className="icon-btn" style={srpe === v ? { outline: "2px solid var(--accent)" } : undefined}>
              {v}
            </button>
          ))}
        </div>
        <p>What it means for tomorrow: legs stay fresh. Upper B as planned.</p>
        <div style={{ marginTop: 8 }}>
          <PrimaryButton href="#/phone/today" onClick={() => queueOp("run-save", { srpe })}>Save run</PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
