import { test } from "bun:test";
import assert from "node:assert/strict";
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
  LEVEL_BAR_MAX,
  MAX_BAR,
  monthOf,
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
  sampleWeekLoad,
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

test("the block has six weeks, 42 days and a deload at half of week 5", () => {
  assert.deepStrictEqual(model.weeks.length, 6);
  assert.deepStrictEqual(model.days.length, 42);
  assert.deepStrictEqual(model.today, TODAY);
  assert.deepStrictEqual(defaultAnchor(model), TODAY);
  assert.deepStrictEqual(model.weeks[4].planned, 2940);
  assert.deepStrictEqual(model.weeks[5].planned, 1470);
  assert.deepStrictEqual(model.weeks[5].deload, true);
  assert.deepStrictEqual(model.maxDay, 790);
  assert.deepStrictEqual(model.maxWeek, 2940);
  // Weeks 2 to 4 are the old ribbon's three weeks.
  assert.deepStrictEqual(sampleBlockWeeks.slice(1, 4).map((w) => w.id), [
    "w2",
    "w3",
    "w4",
  ]);
  assert.deepStrictEqual(sampleWeeks.map((w) => w.id), ["w2", "w3", "w4"]);
});

test("Week level stacks each day: lift under run, fill shares match describe()", () => {
  const f = frame(model, { z: 1, anchor: TODAY }, box);
  const k = ppl(model.maxDay);
  const views = describe(rail[2].days);
  views.forEach((v, i) => {
    const day = model.days[14 + i];
    const ps = pieces(f, 14 + i);
    assert.deepStrictEqual(ps.map((p) => p.kind), [
      ...(v.liftPlanned + v.liftDone > 0 ? ["lift"] : []),
      ...(v.runPlanned + v.runDone > 0 ? ["run"] : []),
    ]);
    for (const p of ps) {
      const size = p.kind === "lift" ? day.liftSize : day.runSize;
      const done = p.kind === "lift" ? v.liftDone : v.runDone;
      assert.ok(Math.abs(p.h - size * k) <= 1e-9);
      assert.ok(Math.abs(p.fillH / p.h - done / size) <= 1e-9);
      assert.deepStrictEqual(p.future, false);
      assert.deepStrictEqual(p.opacity, 1);
      assert(p.w <= MAX_BAR);
      // Lift on the baseline, run stacked on it.
      assert.ok(Math.abs(p.y + p.h - (box.height - (p.kind === "run" ? day.liftSize * k : 0))) <= 1e-9);
    }
  });
  assert.deepStrictEqual(f.window, { start: 14, days: 7 });
  assert.deepStrictEqual(f.dividers, []);
  // Today's chip hangs over today's column.
  assert.deepStrictEqual(f.today?.text, "Today · Lower A");
  assert.deepStrictEqual(f.today?.opacity, 1);
});

test("Month draws the U25 ribbon over four whole weeks: hatched future, quiet flanks, slim bars", () => {
  const f = frame(model, { z: 2, anchor: TODAY }, box);
  assert.deepStrictEqual(f.window.start, 7);
  assert.deepStrictEqual(f.window.days, 28);
  for (let abs = 7; abs < 35; abs++) {
    const week = Math.floor(abs / 7);
    for (const p of pieces(f, abs)) {
      assert.deepStrictEqual(p.future, rail[week].relation === "future", `${p.key}`);
      assert.ok(Math.abs(p.opacity - (week === 2 ? 1 : QUIET)) <= 1e-9);
      assert(p.w <= LEVEL_BAR_MAX[2], `${p.key} is ${p.w}px`);
      if (p.future) assert.deepStrictEqual(p.fillH, 0);
    }
  }
  // Done fills are the part done of each kind.
  const mon = pieces(f, 14)[0];
  assert.ok(Math.abs(mon.fillH / mon.h - 1) <= 1e-9);
  // Three week rules, the ruler names the four weeks.
  assert.deepStrictEqual(f.dividers.length, 3);
  const ruler = f.labels.filter((l) => l.row === "ruler").map((l) => l.text);
  for (const name of ["Week 2", "Week 3", "Week 4", "Week 5"]) {
    assert(ruler.includes(name), name);
  }
  // Today's letter is knocked out, and no glyph rows remain.
  const knock = f.labels.filter((l) => l.knockout && l.opacity > 0);
  assert.deepStrictEqual(knock.map((l) => l.text), ["S"]);
  assert.deepStrictEqual(
    f.labels.every((l) => l.row === "ruler" || l.row === "text"),
    true,
  );
  assert.deepStrictEqual(f.today?.opacity, 1);
  // The chip hides when today's week is not the one in focus.
  assert.deepStrictEqual(frame(model, { z: 2, anchor: 13 }, box).today?.opacity, 0);
});

