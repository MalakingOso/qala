/* Warm-up (DESIGN 7.4, PLAN 6.7): four numbered steps, General, Soft
 * tissue, Mobility, Ramp sets, each with its time and the reason behind it.
 * Soft tissue and mobility items check off; ramp sets show the plates for
 * each step. Coach-practice rules are footnoted. */

import { type ReactNode, useState } from "react";
import {
  PlateChips,
  PrimaryButton,
  SecondaryButton,
} from "../../shared/ui.tsx";
import {
  nearestLoadable,
  planPlates,
} from "../../../../../packages/core/plates.ts";
import { useQala } from "../../store/qalaStore.tsx";
import {
  ArrowRight,
  Bike,
  Check,
  Cylinder,
  Vibrate,
} from "../../shared/icons.ts";

const RAMP: {
  load: number;
  reps: number;
  rest: string;
  why?: string;
}[] = [
  { load: 45, reps: 8, rest: "45 s" },
  { load: 135, reps: 5, rest: "60 s" },
  { load: 165, reps: 5, rest: "60 s", why: "extra step: quads sore" },
  { load: 195, reps: 2, rest: "90 s" },
  { load: 215, reps: 1, rest: "2:00" },
];

const TISSUE = [
  {
    id: "quads",
    what: "Quads",
    tool: "Foam roller",
    icon: Cylinder,
    time: "2:00 a side",
    why: "sore (4)*",
  },
  {
    id: "glutes",
    what: "Glutes",
    tool: "Theragun",
    icon: Vibrate,
    time: "1:00 a side",
    why: "your preference*",
  },
];

const MOBILITY = [
  {
    id: "squat",
    what: "Bodyweight squats, walking lunges",
    for: "quads, glutes",
  },
  { id: "hinge", what: "Good mornings, glute bridges", for: "hamstrings" },
];

function Step(
  { n, title, time, children }: {
    n: number;
    title: string;
    time: string;
    children: ReactNode;
  },
) {
  return (
    <section className="warm-step" aria-label={`${n}. ${title}`}>
      <div className="warm-step-head">
        <span className="warm-step-n">{n}</span>
        <h2 className="title">{title}</h2>
        <span className="kbd-hint">{time}</span>
      </div>
      {children}
    </section>
  );
}

function CheckRow(
  { done, onFlip, children }: {
    done: boolean;
    onFlip: () => void;
    children: ReactNode;
  },
) {
  return (
    <button
      type="button"
      className="check-row"
      role="checkbox"
      aria-checked={done}
      onClick={onFlip}
    >
      <span className="check-box" aria-hidden="true">
        {done ? <Check size={16} /> : null}
      </span>
      <span className="check-body">{children}</span>
    </button>
  );
}

export function WarmupPage() {
  const { settings } = useQala();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const flip = (id: string) => setDone((d) => ({ ...d, [id]: !d[id] }));
  const platesFor = (load: number): number[] => {
    const plan = planPlates(
      load,
      settings.defaultBar,
      settings.plates,
      settings.collarWeight,
    );
    return nearestLoadable(plan)?.perSide ?? [];
  };
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Before Lower A · 15 min</p>
          <h1 className="page-title title">Warm-up</h1>
        </div>
        <SecondaryButton small href="#/phone/workout">Skip</SecondaryButton>
      </div>

      <Step n={1} title="General" time="10 min">
        <div className="warm-general">
          <Bike size={22} aria-hidden="true" />
          <div>
            <strong>Bike, easy pace</strong>
            <p className="kbd-hint">
              10 min today because the top set is 87% of your 1RM.
            </p>
          </div>
        </div>
      </Step>

      <Step n={2} title="Soft tissue" time="6 min">
        {TISSUE.map((t) => {
          const Icon = t.icon;
          return (
            <CheckRow
              key={t.id}
              done={!!done[t.id]}
              onFlip={() => flip(t.id)}
            >
              <strong>{t.what}</strong>
              <span className="kbd-hint">
                <Icon size={13} aria-hidden="true" /> {t.tool} · {t.time} ·{" "}
                {t.why}
              </span>
            </CheckRow>
          );
        })}
      </Step>

      <Step n={3} title="Mobility" time="2 drills × 10">
        {MOBILITY.map((m) => (
          <CheckRow
            key={m.id}
            done={!!done[m.id]}
            onFlip={() => flip(m.id)}
          >
            <strong>{m.what}</strong>
            <span className="kbd-hint">{m.for}</span>
          </CheckRow>
        ))}
      </Step>

      <Step n={4} title="Ramp sets" time="squat to 245">
        <ol className="ramp">
          {RAMP.map((r) => (
            <li key={r.load} className={r.why ? "extra" : undefined}>
              <span className="ramp-load">
                <span className="figure">{r.load}</span>
                <span className="kbd-hint">× {r.reps}</span>
              </span>
              <span className="ramp-plates">
                <PlateChips
                  plates={platesFor(r.load)}
                  inventory={settings.plates}
                />
                <span className="kbd-hint">
                  {platesFor(r.load).join("  ") || "bar only"}
                </span>
              </span>
              <span className="ramp-rest kbd-hint">rest {r.rest}</span>
              {r.why ? <span className="ramp-why">{r.why}*</span> : null}
            </li>
          ))}
          <li className="work">
            <span className="ramp-load">
              <span className="figure">245</span>
              <span className="kbd-hint">× 4</span>
            </span>
            <span className="ramp-plates">
              <PlateChips plates={platesFor(245)} inventory={settings.plates} />
              <span className="kbd-hint">{platesFor(245).join("  ")}</span>
            </span>
            <span className="ramp-rest kbd-hint">work sets</span>
          </li>
        </ol>
      </Step>

      <PrimaryButton large href="#/phone/workout">
        Start workout <ArrowRight size={20} />
      </PrimaryButton>
      <p className="kbd-hint footnote">
        * A coach-practice rule, not a study prescription.
      </p>
    </div>
  );
}
