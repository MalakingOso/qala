/* Coach (DESIGN 7.11, DECISIONS U8): open-ended conversation inside
 * fitness/training/health/recovery topics; every actionable suggestion
 * passes through the P3 envelope, shown as engine-vs-coach cards with
 * Use coach / Keep engine. Memory proposals accept/reject. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import { Card, Chip } from "../../shared/ui.tsx";

export function CoachPage() {
  const { envelopes, decideEnvelope, memory, decideMemory, queueOp } = useQala();
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<string[]>([
    "Coach: Squat holds at 245 today. Quads are still carrying Friday.",
  ]);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Coach</h1>
        <span className="kbd-hint">Runs on callisto</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <Chip>today: Lower A</Chip>
        <Chip>check-in: PRS 7, quads 4</Chip>
      </div>
      {thread.map((m, i) => (
        <Card key={i}>
          <p style={{ margin: 0 }}>{m}</p>
        </Card>
      ))}
      {envelopes.map((e) => (
        <div className="env-card" key={e.id}>
          <strong>{e.title}</strong>
          <div className="env-nums">
            <div className="cell">
              <div className="group-label">Engine</div>
              <div className="figure" style={{ fontSize: 20 }}>{e.engine}</div>
            </div>
            <div className="cell">
              <div className="group-label">Coach</div>
              <div className="figure" style={{ fontSize: 20 }}>{e.coach}</div>
            </div>
          </div>
          <p className="kbd-hint">{e.reason}</p>
          {e.platesPerSide ? <p className="kbd-hint">plates per side: {e.platesPerSide}</p> : null}
          <p className="kbd-hint">Limits: weight -10% to +2.5%, sets -2 to +1.</p>
          {e.accepted === null ? (
            <div className="row-btns">
              <button type="button" className="btn-primary" style={{ width: "auto", flex: 1 }} onClick={() => decideEnvelope(e.id, true)}>
                Use coach
              </button>
              <button type="button" className="btn-secondary" style={{ width: "auto", flex: 1 }} onClick={() => decideEnvelope(e.id, false)}>
                Keep engine
              </button>
            </div>
          ) : (
            <p className="kbd-hint">{e.accepted ? "Coach values in use." : "Engine values kept."}</p>
          )}
        </div>
      ))}
      <Card>
        <p className="group-label">Remember this?</p>
        {memory.map((m) => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <p style={{ margin: "4px 0" }}>{m.text}</p>
            <p className="kbd-hint">{m.source} · {m.date}</p>
            {m.accepted === null ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="chip" onClick={() => decideMemory(m.id, true)}>Accept</button>
                <button type="button" className="chip" onClick={() => decideMemory(m.id, false)}>Reject</button>
              </div>
            ) : (
              <p className="kbd-hint">{m.accepted ? "Saved to memory." : "Discarded."}</p>
            )}
          </div>
        ))}
      </Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          queueOp("coach-ask", { draft });
          setThread((t) => [...t, `You: ${draft}`, "Coach: Noted. Anything actionable will come back as a card above."]);
          setDraft("");
        }}
        style={{ display: "flex", gap: 8, position: "sticky", bottom: 80, background: "var(--bg)", padding: "8px 0" }}
      >
        <input
          aria-label="Ask the coach"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about training, recovery, running..."
          style={{ flex: 1, minHeight: 44, font: "inherit", padding: 8 }}
        />
        <button type="submit" className="btn-primary" style={{ width: "auto" }}>
          Send
        </button>
      </form>
    </div>
  );
}
