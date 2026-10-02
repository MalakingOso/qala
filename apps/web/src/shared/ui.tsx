/* Shared components, one anatomy for both shells (DESIGN 5). Phone pages
 * render these at 44px touch targets; desktop reuses them in wider grids. */

import type { ReactNode } from "react";
import type { MemoryProposal } from "../store/types.ts";
import { Minus, Plus, StickyNote } from "./icons.ts";

export { PlateChips, PlateDrawing } from "./plates.tsx";

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
  disabled,
}: {
  children: ReactNode;
  large?: boolean;
  onClick?: () => void;
  href?: string;
  label?: string;
  disabled?: boolean;
}) {
  const cls = large ? "btn-primary large" : "btn-primary";
  if (disabled) {
    return (
      <button
        type="button"
        className={cls}
        disabled
        aria-label={label}
        aria-disabled="true"
      >
        {children}
      </button>
    );
  }
  if (href !== undefined) {
    return (
      <a className={cls} href={href} aria-label={label} onClick={onClick}>
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

/** Bordered surface button. `small` is the header-sized variant (Finish,
 * Skip, Edit) that sits beside a title instead of spanning the card. */
export function SecondaryButton({
  children,
  onClick,
  href,
  small,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  small?: boolean;
  label?: string;
}) {
  const cls = small ? "btn-secondary small" : "btn-secondary";
  if (href !== undefined) {
    return (
      <a className={cls} href={href} onClick={onClick} aria-label={label}>
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

export function Chip(
  { children, onRemove }: { children: ReactNode; onRemove?: () => void },
) {
  return (
    <span className={onRemove ? "chip chip-removable" : "chip"}>
      {children}
      {onRemove
        ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        )
        : null}
    </span>
  );
}

/** On/off switch: square-cornered, ember when on (DESIGN 5.5). */
export function Toggle(
  { on, onFlip, label }: { on: boolean; onFlip: () => void; label: string },
) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="toggle"
      onClick={onFlip}
    >
      <span className="knob" aria-hidden="true" />
    </button>
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

/** Workout progress: one segment per exercise, filled per completed set,
 * the current one outlined. Each segment is a button that jumps to that
 * exercise (DECISIONS U5). */
export function ProgressSegments({
  items,
  current,
  onPick,
}: {
  items: { name: string; done: number; total: number }[];
  current: number;
  onPick?: (index: number) => void;
}) {
  return (
    <div className="seg-progress" role="group" aria-label="Exercises">
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          className={i === current ? "seg-cell current" : "seg-cell"}
          aria-current={i === current ? "step" : undefined}
          aria-label={`${it.name}, ${it.done} of ${it.total} sets`}
          onClick={() => onPick?.(i)}
        >
          <span className="seg-track">
            <span
              className="seg-fill"
              style={{
                width: `${it.total ? (100 * it.done) / it.total : 0}%`,
              }}
            />
          </span>
        </button>
      ))}
    </div>
  );
}

/** One way to pick a value on a scale: recovery, soreness, RPE, effort,
 * theme. A single bordered strip; the picked cell fills with ink. Anchors
 * name the ends of the scale. */
export function ScalePicker<T extends string | number>({
  label,
  options,
  value,
  onPick,
  anchors,
  describe,
}: {
  label: string;
  options: readonly T[] | { value: T; label: string }[];
  value: T | null | undefined;
  onPick: (v: T) => void;
  anchors?: [string, string] | [string, string, string];
  describe?: (v: T) => string | undefined;
}) {
  const opts = (options as readonly unknown[]).map((o) =>
    typeof o === "object" && o !== null
      ? o as { value: T; label: string }
      : { value: o as T, label: String(o) }
  );
  return (
    <div className="scale">
      <div className="scale-strip" role="radiogroup" aria-label={label}>
        {opts.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            title={describe?.(o.value)}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {anchors
        ? (
          <div className="scale-anchors" aria-hidden="true">
            {anchors.map((a) => <span key={a}>{a}</span>)}
          </div>
        )
        : null}
    </div>
  );
}

/** A big figure with bordered - / + buttons under it. */
export function Stepper({
  label,
  value,
  unit,
  onStep,
  step = 1,
}: {
  label: string;
  value: number;
  unit?: string;
  onStep: (delta: number) => void;
  step?: number;
}) {
  return (
    <div className="stepper">
      <span className="group-label">{label}</span>
      <span className="stepper-value figure">
        {value}
        {unit ? <span className="figure-unit">{unit}</span> : null}
      </span>
      <span className="stepper-buttons">
        <button
          type="button"
          aria-label={`Less ${label.toLowerCase()}`}
          onClick={() => onStep(-step)}
        >
          <Minus size={20} />
        </button>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onStep(step)}
        >
          <Plus size={20} />
        </button>
      </span>
    </div>
  );
}

/** A row of secondary actions, each an icon with a short word under it. */
export function ToolBar({
  tools,
}: {
  tools: {
    label: string;
    icon: ReactNode;
    onClick?: () => void;
    href?: string;
    pressed?: boolean;
    tone?: "danger";
  }[];
}) {
  return (
    <div className="toolbar" role="group" aria-label="Exercise tools">
      {tools.map((t) =>
        t.href
          ? (
            <a key={t.label} className="tool" href={t.href}>
              {t.icon}
              <span>{t.label}</span>
            </a>
          )
          : (
            <button
              key={t.label}
              type="button"
              className={t.tone === "danger" ? "tool danger" : "tool"}
              aria-pressed={t.pressed}
              onClick={t.onClick}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          )
      )}
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
        <StickyNote size={16} aria-hidden="true" />
        <span>
          Your note · {date}
          {pinned ? " · pinned" : ""}
        </span>
      </div>
      <p className="note-text">{text}</p>
      <div className="note-actions">
        <button type="button" onClick={onGotIt}>Got it</button>
        <button type="button" onClick={onPin}>
          {pinned ? "Unpin" : "Pin"}
        </button>
        <button type="button" onClick={onResolve}>Resolved</button>
      </div>
    </div>
  );
}

/** A coach adjustment (P3 envelope): what the engine said, what the coach
 * proposes, the reason. Pending, it offers the coach's number; in use, it
 * offers the way back to the engine. */
export function EngineBanner({
  text,
  engine,
  coach,
  pending,
  onAccept,
  onRevert,
}: {
  text: string;
  engine: string;
  coach: string;
  pending?: boolean;
  onAccept?: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="banner">
      <div className="banner-head">
        <span className="group-label">
          {pending ? "Coach suggests" : "Coach adjusted today"}
        </span>
        {pending
          ? (
            <span className="banner-actions">
              <button type="button" className="link-btn" onClick={onRevert}>
                Keep engine
              </button>
              <button type="button" className="chip" onClick={onAccept}>
                Use {coach.split(" ")[0]}
              </button>
            </span>
          )
          : (
            <button type="button" className="link-btn" onClick={onRevert}>
              Use engine
            </button>
          )}
      </div>
      <p className="banner-nums">
        <span className={pending ? undefined : "banner-was"}>{engine}</span>
        <span aria-hidden="true">→</span>
        <strong>{coach}</strong>
      </p>
      <p className="why">{text}</p>
    </div>
  );
}

/** Accept/reject list for coach memory proposals, shared by CoachPage and CoachMemoryPage. */
export function MemoryProposalList({
  memory,
  decideMemory,
  acceptedLabel = "Accepted.",
  rejectedLabel = "Rejected.",
}: {
  memory: MemoryProposal[];
  decideMemory: (id: string, accept: boolean) => void;
  acceptedLabel?: string;
  rejectedLabel?: string;
}) {
  return (
    <ul className="memory-list">
      {memory.map((m) => (
        <li key={m.id}>
          <p className="memory-text">{m.text}</p>
          <p className="kbd-hint">{m.source} · {m.date}</p>
          {m.accepted === null
            ? (
              <div className="memory-actions">
                <button
                  type="button"
                  className="btn-secondary small"
                  onClick={() => decideMemory(m.id, false)}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn-secondary small"
                  onClick={() => decideMemory(m.id, true)}
                >
                  Accept
                </button>
              </div>
            )
            : (
              <p className="memory-done">
                {m.accepted ? acceptedLabel : rejectedLabel}
              </p>
            )}
        </li>
      ))}
    </ul>
  );
}

export function DataTable(
  { head, rows, rowHrefs }: {
    head: string[];
    rows: string[][];
    /** Optional per-row link target; a row without one renders plain. */
    rowHrefs?: (string | undefined)[];
  },
) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={`${head.filter(Boolean).join(", ")} table`}
      tabIndex={0}
    >
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
          {rows.map((r, i) => {
            const href = rowHrefs?.[i];
            return (
              <tr key={i} className={href ? "row-link" : undefined}>
                {r.map((c, j) =>
                  href && j === 0
                    ? (
                      <td key={j}>
                        <a href={href}>{c}</a>
                      </td>
                    )
                    : <td key={j}>{c}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function OfflineBadge(
  { online, pending }: { online: boolean; pending: number },
) {
  return (
    <span className="kbd-hint" role="status">
      <span
        className={online ? "offline-dot" : "offline-dot off"}
        aria-hidden="true"
      />
      {online ? "live" : "offline"}
      {pending > 0 ? ` · ${pending} queued` : ""}
    </span>
  );
}
