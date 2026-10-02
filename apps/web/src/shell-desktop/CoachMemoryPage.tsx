/* Coach memory editor (DESIGN 7.16, DECISIONS U21): proposals to accept or
 * reject, the profile the coach reads, and the coach log with its limits. */

import { useQala } from "../store/qalaStore.tsx";
import { sampleBlock, sampleLifts } from "../store/sample.ts";
import { MemoryProposalList } from "../shared/ui.tsx";
import { PageHeader, Panel, Pill } from "./parts.tsx";

const LOG: {
  date: string;
  tone: "warn" | "info";
  tag: string;
  text: string;
}[] = [
  {
    date: "Sep 13",
    tone: "warn",
    tag: "clamped",
    text: "Squat −2% clamped inside the envelope. Reason logged.",
  },
  {
    date: "Sep 12",
    tone: "info",
    tag: "discarded",
    text: "Interval-to-easy suggestion discarded (lifting priority).",
  },
];

export function CoachMemoryPage() {
  const { memory, decideMemory, settings } = useQala();
  const pending = memory.filter((m) => m.accepted === null).length;
  const squat = sampleLifts.find((l) => l.id === "squat");
  return (
    <div>
      <PageHeader
        kicker={`${pending} ${
          pending === 1 ? "proposal" : "proposals"
        } waiting · what the coach reads before every adjustment`}
        title="Coach memory"
      >
        <MemoryProposalList memory={memory} decideMemory={decideMemory} />
      </PageHeader>
      <div className="two-col even">
        <Panel title="Profile the coach reads">
          <dl className="profile">
            <div>
              <dt>Level</dt>
              <dd>Intermediate</dd>
            </div>
            <div>
              <dt>Training</dt>
              <dd>{sampleBlock.profile}</dd>
            </div>
            <div>
              <dt>Squat e1RM</dt>
              <dd>{squat ? `${squat.e1rm} lb` : "not recorded"}</dd>
            </div>
            <div>
              <dt>Recovery</dt>
              <dd>Quads slow to recover</dd>
            </div>
            <div>
              <dt>Sleep</dt>
              <dd>6 h on weeknights</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Coach log">
          <ul className="log-rows">
            {LOG.map((l) => (
              <li key={l.date}>
                <span className="dt">{l.date}</span>
                <Pill tone={l.tone}>{l.tag}</Pill>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
          <p className="kbd-hint">
            <b>Limits</b> · {settings.coach.limits.replace("-", "−")}
          </p>
        </Panel>
      </div>
    </div>
  );
}
