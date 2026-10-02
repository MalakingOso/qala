/* Skipping a day and the training status (DESIGN 7.18): reason metadata,
 * the reason radio rows, the injured-muscle list, and the copy that keeps
 * skipped days free of guilt. Resolution math lives in the engine
 * (packages/engine/availability.ts); this file is presentation. */

import type { Availability, DaySkip, SkipReason } from "../store/types.ts";
import {
  Bandage,
  CalendarOff,
  PersonStanding,
  Sunset,
  Thermometer,
  TreePalm,
} from "./icons.ts";

export const REASONS: SkipReason[] = [
  "break",
  "vacation",
  "sick",
  "injured",
  "scheduling",
];

export const REASON_META: Record<
  SkipReason,
  { title: string; blurb: string; icon: typeof Sunset }
> = {
  break: {
    title: "On a Break",
    blurb: "Taking a few days off to recover.",
    icon: Sunset,
  },
  vacation: {
    title: "On Vacation",
    blurb: "Away from training. The plan shifts out.",
    icon: TreePalm,
  },
  sick: {
    title: "Sick",
    blurb: "Resting to get well. The plan shifts out.",
    icon: Thermometer,
  },
  injured: {
    title: "Injured",
    blurb: "Training around it. Pick the muscle below.",
    icon: Bandage,
  },
  scheduling: {
    title: "Scheduling",
    blurb: "Could not fit it in today. The plan holds.",
    icon: CalendarOff,
  },
};

export function reasonIcon(reason: SkipReason) {
  return REASON_META[reason].icon;
}

export function reasonTitle(reason: SkipReason): string {
  return REASON_META[reason].title;
}

/** Short word for struck day labels: "skipped, sick". */
export function reasonWord(reason: SkipReason): string {
  switch (reason) {
    case "break":
      return "break";
    case "vacation":
      return "vacation";
    case "sick":
      return "sick";
    case "injured":
      return "injured";
    case "scheduling":
      return "scheduling";
  }
}

/** Engine muscle ids the injured guard matches (availability.ts). */
export const INJURY_MUSCLES: { id: string; label: string }[] = [
  { id: "quads", label: "Quads" },
  { id: "hamstrings", label: "Hamstrings" },
  { id: "glutes", label: "Glutes" },
  { id: "calves", label: "Calves" },
  { id: "chest", label: "Chest" },
  { id: "back", label: "Back" },
  { id: "lats", label: "Lats" },
  { id: "shoulders", label: "Shoulders" },
  { id: "biceps", label: "Biceps" },
  { id: "triceps", label: "Triceps" },
  { id: "abs", label: "Abs" },
  { id: "forearms", label: "Forearms" },
];

export function muscleLabel(id: string): string {
  return INJURY_MUSCLES.find((m) => m.id === id)?.label ?? id;
}

export type SpanChoice = "day" | "3" | "7" | "open";

export const SPANS: { value: SpanChoice; label: string }[] = [
  { value: "day", label: "This day only" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "open", label: "Until I say so" },
];

/** One line for the Today banner and Settings: "Sick since Tue", "On
 * vacation until Fri", "Injured: quads". */
export function statusLine(
  availability: Availability,
  skips: DaySkip[],
  todayKey: string,
): { reason: SkipReason; text: string } | null {
  const skip = skips.find((s) => s.date === todayKey);
  if (skip) {
    return {
      reason: skip.reason,
      text: skip.reason === "injured" && skip.muscle
        ? `Injured today: ${muscleLabel(skip.muscle)}.`
        : `${reasonTitle(skip.reason)} today.`,
    };
  }
  if (availability.status === "active" || !availability.since) return null;
  if (todayKey < availability.since) return null;
  if (availability.until && todayKey > availability.until) return null;
  const span = availability.until
    ? `until ${shortDate(availability.until)}`
    : "until you say so";
  if (availability.status === "injured" && availability.muscle) {
    return {
      reason: "injured",
      text: `Injured: ${muscleLabel(availability.muscle)} ${span}.`,
    };
  }
  return {
    reason: availability.status,
    text: `${reasonTitle(availability.status)} ${span}.`,
  };
}

/** The day a sick stretch started, when sick covers today; null otherwise.
 * The "Feeling better?" prompt uses this to wait until day two: someone who
 * just marked themselves sick does not need asking back immediately. */
export function sickSince(
  availability: Availability,
  skips: DaySkip[],
  todayKey: string,
): string | null {
  const skip = skips.find((s) => s.date === todayKey);
  if (skip) return skip.reason === "sick" ? skip.date : null;
  if (
    availability.status !== "sick" || !availability.since ||
    todayKey < availability.since ||
    (availability.until && todayKey > availability.until)
  ) {
    return null;
  }
  return availability.since;
}

/** "Sep 20" for a YYYY-MM-DD key. */
export function shortDate(dateKey: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [, m, d] = dateKey.split("-").map(Number);
  if (!m || !d) return dateKey;
  return `${months[m - 1]} ${d}`;
}

export function StatusIcon({ reason }: { reason: SkipReason | "active" }) {
  const Icon = reason === "active" ? PersonStanding : reasonIcon(reason);
  return <Icon size={20} aria-hidden="true" />;
}

/** Reason radio rows in the screenshot's shape, drawn in Qala's controls:
 * 2px bordered rows, the picked radio filled with ink (L11). */
export function ReasonPicker({
  value,
  onPick,
}: {
  value: SkipReason;
  onPick: (r: SkipReason) => void;
}) {
  return (
    <div className="skip-reasons" role="radiogroup" aria-label="Why skip?">
      {REASONS.map((r) => {
        const meta = REASON_META[r];
        const Icon = meta.icon;
        const picked = r === value;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={picked}
            className="reason-row"
            onClick={() => onPick(r)}
          >
            <span className="reason-icon" aria-hidden="true">
              <Icon size={22} />
            </span>
            <span className="reason-text">
              <strong>{meta.title}</strong>
              <span className="kbd-hint">{meta.blurb}</span>
            </span>
            <span className="reason-dot" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
