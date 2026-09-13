/* Coach memory editor (DESIGN 7.16): dated, sourced facts with
 * Accept / Reject, the computed profile, and the coach log. */

import { useQala } from "../store/qalaStore.tsx";
import { Card, MemoryProposalList } from "../shared/ui.tsx";

export function CoachMemoryPage() {
  const { memory, decideMemory } = useQala();
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Coach memory</h1>
      </div>
      <Card title="Pending proposals">
        <MemoryProposalList memory={memory} decideMemory={decideMemory} />
      </Card>
      <Card title="Profile the coach reads">
        <p>
          Intermediate · 4-day upper/lower + 3 runs · squat e1RM 283 · quads
          slow to recover · 6 h weeknight sleep.
        </p>
      </Card>
      <Card title="Coach log">
        <p className="kbd-hint">
          Sep 13 · squat -2% clamped inside envelope · reason logged.
        </p>
        <p className="kbd-hint">
          Sep 12 · interval-to-easy suggestion discarded (lifting priority).
        </p>
      </Card>
    </div>
  );
}
