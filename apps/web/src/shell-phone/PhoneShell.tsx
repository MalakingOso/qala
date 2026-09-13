/* Phone shell: tabs Today, Plan, Body, Progress, Coach (DECISIONS U2).
 * Settings and history are header buttons. No Start tab: lifts and runs
 * start from Today or a Plan day. */

import type { ReactNode } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { isRestDay } from "../store/types.ts";
import { OfflineBadge } from "../shared/ui.tsx";
import {
  Activity,
  CalendarRange,
  History,
  MessageSquareText,
  Settings,
  Sun,
  TrendingUp,
} from "../shared/icons.ts";
import { TodayPage } from "./pages/TodayPage.tsx";
import { PlanPage } from "./pages/PlanPage.tsx";
import { CheckinPage } from "./pages/CheckinPage.tsx";
import { WarmupPage } from "./pages/WarmupPage.tsx";
import { WorkoutPage } from "./pages/WorkoutPage.tsx";
import { AllExercisesPage } from "./pages/AllExercisesPage.tsx";
import { RestPage } from "./pages/RestPage.tsx";
import { SessionCompletePage } from "./pages/SessionCompletePage.tsx";
import { BodyPage } from "./pages/BodyPage.tsx";
import { ProgressPage } from "./pages/ProgressPage.tsx";
import { CoachPage } from "./pages/CoachPage.tsx";
import { PlateCalcPage } from "./pages/PlateCalcPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import {
  GuidedRunPage,
  LiveRunPage,
  RunSummaryPage,
  StartRunPage,
} from "./run/RunPages.tsx";

const TABS = [
  { id: "today", label: "Today", icon: Sun },
  { id: "plan", label: "Plan", icon: CalendarRange },
  { id: "body", label: "Body", icon: Activity },
  { id: "progress", label: "Progress", icon: TrendingUp },
  { id: "coach", label: "Coach", icon: MessageSquareText },
] as const;

function pageFor(
  rawRoute: string,
  restDay: boolean,
): { tab: string; node: ReactNode } {
  const qIdx = rawRoute.indexOf("?");
  const route = qIdx === -1 ? rawRoute : rawRoute.slice(0, qIdx);
  const params = new URLSearchParams(
    qIdx === -1 ? "" : rawRoute.slice(qIdx + 1),
  );
  switch (route) {
    case "/phone/plan":
      return { tab: "plan", node: <PlanPage /> };
    case "/phone/checkin":
      return { tab: "today", node: <CheckinPage restDay={restDay} /> };
    case "/phone/warmup":
      return { tab: "today", node: <WarmupPage /> };
    case "/phone/workout": {
      const idx = Number(params.get("idx"));
      return {
        tab: "today",
        node: <WorkoutPage initialIdx={Number.isFinite(idx) ? idx : 0} />,
      };
    }
    case "/phone/allex":
      return { tab: "today", node: <AllExercisesPage /> };
    case "/phone/rest":
      return { tab: "today", node: <RestPage /> };
    case "/phone/complete":
      return { tab: "today", node: <SessionCompletePage /> };
    case "/phone/body":
      return { tab: "body", node: <BodyPage /> };
    case "/phone/progress":
      return { tab: "progress", node: <ProgressPage /> };
    case "/phone/coach":
      return { tab: "coach", node: <CoachPage /> };
    case "/phone/plates":
      return { tab: "today", node: <PlateCalcPage /> };
    case "/phone/settings":
      return { tab: "today", node: <SettingsPage /> };
    case "/phone/history":
      return { tab: "today", node: <HistoryPage /> };
    case "/phone/run/start":
      return { tab: "today", node: <StartRunPage /> };
    case "/phone/run/live":
      return { tab: "today", node: <LiveRunPage /> };
    case "/phone/run/guided":
      return { tab: "today", node: <GuidedRunPage /> };
    case "/phone/run/summary":
      return { tab: "today", node: <RunSummaryPage /> };
    case "/phone/today":
    default:
      return { tab: "today", node: <TodayPage /> };
  }
}

export function PhoneShell({ route }: { route: string }) {
  const { online, outbox, stages } = useQala();
  const { tab, node } = pageFor(route, isRestDay(stages));
  return (
    <div className="phone-shell">
      <div className="page">
        <header className="phone-topbar">
          <a className="brand" href="#/phone/today" aria-label="Qala today">
            <span className="brand-name title">Qala</span>
          </a>
          <span className="phone-tools">
            <OfflineBadge online={online} pending={outbox.length} />
            <a className="icon-btn" href="#/phone/history" aria-label="History">
              <History size={20} />
            </a>
            <a
              className="icon-btn"
              href="#/phone/settings"
              aria-label="Settings"
            >
              <Settings size={20} />
            </a>
          </span>
        </header>
        {node}
      </div>
      <nav className="tabbar" aria-label="Primary">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <a
              key={t.id}
              href={`#/phone/${t.id}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={22} />
              <span>{t.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
