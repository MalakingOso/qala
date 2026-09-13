/* Workout, one exercise (DESIGN 7.5): progress segments, returning note,
 * big weight x reps steppers, plate shorthand, RPE chips, actions, rest
 * preview + next exercise. All-exercises overview lives next door. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import type { WorkoutExercise } from "../../store/types.ts";
import {
  Card,
  EngineBanner,
  NoteCard,
  PlateChips,
  PrimaryButton,
  ProgressSegments,
} from "../../shared/ui.tsx";
import {
  nearestLoadable,
  planPlates,
  platesShorthand,
} from "../../../../../packages/core/plates.ts";
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

export function WorkoutPage({ initialIdx = 0 }: { initialIdx?: number }) {
  const { exercises } = useQala();
  const [idx, setIdx] = useState(initialIdx);
  const ex = exercises[idx];
  if (!ex) return <p>No exercises today.</p>;

  return (
    <div>
      <div className="page-head">
        <a className="icon-btn" href="#/phone/allex" aria-label="Collapse">
          <ChevronLeft size={20} />
        </a>
        <span className="kbd-hint">
          Lower A · <span className="ticking">24:10</span>
        </span>
        <a className="link-btn" href="#/phone/complete">
          Finish
        </a>
      </div>
      <ProgressSegments
        total={exercises.length}
        done={idx}
        current={idx}
        label={`Exercise ${idx + 1} of ${exercises.length}`}
      />
      {
        /* Keyed by exercise id: each exercise gets its own fresh weight/reps/RPE
       * state instead of carrying the previous exercise's numbers over. */
      }
      <WorkoutBody
        key={ex.id}
        ex={ex}
        idx={idx}
        total={exercises.length}
        nextName={exercises[idx + 1]?.name}
      />
      <p>
        <a className="link-btn" href="#/phone/allex">
          <LayoutGrid size={16} /> All exercises · tap a card to jump
        </a>
      </p>
      <div className="row-btns">
        <button
          type="button"
          className="icon-btn"
          disabled={idx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
        >
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

function WorkoutBody({
  ex,
  idx,
  total,
  nextName,
}: {
  ex: WorkoutExercise;
  idx: number;
  total: number;
  nextName?: string;
}) {
  const { logSet, queueOp, envelopes, decideEnvelope, settings } = useQala();
  const doneSets = ex.sets.filter((s) => s.done).length;
  const setNo = Math.min(doneSets + 1, ex.sets.length);
  const currentSet = ex.sets[setNo - 1];
  const [weight, setWeight] = useState(currentSet?.w ?? 245);
  const [reps, setReps] = useState(currentSet?.r ?? 4);
  const [rpe, setRpe] = useState<number | null>(null);
  const [jointPain, setJointPain] = useState(false);
  const [noteGone, setNoteGone] = useState(false);
  const plan = planPlates(
    weight,
    settings.defaultBar,
    settings.plates,
    settings.collarWeight,
  );
  const perSide = nearestLoadable(plan)?.perSide ?? [];

  const envelope = envelopes.find((e) => e.exerciseId === ex.id);
  const showBanner = envelope && envelope.accepted !== false;

  return (
    <>
      <p className="kbd-hint">
        Exercise {idx + 1} of {total} · Set {setNo} of {ex.sets.length}
      </p>
      {ex.note && !noteGone
        ? (
          <NoteCard
            date={ex.note.date}
            text={ex.note.text}
            pinned={ex.note.pinned}
            onGotIt={() => setNoteGone(true)}
            onPin={() => queueOp("note-pin", { id: ex.note?.id })}
            onResolve={() => setNoteGone(true)}
          />
        )
        : null}
      {showBanner
        ? (
          <EngineBanner
            text={`Coach suggests ${envelope.coach} (${envelope.reason}). Engine says ${envelope.engine}.`}
            engine={envelope.engine}
            coach={envelope.coach}
            onRevert={() => decideEnvelope(envelope.id, false)}
          />
        )
        : null}
      <Card hero>
        <h1 className="title" style={{ fontSize: 24, margin: "0 0 4px" }}>
          {ex.name}
        </h1>
        <p className="kbd-hint">Last time: {ex.lastTime}</p>
        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "center",
            margin: "12px 0",
          }}
        >
          <div>
            <div className="group-label">Weight</div>
            <div className="figure" style={{ fontSize: 56 }}>
              {weight}
            </div>
            <div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Less weight"
                onClick={() => setWeight((w) => w - 5)}
              >
                <Minus size={18} />
              </button>{" "}
              <button
                type="button"
                className="icon-btn"
                aria-label="More weight"
                onClick={() => setWeight((w) => w + 5)}
              >
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
              <button
                type="button"
                className="icon-btn"
                aria-label="Fewer reps"
                onClick={() => setReps((r) => Math.max(1, r - 1))}
              >
                <Minus size={18} />
              </button>{" "}
              <button
                type="button"
                className="icon-btn"
                aria-label="More reps"
                onClick={() => setReps((r) => r + 1)}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>
        <p>
          <PlateChips plates={perSide} />{" "}
          <a
            className="link-btn"
            href="#/phone/plates"
            aria-label="Open plate calculator"
          >
            <Calculator size={16} /> {platesShorthand(perSide)}
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
              style={rpe === v
                ? {
                  background: "var(--bg-active)",
                  outline: "2px solid var(--accent)",
                }
                : undefined}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="row-btns" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Exercise info"
            style={{ flex: 1 }}
          >
            <Info size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Swap exercise"
            style={{ flex: 1 }}
          >
            <ArrowLeftRight size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Add note"
            style={{ flex: 1 }}
          >
            <StickyNote size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Joint pain"
            aria-pressed={jointPain}
            style={jointPain
              ? { outline: "2px solid var(--danger)", flex: 1 }
              : { flex: 1 }}
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
              logSet(ex.id, setNo - 1, {
                w: weight,
                r: reps,
                rpe: rpe ?? undefined,
              });
              window.location.hash = "#/phone/rest";
            }}
          >
            <Check size={20} /> Log set
          </PrimaryButton>
        </div>
        <p className="kbd-hint">
          Rest preview 3:45 · Next: {nextName ?? "done"}
        </p>
      </Card>
    </>
  );
}
