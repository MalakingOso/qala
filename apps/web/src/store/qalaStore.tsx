/* Local-first store for the desktop shell. React context over useState for the
 * document. Every mutation lands in the offline outbox so airplane-mode
 * sessions replay on reconnect, but nothing yet drains that outbox against
 * the server's real automerge-repo protocol (PLAN 7); that client-side
 * document layer isn't built. */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { MemoryProposal, SessionSummary, SettingsModel } from "./types.ts";
import { defaultSettings, sampleMemory, sampleSessions } from "./sample.ts";
import {
  loadOutbox,
  type QueuedOp,
  saveOutbox,
} from "../logic/offlineQueue.ts";

interface QalaStore {
  settings: SettingsModel;
  updateSettings: (fn: (s: SettingsModel) => SettingsModel) => void;
  memory: MemoryProposal[];
  decideMemory: (id: string, accept: boolean) => void;
  sessions: SessionSummary[];
  setSessionNotes: (id: string, notes: string) => void;
  dismissSessionFlag: (id: string) => void;
  outbox: QueuedOp[];
  online: boolean;
}

const Ctx = createContext<QalaStore | null>(null);

let opCounter = 0;

export function QalaProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsModel>(defaultSettings);
  const [memory, setMemory] = useState<MemoryProposal[]>(sampleMemory);
  const [sessions, setSessions] = useState<SessionSummary[]>(sampleSessions);
  const [outbox, setOutbox] = useState<QueuedOp[]>(() => loadOutbox());
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
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
  const decideMemory = useCallback((id: string, accept: boolean) => {
    setMemory((ms) =>
      ms.map((m) => (m.id === id ? { ...m, accepted: accept } : m))
    );
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
  const setSessionNotes = useCallback((id: string, notes: string) => {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, notes } : s)));
    queueOp("session-notes", { id, notes });
  }, [queueOp]);
  const dismissSessionFlag = useCallback((id: string) => {
    setSessions((ss) =>
      ss.map((s) => (s.id === id ? { ...s, flagged: undefined } : s))
    );
    queueOp("session-flag-dismiss", { id });
  }, [queueOp]);

  const value = useMemo<QalaStore>(
    () => ({
      settings,
      updateSettings,
      memory,
      decideMemory,
      sessions,
      setSessionNotes,
      dismissSessionFlag,
      outbox,
      online,
    }),
    [
      settings,
      updateSettings,
      memory,
      decideMemory,
      sessions,
      setSessionNotes,
      dismissSessionFlag,
      outbox,
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
