/* The custom exercises added on the Exercises page this session. They live
 * above the pages so the program editor's dry run can resolve them; nothing
 * stores them, so a reload starts empty (logic/customExercises.ts). */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { CustomExercise } from "../logic/customExercises.ts";

interface CustomExercises {
  custom: CustomExercise[];
  add: (c: CustomExercise) => void;
  remove: (id: string) => void;
}

const Ctx = createContext<CustomExercises | null>(null);

export function CustomExercisesProvider({ children }: { children: ReactNode }) {
  const [custom, setCustom] = useState<CustomExercise[]>([]);
  const add = useCallback(
    (c: CustomExercise) =>
      setCustom((
        list,
      ) => [...list.filter((x) => x.exercise.id !== c.exercise.id), c]),
    [],
  );
  const remove = useCallback(
    (id: string) =>
      setCustom((list) => list.filter((x) => x.exercise.id !== id)),
    [],
  );
  const value = useMemo(() => ({ custom, add, remove }), [custom, add, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomExercises(): CustomExercises {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useCustomExercises needs a CustomExercisesProvider");
  }
  return v;
}