test("Day level draws a lift piece and a run piece, SESSION_GAP apart", () => {
  const f = frame(model, { z: 0, anchor: TODAY }, box);
  const bars = pieces(f, TODAY);
  assert.deepStrictEqual(bars.map((b) => b.kind), ["lift", "run"]);
  assert.ok(Math.abs(bars[0].x + bars[0].w / 2 - (box.width / 2 - SESSION_GAP / 2)) <= 1e-6);
  assert.ok(Math.abs(bars[1].x + bars[1].w / 2 - (box.width / 2 + SESSION_GAP / 2)) <= 1e-6);
  assert.ok(Math.abs(bars[0].h - 510 * ppl(model.maxDay)) <= 1e-9);
  assert.ok(Math.abs(bars[1].h - 240 * ppl(model.maxDay)) <= 1e-9);
  // Both sit on the baseline with a full cap. The lift is done and the run is
  // still to come. A lone day is wide, so its bars are the thickest a level
  // allows.
  for (const b of bars) {
    assert.deepStrictEqual(b.w, LEVEL_BAR_MAX[0]);
    assert.ok(Math.abs(b.y + b.h - box.height) <= 1e-9);
    assert.deepStrictEqual(b.cap, 1);
  }
  assert.ok(Math.abs(bars[0].fillH - bars[0].h) <= 1e-9);
  assert.deepStrictEqual(bars[1].fillH, 0);
  const names = f.labels.filter((l) => l.row === "text" && l.opacity === 1)
    .map((l) => l.text);
  assert(names.includes("Lower A") && names.includes("Easy run"));
  assert.deepStrictEqual(f.today?.opacity, 1);
});

test("Block draws each week as its lift under its run", () => {
  const f = frame(model, { z: 3, anchor: TODAY }, box);
  const k = ppl(model.maxWeek);
  const weeks = f.bars.filter((b) => b.layer === "week");
  assert.deepStrictEqual(weeks.length, 12);
  model.weeks.forEach((w, i) => {
    const lift = weeks.find((b) => b.key === `w${i}-lift`)!;
    const run = weeks.find((b) => b.key === `w${i}-run`)!;
    assert.ok(Math.abs(lift.h - w.liftSize * k) <= 1e-9);
    assert.ok(Math.abs(run.h - w.runSize * k) <= 1e-9);
    assert.ok(Math.abs(lift.y + lift.h - box.height) <= 1e-9);
    assert.ok(Math.abs(run.y + run.h - lift.y) <= 1e-9);
    assert.ok(Math.abs(lift.fillH / lift.h - (w.relation === "future" ? 0 : w.liftDone / w.liftSize)) <= 1e-9);
    assert.ok(Math.abs(lift.x + lift.w / 2 - (i + 0.5) * (box.width / 6)) <= 1e-6);
    assert.deepStrictEqual([lift.cap, run.cap], [0, 1]);
    assert.deepStrictEqual([lift.future, run.future], [
      w.relation === "future",
      w.relation === "future",
    ]);
    assert.deepStrictEqual(lift.opacity, 1);
  });
  assert.deepStrictEqual(
    f.bars.filter((b) => b.opacity > 0.01 && b.layer !== "week"),
    [],
  );
  const numbers = f.labels.filter((l) => l.row === "text" && l.opacity === 1);
  assert.deepStrictEqual(numbers.map((l) => l.text), ["1", "2", "3", "4", "5", "D"]);
  // The current week's number is the one knocked out.
  assert.deepStrictEqual(numbers.filter((l) => l.knockout).map((l) => l.text), ["3"]);
  assert.deepStrictEqual(f.today?.opacity, 0);
});

const SPEC = (b: Bar) => [b.x, b.y, b.w, b.h, b.fillH];

