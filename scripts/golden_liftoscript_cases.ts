// deno-lint-ignore-file no-explicit-any no-unused-vars ban-unused-ignore
// Golden cases for items 2-5: builtins, nextHistoryEntry, finish day, bindings.
//
// Big structures (evaluated programs, settings) live in a per-file `fixtures`
// table and cases refer to them by name (`programRef`, `settingsRef`), so a
// program is stored once per file instead of once per case.
import {
  builtinProgramNames,
  loadBuiltinProgram,
} from "../packages/liftoscript/tests/helpers.ts";
import {
  applyEngineBindings,
  createEngineBindings,
  createScriptBindings,
  createScriptFunctions,
  evaluateQalaProgram,
  Exercise_toKey,
  forceEvaluateText,
  getDay,
  liftoscriptFnSignatures,
  PlannerProgram_evaluateText,
  Program_getProgramDay,
  Program_nextDay,
  Program_nextHistoryEntry,
  Progress_createEmptyScriptBindings,
  qalaExerciseIdToType,
  qalaLiftEntryToHistoryEntry,
  qalaLiftSessionToHistoryRecord,
  qalaSettingsToLiftoscript,
  runAllFinishDayScripts,
  runFinishDayScript,
  runUpdateScriptForEntry,
  Stats_getEmpty,
  Weight_build,
  Weight_is,
} from "../packages/liftoscript/mod.ts";
import { Program_getProgramExerciseForKeyAndDay } from "../packages/liftoscript/src/models/program.ts";
import {
  getLastRaw,
  type IGoldenCase,
  liftSettings,
  makeCase,
  writeGolden,
} from "./golden_liftoscript_lib.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const KG_PROGRAMS = [
  "gzclp.md",
  "starting-strength.md",
  "arnold-split.md",
  "gzcl-uhf-9-weeks.md",
  "sheiko-29-32.md",
];

// ---------------------------------------------------------------------------
// Item 2: builtins
// ---------------------------------------------------------------------------

