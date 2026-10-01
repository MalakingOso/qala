// Generates expected values for the script evaluator tests by running the TS
// oracle (ScriptRunner / LiftoscriptEvaluator). Run from the repo root:
//   deno run -A --config packages/liftoscript/deno.json crates/qala-lspp/testdata/unit/gen_script_eval_cases.ts
// Writes cases_script_eval.json next to this file. The Rust tests replay every case.
//
// Corpus: every script in testdata/golden/liftoscript/lezer_trees/scripts*.json plus
// the hand-written list below, each run in planner and update mode against a few
// binding and state fixtures. Recorded per run: the result (or error), updates,
// state and other states after, the bindings keys that changed, and prints.
import { LiftoscriptEvaluator, LiftoscriptSyntaxError } from "../../../../packages/liftoscript/src/liftoscriptEvaluator.ts";
import { ScriptRunner } from "../../../../packages/liftoscript/src/parser.ts";
import {
  Progress_applyBindings,
  Progress_createEmptyScriptBindings,
  Progress_createScriptBindings,
  Progress_createScriptFunctions,
  Progress_getNextEntry,
} from "../../../../packages/liftoscript/src/models/progress.ts";
import { parser as LiftoscriptParser } from "../../../../packages/liftoscript/src/liftoscript.ts";

let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const dir = new URL(".", import.meta.url).pathname;
const root = dir + "../../../../";
const settings = JSON.parse(Deno.readTextFileSync(dir + "settings.json"));

// deno-lint-ignore no-explicit-any
type Any = any;

function clean(x: unknown): unknown {
  if (x === undefined) return null;
  return JSON.parse(JSON.stringify(x, (_k, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) return String(v);
    if (typeof v === "boolean") return v;
    return v;
  }));
}

const w = (value: number, unit: "kg" | "lb" = "lb") => ({ value, unit });

// ---- fixtures
const sets = [
  { vtype: "set", id: "s1", index: 0, isUnilateral: false, reps: 5, minReps: 3, weight: w(135), originalWeight: w(135), rpe: 8, isAmrap: false, isCompleted: true, completedReps: 5, completedWeight: w(135), completedRpe: 8, timer: 90, askWeight: false },
  { vtype: "set", id: "s2", index: 1, isUnilateral: false, reps: 5, weight: w(145), originalWeight: w(145), isAmrap: false, isCompleted: true, completedReps: 4, completedWeight: w(145), askWeight: false },
  { vtype: "set", id: "s3", index: 2, isUnilateral: false, reps: 8, minReps: 5, weight: w(155.5), originalWeight: { value: 80, unit: "%" }, rpe: 9, logRpe: true, isAmrap: true, isCompleted: false, askWeight: false, timer: 120, setTimer: 30 },
  { vtype: "set", id: "s4", index: 3, isUnilateral: false, reps: 3, weight: w(165), originalWeight: w(165), isAmrap: false, isCompleted: false, askWeight: true },
  { vtype: "set", id: "s5", index: 4, isUnilateral: false, reps: 10, weight: w(100), originalWeight: w(100), rpe: 7.5, isAmrap: false, isCompleted: false, askWeight: false },
];
const entry = {
  vtype: "history_entry",
  exercise: { id: "squat", equipment: "barbell" },
  sets,
  warmupSets: [],
  index: 0,
  id: "e1",
};
const dayData = { week: 2, day: 3, dayInWeek: 1 };
const engine = { readiness: 0.8, prs: 6, soreness: 2, fatigueLocal: 0.25, deload: 1, recWeightPct: -2.5, recSets: -1 };

const fullAliased = Progress_createScriptBindings(dayData, entry as Any, settings, 5, w(180), 2, 2, 3, 4);
Object.assign(fullAliased, engine);
const fullSeparate = JSON.parse(JSON.stringify(fullAliased));
const empty = Progress_createEmptyScriptBindings(dayData, settings);

const fixtures: Record<string, { aliased: boolean; bindings: unknown }> = {
  full: { aliased: true, bindings: clean(fullAliased) },
  fullSeparate: { aliased: false, bindings: clean(fullSeparate) },
  empty: { aliased: false, bindings: clean(empty) },
};
const fixtureFns = () => ({
  full: () => {
    const b = Progress_createScriptBindings(dayData, entry as Any, settings, 5, w(180), 2, 2, 3, 4);
    Object.assign(b, engine);
    return b;
  },
  fullSeparate: () => JSON.parse(JSON.stringify(fullSeparate)),
  empty: () => Progress_createEmptyScriptBindings(dayData, settings),
}) as Record<string, () => Any>;
const fixtureMakers = fixtureFns();

const otherStatesFixture = { "1": { x: 1, y: w(100) }, "2": { z: 5 } };

