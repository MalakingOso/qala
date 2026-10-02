/* Which day of the block the Overview load zoom is centred on, and so which
 * week is in focus (DECISIONS U20, U27). The toolbar's week switcher moves it
 * and the chart follows; the chart reports its own pans, taps on a week's
 * name and keyboard steps back, so the toolbar follows too. */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  blockModel,
  clamp,
  defaultAnchor,
  inspectDay,
  weekOf,
} from "../logic/loadZoom.ts";
import { sampleBlockWeeks } from "../store/sample.ts";
import type { WeekLoad } from "../store/types.ts";

interface WeekFocus {
  weeks: WeekLoad[];
  focus: WeekLoad;
  focusId: string;
  setFocusId: (id: string) => void;
  /** The day the chart is centred on, a day index into the block. */
  anchor: number;
  setAnchor: (day: number) => void;
  step: (by: number) => void;
  canStep: (by: number) => boolean;
}

const Ctx = createContext<WeekFocus | null>(null);

export function WeekFocusProvider({ children }: { children: ReactNode }) {
  const weeks = sampleBlockWeeks;
  const model = useMemo(() => blockModel(weeks), [weeks]);
  const [anchor, setAnchor] = useState(() => defaultAnchor(model));
  const last = weeks.length - 1;
  const stepTo = useCallback(
    (week: number) => inspectDay(model, clamp(week, 0, last)),
    [model, last],
  );
  const step = useCallback(
    (by: number) => setAnchor((a) => stepTo(weekOf(a) + by)),
    [stepTo],
  );
  const value = useMemo<WeekFocus>(() => {
    const index = clamp(weekOf(anchor), 0, last);
    return {
      weeks,
      focus: weeks[index],
      focusId: weeks[index].id,
      setFocusId: (id) => {
        const to = weeks.findIndex((w) => w.id === id);
        if (to >= 0) setAnchor(stepTo(to));
      },
      anchor,
      setAnchor,
      step,
      canStep: (by) => index + by >= 0 && index + by <= last,
    };
  }, [weeks, anchor, last, stepTo, step]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWeekFocus(): WeekFocus {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWeekFocus needs a WeekFocusProvider");
  return v;
}
