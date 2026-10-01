// Generates the expected values for the weight/equipment/set/stats unit tests
// by running the TS oracle. Run from packages/liftoscript:
//   deno run -A --config deno.json ../../crates/qala-lspp/testdata/unit/gen_unit_cases.ts
// Writes cases_*.json next to this file. The Rust tests replay every case.
import * as W from "../../../../packages/liftoscript/src/models/weight.ts";
import * as E from "../../../../packages/liftoscript/src/models/equipment.ts";
import * as R from "../../../../packages/liftoscript/src/models/set.ts";
import * as S from "../../../../packages/liftoscript/src/models/stats.ts";
import * as P from "../../../../packages/liftoscript/src/models/pp.ts";

// deterministic ids for UidFactory_generateUid (tests normalize ids anyway)
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const dir = new URL(".", import.meta.url).pathname;
const settings = JSON.parse(Deno.readTextFileSync(dir + "settings.json"));
const otherGym = { ...settings, currentGymId: "other" };
const kgSettings = { ...settings, units: "kg" };
const noGym = { ...settings, gyms: [] };

// deno-lint-ignore no-explicit-any
type Case = { fn: string; args: any[]; out?: unknown; throws?: string };
const cases: Record<string, Case[]> = { weight: [], equipment: [], set: [], stats: [], pp: [] };

function clean(x: unknown): unknown {
  if (x === undefined) return null;
  return JSON.parse(JSON.stringify(x, (_k, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) return String(v);
    return v;
  }));
}

// deno-lint-ignore no-explicit-any
function rec(group: string, fn: string, args: any[], f: () => unknown): void {
  const c: Case = { fn, args: args.map(clean) };
  try {
    const out = f();
    c.out = out === undefined ? null : clean(out);
  } catch (e) {
    c.throws = String((e as Error).message);
  }
  cases[group].push(c);
}

const w = (value: number, unit: "kg" | "lb") => ({ value, unit });
const pct = (value: number) => ({ value, unit: "%" });
const values = [
  w(100, "lb"), w(100, "kg"), w(0, "lb"), w(-45, "lb"), w(2.5, "kg"), w(132.5, "lb"), w(45.25, "lb"),
  w(1.005, "kg"), w(17.5, "kg"), w(12.345, "lb"), pct(85), pct(-12.5), pct(100), 5, 0, 2.5, -3,
];
const weightsOnly = values.filter((v) => typeof v === "object" && v.unit !== "%") as { value: number; unit: "kg" | "lb" }[];

// ---- pure weight functions
for (const v of values) {
  rec("weight", "display", [v, true], () => W.Weight_display(v, true));
  rec("weight", "display", [v, false], () => W.Weight_display(v, false));
  rec("weight", "print", [v], () => W.Weight_print(v));
  rec("weight", "printNull", [v], () => W.Weight_printNull(v));
  rec("weight", "printOrNumber", [v], () => W.Weight_printOrNumber(v));
  rec("weight", "type", [v], () => W.Weight_type(v));
  rec("weight", "convertValueTo", [v, "lb"], () => W.Weight_convertTo(v as never, "lb"));
  rec("weight", "convertValueTo", [v, "kg"], () => W.Weight_convertTo(v as never, "kg"));
  rec("weight", "convertValueTo", [v, "%"], () => W.Weight_convertTo(v as never, "%"));
}
rec("weight", "printNull", [null], () => W.Weight_printNull(undefined));
for (const v of weightsOnly) {
  for (const u of ["kg", "lb"] as const) {
    rec("weight", "convertTo", [v, u], () => W.Weight_convertTo(v, u));
    rec("weight", "smartConvert", [v, u], () => W.Weight_smartConvert(v, u));
  }
  rec("weight", "abs", [v], () => W.Weight_abs(v));
  rec("weight", "invert", [v], () => W.Weight_invert(v));
  rec("weight", "roundTo005", [v], () => W.Weight_roundTo005(v));
  rec("weight", "roundTo000005", [v], () => W.Weight_roundTo000005(v));
  rec("weight", "oppositeUnit", [v.unit], () => W.Weight_oppositeUnit(v.unit));
}
for (const u of [w(1, "kg"), w(14.9, "kg"), w(15, "kg"), w(60, "kg"), w(7.3, "lb"), w(14, "lb"), w(15, "lb"), w(225, "lb"), w(100.5, "lb")]) {
  rec("weight", "smartConvert", [u, u.unit === "kg" ? "lb" : "kg"], () => W.Weight_smartConvert(u, u.unit === "kg" ? "lb" : "kg"));
}
const parseStrs = [
  "100lb", "100 kg", "  5kg", "5 kg ", "-12.5kg", "+3lb", "1.2.3lb", "..kg", ".5lb", "5.lb", "abc", "", "100", "100 lbs", "0lb", "1e3kg",
  "85%", "-12.345%", ".%", "85 %", "1.005kg", "2.675lb", "0x10kg", "100\tkg", "100 kg", "007kg", "9999999999999999999999lb", "+.kg", "-kg",
];
for (const s of parseStrs) {
  rec("weight", "parse", [s], () => W.Weight_parse(s));
  rec("weight", "parsePct", [s], () => W.Weight_parsePct(s));
  rec("weight", "strictParse", [s], () => W.Weight_strictParse(s));
}
rec("weight", "parsePct", [null], () => W.Weight_parsePct(undefined));

