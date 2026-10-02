/* Load zoom (DESIGN 6.3, 6.5, DECISIONS U27): one workouts chart that zooms
 * Day, Week, 3 weeks and Block, drawn in the U25 look. The geometry is
 * `frame()` in logic/loadZoom.ts, a pure function of the block's days and a
 * camera {z, anchor}; this file draws it, moves the camera and owns the
 * gestures. A day is a lift piece under a run piece: the planned part is a
 * tint inside a hairline, the part done is filled, a week still to come is
 * hatched. Today's chip and the hover tooltip are frosted glass, which needs
 * HTML, so they sit in an overlay over the SVG.
 *
 * Moving: the picker (ZoomPicker, placed by the page) eases to a level, a
 * pinch (two pointers, or ctrl-wheel and a trackpad pinch) follows the fingers
 * and snaps to the nearest level on release, a sideways swipe or shift-wheel
 * steps through time, and the plot is focusable (left and right move the
 * inspected day, - and + change level). Hover shows the tooltip and a click
 * pins it. Vertical page scroll and a plain wheel are never taken. */

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  anchorFor,
  type Bar,
  blockModel,
  type Box,
  centerShift,
  clamp,
  defaultAnchor,
  describeInspected,
  easeOutQuart,
  frame,
  groupLabel,
  hitAt,
  inspectDay,
  type Label,
  type Level,
  LEVEL_LABELS,
  panAnchor,
  panStep,
  parseZ,
  SETTLE_MS,
  snapLevel,
  stepInspect,
  tableFor,
  tipAlign,
  tipFor,
  tweenMs,
  weekOf,
  windowDays,
  zFromPinch,
} from "../../logic/loadZoom.ts";
import type { WeekLoad } from "../../store/types.ts";
import { ChartShell } from "./ChartShell.tsx";
import { Plot } from "./Plot.tsx";

/** Space above the plot for the week ruler, then for today's chip and the
 * lifted bar (U25), and below it for the day letters. The track itself is the
 * `height` prop. */
const RULER_H = 20;
const HEADROOM = 34;
const LABEL_H = 26;
const TOP = RULER_H + HEADROOM;

/** Pinch and wheel: how far a gesture moves z. */
const WHEEL_Z_PER_PX = 0.01;
const WHEEL_IDLE_MS = 150;
const PAN_PX = 8;
const PAN_COMMIT = 0.3;

const LEVEL_OPTIONS = LEVEL_LABELS.map((label, i) => ({
  value: i as Level,
  label,
}));

/** The Day / Week / Month / Block picker. The page places it (on the title row
 * of the Overview lede); the chart takes the level as a prop. A sliding ink
 * thumb marks the level; left and right step it. */
