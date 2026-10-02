/* Recovery map: the body is the main view, each muscle tinted by how long
 * until it is ready, with a callout beside it saying when. Tap a muscle (on
 * the body or its callout) or a chip and the curve underneath shows that
 * muscle's fatigue falling to the dashed ready line; swipe the curve, or use
 * the arrows, to step through them. Ready muscles go teal; recovering ones go
 * ember, darker the longer they have left; callouts take a faint tint of
 * the same hue.
 *
 * The curve is the engine's decay (PLAN 6.1, tau 2 to 2.5 days) drawn so it
 * crosses the ready line at the muscle's ready time. Levels have no unit on
 * purpose: what matters is where the curve meets the line. */

import { useRef, useState } from "react";
import { ChartShell } from "../charts/ChartShell.tsx";
import { SegmentedControl } from "../ui.tsx";
import { BODY } from "./data.ts";
import { BodyMap, type MuscleStyle } from "./BodyMap.tsx";

export interface MuscleRecovery {
  /** liftosaur screen muscle id: quadriceps, glutes, chest, back, ... */
  id: string;
  /** Hours until ready; 0 or less means ready now. */
  hours: number;
}

const NAMES: Record<string, string> = {
  quadriceps: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  chest: "Chest",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  back: "Back",
};

const FULL = 72; // hours the curve chart spans
const TAU = 60; // hours, the decay constant for the sample curve

export function readyText(hours: number, now: Date) {
  if (hours <= 0) return "Ready now";
  if (hours < 24) return `Ready in ${Math.ceil(hours)} h`;
  const at = new Date(now.getTime() + hours * 3600_000);
  return `Ready ${at.toLocaleDateString("en-US", { weekday: "short" })}`;
}

/* Six steps so a muscle a few hours from ready looks different from one
 * with two days to go. Steps are hours from ready; 0 is ready now. */
const STEPS = [0, 8, 16, 28, 40, 56];

function step(hours: number) {
  let k = 0;
  for (let i = 1; i < STEPS.length; i++) if (hours > STEPS[i - 1]) k = i;
  return k;
}

function tone(hours: number) {
  return `var(--rec-${step(hours)})`;
}

function style(hours: number): MuscleStyle {
  return { fill: tone(hours), opacity: hours <= 0 ? 0.85 : 0.95 };
}

const SIDE_W = 74;
const BOX_W = 68;
const BOX_H = 27;
const GAP = 7;

function nameOf(view: "front" | "back", id: string) {
  return view === "front" && id === "back" ? "Traps" : NAMES[id] ?? id;
}