function stepBuiltins(): void {
  for (const file of builtinProgramNames()) {
    const name = file.replace(/\.md$/, "");
    const text = loadBuiltinProgram(file);
    const settings = liftSettings("lb");
    const cases = [
      makeCase(
        "PlannerProgram_evaluateText",
        "stage_planner",
        { text },
        (i) => PlannerProgram_evaluateText(i.text),
      ),
      makeCase(
        "forceEvaluateText",
        "evaluated",
        { programText: text, name: file, settings },
        (i) => forceEvaluateText(i.programText, i.name, i.settings),
      ),
    ];
    writeGolden(
      `builtins/${name}.json`,
      { version: 1, program: name, cases },
      0,
    );
    if (KG_PROGRAMS.includes(file)) {
      const c = makeCase(
        "forceEvaluateText",
        "evaluated_kg",
        { programText: text, name: file, settings: liftSettings("kg") },
        (i) => forceEvaluateText(i.programText, i.name, i.settings),
      );
      writeGolden(
        `builtins_kg/${name}.json`,
        { version: 1, program: name, cases: [c] },
        0,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures shared by items 3 and 4
// ---------------------------------------------------------------------------

const RM1_BY_ID: Record<string, number> = {
  squat: 200,
  benchPress: 150,
  deadlift: 250,
  overheadPress: 110,
};

/** Settings with 1RMs assigned the way tests/gzclp_test.ts does it. */
function settingsWithRm1(programFile: string, unit: "lb" | "kg" = "lb") {
  const settings = liftSettings(unit);
  const probe = forceEvaluateText(
    loadBuiltinProgram(programFile),
    programFile,
    settings,
  );
  for (const week of probe.weeks) {
    for (const day of week.days) {
      for (const e of day.exercises) {
        if (e.exerciseType != null && RM1_BY_ID[e.exerciseType.id] != null) {
          settings.exerciseData[Exercise_toKey(e.exerciseType)] = {
            rm1: Weight_build(RM1_BY_ID[e.exerciseType.id], unit),
          };
        }
      }
    }
  }
  return settings;
}

interface IFixtures {
  programs: Record<string, unknown>;
  settings: Record<string, unknown>;
}

function evalFixture(file: string, settings: Any): Any {
  // Seeded so program/exercise ids in the fixture are reproducible.
  const c = makeCase(
    "forceEvaluateText",
    "fixture",
    { programText: loadBuiltinProgram(file), name: file, settings },
    (i) => forceEvaluateText(i.programText, i.name, i.settings),
  );
  void c;
  return getLastRaw();
}

function usedExercises(prog: Any, day: number): Any[] {
  const pd = Program_getProgramDay(prog, day);
  return (pd?.exercises ?? []).filter((e: Any) =>
    !e.notused && e.exerciseType != null
  );
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function newEntry(prog: Any, day: number, key: string, settings: Any): Any {
  const p = clone(prog);
  const pd = Program_getProgramDay(p, day)!;
  const pe = Program_getProgramExerciseForKeyAndDay(p, day, key)!;
  const index = usedExercises(p, day).findIndex((e: Any) => e.key === key);
  return Program_nextHistoryEntry(
    p,
    pd.dayData,
    index,
    pe,
    Stats_getEmpty(),
    settings,
  );
}

/** Complete sets of an entry. `reps[i]` null/undefined leaves set i incomplete. */
function complete(
  entry: Any,
  spec?: {
    reps?: (number | null)[];
    missLastBy?: number;
    lastSetReps?: number;
  },
): Any {
  const e = clone(entry);
  e.sets.forEach((set: Any, i: number) => {
    const last = i === e.sets.length - 1;
    let reps: number | null = set.reps ?? 0;
    if (spec?.reps) reps = spec.reps[i] ?? null;
    else if (last && spec?.lastSetReps != null) reps = spec.lastSetReps;
    else if (last && spec?.missLastBy != null) {
      reps = Math.max(0, (set.reps ?? 0) - spec.missLastBy);
    }
    if (reps == null) return;
    const w = set.weight ?? Weight_build(0, "lb");
    set.completedReps = reps;
    set.completedWeight = Weight_is(w) ? w : Weight_build(0, "lb");
    set.isCompleted = true;
  });
  return e;
}

const DAY_COUNTS: Record<string, number> = {};

function dayCount(prog: Any): number {
  return prog.weeks.reduce((n: number, w: Any) => n + w.days.length, 0);
}

// ---------------------------------------------------------------------------
// Item 3: Program_nextHistoryEntry and friends
// ---------------------------------------------------------------------------

function stepNextHistoryEntry(): void {
  const fixtures: IFixtures = { programs: {}, settings: {} };
  const cases: IGoldenCase[] = [];
  const files = [
    "gzclp.md",
    "smolov-jr.md",
    "texasmethod.md",
    "madcow.md",
    "basicBeginner.md",
    "ss3.md",
  ];
  const kgExtra = "gzclp.md";

  const addProgramCases = (progId: string, fnLabel: string) => {
    const prog = fixtures.programs[progId] as Any;
    const settingsRef = progId.split("@")[0] + "_settings";
    const settings = fixtures.settings[settingsRef];
    const n = dayCount(prog);
    for (let day = 1; day <= n; day++) {
      for (const [index, ex] of usedExercises(prog, day).entries()) {
        cases.push(makeCase(
          "Program_nextHistoryEntry",
          `${fnLabel} day ${day} ${ex.key}`,
          {
            programRef: progId,
            settingsRef,
            day,
            exerciseKey: ex.key,
            index,
            stats: Stats_getEmpty(),
          },
          (i) => {
            const p = clone(fixtures.programs[i.programRef]) as Any;
            const s = clone(fixtures.settings[i.settingsRef]) as Any;
            const pd = Program_getProgramDay(p, i.day)!;
            const pe = Program_getProgramExerciseForKeyAndDay(
              p,
              i.day,
              i.exerciseKey,
            )!;
            return Program_nextHistoryEntry(
              p,
              pd.dayData,
              i.index,
              pe,
              i.stats,
              s,
            );
          },
        ));
      }
    }
    void settings;
  };

  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    fixtures.settings[`${id}_settings`] = settingsWithRm1(file);
    fixtures.programs[id] = evalFixture(
      file,
      fixtures.settings[`${id}_settings`],
    );
    addProgramCases(id, "fresh");
  }
  // kg variant
  fixtures.settings["gzclp_kg_settings"] = settingsWithRm1(kgExtra, "kg");
  fixtures.programs["gzclp_kg"] = evalFixture(
    kgExtra,
    fixtures.settings["gzclp_kg_settings"],
  );
  addProgramCases("gzclp_kg", "fresh kg");

  // With prior history: run finish-day sessions and ask for the next entries
  // from the progressed program. Each chain step stores its program as a fixture.
  const chain = (
    id: string,
    file: string,
    plan: { day: number; spec?: Any }[],
  ) => {
    const settingsRef = `${id}_settings`;
    let progId = id;
    plan.forEach((step, k) => {
      const prog = fixtures.programs[progId] as Any;
      const settings = fixtures.settings[settingsRef];
      const entries = usedExercises(prog, step.day).map((e: Any) => {
        const entry = newEntry(prog, step.day, e.key, settings);
        const spec = step.spec?.[e.key.split("-")[0]] ?? step.spec?.["*"];
        return complete(entry, spec);
      });
      makeCase(
        "runAllFinishDayScripts",
        `chain ${id} step ${k + 1}`,
        {
          programRef: progId,
          day: step.day,
          entries,
          settingsRef,
          stats: Stats_getEmpty(),
        },
        (i) =>
          runAllFinishDayScripts(
            clone(fixtures.programs[i.programRef]) as Any,
            i.day,
            i.entries,
            clone(fixtures.settings[i.settingsRef]) as Any,
            i.stats,
            { onError: () => {} },
          ),
      );
      const next = getLastRaw<Any>().evaluatedProgram;
      progId = `${id}@after${k + 1}`;
      fixtures.programs[progId] = next;
      addProgramCases(progId, `after ${k + 1} session(s)`);
    });
    void file;
  };
  chain("gzclp", "gzclp.md", [
    { day: 1 },
    { day: 2 },
    { day: 3, spec: { t1: { missLastBy: 2 } } },
  ]);
  chain("madcow", "madcow.md", [{ day: 1 }, { day: 2 }, { day: 3 }]);
  chain("smolov-jr", "smolov-jr.md", [{ day: 1 }, { day: 4 }]);

  // Day-level helpers around it.
  const dayRefs = ["gzclp", "smolov-jr", "texasmethod"];
  for (const id of dayRefs) {
    const n = dayCount(fixtures.programs[id] as Any);
    for (const day of [0, 1, 2, n, n + 1, 99]) {
      cases.push(makeCase(
        "Program_nextDay",
        `${id} day ${day}`,
        { programRef: id, day },
        (i) =>
          Program_nextDay(clone(fixtures.programs[i.programRef]) as Any, i.day),
      ));
    }
    for (const day of [1, 2, 99]) {
      cases.push(makeCase(
        "getDay",
        `${id} day ${day}`,
        { programRef: id, day },
        (i) =>
          getDay(clone(fixtures.programs[i.programRef]) as Any, i.day) ?? null,
      ));
    }
  }
  cases.push(makeCase(
    "Program_nextDay",
    "undefined day",
    { programRef: "gzclp" },
    (i) =>
      Program_nextDay(clone(fixtures.programs[i.programRef]) as Any, undefined),
  ));
  void DAY_COUNTS;
  writeGolden("next_history_entry.json", { version: 1, fixtures, cases }, 0);
}

// ---------------------------------------------------------------------------
// Item 4: finish day
// ---------------------------------------------------------------------------

function stepFinishDay(): void {
  const fixtures: IFixtures = { programs: {}, settings: {} };
  const cases: IGoldenCase[] = [];
  const stats = Stats_getEmpty();

  for (
    const file of [
      "gzclp.md",
      "madcow.md",
      "texasmethod.md",
      "smolov-jr.md",
      "basicBeginner.md",
    ]
  ) {
    const id = file.replace(/\.md$/, "");
    fixtures.settings[`${id}_settings`] = settingsWithRm1(file);
    fixtures.programs[id] = evalFixture(
      file,
      fixtures.settings[`${id}_settings`],
    );
  }
  fixtures.settings["gzclp_kg_settings"] = settingsWithRm1("gzclp.md", "kg");
  fixtures.programs["gzclp_kg"] = evalFixture(
    "gzclp.md",
    fixtures.settings["gzclp_kg_settings"],
  );

  const runAll = (
    name: string,
    progId: string,
    day: number,
    entries: Any[],
    opts?: Any,
  ): Any => {
    const settingsRef = progId.split("@")[0] + "_settings";
    cases.push(makeCase(
      "runAllFinishDayScripts",
      name,
      { programRef: progId, day, entries, settingsRef, stats, opts },
      (i) =>
        runAllFinishDayScripts(
          clone(fixtures.programs[i.programRef]) as Any,
          i.day,
          i.entries,
          clone(fixtures.settings[i.settingsRef]) as Any,
          i.stats,
          {
            onError: () => {},
            userPromptedStateVars: i.opts?.userPromptedStateVars,
            // engineByKey: programExerciseId -> engine bindings input
            engineFor: i.opts?.engineByKey
              ? (e: Any) => i.opts.engineByKey[e.programExerciseId]
              : undefined,
          },
        ),
    ));
    return getLastRaw<Any>();
  };

  const gz = fixtures.programs["gzclp"] as Any;
  const gzS = fixtures.settings["gzclp_settings"] as Any;
  const dayEntries = (prog: Any, day: number, settings: Any, spec?: Any) =>
    usedExercises(prog, day).map((e: Any) => {
      const entry = newEntry(prog, day, e.key, settings);
      const prefix = e.key.split("-")[0];
      return complete(entry, spec?.[prefix] ?? spec?.["*"]);
    });

  // Scenarios asserted in tests/gzclp_test.ts.
  runAll("gzclp day 1 all sets hit", "gzclp", 1, dayEntries(gz, 1, gzS));
  runAll("gzclp day 2 all sets hit", "gzclp", 2, dayEntries(gz, 2, gzS));
  runAll("gzclp day 3 all sets hit", "gzclp", 3, dayEntries(gz, 3, gzS));
  runAll("gzclp day 4 all sets hit", "gzclp", 4, dayEntries(gz, 4, gzS));
  runAll(
    "gzclp day 1 T1 misses last set by 2",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t1: { missLastBy: 2 } }),
  );
  runAll(
    "gzclp day 1 T3 AMRAP 27",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t3: { lastSetReps: 27 } }),
  );
  runAll(
    "gzclp day 1 T3 AMRAP 24 (below 25)",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t3: { lastSetReps: 24 } }),
  );
  runAll(
    "gzclp day 1 T3 AMRAP exactly 25",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t3: { lastSetReps: 25 } }),
  );
  // Extras: failing sets, AMRAP over target, partial completion.
  runAll(
    "gzclp day 1 T1 fails first set (0 reps)",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t1: { reps: [0, 3, 3, 3, 3] } }),
  );
  runAll(
    "gzclp day 1 T1 fails every set",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t1: { reps: [2, 2, 2, 2, 2] } }),
  );
  runAll(
    "gzclp day 1 T1 AMRAP over target",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t1: { lastSetReps: 7 } }),
  );
  runAll(
    "gzclp day 1 T1 only first 3 sets completed",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t1: { reps: [3, 3, 3, null, null] } }),
  );
  runAll(
    "gzclp day 1 T2 misses last by 1",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS, { t2: { missLastBy: 1 } }),
  );
  runAll(
    "gzclp day 2 T2 deadlift misses (stage change)",
    "gzclp",
    2,
    dayEntries(gz, 2, gzS, { t2: { missLastBy: 3 } }),
  );
  runAll("gzclp day 1 no entries", "gzclp", 1, []);
  {
    const e = dayEntries(gz, 1, gzS);
    e[0].isSuppressed = true;
    runAll("gzclp day 1 first entry suppressed", "gzclp", 1, e);
  }
  {
    const e = usedExercises(gz, 1).map((x: Any) => newEntry(gz, 1, x.key, gzS));
    runAll("gzclp day 1 nothing completed", "gzclp", 1, e);
  }
  runAll("gzclp invalid day 99", "gzclp", 99, []);
  runAll("gzclp invalid day 0", "gzclp", 0, []);
  runAll(
    "gzclp invalid day 99 with entries",
    "gzclp",
    99,
    dayEntries(gz, 1, gzS),
  );
  runAll(
    "gzclp kg day 1 all sets hit",
    "gzclp_kg",
    1,
    dayEntries(
      fixtures.programs["gzclp_kg"],
      1,
      fixtures.settings["gzclp_kg_settings"],
    ),
  );

  // Bridge: entries built by qalaLiftEntryToHistoryEntry (label-free fallback
  // key misses the labelled program exercise; resolved key succeeds).
  {
    const squatEx = usedExercises(gz, 1).find((e: Any) =>
      e.key.startsWith("t1")
    )!;
    const liftEntry = {
      exerciseId: "squat",
      sets: [{ w: { value: 150, unit: "lb" }, r: 3, completed: true }],
    };
    runAll("gzclp fallback key misses labelled exercise", "gzclp", 1, [
      qalaLiftEntryToHistoryEntry(liftEntry as Any, 0),
    ]);
    const weights = squatEx.evaluatedSetVariations[0].sets.map(() => 150);
    const resolved = qalaLiftEntryToHistoryEntry(
      {
        exerciseId: "squat",
        sets: weights.map((w: number) => ({
          w: { value: w, unit: "lb" },
          r: 3,
          completed: true,
        })),
      } as Any,
      0,
      undefined,
      squatEx.key,
    );
    runAll("gzclp bridge entry with resolved key", "gzclp", 1, [resolved]);
  }
  // Engine bindings and user prompted state.
  runAll(
    "gzclp day 1 with engine bindings",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS),
    {
      engineByKey: {
        "t1-squat_barbell": {
          readiness: 0.5,
          prs: 6,
          soreness: 2,
          fatigueLocal: 0.3,
          deload: 0,
          recWeightPct: -2,
          recSets: 0,
        },
      },
    },
  );
  runAll(
    "gzclp day 1 with user prompted state",
    "gzclp",
    1,
    dayEntries(gz, 1, gzS),
    {
      userPromptedStateVars: {
        "t1-squat_barbell": { increase: Weight_build(20, "lb") },
      },
    },
  );

  // runFinishDayScript directly.
  const rfd = (
    name: string,
    progId: string,
    day: number,
    key: string,
    entry: Any,
    opts?: Any,
  ) => {
    const settingsRef = progId.split("@")[0] + "_settings";
    cases.push(makeCase(
      "runFinishDayScript",
      name,
      {
        programRef: progId,
        day,
        exerciseKey: key,
        entry,
        settingsRef,
        stats,
        opts,
      },
      (i) => {
        const p = clone(fixtures.programs[i.programRef]) as Any;
        const pd = Program_getProgramDay(p, i.day)!;
        const pe = Program_getProgramExerciseForKeyAndDay(
          p,
          i.day,
          i.exerciseKey,
        )!;
        return runFinishDayScript(
          pe,
          p,
          pd.dayData,
          i.entry,
          clone(fixtures.settings[i.settingsRef]) as Any,
          i.stats,
          i.opts,
        );
      },
    ));
  };
  const squatEntry = complete(newEntry(gz, 1, "t1-squat_barbell", gzS));
  rfd("gzclp T1 squat success", "gzclp", 1, "t1-squat_barbell", squatEntry);
  rfd("gzclp T1 squat engine", "gzclp", 1, "t1-squat_barbell", squatEntry, {
    engine: {
      readiness: 0.5,
      prs: 6,
      soreness: 2,
      fatigueLocal: 0.3,
      deload: 0,
      recWeightPct: -2,
      recSets: 0,
    },
  });
  rfd(
    "gzclp T1 squat engine clamped",
    "gzclp",
    1,
    "t1-squat_barbell",
    squatEntry,
    {
      engine: {
        readiness: 9,
        prs: -4,
        soreness: 7.5,
        fatigueLocal: -1,
        deload: 5,
        recWeightPct: -99,
        recSets: 8,
      },
    },
  );
  rfd(
    "gzclp T1 squat missed",
    "gzclp",
    1,
    "t1-squat_barbell",
    complete(newEntry(gz, 1, "t1-squat_barbell", gzS), { missLastBy: 2 }),
  );
  rfd("gzclp T1 squat user state", "gzclp", 1, "t1-squat_barbell", squatEntry, {
    userPromptedStateVars: { increase: Weight_build(15, "lb") },
  });
  rfd(
    "gzclp T2 bench success",
    "gzclp",
    1,
    usedExercises(gz, 1)[1].key,
    complete(newEntry(gz, 1, usedExercises(gz, 1)[1].key, gzS)),
  );
  rfd(
    "gzclp T3 lat pulldown AMRAP 30",
    "gzclp",
    1,
    usedExercises(gz, 1)[2].key,
    complete(newEntry(gz, 1, usedExercises(gz, 1)[2].key, gzS), {
      lastSetReps: 30,
    }),
  );

  // Chained sessions: the output program feeds the next call.
  const runChain = (id: string, plan: { day: number; spec?: Any }[]) => {
    let progId = id;
    plan.forEach((step, k) => {
      const prog = fixtures.programs[progId] as Any;
      const settings = fixtures.settings[`${id}_settings`];
      const entries = dayEntries(prog, step.day, settings, step.spec);
      const out = runAll(
        `chain ${id} step ${k + 1} day ${step.day}`,
        progId,
        step.day,
        entries,
      );
      progId = `${id}@c${k + 1}`;
      fixtures.programs[progId] = out.evaluatedProgram;
    });
  };
  // GZCLP T1 squat: hit, hit, then fail repeatedly to walk stage 1 -> 2 -> 3 -> reset.
  runChain("gzclp", [
    { day: 1 },
    { day: 1, spec: { t1: { missLastBy: 1 } } },
    { day: 1, spec: { t1: { missLastBy: 1 } } },
    { day: 1, spec: { t1: { missLastBy: 1 } } },
    { day: 1, spec: { t1: { missLastBy: 1 } } },
    { day: 1 },
  ]);
  // Full rotation, all hit, over two cycles.
  {
    let progId = "gzclp";
    const settings = gzS;
    for (let k = 0; k < 8; k++) {
      const day = (k % 4) + 1;
      const prog = fixtures.programs[progId] as Any;
      const out = runAll(
        `rotation gzclp session ${k + 1} day ${day}`,
        progId,
        day,
        dayEntries(prog, day, settings),
      );
      progId = `gzclp@r${k + 1}`;
      fixtures.programs[progId] = out.evaluatedProgram;
    }
  }
  runChain("madcow", [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 1 }, {
    day: 2,
  }, { day: 3 }]);
  runChain("texasmethod", [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, {
    day: 5,
  }, { day: 6 }]);
  runChain("smolov-jr", [
    { day: 1 },
    { day: 2 },
    { day: 3 },
    { day: 4 },
    { day: 5 },
    { day: 6 },
    { day: 7 },
    { day: 8 },
  ]);
  runChain("basicBeginner", [{ day: 1 }, { day: 2 }, {
    day: 1,
    spec: { "*": { missLastBy: 2 } },
  }, { day: 2 }]);

  // runUpdateScriptForEntry on madcow (update: custom() on the main lift).
  {
    const mc = fixtures.programs["madcow"] as Any;
    const mcS = fixtures.settings["madcow_settings"] as Any;
    const mcDay = 3;
    const ex = usedExercises(mc, mcDay)[0];
    const base = newEntry(mc, mcDay, ex.key, mcS);
    const upd = (
      name: string,
      entry: Any,
      setIndex: number,
      day = mcDay,
      key = ex.key,
    ) => {
      cases.push(makeCase(
        "runUpdateScriptForEntry",
        name,
        {
          programRef: "madcow",
          day,
          exerciseKey: key,
          entry,
          otherStates: {},
          setIndex,
          settingsRef: "madcow_settings",
          stats,
        },
        (i) => {
          const p = clone(fixtures.programs[i.programRef]) as Any;
          const pd = Program_getProgramDay(p, i.day)!;
          const pe = Program_getProgramExerciseForKeyAndDay(
            p,
            i.day,
            i.exerciseKey,
          )!;
          return runUpdateScriptForEntry(
            i.entry,
            pd.dayData,
            pe,
            i.otherStates,
            i.setIndex,
            clone(fixtures.settings[i.settingsRef]) as Any,
            i.stats,
          );
        },
      ));
    };
    const done = complete(base);
    upd("madcow day 3 set 4 hit", done, 4);
    upd(
      "madcow day 3 set 4 missed",
      complete(base, { reps: [5, 5, 5, 5, 1, null] }),
      4,
    );
    upd("madcow day 3 set 3 (script no-op)", done, 3);
    upd("madcow day 3 set 4 not completed returns entry", base, 4);
    upd("madcow day 3 all sets (-1)", done, -1);
    upd(
      "madcow day 1 set 4 (not dayInWeek 3)",
      complete(newEntry(mc, 1, usedExercises(mc, 1)[0].key, mcS)),
      4,
      1,
      usedExercises(mc, 1)[0].key,
    );
    // exercise without an update script
    const noUpd = usedExercises(mc, 1).find((e: Any) =>
      e.key.startsWith("bicep")
    );
    if (noUpd) {
      upd(
        "madcow no update script",
        complete(newEntry(mc, 1, noUpd.key, mcS)),
        0,
        1,
        noUpd.key,
      );
    }
  }

  // Split into files of a sane size; each file carries only the fixtures its
  // cases reference.
  const groupOf = (name: string): string => {
    const m = name.match(/^(chain|rotation) ([\w-]+)/);
    return m ? `finish_day_${m[1]}_${m[2]}` : "finish_day";
  };
  const groups = new Map<string, IGoldenCase[]>();
  for (const c of cases) {
    const g = groupOf(c.name);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const chunked: [string, IGoldenCase[]][] = [];
  for (const [g, all] of groups) {
    for (let k = 0; k * 10 < all.length; k++) {
      chunked.push([
        k === 0 ? g : `${g}_${k + 1}`,
        all.slice(k * 10, k * 10 + 10),
      ]);
    }
  }
  for (const [g, gc] of chunked) {
    const used: IFixtures = { programs: {}, settings: {} };
    for (const c of gc) {
      const i = c.inputs as Any;
      used.programs[i.programRef] = fixtures.programs[i.programRef];
      used.settings[i.settingsRef] = fixtures.settings[i.settingsRef];
    }
    writeGolden(`${g}.json`, { version: 1, fixtures: used, cases: gc }, 0);
  }
}

