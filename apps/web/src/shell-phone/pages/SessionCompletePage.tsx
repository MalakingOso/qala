/* Session complete (DESIGN 7.8): stat tiles with deltas, charts, volume
 * deltas, the two quick questions, the day's run handoff. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import { Card, Chip, PrimaryButton, StatTiles } from "../../shared/ui.tsx";
import { E1rmLine, RepsIntensity, SetsByMuscle, TimeSplit } from "../../shared/charts/index.ts";

export function SessionCompletePage() {
  const { queueOp } = useQala();
  const [perf, setPerf] = useState<Record<string, number>>({});
  const [srpe, setSrpe] = useState<number | null>(null);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Lower A, done</h1>
      </div>
      <StatTiles
        tiles={[
          { value: "58", delta: "-4 min", label: "minutes" },
          { value: "20.4k", delta: "+6%", label: "volume lb" },
          { value: "20", delta: "+2", label: "hard sets" },
          { value: "1", delta: "squat", label: "PRs" },
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
          { label: "s1", e1rm: 272 },
          { label: "s2", e1rm: 274 },
          { label: "s3", e1rm: 273 },
          { label: "s4", e1rm: 277 },
          { label: "s5", e1rm: 279 },
          { label: "s6", e1rm: 278 },
          { label: "s7", e1rm: 281 },
          { label: "today", e1rm: 283 },
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
      <Card>
        <p className="group-label">Exercises · volume vs last time</p>
        {["Back Squat +6%", "RDL +3%", "Lunge +0%", "Calf raise +8%"].map((r) => (
          <p key={r} style={{ margin: "4px 0" }}>
            {r}
          </p>
        ))}
      </Card>
      <Card>
        <p className="group-label">Two quick questions</p>
        <p>How did each muscle perform? (1 exceeded · 2 hit · 3 struggled · 4 no match)</p>
        {["quads", "glutes", "hamstrings"].map((m) => (
          <div key={m} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
            <span style={{ width: 110, textTransform: "capitalize" }}>{m}</span>
            {[1, 2, 3, 4].map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={perf[m] === v}
                onClick={() => setPerf((p) => ({ ...p, [m]: v }))}
                className="icon-btn"
                style={perf[m] === v ? { outline: "2px solid var(--accent)" } : undefined}
              >
                {v}
              </button>
            ))}
          </div>
        ))}
        <p>Session RPE (CR-10)</p>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {Array.from({ length: 11 }, (_, v) => (
            <button
              key={v}
              type="button"
              aria-pressed={srpe === v}
              onClick={() => setSrpe(v)}
              className="icon-btn"
              style={srpe === v ? { outline: "2px solid var(--accent)" } : undefined}
            >
              {v}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <p className="group-label">Tonight</p>
        <p>
          Easy run · 3.0 mi · 6 pm. <Chip>legs lifted today: keep it easy</Chip>
        </p>
        <PrimaryButton
          href="#/phone/today"
          onClick={() => queueOp("session-finish", { perf, srpe, minutes: 58 })}
        >
          Finish
        </PrimaryButton>
      </Card>
    </div>
  );
}
