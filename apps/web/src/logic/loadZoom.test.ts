import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  anchorFor,
  type Bar,
  blockModel,
  type Box,
  cameraCenter,
  centerShift,
  defaultAnchor,
  describe,
  describeInspected,
  easeOutQuart,
  frame,
  hitAt,
  inspectDay,
  type Level,
  MAX_BAR,
  panAnchor,
  panStep,
  parseZ,
  QUIET,
  REST_H,
  restWindow,
  SESSION_GAP,
  snapLevel,
  stepInspect,
  tableFor,
  tipAlign,
  tipFor,
  totalLine,
  tweenMs,
  withRail,
  zFromPinch,
  zoomTitle,
} from "./loadZoom.ts";
import { weekTotals } from "./weeklyLoad.ts";
import {
  restDayStages,
  sampleBlockWeeks,
  sampleStages,
  sampleWeeks,
} from "../store/sample.ts";
import type { StageState, WeekLoad } from "../store/types.ts";

const box: Box = { width: 300, height: 88 };
const rail = withRail(sampleBlockWeeks, sampleStages);
const model = blockModel(rail);
const TODAY = 20; // Sunday of week 3
const ppl = (yMax: number) => box.height / yMax;

/** A day's pieces in a frame, lift then run. */
function pieces(f: ReturnType<typeof frame>, day: number) {
  return f.bars.filter((b) =>
    b.layer === "day" && b.slot === day && b.kind !== "rest"
  );
}

function stage(id: StageState["id"], status: StageState["status"]) {
  return { id, label: id, time: "", status } as StageState;
}

Deno.test("the block has six weeks, 42 days and a deload at half of week 5", () => {
  assertEquals(model.weeks.length, 6);
  assertEquals(model.days.length, 42);
  assertEquals(model.today, TODAY);
  assertEquals(defaultAnchor(model), TODAY);
  assertEquals(model.weeks[4].planned, 2940);
  assertEquals(model.weeks[5].planned, 1470);
  assertEquals(model.weeks[5].deload, true);
  assertEquals(model.maxDay, 790);
  assertEquals(model.maxWeek, 2940);
  // Weeks 2 to 4 are the ribbon's three weeks.
  assertEquals(sampleBlockWeeks.slice(1, 4).map((w) => w.id), [
    "w2",
    "w3",
    "w4",
  ]);
  assertEquals(sampleWeeks.map((w) => w.id), ["w2", "w3", "w4"]);
});

Deno.test("Week level stacks each day: lift under run, fill shares match describe()", () => {
  const f = frame(model, { z: 1, anchor: TODAY }, box);
  const k = ppl(model.maxDay);
  const views = describe(rail[2].days);
  views.forEach((v, i) => {
    const day = model.days[14 + i];
    const ps = pieces(f, 14 + i);
    assertEquals(ps.map((p) => p.kind), [
      ...(v.liftPlanned + v.liftDone > 0 ? ["lift"] : []),
      ...(v.runPlanned + v.runDone > 0 ? ["run"] : []),
    ]);
    for (const p of ps) {
      const size = p.kind === "lift" ? day.liftSize : day.runSize;
      const done = p.kind === "lift" ? v.liftDone : v.runDone;
      assertAlmostEquals(p.h, size * k, 1e-9);
      assertAlmostEquals(p.fillH / p.h, done / size, 1e-9);
      assertEquals(p.future, false);
      assertEquals(p.opacity, 1);
      assert(p.w <= MAX_BAR);
      // Lift on the baseline, run stacked on it.
      assertAlmostEquals(
        p.y + p.h,
        box.height - (p.kind === "run" ? day.liftSize * k : 0),
        1e-9,
      );
    }
  });
  assertEquals(f.window, { start: 14, days: 7 });
  assertEquals(f.dividers, []);
  // Today's chip hangs over today's column.
  assertEquals(f.today?.text, "Today · Lower A");
  assertEquals(f.today?.opacity, 1);
});

