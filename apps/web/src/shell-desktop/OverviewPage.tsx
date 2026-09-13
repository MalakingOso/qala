/* Desktop home: the stats dashboard that replaces "Qala · Author" as the
 * default landing page. This week's headline numbers, readiness, load,
 * squat trend and sets-by-muscle at a glance, then the recent sessions that
 * link into their full detail. */

import { useQala } from "../store/qalaStore.tsx";
import { Card, DataTable, StatTiles } from "../shared/ui.tsx";
import {
  E1rmLine,
  ReadinessRing,
  SetsByMuscle,
  WeeklyLoad,
} from "../shared/charts/index.ts";
import {
  sampleLifts,
  sampleMuscles,
  sampleReadiness,
  sampleVdot,
  sampleWeekLoad,
} from "../store/sample.ts";

export function OverviewPage() {
  const { sessions } = useQala();
  const squat = sampleLifts.find((l) => l.id === "squat")!;
  const loadThisWeek = sessions.reduce((n, s) => n + (s.loadLb ?? 0), 0);
  const milesThisWeek = sessions.reduce(
    (n, s) => n + (s.run?.distanceMi ?? 0),
    0,
  );
  const readiness = sampleReadiness.values[sampleReadiness.values.length - 1];
  const vdot = sampleVdot[sampleVdot.length - 1];
  const vdotDelta = vdot - sampleVdot[0];

  const recent = sessions.slice(0, 5);
  const rows = recent.map((s) => [
    s.date,
    s.label,
    s.type === "lift"
      ? `${((s.loadLb ?? 0) / 1000).toFixed(1)}k lb`
      : `${s.run!.distanceMi.toFixed(1)} mi`,
    String(s.sRPE),
    s.prCount > 0 ? `${s.prCount} PR` : "",
  ]);
  const rowHrefs = recent.map((s) =>
    s.type === "run" ? `#/desktop/running/${s.id}` : `#/desktop/history/${s.id}`
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Overview</h1>
        <span className="kbd-hint">
          {sessions.length} sessions this week · {milesThisWeek.toFixed(1)} mi
        </span>
      </div>
      <StatTiles
        tiles={[
          {
            value: `${(loadThisWeek / 1000).toFixed(1)}k`,
            label: "lb this week",
          },
          { value: String(readiness), label: "readiness" },
          { value: String(sessions.length), label: "sessions this week" },
          {
            value: vdot.toFixed(1),
            delta: `+${vdotDelta.toFixed(1)}`,
            label: "VDOT",
          },
        ]}
      />
      <div className="card-grid ring-row">
        <ReadinessRing
          readiness={readiness / 100}
          avg={sampleReadiness.avg}
          lowLine={sampleReadiness.low}
          checkins={20}
          prs={7}
        />
        <WeeklyLoad days={sampleWeekLoad} />
      </div>
      <div className="card-grid">
        <E1rmLine lift={squat.name} points={squat.recent} />
        <SetsByMuscle
          title="Sets by muscle, this week"
          muscles={sampleMuscles}
          onSelectMuscle={(m) => {
            window.location.hash = `#/desktop/body/${m}`;
          }}
        />
      </div>
      <Card title="Recent sessions">
        <DataTable
          head={["Date", "Session", "Load", "sRPE", ""]}
          rows={rows}
          rowHrefs={rowHrefs}
        />
        <p>
          <a className="link-btn" href="#/desktop/history">All history</a>
        </p>
      </Card>
    </div>
  );
}
