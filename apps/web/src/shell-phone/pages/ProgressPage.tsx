/* Progress (DESIGN 7.10): the block's headline, squat 1RM with estimate
 * and tested markers, reps at 85%+ against the block target, sets per
 * muscle, running fitness, recent sessions. */

import { Group, SecondaryButton } from "../../shared/ui.tsx";
import {
  BulletNl85,
  E1rmLine,
  RunSpark,
  SetsByMuscle,
} from "../../shared/charts/index.ts";
import { SessionRow } from "../SessionRow.tsx";

export function ProgressPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">
            Strength block 2 · week 3 of 6
          </p>
          <h1 className="page-title title">Squat is up 4% this block</h1>
        </div>
      </div>
      <section className="card hero">
        <dl className="today-figures progress-figures">
          {[
            { v: "280", l: "reference 1RM" },
            { v: "283", l: "estimate today" },
            { v: "280", l: "tested, week 3" },
          ].map((s) => (
            <div key={s.l}>
              <dt>{s.l}</dt>
              <dd className="figure">{s.v}</dd>
            </div>
          ))}
        </dl>
        <p className="today-line">
          The estimate leads the tested number by 3 lb, so next block's loads
          start from 283.
        </p>
      </section>
      <E1rmLine
        lift="Squat"
        points={[
          { label: "Week 1", e1rm: 272 },
          { label: "Week 2", e1rm: 276 },
          { label: "Week 3", e1rm: 279, tested: true },
          { label: "Today", e1rm: 283 },
        ]}
      />
      <BulletNl85
        lifts={[
          { lift: "squat", actual: 27, target: 33 },
          { lift: "bench", actual: 18, target: 24 },
          { lift: "deadlift", actual: 12, target: 14 },
        ]}
      />
      <SetsByMuscle
        title="Sets per muscle this week"
        muscles={[
          { muscle: "quads", earlier: 8, today: 5 },
          { muscle: "chest", earlier: 10, today: 0 },
          { muscle: "back", earlier: 12, today: 0 },
        ]}
      />
      <RunSpark
        points={[38.5, 39.1, 39.0, 39.8, 40.2]}
        label="VDOT rising across the block."
      />
      <Group label="Recent sessions">
        <SessionRow
          kind="lift"
          day="Today"
          title="Lower A"
          detail="20.4k lb · 58 min"
          badge="1 PR"
        />
        <SessionRow
          kind="run"
          day="Sat"
          title="Long run"
          detail="7.0 mi · 1:04"
          badge="rTSS 84"
        />
        <SessionRow
          kind="lift"
          day="Fri"
          title="Upper B"
          detail="14.1k lb · 52 min"
        />
      </Group>
      <SecondaryButton href="#/phone/history">All history</SecondaryButton>
    </div>
  );
}
