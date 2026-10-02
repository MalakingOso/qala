/* Running index (DECISIONS U21): VDOT as the headline with its trend, every
 * run linking into RunDetailPage, and the latest run's splits as the
 * difference from its own average pace (U17). */

import { useQala } from "../store/qalaStore.tsx";
import { RunSpark, SplitsTable } from "../shared/charts/index.ts";
import { sampleVdot } from "../store/sample.ts";
import { Bunch, PageHeader, Panel } from "./parts.tsx";
import { SessionsTable } from "./SessionsTable.tsx";

export function RunningPage() {
  const { sessions } = useQala();
  const runs = sessions.filter((s) => s.type === "run");
  const miles = runs.reduce((n, r) => n + (r.run?.distanceMi ?? 0), 0);
  const rtss = runs.reduce((n, r) => n + (r.run?.rtss ?? 0), 0);
  const vdot = sampleVdot[sampleVdot.length - 1];
  const delta = vdot - sampleVdot[0];
  // Splits only make sense when there is about one per mile.
  const withSplits =
    runs.find((r) =>
      r.run && r.run.splits.length >= Math.floor(r.run.distanceMi)
    ) ?? runs[0];

  return (
    <div>
      <PageHeader
        kicker={`${miles.toFixed(1)} miles this week · ${runs.length} runs`}
        title="Running"
      >
        <div className="lede-grid even">
          <div className="lede-left">
            <div className="bigweek figure">
              {vdot.toFixed(1)} <small>VDOT</small>
            </div>
            <div className="block-line">
              <span className="up">+{delta.toFixed(1)} this block</span>{" "}
              <span>· threshold pace still from a recent race</span>
            </div>
            <Bunch
              items={[
                { value: miles.toFixed(1), label: "miles" },
                { value: String(runs.length), label: "runs" },
                { value: String(rtss), label: "rTSS" },
              ]}
            />
          </div>
          <RunSpark
            flat
            points={sampleVdot}
            label={`VDOT trend, latest ${vdot}.`}
          />
        </div>
      </PageHeader>
      <div className="two-col wide-left">
        <Panel
          title="Runs"
          aside={
            <span className="kbd-hint">open one for pace and heart rate</span>
          }
        >
          <SessionsTable sessions={runs} columns="runs" />
        </Panel>
        {withSplits?.run
          ? (
            <SplitsTable
              title={`${withSplits.label}, ${withSplits.date}`}
              splits={withSplits.run.splits}
            />
          )
          : null}
      </div>
    </div>
  );
}