function stateFor(script: string, variant: "num" | "wt"): Record<string, unknown> {
  const keys: string[] = [];
  for (const m of script.matchAll(/state\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  const state: Record<string, unknown> = {};
  keys.forEach((k, i) => {
    if (variant === "num") state[k] = [3, 5, 1, 0, 2.5][i % 5];
    else state[k] = i % 3 === 0 ? w(135) : i % 3 === 1 ? { value: 50, unit: "%" } : w(2.5, "kg");
  });
  return state;
}

// ---- corpus
const corpus: string[] = [];
const seen = new Set<string>();
function add(s: string) {
  if (!seen.has(s)) {
    seen.add(s);
    corpus.push(s);
  }
}
const fuzzScripts = new Set<string>();
for (const f of ["scripts", "scripts_extra", "scripts_fuzz"]) {
  const list = JSON.parse(Deno.readTextFileSync(root + `testdata/golden/liftoscript/lezer_trees/${f}.json`));
  for (const x of list) {
    if (f === "scripts_fuzz" && !seen.has(x.input)) fuzzScripts.add(x.input);
    add(x.input);
  }
}
const hand: string[] = String.raw`
reps[1] = 5
reps[2] += 1
reps[*] += 1
reps += 2
reps *= 1.5
reps /= 3
reps = reps[1] + 1
reps[10] = 3
reps[1:2] = 3
reps[1, 2] = 3
minReps[*] = 2
minReps = 4
minReps[3] -= 1
RPE = 12
RPE[1] = 7.3
RPE[*] += 1
RPE *= 1.1
weights = 135lb
weights[1] = 100kg
weights[*] += 5lb
weights *= 1.05
weights /= 2
weights += 10%
weights = 50%
weights[*] = rm1 * 0.8
weights[2] -= 5
weights[3] = 5
weights[1:2] = 5
amraps = 1
amraps[1] = 2
amraps[*] += 3
logrpes = 1
logrpes[2] = -4
askweights[1] = 1
askweights += 1
timers = 120
timers[1] = 30
timers[*] += 10
setTime = 40
setTime[2] = 20
numberOfSets = 3
numberOfSets += 2
numberOfSets -= 10
numberOfSets = -1
numberOfSets = 8
numberOfSets *= 2
numberOfSets /= 2
numberOfSets = 2.7
numberOfSets = 0
numberOfSets[1] = 2
numberOfSets = ns + 1
setVariationIndex = 2
setVariationIndex[1:2] = 2
exerciseVariationIndex[*:*] = 3
descriptionIndex = 2
descriptionIndex[2:3] = 5
numberOfSets[1:2:3] = 5
numberOfSets[*:*:*] = 5
numberOfSets[2:3:2] = 5
numberOfSets[1:2:3:4] = 5
weights[1:2:3:4] = 100lb
weights[*:*:*:*] += 5
weights[1:2:3:4:5] = 1
reps[1:2:3:4] = 1
timers[1:2:3:4] = 1
RPE[2:3:2:1] = 7
setVariationIndex[1:2:3] = 1
rm1 = 300lb
rm1 += 5lb
rm1 -= 5%
rm1 *= 1.1
rm1 /= 2
rm1 = 200
rm1 = reps
rm1[1] = 5
rm1 %= 3
bodyweight
rm1
rm1 + 5
rm1 * 0.5
rm1 * 50%
50% * rm1
bodyweight + rm1
sum(weights)
sum(reps)
sum(1, 2, 3)
sum(1lb, 2lb)
sum(1lb, 2kg)
sum(10%, 5%)
sum(1lb, 5%)
sum()
sum(reps, completedReps)
min(reps)
min(weights)
min(1, 2, 3)
min(5lb, 2kg)
max(reps)
max(reps, 20)
max(weights, 100lb)
max(1lb, 1kg)
max()
max(true)
floor(2.5)
floor(2.5lb)
floor(55.5%)
ceil(2.1)
ceil(-2.1lb)
round(2.5)
round(-2.5)
round(0.49999999999999994)
round(1.5lb)
round(reps)
round(reps[1])
floor(reps)
roundWeight(133lb)
roundWeight(133)
roundWeight(133.7kg)
roundConvertWeight(100kg)
roundConvertWeight(100)
calculateTrainingMax(300lb, 5)
calculateTrainingMax(300, 1)
calculateTrainingMax(300lb, 0)
calculate1RM(200lb, 5)
calculate1RM(200lb, 1)
calculate1RM(200lb, 0)
calculate1RM(200kg, 12)
rpeMultiplier(5, 8)
rpeMultiplier(5)
rpeMultiplier(3lb, 8)
rpeMultiplier(5, 11)
rpeMultiplier(0, 10)
rpeMultiplier(reps[1], RPE[1])
increment(135lb)
increment(135)
increment(10%)
decrement(135lb)
decrement(135)
decrement(10%)
increment(weights)
increment(weights[1])
decrement(weights[2])
increment(rm1)
zeroOrGte(completedReps, reps)
zeroOrGte(reps, completedReps)
zeroOrGte(completedWeights, weights)
zeroOrGte(reps, reps)
zeroOrGte(1, 2)
zeroOrGte(reps)
print(1)
print(1, 2lb, 50%)
print(reps)
print(weights, reps)
print()
print(1 > 0)
print(true && 5)
print(reps) + 1
print() + 1
print(print(3) + 1)
print(1) print(2)
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1)
sets(1, 5, 3, 3, 0, 50%, 0, 0, 0)
sets(2, 2, 5, 5, 0, 135, 60, 7, 1)
sets(0, 100, 5, 5, 1, 1lb, 0, 0, 0)
sets(1, 3, 5, 5, 0, 5, 0, 0, 0) + 1
sets(1, 3, 5, 5, 0, reps, 0, 0, 0)
sets(1, 3, 5, 5, 0, 100lb)
sets(1, 3, 5, 5, 0, 100lb, 0, 0, 0, 0)
reps
minReps
weights
originalWeights
completedReps
completedWeights
completedRepsLeft
completedRPE
completedSetTime
isCompleted
RPE
amraps
askweights
timers
w
r
mr
cr
cw
reps[1]
reps[0]
reps[-1]
reps[1.5]
reps[5]
reps[6]
reps[100]
reps[numberOfSets]
reps[ns]
reps[*]
reps[1:2]
minReps[1]
minReps[2]
minReps[3]
minReps[5]
weights[1]
weights[0]
weights[2] + 5lb
weights[1] > weights[2]
weights[2] > 100
weights[2] > 100lb
weights[2] > 50%
originalWeights[3]
originalWeights[1]
completedWeights[1]
completedWeights[3]
completedReps[1]
completedReps[3]
completedReps[ns]
isCompleted[1]
isCompleted[3]
w[1]
r[2]
mr[1]
cr[1]
cw[1]
day
week
dayInWeek
setIndex
programNumberOfSets
completedNumberOfSets
numberOfSets
ns
numberOfSets[1]
setVariationIndex
exerciseVariationIndex
descriptionIndex
setVariationIndex[1]
readiness
prs
soreness
fatigueLocal
deload
recWeightPct
recSets
readiness * 100
recWeightPct * 2
bodyweight[1]
foo
foo[1]
foo = 5
foo += 5
rm1[1]
completedReps > reps
completedReps >= reps
completedReps < reps
completedReps == reps
completedReps != reps
completedReps >= 5
5 <= completedReps
reps > 1 && reps < 100
reps > 100 || reps < 100
completedReps > 1 || 0
1 && 2
1 || 2
1 && true
0 && true
true && 0
false || 0
false || 5
true || 0
!1
!0
!reps
!completedReps
!rm1
!1 && 1
!(1 > 2)
!(1 > 2) + 1
reps + 1
reps + reps
reps * 2
reps - 1lb
reps % 2
completedReps / 2
weights + 5
5 + 5lb
5lb + 5
5lb + 5%
5% + 5lb
5% + 5%
5% + 5
5 + 5%
10lb * 50%
10lb * 2kg
2kg + 10lb
10lb - 2kg
10lb / 0
10 / 0
10 % 0
10lb % 3
10lb % 3lb
10 % 3lb
50% % 3
5 * 0.1
0.1 + 0.2
1 / 3
100 / 3
7 % 3
-7 % 3
7 % -3
5.5 % 2
2 - 3
-5lb
-5%
- 5
+5
1.5e3
1.2.3
.5
5.
007
1e
12.345%
12.3456%
99.999%
0.001%
100000000000000000000
0.0000001
123456789012345678901234567890
1 > NaN
(1 > 2) > 1
1 > (2 > 1)
true
1 +
+ 1
1 2
(
)
( 1
1 )
{~ ~}
{~ 1 ~}
{~ 1; 2 ~}
{~ {~ 3 ~} ~}
if (1) { 2 }
if (0) { 2 } else { 3 }
if (0) { 2 } else if (1) { 4 } else { 3 }
if (0) { 2 } else if (0) { 4 }
if (0) { 2 }
if (reps > 3) { 7 } else { 8 }
if (completedReps >= reps) { weights += 5lb }
if (completedReps >= reps) { weights[*] += 5lb } else { weights[*] -= 5lb }
if (true) { 1 }
if (1 > 2) { 1 } else if (2 > 1) { 5 }
if (print(0)) { 1 } else { 2 }
1 ? 2 : 3
0 ? 2 : 3
reps ? 1 : 2
reps > 100 ? 1 : 2
(1 > 2) ? 5lb : 6lb
1 > 2 ? 5 : 6
1 ? 2 ? 3 : 4 : 5
for (var.i in reps) { print(var.i) }
for (var.i in reps) { var.x = var.i * 2 }
for (var.i in reps) { reps[var.i] = var.i }
for (var.i in reps) { weights[var.i] = completedWeights[var.i] + 5lb }
for (var.i in completedReps) { if (completedReps[var.i] > 4) { reps[var.i] += 1 } }
for (var.i in weights) { weights[var.i] = weights[var.i] + 5 }
for (var.i in 5) { print(var.i) }
for (var.i in reps) { }
for (var.i in reps) { var.i += 1 }
for (var.i in reps) { var.j = var.i } var.j
for (var.i in reps) { var.i } var.i
var.i
var.x = 5
var.x = 5; var.x
var.x = 5 var.x += 3
var.x = 5 var.x -= 3
var.x = 5 var.x *= 3
var.x = 5 var.x /= 2
var.x = 5 var.x /= 0
var.x = 5lb var.x += 5
var.x = 5lb var.x += 5%
var.x = 50% var.x += 5lb
var.x = reps var.x
var.x = completedReps > reps var.x
var.x = (1 > 2) var.x
var.x = true var.x
var.x = rm1 var.x
var.x = !1 var.x
var.x += 1
var.x = 1 var.x = var.x + 1 var.x = var.x + 1 var.x
var.a = 1 var.b = var.a + 1 var.b
var.a = 5 var.a %= 2
state.a
state.a = 5
state.a += 5
state.a -= 5
state.a *= 5
state.a /= 5
state.a /= 0
state.a %= 5
state.a = 5lb
state.a += 5lb
state.a = 50%
state.a += 50%
state.a = reps
state.a = completedReps > reps
state.a += completedReps > reps
state.a = rm1
state.a = rm1 * 0.9
state.a = weights[1]
state.a = !state.b
state.a = state.b + state.c
state.a = state.a + 1
state.a += state.b
state.a = (state.b)
state.a = state.b > 1
state.a = print(5)
state.a = print()
state.a += print()
state.b
state.zzz
state.zzz = 5
state.zzz += 5
state[1].x
state[1].x = 5
state[1].x += 5
state[1].y += 5lb
state[1].y = 5
state[1].q = 5
state[1].q += 5
state[2].z = 8
state[2].z *= 2
state[2].z = state.a
state[3].x = 5
state[3].x += 5
state[0].x = 5
state[-1].x = 5
state[1.5].x = 5
state[state.a].x = 5
state[reps].x = 5
state[weights[1]].x = 5
state[true].x = 5
state[1 > 2].x = 5
state[(1 > 2)].x = 5
state[1].x = state[2].z
state[1].x = reps
state[1].x = completedReps > reps
state[2].z = 1 > 2
state[2].z += 1 > 2
state[2].z += reps
state[2].z += print()
state[1].x = rm1 state[1].y = rm1
state[1].x = 5 state[1].x
state[1]
state[1].x == 1
statement
state
state.
state.a state.b state.c
state.a = 1 state.b = 2 state.c = 3 state.a + state.b + state.c
state.a > 1 && state.b > 1
state.a > 1 || state.b > 1
state.a == state.b
state.b > 100lb
state.b > 100
state.b + 5lb
state.b * 2
state.b * 50%
state.c * rm1
state.c + 5lb
sum(state.a, state.b)
max(state.a, state.b)
min(state.a, state.b, state.c)
floor(state.a)
roundWeight(state.a)
roundWeight(state.b)
roundWeight(state.c)
increment(state.a)
increment(state.b)
increment(state.c)
decrement(state.b)
rm1 = state.b
rm1 += state.b
rm1 += state.a
weights = state.b
weights += state.b
weights *= state.a
weights[1] = state.c
weights[*] = state.b
weights = state.c
reps = state.a
reps += state.a
reps = state.b
reps = state.c
RPE = state.a
timers = state.a
numberOfSets = state.a
numberOfSets += state.a
numberOfSets = state.b
reps[state.a] = 1
reps[state.a]
reps[state.b]
reps[state.c]
reps[1lb]
reps[50%]
reps[true]
reps[1 > 2]
reps[1 > 0]
reps[(1)]
reps[1 + 1]
reps[reps]
reps[weights]
reps[reps[1]]
reps[*] = reps[1] + 1
reps[1] = reps[*]
foo(1)
floor()
floor(1, 2)
floor(true)
floor(reps)
floor(1 > 2)
floor(weights)
floor(weights[1])
floor(state.a)
floor(rm1)
floor(bodyweight)
roundWeight(reps)
roundWeight(50%)
roundWeight(true)
roundWeight(1 > 2)
roundWeight()
roundWeight(1, 2)
roundWeight(print())
roundWeight(bodyweight)
roundWeight(readiness)
roundWeight(day)
roundWeight(week)
calculateTrainingMax(300lb)
calculateTrainingMax(300lb, 5lb)
calculateTrainingMax(300lb, 50%)
calculateTrainingMax(50%, 5)
calculateTrainingMax(300lb, 5, 3)
calculate1RM(reps, 5)
calculate1RM(weights[1], reps[1])
calculate1RM(completedWeights[1], completedReps[1])
calculate1RM(completedWeights[3], completedReps[3])
rpeMultiplier(5lb, 8lb)
rpeMultiplier(5%, 8)
rpeMultiplier(5, 8%)
rpeMultiplier(reps, 8)
rpeMultiplier(5, RPE)
rpeMultiplier(5, RPE[1], 3)
zeroOrGte(1lb, reps)
zeroOrGte(reps, 5)
zeroOrGte(reps, 5lb)
zeroOrGte(reps, 50%)
zeroOrGte(originalWeights, weights)
zeroOrGte(reps, originalWeights)
zeroOrGte(reps, weights)
zeroOrGte(isCompleted, reps)
sum(true, 1)
sum(true)
sum(false, 2, 3)
sum(1 > 2, 3)
sum(reps, true)
sum(originalWeights)
sum(weights, 5)
sum(weights, 5lb)
sum(weights, 5%)
sum(reps, 5%)
sum(reps, rm1)
sum(minReps)
sum(RPE)
sum(timers)
min(reps, 1)
min(minReps)
min(RPE)
max(RPE)
max(timers)
max(completedReps)
max(completedWeights)
max(completedReps, 5)
max(originalWeights)
max(1, 1lb)
min(1, 1lb)
min(10%, 5)
max(10%, 5%)
max(5%, 10lb)
print(reps[1], reps[2])
print(true)
print(1 > 2)
print(true, false)
print(rm1)
print(state.a)
print(minReps)
print(RPE)
print(originalWeights)
print(print(1))
print(print())
print(5) + 5
print(5lb) + 5
print(5lb) + 5lb
print(5%) + 5lb
print(5%) + 5
print(reps) + 5
print(reps)[1]
sets(1, 3, 5, 8)
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) sets(4, 5, 3, 3, 0, 150lb, 0, 0, 0)
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) reps
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) weights
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) minReps
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) RPE
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) amraps
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) timers
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) w
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) r
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) mr
sets(1, 3, 5, 8, 1, 100lb, 90, 8, 1) originalWeights
sets(1, 3, 5, 5, 0, 100lb, 0, 0, 0) mr
sets(1, 3, 5, 5, 0, 100lb, 0, 0, 0) minReps
sets(1, 3, 5, 5, 0, 100lb, 0, 0, 0) logrpes
sets(1, 5, 5, 5, 0, 80%, 0, 0, 0) weights
sets(1, 5, 5, 5, 0, 80%, 0, 0, 0) originalWeights
sets(1, 5, 5, 5, 0, 80%, 0, 0, 0) w
sets(1, 5, 5, 5, 0, 105.3, 0, 0, 0) weights
sets(1, 5, 5, 5, 0, 105.3kg, 0, 0, 0) weights
sets(1, 5, 5, 5, 0, 105.3kg, 0, 0, 0) originalWeights
numberOfSets = 3 sets(1, 5, 5, 5, 0, 105.3, 0, 0, 0) weights
numberOfSets = 7 reps
numberOfSets = 7 weights
numberOfSets = 7 originalWeights
numberOfSets = 7 w
numberOfSets = 7 r
numberOfSets = 7 mr
numberOfSets = 7 cr
numberOfSets = 7 cw
numberOfSets = 7 minReps
numberOfSets = 7 RPE
numberOfSets = 7 timers
numberOfSets = 7 amraps
numberOfSets = 7 completedReps
numberOfSets = 7 isCompleted
numberOfSets = 7 numberOfSets
numberOfSets = 7 ns
numberOfSets = 3 reps
numberOfSets = 3 weights
numberOfSets = 3 w
numberOfSets = 3 completedReps
numberOfSets = 3 isCompleted
numberOfSets = 3 reps[3]
numberOfSets = 3 reps[4]
numberOfSets = 3 reps[1] = 9 r
numberOfSets = 3 reps[1] = 9 reps
numberOfSets = 3 weights[1] = 9lb w
reps[1] = 9 r
reps[1] = 9 r[1]
reps[1] = 9 reps
reps[*] = 9 r
reps[*] = 9 mr
minReps[1] = 9 mr
minReps[1] = 9 minReps
minReps[2] = 9 mr[2]
weights[1] = 99lb w
weights[1] = 99lb w[1]
weights[1] = 99lb weights[1]
weights[1] = 99lb originalWeights[1]
weights[1] = 99lb originalWeights
weights[*] = 99 w
weights[3] = 99lb w
weights[1] = 99 weights[1]
weights[2] += 2.5kg weights[2]
weights[2] *= 2 weights[2]
weights[2] /= 3 weights[2]
weights[2] *= 1.05 weights[2]
weights[2] = 50% weights[2]
weights[2] = 50% originalWeights[2]
weights = rm1 weights
weights = rm1 * 0.9 weights
weights = completedWeights[1] weights
weights = completedWeights weights
weights = weights[1] + 10 weights
weights = weights + 10 weights
weights += weights[1] weights
weights += reps weights
weights += [] weights
weights = reps > 5 weights
weights = true weights
weights = (1 > 2) weights
weights = print(5) weights
weights = print() weights
reps = print() reps
reps = reps > 5 reps
reps = true reps
reps = 1 > 2 reps
reps = weights reps
reps = weights[1] reps
reps = rm1 reps
reps = 5lb reps
reps = 50% reps
reps = state.b reps
reps = reps reps
reps = 2 reps
reps = 1.5 reps
reps = -1 reps
reps = 0 reps
reps = 1e9 reps
reps /= 0 reps
reps %= 2 reps
RPE = 5.3 RPE
RPE = 5.25 RPE
RPE = 5.75 RPE
RPE = 11 RPE
RPE = -1 RPE
RPE += 0.3 RPE
RPE -= 20 RPE
RPE *= 2 RPE
RPE /= 3 RPE
RPE = 0 RPE
RPE = 0.2 RPE
RPE = 0.25 RPE
RPE = 0.26 RPE
RPE = reps RPE
amraps = 0.4 amraps
amraps = 0.5 amraps
amraps = 0.6 amraps
amraps = 2 amraps
amraps = -1 amraps
amraps += 1 amraps
amraps -= 1 amraps
amraps *= 2 amraps
amraps /= 2 amraps
logrpes = 0.5 logrpes
logrpes[3] = 1 logrpes
askweights = 1 askweights
askweights[4] = 0 askweights
timers = -5 timers
timers = 0 timers
timers = 1.5 timers
timers += 5 timers
timers *= 2 timers
timers[1] = 10 timers
setTime = 10 setTime
setTime[2] = 10 setTime
setTime += 10 setTime
setTime *= 2 setTime
minReps = 0 minReps
minReps = 0 mr
minReps = reps minReps
minReps += 1 minReps
minReps *= 2 minReps
minReps *= 2 mr
{~ reps = 5 weights = 100lb RPE = 8 ~}
{~ if (completedReps >= reps) { weights += 5lb } else { weights -= 5lb } ~}
{~ weights = completedWeights[1] + 5lb reps = completedReps[1] + 1 ~}
{~ for (var.i in reps) { if (completedReps[var.i] >= reps[var.i]) { weights[var.i] += 5lb } } ~}
{~ var.s = sum(completedReps) if (var.s > 20) { state.a += 1 } else { state.a = 0 } ~}
{~ state.a = sum(completedReps) / numberOfSets ~}
{~ state.b += 5lb weights += state.b ~}
{~ state.b += 5lb weights = state.b ~}
{~ state.b *= 1.1 roundWeight(state.b) ~}
{~ state.b = roundWeight(state.b * 1.1) ~}
{~ rm1 = calculate1RM(completedWeights[1], completedReps[1]) ~}
{~ rm1 = calculate1RM(completedWeights[3], completedReps[3]) ~}
{~ var.tm = calculateTrainingMax(rm1, 1) weights = var.tm * 0.8 ~}
{~ sets(1, 3, 5, 5, 0, 80%, 0, 0, 0) sets(4, 5, 3, 3, 1, 90%, 0, 0, 0) ~}
{~ numberOfSets = numberOfSets + 1 reps[numberOfSets] = 8 ~}
{~ numberOfSets = 2 numberOfSets = 4 ~}
{~ numberOfSets = 2 reps[1] = 3 numberOfSets = 4 reps ~}
{~ numberOfSets -= 1 numberOfSets ~}
{~ numberOfSets -= 1 weights ~}
{~ numberOfSets += 1 weights ~}
{~ numberOfSets += 1 w ~}
{~ numberOfSets += 1 reps ~}
{~ numberOfSets += 1 r ~}
{~ numberOfSets += 1 originalWeights ~}
{~ numberOfSets += 2 completedReps ~}
{~ numberOfSets = 0 weights ~}
{~ numberOfSets = 0 w ~}
{~ numberOfSets += 3 weights[7] ~}
{~ numberOfSets += 3 originalWeights[7] ~}
{~ numberOfSets += 3 print(weights, originalWeights, reps, minReps, RPE) ~}
{~ numberOfSets += 3 print(timers, amraps, askweights, logrpes, isCompleted, completedReps, cr, cw) ~}
{~ numberOfSets = (numberOfSets = 2) + 1 ~}
{~ numberOfSets = 3 numberOfSets = 3 ~}
{~ numberOfSets *= 0.5 ~}
{~ numberOfSets -= 0.5 weights ~}
{~ numberOfSets = -2 weights ~}
{~ numberOfSets = -2 w ~}
{~ numberOfSets = -2 numberOfSets ~}
{~ numberOfSets = -0.5 numberOfSets ~}
{~ numberOfSets = 1e3 numberOfSets ~}
{~ numberOfSets = 1000 numberOfSets ~}
{~ numberOfSets = 10 reps ~}
{~ weights[1] = 1 weights[2] = 2 weights[3] = 3 weights ~}
{~ weights[1] = 1lb weights[3] = 3lb weights ~}
{~ weights[1] = reps[1] weights[2] = reps[2] ~}
{~ weights[*] = weights[1] + 5lb ~}
{~ weights[1] = (weights[1] = 5lb) + 5lb ~}
{~ reps[*] = (reps[1] = 5) + 1 ~}
{~ reps[1] = (reps[1] += 1) + 1 reps ~}
{~ reps = reps[1] reps ~}
{~ rm1 = rm1 + 5lb rm1 ~}
{~ rm1 = (rm1 = 5) rm1 ~}
{~ rm1 += (rm1 = 5) ~}
{~ weights = weights + (rm1 = 150lb) weights ~}
{~ var.a = (var.a = 3) + 1 var.a ~}
{~ state.a = (state.a = 3) + 1 state.a ~}
{~ state.a += (state.a += 3) + 1 state.a ~}
{~ state[1].x += (state[1].x += 3) state[1].x ~}
{~ var.a = 1 state[var.a].x = 5 ~}
{~ var.a = 1 state[var.a].x += 5 ~}
{~ var.a = 2 state[var.a].z += 5 ~}
{~ for (var.i in reps) { state[1].x += var.i } ~}
{~ for (var.i in reps) { state.a += reps[var.i] } ~}
{~ for (var.i in reps) { for (var.j in reps) { var.t += 1 } } ~}
{~ for (var.i in reps) { for (var.j in reps) { var.t = var.i * var.j } } var.t ~}
{~ for (var.i in reps) { if (var.i > 2) { var.t = 1 } } var.t ~}
{~ for (var.i in [1]) { } ~}
// comment
1 // trailing
// only comment
/* block */ 1
1 /* block */
reps[1] = 3 // set
reps[1] = 3 // set\nreps[2] = 4 // second
{~ // c\n reps = 3 ~}
{~ reps = 3 // c\n ~}
{~\n// c\nreps = 3\n// d\nweights = 5lb\n~}
reps = 3\nreps = 4\nzzz = 5
reps = 3\n\nreps = 4\n\n\nfoo
\nfoo
\n\nfoo = 1
 foo
\tfoo
reps =\n3
reps\n= 3
reps[\n1\n] = 3
sum(\nreps,\n zzz\n)
foo(\n1\n)
floor(\ntrue\n)
floor(\n\n\nreps\n)
roundWeight(\nreps\n)
state.a +\nstate.zzz
1 +\n\n state.zzz
state.zzz\n+ 1
\n\n\nstate.zzz
é + 1
// é\nfoo
// 日本語\nfoo
1 + 日本語
/* é */ foo
reps = "é"
"abc"
'abc'
# 1
1 # 2
1 @ 2
1 & 2
1 | 2
1 ^ 2
1 ** 2
1 << 2
~1
1 ~ 2
1 = 2
1 += 2
1 -= 2
reps =
reps +=
= 3
+= 3
reps == 3
reps = = 3
reps = 3 = 4
reps[1] [2]
reps[1][2]
reps[1:2:3]
reps[]
reps[ ]
reps[*:*]
reps[**]
reps[_]
reps[1] = _
weights[_] = 5
weights[_]
reps[1,2]
reps[1;2]
reps(1)
reps.1
reps.length
reps[1].x
state.x.y
state..x
state.1
state.x[1]
state[1][2].x
state[1,2].x
state[*].x
state[_].x
state[1:2].x
state[].x
state[ 1 ] . x
state . x
var
var.
var..x
var.1
var.x.y
var.x[1]
var.x(1)
var[1]
var.x = 1 var.x[1]
var.x = reps var.x[1]
var.x = reps var.x[0]
var.x = reps var.x[1] var.x[2]
for (var.i in reps) { var.i[1] }
for (i in reps) { }
for (var.i of reps) { }
for (var.i in reps)
for (var.i in reps) {
for var.i in reps { }
for (var.i in reps) { } else { }
for (var.i in reps) { break }
for (var.i in reps; var.i < 3) { }
for (var.i in 1 + 1) { }
for (var.i in reps + 1) { }
for (var.i in (reps)) { }
for (var.i in ((reps))) { print(var.i) }
for (var.i in reps) var.x = 1
for (var.i in reps) { var.x = 1 } var.x
for (var.i in reps) { var.x = var.i } for (var.i in reps) { var.x += var.i } var.x
for (var.i in weights) { print(weights[var.i]) }
for (var.i in minReps) { print(minReps[var.i]) }
for (var.i in originalWeights) { print(originalWeights[var.i]) }
for (var.i in isCompleted) { print(isCompleted[var.i]) }
for (var.i in RPE) { print(RPE[var.i]) }
for (var.i in timers) { print(timers[var.i]) }
for (var.i in completedReps) { print(completedReps[var.i]) }
for (var.i in cr) { print(cr[var.i]) }
for (var.i in numberOfSets) { }
for (var.i in rm1) { }
for (var.i in state.a) { }
for (var.i in 1 > 2) { }
for (var.i in sum(reps)) { }
for (var.i in print(reps)) { print(var.i) }
for (var.i in print(1)) { }
if
if ()
if () {}
if (1)
if (1) {
if (1) { } else
if (1) { } else {
if (1) { } else if
if (1) { } else if (2)
if (1) { } else if (2) { }
if (1) { } else if (2) { } else { }
if 1 { }
if (1) 2
if (1) { 2 } 3
if (1) { 2 } else { 3 } + 1
if (1) { 2 } else { 3 } if (0) { 4 }
if (reps) { 1 }
if (reps[1]) { 1 }
if (weights) { 1 } else { 2 }
if (rm1) { 1 } else { 2 }
if (0lb) { 1 } else { 2 }
if (0%) { 1 } else { 2 }
if (NaN) { 1 } else { 2 }
if (1 > 2 || 2 > 1) { 1 }
if (!reps) { 1 } else { 2 }
if (!!reps) { 1 } else { 2 }
if (print(0)) { 1 }
if (print()) { 1 } else { 2 }
if (print(1)) { 1 }
if (state.a) { 1 } else { 2 }
if (state.b) { 1 } else { 2 }
if (state.a > 1) { state.a = 0 } else if (state.a == 1) { state.a = 5 } else { state.a = 9 }
if (reps > 3) { reps = 5 } else if (reps > 2) { reps = 4 }
if (completedReps >= reps) { weights += 5lb } else if (completedReps >= minReps) { weights += 0 } else { weights -= 10% }
{~
  if (completedReps >= reps) {
    weights += state.b
    state.a = 0
  } else {
    state.a += 1
    if (state.a >= 3) {
      weights *= 0.9
      state.a = 0
    }
  }
~}
{~
  var.a = completedReps[1]
  var.b = completedReps[2]
  var.c = var.a + var.b
  weights[var.c] = 5lb
~}
{~
  for (var.i in completedReps) {
    if (var.i == numberOfSets) {
      reps[var.i] = completedReps[var.i] + 2
    }
  }
~}
{~
  for (var.i in completedReps) {
    if (completedReps[var.i] >= reps[var.i]) {
      weights[var.i] = completedWeights[var.i] + 5lb
    } else {
      weights[var.i] = completedWeights[var.i] - 5lb
    }
  }
~}
`.split("\n");
add("`abc`");
// join multi-line braces blocks: lines starting with "{~" and not ending with "~}" run to the next "~}" line
{
  const joined: string[] = [];
  let buf: string[] | null = null;
  for (const line of hand) {
    if (buf) {
      buf.push(line);
      if (line.trim() === "~}") {
        joined.push(buf.join("\n"));
        buf = null;
      }
    } else if (line.startsWith("{~") && !line.trimEnd().endsWith("~}")) {
      buf = [line];
    } else if (line.trim() !== "") {
      joined.push(line.replace(/\\n/g, "\n").replace(/\\t/g, "\t"));
    }
  }
  for (const s of joined) add(s);
}

// ---- execution
type Variant = { mode: "planner" | "update"; fixture: string; state: "num" | "wt"; type: string | null };
const variants: Variant[] = [
  { mode: "planner", fixture: "full", state: "num", type: null },
  { mode: "planner", fixture: "fullSeparate", state: "wt", type: null },
  { mode: "planner", fixture: "empty", state: "num", type: null },
  { mode: "update", fixture: "full", state: "num", type: null },
  { mode: "update", fixture: "fullSeparate", state: "wt", type: null },
  { mode: "update", fixture: "empty", state: "wt", type: null },
  { mode: "planner", fixture: "full", state: "wt", type: "weight" },
  { mode: "planner", fixture: "full", state: "num", type: "reps" },
  { mode: "update", fixture: "full", state: "num", type: "rpe" },
  { mode: "update", fixture: "full", state: "wt", type: "timer" },
];

function errOut(e: unknown) {
  if (e instanceof LiftoscriptSyntaxError) {
    return { message: e.message, line: e.line, offset: e.offset, from: e.from, to: e.to, details: clean(e.details) };
  }
  return { crash: String(e) };
}

function hasErrorNode(script: string): boolean {
  const cur = LiftoscriptParser.parse(script).cursor();
  do {
    if (cur.node.type.isError) return true;
  } while (cur.next());
  return false;
}

function changedKeys(before: Any, after: Any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const b = clean(before) as Any;
  const a = clean(after) as Any;
  for (const k of Object.keys(a)) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = a[k];
  }
  return out;
}

const execCases: unknown[] = [];
for (const script of corpus) {
  const hasError = hasErrorNode(script);
  // the fuzz scripts are mostly invalid, two variants per mode are enough
  for (const [vi, v] of variants.entries()) {
    if (fuzzScripts.has(script) && vi !== 0 && vi !== 3) continue;
    const state = stateFor(script, v.state) as Any;
    const otherStates = JSON.parse(JSON.stringify(otherStatesFixture));
    const bindings = fixtureMakers[v.fixture]();
    const before = JSON.parse(JSON.stringify(bindings));
    const exerciseType = { id: "squat", equipment: "barbell" };
    const context = { exerciseType, unit: settings.units, prints: [] as Any[] };
    const runner = new ScriptRunner(
      script,
      state,
      otherStates,
      bindings,
      Progress_createScriptFunctions(settings),
      settings.units,
      context,
      v.mode,
    );
    const stateBefore = clean(state);
    let result: unknown;
    let error: unknown;
    try {
      const r = runner.execute((v.type ?? undefined) as Any);
      result = clean(r);
      if (typeof r === "boolean") result = { bool: r };
    } catch (e) {
      error = errOut(e);
    }
    execCases.push({
      script,
      hasError,
      mode: v.mode,
      fixture: v.fixture,
      stateVariant: v.state,
      type: v.type,
      state: stateBefore,
      result,
      error,
      updates: error ? null : clean(runner.getUpdates()),
      stateAfter: clean(state),
      otherStatesAfter: clean(otherStates),
      bindingsDiff: changedKeys(before, bindings),
      prints: clean(JSON.parse(JSON.stringify(context.prints, (_k, x) => (typeof x === "boolean" ? (x ? 1 : 0) : x)))),
    });
  }
}

// ---- static helpers over the corpus
const helperCases: unknown[] = [];
for (const script of corpus) {
  const state = stateFor(script, "num") as Any;
  const mk = () => new ScriptRunner(
    script,
    JSON.parse(JSON.stringify(state)),
    {},
    Progress_createEmptyScriptBindings(dayData, settings),
    Progress_createScriptFunctions(settings),
    settings.units,
    { unit: settings.units, prints: [] },
    "planner",
  );
  const rec: Record<string, unknown> = { script, hasError: hasErrorNode(script), state: clean(state) };
  try {
    rec.stateKeys = Array.from(mk().getStateVariableKeys());
  } catch (e) {
    rec.stateKeysError = errOut(e);
  }
  for (const unit of ["kg", "lb"]) {
    try {
      rec["switch_" + unit] = mk().switchWeightsToUnit(unit as Any);
    } catch (e) {
      rec["switch_" + unit + "_error"] = errOut(e);
    }
  }
  rec.changeWeights = LiftoscriptEvaluator.changeWeightsToCompleteWeights(script);
  rec.hasKeywordWeights = ScriptRunner.hasKeyword(script, "weights");
  rec.hasKeywordReps = ScriptRunner.hasKeyword(script, "reps");
  rec.hasStateA = ScriptRunner.hasStateVariable(script, "a");
  rec.hasStateFailed = ScriptRunner.hasStateVariable(script, "failed");
  const v = ScriptRunner.isValid(script, state, dayData, settings, { id: "squat", equipment: "barbell" });
  rec.isValid = v ? errOut(v) : null;
  helperCases.push(rec);
}

// ---- applyBindings / getNextEntry
const applyCases: unknown[] = [];
{
  const scripts = [
    "reps[1] = 9",
    "numberOfSets = 3",
    "numberOfSets = 8",
    "weights[*] += 5lb",
    "RPE = 8",
    "amraps[2] = 1",
    "timers = 45",
    "timers = -1",
    "minReps = 0",
    "sets(1, 7, 5, 8, 1, 100lb, 90, 8, 1) numberOfSets = 7",
    "numberOfSets = 7 weights[6] = 200lb originalWeights[6]",
    "askweights = 1",
    "logrpes[1] = 1",
    "setTime = 30",
    "numberOfSets = 0",
    "numberOfSets = 2.5",
  ];
  for (const script of scripts) {
    for (const fx of ["full", "empty"]) {
      const bindings = fixtureMakers[fx]();
      const context = { exerciseType: { id: "squat", equipment: "barbell" }, unit: settings.units, prints: [] as Any[] };
      const state = {};
      let error: unknown = null;
      let newEntry: unknown = null;
      try {
        new ScriptRunner(script, state, {}, bindings, Progress_createScriptFunctions(settings), settings.units, context, "update").execute();
        newEntry = clean(Progress_applyBindings(entry as Any, bindings, settings));
      } catch (e) {
        error = errOut(e);
      }
      applyCases.push({ script, fixture: fx, entry, bindings: fixtures[fx].bindings, aliased: fixtures[fx].aliased, newEntry, error });
    }
  }
}

const mkEntry = (id: string, done: boolean[], superset?: string) => ({
  vtype: "history_entry",
  exercise: { id, equipment: "barbell" },
  sets: done.map((d, i) => ({ vtype: "set", id: `${id}${i}`, index: i, reps: 5, isCompleted: d, completedReps: d ? 5 : undefined, askWeight: false, isUnilateral: false })),
  warmupSets: [],
  index: 0,
  id,
  superset,
});
const records: Record<string, Any> = {
  plain: [mkEntry("a", [true, true]), mkEntry("b", [true, false]), mkEntry("c", [false, false])],
  allDone: [mkEntry("a", [true]), mkEntry("b", [true])],
  superset: [mkEntry("a", [true, false], "s1"), mkEntry("b", [false, false], "s1"), mkEntry("c", [false], "s2"), mkEntry("d", [true, true])],
  supersetDone: [mkEntry("a", [true], "s1"), mkEntry("b", [true], "s1"), mkEntry("c", [false])],
  lonelySuperset: [mkEntry("a", [false], "s1"), mkEntry("b", [false])],
  empty: [],
};
const nextCases: unknown[] = [];
for (const [name, entries] of Object.entries(records)) {
  const progress = { vtype: "progress", date: "2024-01-01", programId: "p", programName: "P", day: 1, dayName: "D", entries, startTime: 0, id: 1 };
  const targets = entries.length > 0 ? entries.map((_: unknown, i: number) => i) : [-1];
  for (const mode of ["workout", "warmup"] as const) {
    for (const go of [true, false]) {
      for (const idx of targets) {
        const e = idx === -1 ? mkEntry("zzz", [false]) : entries[idx];
        const r = Progress_getNextEntry(progress as Any, e, mode, go);
        nextCases.push({ record: name, entries, mode, go, entryIndex: idx, foreign: idx === -1, result: r ? entries.findIndex((x: Any) => x === r) : null });
      }
    }
  }
}

// ---- programSet
import * as PS from "../../../../packages/liftoscript/src/models/programSet.ts";
const programSetCases: unknown[] = [];
{
  const ps = (reps: string, weight: string, extra: Record<string, unknown> = {}) => ({ repsExpr: reps, weightExpr: weight, ...extra });
  const groups = [
    [],
    [ps("5", "100lb")],
    [ps("5", "100lb"), ps("5", "100lb"), ps("3", "100lb"), ps("3", "100lb", { isAmrap: true }), ps("3", "100lb", { isAmrap: true })],
    [ps("5", "100lb"), ps("5", "100lb", { isAmrap: false }), ps("5", "100lb", { rpeExpr: "8" }), ps("5", "100lb", { rpeExpr: "8", logRpe: true })],
    [ps("5", "100lb", { label: "a" }), ps("5", "100lb", { label: "b" })],
  ];
  for (const g of groups) programSetCases.push({ fn: "group", args: [g], out: clean(PS.ProgramSet_group(g as Any)) });
  for (const reps of [undefined, 0, 1, 5, 12.5]) {
    for (const rest of [0, 30, 90.5]) {
      programSetCases.push({ fn: "approxSetTimeMs", args: [reps ?? null, rest], out: PS.ProgramSet_approxSetTimeMs(reps, rest) });
    }
  }
  for (const timer of [undefined, 0, 45]) {
    for (const sup of [undefined, 0, 20]) {
      programSetCases.push({ fn: "approxRestTimer", args: [timer ?? null, 90, sup ?? null], out: PS.ProgramSet_approxRestTimer({ timer } as Any, 90, sup) });
    }
  }
  const evalSets = [
    { maxrep: 5, minrep: 5, weight: w(100), logRpe: false, isAmrap: false, isQuickAddSet: false, askWeight: false },
    { maxrep: 8, weight: { value: 75, unit: "%" }, rpe: 8, logRpe: false, isAmrap: false, isQuickAddSet: false, askWeight: false },
    { maxrep: 5, rpe: 8, logRpe: false, isAmrap: false, isQuickAddSet: false, askWeight: false },
    { maxrep: 3, rpe: 9.5, timer: 120, logRpe: false, isAmrap: true, isQuickAddSet: false, askWeight: false },
    { rpe: 8, logRpe: false, isAmrap: false, isQuickAddSet: false, askWeight: false },
    { maxrep: 5, logRpe: false, isAmrap: false, isQuickAddSet: false, askWeight: false },
    { weight: { value: 50, unit: "%" }, logRpe: false, isAmrap: false, isQuickAddSet: false, askWeight: false },
    { maxrep: 5, weight: w(60, "kg"), timer: 0, logRpe: false, isAmrap: false, isQuickAddSet: false, askWeight: false },
  ];
  const settingsVariants: Record<string, Any> = {
    base: settings,
    kg: { ...settings, units: "kg" },
    timers: { ...settings, timers: { workout: 60, superset: 25 } },
    timersNull: { ...settings, timers: { workout: null } },
    timersZero: { ...settings, timers: { workout: 0, superset: 0 } },
  };
  for (const [sname, st] of Object.entries(settingsVariants)) {
    for (const set of evalSets) {
      for (const sup of [false, true]) {
        programSetCases.push({ fn: "approxTimeMs", settings: sname, args: [set, sup], out: PS.ProgramSet_approxTimeMs(set as Any, st, sup) });
      }
      programSetCases.push({ fn: "isEligibleForInferredWeight", args: [set], out: PS.ProgramSet_isEligibleForInferredWeight(set as Any) });
      for (const ex of [{ id: "squat", equipment: "barbell" }, { id: "benchPress", equipment: "barbell" }, { id: "bicepCurl", equipment: "dumbbell" }, { id: "deadlift" }, { id: "legPress", equipment: "machine" }]) {
        programSetCases.push({ fn: "getEvaluatedWeight", settings: sname, args: [set, ex], out: clean(PS.ProgramSet_getEvaluatedWeight(set as Any, ex as Any, st)) });
      }
    }
  }
  var settingsVariantsOut = Object.fromEntries(Object.entries(settingsVariants).map(([k, v]) => [k, v]));
}

Deno.writeTextFileSync(
  dir + "cases_script_eval.json",
  JSON.stringify({ fixtures, dayData, entry, programSet: programSetCases, programSetSettings: settingsVariantsOut, exec: execCases, helpers: helperCases, apply: applyCases, next: nextCases, records }) + "\n",
);
console.log("exec", execCases.length, "helpers", helperCases.length, "apply", applyCases.length, "next", nextCases.length);