for (const reps of [0, 1, 2, 3, 5, 8, 10, 12, 24, 30, 2.5]) {
  for (const rpe of [1, 5, 6.5, 7, 8, 9, 9.5, 10, 11]) {
    rec("weight", "rpeMultiplier", [reps, rpe], () => W.Weight_rpeMultiplier(reps, rpe));
  }
  rec("weight", "rpePct", [reps, 8], () => W.Weight_rpePct(reps, 8));
  rec("weight", "getOneRepMax", [w(200, "lb"), reps, null], () => W.Weight_getOneRepMax(w(200, "lb"), reps));
  rec("weight", "getOneRepMax", [w(100, "kg"), reps, 8], () => W.Weight_getOneRepMax(w(100, "kg"), reps, 8));
  rec("weight", "getNRepMax", [w(300, "lb"), reps], () => W.Weight_getNRepMax(w(300, "lb"), reps));
}
rec("weight", "calculateRepMax", [5, 8, 200, 3, 9], () => W.Weight_calculateRepMax(5, 8, 200, 3, 9));
rec("weight", "calculateRepMax", [10, 10, 135, 1, 10], () => W.Weight_calculateRepMax(10, 10, 135, 1, 10));
rec("weight", "calculateRepMax", [3, 7, 100, 12, 6.5], () => W.Weight_calculateRepMax(3, 7, 100, 12, 6.5));

const numOrW = [w(100, "lb"), w(50, "kg"), 2, 0.5, 0, w(0, "kg"), w(1.005, "lb")];
for (const a of weightsOnly.slice(0, 6)) {
  for (const b of numOrW) {
    rec("weight", "add", [a, b], () => W.Weight_add(a, b));
    rec("weight", "subtract", [a, b], () => W.Weight_subtract(a, b));
    rec("weight", "multiply", [a, b], () => W.Weight_multiply(a, b));
    rec("weight", "divide", [a, b], () => W.Weight_divide(a, b));
  }
}
rec("weight", "operation", [2, w(5, "kg")], () => W.Weight_operation(2, w(5, "kg"), (x, y) => x - y));
rec("weight", "operationAdd", [2, w(5, "kg")], () => W.Weight_operation(2, w(5, "kg"), (x, y) => x + y));
rec("weight", "operationAdd", [2, 3], () => W.Weight_operation(2 as never, 3 as never, (x, y) => x + y));

