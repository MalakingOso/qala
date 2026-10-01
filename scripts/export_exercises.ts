// Export the liftoscript exercise seed DB and muscle tables to JSON for the Rust port
// (crates/qala-lspp/data/). Deterministic: DB order is the TS source order.
//
//   deno run --allow-all --config packages/liftoscript/deno.json scripts/export_exercises.ts

import {
  allExercisesList,
  equipmentName,
  metadata,
} from "../packages/liftoscript/src/models/exercise.ts";
import {
  Muscle_getMusclesFromScreenMuscle,
  Muscle_getScreenMusclesFromMuscle,
} from "../packages/liftoscript/src/models/muscle.ts";
import {
  availableMuscles,
  equipments,
  exerciseKinds,
  type ISettings,
  screenMuscles,
} from "../packages/liftoscript/src/types.ts";

const outDir = new URL("../crates/qala-lspp/data/", import.meta.url);

function must<T>(v: T | undefined | null, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

const exercises = Object.keys(allExercisesList).map((key) => {
  const e = allExercisesList[key as keyof typeof allExercisesList];
  const m = must(metadata[key as keyof typeof metadata], `metadata for ${key}`);
  if (e.id !== key) throw new Error(`id mismatch ${key}`);
  if (e.startingWeightKg.unit !== "kg" || e.startingWeightLb.unit !== "lb") {
    throw new Error(`unexpected starting weight unit for ${key}`);
  }
  if (e.equipment != null || e.onerm != null) {
    throw new Error(`unexpected equipment/onerm on built-in ${key}`);
  }
  const out: Record<string, unknown> = { id: e.id, name: e.name };
  if (e.defaultWarmup != null) out.defaultWarmup = e.defaultWarmup;
  if (e.defaultEquipment != null) out.defaultEquipment = e.defaultEquipment;
  out.types = e.types ?? [];
  out.startingWeightKg = e.startingWeightKg.value;
  out.startingWeightLb = e.startingWeightLb.value;
  out.targetMuscles = m.targetMuscles;
  out.synergistMuscles = m.synergistMuscles;
  out.bodyParts = m.bodyParts;
  if (m.sortedEquipment != null) out.sortedEquipment = m.sortedEquipment;
  return out;
});

const exercisesJson = {
  equipments: [...equipments],
  equipmentNames: Object.fromEntries(equipments.map((e) => [e, equipmentName(e)])),
  exerciseKinds: [...exerciseKinds],
  exercises,
};

// The default screen-muscle table is not exported by muscle.ts, so read it back through
// the public functions with an empty muscle-groups setting.
const emptySettings = { muscleGroups: { vtype: "muscle_groups_settings", data: {} } } as unknown as ISettings;
const screenMuscleToMuscles: Record<string, string[]> = {};
for (const sm of screenMuscles) {
  screenMuscleToMuscles[sm] = [...Muscle_getMusclesFromScreenMuscle(sm, emptySettings)];
}
const muscleToScreenMuscles: Record<string, string[]> = {};
for (const m of availableMuscles) {
  muscleToScreenMuscles[m] = Muscle_getScreenMusclesFromMuscle(m, emptySettings).map(String);
}
const musclesJson = {
  screenMuscles: [...screenMuscles],
  availableMuscles: [...availableMuscles],
  screenMuscleToMuscles,
  muscleToScreenMuscles,
};

await Deno.mkdir(outDir, { recursive: true });
await Deno.writeTextFile(new URL("exercises.json", outDir), JSON.stringify(exercisesJson, null, 1) + "\n");
await Deno.writeTextFile(new URL("muscles.json", outDir), JSON.stringify(musclesJson, null, 1) + "\n");
console.log(`exported ${exercises.length} exercises, ${availableMuscles.length} muscles`);
