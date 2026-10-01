/* Body (DESIGN 7.9): readiness over the week, soreness by muscle, fatigue
 * split lifting and running, deload status, owned recovery tools. The
 * front/back recovery map (liftosaur's artwork) with ready-time callouts;
 * until check-ins save soreness, the values here are samples. */

import { Group, GroupRow, SecondaryButton } from "../../shared/ui.tsx";
import { ReadinessLine } from "../../shared/charts/index.ts";
import { RecoveryMap } from "../../shared/bodymap/RecoveryMap.tsx";

// Hours until ready, per liftosaur screen muscle. Samples until the engine
// snapshot feeds this (PLAN 6).
const RECOVERY = [
  { id: "quadriceps", hours: 40 },
  { id: "glutes", hours: 22 },
  { id: "hamstrings", hours: 20 },
  { id: "back", hours: 12 },
  { id: "calves", hours: 0 },
  { id: "chest", hours: 0 },
  { id: "shoulders", hours: 0 },
  { id: "abs", hours: 0 },
  { id: "triceps", hours: 14 },
  { id: "biceps", hours: 0 },
  { id: "forearms", hours: 0 },
];

const SORENESS: { muscle: string; level: number }[] = [
  { muscle: "quads", level: 4 },
  { muscle: "glutes", level: 2 },
  { muscle: "hamstrings", level: 2 },
  { muscle: "lats", level: 2 },
  { muscle: "calves", level: 1 },
  { muscle: "chest", level: 1 },
];

const WORDS = ["", "fresh", "a little", "sore", "still sore"];

export function BodyPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Sunday · after check-in</p>
          <h1 className="page-title title">Legs are still recovering</h1>
        </div>
      </div>
      <RecoveryMap muscles={RECOVERY} />
      <ReadinessLine
        values={[78, 74, 80, 76, 71, 69, 72]}
        days={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Today"]}
        avg={76}
        low={64}
      />
      <section className="card flat-rest">
        <h2 className="card-title title">Soreness</h2>
        <ul className="sore-list">
          {SORENESS.map((m) => (
            <li key={m.muscle}>
              <span className="sore-name">{m.muscle}</span>
              <span
                className={`sore-meter level-${m.level}`}
                role="img"
                aria-label={`${m.level} of 4`}
              >
                {[1, 2, 3, 4].map((n) => (
                  <span key={n} className={n <= m.level ? "on" : undefined} />
                ))}
              </span>
              <span className="kbd-hint">{WORDS[m.level]}</span>
            </li>
          ))}
        </ul>
        <p className="kbd-hint footnote">
          From your check-ins, 1 to 4. Sample values for now.
        </p>
      </section>
      <Group label="Deload">
        <GroupRow>
          <span>Not due</span>
          <span className="kbd-hint">planned for week 6</span>
        </GroupRow>
      </Group>
      <Group
        label="Recovery tools you own"
        action={
          <SecondaryButton small href="#/phone/settings">Edit</SecondaryButton>
        }
      >
        <GroupRow>
          <span>Foam roller</span>
          <span className="kbd-hint">warm-up and rest days</span>
        </GroupRow>
        <GroupRow>
          <span>Theragun</span>
          <span className="kbd-hint">preferred where allowed</span>
        </GroupRow>
      </Group>
    </div>
  );
}
