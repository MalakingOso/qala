/* Body (DESIGN 7.9): readiness line, muscle map placeholder over liftosaur
 * SVGs, fatigue split, deload status, owned recovery tools. */

import { Card, Group, GroupRow } from "../../shared/ui.tsx";
import { FatigueByMuscle, ReadinessLine } from "../../shared/charts/index.ts";

export function BodyPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Legs are still recovering</h1>
      </div>
      <ReadinessLine values={[78, 74, 80, 76, 71, 69, 72]} avg={76} low={64} />
      <Card>
        <p className="group-label">Muscle map</p>
        <p className="kbd-hint">
          Front/back soreness grid draws over liftosaur's front-muscles.svg and
          back-muscles.svg (PLAN 3). Sample values below; check-in doesn't save
          soreness anywhere this page can read yet, so it isn't interactive.
        </p>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          {[
            "quads 4",
            "glutes 2",
            "hamstrings 2",
            "calves 1",
            "chest 1",
            "lats 2",
          ].map((m) => (
            <div
              key={m}
              className="group-row"
              style={{
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius)",
              }}
            >
              {m}
            </div>
          ))}
        </div>
      </Card>
      <FatigueByMuscle
        muscles={[
          { muscle: "quads", lifting: 4.2, running: 1.1, ready: "Wed" },
          { muscle: "glutes", lifting: 3.1, running: 0.6, ready: "Tue" },
          { muscle: "hamstrings", lifting: 1.8, running: 0.9, ready: "Tue" },
          { muscle: "calves", lifting: 0.9, running: 1.4, ready: "now" },
        ]}
      />
      <Group label="Deload status">
        <GroupRow>
          <span>No deload due. Next planned: week 6.</span>
        </GroupRow>
      </Group>
      <Group label="Recovery tools you own">
        <GroupRow>
          <span>Foam roller · Theragun</span>
          <a className="link-btn" href="#/phone/settings">Edit</a>
        </GroupRow>
      </Group>
    </div>
  );
}
