/* Workout, one exercise (DESIGN 7.5): progress segments, returning note,
 * big weight x reps steppers, plate shorthand, RPE chips, actions, rest
 * preview + next exercise. All-exercises overview lives next door. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import {
  Card,
  EngineBanner,
  NoteCard,
  PlateChips,
  PrimaryButton,
  ProgressSegments,
} from "../../shared/ui.tsx";
import { formatShorthand, platesPerSide } from "../../logic/plateShorthand.ts";
import {
  ArrowLeftRight,
  Calculator,
  Check,
  ChevronLeft,
  Info,
  LayoutGrid,
  Minus,
  Plus,
  StickyNote,
  TriangleAlert,
} from "../../shared/icons.ts";

export function WorkoutPage() {
  const { exercises, logSet, queueOp } = useQala();
  const [idx, setIdx] = useState(0);
  const [weight, setWeight] = useState(exercises[0]?.sets[2]?.w ?? 245);
  const [reps, setReps] = useState(4);
  const [rpe, setRpe] = useState<number | null>(null);
  const [jointPain, setJointPain] = useState(false);
  const [noteGone, setNoteGone] = useState(false);
  const [reverted, setReverted] = useState(false);

  const ex = exercises[idx];
  if (!ex) return <p>No exercises today.</p>;
  const doneSets = ex.sets.filter((s) => s.done).length;
  const setNo = Math.min(doneSets + 1, ex.sets.length);
  const perSide = platesPerSide(weight);

  return (
    <div>
      <div className="page-head">
        <a className="icon-btn" href="#/phone/allex" aria-label="Collapse">
          <ChevronLeft size={20} />
        </a>
        <span className="kbd-hint">Lower A · <span className="ticking">24:10</span></span>
        <a className="link-btn" href="#/phone/complete">
          Finish
        </a>
      </div>
      <ProgressSegments total={exercises.length} done={idx} current={idx} label={`Exercise ${idx + 1} of ${exercises.length}`} />
      <p className="kbd-hint">
        Exercise {idx + 1} of {exercises.length} · Set {setNo} of {ex.sets.length}
      </p>
      {ex.note && !noteGone ? (
        <NoteCard
          date={ex.note.date}
          text={ex.note.text}
          pinned={ex.note.pinned}
          onGotIt={() => setNoteGone(true)}
          onPin={() => queueOp("note-pin", { id: ex.note?.id })}
          onResolve={() => setNoteGone(true)}
        />
      ) : null}
      {!reverted ? (
        <EngineBanner
          text="Coach suggests 240 x 4 (quads sore). Engine says 245 x 4."
          engine="245 x 4"
          coach="240 x 4"
          onRevert={() => {
            setReverted(true);
            setWeight(245);
          }}
        />
      ) : null}
      <Card hero>
        <h1 className="title" style={{ fontSize: 24, margin: "0 0 4px" }}>
          {ex.name}
        </h1>
        <p className="kbd-hint">Last time: {ex.lastTime}</p>
        <div style={{ display: "flex", gap: 16, alignItems: "center", margin: "12px 0" }}>
          <div>
            <div className="group-label">Weight</div>
            <div className="figure" style={{ fontSize: 56 }}>
              {weight}
            </div>
            <div>
              <button type="button" className="icon-btn" aria-label="Less weight" onClick={() => setWeight((w) => w - 5)}>
                <Minus size={18} />
              </button>{" "}
              <button type="button" className="icon-btn" aria-label="More weight" onClick={() => setWeight((w) => w + 5)}>
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className="figure" style={{ fontSize: 40 }} aria-hidden="true">
            ×
          </div>
          <div>
            <div className="group-label">Reps</div>
            <div className="figure" style={{ fontSize: 56 }}>
              {reps}
            </div>
            <div>
              <button type="button" className="icon-btn" aria-label="Fewer reps" onClick={() => setReps((r) => Math.max(1, r - 1))}>
                <Minus size={18} />
              </button>{" "}
              <button type="button" className="icon-btn" aria-label="More reps" onClick={() => setReps((r) => r + 1)}>
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>
        <p>
          <PlateChips plates={perSide} />{" "}
          <a className="link-btn" href="#/phone/plates" aria-label="Open plate calculator">
            <Calculator size={16} /> {formatShorthand(perSide)}
          </a>
        </p>
        <p className="group-label">RPE (target {ex.targetRpe})</p>
        <div style={{ display: "flex", gap: 4 }}>
          {[7, 7.5, 8, 8.5, 9, 9.5, 10].map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={rpe === v}
              onClick={() => setRpe(v)}
              className="icon-btn"
              style={rpe === v ? { background: "var(--bg-active)", outline: "2px solid var(--accent)" } : undefined}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="row-btns" style={{ marginTop: 12 }}>
          <button type="button" className="icon-btn" aria-label="Exercise info" style={{ flex: 1 }}>
            <Info size={18} />
          </button>
          <button type="button" className="icon-btn" aria-label="Swap exercise" style={{ flex: 1 }}>
            <ArrowLeftRight size={18} />
          </button>
          <button type="button" className="icon-btn" aria-label="Add note" style={{ flex: 1 }}>
            <StickyNote size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Joint pain"
            aria-pressed={jointPain}
            style={jointPain ? { outline: "2px solid var(--danger)", flex: 1 } : { flex: 1 }}
            onClick={() => {
              setJointPain((j) => !j);
              queueOp("joint-pain", { exerciseId: ex.id });
            }}
          >
            <TriangleAlert size={18} />
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <PrimaryButton
            onClick={() => {
              logSet(ex.id, setNo - 1);
              window.location.hash = "#/phone/rest";
            }}
          >
            <Check size={20} /> Log set
          </PrimaryButton>
        </div>
        <p className="kbd-hint">
          Rest preview 3:45 · Next: {exercises[idx + 1]?.name ?? "done"}
        </p>
      </Card>
      <p>
        <a className="link-btn" href="#/phone/allex">
          <LayoutGrid size={16} /> All exercises · swipe or tap segments to move
        </a>
      </p>
      <div className="row-btns">
        <button type="button" className="icon-btn" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
          Prev
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={idx >= exercises.length - 1}
          onClick={() => setIdx((i) => Math.min(exercises.length - 1, i + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
}
