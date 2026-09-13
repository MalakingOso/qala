/* Session detail: full set-by-set breakdown of one lift session, a
 * dismissible PR flag, and an editable notes field. The desktop's one
 * allowed write surface on top of otherwise read-only stats. */

import { useState } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { Card, DataTable } from "../shared/ui.tsx";

export function SessionDetailPage({ id }: { id: string }) {
  const { sessions, setSessionNotes, dismissSessionFlag } = useQala();
  const session = sessions.find((s) => s.id === id);
  const [draft, setDraft] = useState(session?.notes ?? "");
  const [dirty, setDirty] = useState(false);

  if (!session) {
    return (
      <div>
        <p className="breadcrumb">
          <a href="#/desktop/history">History</a>
        </p>
        <p>No session "{id}" on file.</p>
      </div>
    );
  }
  if (session.type === "run") {
    return (
      <div>
        <p className="breadcrumb">
          <a href="#/desktop/history">History</a>
        </p>
        <p>
          {session.date} · {session.label} is a run — see it on{" "}
          <a href={`#/desktop/running/${session.id}`}>the Running page</a>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="breadcrumb">
        <a href="#/desktop/history">History</a> <span>/</span>{" "}
        <span>{session.date}</span>
      </p>
      <div className="page-head">
        <h1 className="page-title title">
          {session.date} · {session.label}
        </h1>
        <span className="kbd-hint">
          {((session.loadLb ?? 0) / 1000).toFixed(1)}k lb · sRPE {session.sRPE}
        </span>
      </div>
      {session.flagged
        ? (
          <div className="banner">
            <div>{session.flagged}</div>
            <button
              type="button"
              className="link-btn"
              onClick={() => dismissSessionFlag(session.id)}
            >
              Dismiss
            </button>
          </div>
        )
        : null}
      <Card title="Exercises">
        <DataTable
          head={["Exercise", "Sets"]}
          rows={(session.exercises ?? []).map((e) => [e.name, e.sets])}
        />
      </Card>
      <Card title="Notes">
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          placeholder="Add a note about this session…"
          rows={3}
          style={{
            width: "100%",
            font: "inherit",
            padding: 8,
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--bg-surface)",
            color: "var(--fg)",
            resize: "vertical",
          }}
        />
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="chip"
            disabled={!dirty}
            onClick={() => {
              setSessionNotes(session.id, draft);
              setDirty(false);
            }}
          >
            {dirty ? "Save note" : "Saved"}
          </button>
        </div>
      </Card>
    </div>
  );
}
