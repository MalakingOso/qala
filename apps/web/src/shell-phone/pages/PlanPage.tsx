/* Plan (DESIGN 7.2, Volt structure): block strip, week arrows, day tabs
 * with glyphs, Start workout, Overview / Details. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import { Card, Group, GroupRow, PrimaryButton, SegmentedControl } from "../../shared/ui.tsx";
import { Bed, ChevronLeft, Dumbbell, SportShoe } from "../../shared/icons.ts";

const DAYS = [
  { d: "Mon", glyph: Bed, title: "Rest", detail: "Walk + mobility as wanted." },
  { d: "Tue", glyph: Dumbbell, title: "Upper A · Bench day", detail: "Bench 4x5 @ 80%, rows, press, curls." },
  { d: "Wed", glyph: SportShoe, title: "Tempo · 4 mi", detail: "2 mi easy, 2 mi near threshold." },
  { d: "Thu", glyph: Dumbbell, title: "Lower B · Deadlift day", detail: "Deadlift 3x3, front squat, hinges." },
  { d: "Fri", glyph: Dumbbell, title: "Upper B · Press day", detail: "Press 3x5, bench variation, back." },
  { d: "Sat", glyph: SportShoe, title: "Long run · 7 mi", detail: "Easy, last mile steady." },
  { d: "Sun", glyph: Dumbbell, title: "Lower A · Squat day", detail: "Squat 3x4 @ 245, RDL, lunges, calves." },
];

export function PlanPage() {
  const { exercises } = useQala();
  const [day, setDay] = useState(6);
  const [view, setView] = useState<"overview" | "details">("overview");
  const [week, setWeek] = useState(3);
  const sel = DAYS[day];
  const SelGlyph = sel.glyph;
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Strength B2</h1>
      </div>
      <Card>
        <p className="group-label">
          <button type="button" className="link-btn" onClick={() => setWeek((w) => Math.max(1, w - 1))} aria-label="Previous week">
            <ChevronLeft size={16} />{" "}
          </button>
          Week {week} of 6
          <button type="button" className="link-btn" onClick={() => setWeek((w) => Math.min(6, w + 1))} aria-label="Next week">
            {" "}›
          </button>
        </p>
        <div style={{ display: "flex", gap: 4 }} aria-label="Block weeks">
          {[1, 2, 3, 4, 5, 6].map((w) => (
            <span
              key={w}
              style={{
                flex: 1,
                height: 8,
                background: w < week ? "var(--progress-fill)" : w === week ? "var(--accent)" : w === 6 ? "var(--bg-active)" : "var(--mark-gray)",
              }}
              title={w === 6 ? "deload" : `week ${w}`}
            />
          ))}
        </div>
      </Card>
      <div className="seg" role="tablist" aria-label="Days">
        {DAYS.map((d, i) => {
          const G = d.glyph;
          return (
            <button key={d.d} type="button" role="tab" aria-selected={i === day} onClick={() => setDay(i)}>
              <G size={16} />
              <br />
              {d.d}
            </button>
          );
        })}
      </div>
      <Card>
        <h2 className="title" style={{ fontSize: 20, margin: "8px 0" }}>
          <SelGlyph size={18} /> {sel.title}
        </h2>
        <p className="kbd-hint">about 75 min with warm-up</p>
        <PrimaryButton href={sel.glyph === Dumbbell ? "#/phone/checkin" : sel.glyph === SportShoe ? "#/phone/run/start" : "#/phone/checkin"}>
          {sel.glyph === Bed ? "Check in (rest day)" : "Start workout"}
        </PrimaryButton>
        <div style={{ marginTop: 12 }}>
          <SegmentedControl
            label="Plan view"
            value={view}
            onPick={setView}
            options={[
              { value: "overview", label: "Overview" },
              { value: "details", label: "Details" },
            ]}
          />
        </div>
        {view === "overview" || sel.glyph !== Dumbbell ? (
          <p>{sel.detail}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            {exercises.map((e) => (
              <div key={e.id} className="group" style={{ margin: 0 }}>
                <div className="group-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  <strong>{e.name}</strong>
                  <span className="kbd-hint">
                    {e.sets.length} x {e.sets[0]?.r} @ {e.sets[0]?.w}
                  </span>
                  {e.note ? <span className="kbd-hint">▦ note waiting</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Group label="This week">
        <GroupRow>
          <span>4 lifts · 3 runs</span>
          <span className="kbd-hint">load 2,600</span>
        </GroupRow>
      </Group>
    </div>
  );
}
