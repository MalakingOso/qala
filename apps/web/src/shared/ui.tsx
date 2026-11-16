/* Shared components for the desktop shell (DESIGN 5). */

import type { ReactNode } from "react";
import type { MemoryProposal } from "../store/types.ts";

export { PlateChips } from "./plates.tsx";

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
