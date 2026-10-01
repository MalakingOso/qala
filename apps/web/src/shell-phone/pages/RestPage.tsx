/* Rest (DESIGN 7.6): ticking countdown with "of", a bar that runs down,
 * Ready early (it becomes Start once time is up) and +30 s, the loaded bar
 * for the next set, the reasons behind the number as a small ledger, and
 * the plate change waiting after this exercise. */

import { useEffect, useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import { sampleRest } from "../../store/sample.ts";
import {
  Card,
  PlateChips,
  PlateDrawing,
  PrimaryButton,
  SecondaryButton,
} from "../../shared/ui.tsx";
import { formatClock, formatDuration } from "../../logic/restFormat.ts";
import { describeChange } from "../../../../../packages/core/plates.ts";
import { ArrowRight, Plus } from "../../shared/icons.ts";
import { FlowHeader } from "../FlowHeader.tsx";

function signed(sec: number) {
  return `${sec >= 0 ? "+" : "−"}${formatDuration(Math.abs(sec))}`;
}

export function RestPage() {
  const { queueOp, settings } = useQala();
  const [left, setLeft] = useState(sampleRest.seconds);
  const [budget, setBudget] = useState(sampleRest.seconds);
  const changeText = describeChange(
    sampleRest.platesNow,
    sampleRest.platesNext,
  );
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const done = left === 0;
  return (
    <div>
      <FlowHeader session="Lower A" clock="24:10" />
      <Card hero>
        <p className="rest-logged">
          <span className="group-label">Back Squat · set 2 logged</span>
          <span className="kbd-hint">245 × 4 @ 9</span>
        </p>
        <div className="rest-clock">
          <span className="figure ticking rest-left">{formatClock(left)}</span>
          <span className="rest-of ticking">of {formatClock(budget)}</span>
        </div>
        <div
          className="rest-track"
          role="progressbar"
          aria-label="Rest left"
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={left}
        >
          <span style={{ width: `${(100 * left) / budget}%` }} />
        </div>
        <div className="rest-actions">
          <SecondaryButton
            onClick={() => {
              setLeft((s) => s + 30);
              setBudget((b) => b + 30);
              queueOp("rest-plus-30", { left });
            }}
            label="Add 30 seconds"
          >
            <Plus size={18} /> 30 s
          </SecondaryButton>
          <PrimaryButton
            href="#/phone/workout"
            onClick={() => {
              if (!done) queueOp("rest-ready-early", { left });
            }}
          >
            {done ? "Start set 3" : "Ready early"} <ArrowRight size={18} />
          </PrimaryButton>
        </div>
      </Card>

      <section className="card flat-rest">
        <div className="rest-next-head">
          <span className="group-label">Next · set 3</span>
          <span className="rest-next-load figure">
            {sampleRest.nextLoad} <span className="figure-unit">lb</span> × 4
          </span>
        </div>
        <p className="kbd-hint rest-change">
          {changeText === "no change"
            ? "Same as last set, leave the plates on."
            : `Then ${changeText}.`}
        </p>
        <PlateDrawing
          perSide={sampleRest.platesNext}
          label="Next set plates"
          inventory={settings.plates}
        />
      </section>

      <section
        className="group"
        aria-label={`Why ${formatClock(sampleRest.seconds)}`}
      >
        <div className="group-head">
          <span className="group-label">
            Why {formatClock(sampleRest.seconds)}
          </span>
        </div>
        <dl className="ledger">
          <div>
            <dt>Base for a heavy squat</dt>
            <dd>{formatDuration(sampleRest.base)}</dd>
          </div>
          {sampleRest.adjustments.map((a) => (
            <div key={a.label}>
              <dt>{a.label}</dt>
              <dd className={a.seconds < 0 ? "minus" : "plus"}>
                {signed(a.seconds)}
              </dd>
            </div>
          ))}
          <div className="ledger-total">
            <dt>Rest</dt>
            <dd>{formatClock(sampleRest.seconds)}</dd>
          </div>
        </dl>
      </section>

      <section className="card flat-rest swap-card">
        <span className="group-label">After squats · RDL 205</span>
        <div className="swap-plates">
          <PlateChips plates={[45, 45, 10]} inventory={settings.plates} />
          <ArrowRight size={16} aria-hidden="true" />
          <PlateChips plates={[45, 35]} inventory={settings.plates} />
        </div>
        <p className="kbd-hint">Take off 45 and 10, add 35 each side.</p>
      </section>
    </div>
  );
}
