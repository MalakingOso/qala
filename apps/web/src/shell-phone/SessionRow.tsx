/* One past session in a list (Progress, History): what kind it was, its
 * name and day, the detail that matters, and an optional badge. */

import { Dumbbell, SportShoe } from "../shared/icons.ts";

export function SessionRow(
  { kind, day, title, detail, badge, href }: {
    kind: "lift" | "run";
    day: string;
    title: string;
    detail: string;
    badge?: string;
    href?: string;
  },
) {
  const Icon = kind === "lift" ? Dumbbell : SportShoe;
  const body = (
    <>
      <span className={`session-glyph ${kind}`} aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="session-text">
        <strong>{title}</strong>
        <span className="kbd-hint">{day} · {detail}</span>
      </span>
      {badge ? <span className="session-badge">{badge}</span> : null}
    </>
  );
  return href
    ? <a className="group-row session-row" href={href}>{body}</a>
    : <div className="group-row session-row">{body}</div>;
}