Deno.test("3 weeks draws the U25 ribbon: hatched future week, quiet flanks, thin bars", () => {
  const f = frame(model, { z: 2, anchor: TODAY }, box);
  assertEquals(f.window.start, 7);
  assertEquals(f.window.days, 21);
  for (let abs = 7; abs < 28; abs++) {
    const week = Math.floor(abs / 7);
    for (const p of pieces(f, abs)) {
      assertEquals(p.future, rail[week].relation === "future", `${p.key}`);
      assertAlmostEquals(p.opacity, week === 2 ? 1 : QUIET, 1e-9);
      assert(p.w <= 15, `${p.key} is ${p.w}px`);
      if (p.future) assertEquals(p.fillH, 0);
    }
  }
  // Done fills are the part done of each kind.
  const mon = pieces(f, 14)[0];
  assertAlmostEquals(mon.fillH / mon.h, 1, 1e-9);
  // Two week rules, the ruler names the three weeks.
  assertEquals(f.dividers.length, 2);
  const ruler = f.labels.filter((l) => l.row === "ruler").map((l) => l.text);
  assert(
    ruler.includes("Week 2") && ruler.includes("Week 3") &&
      ruler.includes("Week 4"),
  );
  // Today's letter is knocked out, and no glyph rows remain.
  const knock = f.labels.filter((l) => l.knockout && l.opacity > 0);
  assertEquals(knock.map((l) => l.text), ["S"]);
  assertEquals(
    f.labels.every((l) => l.row === "ruler" || l.row === "text"),
    true,
  );
  assertEquals(f.today?.opacity, 1);
  // The chip hides when today's week is not the one in focus.
  assertEquals(frame(model, { z: 2, anchor: 13 }, box).today?.opacity, 0);
});

Deno.test("Day level draws a lift piece and a run piece, SESSION_GAP apart", () => {
  const f = frame(model, { z: 0, anchor: TODAY }, box);
  const bars = pieces(f, TODAY);
  assertEquals(bars.map((b) => b.kind), ["lift", "run"]);
  assertAlmostEquals(
    bars[0].x + bars[0].w / 2,
    box.width / 2 - SESSION_GAP / 2,
    1e-6,
  );
  assertAlmostEquals(
    bars[1].x + bars[1].w / 2,
    box.width / 2 + SESSION_GAP / 2,
    1e-6,
  );
  assertAlmostEquals(bars[0].h, 510 * ppl(model.maxDay), 1e-9);
  assertAlmostEquals(bars[1].h, 240 * ppl(model.maxDay), 1e-9);
  // Both sit on the baseline with a full cap, and nothing is done yet.
  for (const b of bars) {
    assertAlmostEquals(b.y + b.h, box.height, 1e-9);
    assertEquals(b.cap, 1);
    assertEquals(b.fillH, 0);
  }
  const names = f.labels.filter((l) => l.row === "text" && l.opacity === 1)
    .map((l) => l.text);
  assert(names.includes("Lower A") && names.includes("Easy run"));
  assertEquals(f.today?.opacity, 1);
});

Deno.test("Block draws each week as its lift under its run", () => {
  const f = frame(model, { z: 3, anchor: TODAY }, box);
  const k = ppl(model.maxWeek);
  const weeks = f.bars.filter((b) => b.layer === "week");
  assertEquals(weeks.length, 12);
  model.weeks.forEach((w, i) => {
    const lift = weeks.find((b) => b.key === `w${i}-lift`)!;
    const run = weeks.find((b) => b.key === `w${i}-run`)!;
    assertAlmostEquals(lift.h, w.liftSize * k, 1e-9);
    assertAlmostEquals(run.h, w.runSize * k, 1e-9);
    assertAlmostEquals(lift.y + lift.h, box.height, 1e-9);
    assertAlmostEquals(run.y + run.h, lift.y, 1e-9);
    assertAlmostEquals(
      lift.fillH / lift.h,
      w.relation === "future" ? 0 : w.liftDone / w.liftSize,
      1e-9,
    );
    assertAlmostEquals(lift.x + lift.w / 2, (i + 0.5) * (box.width / 6), 1e-6);
    assertEquals([lift.cap, run.cap], [0, 1]);
    assertEquals([lift.future, run.future], [
      w.relation === "future",
      w.relation === "future",
    ]);
    assertEquals(lift.opacity, 1);
  });
  assertEquals(
    f.bars.filter((b) => b.opacity > 0.01 && b.layer !== "week"),
    [],
  );
  const numbers = f.labels.filter((l) => l.row === "text" && l.opacity === 1);
  assertEquals(numbers.map((l) => l.text), ["1", "2", "3", "4", "5", "D"]);
  // The current week's number is the one knocked out.
  assertEquals(numbers.filter((l) => l.knockout).map((l) => l.text), ["3"]);
  assertEquals(f.today?.opacity, 0);
});

