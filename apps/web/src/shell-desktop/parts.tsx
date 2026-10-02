/* Desktop building blocks for the refined look (DESIGN 7.15, DECISIONS U21):
 * the lede card every page opens with (kicker, title, ink rule), section
 * heads, type tags, pills, filter chips and the block-position bar. All of
 * their styling lives in theme/desktop.css under `.page-desktop`, so nothing
 * here can reach the phone shell. */

import type { ReactNode } from "react";

/** Opens every desktop page: a kicker line, the title, an ink rule, then
 * whatever leads the page (headline figures, a chart, filters). */
export function PageHeader({
  kicker,
  title,
  action,
  children,
  ruleless,
}: {
  kicker?: ReactNode;
  title: string;
  /** Sits at the right of the title row (the Overview's zoom picker). When
   * the title changes under it, the new one fades in. */
  action?: ReactNode;
  children?: ReactNode;
  /** Skip the ink rule for headers with nothing under them. */
  ruleless?: boolean;
}) {
  return (
    <section
      className={ruleless ? "card page-lede ruleless" : "card page-lede"}
      aria-labelledby="page-title"
    >
      {kicker ? <div className="kicker">{kicker}</div> : null}
      {action
        ? (
          <div className="lede-title-row">
            <h1 className="page-title title" id="page-title">
              <span key={title} className="lede-title-text">{title}</span>
            </h1>
            {action}
          </div>
        )
        : <h1 className="page-title title" id="page-title">{title}</h1>}
      {ruleless ? null : <hr className="ink-rule" />}
      {children}
    </section>
  );
}

/** A card with a serif heading over an ink rule, and an optional aside
 * (a link or a count) at the right of the heading. */
export function Panel({
  title,
  aside,
  children,
  className,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card panel${className ? ` ${className}` : ""}`}>
      {title
        ? (
          <h2 className="sec-head title">
            <span>{title}</span>
            {aside ? <span className="sec-aside">{aside}</span> : null}
          </h2>
        )
        : null}
      {children}
    </section>
  );
}

export function TypeTag({ kind }: { kind: "lift" | "run" }) {
  return <span className={`type-tag ${kind}`}>{kind}</span>;
}

export type PillTone = "ok" | "warn" | "info" | "note" | "mute";

export function Pill(
  { tone = "mute", children }: { tone?: PillTone; children: ReactNode },
) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/** One-of-many filter: the chosen chip fills with ink (DECISIONS L11). */
export function FilterChips<T extends string>({
  options,
  value,
  onPick,
  label,
  aside,
}: {
  options: { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
  label: string;
  aside?: ReactNode;
}) {
  return (
    <div className="filter-row">
      <div className="filter-chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? "filter-chip on" : "filter-chip"}
            aria-pressed={o.value === value}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {aside ? <span className="filter-aside">{aside}</span> : null}
    </div>
  );
}

/** Where the block stands: one cell per week, done teal, now ember, the
 * deload outlined, later gray. */
export function BlockBar({
  week,
  of,
  deloadWeek,
  numbered,
}: {
  week: number;
  of: number;
  deloadWeek?: number;
  /** Print the week number under each cell. */
  numbered?: boolean;
}) {
  const cells = Array.from({ length: of }, (_, i) => i + 1);
  const kind = (w: number) =>
    w === deloadWeek ? "deload" : w < week ? "done" : w === week ? "now" : "";
  return (
    <div
      className={numbered ? "block-bar numbered" : "block-bar"}
      role="img"
      aria-label={`Week ${week} of ${of}${
        deloadWeek ? `, deload in week ${deloadWeek}` : ""
      }`}
    >
      {cells.map((w) => (
        <span key={w} className={`block-cell ${kind(w)}`}>
          <i />
          {numbered ? <span>{w}</span> : null}
        </span>
      ))}
    </div>
  );
}

/** A figure with a label under it, for the row of headline numbers. */
export function Bunch(
  { items }: {
    items: { value: string; label: string; delta?: string }[];
  },
) {
  return (
    <div className="bunch">
      {items.map((it) => (
        <div key={it.label}>
          <b className="figure">{it.value}</b>
          <span>{it.label}</span>
          {it.delta ? <span className="bunch-delta">{it.delta}</span> : null}
        </div>
      ))}
    </div>
  );
}
