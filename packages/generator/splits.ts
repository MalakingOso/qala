// Split choice and main-lift frequency (PLAN.md 12, Evolve split/block practice).
// Rules: 2-3 days full body, 4 upper/lower, 5-6 push/pull/legs. Main-lift
// frequency (lift or close variation, times/week): beginner 2-3x, intermediate
// 2-4x, advanced same as intermediate by default with high (3-5x, lower
// per-session volume) and low (1-2x, higher per-session volume) alternatives.

import type {
  AdvancedFrequency,
  CatalogExercise,
  Experience,
  GoalKind,
  SlotKind,
} from "./types.ts";
import { catalogById, EXERCISE_CATALOG } from "./types.ts";

export interface DayTemplate {
  label: string;
  focus: string;
  lowerBody: boolean;
  // movement slots are main lifts, muscle slots are accessory groups (PLAN 12).
  movementSlots: string[];
  muscleSlots: string[];
}

export interface SplitDef {
  name: "fullBody" | "upperLower" | "ppl";
  label: string;
  days: DayTemplate[];
}

const MAIN_LIFTS = ["squat", "bench", "deadlift", "ohp"];

// Close variations count toward a lift's weekly frequency (PLAN.md 12: times
// per week a lift or close variation is trained). Keyed by accessory id.
const FAMILY_CREDIT: Record<string, string> = {
  pauseSquat: "squat",
  legPress: "squat",
  lunge: "squat",
  closeGripBench: "bench",
  inclineDb: "bench",
  rdl: "deadlift",
};

function variationFamily(liftId: string): string[] {
  return [
    liftId,
    ...EXERCISE_CATALOG.filter((e) => e.variationsOf === liftId).map((e) =>
      e.id
    ),
  ];
}

// Full-body days are spelled out (not cycled) so hinge/push credits land on
// the right days: every main lift or a close variation trains 2x even on 2
// days, when accessories are counted.
const FULL_BODY_2: DayTemplate[] = [
  {
    label: "Full A",
    focus: "full body",
    lowerBody: true,
    movementSlots: ["squat", "bench", "ohp"],
    muscleSlots: ["upper back", "hamstrings"],
  },
  {
    label: "Full B",
    focus: "full body",
    lowerBody: true,
    movementSlots: ["deadlift", "ohp"],
    muscleSlots: ["upper back", "quads", "triceps"],
  },
];

const FULL_BODY_3: DayTemplate[] = [
  {
    label: "Full A",
    focus: "full body",
    lowerBody: true,
    movementSlots: ["squat", "bench", "ohp"],
    muscleSlots: ["upper back", "biceps"],
  },
  {
    label: "Full B",
    focus: "full body, hinge",
    lowerBody: true,
    movementSlots: ["deadlift", "ohp"],
    muscleSlots: ["upper back", "hamstrings", "triceps"],
  },
  {
    label: "Full C",
    focus: "full body",
    lowerBody: true,
    movementSlots: ["squat", "bench"],
    muscleSlots: ["upper back", "hamstrings", "biceps"],
  },
];