const SPEC = (b: Bar) => [b.x, b.y, b.w, b.h, b.fillH];

Deno.test("continuity: no bar jumps across a level boundary", () => {
  const e = 1e-4;
  for (const anchor of [0, 13, TODAY, 27, 41]) {
    for (const z of [0, 1, 2, 3]) {
      const lo = frame(model, { z: z - e, anchor }, box);
      const hi = frame(model, { z: z + e, anchor }, box);
      const loBars = new Map(lo.bars.map((b) => [b.key, b]));
      const hiBars = new Map(hi.bars.map((b) => [b.key, b]));
      for (const [key, a] of loBars) {
        const b = hiBars.get(key);
        if (!b) {
          // A bar on one side only is a crossfaded piece, invisible there.
          assert(a.opacity < 0.01, `${key} vanishes at z=${z} (${a.opacity})`);
          continue;
        }
        SPEC(a).forEach((v, i) =>
          assert(Math.abs(v - SPEC(b)[i]) < 1, `${key}[${i}] at z=${z}`)
        );
        assert(Math.abs(a.opacity - b.opacity) < 0.01, `${key} opacity`);
      }
      for (const [key, b] of hiBars) {
        if (!loBars.has(key)) {
          assert(b.opacity < 0.01, `${key} appears at z=${z} (${b.opacity})`);
        }
      }
    }
  }
});

Deno.test("continuity: no bar teleports anywhere along the zoom", () => {
  for (const anchor of [0, TODAY, 41]) {
    let prev = frame(model, { z: 0, anchor }, box);
    for (let i = 1; i <= 300; i++) {
      const next = frame(model, { z: i / 100, anchor }, box);
      const was = new Map(prev.bars.map((b) => [b.key, b]));
      for (const b of next.bars) {
        const a = was.get(b.key);
        if (!a) continue;
        assert(Math.abs(a.x - b.x) < 30, `${b.key} x at z=${i / 100}`);
        assert(Math.abs(a.y - b.y) < 8, `${b.key} y at z=${i / 100}`);
        assert(Math.abs(a.h - b.h) < 8, `${b.key} h at z=${i / 100}`);
      }
      prev = next;
    }
  }
});

Deno.test("conservation: a week's stacked days add up to its Block pieces", () => {
  for (const z of [2.1, 2.3, 2.5, 2.7, 2.85]) {
    const f = frame(model, { z, anchor: TODAY }, box);
    const k = box.height / f.yMax;
    for (const week of model.weeks) {
      for (const kind of ["lift", "run"] as const) {
        const ps = f.bars.filter((b) =>
          b.layer === "day" && b.kind === kind && b.week === week.index
        );
        const want = kind === "lift" ? week.liftSize : week.runSize;
        const have = week.days.filter((d) =>
          (kind === "lift" ? d.liftSize : d.runSize) > 0
        ).length;
        if (ps.length !== have) {
          continue; // part of it is off screen
        }
        const sum = ps.reduce((t, b) =>
          t + b.h, 0);
        assertAlmostEquals(
          sum,
          want * k,
          1e-6,
          `${kind} w${week.index} z=${z}`,
        );
      }
    }
  }
  // Once the stacks have risen and slid: Monday at the bottom, lifts without
  // gaps, runs without gaps on top of the whole week's lift.
  const f = frame(model, { z: 2.89, anchor: TODAY }, box);
  const k = box.height / f.yMax;
  const week = model.weeks[2];
  const of = (kind: "lift" | "run") =>
    f.bars.filter((b) => b.layer === "day" && b.kind === kind && b.week === 2)
      .sort((a, b) => a.slot - b.slot);
  const lifts = of("lift");
  assertAlmostEquals(lifts[0].y + lifts[0].h, box.height, 1e-6);
  for (let i = 1; i < lifts.length; i++) {
    assertAlmostEquals(lifts[i].y + lifts[i].h, lifts[i - 1].y, 1e-6);
  }
  const runs = of("run");
  assertAlmostEquals(
    runs[0].y + runs[0].h,
    box.height - week.liftSize * k,
    1e-6,
  );
  for (let i = 1; i < runs.length; i++) {
    assertAlmostEquals(runs[i].y + runs[i].h, runs[i - 1].y, 1e-6);
  }
  // Only the top of the column keeps its cap.
  const capped = [...lifts, ...runs].filter((b) => b.cap > 0.5);
  assertEquals(capped.map((b) => b.key), [`p${TODAY}-run`]);
});

