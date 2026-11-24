/* A wide entry page. The plate-drop intro is the full-screen first view;
 * the first downward scroll (or the scroll hint) hands off to the page: the
 * plate shrinks and travels into the nav bar, becoming the Q mark, while
 * the nav fades in and the content rises. The intro then unmounts, so
 * scrolling back up never brings it back. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "../icons.ts";
import { DeviceMorph } from "../DeviceMorph.tsx";
import { IntroHero } from "../intro/IntroHero.tsx";
import { LandingEvidence } from "./LandingEvidence.tsx";
import { LandingLife } from "./LandingLife.tsx";

const TRANSITION_MS = 900;
/* The plate's centre and width as a fraction of the clip (shared/intro/
 * intro.json), used to aim the docking scale at the nav mark. */
const PLATE_CX = 0.5;
const PLATE_CY = 0.67;
const PLATE_W = 0.387;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LandingPage() {
  const [phase, setPhase] = useState<"intro" | "content">("intro");
  const [docking, setDocking] = useState(false);
  const started = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const introRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLImageElement>(null);

  const beginTransition = useCallback(() => {
    if (started.current) return;
    started.current = true;
    if (prefersReducedMotion()) {
      setPhase("content");
      window.scrollTo(0, 0);
      return;
    }
    // Aim the plate at the nav mark: scale it to the mark's width and move
    // its centre onto the mark's centre.
    const figure = introRef.current?.querySelector<HTMLElement>(".intro-hero");
    const mark = markRef.current;
    if (figure && mark) {
      const p = figure.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      if (p.width > 0 && m.width > 0) {
        const scale = m.width / (p.width * PLATE_W);
        const plateX = p.left + p.width * PLATE_CX;
        const plateY = p.top + p.height * PLATE_CY;
        figure.style.transformOrigin = `${PLATE_CX * 100}% ${PLATE_CY * 100}%`;
        figure.style.setProperty("--dock-x", `${m.left + m.width / 2 - plateX}px`);
        figure.style.setProperty("--dock-y", `${m.top + m.height / 2 - plateY}px`);
        figure.style.setProperty("--dock-s", String(scale));
      }
    }
    setDocking(true);
    timer.current = window.setTimeout(() => {
      setPhase("content");
      window.scrollTo(0, 0);
    }, TRANSITION_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Hold the page still while the intro stands; release it for the content.
  useEffect(() => {
    if (phase === "content") return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = prev;
    };
  }, [phase]);

  // A downward scroll (wheel, touch or key) hands off from the intro.
  useEffect(() => {
    if (phase !== "intro" || docking) return;
    let startY = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 2) beginTransition();
    };
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY - e.touches[0].clientY > 24) beginTransition();
    };
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowDown" || e.key === "PageDown" || e.key === " " ||
        e.key === "End"
      ) {
        beginTransition();
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [phase, docking, beginTransition]);

  const chromeShown = phase === "content" || docking;
  const mainInert = phase === "intro";

  return (
    <div
      className="landing-page"
      data-phase={phase}
      data-docking={docking || undefined}
    >
      <header
        className="landing-header landing-topbar"
        aria-hidden={!chromeShown}
      >
        <div className="landing-topbar-inner">
          <a
            className="brand"
            href="#/"
            aria-label="Qala home"
            tabIndex={chromeShown ? 0 : -1}
          >
            <img
              ref={markRef}
              src="/icons/icon-96.png"
              alt=""
              width={40}
              height={40}
            />
            <span className="brand-name title">
              Qala<em>.</em>
            </span>
          </a>
          <a
            className="toolbar-link"
            href="#/desktop/overview"
            tabIndex={chromeShown ? 0 : -1}
          >
            Training workspace <ArrowRight size={16} />
          </a>
        </div>
      </header>
      <main inert={mainInert ? true : undefined}>
        <section className="landing-hero">
          <div className="landing-copy">
            <p className="group-label page-eyebrow">
              Self-hosted lifting + running
            </p>
            <h1 className="title">
              Lift and run<br />from one plan.
            </h1>
            <p className="landing-intro">
              Pick a built-in program on your phone, or write your own as plain
              text on desktop. Qala tracks your lifts and your runs in the same
              fatigue model, so a hard long run shows up in your readiness and
              your rest times.
            </p>
            <p className="landing-evidence">
              Before a session you log a quick recovery check-in. A local
              engine built from published training research sets your rest from
              your soreness, fatigue and recent sets, cuts the remaining sets
              when grinds pile up, and says why next to each change.
            </p>
            <div className="landing-actions">
              <a
                className="btn-primary"
                href="#/desktop/overview"
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
              Self-hosted. Your logs stay on your phone. The desktop workspace is a preview on sample data.
            </p>
          </div>
          <DeviceMorph />
        </section>
        <LandingLife />
        <LandingEvidence />
      </main>
      <footer className="landing-footer" inert={mainInert ? true : undefined}>
        <p>
          Qala is AGPL-3.0-or-later. LS++ and the exercise database build on
          liftosaur.
        </p>
      </footer>
      {phase !== "content" && (
        <div className="landing-intro-wrap" ref={introRef}>
          <IntroHero />
          <button
            className="intro-scroll"
            type="button"
            onClick={beginTransition}
          >
            Scroll <span aria-hidden="true">↓</span>
          </button>
        </div>
      )}
    </div>
  );
}
