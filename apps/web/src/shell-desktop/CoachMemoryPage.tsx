/* Coach memory editor (DESIGN 7.16): dated, sourced facts with
 * Accept / Reject, the computed profile, and the coach log. */

import { useQala } from "../store/qalaStore.tsx";
import { Card } from "../shared/ui.tsx";

export function CoachMemoryPage() {
  const { memory, decideMemory } = useQala();
  return (
    <div>
      <div className="page-head">
        <h2 className="title" style={{ margin: 0 }}>Coach memory</h2>
      </div>
      <Card title="Pending proposals">
        {memory.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <p style={{ margin: "4px 0" }}>{m.text}</p>
            <p className="kbd-hint">{m.source} · {m.date}</p>
            {m.accepted === null ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="chip" onClick={() => decideMemory(m.id, true)}>Accept</button>
                <button type="button" className="chip" onClick={() => decideMemory(m.id, false)}>Reject</button>
              </div>
            ) : (
              <p className="kbd-hint">{m.accepted ? "Accepted." : "Rejected."}</p>
            )}
          </div>
        ))}
      </Card>
      <Card title="Profile the coach reads">
        <p>Intermediate · 4-day upper/lower + 3 runs · squat e1RM 283 · quads slow to recover · 6 h weeknight sleep.</p>
      </Card>
      <Card title="Coach log">
        <p className="kbd-hint">Sep 13 · squat -2% clamped inside envelope · reason logged.</p>
        <p className="kbd-hint">Sep 12 · interval-to-easy suggestion discarded (lifting priority).</p>
      </Card>
    </div>
  );
}
