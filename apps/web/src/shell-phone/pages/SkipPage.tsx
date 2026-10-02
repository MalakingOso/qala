/* Skip a workout (DESIGN 7.18): one reason per day like the reference
 * card (break, vacation, sick, injured), a span for multi-day stretches,
 * and a muscle picker for injuries. Saving one day writes a DaySkip;
 * anything longer sets the persistent training status. */

import { useState } from "react";
import {
  addDaysKey,
  reasonOn,
} from "../../../../../packages/engine/availability.ts";
import { useQala } from "../../store/qalaStore.tsx";
import type { Availability, DaySkip, SkipReason } from "../../store/types.ts";
import {
  Card,
  PrimaryButton,
  ScalePicker,
  SecondaryButton,
} from "../../shared/ui.tsx";
import {
  INJURY_MUSCLES,
  ReasonPicker,
  reasonWord,
  type SpanChoice,
  SPANS,
} from "../../shared/skipStatus.tsx";

function dayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function SkipPage({ day, ret }: { day: string; ret: string }) {
  const { todayKey, skips, availability, skipDay, setAvailability } = useQala();
  const dayKey = day === "today" || !/^\d{4}-\d{2}-\d{2}$/.test(day)
    ? todayKey
    : day;
  const back = ["today", "plan", "settings", "body"].includes(ret)
    ? ret
    : "today";

  const [reason, setReason] = useState<SkipReason>("break");
  const [muscle, setMuscle] = useState("");
  const [note, setNote] = useState("");
  const [span, setSpan] = useState<SpanChoice>("day");

  const existing = reasonOn(dayKey, availability, skips);
  const injuredValid = reason !== "injured" || muscle !== "";

  const save = () => {
    if (!injuredValid) return;
    const trimNote = note.trim() || undefined;
    if (span === "day") {
      const skip: DaySkip = { date: dayKey, reason, note: trimNote };
      if (reason === "injured") skip.muscle = muscle;
      skipDay(skip);
      return;
    }
    const status: Availability = {
      status: reason,
      since: dayKey,
      note: trimNote,
    };
    if (reason === "injured") status.muscle = muscle;
    if (span !== "open") status.until = addDaysKey(dayKey, Number(span) - 1);
    setAvailability(status);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">{dayLabel(dayKey)}</p>
          <h1 className="page-title title">Skip a workout</h1>
        </div>
      </div>
      <Card hero>
        {existing
          ? (
            <p className="kbd-hint">
              {dayLabel(dayKey)}{" "}
              is skipped ({reasonWord(existing)}). Saving replaces it.
            </p>
          )
          : null}
        <div className="field-head">
          <span className="group-label">Why skip?</span>
        </div>
        <ReasonPicker value={reason} onPick={setReason} />
        {reason === "injured"
          ? (
            <>
              <label className="field-head" htmlFor="skip-muscle">
                <span className="group-label">Which muscle?</span>
                <span className="kbd-hint">direct work pauses</span>
              </label>
              <select
                id="skip-muscle"
                className="field select"
                value={muscle}
                onChange={(e) => setMuscle(e.target.value)}
              >
                <option value="">Pick a muscle</option>
                {INJURY_MUSCLES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </>
          )
          : null}
        <label className="field-head" htmlFor="skip-note">
          <span className="group-label">Note</span>
          <span className="kbd-hint">optional, one line</span>
        </label>
        <input
          id="skip-note"
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. left knee, flights Tuesday"
        />
        <div className="field-head span-head">
          <span className="group-label">How long?</span>
        </div>
        <ScalePicker
          label="How long?"
          options={SPANS}
          value={span}
          onPick={setSpan}
        />
        <p className="kbd-hint footnote">
          Skipped days rest. Vacation and sick days shift the plan out. Nothing
          counts against you.
        </p>
        <div className="card-cta skip-cta">
          <PrimaryButton
            large
            href={`#/phone/${back}`}
            onClick={save}
            disabled={!injuredValid}
            label={injuredValid ? undefined : "Pick a muscle first"}
          >
            {span === "day" ? "Skip this day" : "Set status"}
          </PrimaryButton>
          <SecondaryButton href={`#/phone/${back}`}>
            Keep training
          </SecondaryButton>
        </div>
      </Card>
    </div>
  );
}
