/* Desktop shell (PLAN 9, DESIGN 7.15-7.16, reworked for the "more than an
 * author tool" pass): a Stats group (Overview, Lifts, Running, Body,
 * History) drives the desktop's stats-first landing; an Author group below
 * it keeps the original program editor, exercise DB, coach memory and
 * calibration tools. Routes take an optional id segment
 * (`#/desktop/lifts/squat`) for drill-down detail pages. Shares theme, type,
 * icons and charts with the phone shell. */

import { useEffect, useState } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { OfflineBadge } from "../shared/ui.tsx";
import { SettingsPage } from "../shell-phone/pages/SettingsPage.tsx";
import {
  Activity,
  Cylinder,
  Dumbbell,
  History,
  LayoutGrid,
  ListChecks,
  Menu,
  MessageSquareText,
  Settings,
  SlidersHorizontal,
  Smartphone,
  SportShoe,
  X,
} from "../shared/icons.ts";
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

const STATS_NAV = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "lifts", label: "Lifts", icon: Dumbbell },
  { id: "running", label: "Running", icon: SportShoe },
  { id: "body", label: "Body", icon: Activity },
  { id: "history", label: "History", icon: History },
];

const AUTHOR_NAV = [
  { id: "programs", label: "Programs", icon: ListChecks },
  { id: "exercises", label: "Exercises", icon: Cylinder },
  { id: "memory", label: "Coach memory", icon: MessageSquareText },
  { id: "calibration", label: "Calibration", icon: SlidersHorizontal },
];

function NavGroup(
  { label, items, part }: {
    label: string;
    items: typeof STATS_NAV;
    part: string;
  },
) {
  return (
    <div className="sidebar-group">
      <span className="sidebar-group-label">{label}</span>
      {items.map((n) => {
        const Icon = n.icon;
        const active = part === n.id;
        return (
          <a
            key={n.id}
            href={`#/desktop/${n.id}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={18} /> {n.label}
          </a>
        );
      })}
    </div>
  );
}

export function DesktopShell({ route }: { route: string }) {
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
      body = (
        <div className="desktop-settings">
          <SettingsPage />
        </div>
      );
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
      <div className="desktop-layout">
        <nav
          className={`sidebar${navOpen ? " is-open" : ""}`}
          id="desktop-navigation"
          aria-label="Desktop"
        >
          <a
            className="brand sidebar-brand"
            href="#/desktop/overview"
            aria-label="Qala overview"
          >
            <span className="brand-mark title" aria-hidden="true">q</span>
            <span className="brand-name title">Qala</span>
          </a>
          <NavGroup label="Training" items={STATS_NAV} part={part} />
          <NavGroup label="Workspace" items={AUTHOR_NAV} part={part} />
          <div className="sidebar-foot">
            <a
              href="#/desktop/settings"
              aria-current={part === "settings" ? "page" : undefined}
            >
              <Settings size={18} /> Settings
            </a>
            <a href="#/phone/today">
              <Smartphone size={18} /> Workout view
            </a>
            <div className="sidebar-status">
              <OfflineBadge online={online} pending={outbox.length} />
            </div>
          </div>
        </nav>
        <div className="desktop-workspace">
          <header className="desktop-toolbar">
            <div className="toolbar-location">
              <button
                className="icon-btn nav-menu"
                type="button"
                aria-label={navOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={navOpen}
                aria-controls="desktop-navigation"
                onClick={() => setNavOpen((v) => !v)}
              >
                {navOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
              <span className="group-label">
                {AUTHOR_NAV.some((n) => n.id === part)
                  ? "Workspace"
                  : "Training"}
              </span>
              <span className="toolbar-divider" aria-hidden="true">/</span>
              <span>
                {[...STATS_NAV, ...AUTHOR_NAV].find((n) => n.id === part)
                  ?.label ?? (part === "settings" ? "Settings" : "Overview")}
              </span>
            </div>
            <a className="toolbar-link" href="#/desktop/programs">
              <ListChecks size={16} /> Your program
            </a>
          </header>
          <main id="desktop-content" className="desktop-content" tabIndex={-1}>
            {body}
          </main>
        </div>
      </div>
    </div>
  );
}
