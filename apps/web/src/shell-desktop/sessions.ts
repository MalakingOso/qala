/* Small formatters for session rows, shared by Overview, History and Running. */

import type { SessionSummary } from "../store/types.ts";

export function sessionHref(s: SessionSummary): string {
  return s.type === "run"
    ? `#/desktop/running/${s.id}`
    : `#/desktop/history/${s.id}`;
}

/** "20,400 lb" for a lift, "7.0 mi" for a run. */
export function sessionLoad(s: SessionSummary): string {
  return s.type === "run"
    ? `${(s.run?.distanceMi ?? 0).toFixed(1)} mi`
    : `${(s.loadLb ?? 0).toLocaleString("en-US")} lb`;
}

/** The lead set of a lift session as "Back Squat 3x4 @ 245" when its sets are
 * even, else the logged text. Runs have none. */
export function topSet(s: SessionSummary): string {
  const first = s.exercises?.[0];
  if (!first) return "";
  const m = first.sets.match(/^(\d+)×([\d, ]+?)(?: ea)?(?: @ [\d.]+)?$/);
  if (!m) return `${first.name} ${first.sets}`;
  const reps = m[2].split(",").map((r) => r.trim());
  const even = reps.every((r) => r === reps[0]);
  return even
    ? `${first.name} ${reps.length}×${reps[0]} @ ${m[1]}`
    : `${first.name} ${first.sets}`;
}

export type SessionFilter = "all" | "lift" | "run" | "pr";

export const SESSION_FILTERS: { value: SessionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "lift", label: "Lifts" },
  { value: "run", label: "Runs" },
  { value: "pr", label: "PRs only" },
];

export function filterSessions(
  sessions: SessionSummary[],
  filter: SessionFilter,
): SessionSummary[] {
  switch (filter) {
    case "lift":
      return sessions.filter((s) => s.type === "lift");
    case "run":
      return sessions.filter((s) => s.type === "run");
    case "pr":
      return sessions.filter((s) => s.prCount > 0);
    default:
      return sessions;
  }
}