export function chooseSplit(
  daysPerWeek: number,
  _experience: Experience = "intermediate",
): SplitDef {
  if (daysPerWeek <= 3) {
    const days = (daysPerWeek === 2 ? FULL_BODY_2 : FULL_BODY_3).slice(
      0,
      daysPerWeek,
    );
    return { name: "fullBody", label: "Full body", days };
  }
  if (daysPerWeek === 4) {
    return {
      name: "upperLower",
      label: "Upper / lower",
      days: [
        {
          label: "Upper A",
          focus: "upper",
          lowerBody: false,
          movementSlots: ["bench", "ohp"],
          muscleSlots: ["upper back", "biceps", "side delts"],
        },
        {
          label: "Lower A",
          focus: "lower, squat",
          lowerBody: true,
          movementSlots: ["squat"],
          muscleSlots: ["hamstrings", "calves"],
        },
        {
          label: "Upper B",
          focus: "upper",
          lowerBody: false,
          movementSlots: ["bench", "ohp"],
          muscleSlots: ["upper back", "triceps", "biceps", "side delts"],
        },
        {
          label: "Lower B",
          focus: "lower, hinge",
          lowerBody: true,
          movementSlots: ["deadlift", "squat"],
          muscleSlots: ["quads", "calves"],
        },
      ],
    };
  }
  // 5-6: push/pull/legs. 6 days runs PPL twice; 5 days runs PPL plus an
  // upper and a lower day to keep main-lift frequency up.
  const ppl: DayTemplate[] = [
    {
      label: "Push A",
      focus: "push",
      lowerBody: false,
      movementSlots: ["bench", "ohp"],
      muscleSlots: ["triceps", "side delts"],
    },
    {
      label: "Pull A",
      focus: "pull",
      lowerBody: false,
      movementSlots: [],
      muscleSlots: ["upper back", "biceps", "rear delts"],
    },
    {
      label: "Legs A",
      focus: "legs, squat",
      lowerBody: true,
      movementSlots: ["squat"],
      muscleSlots: ["hamstrings", "calves"],
    },
    {
      label: "Push B",
      focus: "push",
      lowerBody: false,
      movementSlots: ["bench", "ohp"],
      muscleSlots: ["triceps", "chest"],
    },
    {
      label: "Pull B",
      focus: "pull, hinge",
      lowerBody: true,
      movementSlots: ["deadlift"],
      muscleSlots: ["upper back", "biceps"],
    },
    {
      label: "Legs B",
      focus: "legs",
      lowerBody: true,
      movementSlots: ["squat"],
      muscleSlots: ["glutes", "calves"],
    },
  ];
  if (daysPerWeek >= 6) {
    return { name: "ppl", label: "Push / pull / legs", days: ppl };
  }
  return {
    name: "ppl",
    label: "Push / pull / legs plus upper / lower",
    days: [
      ppl[0],
      ppl[1],
      ppl[2],
      {
        label: "Upper",
        focus: "upper",
        lowerBody: false,
        movementSlots: ["bench", "ohp"],
        muscleSlots: ["upper back", "biceps"],
      },
      {
        label: "Lower",
        focus: "lower, hinge",
        lowerBody: true,
        movementSlots: ["deadlift", "squat"],
        muscleSlots: ["hamstrings", "calves"],
      },
    ],
  };
}

// Times per week each main lift (or a close variation) is trained on the
// split. A day counts when the lift is a movement slot or when a credited
// close variation is slotted as an accessory (RDL for the deadlift, leg
// press or lunge for the squat, close-grip or incline for the bench).
export function mainLiftFrequency(
  split: SplitDef,
  available: CatalogExercise[] = EXERCISE_CATALOG,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const lift of MAIN_LIFTS) {
    const family = new Set(variationFamily(lift));
    let n = 0;
    for (const day of split.days) {
      if (day.movementSlots.some((s) => family.has(s))) {
        n++;
        continue;
      }
      const slots = slotsForDay(day, "strength", available);
      if (
        slots.some((s) =>
          !day.movementSlots.includes(s.exerciseId) &&
          (family.has(s.exerciseId) || FAMILY_CREDIT[s.exerciseId] === lift)
        )
      ) {
        n++;
      }
    }
    out[lift] = n;
  }
  return out;
}

export interface FrequencyBand {
  lo: number;
  hi: number;
}

export function frequencyBand(
  experience: Experience,
  advanced: AdvancedFrequency = "default",
): FrequencyBand {
  if (experience === "beginner") return { lo: 2, hi: 3 };
  if (experience === "intermediate") return { lo: 2, hi: 4 };
  if (advanced === "high") return { lo: 3, hi: 5 };
  if (advanced === "low") return { lo: 1, hi: 2 };
  return { lo: 2, hi: 4 };
}

