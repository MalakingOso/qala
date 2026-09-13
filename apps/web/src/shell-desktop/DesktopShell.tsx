/* Desktop shell (PLAN 9, DESIGN 7.15-7.16): sidebar author layout with the
 * program editor, exercise DB, coach memory, history, graphs and
 * calibration. Shares theme, type, icons and charts with the phone shell. */

import {
  Activity,
  Dumbbell,
  History,
  MessageSquareText,
  Route,
  Settings,
  SlidersHorizontal,
  TrendingUp,
} from "../shared/icons.ts";
import { ProgramEditorPage } from "./ProgramEditorPage.tsx";
import { ExerciseDbPage } from "./ExerciseDbPage.tsx";
import { CoachMemoryPage } from "./CoachMemoryPage.tsx";
import { DesktopHistoryPage } from "./HistoryPage.tsx";
import { GraphsPage } from "./GraphsPage.tsx";
import { CalibrationPage } from "./CalibrationPage.tsx";
import { RunDetailPage } from "./RunDetailPage.tsx";

const NAV = [
  { id: "programs", label: "Programs", icon: Dumbbell },
  { id: "exercises", label: "Exercises", icon: Activity },
  { id: "memory", label: "Coach memory", icon: MessageSquareText },
  { id: "history", label: "History", icon: History },
  { id: "graphs", label: "Graphs", icon: TrendingUp },
  { id: "calibration", label: "Calibration", icon: SlidersHorizontal },
  { id: "runs", label: "Runs", icon: Route },
  { id: "settings", label: "Settings", icon: Settings },
];

export function DesktopShell({ route }: { route: string }) {
  const part = route.replace(/^\/desktop\/?/, "") || "programs";
  return (
    <div className="page-desktop">
      <div className="page-head">
        <h1 className="page-title title">Qala · Author</h1>
        <span className="kbd-hint">Strength B2 · Generate next block</span>
      </div>
      <div className="desktop-layout">
        <nav className="sidebar" aria-label="Author">
          {NAV.map((n) => {
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
          <a href="#/phone/today">← Phone shell</a>
        </nav>
        <div>
          {part === "exercises"
            ? <ExerciseDbPage />
            : part === "memory"
            ? <CoachMemoryPage />
            : part === "history"
            ? <DesktopHistoryPage />
            : part === "graphs"
            ? <GraphsPage />
            : part === "calibration"
            ? <CalibrationPage />
            : part === "runs"
            ? <RunDetailPage />
            : part === "settings"
            ? (
              <p>
                Settings live on the phone shell for now.{" "}
                <a href="#/phone/settings">Open Settings</a>
              </p>
            )
            : <ProgramEditorPage />}
        </div>
      </div>
    </div>
  );
}
