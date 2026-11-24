/* The "Grounded in the literature" section (DESIGN 7.17). Two halves: the
 * published work the engine is built from (cards with citations), and what
 * you can actually do with it, shown as three tabs (Lifting, Running,
 * Coach), each pairing an Android capture with its desktop view. The
 * images are captures of the Android app on an emulator and of the desktop
 * workspace (apps/web/src/shared/landing/*.webp). */

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
      "Training is modeled as two states: fitness builds over weeks and " +
      "decays slowly, while fatigue spikes after a session and fades in " +
      "days. Performance is fitness minus fatigue.",
    cite: "Calvert & Banister 1976 · Busso 2003 · Hellard 2006",
  },
  {
    tag: "Estimate",
    title: "A Kalman filter on your e1RM",
    body:
      "A lifter's log is sparse and noisy, and the two time constants are " +
      "hard to fit from one person's data. Qala fixes those constants and " +
      "updates your starting strength and gains with a Kalman filter, the " +
      "formulation that cut prediction error from 3.35% to 2.31% in " +
      "published tests.",
    cite: "Imbach 2025, Sci Rep · Kolossa 2017, IJCSS",
  },
  {
    tag: "Readiness",
    title: "Readiness from a two-tap check-in",
    body:
      "A perceived-recovery score and a per-muscle soreness check-in set " +
      "the day's readiness without a wearable. Scores are compared against " +
      "your own four-week rolling baseline instead of a population average.",
    cite: "Laurent 2011 · Hooper & Mackinnon 1995 · Zourdos 2016",
  },
  {
    tag: "Adapt",
    title: "Autoregulation on grinds",
    body:
      "Reported RPE tells the engine how hard a set really was. When a " +
      "grind (RPE 9.5 or more, or reps below the range) follows another " +
      "grind or would push the rest past its cap, Qala lowers the weight on " +
      "the remaining sets 5%, or 10% at RPE 10 or a miss, and drops those " +
      "sets after a lowering. The thresholds are Qala's own; the idea of " +
      "adjusting load by RPE comes from the work cited.",
    cite: "Helms 2018, Front Physiol · Mann 2010 · ACSM 2009",
  },
  {
    tag: "Recover",
    title: "Recovery, tracked per muscle",
    body:
      "Recovery time tracks volume more closely than load. Qala decays " +
      "fatigue on each muscle's own time constant, so quads can still carry " +
      "Friday's session while chest is ready.",
    cite: "Goulart 2020 · Bartolomei 2017",
  },
  {
    tag: "Both sports",
    title: "Running and lifting, one model",
    body:
      "Pooled meta-analyses put running's cost to maximal strength near " +
      "zero (−0.06) and to hypertrophy near zero (−0.01). So Qala counts a " +
      "run as fatigue in the same model, and a lower-body lift less than " +
      "eight hours after a run of 30 minutes or more counts for less in " +
      "your e1RM estimate.",
    cite: "Schumann 2022, Sports Med · Murlasits 2018 · Robineau 2016",
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
      "Start with a built-in program, GZCLP or the Texas Method, on the " +
      "phone. Write your own in plain text with the LS++ editor on desktop.",
    bullets: [
      "Two built-in programs on Android, and a plain-text LS++ editor on desktop with inline checks, formatting and a dry run",
      "Working sets rounded to the plates you own, with Rest saying why it lowered the weight",
      "A plate calculator that shows what to load, a self-adjusting rest timer and per-set RPE",
      "Estimated 1RM (e1RM) tracked per lift across each block",
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
    title: "Runs counted in the same fatigue model",
    body:
      "Runs add to the same systemic and leg fatigue as your lifting. " +
      "Session effort carries into readiness, so a hard run shows up in how " +
      "ready you are for the next lift.",
    bullets: [
      "Run recording on Android with spoken distance and pace cues and an optional Bluetooth heart-rate strap, with the screen off",
      "Run effort (sRPE) counted beside lifting fatigue",
      "Pace splits and running fitness (VDOT) in the desktop workspace",
      "A lower-body lift less than eight hours after a run of 30 minutes or more counts for less in your e1RM estimate",
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
      "Ask why today's weight is what it is or what to do when something " +
      "feels sore. Coach runs on your own server, explains the numbers from " +
      "your current context, and keeps every suggestion inside the engine's " +
      "limits. You decide whether to use it, then change the numbers in the " +
      "workout yourself.",
    bullets: [
      "Runs on your own hardware, no cloud",
      "A suggested load beside the engine's, with the reasoning",
      "Weight clamped to −10% / +2.5%, sets to −2 / +1",
      "If the model host is offline, Coach says so and the rest of the app keeps working",
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
          A reason behind each change.
        </h2>
        <p className="evidence-lede">
          You do not need to read the papers below to use the app. The engine
          applies these rules from your first session and puts the reason next
          to a rest time or a lowered weight.
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