for (const a of values) {
  for (const b of values) {
    rec("weight", "gt", [a, b], () => W.Weight_gt(a, b));
    rec("weight", "lt", [a, b], () => W.Weight_lt(a, b));
    rec("weight", "gte", [a, b], () => W.Weight_gte(a, b));
    rec("weight", "lte", [a, b], () => W.Weight_lte(a, b));
    rec("weight", "eq", [a, b], () => W.Weight_eq(a, b));
    rec("weight", "eqNull", [a, b], () => W.Weight_eqNull(a, b));
  }
  rec("weight", "eqNull", [a, null], () => W.Weight_eqNull(a, undefined));
  rec("weight", "eqNull", [null, a], () => W.Weight_eqNull(undefined, a));
}
rec("weight", "eqNull", [null, null], () => W.Weight_eqNull(undefined, undefined));
for (const a of weightsOnly) {
  for (const b of weightsOnly) {
    rec("weight", "eqeq", [a, b], () => W.Weight_eqeq(a, b));
    rec("weight", "compare", [a, b], () => W.Weight_compare(a, b));
    rec("weight", "compareReverse", [a, b], () => W.Weight_compareReverse(a, b));
  }
}
rec("weight", "max", [weightsOnly], () => W.Weight_max(weightsOnly));
rec("weight", "max", [[]], () => W.Weight_max([]));
rec("weight", "max", [[w(10, "kg"), w(20, "lb"), w(30, "lb")]], () => W.Weight_max([w(10, "kg"), w(20, "lb"), w(30, "lb")]));

const onerm = w(200, "lb");
const ops = ["=", "+=", "-=", "*=", "/="] as const;
const opVals = [5, 2.5, w(10, "lb"), w(4, "kg"), pct(50), pct(33.3)];
for (const a of opVals) {
  for (const b of opVals) {
    for (const op of ops) {
      rec("weight", "applyOp", [onerm, a, b, op], () => W.Weight_applyOp(onerm, a as never, b as never, op));
      rec("weight", "applyOp", [null, a, b, op], () => W.Weight_applyOp(undefined, a as never, b as never, op));
    }
  }
}
for (const v of [5, 150, pct(50), pct(33.333), w(12, "kg")]) {
  for (const unit of ["lb", "kg"] as const) {
    rec("weight", "convertToWeight", [onerm, v, unit], () => W.Weight_convertToWeight(onerm, v as never, unit));
  }
}
rec("weight", "platesWeight", [[{ weight: w(45, "lb"), num: 2 }, { weight: w(10, "lb"), num: 3 }]], () => W.Weight_platesWeight([{ weight: w(45, "lb"), num: 2 }, { weight: w(10, "lb"), num: 3 }]));
rec("weight", "platesWeight", [[]], () => W.Weight_platesWeight([]));
rec("weight", "platesWeight", [[{ weight: w(20, "kg"), num: 2 }]], () => W.Weight_platesWeight([{ weight: w(20, "kg"), num: 2 }]));
rec("weight", "buildAny", [5, "%"], () => W.Weight_buildAny(5, "%"));
rec("weight", "buildAny", [5, "kg"], () => W.Weight_buildAny(5, "kg"));