// ---------------------------------------------------------------------------
// Item 5: bindings
// ---------------------------------------------------------------------------

function stepBindings(): void {
  const cases: IGoldenCase[] = [];
  const gzS = settingsWithRm1("gzclp.md");
  const gz = evalFixture("gzclp.md", gzS);
  const kgS = liftSettings("kg");

  // Numeric specials are encoded as the strings "NaN"/"Infinity"/"-Infinity"
  // in `inputs`; the runner turns them back into numbers.
  const revive = (v: Any): Any => {
    if (v === "NaN") return NaN;
    if (v === "Infinity") return Infinity;
    if (v === "-Infinity") return -Infinity;
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, revive(x)]),
      );
    }
    return v;
  };

  const engineInputs: [string, Any][] = [
    ["undefined", { present: false }],
    ["empty object", { present: true, input: {} }],
    ["neutral explicit", {
      present: true,
      input: {
        readiness: 1,
        prs: 0,
        soreness: 1,
        fatigueLocal: 0,
        deload: 0,
        recWeightPct: 0,
        recSets: 0,
      },
    }],
    ["typical", {
      present: true,
      input: {
        readiness: 0.5,
        prs: 6,
        soreness: 2,
        fatigueLocal: 0.3,
        deload: 0,
        recWeightPct: -2,
        recSets: 0,
      },
    }],
    ["all above max", {
      present: true,
      input: {
        readiness: 2,
        prs: 11,
        soreness: 9,
        fatigueLocal: 3,
        deload: 7,
        recWeightPct: 50,
        recSets: 5,
      },
    }],
    ["all below min", {
      present: true,
      input: {
        readiness: -2,
        prs: -3,
        soreness: -9,
        fatigueLocal: -1,
        deload: -7,
        recWeightPct: -50,
        recSets: -5,
      },
    }],
    ["rounding .5 up", {
      present: true,
      input: { soreness: 1.5, deload: 0.5, recSets: -0.5 },
    }],
    ["rounding 2.5", {
      present: true,
      input: { soreness: 2.5, deload: 1.5, recSets: 0.49 },
    }],
    ["rounding negative half", {
      present: true,
      input: { recSets: -1.5, soreness: 3.4999 },
    }],
    ["NaN everywhere", {
      present: true,
      input: {
        readiness: "NaN",
        prs: "NaN",
        soreness: "NaN",
        fatigueLocal: "NaN",
        deload: "NaN",
        recWeightPct: "NaN",
        recSets: "NaN",
      },
    }],
    ["Infinity", {
      present: true,
      input: {
        readiness: "Infinity",
        prs: "-Infinity",
        soreness: "Infinity",
        fatigueLocal: "Infinity",
        deload: "-Infinity",
        recWeightPct: "Infinity",
        recSets: "-Infinity",
      },
    }],
    ["boundaries", {
      present: true,
      input: {
        readiness: 0,
        prs: 10,
        soreness: 4,
        fatigueLocal: 1,
        deload: 2,
        recWeightPct: 2.5,
        recSets: 1,
      },
    }],
    ["recWeightPct bounds", { present: true, input: { recWeightPct: -10 } }],
    ["fractional readiness", {
      present: true,
      input: { readiness: 0.123456789, prs: 3.7, fatigueLocal: 0.999 },
    }],
  ];
  for (const [label, inp] of engineInputs) {
    cases.push(
      makeCase(
        "createEngineBindings",
        label,
        inp,
        (i) => createEngineBindings(i.present ? revive(i.input) : undefined),
      ),
    );
  }

  const dayData = { week: 2, dayInWeek: 3, day: 7 };
  for (const [label, inp] of engineInputs.slice(0, 6)) {
    cases.push(makeCase(
      "applyEngineBindings",
      label,
      { dayData, settings: gzS, present: inp.present, input: inp.input },
      (i) =>
        applyEngineBindings(
          Progress_createEmptyScriptBindings(i.dayData, i.settings),
          i.present ? revive(i.input) : undefined,
        ),
    ));
  }
  cases.push(makeCase(
    "applyEngineBindings",
    "empty bindings with exercise rm1",
    {
      dayData,
      settings: gzS,
      exercise: { id: "squat", equipment: "barbell" },
      present: true,
      input: { readiness: 0.4 },
    },
    (i) =>
      applyEngineBindings(
        Progress_createEmptyScriptBindings(i.dayData, i.settings, i.exercise),
        i.input,
      ),
  ));

  // createScriptBindings from real entries.
  const squatKey = "t1-squat_barbell";
  const base = newEntry(gz, 1, squatKey, gzS);
  const full = complete(base);
  const partial = complete(base, { reps: [3, 3, 2, null, null] });
  const sbCases: [string, Any][] = [
    ["uncompleted entry", { entry: base }],
    ["fully completed entry", { entry: full }],
    ["partially completed entry", { entry: partial }],
    ["setIndex 2 with indices", {
      entry: full,
      setIndex: 2,
      setVariationIndex: 2,
      descriptionIndex: 1,
      exerciseVariationIndex: 1,
    }],
    ["bodyweight and engine", {
      entry: full,
      bodyweight: { value: 180, unit: "lb" },
      engine: {
        readiness: 0.6,
        prs: 4,
        soreness: 3,
        fatigueLocal: 0.2,
        deload: 1,
        recWeightPct: -5,
        recSets: -1,
      },
    }],
    ["bodyweight kg value on lb settings", {
      entry: full,
      bodyweight: { value: 80, unit: "kg" },
    }],
    ["no sets", { entry: { ...base, sets: [] } }],
  ];
  for (const [label, p] of sbCases) {
    cases.push(makeCase(
      "createScriptBindings",
      label,
      {
        dayData: { week: 1, dayInWeek: 1, day: 1 },
        settings: gzS,
        programNumberOfSets: 5,
        ...p,
      },
      (i) =>
        createScriptBindings(
          i.dayData,
          i.entry,
          i.settings,
          i.programNumberOfSets,
          i.bodyweight,
          i.setIndex,
          i.setVariationIndex,
          i.descriptionIndex,
          i.exerciseVariationIndex,
          i.engine,
        ),
    ));
  }
  cases.push(makeCase(
    "createScriptBindings",
    "kg settings entry",
    {
      dayData: { week: 1, dayInWeek: 1, day: 1 },
      settings: kgS,
      programNumberOfSets: 5,
      entry: full,
    },
    (i) =>
      createScriptBindings(
        i.dayData,
        i.entry,
        i.settings,
        i.programNumberOfSets,
        undefined,
      ),
  ));

  // Function table: names only (the functions themselves are not data).
  cases.push(
    makeCase(
      "createScriptFunctions",
      "function names",
      { settings: gzS },
      (i) => Object.keys(createScriptFunctions(i.settings)),
    ),
  );
  cases.push(
    makeCase(
      "createScriptFunctions",
      "function names kg",
      { settings: kgS },
      (i) => Object.keys(createScriptFunctions(i.settings)),
    ),
  );
  cases.push(
    makeCase(
      "liftoscriptFnSignatures",
      "argument names and arity",
      {},
      () =>
        Object.fromEntries(
          Object.entries(liftoscriptFnSignatures).map((
            [k, v]: [string, Any],
          ) => [k, {
            args: v.args?.map((a: Any) => ({
              name: a.name,
              optional: a.optional ?? false,
            })) ?? null,
            variadic: v.variadic != null,
          }]),
        ),
    ),
  );

  // qalaSettingsToLiftoscript
  const coreSettings = (w: string, d: string) => ({
    units: { weight: w, distance: d },
  });
  for (
    const [label, s] of [
      ["lb mi", coreSettings("lb", "mi")],
      ["kg km", coreSettings("kg", "km")],
      ["kg mi", coreSettings("kg", "mi")],
      ["unknown weight unit", coreSettings("stone", "mi")],
      ["extra core fields ignored", {
        ...coreSettings("lb", "mi"),
        barbellStep: 5,
        mainLifts: ["squat"],
        theme: "dark",
      }],
    ] as [string, Any][]
  ) {
    cases.push(
      makeCase(
        "qalaSettingsToLiftoscript",
        label,
        { coreSettings: s },
        (i) => qalaSettingsToLiftoscript(i.coreSettings),
      ),
    );
  }

  // qalaExerciseIdToType
  for (
    const id of [
      "squat",
      "Squat",
      "benchPress",
      "Bench Press",
      "deadlift",
      "overheadPress",
      "latPulldown",
      "bentOverRow",
      "pullUp",
      "notAnExercise",
      "",
      "squat_barbell",
    ]
  ) {
    cases.push(
      makeCase("qalaExerciseIdToType", `id ${JSON.stringify(id)}`, {
        exerciseId: id,
      }, (i) => qalaExerciseIdToType(i.exerciseId)),
    );
  }

  // qalaLiftEntryToHistoryEntry
  const ls = (
    w: number,
    u: string,
    r: number,
    completed: boolean,
    rpe?: number,
  ) => ({ w: { value: w, unit: u }, r, completed, rpe });
  const planned = [{ weight: { value: 150, unit: "lb" }, reps: 3 }, {
    weight: { value: 150, unit: "lb" },
    reps: 3,
  }];
  const entryCases: [string, Any][] = [
    ["completed sets, no planned", {
      liftEntry: {
        exerciseId: "squat",
        sets: [ls(150, "lb", 3, true), ls(150, "lb", 3, true, 8)],
      },
      index: 0,
    }],
    ["mixed completion", {
      liftEntry: {
        exerciseId: "benchPress",
        sets: [ls(100, "lb", 5, true), ls(100, "lb", 4, false)],
      },
      index: 2,
    }],
    ["planned targets override", {
      liftEntry: {
        exerciseId: "squat",
        sets: [ls(155, "lb", 2, true), ls(155, "lb", 3, false)],
      },
      index: 1,
      planned,
    }],
    ["partial planned list", {
      liftEntry: {
        exerciseId: "squat",
        sets: [
          ls(155, "lb", 2, true),
          ls(155, "lb", 3, true),
          ls(155, "lb", 3, true),
        ],
      },
      index: 0,
      planned,
    }],
    ["planned weight without reps", {
      liftEntry: { exerciseId: "deadlift", sets: [ls(200, "lb", 5, true)] },
      index: 0,
      planned: [{ weight: { value: 205, unit: "lb" } }],
    }],
    ["planned reps without weight", {
      liftEntry: { exerciseId: "deadlift", sets: [ls(200, "lb", 5, true)] },
      index: 0,
      planned: [{ reps: 4 }],
    }],
    ["kg unit", {
      liftEntry: { exerciseId: "squat", sets: [ls(100, "kg", 5, true)] },
      index: 0,
    }],
    ["explicit program key", {
      liftEntry: { exerciseId: "squat", sets: [ls(150, "lb", 3, true)] },
      index: 0,
      programExerciseKey: "t1-squat_barbell",
    }],
    ["unknown exercise id", {
      liftEntry: { exerciseId: "mystery_lift", sets: [ls(50, "lb", 10, true)] },
      index: 3,
    }],
    ["no sets", { liftEntry: { exerciseId: "squat", sets: [] }, index: 0 }],
    ["rpe on uncompleted", {
      liftEntry: { exerciseId: "squat", sets: [ls(150, "lb", 3, false, 9)] },
      index: 0,
    }],
    ["zero reps completed", {
      liftEntry: { exerciseId: "squat", sets: [ls(150, "lb", 0, true)] },
      index: 0,
    }],
  ];
  for (const [label, p] of entryCases) {
    cases.push(
      makeCase(
        "qalaLiftEntryToHistoryEntry",
        label,
        p,
        (i) =>
          qalaLiftEntryToHistoryEntry(
            i.liftEntry,
            i.index,
            i.planned,
            i.programExerciseKey,
          ),
      ),
    );
  }

  // qalaLiftSessionToHistoryRecord, with and without the program.
  const sessionBase = (date: string, entries: Any[]) => ({
    id: "s1",
    kind: "lift",
    date,
    programId: "gzclp",
    day: "Day 1",
    entries,
    checkin: { prs: 0, soreness: {}, text: "" },
    perf: {},
    srpe: 0,
    minutes: 0,
  });
  const sessEntries = [
    {
      exerciseId: "squat",
      sets: [ls(150, "lb", 3, true), ls(150, "lb", 3, true)],
    },
    { exerciseId: "benchPress", sets: [ls(100, "lb", 10, true)] },
    { exerciseId: "latPulldown", sets: [ls(80, "lb", 15, false)] },
  ];
  const sessCases: [string, Any][] = [
    ["with program resolves labelled keys", {
      session: sessionBase(new Date(0).toISOString(), sessEntries),
      day: 1,
      programName: "GZCLP",
      programRef: "gzclp",
    }],
    ["without program uses fallback keys", {
      session: sessionBase("2026-03-05T10:20:30.123Z", sessEntries),
      day: 1,
      programName: "GZCLP",
    }],
    ["date only", {
      session: sessionBase("2026-03-05", sessEntries),
      day: 2,
      programName: "GZCLP",
      programRef: "gzclp",
    }],
    ["unparseable date gives NaN startTime", {
      session: sessionBase("not a date", sessEntries),
      day: 1,
      programName: "GZCLP",
    }],
    ["day beyond program", {
      session: sessionBase("2026-03-05T00:00:00Z", sessEntries),
      day: 99,
      programName: "GZCLP",
      programRef: "gzclp",
    }],
    ["no entries", {
      session: sessionBase("2026-03-05T00:00:00Z", []),
      day: 1,
      programName: "x",
      programRef: "gzclp",
    }],
  ];
  const fixturesPrograms = { gzclp: gz };
  for (const [label, p] of sessCases) {
    cases.push(
      makeCase(
        "qalaLiftSessionToHistoryRecord",
        label,
        p,
        (i) =>
          qalaLiftSessionToHistoryRecord(
            i.session,
            i.day,
            i.programName,
            i.programRef
              ? clone((fixturesPrograms as Any)[i.programRef])
              : undefined,
          ),
      ),
    );
  }

  // evaluateQalaProgram
  const coreProg = (name: string, text: string) => ({
    name,
    text,
    state: null,
    approach: "strength",
    periodization: "linear",
    referenceRm: {},
  });
  const evalCases: [string, Any][] = [
    ["gzclp lb", {
      coreProgram: coreProg("GZCLP", loadBuiltinProgram("gzclp.md")),
      coreSettings: coreSettings("lb", "mi"),
    }],
    ["gzclp kg", {
      coreProgram: coreProg("GZCLP", loadBuiltinProgram("gzclp.md")),
      coreSettings: coreSettings("kg", "km"),
    }],
    ["tiny program", {
      coreProgram: coreProg(
        "Tiny",
        "# Week 1\n## Day 1\nSquat / 3x5 / 100lb\n",
      ),
      coreSettings: coreSettings("lb", "mi"),
    }],
    ["empty text", {
      coreProgram: coreProg("Empty", ""),
      coreSettings: coreSettings("lb", "mi"),
    }],
    ["syntax error in set", {
      coreProgram: coreProg(
        "Bad",
        "# Week 1\n## Day 1\nSquat / 3x5 / 100lbs oops\n",
      ),
      coreSettings: coreSettings("lb", "mi"),
    }],
    ["unknown exercise", {
      coreProgram: coreProg(
        "Unknown",
        "# Week 1\n## Day 1\nFlurble Press / 3x5 / 50lb\n",
      ),
      coreSettings: coreSettings("lb", "mi"),
    }],
    ["bad progress script", {
      coreProgram: coreProg(
        "BadScript",
        "# Week 1\n## Day 1\nSquat / 3x5 / 100lb / progress: custom() {~ state.x = ~}\n",
      ),
      coreSettings: coreSettings("lb", "mi"),
    }],
  ];
  for (const [label, p] of evalCases) {
    cases.push(
      makeCase(
        "evaluateQalaProgram",
        label,
        p,
        (i) => evaluateQalaProgram(i.coreProgram, i.coreSettings),
      ),
    );
  }

  writeGolden("bindings.json", { version: 1, cases }, 0);
}

export function runCases(): void {
  stepBuiltins();
  stepNextHistoryEntry();
  stepFinishDay();
  stepBindings();
}
