/* Desktop Body: readiness, sets by muscle (click a muscle for its trend and
 * recovery detail), and the fatigue split lifting carries versus running.
 * The wider desktop counterpart to the phone's Body page (DESIGN 7.9). */

import { Group, GroupRow } from "../shared/ui.tsx";
import {
  FatigueByMuscle,
  ReadinessLine,
  SetsByMuscle,
} from "../shared/charts/index.ts";
import { sampleMuscles, sampleReadiness } from "../store/sample.ts";

export function DesktopBodyPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Body</h1>
      </div>
      <div className="card-grid">
        <ReadinessLine
          values={sampleReadiness.values}
          avg={sampleReadiness.avg}
          low={sampleReadiness.low}
        />
        <SetsByMuscle
          title="Sets by muscle, this week"
          muscles={sampleMuscles}
          onSelectMuscle={(m) => {
            window.location.hash = `#/desktop/body/${m}`;
          }}
        />
      </div>
      <FatigueByMuscle
        muscles={sampleMuscles.map((m) => ({
          muscle: m.muscle,
          lifting: m.lifting,
          running: m.running,
          ready: m.readyDay,
        }))}
      />
      <Group label="Deload status">
        <GroupRow>
          <span>No deload due. Next planned: week 6.</span>
        </GroupRow>
      </Group>
    </div>
  );
}