export function RecoveryMap({ muscles, now = new Date(), flat, both }: {
  muscles: MuscleRecovery[];
  now?: Date;
  /** Skip the card chrome when a parent card supplies it. */
  flat?: boolean;
  /** Draw the front and back side by side instead of behind a toggle
   * (the desktop lede, DECISIONS U21). */
  both?: boolean;
}) {
  // Longest recovery first: the order you step through with the arrows.
  const order = [...muscles].sort((a, b) => b.hours - a.hours);
  const [view, setView] = useState<"front" | "back">("front");
  const [sel, setSel] = useState(order[0]?.id ?? "");
  const byId = new Map(muscles.map((m) => [m.id, m]));

  function pick(id: string) {
    setSel(id);
    const here = BODY[view].parts.some((p) => p.id === id && p.anchors);
    if (!here) setView(view === "front" ? "back" : "front");
  }
  function step(by: number) {
    const i = order.findIndex((m) => m.id === sel);
    pick(order[(i + by + order.length) % order.length].id);
  }

  const styles: Record<string, MuscleStyle> = {};
  for (const m of muscles) {
    styles[m.id] = {
      ...style(m.hours),
      stroke: m.id === sel ? "var(--fg)" : undefined,
    };
  }

  function layout(v: "front" | "back") {
    const parts = BODY[v].parts.filter((p) => p.anchors && byId.has(p.id));
    parts.sort((a, b) => a.anchors!.l[1] - b.anchors!.l[1]);
    const callouts = parts.map((p, i) => {
      const side = i % 2 === 0 ? "l" : "r";
      const [ax, ay] = p.anchors![side];
      return { id: p.id, side, ax, ay, y: ay - BOX_H / 2 };
    });
    for (const side of ["l", "r"]) {
      let floor = 2;
      for (const c of callouts.filter((c) => c.side === side)) {
        c.y = Math.max(c.y, floor);
        floor = c.y + BOX_H + GAP;
      }
    }
    const [, , vw, vh] = BODY[v].viewBox.split(" ").map(Number);
    return { callouts, vw, vh };
  }

  function renderMap(v: "front" | "back") {
    const L = layout(v);
    return (
      <svg
        viewBox={`${-SIDE_W} 0 ${L.vw + 2 * SIDE_W} ${L.vh}`}
        role="group"
        aria-label={`Body, ${v} view`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <BodyMap
          view={v}
          muscles={styles}
          label=""
          asGroup
          onSelect={(id) => byId.has(id) && pick(id)}
        />
        {L.callouts.map((c) => {
          const m = byId.get(c.id)!;
          const left = c.side === "l";
          const bx = left ? -SIDE_W + 2 : L.vw + SIDE_W - 2 - BOX_W;
          const ex = left ? bx + BOX_W : bx;
          const active = c.id === sel;
          const hue = tone(m.hours);
          return (
            <g
              key={c.id}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`${nameOf(v, c.id)}: ${readyText(m.hours, now)}`}
              style={{ cursor: "pointer" }}
              onClick={() => pick(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(c.id);
                }
              }}
            >
              <line
                x1={c.ax}
                y1={c.ay}
                x2={ex}
                y2={c.y + BOX_H / 2}
                stroke={active ? "var(--fg)" : "var(--fg-muted)"}
                strokeWidth={active ? 0.8 : 0.5}
              />
              <circle cx={c.ax} cy={c.ay} r={1.6} fill="var(--fg)" />
              <rect
                x={bx}
                y={c.y}
                width={BOX_W}
                height={BOX_H}
                rx={4}
                fill={`color-mix(in srgb, ${hue} 12%, var(--bg-surface))`}
                stroke={active
                  ? "var(--fg)"
                  : `color-mix(in srgb, ${hue} 40%, var(--bg-surface))`}
                strokeWidth={active ? 1.2 : 0.6}
              />
              <text
                x={bx + 8}
                y={c.y + 11.5}
                fontSize={8.5}
                fontWeight={500}
                fill="var(--fg)"
              >
                {nameOf(v, c.id)}
              </text>
              <text
                x={bx + 8}
                y={c.y + 21}
                fontSize={6.5}
                fill="var(--fg-secondary)"
              >
                {readyText(m.hours, now)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <ChartShell
      title="Recovery map"
      flat={flat}
      head={["Muscle", "Ready"]}
      rows={order.map((m) => [NAMES[m.id] ?? m.id, readyText(m.hours, now)])}
      label={`Recovery by muscle. ${
        order.map((m) => `${NAMES[m.id] ?? m.id} ${readyText(m.hours, now)}`)
          .join(", ")
      }.`}
    >
      {both
        ? (
          <div className="map-pair">
            {renderMap("front")}
            {renderMap("back")}
          </div>
        )
        : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                whiteSpace: "nowrap",
              }}
            >
              <SegmentedControl
                label="Body view"
                value={view}
                onPick={setView}
                options={[{ value: "front", label: "Front" }, {
                  value: "back",
                  label: "Back",
                }]}
              />
            </div>
            <div style={{ maxWidth: 480, margin: "20px auto 0" }}>
              {renderMap(view)}
            </div>
          </>
        )}
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginTop: 10,
        }}
      >
        <span className="kbd-hint">Ready</span>
        <span style={{ display: "flex", gap: 2 }}>
          {STEPS.map((_, k) => (
            <i
              key={k}
              style={{
                width: 22,
                height: 8,
                background: `var(--rec-${k})`,
                borderRadius: k === 0
                  ? "4px 0 0 4px"
                  : k === STEPS.length - 1
                  ? "0 4px 4px 0"
                  : 0,
              }}
            />
          ))}
        </span>
        <span className="kbd-hint">2+ days</span>
      </div>
      {byId.has(sel) && (
        <DecayPanel
          name={both && sel === "back" ? "Back" : nameOf(view, sel)}
          hours={byId.get(sel)!.hours}
          index={order.findIndex((m) => m.id === sel)}
          count={order.length}
          now={now}
          onStep={step}
        />
      )}
    </ChartShell>
  );
}

