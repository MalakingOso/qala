// Golden vectors for crates/qala-liftoscript/src/exercise.rs and muscle.rs, computed by the TS
// oracle. Writes testdata/golden/liftoscript/exercise_lookup.json and exercise_functions.json.
//
//   deno run --allow-all --config packages/liftoscript/deno.json scripts/export_exercise_golden.ts

import {
  allExercisesList,
  Exercise_buildName,
  Exercise_defaultEquipment,
  Exercise_defaultRounding,
  Exercise_defaultSynergistMuscles,
  Exercise_defaultTargetMuscles,
  Exercise_defaultTargetMusclesGroups,
  Exercise_eq,
  Exercise_exists,
  Exercise_find,
  Exercise_findById,
  Exercise_findByName,
  Exercise_findByNameAndEquipment,
  Exercise_findByNameEquipment,
  Exercise_findIdByName,
  Exercise_fromKey,
  Exercise_fromUrlSlug,
  Exercise_fullName,
  Exercise_get,
  Exercise_getById,
  Exercise_getIsUnilateral,
  Exercise_getMetadata,
  Exercise_getNotes,
  Exercise_getVolumeMultiplier,
  Exercise_nameError,
  Exercise_nameWithEquipment,
  Exercise_onerm,
  Exercise_reverseName,
  Exercise_sanitizeName,
  Exercise_synergistMuscleMultipliers,
  Exercise_synergistMuscles,
  Exercise_synergistMusclesGroupMultipliers,
  Exercise_synergistMusclesGroups,
  Exercise_targetMuscles,
  Exercise_targetMusclesGroups,
  Exercise_toExternalUrl,
  Exercise_toKey,
  Exercise_toUrlSlug,
  Exercise_all,
  Exercise_getByIds,
  Exercise_isCustom,
  equipmentName,
  equipmentToBarKey,
  warmupValues,
} from "../packages/liftoscript/src/models/exercise.ts";
import {
  Muscle_getAvailableMuscleGroups,
  Muscle_getHiddenMuscleGroups,
  Muscle_getMuscleGroupName,
  Muscle_getMusclesFromScreenMuscle,
  Muscle_getScreenMusclesFromMuscle,
  Muscle_imageUrl,
  Muscle_isDefaultMuscles,
} from "../packages/liftoscript/src/models/muscle.ts";
import { availableMuscles, equipments, type IExercise, type ISettings } from "../packages/liftoscript/src/types.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const outDir = new URL("../testdata/golden/liftoscript/", import.meta.url);
const builtinDir = new URL("../packages/liftoscript/programs/builtin/", import.meta.url);

// ---- shared custom exercises and settings ----------------------------------------------------

function custom(id: string, name: string, isDeleted: boolean, extra: Any = {}) {
  return {
    vtype: "custom_exercise",
    id,
    name,
    isDeleted,
    meta: { bodyParts: ["Arms"], targetMuscles: ["Biceps Brachii"], synergistMuscles: ["Brachialis", "Triceps Brachii"] },
    ...extra,
  };
}
const customExercises: Record<string, Any> = {
  cBench: custom("cBench", "Bench Press", false),
  cSquatDel: custom("cSquatDel", "Squat", true),
  cCurl: custom("cCurl", "My Curl", false, { defaultEquipment: "dumbbell", types: ["pull"] }),
  cRow: custom("cRow", "Row", false),
  cRowDb: custom("cRowDb", "Row, Dumbbell", false, { defaultEquipment: "barbell" }),
  cFlyDel: custom("cFlyDel", "Fly", true),
  cFlyCableDel: custom("cFlyCableDel", "Fly, Cable", true),
  cGhost: custom("cGhost", "Ghost Lift", true),
  cSpaced: custom("cSpaced", "Spaced  ,  Name", false),
  cPlain: custom("cPlain", "Plain", false, { types: undefined }),
  squat: custom("squat", "Shadowed Squat", false),
};
const settings = {
  units: "lb",
  exercises: customExercises,
  exerciseData: {
    squat: { rm1: { value: 100, unit: "kg" }, notes: "note" },
    squat_barbell: { rm1: { value: 300, unit: "lb" } },
    deadlift: { rounding: 0.05 },
    deadlift_barbell: { rounding: 1.25 },
    benchPress_dumbbell: {
      isUnilateral: false,
      volumeMultiplier: 3,
      muscleMultipliers: { "Pectoralis Major Sternal Head": 1, "Deltoid Anterior": 0.5, "Triceps Brachii": 0.25, "Serratus Anterior": 1 },
    },
    lunge_dumbbell: { isUnilateral: false, volumeMultiplier: 0 },
    bicepCurl: { isUnilateral: true },
    abWheel: { muscleMultipliers: { Iliopsoas: 0, "Latissimus Dorsi": 0.9 } },
    cCurl: { rm1: { value: 50, unit: "kg" }, notes: "custom note" },
  },
  planner: { synergistMultiplier: 0.5 },
  muscleGroups: {
    vtype: "muscle_groups_settings",
    data: {
      shoulders: { isHidden: true },
      chest: { name: "Pecs" },
      neck: { name: "Neck", muscles: ["Splenius", "Sternocleidomastoid"] },
      triceps: { muscles: ["Triceps Brachii", "Deltoid Posterior"] },
    },
  },
  gyms: [
    {
      id: "g1",
      name: "Home",
      equipment: {
        barbell: { name: "Olympic Bar", unit: "kg" },
        dumbbell: { unit: "kg" },
        cable: { name: "  Cable Stack  " },
        kettlebell: { name: "" },
      },
    },
  ],
  currentGymId: "g1",
} as unknown as ISettings;
const noCustom = {};