// ---- settings dependent weight functions
const sets: [string, unknown][] = [["lb", settings], ["other", otherGym], ["kg", kgSettings], ["nogym", noGym]];
const types = [
  { id: "squat", equipment: "barbell" }, { id: "benchPress", equipment: "barbell" }, { id: "deadlift" },
  { id: "bicepCurl", equipment: "dumbbell" }, { id: "legPress" }, { id: "pullUp" }, { id: "tricepsPushdown", equipment: "cable" },
  { id: "squat" }, { id: "overheadPress", equipment: "barbell" }, { id: "lunge", equipment: "kettlebell" },
];
const sw = [w(0, "lb"), w(45, "lb"), w(135, "lb"), w(137.5, "lb"), w(187.3, "lb"), w(315, "lb"), w(60, "kg"), w(61.2, "kg"), w(100.7, "kg"), w(-135, "lb"), w(7, "lb"), w(17, "lb"), w(500, "lb"), w(33, "kg")];
for (const [sname, s] of sets) {
  if (sname === "nogym") continue;
  for (const t of types) {
    for (const x of sw) {
      for (const u of ["lb", "kg"] as const) {
        if (sname !== "lb" && u === "kg" && x.unit === "lb") continue;
        rec("weight", "calculatePlates", [sname, x, u, t], () => W.Weight_calculatePlates(x, s as never, u, t));
      }
      rec("weight", "round", [sname, x, x.unit, t], () => W.Weight_round(x, s as never, x.unit, t));
      rec("weight", "increment", [sname, x, t], () => W.Weight_increment(x, s as never, t));
      rec("weight", "decrement", [sname, x, t], () => W.Weight_decrement(x, s as never, t));
    }
    rec("weight", "evaluateWeight", [sname, pct(85), t], () => W.Weight_evaluateWeight(pct(85) as never, t, s as never));
    rec("weight", "evaluateWeight", [sname, pct(33.3), t], () => W.Weight_evaluateWeight(pct(33.3) as never, t, s as never));
    rec("weight", "evaluateWeight", [sname, w(100, "kg"), t], () => W.Weight_evaluateWeight(w(100, "kg"), t, s as never));
  }
  for (const x of [w(135, "lb"), w(100, "kg"), w(77.7, "lb")]) {
    rec("weight", "increment", [sname, x, null], () => W.Weight_increment(x, s as never));
    rec("weight", "decrement", [sname, x, null], () => W.Weight_decrement(x, s as never));
    rec("weight", "round", [sname, x, x.unit, null], () => W.Weight_round(x, s as never, x.unit));
    rec("weight", "getTrainingMax", [sname, x, 5], () => W.Weight_getTrainingMax(x, 5, s as never));
    rec("weight", "roundConvertTo", [sname, x, "kg", { id: "squat", equipment: "barbell" }], () => W.Weight_roundConvertTo(x, s as never, "kg", { id: "squat", equipment: "barbell" }));
    rec("weight", "roundConvertTo", [sname, x, "lb", null], () => W.Weight_roundConvertTo(x, s as never, "lb"));
  }
}
const plateSets = [
  [{ weight: w(45, "lb"), num: 4 }, { weight: w(10, "lb"), num: 2 }, { weight: w(25, "lb"), num: 6 }],
  [{ weight: w(45, "lb"), num: 8 }, { weight: w(45, "lb"), num: 2 }],
  [{ weight: w(20, "kg"), num: 4 }, { weight: w(1.25, "kg"), num: 2 }],
  [],
];
for (const ps of plateSets) {
  for (const t of [{ id: "squat", equipment: "barbell" }, { id: "legPress" }]) {
    rec("weight", "formatOneSide", ["lb", ps, t], () => W.Weight_formatOneSide(settings as never, ps, t));
  }
}

