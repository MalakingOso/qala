/* Landing page (DESIGN 7.17) for tailnet visitors: headline, one
 * paragraph, Open Qala + How it decides, four sections from real screen
 * fragments, AGPL + liftosaur credit in the footer. No testimonials. */

import { Card, PrimaryButton, SecondaryButton } from "../../shared/ui.tsx";

export function LandingPage() {
  return (
    <div className="page">
      <div className="landing-hero">
        <h1 className="title">Lift and run from one plan.</h1>
        <p>
          Qala is a self-hosted training app: barbell programs as text, GPS run
          recording, and one fatigue model across both, with a local coach that
          can only nudge inside fixed limits.
        </p>
        <div className="row-btns">
          <PrimaryButton href="#/phone/today">Open Qala</PrimaryButton>
          <SecondaryButton href="#how-it-decides">
            How it decides
          </SecondaryButton>
        </div>
      </div>
      <div className="landing-grid">
        <Card title="How it decides">
          <p id="how-it-decides">
            Check-in, readiness, and per-muscle fatigue set the day's weights.
            Every adjusted number shows its reason in one line.
          </p>
        </Card>
        <Card title="Plans">
          <p>
            Strength, hypertrophy, or meet prep as liftoscript text you can read
            and edit. Runs live beside the lifts in one week.
          </p>
        </Card>
        <Card title="Running">
          <p>
            Time, distance, pace, splits, route with mile markers, audio cues,
            and guided workouts. Leg fatigue feeds the next lift.
          </p>
        </Card>
        <Card title="Coach">
          <p>
            Open conversation inside training topics. Suggestions arrive as
            engine-vs-coach cards; one tap reverts.
          </p>
        </Card>
      </div>
      <footer>
        <p className="kbd-hint">
          Qala is AGPL-3.0. Program language and exercise data build on
          liftosaur (AGPL-3.0).
        </p>
        <p>
          <a className="link-btn" href="#/desktop/programs">
            Desktop author shell
          </a>
        </p>
      </footer>
    </div>
  );
}
