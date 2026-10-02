/* Desktop shell (PLAN 9, DESIGN 7.15-7.16, DECISIONS U21): the refined look.
 * A numbered sidebar under the Qala mark (Training, Workspace, Settings), a
 * toolbar with search and a week switcher, and pages that open on a lede card.
 * Routes take an optional id segment (`#/desktop/lifts/squat`) for drill-down
 * detail pages. Shares theme, charts and data with the phone shell; every
 * desktop-only rule lives in theme/desktop.css under `.page-desktop`. */

import { useEffect, useState } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { OfflineBadge } from "../shared/ui.tsx";
import { OverviewPage } from "./OverviewPage.tsx";
import { LiftsPage } from "./LiftsPage.tsx";
import { LiftDetailPage } from "./LiftDetailPage.tsx";
import { RunningPage } from "./RunningPage.tsx";
import { DesktopBodyPage } from "./BodyPage.tsx";
import { MuscleDetailPage } from "./MuscleDetailPage.tsx";
import { DesktopHistoryPage } from "./HistoryPage.tsx";
import { SessionDetailPage } from "./SessionDetailPage.tsx";
import { ProgramEditorPage } from "./ProgramEditorPage.tsx";
import { ExerciseDbPage } from "./ExerciseDbPage.tsx";
import { CoachMemoryPage } from "./CoachMemoryPage.tsx";
import { CalibrationPage } from "./CalibrationPage.tsx";
import { RunDetailPage } from "./RunDetailPage.tsx";
import { DesktopSettingsPage } from "./SettingsDesktopPage.tsx";
import { type NavItem, TRAINING_NAV, WORKSPACE_NAV } from "./nav.ts";
import { ToolbarSearch } from "./ToolbarSearch.tsx";
import { useWeekFocus, WeekFocusProvider } from "./weekFocus.tsx";

function NavGroup(
  { label, items, part }: { label: string; items: NavItem[]; part: string },
) {
  return (
    <div className="dx-group">
      <span className="dx-group-label">{label}</span>
      {items.map((n) => (
        <a
          key={n.id}
          className="dx-nav"
          href={`#/desktop/${n.id}`}
          aria-current={part === n.id ? "page" : undefined}
        >
          <span className="no" aria-hidden="true">{n.no}</span>
          {n.label}
        </a>
      ))}
    </div>
  );
}

/** Previous / next week and the range in view. It moves the focus the
 * Overview ribbon follows; on other pages it only reads. */
function WeekSwitcher() {
  const { focus, step, canStep } = useWeekFocus();
  return (
    <div className="dx-week" role="group" aria-label="Week in focus">
      <button
        type="button"
        aria-label="Previous week"
        disabled={!canStep(-1)}
        onClick={() => step(-1)}
      >
        {"←"}
      </button>
      <span aria-live="polite">{focus.range.replace("-", "–")}</span>
      <button
        type="button"
        aria-label="Next week"
        disabled={!canStep(1)}
        onClick={() => step(1)}
      >
        {"→"}
      </button>
    </div>
  );
}

function Shell({ route }: { route: string }) {
  const { online, outbox } = useQala();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [route]);
  const rest = route.replace(/^\/desktop\/?/, "");
  const [rawPart, id] = rest.split("/");
  const part = rawPart || "overview";

  let body;
  switch (part) {
    case "lifts":
      body = id ? <LiftDetailPage key={id} id={id} /> : <LiftsPage />;
      break;
    case "running":
      body = id ? <RunDetailPage key={id} id={id} /> : <RunningPage />;
      break;
    case "body":
      body = id
        ? <MuscleDetailPage key={id} muscle={id} />
        : <DesktopBodyPage />;
      break;
    case "history":
      body = id
        ? <SessionDetailPage key={id} id={id} />
        : <DesktopHistoryPage />;
      break;
    case "exercises":
      body = <ExerciseDbPage />;
      break;
    case "memory":
      body = <CoachMemoryPage />;
      break;
    case "calibration":
      body = <CalibrationPage />;
      break;
    case "programs":
      body = <ProgramEditorPage />;
      break;
    case "settings":
      body = <DesktopSettingsPage />;
      break;
    default:
      body = <OverviewPage />;
  }

  return (
    <div className="page-desktop">
      <a
        className="skip-link"
        href="#desktop-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("desktop-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="dx-layout">
        <nav
          className={`dx-sidebar${navOpen ? " is-open" : ""}`}
          id="desktop-navigation"
          aria-label="Desktop"
        >
          <a
            className="dx-lockup"
            href="#/desktop/overview"
            aria-label="Qala overview"
          >
            <img src="/icons/icon-96.png" alt="" width={40} height={40} />
            <span>
              <span className="dx-brand title">
                Qala<em>.</em>
              </span>
              <span className="dx-brand-sub">training record</span>
            </span>
          </a>
          <NavGroup label="Training" items={TRAINING_NAV} part={part} />
          <NavGroup label="Workspace" items={WORKSPACE_NAV} part={part} />
          <a
            className="dx-nav set"
            href="#/desktop/settings"
            aria-current={part === "settings" ? "page" : undefined}
          >
            <span className="no" aria-hidden="true" />
            Settings
          </a>
          <div className="dx-foot">
            <OfflineBadge online={online} pending={outbox.length} />
          </div>
        </nav>
        <div className="dx-main">
          <header className="dx-bar">
            <button
              className="dx-menu"
              type="button"
              aria-label={navOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={navOpen}
              aria-controls="desktop-navigation"
              onClick={() => setNavOpen((v) => !v)}
            >
              {navOpen ? "Close" : "Menu"}
            </button>
            <ToolbarSearch />
            <WeekSwitcher />
            <a className="dx-bar-link" href="#/phone/today">Workout view</a>
          </header>
          <main id="desktop-content" className="dx-body" tabIndex={-1}>
            {body}
          </main>
        </div>
      </div>
    </div>
  );
}

export function DesktopShell({ route }: { route: string }) {
  return (
    <WeekFocusProvider>
      <Shell route={route} />
    </WeekFocusProvider>
  );
}
