/* Coach (DESIGN 7.11, DECISIONS U8): open-ended conversation inside
 * fitness/training/health/recovery topics; every actionable suggestion
 * passes through the P3 envelope, shown as engine-vs-coach cards with
 * Use coach / Keep engine. Memory proposals accept/reject. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import {
  Chip,
  MemoryProposalList,
  PlateChips,
  PrimaryButton,
  SecondaryButton,
} from "../../shared/ui.tsx";
import { ArrowRight } from "../../shared/icons.ts";
import {
  nearestLoadable,
  planPlates,
} from "../../../../../packages/core/plates.ts";

type Turn = { who: "coach" | "you"; text: string };

export function CoachPage() {
  const { envelopes, decideEnvelope, memory, decideMemory, queueOp, settings } =
    useQala();
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<Turn[]>([
    {
      who: "coach",
      text: "Squat holds at 245 today. Quads are still carrying Friday.",
    },
  ]);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Coach</h1>
        <span className="coach-status">Runs on callisto</span>
      </div>
      <div className="chip-row coach-context">
        <Chip>Today: Lower A</Chip>
        <Chip>Check-in: recovery 7, quads 4</Chip>
      </div>
      <ol className="thread">
        {thread.map((t, i) => (
          <li key={i} className={`msg ${t.who}`}>
            <span className="msg-who">
              {t.who === "coach" ? "Coach" : "You"}
            </span>
            <p>{t.text}</p>
          </li>
        ))}
      </ol>
      {envelopes.map((e) => (
        <section className="env-card" key={e.id} aria-label={e.title}>
          <div className="env-head">
            <span className="group-label">Suggested change</span>
            <strong>{e.title}</strong>
          </div>
          <div className="env-nums">
            {(["engine", "coach"] as const).map((who) => {
              const text = who === "engine" ? e.engine : e.coach;
              const load = parseFloat(text);
              const sides = Number.isFinite(load)
                ? nearestLoadable(
                  planPlates(
                    load,
                    settings.defaultBar,
                    settings.plates,
                    settings.collarWeight,
                  ),
                )?.perSide
                : undefined;
              return (
                <div
                  className={who === "coach" ? "cell coach" : "cell"}
                  key={who}
                >
                  <span className="group-label">
                    {who === "engine" ? "Engine" : "Coach"}
                  </span>
                  <span className="figure">{text}</span>
                  {sides
                    ? (
                      <>
                        <PlateChips
                          plates={sides}
                          inventory={settings.plates}
                        />
                        <span className="kbd-hint">
                          {sides.join("  ")}
                        </span>
                      </>
                    )
                    : null}
                </div>
              );
            })}
          </div>
          <p className="env-reason">{e.reason}</p>
          <p className="kbd-hint">
            Coach can move weight -10% to +2.5% and sets -2 to +1.
          </p>
          {e.accepted === null
            ? (
              <div className="row-btns">
                <SecondaryButton onClick={() => decideEnvelope(e.id, false)}>
                  Keep engine
                </SecondaryButton>
                <PrimaryButton
                  onClick={() =>
                    decideEnvelope(e.id, true)}
                >
                  Use coach
                </PrimaryButton>
              </div>
            )
            : (
              <p className="env-done">
                {e.accepted
                  ? "Coach's numbers in use."
                  : "Engine numbers kept."}
              </p>
            )}
        </section>
      ))}
      <section className="card flat-rest">
        <h2 className="card-title title">Remember this?</h2>
        <MemoryProposalList
          memory={memory}
          decideMemory={decideMemory}
          acceptedLabel="Saved to memory."
          rejectedLabel="Discarded."
        />
      </section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          queueOp("coach-ask", { draft });
          setThread((t) => [
            ...t,
            { who: "you", text: draft },
            {
              who: "coach",
              text: "Noted. Anything actionable comes back as a card above.",
            },
          ]);
          setDraft("");
        }}
        className="coach-composer"
      >
        <input
          aria-label="Ask the coach"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about training, recovery..."
        />
        <button type="submit" className="btn-primary" aria-label="Send">
          <ArrowRight size={20} />
        </button>
      </form>
    </div>
  );
}
