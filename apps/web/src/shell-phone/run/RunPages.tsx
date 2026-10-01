/* Run screens (DESIGN 7.14): Start (map, GPS, plan, Start), Live (stacked
 * numerals, square pause, Stop), Guided (step, target band, cue), Summary
 * (map with mile markers, six figures, splits, effort, save). Run glyphs use
 * sport-shoe. Live numbers come from the useSyncExternalStore run store so
 * ticks never re-render the shell. The map is a drawn stand-in until the
 * MapLibre layer (R4) lands. */

import { useState, useSyncExternalStore } from "react";
import { liveRunStore, useQala } from "../../store/qalaStore.tsx";
import {
  Card,
  PrimaryButton,
  ScalePicker,
  SecondaryButton,
  SegmentedControl,
  Toggle,
} from "../../shared/ui.tsx";
import { SplitsTable } from "../../shared/charts/index.ts";
import { sampleSplits } from "../../store/sample.ts";
import { formatElapsed, formatPace } from "../../logic/pace.ts";
import {
  Pause,
  Play,
  SignalHigh,
  SportShoe,
  Square,
  Volume2,
  Zap,
} from "../../shared/icons.ts";

/** A drawn route: streets as a faint grid, the loop in the run color,
 * start and finish dots, and optional mile markers. */
function RouteMap(
  { label, miles = false, live = false }: {
    label: string;
    miles?: boolean;
    live?: boolean;
  },
) {
  const route =
    "M40 150 C 70 150, 80 120, 110 112 S 160 70, 196 64 S 262 40, 290 70 S 300 128, 262 142 S 190 160, 150 168 S 70 176, 40 150";
  return (
    <figure className="route-map" role="img" aria-label={label}>
      <svg viewBox="0 0 340 200" preserveAspectRatio="xMidYMid slice">
        <g className="route-streets">
          {[30, 75, 120, 165].map((y) => (
            <path key={y} d={`M0 ${y} L340 ${y - 18}`} />
          ))}
          {[60, 140, 220, 300].map((x) => (
            <path key={x} d={`M${x} 0 L${x + 24} 200`} />
          ))}
        </g>
        <path className="route-park" d="M170 90 h70 v40 h-70 z" />
        <path className="route-line-halo" d={route} />
        <path className="route-line" d={route} />
        {miles
          ? [[196, 64, 1], [290, 70, 2], [150, 168, 3]].map(([x, y, n]) => (
            <g key={n} className="route-mile">
              <circle cx={x} cy={y} r={9} />
              <text x={x} y={y + 3.5} textAnchor="middle">{n}</text>
            </g>
          ))
          : null}
        <circle className="route-start" cx={40} cy={150} r={6} />
        {live ? <circle className="route-you" cx={262} cy={142} r={7} /> : null}
      </svg>
    </figure>
  );
}

export function StartRunPage() {
  const { queueOp, settings, updateSettings } = useQala();
  const cues = settings.run.audioCues;
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Tonight · after Lower A</p>
          <h1 className="page-title title">Easy run · 3.0 mi</h1>
        </div>
      </div>
      <Card hero>
        <RouteMap label="Map of your usual loop" />
        <div className="run-status">
          <span className="run-status-item ok">
            <SignalHigh size={16} aria-hidden="true" /> GPS good
          </span>
          <span className="run-status-item">
            <Volume2 size={16} aria-hidden="true" />
            {cues ? "Cue every 0.5 mi" : "Cues off"}
            <Toggle
              on={cues}
              label="Audio cues"
              onFlip={() =>
                updateSettings((s) => ({
                  ...s,
                  run: { ...s.run, audioCues: !s.run.audioCues },
                }))}
            />
          </span>
        </div>
        <p className="run-why">
          <SportShoe size={16} aria-hidden="true" />
          Conversational pace. Legs lifted today, so keep it easy.
        </p>
        <PrimaryButton
          large
          href="#/phone/run/live"
          onClick={() => {
            liveRunStore.start();
            queueOp("run-start", { plan: "easy-3mi" });
          }}
        >
          <Play size={22} /> Start run
        </PrimaryButton>
      </Card>
    </div>
  );
}