// ---- equipment
const gymId = [null, "home", "other", "missing"];
rec("equipment", "build", ["My Bar"], () => E.Equipment_build("My Bar"));
for (const [sname, s] of [...sets]) {
  if (sname === "nogym") continue;
  for (const k of [null, "home", "other", "nope"]) {
    rec("equipment", "getEquipmentOfGym", [sname, k], () => E.Equipment_getEquipmentOfGym(s as never, k ?? undefined));
  }
  rec("equipment", "getCurrentGym", [sname], () => E.Equipment_getCurrentGym(s as never));
  for (const g of gymId) {
    rec("equipment", "getGymByIdOrCurrent", [sname, g], () => E.Equipment_getGymByIdOrCurrent(s as never, g ?? undefined));
    for (const t of [...types, null]) {
      rec("equipment", "getEquipmentIdForExerciseType", [sname, t, g], () => E.Equipment_getEquipmentIdForExerciseType(s as never, t ?? undefined, g ?? undefined));
    }
  }
  for (const t of [...types, null]) {
    rec("equipment", "getEquipmentNameForExerciseType", [sname, t], () => E.Equipment_getEquipmentNameForExerciseType(s as never, t ?? undefined));
    rec("equipment", "getEquipmentDataForExerciseType", [sname, t], () => E.Equipment_getEquipmentDataForExerciseType(s as never, t ?? undefined));
    rec("equipment", "getUnitOrDefaultForExerciseType", [sname, t], () => E.Equipment_getUnitOrDefaultForExerciseType(s as never, t ?? undefined));
    rec("equipment", "getUnitForExerciseType", [sname, t], () => E.Equipment_getUnitForExerciseType(s as never, t ?? undefined));
  }
  for (const k of ["barbell", "machine", "nope"]) {
    rec("equipment", "getEquipmentData", [sname, k], () => E.Equipment_getEquipmentData(s as never, k));
  }
  rec("equipment", "currentEquipment", [sname], () => E.Equipment_currentEquipment(s as never));
}
const homeEq = settings.gyms[0].equipment;
for (const k of Object.keys(homeEq)) {
  for (const u of ["kg", "lb"] as const) {
    rec("equipment", "smallestPlate", [k, u], () => E.Equipment_smallestPlate(homeEq[k], u));
  }
}
rec("equipment", "mergeEquipment", [{ barbell: homeEq.barbell, cable: homeEq.cable }, { barbell: settings.gyms[1].equipment.barbell, assist: homeEq.assist }],
  () => E.Equipment_mergeEquipment({ barbell: homeEq.barbell, cable: homeEq.cable }, { barbell: settings.gyms[1].equipment.barbell, assist: homeEq.assist }));
rec("equipment", "mergeEquipment", [{}, { cable: homeEq.cable }], () => E.Equipment_mergeEquipment({}, { cable: homeEq.cable }));
for (const k of ["barbell", "cable", "machine", "", "Barbell"]) rec("equipment", "isBuiltIn", [k], () => E.Equipment_isBuiltIn(k));
rec("equipment", "customEquipment", [homeEq], () => E.Equipment_customEquipment(homeEq));
rec("equipment", "customEquipment", [null], () => E.Equipment_customEquipment(undefined));
for (const n of ["barbell", "Barbell", "EZ BAR", "ez bar", "smith machine", "Leverage Machine", "sled", "machine", "", "nope", "Dumbbell"]) {
  rec("equipment", "equipmentKeyByName", [n, null], () => E.Equipment_equipmentKeyByName(n));
  rec("equipment", "equipmentKeyByName", [n, homeEq], () => E.Equipment_equipmentKeyByName(n, homeEq));
}

