// Exercise matching for import. Code decides, not the model.
//
// Only a clean, unambiguous hit on the catalog resolves on its own. Anything
// else comes back as a confirm item for the owner: a name that is on the
// ambiguity list ("split squat" is an exact catalog name, and also the
// Bulgarian variant), a near miss, or no match at all. Never a silent guess.

export interface CatalogEntry {
  id: string;
  /** Canonical name. This is the only exercise text the emitter writes. */
  name: string;
}

export type ConfirmReason = "ambiguous" | "close" | "unknown";

export type MatchResult =
  | { kind: "match"; entry: CatalogEntry }
  | {
    kind: "confirm";
    reason: ConfirmReason;
    candidates: CatalogEntry[];
  };

/**
 * Names that mean more than one catalog exercise, checked BEFORE exact
 * matching. Keys and values are display names, normalised on load. A name
 * only counts as ambiguous when at least two of its candidates exist in the
 * catalog in use.
 */
export const AMBIGUOUS_NAMES: Record<string, string[]> = {
  "split squat": ["Split Squat", "Bulgarian Split Squat"],
};

/**
 * Shorthand people write. Value is a catalog display name. Kept apart from
 * the ambiguity table on purpose: an alias is a confident resolution.
 */
export const ALIASES: Record<string, string> = {
  "ohp": "Overhead Press",
  "rdl": "Romanian Deadlift",
  "bb row": "Bent Over Row",
  "dl": "Deadlift",
  "pullup": "Pull Up",
  "pullups": "Pull Up",
  "chinup": "Chin Up",
  "chinups": "Chin Up",
  "pushup": "Push Up",
  "pushups": "Push Up",
  "situp": "Sit Up",
  "situps": "Sit Up",
};

function singular(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss")
    ? token.slice(0, -1)
    : token;
}

/** Lowercase word list: punctuation to spaces, simple plural strip. */
export function nameTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t !== "")
    .map(singular);
}

/**
 * Key used for equality: tokens joined without spaces, so "pull up",
 * "pull-up" and "pullup" are the same name.
 */
export function nameKey(raw: string): string {
  return nameTokens(raw).join("");
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

const MAX_CANDIDATES = 5;
const CLOSE_THRESHOLD = 0.5;

/** Resolve one raw exercise name against the catalog. Pure and synchronous. */
export function matchExercise(
  raw: string,
  catalog: readonly CatalogEntry[],
): MatchResult {
  const key = nameKey(raw);
  if (key === "") return { kind: "confirm", reason: "unknown", candidates: [] };

  const byKey = new Map<string, CatalogEntry[]>();
  for (const e of catalog) {
    const k = nameKey(e.name);
    const list = byKey.get(k);
    if (list) list.push(e);
    else byKey.set(k, [e]);
  }

  // 1. Ambiguity table, before anything else.
  for (const [ambKey, names] of Object.entries(AMBIGUOUS_NAMES)) {
    if (nameKey(ambKey) !== key) continue;
    const found = names.flatMap((n) => byKey.get(nameKey(n)) ?? []);
    if (found.length >= 2) {
      return { kind: "confirm", reason: "ambiguous", candidates: found };
    }
  }

  // 2. Alias, then exact. Two catalog entries sharing a key is ambiguous too.
  let lookup = key;
  for (const [a, target] of Object.entries(ALIASES)) {
    if (nameKey(a) === key) {
      lookup = nameKey(target);
      break;
    }
  }
  const exact = byKey.get(lookup);
  if (exact && exact.length === 1) return { kind: "match", entry: exact[0] };
  if (exact && exact.length > 1) {
    return { kind: "confirm", reason: "ambiguous", candidates: exact };
  }

  // 3. Near misses, offered as candidates but never auto-picked.
  const q = new Set(nameTokens(raw));
  const scored = catalog
    .map((entry) => {
      const t = new Set(nameTokens(entry.name));
      let score = dice(q, t);
      // "bench" inside "Incline Bench Press": a subset is a strong hint.
      if (q.size > 0 && [...q].every((x) => t.has(x))) {
        score = Math.max(score, 0.6);
      }
      return { entry, score };
    })
    .filter((s) => s.score >= CLOSE_THRESHOLD)
    .sort((a, b) =>
      b.score - a.score || a.entry.name.localeCompare(b.entry.name)
    )
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.entry);
  if (scored.length > 0) {
    return { kind: "confirm", reason: "close", candidates: scored };
  }
  return { kind: "confirm", reason: "unknown", candidates: [] };
}