Deno.test("no two pieces overlap at any point of the Day to Block zoom", () => {
  const overlap = (a: Bar, b: Bar) =>
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
  for (const anchor of [0, TODAY, 41]) {
    for (let i = 0; i <= 600; i++) {
      const f = frame(model, { z: i / 200, anchor }, box);
      const seen = f.bars.filter((b) => b.opacity > 0.02 && b.kind !== "rest");
      for (let a = 0; a < seen.length; a++) {
        for (let c = a + 1; c < seen.length; c++) {
          if (seen[a].layer !== seen[c].layer) continue; // a crossfade
          assert(
            !overlap(seen[a], seen[c]),
            `${seen[a].key} overlaps ${seen[c].key} at z=${i / 200}`,
          );
        }
      }
    }
  }
});

Deno.test("limits: bars stay at most 24px and nothing is NaN, at any zoom", () => {
  const empty: WeekLoad = {
    id: "w7",
    name: "Week 7",
    range: "Oct 5-11",
    relation: "future",
    days: Array.from({ length: 7 }, () => ({
      day: "M",
      liftDone: 0,
      runDone: 0,
      liftPlanned: 0,
      runPlanned: 0,
    })),
  };
  const models = [
    model,
    blockModel(withRail(sampleBlockWeeks, restDayStages)),
    blockModel([...rail, empty]),
    blockModel([empty]),
  ];
  const wide: Box[] = [box, { width: 600, height: 112 }, {
    width: 1,
    height: 88,
  }];
  for (const m of models) {
    for (const b of wide) {
      for (const anchor of [0, TODAY, m.days.length - 1]) {
        for (let i = 0; i <= 60; i++) {
          const f = frame(m, { z: i / 20, anchor }, b);
          for (const bar of f.bars) {
            assert(bar.w <= MAX_BAR, `${bar.key} is ${bar.w}px wide`);
            for (const v of [...SPEC(bar), bar.opacity]) {
              assert(Number.isFinite(v), `${bar.key} has ${v}`);
            }
            assert(bar.opacity >= 0 && bar.opacity <= 1);
            assert(bar.h >= 0 && bar.fillH <= bar.h + 1e-9);
            assert(bar.cap >= 0 && bar.cap <= 1 + 1e-9, `${bar.key} cap`);
            if (bar.future) assertEquals(bar.fillH, 0);
          }
          for (const l of f.labels) assert(Number.isFinite(l.x + l.opacity));
          for (const h of f.hits) assert(Number.isFinite(h.x + h.w + h.top));
          if (f.today) assert(Number.isFinite(f.today.x + f.today.top));
        }
      }
    }
  }
  assertEquals(frame(blockModel([]), { z: 1, anchor: 0 }, box).bars, []);
});

Deno.test("a rest day is one dash labeled Rest, caption Today · rest", () => {
  const m = blockModel(withRail(sampleBlockWeeks, restDayStages));
  const day = m.days[TODAY];
  assertEquals(day.state, "rest");
  assertEquals(day.today, true);
  const f = frame(m, { z: 0, anchor: TODAY }, box);
  const mine = f.bars.filter((b) => b.slot === TODAY);
  assertEquals(mine.length, 1);
  assertEquals(mine[0].layer, "day");
  assertEquals(mine[0].kind, "rest");
  assertEquals(mine[0].h, REST_H);
  assertEquals(mine[0].opacity, 1);
  const labels = f.labels.filter((l) => l.row === "text" && l.opacity === 1);
  assertEquals(labels.map((l) => l.text), ["Rest"]);
  assertEquals(f.today?.text, "Today · Rest");
  assertEquals(describeInspected(m, 0, TODAY, TODAY).text, "Today · rest");
  // Zoomed out it stacks nothing: the dash is already the slot's rest mark.
  const week = frame(m, { z: 1, anchor: TODAY }, box).bars.find((b) =>
    b.slot === TODAY
  )!;
  assertEquals(week.kind, "rest");
  assertEquals(week.h, REST_H);
});

