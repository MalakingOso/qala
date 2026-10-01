/* Session complete (DESIGN 7.8, DECISIONS U6): stat tiles with deltas,
 * charts, volume deltas per exercise, the two quick questions, the day's
 * run handoff. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import {
  Group,
  PrimaryButton,
  ScalePicker,
  StatTiles,
} from "../../shared/ui.tsx";
import {
  E1rmLine,
  RepsIntensity,
  SetsByMuscle,
  TimeSplit,
} from "../../shared/charts/index.ts";
import { Check, SportShoe } from "../../shared/icons.ts";

const EXERCISES = [
  { name: "Back Squat", sets: "245 × 4, 4, 4", delta: 6 },
  { name: "Romanian Deadlift", sets: "205 × 8, 8", delta: 3 },
  { name: "Walking Lunge", sets: "40 × 10", delta: 0 },
  { name: "Standing Calf Raise", sets: "180 × 12, 12", delta: 8 },
];

const PERFORMANCE = [
  { value: 1, label: "Beat it" },
  { value: 2, label: "Hit it" },
  { value: 3, label: "Barely" },
  { value: 4, label: "Missed" },
];

export function SessionCompletePage() {
  const { queueOp } = useQala();
  const [perf, setPerf] = useState<Record<string, number>>({});
  const [srpe, setSrpe] = useState<number | null>(null);
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Sunday · squat day</p>
          <h1 className="page-title title">Lower A, done</h1>
        </div>
      </div>
      <StatTiles
        tiles={[
          { value: "58", delta: "−4 min", label: "minutes" },
          { value: "20.4k", delta: "+6%", label: "volume lb" },
          { value: "20", delta: "+2", label: "hard sets" },
          { value: "1", delta: "squat e1RM", label: "PR" },
        ]}
      />
      <TimeSplit
        parts={[
          { label: "warm-up", minutes: 15 },
          { label: "lifting", minutes: 38 },
          { label: "rest", minutes: 5 },
        ]}
      />
      <SetsByMuscle
        title="Sets by muscle this week"
        muscles={[
          { muscle: "quads", earlier: 6, today: 5 },
          { muscle: "glutes", earlier: 5, today: 4 },
          { muscle: "hamstrings", earlier: 2, today: 2 },
          { muscle: "calves", earlier: 2, today: 2 },
        ]}
      />
      <E1rmLine
        lift="Squat"
        points={[
          { label: "Aug 2", e1rm: 272 },
          { label: "Aug 9", e1rm: 274 },
          { label: "Aug 16", e1rm: 273 },
          { label: "Aug 23", e1rm: 277 },
          { label: "Aug 30", e1rm: 279 },
          { label: "Sep 6", e1rm: 278 },
          { label: "Sep 10", e1rm: 281 },
          { label: "Today", e1rm: 283 },
        ]}
      />
      <RepsIntensity
        nl85={15}
        zones={[
          { label: "<70", reps: 24 },
          { label: "70-80", reps: 18 },
          { label: "80-85", reps: 12 },
          { label: "85-90", reps: 15 },
          { label: "90+", reps: 0 },
        ]}
      />
      <Group label="Exercises · volume vs last time">
        {EXERCISES.map((e) => (
          <div className="group-row" key={e.name}>
            <span className="ex-row">
              <strong>{e.name}</strong>
              <span className="kbd-hint">{e.sets}</span>
            </span>
            <span className={e.delta > 0 ? "delta up" : "delta"}>
              {e.delta > 0 ? `+${e.delta}%` : "same"}
            </span>
          </div>
        ))}
      </Group>
      <section className="card flat-rest">
        <h2 className="card-title title">Two quick questions</h2>
        <p className="question">How did each muscle do against the plan?</p>
        {["quads", "glutes", "hamstrings"].map((m) => (
          <div key={m} className="sore-row">
            <div className="sore-label">
              <strong>{m}</strong>
            </div>
            <ScalePicker
              label={`${m} performance`}
              options={PERFORMANCE}
              value={perf[m] ?? null}
              onPick={(v) =>
                setPerf((p) => ({ ...p, [m]: v }))}
            />
          </div>
        ))}
        <p className="question">How hard was the whole session?</p>
        <ScalePicker
          label="Session RPE"
          options={Array.from({ length: 11 }, (_, v) => v)}
          value={srpe}
          onPick={setSrpe}
          anchors={["rest", "hard", "max"]}
        />
      </section>
      <section className="card hero handoff">
        <span className="group-label">Tonight · 6 pm</span>
        <div className="handoff-row">
          <SportShoe size={22} aria-hidden="true" />
          <div>
            <strong className="title">Easy run · 3.0 mi</strong>
            <p className="kbd-hint">Legs lifted today, so keep it easy.</p>
          </div>
        </div>
        <PrimaryButton
          large
          href="#/phone/today"
          onClick={() => queueOp("session-finish", { perf, srpe, minutes: 58 })}
        >
          <Check size={22} /> Finish session
        </PrimaryButton>
      </section>
    </div>
  );
}
