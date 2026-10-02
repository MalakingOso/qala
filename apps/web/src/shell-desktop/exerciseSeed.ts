/* The exercise table's seed rows, shared by the Exercises page and the
 * toolbar search. The full seed is 422 entries; these are the sample. */

export interface ExerciseRow {
  name: string;
  equipment: string;
  target: string;
  bar: string;
  rest: "main" | "secondary" | "isolation";
}

export const EXERCISE_SEED: ExerciseRow[] = [
  {
    name: "Back Squat",
    equipment: "barbell",
    target: "quads",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Bench Press",
    equipment: "barbell",
    target: "chest",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Deadlift",
    equipment: "barbell",
    target: "hamstrings",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Overhead Press",
    equipment: "barbell",
    target: "front delts",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Romanian Deadlift",
    equipment: "barbell",
    target: "hamstrings",
    bar: "45 lb",
    rest: "secondary",
  },
  {
    name: "Walking Lunge",
    equipment: "dumbbell",
    target: "quads",
    bar: "—",
    rest: "secondary",
  },
  {
    name: "Standing Calf Raise",
    equipment: "machine",
    target: "calves",
    bar: "—",
    rest: "isolation",
  },
];

export const SEED_TOTAL = 422;
