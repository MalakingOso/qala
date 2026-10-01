/* Desktop Body: readiness, sets by muscle (click a muscle for its trend and
 * recovery detail), with the recovery map the phone shows.
 * The wider desktop counterpart to the phone's Body page (DESIGN 7.9). */

import { Group, GroupRow } from "../shared/ui.tsx";
import { ReadinessLine, SetsByMuscle } from "../shared/charts/index.ts";
import { RecoveryMap } from "../shared/bodymap/RecoveryMap.tsx";
import {
  sampleMuscles,
  sampleReadiness,
  sampleRecovery,
} from "../store/sample.ts";

export function DesktopBodyPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Body</h1>
      </div>
      <RecoveryMap muscles={sampleRecovery} />
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
      <Group label="Deload status">
        <GroupRow>
          <span>No deload due. Next planned: week 6.</span>
        </GroupRow>
      </Group>
    </div>
  );
}
