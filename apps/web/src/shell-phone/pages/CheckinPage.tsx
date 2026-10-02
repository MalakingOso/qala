/* Check-in (DESIGN 7.3): recovery 0-10, soreness 1-4 per trained muscle,
 * free-text line parsed into removable chips. On a rest day the card also
 * surfaces a mobility tip from soreness + owned equipment (U10), a tip, not
 * a tracked stage. */

import { useState } from "react";
import { injuredOn } from "../../../../../packages/engine/availability.ts";
import { useQala } from "../../store/qalaStore.tsx";
import { Card, Chip, PrimaryButton, ScalePicker } from "../../shared/ui.tsx";
import { ArrowRight, Sun } from "../../shared/icons.ts";

const TRAINED = [
  {
    muscle: "quads",
    last: "trained Thu",
    meaning: [
      "never sore",
      "healed well before",
      "healed just in time",
      "still sore now",
    ],
  },
  {
    muscle: "glutes",
    last: "trained Thu",
    meaning: [
      "never sore",
      "healed well before",
      "healed just in time",
      "still sore now",
    ],
  },
  {
    muscle: "hamstrings",
    last: "trained Thu",
    meaning: [
      "never sore",
      "healed well before",
      "healed just in time",
      "still sore now",
    ],
  },
  {
    muscle: "calves",
    last: "trained Tue",
    meaning: [
      "never sore",
      "healed well before",
      "healed just in time",
      "still sore now",
    ],
  },
];

export function CheckinPage({ restDay = false }: { restDay?: boolean }) {
  const { settings, queueOp, todayKey, skips, availability } = useQala();
  const isRest = restDay;
  const hurt = injuredOn(todayKey, availability, skips);
  const [prs, setPrs] = useState(7);
  // Injured muscles walk in at soreness 4; the rest-day tip names them first.
  const [sore, setSore] = useState<Record<string, number>>({
    quads: 4,
    ...Object.fromEntries(hurt.map((m) => [m, 4])),
  });
  const [text, setText] = useState("");
  const [chips, setChips] = useState<string[]>(["Sleep 6 h"]);

  const soreList = Object.entries(sore)
    .filter(([, v]) => v >= 3)
    .sort(([a], [b]) => Number(hurt.includes(b)) - Number(hurt.includes(a)));
  const tipMuscles = soreList.length > 0
    ? soreList.map(([m]) => m).join(" + ")
    : "hips";
  const tool = settings.equipment.percussion && !soreList.length
    ? "Theragun"
    : "foam roller";
  const tip = `Easy ${tipMuscles}: 90 s ${tool} each side, then a short walk.`;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">How are you walking in?</h1>
      </div>
      <Card hero>
        <div className="field-head">
          <span className="group-label">Recovery</span>
          <span className="kbd-hint">0 to 10</span>
        </div>
        <ScalePicker
          label="Recovery"
          options={Array.from({ length: 11 }, (_, v) => v)}
          value={prs}
          onPick={setPrs}
          anchors={["worse session", "normal", "better"]}
        />
        <div className="field-head soreness-head">
          <span className="group-label">Soreness</span>
          <span className="kbd-hint">muscles today's session trains</span>
        </div>
        {TRAINED.map((t) => {
          const v = sore[t.muscle] ?? 0;
          return (
            <div key={t.muscle} className="sore-row">
              <div className="sore-label">
                <strong>{t.muscle}</strong>
                <span className="kbd-hint">
                  {v ? t.meaning[v - 1] : t.last}
                </span>
              </div>
              <ScalePicker
                label={`${t.muscle} soreness`}
                options={[1, 2, 3, 4]}
                value={v || null}
                onPick={(n) => setSore((s) => ({ ...s, [t.muscle]: n }))}
                describe={(n) => t.meaning[n - 1]}
              />
            </div>
          );
        })}
        <label className="field-head" htmlFor="checkin-text">
          <span className="group-label">Anything else?</span>
          <span className="kbd-hint">one line</span>
        </label>
        <input
          id="checkin-text"
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. knee achy, short on time"
        />
        {chips.length
          ? (
            <div className="chip-row">
              {chips.map((c) => (
                <Chip
                  key={c}
                  onRemove={() => setChips((cs) => cs.filter((x) => x !== c))}
                >
                  {c}
                </Chip>
              ))}
            </div>
          )
          : null}
        {isRest
          ? (
            <div className="tip-card">
              <Sun size={16} aria-hidden="true" />
              <div>
                <span className="group-label">Rest-day tip</span>
                <p>{tip}</p>
              </div>
            </div>
          )
          : null}
        <div className="card-cta">
          <PrimaryButton
            large
            href={isRest ? "#/phone/today" : "#/phone/warmup"}
            onClick={() => queueOp("checkin", { prs, soreness: sore, text })}
          >
            {isRest ? "Save check-in" : "Continue to warm-up"}{" "}
            <ArrowRight size={20} />
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
