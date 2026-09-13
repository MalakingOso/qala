// filter_test.ts: synthetic distance fixtures + jara regression cases.

import { filterFixes, FixFilter } from "./filter.ts";
import { assert, assertClose, lineFixes } from "./testutil.ts";

Deno.test("straight 300 m line measures within 1%", () => {
  const pts = filterFixes(lineFixes({ count: 101, speedMps: 3 }));
  assert(pts.length === 101, `all fixes accepted, got ${pts.length}`);
  assertClose(pts[pts.length - 1].distM, 300, 3, "total distance");
});

Deno.test("jara dup: the same fix delivered twice counts once", () => {
  const base = lineFixes({ count: 60, speedMps: 3 });
  const doubled: typeof base = [];
  for (const f of base) doubled.push(f, { ...f });
  const a = filterFixes(base);
  const b = filterFixes(doubled);
  assert(b.length === a.length, `dup run keeps ${b.length}, want ${a.length}`);
  assertClose(
    b[b.length - 1].distM,
    a[a.length - 1].distM,
    1e-6,
    "dup run distance identical",
  );
});

Deno.test("jara accuracy: a 60 m fix is dropped", () => {
  const base = lineFixes({ count: 60, speedMps: 3 });
  const corrupted = base.map((f, i) =>
    i === 30 ? { ...f, lat: f.lat + 0.002, acc: 60 } : f
  );
  const a = filterFixes(base);
  const b = filterFixes(corrupted);
  assert(
    b.length === a.length - 1,
    `bad fix dropped: ${b.length} vs ${a.length}`,
  );
  assertClose(
    b[b.length - 1].distM,
    a[a.length - 1].distM,
    1,
    "bad fix leaves distance alone",
  );
});

Deno.test("speed gate: a lone 200 m jump is rejected", () => {
  const base = lineFixes({ count: 100, speedMps: 3 });
  const jump = {
    ...base[50],
    t: base[50].t,
    lat: base[50].lat + 200 / 111319.49,
    acc: 5,
  };
  const withJump = [...base.slice(0, 50), jump, ...base.slice(50)];
  const pts = filterFixes(withJump);
  assert(pts.length === 100, `jump rejected, got ${pts.length} points`);
  assertClose(pts[pts.length - 1].distM, 297, 3, "distance excludes the jump");
  assert(
    pts.every((p) => p.gap !== true),
    "no gap flag without a re-anchor",
  );
});

Deno.test("speed gate: 3 consecutive fixes re-anchor without counting the jump", () => {
  const base = lineFixes({ count: 50, speedMps: 3 });
  const moved = lineFixes({
    count: 6,
    speedMps: 3,
    t0: 50,
    startLat: base[0].lat + 500 / 111319.49,
  });
  const pts = filterFixes([...base, ...moved]);
  // 50 base + 3 re-anchor tail + 3 followers = 56.
  assert(pts.length === 56, `re-anchored, got ${pts.length} points`);
  const gaps = pts.filter((p) => p.gap === true);
  assert(gaps.length === 1, `exactly one gap, got ${gaps.length}`);
  // Base leg ~147 m plus ~15 m of new leg; the 500 m jump is not counted.
  assertClose(pts[pts.length - 1].distM, 147 + 15, 5, "jump excluded");
});

Deno.test("jara long run: 4 h at 1 Hz keeps its first point", () => {
  const pts = filterFixes(lineFixes({ count: 14400, speedMps: 2.5 }));
  assert(pts.length === 14400, `no point cap, got ${pts.length}`);
  assert(pts[0].t === 0, "first point kept");
  assertClose(
    pts[pts.length - 1].distM,
    2.5 * 14399,
    2.5 * 14399 * 0.01 + 1,
    "4 h distance",
  );
});

Deno.test("streaming in batches matches one-shot filtering", () => {
  const fixes = lineFixes({ count: 300, speedMps: 3.2 });
  const batch = filterFixes(fixes);
  const stream = new FixFilter();
  for (let i = 0; i < fixes.length; i += 7) {
    for (const f of fixes.slice(i, i + 7)) stream.push(f);
  }
  assert(stream.points.length === batch.length, "same point count");
  for (let i = 0; i < batch.length; i++) {
    assertClose(stream.points[i].distM, batch[i].distM, 1e-9, `dist ${i}`);
    assert(stream.points[i].t === batch[i].t, `time ${i}`);
  }
});