export function advancedFrequencyAlternatives(): Array<{
  scheme: AdvancedFrequency;
  frequency: string;
  perSessionVolume: string;
}> {
  return [
    {
      scheme: "high",
      frequency: "3-5x per lift per week",
      perSessionVolume: "lower per-session volume",
    },
    {
      scheme: "low",
      frequency: "1-2x per lift per week",
      perSessionVolume: "higher per-session volume",
    },
  ];
}

// Lifts (deadlift family excluded from strict checking when trained 1x as a
// heavy pull plus an RDL variation day still count as 2 exposures).
export function checkFrequency(
  split: SplitDef,
  experience: Experience,
  advanced: AdvancedFrequency = "default",
): string[] {
  const band = frequencyBand(experience, advanced);
  const freq = mainLiftFrequency(split);
  const problems: string[] = [];
  for (const lift of MAIN_LIFTS) {
    const n = freq[lift];
    if (n < band.lo || n > band.hi) {
      problems.push(
        `${lift} trained ${n}x/week, band is ${band.lo}-${band.hi}x`,
      );
    }
  }
  return problems;
}

// Evolve slot rule: when the goal is served by a main lift, accessory work is
// added as extra main-lift slots (variations) before muscle slots; muscle
// slots are added only when the goal is not served by the main lift.
export function slotsForDay(
  day: DayTemplate,
  goal: GoalKind,
  available: CatalogExercise[],
  avoid: Set<string> = new Set(),
): Array<{ exerciseId: string; slot: SlotKind }> {
  void goal;
  const have = new Set(available.map((e) => e.id));
  const out: Array<{ exerciseId: string; slot: SlotKind }> = [];
  for (const lift of day.movementSlots) {
    if (have.has(lift)) out.push({ exerciseId: lift, slot: "strength" });
  }
  // Main-lift variations come before muscle slots. A variation already used
  // on an earlier day this week is skipped, so the third exposure stays
  // lighter instead of repeating the same accessory lift.
  for (const lift of day.movementSlots) {
    for (const e of EXERCISE_CATALOG) {
      if (
        e.variationsOf === lift && have.has(e.id) && out.length < 4 &&
        !avoid.has(e.id)
      ) {
        if (!out.some((o) => o.exerciseId === e.id)) {
          out.push({ exerciseId: e.id, slot: "accessoryLow" });
        }
      }
    }
  }
  const accessoryByMuscle: Record<string, string[]> = {
    "upper back": ["row", "pullup"],
    biceps: ["curl"],
    triceps: ["closeGripBench", "pushdown"],
    hamstrings: ["rdl", "legCurl"],
    quads: ["legPress", "lunge"],
    calves: ["calfRaise"],
    glutes: ["hipThrust"],
    chest: ["inclineDb"],
    "side delts": ["lateralRaise"],
    "rear delts": ["facePull"],
  };
  for (const group of day.muscleSlots) {
    const ids = accessoryByMuscle[group] ?? [];
    // Prefer an exercise not already used this week so back gets row and
    // pull-up across the two upper days instead of the same lift twice.
    const pick = ids.find((id) =>
      have.has(id) && !out.some((o) =>
        o.exerciseId === id
      ) && !avoid.has(id)
    ) ?? ids.find((id) =>
      have.has(id) && !out.some((o) => o.exerciseId === id)
    );
    if (pick) {
      const e = catalogById(pick);
      out.push({
        exerciseId: pick,
        slot: e.compound ? "accessoryLow" : "accessoryHigh",
      });
    }
  }
  return out;
}

// Keep equipment matching in one place: an exercise is available when every
// required item is owned (bodyweight items list their own tag) or when the
// user gave no equipment list (assume a full gym). Exclusions drop ids.
export function availableExercises(
  equipment: string[],
  exclusions: string[],
): CatalogExercise[] {
  const excluded = new Set(exclusions);
  return EXERCISE_CATALOG.filter((e) => {
    if (excluded.has(e.id)) return false;
    if (equipment.length === 0) return true;
    return e.equipment.every((item) => equipment.includes(item));
  });
}

export { MAIN_LIFTS };
