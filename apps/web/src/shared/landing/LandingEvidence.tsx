/* The "Grounded in the literature" section (DESIGN 7.17). Two halves: the
 * published work the engine is built from (cards with citations), and what
 * you can actually do with it, shown as three tabs — Lifting, Running,
 * Coach — each pairing a real Android capture with its desktop view. The
 * images are taken from the built PWA (apps/web/src/shared/landing/*.webp). */

import { useState } from "react";
import desktopLifts from "./desktop-lifts.webp";
import desktopRunning from "./desktop-running.webp";
import desktopMemory from "./desktop-memory.webp";
import phoneWorkout from "./phone-workout.webp";
import phoneRun from "./phone-run.webp";
import phoneCoach from "./phone-coach.webp";

interface Source {
  tag: string;
  title: string;
  body: string;
  cite: string;
}

const SOURCES: Source[] = [
  {
    tag: "Model",
    title: "The fitness-fatigue model",
    body:
      "Training is modelled as two states pulling against each other: " +
      "fitness, which builds over weeks and decays slowly, and fatigue, " +
      "which spikes after a session and fades in days. Performance is what " +
      "is left when they meet.",
    cite: "Calvert & Banister 1976 · Busso 2003 · Hellard 2006",
  },
  {
    tag: "Estimate",
    title: "A Kalman filter on your e1RM",
    body:
      "A lifter's log is sparse and noisy, and the two time constants are " +
      "hard to pin down from one person's data. Qala fixes them and " +
      "estimates only your starting strength and gains, with a Kalman " +
      "update — the fix that cut prediction error from 3.35% to 2.31% in " +
      "the literature.",
    cite: "Imbach 2025, Sci Rep · Kolossa 2017, IJCSS",
  },
  {
    tag: "Readiness",
    title: "Readiness from a two-tap check-in",
    body:
      "No wearable required. A perceived-recovery tap and a per-muscle " +
      "soreness grid set the day's readiness, scored against your own " +
      "rolling baseline rather than a population average.",
    cite: "Laurent 2011 · Hooper & Mackinnon 1995 · Zourdos 2016",
  },
  {
    tag: "Adapt",
    title: "Autoregulation, with a cap",
    body:
      "When a set lands off target, the next one moves 2% per half-point " +
      "of RPE, capped at ±6% — the rule that beat fixed progression in " +
      "trained lifters. Between sessions, double progression adds load or " +
      "reps only when you have earned it.",
    cite: "Helms 2018, Front Physiol · Mann 2010 · ACSM 2009",
  },
  {
    tag: "Recover",
    title: "Recovery, tracked per muscle",
    body:
      "Volume, not intensity, sets how long a muscle needs. Qala decays " +
      "fatigue on each muscle's own time constant, so quads still carry " +
      "Friday while chest is ready — and weekly sets are seeded from " +
      "published volume landmarks.",
    cite: "Goulart 2020 · Bartolomei 2017 · RP volume landmarks",
  },
  {
    tag: "Both sports",
    title: "Running and lifting, one model",
    body:
      "The pooled meta-analyses put running's cost to maximal strength " +
      "near zero (−0.06) and to hypertrophy at nothing (−0.01). Qala " +
      "treats them as compatible, protects lower-body power, and schedules " +
      "the lift before the run.",
    cite: "Schumann 2022, Sports Med · Murlasits 2018 · Robineau 2016",
  },
  {
    tag: "Deload",
    title: "Deloads that fire when needed",
    body:
      "A reactive deload comes from the numbers, not a fixed calendar: " +
      "per-muscle when a lift stalls or you report it, systemic when two " +
      "main lifts fall below their four-week trend.",
    cite: "Bell 2024, Sports Med Open · Bell 2023 Delphi",
  },
];

interface Shot {
  img: string;
  alt: string;
  /** Android shell finish for the phone capture. */
  tone?: "dark" | "light";
}

interface Tab {
  id: string;
  label: string;
  title: string;
  body: string;
  bullets: string[];
  phone: Shot;
  desktop: Shot;
}

