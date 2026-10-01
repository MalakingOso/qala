/* Workout, one exercise (DESIGN 7.5): progress segments you can tap to jump,
 * returning note, big weight x reps steppers, plates for the set, one RPE
 * strip, labeled tools, Log set, then the rest preview. Prev / Next name the
 * neighbouring exercise; the grid button zooms out to all exercises. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import { FlowHeader } from "../FlowHeader.tsx";
import type { WorkoutExercise } from "../../store/types.ts";
import {
  Card,
  EngineBanner,
  NoteCard,
  PlateChips,
  PrimaryButton,
  ProgressSegments,
  ScalePicker,
  Stepper,
  ToolBar,
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
  ChevronRight,
  Hourglass,
  Info,
  StickyNote,
  TriangleAlert,
} from "../../shared/icons.ts";

const RPE = [7, 7.5, 8, 8.5, 9, 9.5, 10] as const;

export function WorkoutPage({ initialIdx = 0 }: { initialIdx?: number }) {
  const { exercises } = useQala();
  const [idx, setIdx] = useState(initialIdx);
  const ex = exercises[idx];
  if (!ex) return <p>No exercises today.</p>;
  const prev = exercises[idx - 1];
  const next = exercises[idx + 1];

  return (
    <div>
      <FlowHeader session="Lower A" clock="24:10" />
      <ProgressSegments
        items={exercises.map((e) => ({
          name: e.name,
          done: e.sets.filter((s) => s.done).length,
          total: e.sets.length,
        }))}
        current={idx}
        onPick={setIdx}
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
        nextName={next?.name}
      />
      <div className="ex-nav">
        <button
          type="button"
          className="btn-secondary"
          disabled={!prev}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft size={18} />
          <span>{prev ? prev.name : "Start"}</span>
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!next}
          onClick={() => setIdx((i) => Math.min(exercises.length - 1, i + 1))}
        >
          <span>{next ? next.name : "End"}</span>
          <ChevronRight size={18} />
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
  const envelope = envelopes.find((e) => e.exerciseId === ex.id);
  const showBanner = envelope && envelope.accepted !== false;
  const coachWeight = envelope ? parseFloat(envelope.coach) : NaN;
  const [weight, setWeight] = useState(
    envelope?.accepted === true && Number.isFinite(coachWeight)
      ? coachWeight
      : currentSet?.w ?? 245,
  );
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

  return (
    <>
      <p className="flow-step">
        Exercise {idx + 1} of {total}
        <span aria-hidden="true">·</span>
        <strong>Set {setNo} of {ex.sets.length}</strong>
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
            text={envelope.reason}
            engine={envelope.engine}
            coach={envelope.coach}
            pending={envelope.accepted === null}
            onAccept={() => {
              decideEnvelope(envelope.id, true);
              if (Number.isFinite(coachWeight)) setWeight(coachWeight);
            }}
            onRevert={() => {
              decideEnvelope(envelope.id, false);
              if (currentSet) setWeight(currentSet.w);
            }}
          />
        )
        : null}
      <Card hero>
        <h1 className="title log-title">{ex.name}</h1>
        {ex.lastTime
          ? <p className="kbd-hint log-last">Last time {ex.lastTime}</p>
          : null}
        <div className="log-grid">
          <Stepper
            label="Weight"
            value={weight}
            unit="lb"
            step={5}
            onStep={(d) =>
              setWeight((w) => Math.max(settings.defaultBar, w + d))}
          />
          <span className="log-times figure" aria-hidden="true">×</span>
          <Stepper
            label="Reps"
            value={reps}
            onStep={(d) => setReps((r) => Math.max(1, r + d))}
          />
        </div>
        <a
          className="log-plates"
          href="#/phone/plates"
          aria-label={`Plates: ${
            platesShorthand(perSide)
          }. Open plate calculator`}
        >
          <PlateChips plates={perSide} inventory={settings.plates} />
          <span className="kbd-hint">{platesShorthand(perSide)}</span>
          <Calculator size={18} aria-hidden="true" />
        </a>
        <div className="log-rpe-head">
          <span className="group-label">RPE</span>
          {ex.targetRpe
            ? <span className="kbd-hint">target {ex.targetRpe}</span>
            : null}
        </div>
        <ScalePicker
          label="RPE"
          options={RPE}
          value={rpe}
          onPick={setRpe}
          anchors={["3 in the tank", "max"]}
        />
        <PrimaryButton
          large
          onClick={() => {
            logSet(ex.id, setNo - 1, {
              w: weight,
              r: reps,
              rpe: rpe ?? undefined,
            });
            window.location.hash = "#/phone/rest";
          }}
        >
          <Check size={22} /> Log set
        </PrimaryButton>
        <p className="log-after">
          <Hourglass size={14} aria-hidden="true" />
          <span>
            Rest about 3:45, then {setNo < ex.sets.length
              ? `set ${setNo + 1}`
              : nextName ?? "you're done"}
          </span>
        </p>
      </Card>
      <ToolBar
        tools={[
          { label: "Info", icon: <Info size={18} /> },
          { label: "Swap", icon: <ArrowLeftRight size={18} /> },
          { label: "Note", icon: <StickyNote size={18} /> },
          {
            label: "Joint pain",
            icon: <TriangleAlert size={18} />,
            tone: "danger",
            pressed: jointPain,
            onClick: () => {
              setJointPain((j) => !j);
              queueOp("joint-pain", { exerciseId: ex.id });
            },
          },
        ]}
      />
    </>
  );
}