Deno.test("the rail decides today's done state: lift and run stages", () => {
  const today = (weeks: WeekLoad[]) => weeks[2].days[6];
  const base = today(rail);
  assertEquals([base.liftDone, base.runDone], [0, 0]);
  assertEquals([base.liftPlanned, base.runPlanned], [510, 240]);

  const liftDone = withRail(sampleBlockWeeks, [
    stage("lift", "done"),
    stage("run", "later"),
  ]);
  assertEquals([today(liftDone).liftDone, today(liftDone).runDone], [510, 0]);

  const runDone = withRail(sampleBlockWeeks, [
    stage("lift", "done"),
    stage("run", "done"),
  ]);
  assertEquals([today(runDone).liftDone, today(runDone).runDone], [510, 240]);
  assertEquals(today(runDone).label, "Lower A");

  // Other days and the series itself are left alone.
  assertEquals(rail[2].days.slice(0, 6), sampleBlockWeeks[2].days.slice(0, 6));
  assertEquals(sampleBlockWeeks[2].days[6].liftDone, 510);

  // A day with no lift or run stage has no load.
  const rest = today(withRail(sampleBlockWeeks, restDayStages));
  assertEquals(
    [rest.liftPlanned, rest.runPlanned, rest.liftDone, rest.runDone],
    [0, 0, 0, 0],
  );
  assertEquals(rest.label, undefined);
});

Deno.test("week totals of the rail's week 3 match the old phone sample", () => {
  const t = weekTotals(rail[2].days);
  assertEquals(t.liftDone, 1250);
  assertEquals(t.runDone, 480);
  assertEquals(t.planned, 1760 + 1020);
  assertEquals(t.done, 1730);
});

Deno.test("captions at each level", () => {
  assertEquals(
    describeInspected(model, 0, TODAY, TODAY).text,
    "Today · Lower A · 510 planned · Easy run 240 planned",
  );
  assertEquals(
    describeInspected(model, 1, TODAY, TODAY).text,
    "Today · Lower A · 750 planned",
  );
  assertEquals(
    describeInspected(model, 1, 14, TODAY).text,
    "Monday · Upper A · 420 done",
  );
  // Another week's day names its week at 3 weeks.
  assertEquals(
    describeInspected(model, 2, 21, TODAY).text,
    "Week 4 · Monday · Upper A · 430 planned",
  );
  assertEquals(
    describeInspected(model, 3, TODAY, TODAY).text,
    "Week 3 · 1,730 done of 2,780 planned",
  );
  assertEquals(
    describeInspected(model, 3, 35, TODAY).text,
    "Week 6 · deload · 1,470 planned",
  );
  assertEquals(
    totalLine(model, 1, TODAY),
    "Week 3: 1,730 done of 2,780 planned",
  );
  assertEquals(totalLine(model, 0, 3), "Week 1: 2,490 of 2,510 done");
  assert(totalLine(model, 3, TODAY).startsWith("Block: "));
});

Deno.test("the table matches the level: days, then weeks for Block", () => {
  const rows = (level: Level) => tableFor(model, level, TODAY);
  assertEquals(rows(0).rows.length, 1);
  assertEquals(rows(1).rows.length, 7);
  assertEquals(rows(2).rows.length, 21);
  assertEquals(rows(3).rows.length, 6);
  assertEquals(rows(1).rows[6][0], "Week 3 (today)");
  assertEquals(rows(3).head[0], "Week");
  assertEquals(restWindow(model, 2, TODAY), { start: 7, days: 21 });
});

