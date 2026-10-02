/* Desktop Body (DECISIONS U21): the recovery map leads, front and back side
 * by side with the selected muscle's fatigue curve under it, then readiness
 * by weekday, sets by muscle and the deload status. The map is the real
 * liftosaur artwork, tinted by how long each muscle has left. */

import { ReadinessLine, SetsByMuscle } from "../shared/charts/index.ts";
import { RecoveryMap } from "../shared/bodymap/RecoveryMap.tsx";
import {
  sampleBlock,
  sampleMuscles,
  sampleReadiness,
  sampleRecovery,
} from "../store/sample.ts";
import { BlockBar, PageHeader, Panel } from "./parts.tsx";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DesktopBodyPage() {
  const latest = sampleReadiness.values[sampleReadiness.values.length - 1];
  return (
    <div>
      <PageHeader
        kicker={`Readiness ${latest} · ${
          latest - sampleReadiness.low
        } above your low line · average ${sampleReadiness.avg}`}
        title="Body"
      >
        <RecoveryMap flat both muscles={sampleRecovery} />
      </PageHeader>
      <div className="two-col even">
        <ReadinessLine
          values={sampleReadiness.values}
          avg={sampleReadiness.avg}
          low={sampleReadiness.low}
          days={WEEKDAYS}
        />
        <SetsByMuscle
          title="Sets by muscle, this week"
          muscles={sampleMuscles}
          onSelectMuscle={(m) => {
            window.location.hash = `#/desktop/body/${m}`;
          }}
        />
      </div>
      <Panel title="Deload status">
        <p className="deload-line">
          <b className="title">No deload due.</b> Next planned: week{" "}
          {sampleBlock.deloadWeek}.
        </p>
        <BlockBar
          numbered
          week={sampleBlock.week}
          of={sampleBlock.of}
          deloadWeek={sampleBlock.deloadWeek}
        />
      </Panel>
    </div>
  );
}