const TABS: Tab[] = [
  {
    id: "lifting",
    label: "Lifting",
    title: "Plan, log and progress your lifts",
    body:
      "The program, the day's session and the trend all come from the same " +
      "engine — edit the plan in plain text on desktop, log every set on " +
      "the phone.",
    bullets: [
      "A readable LS++ program, edited with a live week preview",
      "Today's top set with readiness and the reason it moved",
      "Per-set RPE, a self-adjusting rest timer and a plate calculator",
      "e1RM tracked against the block's fixed reference 1RM",
    ],
    phone: {
      img: phoneWorkout,
      tone: "light",
      alt:
        "Qala workout screen on an Android phone: set 3 of 3 on Back Squat " +
        "at 245 lb, a coach suggestion to drop to 240 because quads are " +
        "sore, an RPE entry, and a Rest 3:45 note before the next lift.",
    },
    desktop: {
      img: desktopLifts,
      alt:
        "Qala desktop Lifts: +2.5% average e1RM this block, with per-lift " +
        "e1RM charts for squat, bench, deadlift and press against the " +
        "block's reference 1RM.",
    },
  },
  {
    id: "running",
    label: "Running",
    title: "Runs that train the same engine",
    body:
      "A run is load, not a separate app. Distance, pace and GPS feed the " +
      "same fatigue model as your squats, so the plan knows when to back " +
      "off.",
    bullets: [
      "Guided runs with GPS and audio cues, screen off",
      "sRPE and rTSS counted beside your lifting load",
      "VDOT and running fitness tracked over the block",
      "A long run lowers the next squat day's expectation",
    ],
    phone: {
      img: phoneRun,
      tone: "dark",
      alt:
        "Qala run start screen on an Android phone: a GPS route preview, " +
        "GPS status, a cue interval, an easy-run note, and a Start run " +
        "button.",
    },
    desktop: {
      img: desktopRunning,
      alt:
        "Qala desktop Running: a 40.5 VDOT with a six-week fitness line, " +
        "weekly miles, run count and rTSS tiles, a runs table, and last " +
        "run's pace splits.",
    },
  },
  {
    id: "coach",
    label: "Coach",
    title: "A local coach that shows its work",
    body:
      "Coach answers the why, proposes changes inside the engine's limits " +
      "and remembers what matters — and every suggestion passes the same " +
      "clamped envelope as the engine before you accept it.",
    bullets: [
      "Runs on your own hardware, no cloud",
      "Suggested loads beside the engine's, with reasoning",
      "Weight clamped to −10% / +2.5%, sets to −2 / +1",
      "Facts proposed for memory; you accept or reject each",
    ],
    phone: {
      img: phoneCoach,
      tone: "light",
      alt:
        "Qala Coach screen on an Android phone: a suggested squat change " +
        "from 245×4 to 240×4 with the engine and coach values side by side, " +
        "the reasoning, and the clamped limits shown.",
    },
    desktop: {
      img: desktopMemory,
      alt:
        "Qala desktop Coach memory: proposals waiting, the profile the " +
        "coach reads, and a coach log showing clamped and discarded " +
        "adjustments with the limits.",
    },
  },
];

/** A phone capture inside an Android shell: a thin bezel, a centred
 * punch-hole camera, side keys, and the Android gesture bar. */
function PhoneFrame({ shot }: { shot: Shot }) {
  return (
    <figure className={`evidence-device is-android tone-${shot.tone}`}>
      <div className="device-body">
        <div className="device-screen">
          <img src={shot.img} alt={shot.alt} loading="lazy" />
          <span className="device-camera" />
          <span className="device-home" />
        </div>
        <span className="device-key device-key-power" aria-hidden="true" />
        <span className="device-key device-key-volume" aria-hidden="true" />
      </div>
    </figure>
  );
}

export function LandingEvidence() {
  const [active, setActive] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <section
      className="landing-features evidence"
      id="how-it-decides"
      tabIndex={-1}
      aria-labelledby="landing-features-title"
    >
      <div className="landing-section-head">
        <p className="group-label">Grounded in the literature</p>
        <h2 className="title" id="landing-features-title">
          A reason behind every number.
        </h2>
        <p className="evidence-lede">
          Qala's engine is not a black box. Every load it moves traces back to
          published training research — the same models and rules used by
          coaches and sport scientists — and the app shows you the reasoning,
          not just the result.
        </p>
      </div>

      <div className="evidence-sources">
        <h3 className="evidence-subhead">
          <span className="evidence-no">01</span> What the engine is built from
        </h3>
        <div className="evidence-cards">
          {SOURCES.map((s) => (
            <article className="evidence-card" key={s.title}>
              <span className="evidence-tag">{s.tag}</span>
              <h4 className="title">{s.title}</h4>
              <p>{s.body}</p>
              <p className="evidence-cite">{s.cite}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="evidence-app">
        <h3 className="evidence-subhead">
          <span className="evidence-no">02</span> What you can do with it
        </h3>
        <div
          className="evidence-tabs"
          role="tablist"
          aria-label="App areas"
          onKeyDown={(e) => {
            const i = TABS.findIndex((t) => t.id === active);
            if (e.key === "ArrowRight") {
              setActive(TABS[(i + 1) % TABS.length].id);
              e.preventDefault();
            } else if (e.key === "ArrowLeft") {
              setActive(TABS[(i - 1 + TABS.length) % TABS.length].id);
              e.preventDefault();
            } else if (e.key === "Home") {
              setActive(TABS[0].id);
              e.preventDefault();
            } else if (e.key === "End") {
              setActive(TABS[TABS.length - 1].id);
              e.preventDefault();
            }
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`evidence-tab-${t.id}`}
              aria-selected={t.id === active}
              aria-controls={`evidence-panel-${t.id}`}
              tabIndex={t.id === active ? 0 : -1}
              className="evidence-tab"
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          className="evidence-panel"
          role="tabpanel"
          id={`evidence-panel-${tab.id}`}
          aria-labelledby={`evidence-tab-${tab.id}`}
          key={tab.id}
        >
          <div className="evidence-copy">
            <h4 className="title">{tab.title}</h4>
            <p>{tab.body}</p>
            <ul className="evidence-list">
              {tab.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
          <div className="evidence-stage">
            <figure className="evidence-shot is-window">
              <div className="window-bar" aria-hidden="true">
                <span className="window-dot" />
                <span className="window-dot" />
                <span className="window-dot" />
              </div>
              <img src={tab.desktop.img} alt={tab.desktop.alt} loading="lazy" />
            </figure>
            <PhoneFrame shot={tab.phone} />
          </div>
        </div>
      </div>
    </section>
  );
}