test("continuity: no bar jumps across a level boundary", () => {
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

test("continuity: no bar teleports anywhere along the zoom", () => {
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

test("conservation: a week's stacked days add up to its Block pieces", () => {
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
        assert.ok(Math.abs(sum - want * k) <= 1e-6);
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
  assert.ok(Math.abs(lifts[0].y + lifts[0].h - box.height) <= 1e-6);
  for (let i = 1; i < lifts.length; i++) {
    assert.ok(Math.abs(lifts[i].y + lifts[i].h - lifts[i - 1].y) <= 1e-6);
  }
  const runs = of("run");
  assert.ok(Math.abs(runs[0].y + runs[0].h - (box.height - week.liftSize * k)) <= 1e-6);
  for (let i = 1; i < runs.length; i++) {
    assert.ok(Math.abs(runs[i].y + runs[i].h - runs[i - 1].y) <= 1e-6);
  }
  // Only the top of the column keeps its cap.
  const capped = [...lifts, ...runs].filter((b) => b.cap > 0.5);
  assert.deepStrictEqual(capped.map((b) => b.key), [`p${TODAY}-run`]);
});

test("no two pieces overlap at any point of the Day to Block zoom", () => {
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

test("limits: bars stay within their level's cap and nothing is NaN, at any zoom", () => {
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
            if (bar.future) assert.deepStrictEqual(bar.fillH, 0);
          }
          for (const l of f.labels) assert(Number.isFinite(l.x + l.opacity));
          for (const h of f.hits) assert(Number.isFinite(h.x + h.w + h.top));
          if (f.today) assert(Number.isFinite(f.today.x + f.today.top));
        }
      }
    }
  }
  assert.deepStrictEqual(frame(blockModel([]), { z: 1, anchor: 0 }, box).bars, []);
});

test("a rest day is one dash labeled Rest, caption Today · rest", () => {
  const m = blockModel(withRail(sampleBlockWeeks, restDayStages));
  const day = m.days[TODAY];
  assert.deepStrictEqual(day.state, "rest");
  assert.deepStrictEqual(day.today, true);
  const f = frame(m, { z: 0, anchor: TODAY }, box);
  const mine = f.bars.filter((b) => b.slot === TODAY);
  assert.deepStrictEqual(mine.length, 1);
  assert.deepStrictEqual(mine[0].layer, "day");
  assert.deepStrictEqual(mine[0].kind, "rest");
  assert.deepStrictEqual(mine[0].h, REST_H);
  assert.deepStrictEqual(mine[0].opacity, 1);
  const labels = f.labels.filter((l) => l.row === "text" && l.opacity === 1);
  assert.deepStrictEqual(labels.map((l) => l.text), ["Rest"]);
  assert.deepStrictEqual(f.today?.text, "Today · Rest");
  assert.deepStrictEqual(describeInspected(m, 0, TODAY, TODAY).text, "Today · rest");
  // Zoomed out it stacks nothing: the dash is already the slot's rest mark.
  const week = frame(m, { z: 1, anchor: TODAY }, box).bars.find((b) =>
    b.slot === TODAY
  )!;
  assert.deepStrictEqual(week.kind, "rest");
  assert.deepStrictEqual(week.h, REST_H);
});

test("the rail decides today's done state: lift and run stages", () => {
  const today = (weeks: WeekLoad[]) => weeks[2].days[6];
  const base = today(rail);
  assert.deepStrictEqual([base.liftDone, base.runDone], [510, 0]);
  assert.deepStrictEqual([base.liftPlanned, base.runPlanned], [510, 240]);

  const liftNow = withRail(sampleBlockWeeks, [
    stage("lift", "now"),
    stage("run", "later"),
  ]);
  assert.deepStrictEqual([today(liftNow).liftDone, today(liftNow).runDone], [0, 0]);

  const liftDone = withRail(sampleBlockWeeks, [
    stage("lift", "done"),
    stage("run", "later"),
  ]);
  assert.deepStrictEqual([today(liftDone).liftDone, today(liftDone).runDone], [510, 0]);

  const runDone = withRail(sampleBlockWeeks, [
    stage("lift", "done"),
    stage("run", "done"),
  ]);
  assert.deepStrictEqual([today(runDone).liftDone, today(runDone).runDone], [510, 240]);
  assert.deepStrictEqual(today(runDone).label, "Lower A");

  // Other days and the series itself are left alone.
  assert.deepStrictEqual(rail[2].days.slice(0, 6), sampleBlockWeeks[2].days.slice(0, 6));
  assert.deepStrictEqual(sampleBlockWeeks[2].days[6].liftDone, 510);

  // A day with no lift or run stage has no load.
  const rest = today(withRail(sampleBlockWeeks, restDayStages));
  assert.deepStrictEqual(
    [rest.liftPlanned, rest.runPlanned, rest.liftDone, rest.runDone],
    [0, 0, 0, 0],
  );
  assert.deepStrictEqual(rest.label, undefined);
});

test("week totals of the rail's week 3 match the phone's strip", () => {
  const t = weekTotals(rail[2].days);
  assert.deepStrictEqual(t, weekTotals(sampleWeekLoad));
  assert.deepStrictEqual(t.liftDone, 1760);
  assert.deepStrictEqual(t.runDone, 480);
  assert.deepStrictEqual(t.planned, 1760 + 1020);
  assert.deepStrictEqual(t.done, 2240);
});

test("captions at each level", () => {
  assert.deepStrictEqual(
    describeInspected(model, 0, TODAY, TODAY).text,
    "Today · Lower A · 510 done · Easy run 240 planned",
  );
  assert.deepStrictEqual(
    describeInspected(model, 1, TODAY, TODAY).text,
    "Today · Lower A · 510 of 750 done",
  );
  assert.deepStrictEqual(
    describeInspected(model, 1, 14, TODAY).text,
    "Monday · Upper A · 420 done",
  );
  // Another week's day names its week at Month.
  assert.deepStrictEqual(
    describeInspected(model, 2, 21, TODAY).text,
    "Week 4 · Monday · Upper A · 430 planned",
  );
  assert.deepStrictEqual(
    describeInspected(model, 3, TODAY, TODAY).text,
    "Week 3 · 2,240 done of 2,780 planned",
  );
  assert.deepStrictEqual(
    describeInspected(model, 3, 35, TODAY).text,
    "Week 6 · deload · 1,470 planned",
  );
  assert.deepStrictEqual(
    totalLine(model, 1, TODAY),
    "Week 3: 2,240 done of 2,780 planned",
  );
  assert.deepStrictEqual(totalLine(model, 0, 3), "Week 1: 2,490 of 2,510 done");
  assert(totalLine(model, 3, TODAY).startsWith("Block: "));
});

test("the table matches the level: days, then weeks for Block", () => {
  const rows = (level: Level) => tableFor(model, level, TODAY);
  assert.deepStrictEqual(rows(0).rows.length, 1);
  assert.deepStrictEqual(rows(1).rows.length, 7);
  assert.deepStrictEqual(rows(2).rows.length, 28);
  assert.deepStrictEqual(rows(3).rows.length, 6);
  assert.deepStrictEqual(rows(1).rows[6][0], "Week 3 (today)");
  assert.deepStrictEqual(rows(3).head[0], "Week");
  assert.deepStrictEqual(restWindow(model, 2, TODAY), { start: 7, days: 28 });
});

test("snap and pinch mapping", () => {
  assert.deepStrictEqual(snapLevel(1.49), 1);
  assert.deepStrictEqual(snapLevel(1.5), 2);
  assert.deepStrictEqual(snapLevel(-4), 0);
  assert.deepStrictEqual(snapLevel(9), 3);
  assert.deepStrictEqual(zFromPinch(1, 1), 1);
  assert.ok(Math.abs(zFromPinch(1, 1.8) - 0) <= 1e-9);
  assert.ok(Math.abs(zFromPinch(1, 1 / 1.8) - 2) <= 1e-9);
  assert.deepStrictEqual(zFromPinch(0.5, 100), 0);
  assert.deepStrictEqual(zFromPinch(2.5, 0.001), 3);
  assert.deepStrictEqual(zFromPinch(1.5, 0), 1.5);
  assert.deepStrictEqual(easeOutQuart(0), 0);
  assert.deepStrictEqual(easeOutQuart(1), 1);
  assert.ok(Math.abs(easeOutQuart(0.5) - (1 - 0.5 ** 4)) <= 1e-12);
  assert.deepStrictEqual(tweenMs(0, 1), 380);
  assert.deepStrictEqual(tweenMs(0, 3), 900);
  assert.deepStrictEqual(tweenMs(2, 1), 380);
});

test("pan steps and clamping", () => {
  assert.deepStrictEqual([0, 1, 2, 3].map(panStep), [1, 7, 7, 0]);
  assert.deepStrictEqual(panAnchor(model, 20, 0, 1), 21);
  assert.deepStrictEqual(panAnchor(model, 20, 0, -1), 19);
  assert.deepStrictEqual(panAnchor(model, 0, 0, -1), 0);
  assert.deepStrictEqual(panAnchor(model, 41, 0, 1), 41);
  assert.deepStrictEqual(panAnchor(model, 20, 1, 1), 27);
  assert.deepStrictEqual(panAnchor(model, 20, 2, -1), 13);
  assert.deepStrictEqual(panAnchor(model, 39, 1, 1), 39);
  assert.deepStrictEqual(panAnchor(model, 3, 2, -1), 3);
  assert.deepStrictEqual(panAnchor(model, 20, 3, 1), 20);
  assert.deepStrictEqual(inspectDay(model, 2), TODAY);
  assert.deepStrictEqual(inspectDay(model, 1), 13);
  assert.deepStrictEqual(inspectDay(model, 3), 21);
  assert.deepStrictEqual(stepInspect(model, 1, 20, 1), 21);
  assert.deepStrictEqual(stepInspect(model, 1, 41, 1), 41);
  assert.deepStrictEqual(stepInspect(model, 3, 20, 1), 21);
  assert.deepStrictEqual(stepInspect(model, 3, 20, -1), 13);
  assert.deepStrictEqual(anchorFor(model, 1, 20, 21), 21);
  assert.deepStrictEqual(anchorFor(model, 1, 20, 19), 20);
  assert.deepStrictEqual(anchorFor(model, 0, 20, 19), 19);
  assert.deepStrictEqual(parseZ("?z=1.5"), 1.5);
  assert.deepStrictEqual(parseZ("?shell=phone&z=9"), 3);
  assert.deepStrictEqual(parseZ("?z=abc"), null);
  assert.deepStrictEqual(parseZ(""), null);
});

test("the Month window clamps at the block's ends", () => {
  const first = frame(model, { z: 2, anchor: 0 }, box);
  assert.deepStrictEqual(first.window.start, 0);
  const anchorWeek = first.bars.filter((b) => b.layer === "day" && b.slot < 7);
  assert(anchorWeek.every((b) => b.opacity === 1));
  const second = first.bars.filter((b) =>
    b.layer === "day" && b.slot >= 7 &&
    b.slot < 21
  );
  assert(second.every((b) => Math.abs(b.opacity - QUIET) < 1e-9));
  assert.deepStrictEqual(frame(model, { z: 2, anchor: 41 }, box).window.start, 14);
  assert.deepStrictEqual(frame(model, { z: 2, anchor: 13 }, box).window.start, 0);
  assert.deepStrictEqual(frame(model, { z: 2, anchor: 34 }, box).window.start, 14);
  // In between, the week before the focus week leads.
  assert.deepStrictEqual(frame(model, { z: 2, anchor: 20 }, box).window.start, 7);
  // Day and Week follow the anchor exactly.
  assert.deepStrictEqual(frame(model, { z: 0, anchor: 41 }, box).window.start, 41);
  assert.deepStrictEqual(frame(model, { z: 1, anchor: 41 }, box).window.start, 35);
});

test("a pan in flight keeps the picture still, then eases to the new week", () => {
  const count = model.days.length;
  const shift = centerShift(count, 1, 20, 27);
  assert.deepStrictEqual(shift, -7);
  assert.deepStrictEqual(cameraCenter(count, 1, 20), 17.5);
  const still = frame(model, { z: 1, anchor: 20 }, box);
  const flip = frame(model, { z: 1, anchor: 27, offset: shift }, box);
  assert.deepStrictEqual(flip.window, still.window);
  const done = frame(model, { z: 1, anchor: 27, offset: 0 }, box);
  assert.deepStrictEqual(done.window.start, 21);
  const mid = frame(model, { z: 1, anchor: 27, offset: shift / 2 }, box);
  assert.ok(Math.abs(mid.window.start - 17.5) <= 1e-9);
});

test("the pointer lands on the slot under it, or the nearest", () => {
  const f = frame(model, { z: 1, anchor: TODAY }, box);
  assert.deepStrictEqual(hitAt(f, 10)?.day, 14);
  assert.deepStrictEqual(hitAt(f, 299)?.day, TODAY);
  assert.deepStrictEqual(hitAt(f, 150)?.day, 17);
  assert.deepStrictEqual(hitAt(f, -50)?.day, 14);
  const block = frame(model, { z: 3, anchor: TODAY }, box);
  assert.deepStrictEqual(block.hits.length, 6);
  assert.deepStrictEqual(hitAt(block, 160)?.week, 3);
  assert.deepStrictEqual(hitAt(block, 160)?.day, 21);
  // A slot carries the top of its pieces, for the tooltip.
  const today = f.hits.find((h) => h.day === TODAY)!;
  const tallest = Math.min(...pieces(f, TODAY).map((b) => b.y));
  assert.ok(Math.abs(today.top - tallest) <= 1e-9);
  assert.ok(Math.abs(f.today!.top - tallest) <= 1e-9);
});

test("today's chip fades before it reaches the chart's edge", () => {
  // Between Day and Week, today's column sits past the right edge.
  const f = frame(model, { z: 0.5, anchor: TODAY }, box);
  assert(f.today !== null && f.today.x > box.width);
  assert.deepStrictEqual(f.today.opacity, 0);
  // At rest it is fully in.
  assert.deepStrictEqual(frame(model, { z: 1, anchor: TODAY }, box).today?.opacity, 1);
});

test("the title follows the zoom", () => {
  const name = "Strength block";
  const t = (level: Level, anchor: number) =>
    zoomTitle(model, level, anchor, name);
  assert.deepStrictEqual(t(0, TODAY), "Today");
  assert.deepStrictEqual(t(0, 19), "Saturday");
  assert.deepStrictEqual(t(0, 21), "Monday, week 4");
  assert.deepStrictEqual(t(1, TODAY), "This week");
  assert.deepStrictEqual(t(1, 13), "Last week");
  assert.deepStrictEqual(t(1, 21), "Next week");
  assert.deepStrictEqual(t(1, 35), "Week 6");
  assert.deepStrictEqual(t(1, 0), "Week 1");
  // Month names the focus week's month, not the weeks it shows.
  assert.deepStrictEqual(t(2, TODAY), "September");
  assert.deepStrictEqual(t(2, 0), "August");
  assert.deepStrictEqual(t(2, 41), "October");
  assert.deepStrictEqual(t(3, TODAY), name);
  const one = blockModel([sampleBlockWeeks[1]]);
  assert.deepStrictEqual(zoomTitle(one, 2, 0, name), "September");
});

test("a week belongs to the month holding most of its days", () => {
  assert.deepStrictEqual(monthOf("Sep 7-13"), "September");
  assert.deepStrictEqual(monthOf("Aug 31-Sep 6"), "September");
  assert.deepStrictEqual(monthOf("Aug 25-31"), "August");
  assert.deepStrictEqual(monthOf("Sep 28-Oct 4"), "October");
  assert.deepStrictEqual(monthOf("Sep 27-Oct 3"), "September");
  assert.deepStrictEqual(monthOf("soon"), null);
});

test("tooltips name the session and label the numbers", () => {
  assert.deepStrictEqual(tipFor(model, 1, TODAY, TODAY), {
    title: "Today · Lower A",
    numbers: "lift + run · 510 of 750 load",
  });
  assert.deepStrictEqual(tipFor(model, 1, 14, TODAY), {
    title: "Monday · Upper A",
    numbers: "lift · 420 load",
  });
  assert.deepStrictEqual(tipFor(model, 2, 21, TODAY), {
    title: "Week 4 · Monday · Upper A",
    numbers: "lift · 430 planned load",
  });
  assert.deepStrictEqual(tipFor(model, 1, 19, TODAY).numbers, "run · 170 of 290 load");
  assert.deepStrictEqual(tipFor(model, 3, TODAY, TODAY), {
    title: "Week 3",
    numbers: "lift + run · 2,240 of 2,780 load",
  });
  assert.deepStrictEqual(tipFor(model, 3, 35, TODAY), {
    title: "Week 6 · deload",
    numbers: "lift + run · 1,470 planned load",
  });
  const rest = blockModel(withRail(sampleBlockWeeks, restDayStages));
  assert.deepStrictEqual(tipFor(rest, 1, TODAY, TODAY).numbers, "rest");
  assert.deepStrictEqual(tipAlign(10, 300), "start");
  assert.deepStrictEqual(tipAlign(150, 300), "center");
  assert.deepStrictEqual(tipAlign(290, 300), "end");
});
