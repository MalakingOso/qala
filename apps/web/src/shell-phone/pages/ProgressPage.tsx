/* Progress (DESIGN 7.10): block headline, 1RM with markers, NL85 vs block
 * target, sets per muscle, running fitness + miles, recent sessions. */

import { Card, Group, GroupRow } from "../../shared/ui.tsx";
import {
  BulletNl85,
  E1rmLine,
  RunSpark,
  SetsByMuscle,
} from "../../shared/charts/index.ts";

export function ProgressPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Strength B2 · W3</h1>
      </div>
      <Card hero>
        <h2 className="title" style={{ fontSize: 22, margin: "0 0 4px" }}>
          Squat is up 4% this block
        </h2>
        <p className="kbd-hint">reference 1RM 280 · Kalman 283 · tested 280</p>
      </Card>
      <E1rmLine
        lift="Squat 1RM"
        points={[
          { label: "w1", e1rm: 272 },
          { label: "w2", e1rm: 276 },
          { label: "w3", e1rm: 279, tested: true },
          { label: "now", e1rm: 283 },
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
        title="Sets per muscle"
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
        <GroupRow>
          <span>Sun · Lower A · 20.4k lb</span>
          <span className="kbd-hint">today</span>
        </GroupRow>
        <GroupRow>
          <span>Sat · Long run · 7.0 mi</span>
          <span className="kbd-hint">rTSS 84</span>
        </GroupRow>
        <GroupRow>
          <span>Fri · Upper B · 14.1k lb</span>
          <span className="kbd-hint">1 PR</span>
        </GroupRow>
      </Group>
      <p>
        <a className="link-btn" href="#/phone/history">All history</a>
      </p>
    </div>
  );
}