Deno.test("snap and pinch mapping", () => {
  assertEquals(snapLevel(1.49), 1);
  assertEquals(snapLevel(1.5), 2);
  assertEquals(snapLevel(-4), 0);
  assertEquals(snapLevel(9), 3);
  assertEquals(zFromPinch(1, 1), 1);
  assertAlmostEquals(zFromPinch(1, 1.8), 0, 1e-9);
  assertAlmostEquals(zFromPinch(1, 1 / 1.8), 2, 1e-9);
  assertEquals(zFromPinch(0.5, 100), 0);
  assertEquals(zFromPinch(2.5, 0.001), 3);
  assertEquals(zFromPinch(1.5, 0), 1.5);
  assertEquals(easeOutQuart(0), 0);
  assertEquals(easeOutQuart(1), 1);
  assertAlmostEquals(easeOutQuart(0.5), 1 - 0.5 ** 4, 1e-12);
  assertEquals(tweenMs(0, 1), 380);
  assertEquals(tweenMs(0, 3), 900);
  assertEquals(tweenMs(2, 1), 380);
});

Deno.test("pan steps and clamping", () => {
  assertEquals([0, 1, 2, 3].map(panStep), [1, 7, 7, 0]);
  assertEquals(panAnchor(model, 20, 0, 1), 21);
  assertEquals(panAnchor(model, 20, 0, -1), 19);
  assertEquals(panAnchor(model, 0, 0, -1), 0);
  assertEquals(panAnchor(model, 41, 0, 1), 41);
  assertEquals(panAnchor(model, 20, 1, 1), 27);
  assertEquals(panAnchor(model, 20, 2, -1), 13);
  assertEquals(panAnchor(model, 39, 1, 1), 39);
  assertEquals(panAnchor(model, 3, 2, -1), 3);
  assertEquals(panAnchor(model, 20, 3, 1), 20);
  assertEquals(inspectDay(model, 2), TODAY);
  assertEquals(inspectDay(model, 1), 13);
  assertEquals(inspectDay(model, 3), 21);
  assertEquals(stepInspect(model, 1, 20, 1), 21);
  assertEquals(stepInspect(model, 1, 41, 1), 41);
  assertEquals(stepInspect(model, 3, 20, 1), 21);
  assertEquals(stepInspect(model, 3, 20, -1), 13);
  assertEquals(anchorFor(model, 1, 20, 21), 21);
  assertEquals(anchorFor(model, 1, 20, 19), 20);
  assertEquals(anchorFor(model, 0, 20, 19), 19);
  assertEquals(parseZ("?z=1.5"), 1.5);
  assertEquals(parseZ("?shell=phone&z=9"), 3);
  assertEquals(parseZ("?z=abc"), null);
  assertEquals(parseZ(""), null);
});

Deno.test("the 3-week window clamps at the block's ends", () => {
  const first = frame(model, { z: 2, anchor: 0 }, box);
  assertEquals(first.window.start, 0);
  const anchorWeek = first.bars.filter((b) => b.layer === "day" && b.slot < 7);
  assert(anchorWeek.every((b) => b.opacity === 1));
  const second = first.bars.filter((b) =>
    b.layer === "day" && b.slot >= 7 &&
    b.slot < 21
  );
  assert(second.every((b) => Math.abs(b.opacity - QUIET) < 1e-9));
  assertEquals(frame(model, { z: 2, anchor: 41 }, box).window.start, 21);
  assertEquals(frame(model, { z: 2, anchor: 13 }, box).window.start, 0);
  assertEquals(frame(model, { z: 2, anchor: 34 }, box).window.start, 21);
  // Day and Week follow the anchor exactly.
  assertEquals(frame(model, { z: 0, anchor: 41 }, box).window.start, 41);
  assertEquals(frame(model, { z: 1, anchor: 41 }, box).window.start, 35);
});

Deno.test("a pan in flight keeps the picture still, then eases to the new week", () => {
  const count = model.days.length;
  const shift = centerShift(count, 1, 20, 27);
  assertEquals(shift, -7);
  assertEquals(cameraCenter(count, 1, 20), 17.5);
  const still = frame(model, { z: 1, anchor: 20 }, box);
  const flip = frame(model, { z: 1, anchor: 27, offset: shift }, box);
  assertEquals(flip.window, still.window);
  const done = frame(model, { z: 1, anchor: 27, offset: 0 }, box);
  assertEquals(done.window.start, 21);
  const mid = frame(model, { z: 1, anchor: 27, offset: shift / 2 }, box);
  assertAlmostEquals(mid.window.start, 17.5, 1e-9);
});

