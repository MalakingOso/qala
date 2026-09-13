/* Local-first store for the web shells. React context over useState for the
 * document, plus a useSyncExternalStore live-run ticker (PLAN 3: the live
 * run store goes through useSyncExternalStore). Sync against the automerge
 * server document happens in syncClient.ts; every mutation also lands in the
 * offline outbox so airplane-mode sessions replay on reconnect. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SettingsModel, StageState, WorkoutExercise } from "./types.ts";
import {
  defaultSettings,
  sampleEnvelopes,
  sampleExercises,
  sampleMemory,
  sampleStages,
} from "./sample.ts";
import { loadOutbox, saveOutbox, type QueuedOp } from "../logic/offlineQueue.ts";
import type { EnvelopeCardModel, MemoryProposal } from "./types.ts";

export interface LiveRunSnapshot {
  running: boolean;
  paused: boolean;
  elapsedSec: number;
  miles: number;
  paceSecPerMi: number;
  avgSecPerMi: number;
}

function makeLiveRunStore() {
  let snap: LiveRunSnapshot = {
    running: false,
    paused: false,
    elapsedSec: 0,
    miles: 0,
    paceSecPerMi: 0,
    avgSecPerMi: 0,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const emit = () => {
    for (const l of listeners) l();
  };
  const tick = () => {
    if (!snap.running || snap.paused) return;
    const elapsedSec = snap.elapsedSec + 1;
    // Sample guided pace ~9:00/mi with small drift; recomputable demo feed.
    const paceSecPerMi = 540 + Math.round(8 * Math.sin(elapsedSec / 47));
    const miles = snap.miles + 1 / Math.max(paceSecPerMi, 1);
    snap = {
      ...snap,
      elapsedSec,
      miles,
      paceSecPerMi,
      avgSecPerMi: elapsedSec / Math.max(miles, 1e-6),
    };
    emit();
  };
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot: () => snap,
    start: () => {
      snap = { running: true, paused: false, elapsedSec: 0, miles: 0, paceSecPerMi: 540, avgSecPerMi: 540 };
      if (!timer) timer = setInterval(tick, 1000);
      emit();
    },
    pause: () => {
      snap = { ...snap, paused: true };
      emit();
    },
    resume: () => {
      snap = { ...snap, paused: false };
      emit();
    },
    stop: () => {
      snap = { ...snap, running: false };
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      emit();
    },
  };
}

export const liveRunStore = makeLiveRunStore();

interface QalaStore {
  settings: SettingsModel;
  updateSettings: (fn: (s: SettingsModel) => SettingsModel) => void;
  stages: StageState[];
  setStageStatus: (id: StageState["id"], status: StageState["status"]) => void;
  exercises: WorkoutExercise[];
  logSet: (exerciseId: string, setIndex: number) => void;
  envelopes: EnvelopeCardModel[];
  decideEnvelope: (id: string, accept: boolean) => void;
  memory: MemoryProposal[];
  decideMemory: (id: string, accept: boolean) => void;
  outbox: QueuedOp[];
  queueOp: (kind: string, payload: unknown) => void;
  online: boolean;
  setOnline: (v: boolean) => void;
}

const Ctx = createContext<QalaStore | null>(null);

let opCounter = 0;

export function QalaProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsModel>(defaultSettings);
  const [stages, setStages] = useState<StageState[]>(sampleStages);
  const [exercises, setExercises] = useState<WorkoutExercise[]>(sampleExercises);
  const [envelopes, setEnvelopes] = useState<EnvelopeCardModel[]>(sampleEnvelopes);
  const [memory, setMemory] = useState<MemoryProposal[]>(sampleMemory);
  const [outbox, setOutbox] = useState<QueuedOp[]>(() => loadOutbox());
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => saveOutbox(outbox), [outbox]);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  const updateSettings = useCallback(
    (fn: (s: SettingsModel) => SettingsModel) => setSettings((s) => fn(s)),
    [],
  );
  const setStageStatus = useCallback(
    (id: StageState["id"], status: StageState["status"]) =>
      setStages((st) => st.map((s) => (s.id === id ? { ...s, status } : s))),
    [],
  );
  const logSet = useCallback((exerciseId: string, setIndex: number) => {
    setExercises((exs) =>
      exs.map((e) =>
        e.id !== exerciseId
          ? e
          : {
              ...e,
              sets: e.sets.map((s, i) => (i === setIndex ? { ...s, done: true } : s)),
            },
      ),
    );
    setOutbox((q) => [
      ...q,
      {
        id: `op-${Date.now()}-${opCounter++}`,
        kind: "log-set",
        at: new Date().toISOString(),
        payload: { exerciseId, setIndex },
        attempts: 0,
      },
    ]);
  }, []);
  const decideEnvelope = useCallback((id: string, accept: boolean) => {
    setEnvelopes((es) => es.map((e) => (e.id === id ? { ...e, accepted: accept } : e)));
  }, []);
  const decideMemory = useCallback((id: string, accept: boolean) => {
    setMemory((ms) => ms.map((m) => (m.id === id ? { ...m, accepted: accept } : m)));
  }, []);
  const queueOp = useCallback((kind: string, payload: unknown) => {
    setOutbox((q) => [
      ...q,
      {
        id: `op-${Date.now()}-${opCounter++}`,
        kind,
        at: new Date().toISOString(),
        payload,
        attempts: 0,
      },
    ]);
  }, []);

  const value = useMemo<QalaStore>(
    () => ({
      settings,
      updateSettings,
      stages,
      setStageStatus,
      exercises,
      logSet,
      envelopes,
      decideEnvelope,
      memory,
      decideMemory,
      outbox,
      queueOp,
      online,
      setOnline,
    }),
    [
      settings,
      updateSettings,
      stages,
      setStageStatus,
      exercises,
      logSet,
      envelopes,
      decideEnvelope,
      memory,
      decideMemory,
      outbox,
      queueOp,
      online,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQala(): QalaStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQala outside QalaProvider");
  return v;
}