// ---- projections ----------------------------------------------------------------------------

function ex(e: IExercise | undefined): Any {
  if (e == null) return null;
  return {
    id: e.id,
    name: e.name,
    equipment: e.equipment ?? null,
    defaultEquipment: e.defaultEquipment ?? null,
    defaultWarmup: e.defaultWarmup ?? null,
    types: e.types ?? [],
    startingWeightKg: e.startingWeightKg.value,
    startingWeightLb: e.startingWeightLb.value,
  };
}

// ---- lookup golden --------------------------------------------------------------------------

const candidates = new Set<string>();
for (const f of Deno.readDirSync(builtinDir)) {
  if (!f.name.endsWith(".md")) continue;
  const text = Deno.readTextFileSync(new URL(f.name, builtinDir));
  for (const line of text.split("\n")) {
    if (!line.includes(" / ")) continue;
    let head = line.split(" / ")[0].trim().replace(/^[-|*]\s*/, "");
    head = head.replace(/^[^:]*:\s*/, "").replace(/\[.*$/, "").trim();
    if (head.length > 0 && head.length < 80) candidates.add(head);
  }
}
for (const e of Object.values(allExercisesList)) {
  candidates.add(e.name);
  candidates.add(e.name.toLowerCase());
  candidates.add(`${e.name}, ${equipmentName(e.defaultEquipment)}`);
  candidates.add(`${e.name} , ${equipmentName("cable")}`);
  candidates.add(`${e.name},${equipmentName("dumbbell").toLowerCase()}`);
  candidates.add(`  ${e.name}  `);
}
for (const c of Object.values(customExercises)) {
  candidates.add(c.name);
  candidates.add(c.name.toUpperCase());
}
for (const extra of [
  "", " ", ",", "Row, Barbell", "Row, Dumbbell", "row,dumbbell", "Row , Dumbbell", "Fly, Cable", "Fly", "Fly, Band",
  "Squat, Nope", "Nope, Barbell", "constructor", "__proto__", "toString", "Squat, Barbell, Barbell",
  "Bench Press, Dumbbell", "Bench Press, Smith Machine", "Bench Press, Leverage Machine", "Spaced, Name", "Spaced,Name",
  "Spaced  ,  Name, Barbell", "Ghost Lift", "Ghost Lift, Cable", "Plain, Cable", "My Curl, Barbell", "My Curl",
]) candidates.add(extra);
const sorted = [...candidates].sort();

function lookups(name: string, customs: Any) {
  return {
    findIdByName: Exercise_findIdByName(name, customs) ?? null,
    findByName: ex(Exercise_findByName(name, customs)),
    findByNameAndEquipment: ex(Exercise_findByNameAndEquipment(name, customs)),
    findByNameEquipment: ex(Exercise_findByNameEquipment(customs, name, "cable")),
    exists: Exercise_exists(name, customs),
  };
}
const lookupResults = sorted.map((input) => ({ input, builtin: lookups(input, noCustom), custom: lookups(input, customExercises) }));
await Deno.mkdir(outDir, { recursive: true });
await Deno.writeTextFile(
  new URL("exercise_lookup.json", outDir),
  JSON.stringify({ customExercises, results: lookupResults }).replaceAll('},{"input"', '},\n{"input"') + "\n",
);

// ---- function golden ------------------------------------------------------------------------

const ids = [...Object.keys(allExercisesList), ...Object.keys(customExercises), "nope"];
const eqs: (string | undefined)[] = [undefined, "barbell", "dumbbell", "kettlebell", "leverageMachine", "ezbar"];
function toType(id: string, equipment: string | undefined) {
  return equipment === undefined ? { id } : { id, equipment };
}
const types: Any[] = [];
for (const id of ids) for (const eq of eqs) types.push(toType(id, eq));

const perType = types.map((t) => {
  const e = Exercise_get(t, settings.exercises);
  const slug = Exercise_toUrlSlug(t);
  return {
    type: t,
    key: Exercise_toKey(t),
    slug,
    externalUrl: Exercise_toExternalUrl(t),
    isUnilateral: Exercise_getIsUnilateral(t, settings),
    volumeMultiplier: Exercise_getVolumeMultiplier(t, settings),
    fullName: Exercise_fullName(e, settings),
    fullNameLabel: Exercise_fullName(e, settings, "lbl"),
    reverseName: Exercise_reverseName(e, settings),
    nameWithEquipment: Exercise_nameWithEquipment(e, settings),
    get: ex(e),
    find: ex(Exercise_find(t, settings.exercises)),
    onerm: Exercise_onerm(t, settings),
    rounding: Exercise_defaultRounding(t, settings),
    notes: Exercise_getNotes(t, settings) ?? null,
    isCustom: Exercise_isCustom(t.id, settings.exercises),
  };
});

const muscleTypes: Any[] = [];
for (const id of ids) muscleTypes.push({ id });
muscleTypes.push({ id: "benchPress", equipment: "dumbbell" }, { id: "abWheel" }, { id: "cCurl", equipment: "dumbbell" });
const muscleSettingsVariants = { custom: settings, plain: { ...settings, exercises: {}, exerciseData: {}, muscleGroups: { vtype: "muscle_groups_settings", data: {} } } as Any };
const perMuscle = muscleTypes.map((t) => {
  const out: Any = { type: t };
  for (const [variant, s] of Object.entries(muscleSettingsVariants)) {
    out[variant] = {
      defaultTarget: Exercise_defaultTargetMuscles(t, s),
      target: Exercise_targetMuscles(t, s),
      defaultSynergist: Exercise_defaultSynergistMuscles(t, s),
      synergist: Exercise_synergistMuscles(t, s),
      synergistMultipliers: Exercise_synergistMuscleMultipliers(t, s),
      targetGroups: Exercise_targetMusclesGroups(t, s),
      defaultTargetGroups: Exercise_defaultTargetMusclesGroups(t, s),
      synergistGroups: Exercise_synergistMusclesGroups(t, s),
      groupMultipliers: Exercise_synergistMusclesGroupMultipliers(t, s),
    };
  }
  return out;
});

const perId = ids.map((id) => ({
  id,
  metadata: Exercise_getMetadata(id),
  defaultEquipment: Exercise_defaultEquipment(id, noCustom) ?? null,
  defaultEquipmentCustom: Exercise_defaultEquipment(id, customExercises) ?? null,
  getById: ex(Exercise_getById(id, settings.exercises)),
  findById: ex(Exercise_findById(id, settings.exercises)),
  findByIdBuiltin: ex(Exercise_findById(id, noCustom)),
}));

const slugs = new Set<string>(["", "barbell-", "barbell", "leverage-machine-squat", "Squat", "bench-press", "x", "-", "ez-bar-bench-press", "ab-wheel", "AB-Wheel", "bench--press", "cable-"]);
for (const p of perType) slugs.add(p.slug);
const fromSlug = [...slugs].map((slug) => ({ slug, result: Exercise_fromUrlSlug(slug) ?? null }));

const keys = ["", "squat", "squat_barbell", "a_b_c", "a_", "_b", "leverageMachine", "squat_leverageMachine_x"];
const fromKey = keys.map((k) => {
  const r = Exercise_fromKey(k);
  return { key: k, id: r.id, equipment: r.equipment ?? null };
});

const nameCases = ["", "  ", "Squat", "A/B", "a:b", "x\ty", "x  y   z", " (hi) [there] | ! # {a}", "a b", "ok name", "!!!", "tab\tsep"];
const names = nameCases.map((n) => ({
  name: n,
  error: Exercise_nameError(n) ?? null,
  sanitized: Exercise_sanitizeName(n),
}));

const buildNames = [
  ["Squat", undefined, undefined],
  ["Squat", "lbl", undefined],
  ["Squat", undefined, "barbell"],
  ["Squat", "lbl", "cable"],
  ["Squat", "", "kettlebell"],
  ["Squat", "x", ""],
  ["Squat", undefined, "weird"],
].map(([name, label, equipment]) => ({
  name,
  label: label ?? null,
  equipment: equipment ?? null,
  result: Exercise_buildName(name as string, settings, label as string | undefined, equipment as Any),
}));

const equipmentNames = equipments.map((e) => ({ equipment: e, plain: equipmentName(e), barKey: equipmentToBarKey(e) ?? null }));
const eqSettingsNames = [...equipments, "weird"].map((e) => ({ equipment: e, withSettings: equipmentName(e as Any, settings.gyms[0].equipment) }));

const allList = Exercise_all(settings.exercises).map(ex);
const allBuiltin = Exercise_getByIds(ids.slice(0, 5).concat(["nope", "cCurl"]), settings.exercises).map(ex);

const eqCases = [
  [{ id: "a" }, { id: "a" }],
  [{ id: "a", equipment: "barbell" }, { id: "a" }],
  [{ id: "a", equipment: "barbell" }, { id: "a", equipment: "barbell" }],
  [{ id: "a" }, { id: "b" }],
].map(([a, b]) => ({ a, b, result: Exercise_eq(a as Any, b as Any) }));

const muscleGroupFns = {
  available: Muscle_getAvailableMuscleGroups(settings),
  availablePlain: Muscle_getAvailableMuscleGroups(muscleSettingsVariants.plain),
  hidden: Muscle_getHiddenMuscleGroups(settings),
  names: ["shoulders", "chest", "neck", "back", "unknown"].map((g) => ({ group: g, name: Muscle_getMuscleGroupName(g as Any, settings) })),
  musclesOf: ["shoulders", "chest", "neck", "triceps", "unknown", "abs"].map((g) => ({
    group: g,
    custom: Muscle_getMusclesFromScreenMuscle(g, settings),
    plain: Muscle_getMusclesFromScreenMuscle(g, muscleSettingsVariants.plain),
  })),
  groupsOf: availableMuscles.map((m) => ({
    muscle: m,
    custom: Muscle_getScreenMusclesFromMuscle(m, settings),
    plain: Muscle_getScreenMusclesFromMuscle(m, muscleSettingsVariants.plain),
  })),
  isDefault: [
    ["biceps", ["Brachialis", "Biceps Brachii"]],
    ["biceps", ["Brachialis"]],
    ["neck", []],
    ["triceps", ["Triceps Brachii"]],
  ].map(([g, m]) => ({ group: g, muscles: m, result: Muscle_isDefaultMuscles(g as Any, m as Any) })),
  imageUrls: ["Pectoralis Major Sternal Head", "Biceps Brachii", "Wrist Flexors"].map((m) => ({ muscle: m, url: Muscle_imageUrl(m as Any) })),
};

const warmups = { lb: warmupValues("lb"), kg: warmupValues("kg") };

await Deno.writeTextFile(
  new URL("exercise_functions.json", outDir),
  JSON.stringify(
    { settings, perType, perMuscle, perId, fromSlug, fromKey, names, buildNames, equipmentNames, eqSettingsNames, allList, allBuiltin, eqCases, muscleGroupFns, warmups },
    null,
    0,
  ).replaceAll("},{", "},\n{") + "\n",
);
console.log(`lookup: ${sorted.length} candidates; types: ${types.length}`);