// ---- sets
const S0 = { vtype: "set", index: 0, id: "a0", reps: 5, weight: w(100, "lb"), originalWeight: pct(80), isAmrap: false, completedReps: 5, completedWeight: w(100, "lb"), isCompleted: true };
const S1 = { vtype: "set", index: 1, id: "a1", reps: 5, weight: w(100, "lb"), originalWeight: pct(80), completedReps: 4, completedWeight: w(100, "lb"), isCompleted: true, completedRpe: 9, rpe: 8 };
const S2 = { vtype: "set", index: 2, id: "a2", reps: 5, minReps: 3, weight: w(100, "lb"), isAmrap: true, completedReps: 3, completedWeight: w(100, "lb"), isCompleted: true, askWeight: true };
const S3 = { vtype: "set", index: 3, id: "a3", reps: 8, weight: w(60, "kg"), completedReps: 8, completedRepsLeft: 7, completedWeight: w(60, "kg"), isCompleted: true, isUnilateral: true, timer: 90, setTimer: 30, completedSetTimer: 28, completedSetTimerLeft: 2, label: "L" };
const S4 = { vtype: "set", index: 4, id: "a4", reps: 5, weight: w(100, "lb"), completedReps: 5, completedWeight: w(95, "lb"), isCompleted: true };
const S5 = { vtype: "set", index: 5, id: "a5", reps: 0, isCompleted: false };
const S6 = { vtype: "set", index: 6, id: "a6", isCompleted: false, logRpe: true, auto: true, isOverflowSetTimer: true };
const S7 = { vtype: "set", index: 7, id: "a7", reps: 5, weight: w(100, "lb"), completedReps: 5, completedWeight: w(100, "lb"), isCompleted: false };
const S8 = { vtype: "set", index: 8, id: "a8", reps: 5, minReps: 5, weight: w(100, "lb"), originalWeight: w(100, "lb"), completedReps: 5, completedWeight: w(100, "lb"), isCompleted: true, rpe: 0 };
const S9 = { vtype: "set", index: 9, id: "a9", reps: 6, weight: w(100, "lb"), completedReps: 6, completedWeight: w(100, "lb"), isCompleted: true, isUnilateral: true };
const allSets = [S0, S1, S2, S3, S4, S5, S6, S7, S8, S9];
const groups: unknown[][] = [
  [], [S0], [S0, S0, S0], [S0, S1, S2], [S0, S4, S7], [S0, S1, S4, S8], [S5, S6], [S2, S2], [S1, S1, S1, S1, S1, S1, S1], [S3, S9],
  [S0, S0, S0, S0, S0, S0, S0, S0, S0, S0, S0], [S7, S7],
];
for (const g of groups) {
  for (const n of [false, true]) {
    rec("set", "displaySets", [g, n], () => R.Reps_display(g as never, n));
    rec("set", "areSameReps", [g, n], () => R.Reps_areSameReps(g as never, n));
    rec("set", "group", [g, n], () => R.Reps_group(g as never, n));
  }
  rec("set", "group", [g, null], () => R.Reps_group(g as never));
  rec("set", "isEmpty", [g], () => R.Reps_isEmpty(g as never));
  rec("set", "isCompleted", [g], () => R.Reps_isCompleted(g as never));
  rec("set", "setWarmupStatus", [g], () => R.Reps_setWarmupStatus(g as never));
  rec("set", "setsStatus", [g], () => R.Reps_setsStatus(g as never));
  rec("set", "isStarted", [g], () => R.Reps_isStarted(g as never));
  rec("set", "isFinished", [g], () => R.Reps_isFinished(g as never));
  rec("set", "isEmptyOrFinished", [g], () => R.Reps_isEmptyOrFinished(g as never));
  rec("set", "isInRangeCompleted", [g], () => R.Reps_isInRangeCompleted(g as never));
  for (const u of ["lb", "kg"] as const) {
    rec("set", "volume", [g, u], () => R.Reps_volume(g as never, u));
  }
  rec("set", "groupConsecutive", [g], () => R.Reps_groupConsecutive(g as never, (s) => R.Reps_completedSetKey(s as never)));
  const ds = (g as never[]).map((s) => R.Reps_setToDisplaySet(s, false, "lb"));
  rec("set", "groupDisplaySets", [ds], () => R.Reps_groupDisplaySets(ds));
  const dn = (g as never[]).map((s) => R.Reps_setToDisplaySet(s, true, "lb"));
  rec("set", "groupDisplaySets", [dn], () => R.Reps_groupDisplaySets(dn));
}
for (const s of allSets) {
  for (const n of [false, true]) {
    for (const u of ["lb", "kg"] as const) rec("set", "setToDisplaySet", [s, n, u], () => R.Reps_setToDisplaySet(s as never, n, u));
  }
  rec("set", "displayReps", [s], () => R.Reps_displayReps(s as never));
  rec("set", "displayCompletedReps", [s], () => R.Reps_displayCompletedReps(s as never));
  rec("set", "isCompletedSet", [s], () => R.Reps_isCompletedSet(s as never));
  rec("set", "isInRangeCompletedSet", [s], () => R.Reps_isInRangeCompletedSet(s as never));
  rec("set", "isFinishedSet", [s], () => R.Reps_isFinishedSet(s as never));
  rec("set", "toKey", [s], () => R.Reps_toKey(s as never));
  rec("set", "enforceCompletedSet", [s], () => R.Reps_enforceCompletedSet(s as never));
  rec("set", "maxUnilateralCompletedReps", [s], () => R.Reps_maxUnilateralCompletedReps(s as never));
  rec("set", "avgUnilateralCompletedReps", [s], () => R.Reps_avgUnilateralCompletedReps(s as never));
  rec("set", "completedSetKey", [s], () => R.Reps_completedSetKey(s as never));
  rec("set", "targetSetKey", [s], () => R.Reps_targetSetKey(s as never));
  for (const u of ["lb", "kg"] as const) rec("set", "setVolume", [s, u], () => R.Reps_setVolume(s as never, u));
  for (const t of allSets) rec("set", "isSameSet", [s, t], () => R.Reps_isSameSet(s as never, t as never));
}
const entryA = { vtype: "history_entry", id: "e", index: 0, exercise: { id: "squat" }, warmupSets: [S0, S5], sets: [S0, S1, S7] };
const entryB = { ...entryA, warmupSets: [S0], sets: [S0] };
const entryC = { ...entryA, warmupSets: [], sets: [] };
for (const e of [entryA, entryB, entryC]) {
  rec("set", "findNextSet", [e], () => R.Reps_findNextSet(e as never));
  rec("set", "findNextSetIndex", [e], () => R.Reps_findNextSetIndex(e as never));
}
// addSet / newSet with ids normalized by the test
for (const g of groups) {
  for (const uni of [false, true]) {
    for (const warm of [false, true]) {
      rec("set", "addSet", [g, uni, null, warm], () => R.Reps_addSet(g as never, uni, undefined, warm));
      rec("set", "addSet", [g, uni, S2, warm], () => R.Reps_addSet(g as never, uni, S2 as never, warm));
    }
  }
}
rec("set", "newSet", [true, 3], () => R.Reps_newSet(true, 3));
rec("set", "newSet", [false, 0], () => R.Reps_newSet(false, 0));