Deno.test("the pointer lands on the slot under it, or the nearest", () => {
  const f = frame(model, { z: 1, anchor: TODAY }, box);
  assertEquals(hitAt(f, 10)?.day, 14);
  assertEquals(hitAt(f, 299)?.day, TODAY);
  assertEquals(hitAt(f, 150)?.day, 17);
  assertEquals(hitAt(f, -50)?.day, 14);
  const block = frame(model, { z: 3, anchor: TODAY }, box);
  assertEquals(block.hits.length, 6);
  assertEquals(hitAt(block, 160)?.week, 3);
  assertEquals(hitAt(block, 160)?.day, 21);
  // A slot carries the top of its pieces, for the tooltip.
  const today = f.hits.find((h) => h.day === TODAY)!;
  const tallest = Math.min(...pieces(f, TODAY).map((b) => b.y));
  assertAlmostEquals(today.top, tallest, 1e-9);
  assertAlmostEquals(f.today!.top, tallest, 1e-9);
});

Deno.test("today's chip fades before it reaches the chart's edge", () => {
  // Between Day and Week, today's column sits past the right edge.
  const f = frame(model, { z: 0.5, anchor: TODAY }, box);
  assert(f.today !== null && f.today.x > box.width);
  assertEquals(f.today.opacity, 0);
  // At rest it is fully in.
  assertEquals(frame(model, { z: 1, anchor: TODAY }, box).today?.opacity, 1);
});

Deno.test("the title follows the zoom", () => {
  const name = "Strength block";
  const t = (level: Level, anchor: number) =>
    zoomTitle(model, level, anchor, name);
  assertEquals(t(0, TODAY), "Today");
  assertEquals(t(0, 19), "Saturday");
  assertEquals(t(0, 21), "Monday, week 4");
  assertEquals(t(1, TODAY), "This week");
  assertEquals(t(1, 13), "Last week");
  assertEquals(t(1, 21), "Next week");
  assertEquals(t(1, 35), "Week 6");
  assertEquals(t(1, 0), "Week 1");
  assertEquals(t(2, TODAY), "Weeks 2 to 4");
  assertEquals(t(2, 0), "Weeks 1 to 3");
  assertEquals(t(2, 41), "Weeks 4 to 6");
  assertEquals(t(3, TODAY), name);
  // A block shorter than three weeks names the weeks it has.
  const one = blockModel([sampleBlockWeeks[1]]);
  assertEquals(zoomTitle(one, 2, 0, name), "Week 1");
});

Deno.test("tooltips name the session and label the numbers", () => {
  assertEquals(tipFor(model, 1, TODAY, TODAY), {
    title: "Today · Lower A",
    numbers: "lift + run · 750 planned load",
  });
  assertEquals(tipFor(model, 1, 14, TODAY), {
    title: "Monday · Upper A",
    numbers: "lift · 420 load",
  });
  assertEquals(tipFor(model, 2, 21, TODAY), {
    title: "Week 4 · Monday · Upper A",
    numbers: "lift · 430 planned load",
  });
  assertEquals(tipFor(model, 1, 19, TODAY).numbers, "run · 170 of 290 load");
  assertEquals(tipFor(model, 3, TODAY, TODAY), {
    title: "Week 3",
    numbers: "lift + run · 1,730 of 2,780 load",
  });
  assertEquals(tipFor(model, 3, 35, TODAY), {
    title: "Week 6 · deload",
    numbers: "lift + run · 1,470 planned load",
  });
  const rest = blockModel(withRail(sampleBlockWeeks, restDayStages));
  assertEquals(tipFor(rest, 1, TODAY, TODAY).numbers, "rest");
  assertEquals(tipAlign(10, 300), "start");
  assertEquals(tipAlign(150, 300), "center");
  assertEquals(tipAlign(290, 300), "end");
});
