/* Body (DESIGN 7.9): readiness over the week, soreness by muscle, fatigue
 * split lifting and running, deload status, owned recovery tools. The
 * front/back recovery map (liftosaur's artwork) with ready-time callouts;
 * until check-ins save soreness, the values here are samples. */

import {
  injuredOn,
  normMuscle,
} from "../../../../../packages/engine/availability.ts";
import { useQala } from "../../store/qalaStore.tsx";
import { Group, GroupRow, SecondaryButton } from "../../shared/ui.tsx";
import { muscleLabel } from "../../shared/skipStatus.tsx";
import { ReadinessLine } from "../../shared/charts/index.ts";
import { RecoveryMap } from "../../shared/bodymap/RecoveryMap.tsx";
import { sampleRecovery } from "../../store/sample.ts";
import { GearSlot } from "../../shared/gear.tsx";

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
  const { todayKey, skips, availability } = useQala();
  const hurt = injuredOn(todayKey, availability, skips).map(normMuscle);
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Sunday · after check-in</p>
          <h1 className="page-title title">Legs are still recovering</h1>
        </div>
      </div>
      <RecoveryMap muscles={sampleRecovery} />
      <ReadinessLine
        values={[78, 74, 80, 76, 71, 69, 72]}
        days={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Today"]}
        avg={76}
        low={64}
      />
      <section className="card flat-rest">
        <h2 className="card-title title">Soreness</h2>
        <ul className="sore-list">
          {SORENESS.map((m) => {
            const injured = hurt.includes(normMuscle(m.muscle));
            const level = injured ? 4 : m.level;
            return (
              <li key={m.muscle}>
                <span className="sore-name">{m.muscle}</span>
                <span
                  className={`sore-meter level-${level}`}
                  role="img"
                  aria-label={`${level} of 4`}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <span
                      key={n}
                      className={n <= level ? "on" : undefined}
                    />
                  ))}
                </span>
                <span className="kbd-hint">
                  {injured ? "recovering · direct work off" : WORDS[level]}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="kbd-hint footnote">
          From your check-ins, 1 to 4. Sample values for now.
          {hurt.length
            ? ` ${hurt.map(muscleLabel).join(", ")} ${
              hurt.length === 1 ? "is" : "are"
            } injured: direct work for ${
              hurt.length === 1 ? "it" : "them"
            } is off until it clears.`
            : ""}
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
          <span className="eq-label">
            <GearSlot name="roller" />
            <span>Foam roller</span>
          </span>
          <span className="kbd-hint">warm-up and rest days</span>
        </GroupRow>
        <GroupRow>
          <span className="eq-label">
            <GearSlot name="theragun" />
            <span>Theragun</span>
          </span>
          <span className="kbd-hint">preferred where allowed</span>
        </GroupRow>
      </Group>
    </div>
  );
}