// ---- stats
const bw = (ts: number, v: number) => ({ vtype: "stat", value: w(v, "lb"), timestamp: ts });
const statsA = { weight: { weight: [bw(1000, 180), bw(3000, 184), bw(2000, 182), bw(500, 170)] }, length: {}, percentage: { bodyfat: [{ vtype: "stat", value: pct(15), timestamp: 10 }, { vtype: "stat", value: pct(14), timestamp: 20 }] } };
const statsB = { weight: {}, length: {}, percentage: {} };
const statsC = { weight: { weight: [] }, length: { waist: [] }, percentage: {} };
const statsD = { weight: {}, length: { waist: [{ vtype: "stat", value: { value: 30, unit: "in" }, timestamp: 1 }] }, percentage: {} };
const statsE = { weight: { weight: [bw(1, 100)] }, length: {}, percentage: {} };
for (const [i, st] of [statsA, statsB, statsC, statsD, statsE].entries()) {
  rec("stats", "getCurrentBodyweight", [st], () => S.Stats_getCurrentBodyweight(st as never));
  rec("stats", "getCurrentBodyfat", [st], () => S.Stats_getCurrentBodyfat(st as never));
  rec("stats", "isEmpty", [st], () => S.Stats_isEmpty(st as never));
  for (const win of [undefined, 0, 1, 2, 3, 4, 5, 2.5]) {
    const s2 = { ...settings, graphOptions: win === undefined ? {} : { weight: { movingAverageWindowSize: win } }, units: i % 2 ? "kg" : "lb" };
    rec("stats", "getCurrentMovingAverageBodyweight", [st, win ?? null, s2.units], () => S.Stats_getCurrentMovingAverageBodyweight(st as never, s2 as never));
  }
}
rec("stats", "getEmpty", [], () => S.Stats_getEmpty());
for (const k of ["bicepLeft", "bicepRight", "calfLeft", "calfRight", "chest", "forearmLeft", "forearmRight", "hips", "neck", "shoulders", "thighLeft", "thighRight", "waist", "weight", "bodyfat", "sleep", "calories", "protein"]) {
  rec("stats", "name", [k], () => S.Stats_name(k as never));
}

