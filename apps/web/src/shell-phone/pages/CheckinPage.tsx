/* Check-in (DESIGN 7.3): recovery 0-10, soreness 1-4 per trained muscle,
 * free-text line parsed into removable chips. On a rest day the card also
 * surfaces a mobility tip from soreness + owned equipment (U10), a tip, not
 * a tracked stage. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import { Card, Chip, PrimaryButton } from "../../shared/ui.tsx";

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
  const { settings, queueOp } = useQala();
  const isRest = restDay;
  const [prs, setPrs] = useState(7);
  const [sore, setSore] = useState<Record<string, number>>({ quads: 4 });
  const [text, setText] = useState("");
  const [chips, setChips] = useState<string[]>(["Sleep 6 h"]);

  const soreList = Object.entries(sore).filter(([, v]) => v >= 3);
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
        <p className="group-label">Recovery 0-10</p>
        <div
          style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
          role="radiogroup"
          aria-label="Recovery"
        >
          {Array.from({ length: 11 }, (_, v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={prs === v}
              onClick={() => setPrs(v)}
              className="icon-btn"
              style={prs === v
                ? { background: "var(--accent)", color: "var(--on-accent)" }
                : undefined}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="kbd-hint">
          0-2 worse session expected · 3-7 normal · 8-10 better
        </p>
        <p className="group-label">Soreness 1-4</p>
        {TRAINED.map((t) => (
          <div key={t.muscle} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong style={{ textTransform: "capitalize" }}>
                {t.muscle}
              </strong>
              <span className="kbd-hint">{t.last}</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {[1, 2, 3, 4].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={(sore[t.muscle] ?? 0) === v}
                  onClick={() => setSore((s) => ({ ...s, [t.muscle]: v }))}
                  className="icon-btn"
                  title={t.meaning[v - 1]}
                  style={(sore[t.muscle] ?? 0) === v
                    ? {
                      background: "var(--bg-active)",
                      outline: "2px solid var(--accent)",
                    }
                    : undefined}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="group-label">Anything else? (one line)</p>
        <input
          aria-label="Free text check-in"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. left knee achy, short on time"
          style={{ width: "100%", minHeight: 44, font: "inherit", padding: 8 }}
        />
        <div
          style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}
        >
          {chips.map((c) => (
            <Chip
              key={c}
              onRemove={() => setChips((cs) => cs.filter((x) => x !== c))}
            >
              {c}
            </Chip>
          ))}
        </div>
        {isRest
          ? (
            <div className="note-card" style={{ marginTop: 12 }}>
              <div className="note-head">Rest-day tip</div>
              <div>{tip}</div>
            </div>
          )
          : null}
        <div style={{ marginTop: 12 }}>
          <PrimaryButton
            href="#/phone/warmup"
            onClick={() => queueOp("checkin", { prs, soreness: sore, text })}
          >
            Continue to warm-up
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
