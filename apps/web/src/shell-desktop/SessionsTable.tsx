/* Sessions as a dense table: a type tag, the date, the session and its lead
 * set, the load, sRPE and any PR or note flag. Used on Overview (recent),
 * History (everything, with the coach flag and note shown under the row) and
 * Running (runs only). Rows link into the same detail pages as before. */

import { useQala } from "../store/qalaStore.tsx";
import type { SessionSummary } from "../store/types.ts";
import { Pill, TypeTag } from "./parts.tsx";
import { sessionHref, sessionLoad, topSet } from "./sessions.ts";

export function SessionsTable({
  sessions,
  detail,
  columns = "all",
}: {
  sessions: SessionSummary[];
  /** Show each session's coach flag and note under its row. */
  detail?: boolean;
  /** `runs` drops the sRPE-less lift columns and adds rTSS. */
  columns?: "all" | "runs";
}) {
  const { dismissSessionFlag } = useQala();
  const runs = columns === "runs";
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Sessions table"
      tabIndex={0}
    >
      <table className="stable">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Type</span>
            </th>
            <th scope="col">Date</th>
            <th scope="col">{runs ? "Run" : "Session"}</th>
            <th scope="col" className="num">{runs ? "Distance" : "Load"}</th>
            <th scope="col" className="num">sRPE</th>
            {runs ? <th scope="col" className="num">rTSS</th> : null}
            <th scope="col" className="num">
              <span className="sr-only">Flags</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const lead = s.type === "lift" ? topSet(s) : "";
            const showFlag = detail && s.flagged;
            const showNote = detail && s.notes;
            return [
              <tr
                key={s.id}
                className={`row-link${
                  showFlag || showNote ? " has-detail" : ""
                }`}
              >
                <td>
                  <TypeTag kind={s.type} />
                </td>
                <td className="dt">{s.date}</td>
                <td>
                  <a className="row-name" href={sessionHref(s)}>
                    <b>{s.label}</b>
                  </a>
                  {lead ? <span className="lead">{` · ${lead}`}</span> : null}
                </td>
                <td className="num">{sessionLoad(s)}</td>
                <td className="num">{s.sRPE}</td>
                {runs ? <td className="num">{s.run?.rtss ?? ""}</td> : null}
                <td className="num">
                  {s.prCount > 0
                    ? <Pill tone="warn">{`${s.prCount} PR`}</Pill>
                    : s.notes
                    ? <Pill tone="note">note</Pill>
                    : null}
                </td>
              </tr>,
              showFlag
                ? (
                  <tr key={`${s.id}-flag`} className="detail-row">
                    <td colSpan={runs ? 7 : 6}>
                      <div className="flag-line">
                        <b>Flagged</b>
                        <span>{s.flagged}</span>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => dismissSessionFlag(s.id)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                )
                : null,
              showNote
                ? (
                  <tr key={`${s.id}-note`} className="detail-row">
                    <td colSpan={runs ? 7 : 6}>
                      <div className="flag-line">
                        <b>Note</b>
                        <span>{s.notes}</span>
                      </div>
                    </td>
                  </tr>
                )
                : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
