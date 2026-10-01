// Emitter: edit list to LS++ text. This is the injection boundary.
//
// No model-supplied string reaches the output unchecked:
//   - the exercise name is the canonical catalog name the caller resolved,
//   - week headers are `# Week N` built here,
//   - day headers are `## Day N` or `## Day N: label` where the label is
//     reduced to a small safe character set,
//   - numbers come from the validated item,
//   - notes are never emitted.

import type { EditItem } from "./importSchema.ts";

export interface ResolvedItem {
  item: EditItem;
  /** Canonical catalog name, chosen by code or by the owner. */
  name: string;
}

const LABEL_SAFE = /[^A-Za-z0-9 &'().,-]/g;

/** Reduce a day label to letters, digits and a few harmless marks. */
export function safeDayLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const s = label.replace(LABEL_SAFE, " ").replace(/\s+/g, " ").trim()
    .slice(0, 40);
  return s === "" ? undefined : s;
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** One exercise line, e.g. `Split Squat / 3x8-10 ?+ / 90s / @8`. */
export function emitLine(r: ResolvedItem): string {
  const { item } = r;
  const reps = item.repsMax !== undefined
    ? `${item.reps}-${item.repsMax}`
    : `${item.reps}${item.amrap ? "+" : ""}`;
  const weight = item.weight !== undefined
    ? `${num(item.weight)}${item.unit ?? "lb"}`
    : "?+";
  const parts = [r.name, `${item.sets}x${reps} ${weight}`];
  if (item.restSec !== undefined) parts.push(`${item.restSec}s`);
  if (item.rpe !== undefined) parts.push(`@${num(item.rpe)}`);
  return parts.join(" / ");
}

/** Program text for the resolved items, grouped by week then day. */
export function emitProgram(resolved: readonly ResolvedItem[]): string {
  const weeks = new Map<number, Map<number, ResolvedItem[]>>();
  for (const r of resolved) {
    let days = weeks.get(r.item.week);
    if (!days) weeks.set(r.item.week, days = new Map());
    const list = days.get(r.item.day);
    if (list) list.push(r);
    else days.set(r.item.day, [r]);
  }
  const out: string[] = [];
  for (const w of [...weeks.keys()].sort((a, b) => a - b)) {
    out.push(`# Week ${w}`);
    const days = weeks.get(w)!;
    for (const d of [...days.keys()].sort((a, b) => a - b)) {
      const lines = days.get(d)!;
      const label = lines
        .map((l) => safeDayLabel(l.item.dayLabel))
        .find((l) => l !== undefined);
      out.push(label !== undefined ? `## Day ${d}: ${label}` : `## Day ${d}`);
      for (const l of lines) out.push(emitLine(l));
      out.push("");
    }
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

export interface DiffLine {
  op: "keep" | "add" | "remove";
  text: string;
}

/** Plain line diff (LCS). Programs are tens of lines, so O(n*m) is fine. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n+$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n+$/, "").split("\n");
  const lcs: number[][] = Array.from(
    { length: a.length + 1 },
    () => new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "keep", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "remove", text: a[i++] });
    } else {
      out.push({ op: "add", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ op: "remove", text: a[i++] });
  while (j < b.length) out.push({ op: "add", text: b[j++] });
  return out;
}
