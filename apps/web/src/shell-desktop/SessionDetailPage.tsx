/* Session detail: full set-by-set breakdown of one lift session, a
 * dismissible PR flag, and an editable notes field. The desktop's one
 * allowed write surface on top of otherwise read-only stats. */

import { useState } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { Card, DataTable } from "../shared/ui.tsx";
import { Bunch, PageHeader } from "./parts.tsx";

export function SessionDetailPage({ id }: { id: string }) {
  const { sessions, setSessionNotes, dismissSessionFlag } = useQala();
  const session = sessions.find((s) => s.id === id);
  const [draft, setDraft] = useState(session?.notes ?? "");
  const [dirty, setDirty] = useState(false);

  if (!session) {
    return (
      <div>
        <PageHeader
          kicker={<a href="#/desktop/history">← History</a>}
          title="Session not found"
        >
          <p>No session "{id}" on file.</p>
        </PageHeader>
      </div>
    );
  }
  if (session.type === "run") {
    return (
      <div>
        <PageHeader
          kicker={<a href="#/desktop/history">← History</a>}
          title={`${session.date} \u00b7 ${session.label}`}
        >
          <p>
            That one is a run. See it on{" "}
            <a href={`#/desktop/running/${session.id}`}>the Running page</a>.
          </p>
        </PageHeader>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        kicker={<a href="#/desktop/history">← History</a>}
        title={`${session.date} \u00b7 ${session.label}`}
      >
        <Bunch
          items={[
            {
              value: (session.loadLb ?? 0).toLocaleString("en-US"),
              label: "lb lifted",
            },
            { value: String(session.sRPE), label: "session RPE" },
          ]}
        />
      </PageHeader>
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