export function LiveRunPage() {
  const snap = useSyncExternalStore(
    liveRunStore.subscribe,
    liveRunStore.getSnapshot,
  );
  const [page, setPage] = useState<"main" | "splits" | "map">("main");
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Easy run</h1>
        <span
          className={snap.running && !snap.paused
            ? "run-state recording"
            : "run-state"}
        >
          {snap.paused ? "Paused" : snap.running ? "Recording" : "Ready"}
        </span>
      </div>
      <SegmentedControl
        label="Run view"
        value={page}
        onPick={setPage}
        options={[
          { value: "main", label: "Numbers" },
          { value: "splits", label: "Splits" },
          { value: "map", label: "Map" },
        ]}
      />
      {page === "main"
        ? (
          <Card hero>
            <div className="live-nums">
              <div className="live-miles">
                <span
                  className={snap.miles >= 10
                    ? "figure ticking long"
                    : "figure ticking"}
                >
                  {snap.miles.toFixed(2)}
                </span>
                <span className="group-label">miles</span>
              </div>
              <div className="live-row">
                <div>
                  <span className="group-label">Time</span>
                  <span className="figure ticking">
                    {formatElapsed(snap.elapsedSec)}
                  </span>
                </div>
                <div>
                  <span className="group-label">Pace</span>
                  <span className="figure ticking">
                    {formatPace(snap.paceSecPerMi)}
                  </span>
                </div>
                <div>
                  <span className="group-label">Avg</span>
                  <span className="figure ticking">
                    {formatPace(snap.avgSecPerMi)}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        )
        : page === "splits"
        ? <SplitsTable splits={sampleSplits} />
        : <RouteMap label="Live route map" live />}
      <div className="live-controls">
        {snap.paused
          ? (
            <button
              type="button"
              className="live-pause"
              aria-label="Resume"
              onClick={() => liveRunStore.resume()}
            >
              <Play size={30} />
            </button>
          )
          : (
            <button
              type="button"
              className="live-pause"
              aria-label={snap.running ? "Pause" : "Start"}
              onClick={() => (snap.running
                ? liveRunStore.pause()
                : liveRunStore.start())}
            >
              {snap.running ? <Pause size={30} /> : <Play size={30} />}
            </button>
          )}
        <SecondaryButton
          onClick={() => {
            liveRunStore.stop();
            window.location.hash = "#/phone/run/summary";
          }}
        >
          <Square size={16} /> Finish run
        </SecondaryButton>
      </div>
    </div>
  );
}

/** Pace band, slow on the left and fast on the right, so "speed up" means
 * moving the marker right. */
const BAND = { slow: 570, fast: 510, lo: 550, hi: 530, now: 554 };

function pos(sec: number) {
  return ((BAND.slow - sec) / (BAND.slow - BAND.fast)) * 100;
}

export function GuidedRunPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Guided · Tempo 4 mi</p>
          <h1 className="page-title title">Tempo</h1>
        </div>
      </div>
      <Card hero>
        <p className="group-label guided-step">Step 2 of 5 · tempo 10:00</p>
        <div className="rest-clock">
          <span className="figure ticking rest-left">7:32</span>
          <span className="rest-of">left in step</span>
        </div>
        <div
          className="pace-band"
          role="img"
          aria-label={`Target pace ${formatPace(BAND.lo)} to ${
            formatPace(BAND.hi)
          }, current ${formatPace(BAND.now)}, slower than the band`}
        >
          <div className="pace-track">
            <span
              className="pace-target"
              style={{
                left: `${pos(BAND.lo)}%`,
                right: `${100 - pos(BAND.hi)}%`,
              }}
            />
            <span className="pace-now" style={{ left: `${pos(BAND.now)}%` }}>
              <span className="pace-now-label ticking">
                {formatPace(BAND.now)}
              </span>
            </span>
          </div>
          <div className="pace-ticks" aria-hidden="true">
            <span>slower</span>
            <span style={{ left: `${pos(BAND.lo)}%` }}>
              {formatPace(BAND.lo)}
            </span>
            <span style={{ left: `${pos(BAND.hi)}%` }}>
              {formatPace(BAND.hi)}
            </span>
            <span>faster</span>
          </div>
        </div>
        <p className="guided-cue">
          <Zap size={18} aria-hidden="true" /> Speed up a little
        </p>
        <p className="kbd-hint">
          {formatPace(BAND.now)} against a target of {formatPace(BAND.hi)} to
          {" "}
          {formatPace(BAND.lo)} · 1.8 mi · 16:40 total
        </p>
        <SecondaryButton href="#/phone/run/live">
          Back to numbers
        </SecondaryButton>
      </Card>
    </div>
  );
}

export function RunSummaryPage() {
  const { queueOp } = useQala();
  const [srpe, setSrpe] = useState<number | null>(null);
  const last = useSyncExternalStore(
    liveRunStore.subscribe,
    liveRunStore.getLast,
  );
  // Heart rate, effort load, and elevation aren't tracked by the demo
  // ticker yet (PLAN.md 14: real GPS/HR need the phone build).
  const stats = [
    { v: last ? formatElapsed(last.elapsedSec) : "—", l: "time" },
    { v: last ? last.miles.toFixed(2) : "—", l: "miles" },
    { v: last ? formatPace(last.avgSecPerMi) : "—", l: "avg pace" },
    { v: "—", l: "avg HR" },
    { v: "—", l: "rTSS" },
    { v: "—", l: "climb ft" },
  ];
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Sunday · 6:04 pm</p>
          <h1 className="page-title title">Easy run · 3.0 mi</h1>
        </div>
      </div>
      <Card hero>
        <RouteMap label="Route with mile markers" miles />
        <dl className="run-figures">
          {stats.map((s) => (
            <div key={s.l}>
              <dt>{s.l}</dt>
              <dd className="figure ticking">{s.v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <SplitsTable splits={sampleSplits} />
      <section className="card flat-rest">
        <h2 className="card-title title">How hard was it?</h2>
        <ScalePicker
          label="Run effort"
          options={Array.from({ length: 11 }, (_, v) => v)}
          value={srpe}
          onPick={setSrpe}
          anchors={["rest", "hard", "max"]}
        />
        <p className="today-line">
          For tomorrow: legs stay fresh, Upper A goes ahead as planned.
        </p>
        <PrimaryButton
          large
          href="#/phone/today"
          onClick={() => queueOp("run-save", { srpe })}
        >
          Save run
        </PrimaryButton>
      </section>
    </div>
  );
}
