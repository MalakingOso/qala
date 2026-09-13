/* Warm-up (DESIGN 7.4, PLAN 6.7): General, Soft tissue, Mobility, Ramp sets
 * with plate chips on every step. Coach-practice rules footnoted. */

import { Card, Group, GroupRow, PlateChips, PrimaryButton } from "../../shared/ui.tsx";
import { platesPerSide } from "../../logic/plateShorthand.ts";

const RAMP: { step: string; load: number; reps: string; rest: string; extra?: boolean }[] = [
  { step: "Bar", load: 45, reps: "x 8", rest: "45 s" },
  { step: "Step 2", load: 135, reps: "x 5", rest: "60 s" },
  { step: "Extra step: quads sore", load: 165, reps: "x 5", rest: "60 s", extra: true },
  { step: "Step 3", load: 195, reps: "x 2", rest: "90 s" },
  { step: "Step 4", load: 215, reps: "x 1", rest: "2:00" },
];

export function WarmupPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Warm-up · 15 min</h1>
        <a className="link-btn" href="#/phone/workout">
          Skip
        </a>
      </div>
      <Card hero>
        <p className="group-label">1 · General · 10 min</p>
        <p>
          Bike, easy pace. <span className="kbd-hint">Why 10 min today: top set at 87% of reference 1RM.</span>
        </p>
      </Card>
      <Group label="2 · Soft tissue · foam roller + Theragun">
        <GroupRow>
          <span>Quads · roller · 2:00/side</span>
          <span className="kbd-hint">sore (4)*</span>
        </GroupRow>
        <GroupRow>
          <span>Glutes · Theragun · 1:00/side</span>
          <span className="kbd-hint">preference*</span>
        </GroupRow>
      </Group>
      <Group label="3 · Mobility · 2 drills x 10">
        <GroupRow>
          <span>Bodyweight squats, walking lunges</span>
          <span className="kbd-hint">quads + glutes</span>
        </GroupRow>
        <GroupRow>
          <span>Good mornings, glute bridges</span>
          <span className="kbd-hint">hamstrings</span>
        </GroupRow>
      </Group>
      <Group label="4 · Ramp sets · squat to 245">
        {RAMP.map((r) => (
          <GroupRow key={r.step}>
            <span>
              {r.step}: {r.load} {r.reps} · rest {r.rest}
              <br />
              <PlateChips plates={platesPerSide(r.load)} />
            </span>
            {r.extra ? <span className="chip">extra</span> : null}
          </GroupRow>
        ))}
      </Group>
      <PrimaryButton href="#/phone/workout">Start workout</PrimaryButton>
      <p className="kbd-hint">* coach-practice rule, not a study prescription.</p>
    </div>
  );
}
