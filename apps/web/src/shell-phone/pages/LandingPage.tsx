/* A wide entry page: the plate-drop intro, an editorial hero with a device
 * morph, and entry points to both shells (DESIGN 7.17). */

import { ArrowRight, TrendingUp } from "../../shared/icons.ts";
import { DeviceMorph } from "../../shared/DeviceMorph.tsx";
import { IntroHero } from "../../shared/intro/IntroHero.tsx";

export function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <a className="brand" href="#/" aria-label="Qala home">
          <img src="/icons/icon-96.png" alt="" width={40} height={40} />
          <span className="brand-name title">
            Qala<em>.</em>
          </span>
        </a>
        <a className="toolbar-link" href="#/desktop/overview">
          Training workspace <ArrowRight size={16} />
        </a>
      </header>
      <main>
        <IntroHero />
        <section className="landing-hero">
          <div className="landing-copy">
            <p className="group-label page-eyebrow">
              Lifting + running / one adaptive plan
            </p>
            <h1 className="title">
              Train with<br />the whole picture.
            </h1>
            <p className="landing-intro">
              Your lifts, your miles, and the recovery between them. Qala brings
              it all into one plan that adapts with you.
            </p>
            <div className="landing-actions">
              <a
                className="btn-primary landing-desktop-entry"
                href="#/desktop/overview"
              >
                Open Qala <ArrowRight size={18} />
              </a>
              <a
                className="btn-primary landing-phone-entry"
                href="#/phone/today"
              >
                Open Qala <ArrowRight size={18} />
              </a>
              <button
                className="toolbar-link"
                type="button"
                onClick={() => {
                  const section = document.getElementById("how-it-decides");
                  section?.scrollIntoView({
                    behavior:
                      window.matchMedia("(prefers-reduced-motion: reduce)")
                          .matches
                        ? "instant"
                        : "smooth",
                  });
                  section?.focus({ preventScroll: true });
                }}
              >
                How it decides <span aria-hidden="true">↓</span>
              </button>
            </div>
            <p className="landing-footnote">
              Self-hosted. Your training stays yours.
            </p>
          </div>
          <DeviceMorph />
        </section>
        <section
          className="landing-features"
          id="how-it-decides"
          tabIndex={-1}
          aria-labelledby="landing-features-title"
        >
          <div className="landing-section-head">
            <p className="group-label">Built around your training</p>
            <h2 className="title" id="landing-features-title">
              A reason behind every number.
            </h2>
          </div>
          <div className="landing-grid">
            <article>
              <span className="feature-number">01 / PLAN</span>
              <h3 className="title">One week. Both sports.</h3>
              <p>
                Barbell programs you can read and edit. Runs beside your lifts
                in the same split, with one fatigue model across both.
              </p>
            </article>
            <article>
              <span className="feature-number">02 / ADAPT</span>
              <h3 className="title">Work with your readiness.</h3>
              <p>
                Your check-in and muscle fatigue shape the day's loads. Every
                adjustment comes with a short explanation.
              </p>
            </article>
            <article>
              <span className="feature-number">03 / UNDERSTAND</span>
              <h3 className="title">See the longer view.</h3>
              <p>
                Follow your strength, running fitness, and recovery. Talk it
                through with Coach, with clear limits on every suggestion.
              </p>
            </article>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <p>
          Qala is AGPL-3.0. Program language and exercise data build on
          liftosaur.
        </p>
        <a className="toolbar-link" href="#/phone/today">
          <TrendingUp size={16} /> Open workout view
        </a>
      </footer>
    </div>
  );
}
