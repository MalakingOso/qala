/* Which of the three loaded weeks is in focus (DECISIONS U20). The toolbar's
 * week switcher moves it and the Overview ribbon follows it. */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { defaultFocusId, stepFocus } from "../logic/weekRibbon.ts";
import { sampleWeeks } from "../store/sample.ts";
import type { WeekLoad } from "../store/types.ts";

interface WeekFocus {
  weeks: WeekLoad[];
  focus: WeekLoad;
  focusId: string;
  setFocusId: (id: string) => void;
  step: (by: number) => void;
  canStep: (by: number) => boolean;
}

const Ctx = createContext<WeekFocus | null>(null);

export function WeekFocusProvider({ children }: { children: ReactNode }) {
  const weeks = sampleWeeks;
  const [focusId, setFocusId] = useState(() => defaultFocusId(weeks));
  const step = useCallback(
    (by: number) => setFocusId((id) => stepFocus(weeks, id, by)),
    [weeks],
  );
  const value = useMemo<WeekFocus>(() => ({
    weeks,
    focus: weeks.find((w) => w.id === focusId) ?? weeks[0],
    focusId,
    setFocusId,
    step,
    canStep: (by) => stepFocus(weeks, focusId, by) !== focusId,
  }), [weeks, focusId, step]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWeekFocus(): WeekFocus {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWeekFocus needs a WeekFocusProvider");
  return v;
}
