/* Rest (DESIGN 7.6): ticking countdown with "of", Ready early / +30 s,
 * plate drawing for the next set, "why" reasons, next-exercise change. */

import { useEffect, useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import { sampleRest } from "../../store/sample.ts";
import {
  Card,
  PlateDrawing,
  PrimaryButton,
  SecondaryButton,
} from "../../shared/ui.tsx";
import { formatClock, formatRestWhy } from "../../logic/restFormat.ts";
import { describeChange } from "../../../../../packages/core/plates.ts";

export function RestPage() {
  const { queueOp } = useQala();
  const [left, setLeft] = useState(sampleRest.seconds);
  const changeText = describeChange(
    sampleRest.platesNow,
    sampleRest.platesNext,
  );
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const why = formatRestWhy(sampleRest.seconds, {
    base: sampleRest.base,
    adjustments: sampleRest.adjustments,
  });
  return (
    <div>
      <div className="page-head">
        <span className="kbd-hint">
          Lower A · <span className="ticking">24:10</span>
        </span>
        <a className="link-btn" href="#/phone/complete">
          Finish
        </a>
      </div>
      <Card hero>
        <p className="group-label">Back Squat · set 2 logged: 245 x 4 @ 9</p>
        <div className="figure ticking" style={{ fontSize: 96, lineHeight: 1 }}>
          {formatClock(left)}
        </div>
        <p className="ticking">of {formatClock(sampleRest.seconds)}</p>
        <div
          style={{ height: 8, background: "var(--bg-active)", margin: "8px 0" }}
        >
          <div
            style={{
              height: "100%",
              width: `${
                Math.round(
                  (100 * (sampleRest.seconds - left)) / sampleRest.seconds,
                )
              }%`,
              background: "var(--progress-fill)",
            }}
          />
        </div>
        <div className="row-btns">
          <SecondaryButton
            onClick={() => {
              queueOp("rest-ready-early", { left });
              window.location.hash = "#/phone/workout";
            }}
          >
            Ready early
          </SecondaryButton>
          <SecondaryButton onClick={() => setLeft((s) => s + 30)}>
            +30 s
          </SecondaryButton>
        </div>
        <p className="group-label" style={{ marginTop: 12 }}>
          Next: 245 · {changeText}
        </p>
        <PlateDrawing perSide={sampleRest.platesNext} label="Next set plates" />
        <p className="kbd-hint">Why {formatClock(sampleRest.seconds)}: {why}</p>
        <div className="note-card">
          <div className="note-head">After squats: RDL 205</div>
          <div>Take off 45 and 10, add 35 each side.</div>
        </div>
        <PrimaryButton href="#/phone/workout">Next set</PrimaryButton>
      </Card>
    </div>
  );
}