export function ZoomPicker(
  { level, onLevel }: { level: Level; onLevel: (level: Level) => void },
) {
  const last = LEVEL_OPTIONS.length - 1;
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown"
      ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp"
      ? -1
      : 0;
    if (!step) return;
    e.preventDefault();
    const next = clamp(level + step, 0, last) as Level;
    onLevel(next);
    e.currentTarget.querySelectorAll("button")[next]?.focus();
  };
  return (
    <div
      className="lz-picker"
      role="radiogroup"
      aria-label="Zoom level"
      style={{ "--i": level } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      {LEVEL_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === level}
          tabIndex={o.value === level ? 0 : -1}
          onClick={() => onLevel(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Tween {
  from: number;
  to: number;
  t0: number;
  ms: number;
}

function prefersReducedMotion() {
  return typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The camera's z and pan offset, eased with requestAnimationFrame. The
 * global reduced-motion rule in index.css cannot reach a JS tween, so this
 * asks `matchMedia` itself and snaps. Retargeting mid-tween starts from the
 * current value. */
function useZoomTween(level: Level, anchor: number, count: number) {
  const [view, setView] = useState({ z: level as number, offset: 0 });
  const [settled, setSettled] = useState<Level>(level);
  const now = useRef({ z: level as number, offset: 0, anchor, target: level });
  const tweens = useRef<{ z: Tween | null; offset: Tween | null }>({
    z: null,
    offset: null,
  });
  const raf = useRef(0);

  const publish = () =>
    setView({ z: now.current.z, offset: now.current.offset });

  const step = useCallback((t: number) => {
    raf.current = 0;
    let active = false;
    for (const key of ["z", "offset"] as const) {
      const tw = tweens.current[key];
      if (!tw) continue;
      const k = (t - tw.t0) / tw.ms;
      if (k >= 1) {
        now.current[key] = tw.to;
        tweens.current[key] = null;
        if (key === "z") setSettled(snapLevel(tw.to));
      } else {
        now.current[key] = tw.from + (tw.to - tw.from) * easeOutQuart(k);
        active = true;
      }
    }
    publish();
    if (active) raf.current = requestAnimationFrame(step);
  }, []);

  const run = useCallback((key: "z" | "offset", to: number, ms: number) => {
    if (ms <= 0 || prefersReducedMotion()) {
      tweens.current[key] = null;
      now.current[key] = to;
      if (key === "z") setSettled(snapLevel(to));
      publish();
      return;
    }
    tweens.current[key] = {
      from: now.current[key],
      to,
      t0: performance.now(),
      ms,
    };
    if (!raf.current) raf.current = requestAnimationFrame(step);
  }, [step]);

  const settle = useCallback((to: Level, ms?: number) => {
    now.current.target = to;
    run("z", to, ms ?? tweenMs(now.current.z, to));
  }, [run]);

  /** Follow the fingers: z moves with no easing. */
  const setLive = useCallback((z: number) => {
    tweens.current.z = null;
    now.current.z = z;
    publish();
  }, []);

  const setOffsetLive = useCallback((offset: number) => {
    tweens.current.offset = null;
    now.current.offset = offset;
    publish();
  }, []);

  const releaseOffset = useCallback(() => run("offset", 0, SETTLE_MS), [run]);

  useEffect(() => {
    if (now.current.target !== level) settle(level);
  }, [level, settle]);

  // A new anchor keeps the picture still, then eases to the new window.
  useEffect(() => {
    const prev = now.current.anchor;
    if (prev === anchor) return;
    now.current.anchor = anchor;
    now.current.offset += centerShift(count, now.current.z, prev, anchor);
    run("offset", 0, 280);
  }, [anchor, count, run]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return {
    z: view.z,
    offset: view.offset,
    settled,
    now,
    settle,
    setLive,
    setOffsetLive,
    releaseOffset,
  };
}

/** One piece: planned tint inside a hairline, the part done filled from the
 * baseline, hatched instead when its week is still to come. A piece resting on
 * another loses its bottom pixel to a surface-coloured seam; `cap` is how much
 * of the top hairline and rounded corners shows. */
function PieceMark({ bar, hatch }: { bar: Bar; hatch: string }) {
  const x = Math.round(bar.x);
  const w = Math.max(1, Math.round(bar.x + bar.w) - x);
  if (bar.kind === "rest") {
    return (
      <rect className="lz-rest" x={x} y={bar.y} width={w} height={bar.h} />
    );
  }
  // Stacked pieces share an edge, so snap both edges to whole pixels: a
  // fractional edge lets the page show through as a faint line between them.
  const y = Math.round(bar.y);
  const bottom = Math.round(bar.y + bar.h);
  const h = bottom - y;
  if (h < 1) return null;
  const r = Math.min(3, w / 2, h / 2) * bar.cap;
  // A day's lift domes up into its run, whose bottom is hollowed to match: one
  // gentle curve between the two. `sag` is how far the middle moves, and it
  // can't be more than the piece can spare.
  const sag = Math.min(bar.joint, h / 2);
  const mid = x + w / 2;
  const domed = bar.kind === "lift" && sag > 0.1;
  const hollow = bar.kind === "run" && sag > 0.1;
  const top = domed
    ? `V${y} Q${mid},${y - 2 * sag} ${x + w},${y}`
    : `V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${
      x + w
    },${y + r}`;
  const foot = hollow ? `Q${mid},${bottom - 2 * sag} ${x},${bottom}` : "";
  const shape = `M${x},${bottom} ${top} V${bottom} ${foot} Z`;
  const fh = Math.min(bar.fillH, h);
  // A run part-done fills from its hollow up, so it never fills less than the
  // hollow is deep.
  const partial = hollow
    ? `M${x},${bottom} Q${mid},${bottom - 2 * sag} ${x + w},${bottom} V${
      bottom - Math.max(fh, sag)
    } H${x} Z`
    : `M${x},${bottom} V${bottom - fh} H${x + w} V${bottom} Z`;
  return (
    <>
      <path
        className={bar.future ? "lz-tint future" : "lz-tint"}
        d={shape}
        fill={bar.future ? `url(#${hatch})` : undefined}
      />
      {!bar.future && fh > 0.5
        ? (
          <path
            className="lz-fill"
            d={fh >= h - 0.5 ? shape : partial}
          />
        )
        : null}
      <path
        className="lz-hair"
        d={`M${x + 0.5},${bottom} V${y + r} M${x + w - 0.5},${bottom} V${
          y + r
        }`}
      />
      {bar.cap > 0.01
        ? (
          <path
            className="lz-hair"
            opacity={bar.cap}
            d={`M${x + 0.5},${y + r} Q${x + 0.5},${y + 0.5} ${x + r},${
              y + 0.5
            } H${x + w - r} Q${x + w - 0.5},${y + 0.5} ${x + w - 0.5},${y + r}`}
          />
        )
        : null}
    </>
  );
}

/** A day letter, week number or session name under the plot. Today's is
 * reversed out of an ember square (U25). */
function TextMark({ label, plotH }: { label: Label; plotH: number }) {
  const cls = `${label.today ? " today" : ""}${label.muted ? " muted" : ""}${
    label.knockout ? " knockout" : ""
  }${label.session ? " session" : ""}`;
  return (
    <g opacity={label.opacity}>
      {label.knockout
        ? (
          <rect
            className="lz-knock"
            x={label.x - 8}
            y={plotH + 6}
            width={16}
            height={15}
            rx={2}
          />
        )
        : null}
      <text
        className={`lz-letter${cls}`}
        x={label.x}
        y={plotH + 17}
        textAnchor="middle"
      >
        {label.text}
      </text>
    </g>
  );
}

export function LoadZoom(
  { weeks, level, onLevel, anchor, onAnchor, title = "Workouts", flat, height }:
    {
      weeks: WeekLoad[];
      level: Level;
      onLevel: (level: Level) => void;
      /** The day in focus, when the page holds it (the toolbar's week switcher
       * moves it too). Starts at today when left out. */
      anchor?: number;
      onAnchor?: (anchor: number) => void;
      title?: string;
      flat?: boolean;
      /** The track's height; the ruler, headroom and letters sit around it. */
      height: number;
    },
) {
  const model = useMemo(() => blockModel(weeks), [weeks]);
  const count = model.days.length;
  const [own, setOwn] = useState(() =>
    clamp(anchor ?? defaultAnchor(model), 0, Math.max(0, count - 1))
  );
  const mine = anchor === undefined
    ? own
    : clamp(anchor, 0, Math.max(0, count - 1));
  const cam = useZoomTween(level, mine, count);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  // A hover belongs to the slot the pointer was over; a new level has new
  // slots, so it waits for the next move.
  useEffect(() => setHover(null), [level]);
  const liveId = useId();
  const hatch = `lz-hatch-${useId().replace(/[^\w-]/g, "")}`;

  // ?z= pins the camera for screenshots (dev builds only).
  const forced = useMemo(
    () =>
      import.meta.env.DEV && typeof location !== "undefined"
        ? parseZ(location.search)
        : null,
    [],
  );
  const z = forced ?? cam.z;
  const shown: Level = forced !== null ? snapLevel(forced) : level;

  const setAnchor = useCallback((next: number) => {
    setOwn(next);
    onAnchor?.(next);
  }, [onAnchor]);

  // Handlers read the latest state through one ref, so the native wheel
  // listener and pointer handlers never go stale.
  const latest = useRef({
    model,
    level,
    mine,
    z,
    box: { width: 0, height } as Box,
    setAnchor,
    onLevel,
    cam,
  });
  latest.current = {
    model,
    level,
    mine,
    z,
    box: latest.current.box,
    setAnchor,
    onLevel,
    cam,
  };

  const pinnedHere = pinned !== null &&
      (shown === 0
        ? pinned === mine
        : shown === 1
        ? weekOf(pinned) === weekOf(mine)
        : true)
    ? pinned
    : null;
  const defaultDay = shown === 0 ? mine : inspectDay(model, weekOf(mine));
  const picked = hover ?? pinnedHere;
  const inspected = picked ?? defaultDay;
  const liveText = describeInspected(model, cam.settled, inspected, mine).text;
  const table = tableFor(model, shown, mine);
  const tip = picked === null ? null : tipFor(model, shown, picked, mine);

  // ---- gestures ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    kind: "none" as "none" | "pan" | "pinch" | "dead",
    startX: 0,
    startY: 0,
    startOffset: 0,
    z0: 0,
    d0: 1,
    moved: false,
  });

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  const finishZoom = () => {
    const l = snapLevel(latest.current.cam.now.current.z);
    latest.current.cam.settle(l, SETTLE_MS);
    latest.current.onLevel(l);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.kind = "none";
      g.moved = false;
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.startOffset = latest.current.cam.now.current.offset;
    } else if (pointers.current.size === 2) {
      g.kind = "pinch";
      g.moved = true;
      g.d0 = distance();
      g.z0 = latest.current.cam.now.current.z;
      for (const id of pointers.current.keys()) {
        e.currentTarget.setPointerCapture(id);
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const p = pointers.current.get(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    if (!p) {
      if (e.pointerType === "mouse") {
        const f = frame(
          latest.current.model,
          { z: latest.current.z, anchor: latest.current.mine },
          latest.current.box,
        );
        const hit = hitAt(f, e.clientX - rect.left);
        setHover(hit ? hit.day : null);
      }
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      latest.current.cam.setLive(zFromPinch(g.z0, distance() / g.d0));
      return;
    }
    if (pointers.current.size !== 1) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (
      g.kind === "none" && Math.abs(dx) > PAN_PX &&
      Math.abs(dx) > Math.abs(dy) * 1.2 &&
      panStep(latest.current.level) > 0
    ) {
      g.kind = "pan";
      g.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (g.kind === "pan") {
      const { model: m, box: b } = latest.current;
      const ppd = b.width / windowDays(latest.current.z, m.days.length);
      latest.current.cam.setOffsetLive(g.startOffset - dx / ppd);
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    const { cam: c, model: m, level: lv, mine: a } = latest.current;
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) {
        finishZoom();
        g.kind = "dead";
      }
    } else if (g.kind === "pan" && pointers.current.size === 0) {
      const step = panStep(lv);
      const off = c.now.current.offset;
      const dir = off > step * PAN_COMMIT
        ? 1
        : off < -step * PAN_COMMIT
        ? -1
        : 0;
      const next = panAnchor(m, a, lv, dir);
      g.kind = "none";
      setPinned(null);
      if (next !== a) latest.current.setAnchor(next);
      else c.releaseOffset();
    }
    if (pointers.current.size === 0 && g.kind === "dead") g.kind = "none";
  };

  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (gesture.current.moved) {
      gesture.current.moved = false;
      return;
    }
    const { model: m, z: zNow, mine: a, box } = latest.current;
    const f = frame(m, { z: zNow, anchor: a }, box);
    const hit = hitAt(
      f,
      e.clientX - e.currentTarget.getBoundingClientRect().left,
    );
    if (hit) setPinned((p) => (p === hit.day ? null : hit.day));
  };

  const onKeyDown = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    const { model: m, level: lv, mine: a } = latest.current;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const from = pinnedHere ?? (lv === 0 ? a : inspectDay(m, weekOf(a)));
      const next = stepInspect(m, lv, from, e.key === "ArrowRight" ? 1 : -1);
      setPinned(next);
      const to = anchorFor(m, lv, a, next);
      if (to !== a) latest.current.setAnchor(to);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      latest.current.onLevel(Math.min(3, lv + 1) as Level);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      latest.current.onLevel(Math.max(0, lv - 1) as Level);
    } else if (e.key === "Escape") {
      setPinned(null);
    }
  };

  // The wheel needs a non-passive listener: React's onWheel is passive, so a
  // ctrl-wheel (trackpad pinch) would zoom the page. Only ctrl-wheel and
  // horizontal pans are taken; a plain wheel scrolls the page.
  const wheelCleanup = useRef<(() => void) | null>(null);
  const attachWheel = useCallback((el: SVGSVGElement | null) => {
    wheelCleanup.current?.();
    wheelCleanup.current = null;
    if (!el) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let acc = 0;
    let lastStep = 0;
    const onWheel = (e: WheelEvent) => {
      const px = e.deltaMode === 1 ? 16 : 1;
      const c = latest.current;
      if (e.ctrlKey) {
        e.preventDefault();
        const z0 = c.cam.now.current.z;
        c.cam.setLive(clamp(z0 + e.deltaY * px * WHEEL_Z_PER_PX, 0, 3));
        clearTimeout(idle);
        idle = setTimeout(() => {
          const l = snapLevel(latest.current.cam.now.current.z);
          latest.current.cam.settle(l, SETTLE_MS);
          latest.current.onLevel(l);
        }, WHEEL_IDLE_MS);
        return;
      }
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      if (
        dx === 0 || (!e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY))
      ) {
        return;
      }
      if (panStep(c.level) === 0) return;
      e.preventDefault();
      const t = performance.now();
      if (t - lastStep < 250) return;
      acc += dx * px;
      if (Math.abs(acc) < 50) return;
      const next = panAnchor(c.model, c.mine, c.level, acc > 0 ? 1 : -1);
      acc = 0;
      lastStep = t;
      if (next !== c.mine) {
        setPinned(null);
        c.setAnchor(next);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    wheelCleanup.current = () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(idle);
    };
  }, []);
  useEffect(() => () => wheelCleanup.current?.(), []);

  return (
    <ChartShell
      title={title}
      head={table.head}
      rows={table.rows}
      label={groupLabel(model, shown, mine)}
      flat={flat}
    >
      <div className="load-zoom">
        <Plot height={TOP + height + LABEL_H}>
          {(width) => {
            const box: Box = { width, height };
            latest.current.box = box;
            const f = frame(model, {
              z,
              anchor: mine,
              offset: forced !== null ? 0 : cam.offset,
            }, box);
            const pick = picked === null
              ? null
              : f.hits.find((h) =>
                z >= 2.5 ? h.week === weekOf(picked) : h.day === picked
              );
            const lifted = (b: Bar) =>
              pick !== null && pick !== undefined &&
              (z >= 2.5 ? b.week === pick.week : b.layer === "day" &&
                b.slot === pick.day);
            const chip = f.today && f.today.opacity > 0.01 &&
                picked !== model.today
              ? f.today
              : null;
            const [chipDay, chipSession] = chip
              ? chip.text.split(" · ")
              : ["", ""];
            // The workout leads the chip, the day is the small word after it.
            const chipLead = chipSession || chipDay;
            const chipTail = chipSession ? chipDay : "";
            return (
              <>
                <svg
                  ref={attachWheel}
                  className="lz-svg"
                  width={width}
                  height={TOP + height + LABEL_H}
                  role="img"
                  aria-label={groupLabel(model, shown, mine)}
                  aria-describedby={liveId}
                  tabIndex={0}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerEnd}
                  onPointerCancel={onPointerEnd}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") setHover(null);
                  }}
                  onClick={onClick}
                  onKeyDown={onKeyDown}
                >
                  <defs>
                    <pattern
                      id={hatch}
                      width={7}
                      height={7}
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <rect className="lz-hatch" width={3} height={7} />
                    </pattern>
                  </defs>
                  <g transform={`translate(0 ${TOP})`}>
                    {pick
                      ? (
                        <rect
                          className="lz-pick"
                          x={Math.max(pick.x, 0)}
                          y={-6}
                          width={Math.min(pick.x + pick.w, width) -
                            Math.max(pick.x, 0)}
                          height={height + LABEL_H + 6}
                          rx={4}
                        />
                      )
                      : null}
                    {f.dividers.map((d) => (
                      <line
                        key={d.key}
                        className="lz-divider"
                        x1={d.x}
                        x2={d.x}
                        y1={0}
                        y2={height + LABEL_H}
                        opacity={d.opacity}
                      />
                    ))}
                    <line
                      className="lz-base"
                      x1={0}
                      x2={width}
                      y1={height + 0.5}
                      y2={height + 0.5}
                    />
                    {f.bars.filter((b) => b.opacity > 0.004).map((b) => (
                      <g
                        key={b.key}
                        className={`lz-piece ${b.kind}${
                          b.future ? " future" : ""
                        }${lifted(b) ? " lifted" : ""}`}
                        opacity={b.opacity}
                      >
                        <PieceMark bar={b} hatch={hatch} />
                      </g>
                    ))}
                    {f.labels.filter((l) => l.row === "text").map((l) => (
                      <TextMark key={l.key} label={l} plotH={height} />
                    ))}
                  </g>
                </svg>
                <div className="lz-overlay" aria-hidden={false}>
                  {f.labels.filter((l) => l.row === "ruler").map((l) => {
                    const week = Number(l.key.slice(1));
                    return (
                      <button
                        key={l.key}
                        type="button"
                        className={`lz-ruler${l.today ? " current" : ""}${
                          week === weekOf(mine) ? " focus" : ""
                        }`}
                        style={{
                          left: l.x - 6,
                          opacity: l.opacity,
                          pointerEvents: l.opacity > 0.3 ? "auto" : "none",
                        }}
                        tabIndex={l.opacity > 0.3 ? 0 : -1}
                        onClick={() => {
                          setPinned(null);
                          setAnchor(inspectDay(model, week));
                        }}
                      >
                        <span className="lz-ruler-name">{l.text}</span>
                        {l.sub
                          ? <span className="lz-ruler-range">{l.sub}</span>
                          : null}
                      </button>
                    );
                  })}
                  {chip
                    ? (
                      <div
                        className={`lz-glass lz-chip ${
                          tipAlign(chip.x, width)
                        }`}
                        style={{
                          left: chip.x,
                          top: TOP + chip.top - 8,
                          opacity: chip.opacity,
                        }}
                      >
                        <i />
                        {chipLead}
                        {chipTail ? <small>{chipTail}</small> : null}
                      </div>
                    )
                    : null}
                  {pick && tip
                    ? (
                      <div
                        className={`lz-glass lz-tip on ${
                          tipAlign(pick.x + pick.w / 2, width)
                        }`}
                        style={{
                          left: clamp(pick.x + pick.w / 2, 0, width),
                          top: TOP + pick.top - 11,
                        }}
                      >
                        <b>{tip.title}</b>
                        <span>{tip.numbers}</span>
                      </div>
                    )
                    : null}
                </div>
              </>
            );
          }}
        </Plot>
        <p id={liveId} className="sr-only" aria-live="polite">
          {liveText}
        </p>
      </div>
    </ChartShell>
  );
}
