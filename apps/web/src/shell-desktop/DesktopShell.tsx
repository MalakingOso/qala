/* Desktop shell (PLAN 9, DESIGN 7.15-7.16, reworked for the "more than an
 * author tool" pass): a Stats group (Overview, Lifts, Running, Body,
 * History) drives the desktop's stats-first landing; an Author group below
 * it keeps the original program editor, exercise DB, coach memory and
 * calibration tools. Routes take an optional id segment
 * (`#/desktop/lifts/squat`) for drill-down detail pages. Shares theme, type,
 * icons and charts with the phone shell. */

import {
  Activity,
  Cylinder,
  Dumbbell,
  History,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  Settings,
  SlidersHorizontal,
  SportShoe,
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
        <p>
          Settings live on the phone shell for now.{" "}
          <a href="#/phone/settings">Open Settings</a>
        </p>
      );
      break;
    default:
      body = <OverviewPage />;
  }

  return (
    <div className="page-desktop">
      <div className="desktop-layout">
        <nav className="sidebar" aria-label="Desktop">
          <NavGroup label="Stats" items={STATS_NAV} part={part} />
          <NavGroup label="Author" items={AUTHOR_NAV} part={part} />
          <div className="sidebar-foot">
            <a
              href="#/desktop/settings"
              aria-current={part === "settings" ? "page" : undefined}
            >
              <Settings size={18} /> Settings
            </a>
            <a href="#/phone/today">← Phone shell</a>
          </div>
        </nav>
        <div>{body}</div>
      </div>
    </div>
  );
}