// ---- pp
const pt = { line: 1, offset: 0, from: 0, to: 1 };
const mkEx = (key: string, week: number, dayInWeek: number, day: number, i: number) => ({
  id: "x" + key, key, fullName: key, shortName: key, dayData: { week, dayInWeek, day }, exerciseIndex: i, repeat: [], repeating: [],
  order: 0, text: key, tags: [], name: key, line: 1, evaluatedSetVariations: [], setVariations: [], exerciseVariations: [],
  descriptions: { values: [] }, globals: {}, points: { fullName: pt },
});
const mkDay = (name: string, ex: string[], week: number, dayInWeek: number, day: number) => ({
  name, dayData: { week, dayInWeek, day }, exercises: ex.map((k, i) => mkEx(k, week, dayInWeek, day, i)),
});
const weeks = [
  { name: "W1", days: [mkDay("D1", ["a", "b"], 1, 1, 1), mkDay("D2", [], 1, 2, 2), mkDay("D3", ["c"], 1, 3, 3)] },
  { name: "W2", days: [mkDay("D1", ["d", "e", "f"], 2, 1, 4)] },
  { name: "W3", days: [] },
  { name: "W4", days: [mkDay("D1", ["g"], 4, 1, 5)] },
];
const walk = (stopAt: string | null) => {
  const out: unknown[] = [];
  P.PP_iterate2(weeks as never, (ex, w, d, di, ei) => {
    out.push([ex.key, w, d, di, ei]);
    return stopAt != null && ex.key === stopAt;
  });
  return out;
};
rec("pp", "iterate2", [weeks, null], () => walk(null));
for (const stop of ["a", "c", "e", "g", "zzz"]) rec("pp", "iterate2", [weeks, stop], () => walk(stop));
const okR = (keys: string[], w: number, d: number) => ({ success: true, data: keys.map((k, i) => mkEx(k, w, d, 0, i)) });
const errR = { success: false, error: { message: "boom", line: 1, offset: 2, from: 0, to: 1, details: { type: "parse" } } };
const evalWeeks = [[okR(["a"], 1, 1), errR, okR(["b", "c"], 1, 3)], [errR, okR(["d"], 2, 2)], [], [okR([], 4, 1), okR(["e"], 4, 2)]];
const walk2 = (stopAt: string | null) => {
  const out: unknown[] = [];
  P.PP_iterate(evalWeeks as never, (ex, w, d, di, ei) => {
    out.push([ex.key, w, d, di, ei]);
    return stopAt != null && ex.key === stopAt;
  });
  return out;
};
rec("pp", "iterate", [evalWeeks, null], () => walk2(null));
for (const stop of ["a", "c", "d"]) rec("pp", "iterate", [evalWeeks, stop], () => walk2(stop));
const L = (type: string, value: string) => ({ type, value });
const top = [
  [[[L("comment", "c"), L("exercise", "e1")], [L("exercise", "e2")]], [[L("empty", ""), L("description", "d")]], [[L("exercise", "e3")]]],
  [[[L("exercise", "e4"), L("exercise", "e5")]]],
  [],
  [[[L("exercise", "e6")]]],
];
const walk3 = (stopAt: string | null) => {
  const out: unknown[] = [];
  P.PP_iterateTopLineExercises(top as never, (line, w, d, di) => {
    out.push([line.value, w, d, di]);
    return stopAt != null && line.value === stopAt;
  });
  return out;
};
rec("pp", "iterateTopLineExercises", [top, null], () => walk3(null));
for (const stop of ["e1", "e3", "e5"]) rec("pp", "iterateTopLineExercises", [top, stop], () => walk3(stop));

for (const [group, list] of Object.entries(cases)) {
  Deno.writeTextFileSync(dir + `cases_${group}.json`, JSON.stringify(list) + "\n");
  console.log(group, list.length);
}
