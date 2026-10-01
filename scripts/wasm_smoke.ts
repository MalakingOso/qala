// Smoke test for the wasm build of qala-lspp-wasm. Run `deno task build:wasm` first.
// Checks the exported JSON entry points against testdata/golden/liftoscript, with the same
// normalizations as crates/qala-lspp/tests/golden.rs.
import * as q from "../target/wasm-out/deno/qala_lspp_wasm.js";

type J = unknown;
const golden = (f: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`../testdata/golden/liftoscript/${f}`, import.meta.url)));

const isObj = (v: J): v is Record<string, J> => typeof v === "object" && v !== null && !Array.isArray(v);

function unordered(m: Record<string, J>): boolean {
  return m.vtype === "set" || m.vtype === "history_entry" || ("isQuickAddSet" in m && "askWeight" in m);
}

function normExpected(v: J): J {
  if (v === "NaN" || v === "Infinity" || v === "-Infinity") return null;
  if (Array.isArray(v)) return v.map(normExpected);
  if (isObj(v)) {
    const o: Record<string, J> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "liftoscriptNode" && k !== "$error") o[k] = normExpected(x);
    return o;
  }
  return v;
}

function normActual(v: J): J {
  if (Array.isArray(v)) return v.map(normActual);
  if (isObj(v)) {
    const o: Record<string, J> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "liftoscriptNode") continue;
      o[k] = k === "stateKeys" && Array.isArray(x) ? {} : normActual(x);
    }
    return o;
  }
  return v;
}

function pruneReuse(v: J, inReuse: boolean): J {
  if (Array.isArray(v)) return v.map((x) => pruneReuse(x, inReuse));
  if (isObj(v)) {
    const o: Record<string, J> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "reuse") {
        if (!inReuse) o[k] = pruneReuse(x, true);
      } else o[k] = pruneReuse(x, inReuse);
    }
    return o;
  }
  return v;
}

function diff(a: J, e: J, path: string): string | null {
  if (e === "<uid>") return typeof a === "string" && a.length > 0 ? null : `${path}: expected an id, got ${JSON.stringify(a)}`;
  if (Array.isArray(e)) {
    if (!Array.isArray(a) || a.length !== e.length) return `${path}: array length`;
    for (let i = 0; i < e.length; i++) {
      const d = diff(a[i], e[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (isObj(e)) {
    if (!isObj(a)) return `${path}: expected object`;
    const ak = Object.keys(a), ek = Object.keys(e);
    if (unordered(e)) {
      if ([...ak].sort().join() !== [...ek].sort().join()) return `${path}: keys differ`;
    } else if (ak.join() !== ek.join()) return `${path}: key order ${ak} vs ${ek}`;
    for (const k of ek) {
      const d = diff(a[k], e[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, e) || a === e ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(e)}`;
}

function check(what: string, envelope: string, expected: J) {
  const env = JSON.parse(envelope);
  if (env.v !== 1 || "error" in env) throw new Error(`${what}: bad envelope ${envelope.slice(0, 300)}`);
  let exp = normExpected(expected), act = normActual(env.result);
  if (isObj(expected) && "$pruned" in expected) {
    exp = normExpected(expected.value);
    act = pruneReuse(act, false);
  }
  const d = diff(act, exp, "$");
  if (d) throw new Error(`${what}: ${d}`);
  console.log(`ok   ${what}`);
}

function request(doc: any, c: any): string {
  const o: Record<string, J> = { v: 1 };
  for (const [k, v] of Object.entries(c.inputs as Record<string, J>)) {
    if (k === "programRef") o.program = doc.fixtures.programs[v as string];
    else if (k === "settingsRef") o.settings = doc.fixtures.settings[v as string];
    else o[k] = v;
  }
  return JSON.stringify(o);
}

// 1. gzclp evaluation
{
  const doc = golden("builtins/gzclp.json");
  const c = doc.cases.find((x: any) => x.fn === "forceEvaluateText");
  check("forceEvaluateText gzclp", q.forceEvaluateText(request(doc, c)), c.output);
}
// 2. finish day
{
  const doc = golden("finish_day.json");
  const c = doc.cases.find((x: any) => x.fn === "runAllFinishDayScripts");
  check(`runAllFinishDayScripts ${c.name}`, q.runAllFinishDayScripts(request(doc, c)), c.output);
}
// 3. diagnostics
{
  const bad = JSON.parse(q.diagnosePlanner("Squat / 3x"));
  if (bad.v !== 1 || !Array.isArray(bad.result) || bad.result.length === 0) throw new Error("diagnosePlanner found nothing");
  for (const d of bad.result) {
    if (!(d.from < d.to) || typeof d.message !== "string") throw new Error("bad diagnostic");
    if (!(d.line >= 1) || !(d.col >= 1) || typeof d.suggestion !== "string") throw new Error("diagnostic lacks line, col or suggestion");
  }
  const clean = JSON.parse(q.diagnosePlanner("# Week 1\n## Day 1\nSquat / 3x5\n"));
  if (clean.result.length !== 0) throw new Error("clean program reported errors");
  const s = JSON.parse(q.diagnoseScript("if (completedReps >= ) { weights += }"));
  if (s.result.length === 0) throw new Error("diagnoseScript found nothing");
  console.log(`ok   diagnosePlanner / diagnoseScript ${JSON.stringify(bad.result)}`);
  const f = JSON.parse(q.formatPlanner("Squat/3x5   100lb"));
  if (!f.result.ok || f.result.text !== "Squat / 3x5 100lb\n" || !f.result.changed) throw new Error("formatPlanner result");
  const fb = JSON.parse(q.formatPlanner("Squat / 3x"));
  if (fb.result.ok || fb.result.diagnostics.length === 0) throw new Error("formatPlanner accepted a syntax error");
  console.log("ok   formatPlanner");
  const lint = JSON.parse(q.lintPlanner("# Week 1\n## Day 1\nSquat / 31x5 100lb\n"));
  if (lint.result.length !== 1 || lint.result[0].code !== "too-many-sets" || lint.result[0].line !== 3) throw new Error("lintPlanner result");
  console.log("ok   lintPlanner");
  const rot = golden("finish_day_rotation_gzclp.json");
  const dry = JSON.parse(q.dryRun(JSON.stringify({
    v: 1,
    program: rot.fixtures.programs.gzclp,
    settings: rot.fixtures.settings.gzclp_settings,
    fromDay: 1,
    sessions: 1,
  })));
  if (dry.error || dry.result.sessions.length !== 1 || dry.result.finalText !== rot.cases[0].output.plannerText) {
    throw new Error("dryRun does not match the rotation golden");
  }
  console.log("ok   dryRun");
}
// 4. errors are values
{
  const e = JSON.parse(q.forceEvaluateText("not json"));
  if (e.v !== 1 || e.error?.kind !== "invalidInput") throw new Error(`error envelope: ${JSON.stringify(e)}`);
  console.log(`ok   malformed request -> ${JSON.stringify(e.error)}`);
}
console.log("wasm smoke passed");