function DecayPanel({ name, hours, index, count, now, onStep }: {
  name: string;
  hours: number;
  index: number;
  count: number;
  now: Date;
  onStep: (by: number) => void;
}) {
  const down = useRef<number | null>(null);
  const W = 320, H = 160, L = 36, R = 10, T = 10, B = 26;
  const ready = hours <= 0;
  // Level at "now", in units of the ready line. Ready muscles start under it.
  const l0 = ready ? 0.55 : Math.exp(hours / TAU);
  const top = Math.max(l0, 1) * 1.12;
  const x = (h: number) => L + (h / FULL) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  let d = "";
  for (let h = 0; h <= FULL; h += 3) {
    d += `${h ? "L" : "M"}${x(h).toFixed(1)} ${
      y(l0 * Math.exp(-h / TAU)).toFixed(1)
    }`;
  }
  const day = (h: number) =>
    new Date(now.getTime() + h * 3600_000).toLocaleDateString("en-US", {
      weekday: "short",
    });
  return (
    <div
      className="decay-panel"
      style={{
        marginTop: 24,
        borderTop: "var(--border-width, 1px) solid var(--border)",
        paddingTop: 20,
        touchAction: "pan-y",
      }}
      onPointerDown={(e) => (down.current = e.clientX)}
      onPointerUp={(e) => {
        if (down.current === null) return;
        const dx = e.clientX - down.current;
        down.current = null;
        if (Math.abs(dx) > 40) onStep(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => (down.current = null)}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button
          type="button"
          className="link-btn"
          style={{ fontSize: 28, lineHeight: 1, padding: "4px 14px" }}
          aria-label="Previous muscle"
          onClick={() => onStep(-1)}
        >
          ‹
        </button>
        <div style={{ textAlign: "center" }}>
          <div className="title" style={{ fontSize: 18, color: "var(--fg)" }}>
            {name}
          </div>
          <div className="kbd-hint">
            {readyText(hours, now)} · {index + 1} of {count}
          </div>
        </div>
        <button
          type="button"
          className="link-btn"
          style={{ fontSize: 28, lineHeight: 1, padding: "4px 14px" }}
          aria-label="Next muscle"
          onClick={() => onStep(1)}
        >
          ›
        </button>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={ready
          ? `${name} is already under the ready line.`
          : `${name} fatigue falls under the ready line ${day(hours)}.`}
        style={{ display: "block", marginTop: 14 }}
      >
        <rect
          x={L}
          y={y(1)}
          width={W - L - R}
          height={H - B - y(1)}
          fill="var(--viz-3)"
          opacity={0.1}
        />
        <line
          x1={L}
          x2={W - R}
          y1={y(1)}
          y2={y(1)}
          stroke="var(--viz-3)"
          strokeDasharray="4 3"
        />
        <text
          x={W - R - 6}
          y={H - B - 7}
          fontSize={10}
          textAnchor="end"
          fill="var(--fg-secondary)"
        >
          Good to train
        </text>
        <line x1={L} x2={L} y1={T} y2={H - B} stroke="var(--fg-faint)" />
        <line
          x1={L}
          x2={W - R}
          y1={H - B}
          y2={H - B}
          stroke="var(--fg-faint)"
        />
        <text
          x={L - 6}
          y={T + 8}
          fontSize={9}
          textAnchor="end"
          fill="var(--fg-muted)"
        >
          High
        </text>
        <text
          x={L - 6}
          y={H - B - 2}
          fontSize={9}
          textAnchor="end"
          fill="var(--fg-muted)"
        >
          Low
        </text>
        <text
          transform={`translate(9 ${(T + H - B) / 2}) rotate(-90)`}
          fontSize={10}
          textAnchor="middle"
          fill="var(--fg-secondary)"
        >
          Fatigue
        </text>
        <path
          d={d}
          fill="none"
          stroke={tone(hours)}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={x(0)} cy={y(l0)} r={4} fill={tone(hours)} />
        {!ready && (
          <g>
            <line
              x1={x(hours)}
              x2={x(hours)}
              y1={y(1)}
              y2={H - B}
              stroke="var(--fg)"
              strokeDasharray="2 3"
            />
            <circle
              cx={x(hours)}
              cy={y(1)}
              r={4.5}
              fill="var(--bg-surface)"
              stroke="var(--fg)"
              strokeWidth={2}
            />
          </g>
        )}
        <text x={x(0)} y={H - 8} fontSize={10} fill="var(--fg-muted)">Now</text>
        {[24, 48, 72].map((h) => (
          <text
            key={h}
            x={x(h)}
            y={H - 8}
            fontSize={10}
            textAnchor={h === 72 ? "end" : "middle"}
            fill="var(--fg-muted)"
          >
            {day(h)}
          </text>
        ))}
      </svg>
      <p
        className="kbd-hint"
        style={{ margin: "12px 0 0", textAlign: "center" }}
      >
        Tap a muscle or swipe to compare.
      </p>
    </div>
  );
}
