/* Shared components, one anatomy for both shells (DESIGN 5). Phone pages
 * render these at 44px touch targets; desktop reuses them in wider grids. */

import type { ReactNode } from "react";
import { plateColor } from "../logic/plateShorthand.ts";

export function Card({
  title,
  hero,
  children,
}: {
  title?: string;
  hero?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={hero ? "card hero" : "card flat-rest"}>
      {title ? <h2 className="card-title title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Group({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="group" aria-label={label}>
      <div className="group-head">
        <span className="group-label">{label}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export function GroupRow({ children }: { children: ReactNode }) {
  return <div className="group-row">{children}</div>;
}

export function PrimaryButton({
  children,
  large,
  onClick,
  href,
  label,
}: {
  children: ReactNode;
  large?: boolean;
  onClick?: () => void;
  href?: string;
  label?: string;
}) {
  const cls = large ? "btn-primary large" : "btn-primary";
  if (href !== undefined) {
    return (
      <a className={cls} href={href} aria-label={label}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  if (href !== undefined) {
    return (
      <a className="btn-secondary" href={href}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className="btn-secondary" onClick={onClick}>
      {children}
    </button>
  );
}

export function Chip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className={onRemove ? "chip chip-removable" : "chip"}>
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatTiles({
  tiles,
}: {
  tiles: { value: string; delta?: string; label: string }[];
}) {
  return (
    <div className="stat-tiles">
      {tiles.map((t) => (
        <div className="stat-tile" key={t.label}>
          <div className="v figure">{t.value}</div>
          {t.delta ? <div className="d">{t.delta}</div> : null}
          <div className="l">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

export function ProgressSegments({
  total,
  done,
  current,
  label,
}: {
  total: number;
  done: number;
  current: number;
  label: string;
}) {
  return (
    <div className="seg-progress" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={
            i < done ? "seg-cell filled" : i === current ? "seg-cell current" : "seg-cell"
          }
        />
      ))}
    </div>
  );
}

export function NoteCard({
  date,
  text,
  pinned,
  onGotIt,
  onPin,
  onResolve,
}: {
  date: string;
  text: string;
  pinned: boolean;
  onGotIt: () => void;
  onPin: () => void;
  onResolve: () => void;
}) {
  return (
    <div className="note-card">
      <div className="note-head">
        <span aria-hidden="true">▦</span>
        <span>
          Note · {date}
          {pinned ? " · pinned" : ""}
        </span>
      </div>
      <div>{text}</div>
      <div className="row-btns" style={{ marginTop: 8 }}>
        <button type="button" className="chip" onClick={onGotIt}>
          Got it
        </button>
        <button type="button" className="chip" onClick={onPin}>
          {pinned ? "Unpin" : "Pin"}
        </button>
        <button type="button" className="chip" onClick={onResolve}>
          Resolved
        </button>
      </div>
    </div>
  );
}

export function PlateChips({ plates }: { plates: number[] }) {
  if (plates.length === 0) return <span className="kbd-hint">bar only</span>;
  return (
    <span>
      {plates.map((p, i) => {
        const c = plateColor(p);
        return (
          <span
            key={`${p}-${i}`}
            className="plate-chip"
            style={{ background: c.bg, color: c.ink }}
            title={`${p} lb plate`}
          >
            {p}
          </span>
        );
      })}
    </span>
  );
}

/** One side of the bar: sleeve left, collar + bar label right, heaviest
 * plates innermost, every plate labeled (DESIGN 5.8). */
export function PlateDrawing({
  perSide,
  barWeight = 45,
  label,
}: {
  perSide: number[];
  barWeight?: number;
  label?: string;
}) {
  const maxP = Math.max(45, ...perSide);
  const heightOf = (p: number) => 24 + Math.round((64 * (p - 2.5)) / Math.max(1, maxP - 2.5));
  const widthOf = (p: number) => (p >= 25 ? 16 : 10);
  let x = 46;
  const plates = perSide.map((p) => {
    const w = widthOf(p);
    const h = heightOf(p);
    const el = { p, x, w, h };
    x += w + 2;
    return el;
  });
  const midY = 60;
  const totalW = x + 90;
  return (
    <figure style={{ margin: "8px 0" }} aria-label={label ?? `Bar with ${perSide.join(", ")} per side`}>
      <svg viewBox={`0 0 ${totalW} 120`} width="100%" role="img">
        {/* sleeve */}
        <rect x={4} y={midY - 5} width={44} height={10} fill="var(--bar)" />
        {plates.map((pl, i) => {
          const c = plateColor(pl.p);
          const tall = pl.h > 52;
          return (
            <g key={i}>
              <rect
                x={pl.x}
                y={midY - pl.h / 2}
                width={pl.w}
                height={pl.h}
                fill={c.bg}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
              <text
                x={tall ? pl.x + pl.w / 2 : pl.x + pl.w + 3}
                y={tall ? midY : midY + pl.h / 2 + 12}
                fontSize={10}
                fill={tall ? c.ink : "var(--fg)"}
                textAnchor={tall ? "middle" : "start"}
                transform={tall ? `rotate(-90 ${pl.x + pl.w / 2} ${midY})` : undefined}
              >
                {pl.p}
              </text>
            </g>
          );
        })}
        {/* collar + bar label */}
        <rect x={x + 2} y={midY - 12} width={8} height={24} fill="var(--bar-collar)" />
        <text x={x + 14} y={midY + 4} fontSize={11} fill="var(--fg)">
          {barWeight} bar
        </text>
      </svg>
    </figure>
  );
}

export function EngineBanner({
  text,
  engine,
  coach,
  onRevert,
}: {
  text: string;
  engine: string;
  coach: string;
  onRevert: () => void;
}) {
  return (
    <div className="banner">
      <div>{text}</div>
      <div className="why">
        engine {engine} · coach {coach}
      </div>
      <button type="button" className="link-btn" onClick={onRevert}>
        Revert to engine
      </button>
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
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
  );
}

export function OfflineBadge({ online, pending }: { online: boolean; pending: number }) {
  return (
    <span className="kbd-hint" role="status">
      <span className={online ? "offline-dot" : "offline-dot off"} aria-hidden="true" />
      {online ? "live" : "offline"}
      {pending > 0 ? ` · ${pending} queued` : ""}
    </span>
  );
}
