/* Program editor (DESIGN 7.15, DECISIONS U21): where the block stands, the
 * one ember action (generate the next block), the LS++ source with inline
 * checks, and the week preview. CodeMirror 6 hosts the buffer. The checks,
 * Format and the dry run come from the LS++ wasm build (src/lspp/load.ts),
 * loaded when this page opens; if it can't load the editor still edits and
 * says the checks are off. */

import { useEffect, useRef, useState } from "react";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import {
  type Diagnostic,
  forceLinting,
  linter,
  lintGutter,
} from "@codemirror/lint";
import { createBaselineDocument } from "../../../../packages/core/migrations.ts";
import type { Lspp } from "../../../../packages/lspp/mod.ts";
import {
  caretAfterFormat,
  countIssues,
  type DryRunView,
  dryRunView,
  type EditorIssue,
  formatOutcome,
  issuePosition,
  issueSummary,
  MAX_LISTED_ISSUES,
  toIssues,
} from "../logic/lsppEditor.ts";
import { loadLspp } from "../lspp/load.ts";
import { sampleBlock } from "../store/sample.ts";
import { DictateButton } from "./DictateButton.tsx";
import { BlockBar, Bunch, PageHeader, Panel, Pill, TypeTag } from "./parts.tsx";

const SAMPLE = `# Week 1
## Day 1: Lower A
Squat / 3x5 245lb / progress: lp(5lb)
Deadlift / 1x5 315lb / progress: lp(10lb)
Split Squat / 2x10 ?+
## Day 2: Upper A
Bench Press / 3x5 185lb / progress: lp(5lb)
Bent Over Row / 3x8 135lb / progress: lp(5lb)
Overhead Press / 3x8 95lb
`;

interface PreviewDay {
  day: string;
  kind: "lift" | "run";
  title: string;
  lines?: string[];
  note?: string;
  today?: boolean;
}

/* The week the sessions list and the ribbon show: lifts Monday, Wednesday,
 * Friday and Sunday, runs on the days between. */
const PREVIEW: PreviewDay[] = [
  {
    day: "Mon",
    kind: "lift",
    title: "Upper A",
    lines: [
      "Bench 4x5 @ 225",
      "Row 3x8 @ 135",
      "Press 3x8 @ 95",
      "Curl 2x12 @ 65",
    ],
  },
  { day: "Tue", kind: "run", title: "Easy run", note: "4.0 mi" },
  {
    day: "Wed",
    kind: "lift",
    title: "Lower B",
    lines: ["Deadlift 3x3 @ 315", "Front squat 3x5 @ 185"],
  },
  { day: "Thu", kind: "run", title: "Run", note: "planned" },
  {
    day: "Fri",
    kind: "lift",
    title: "Upper B",
    lines: ["Press 3x5 @ 135", "Bench var 3x6 @ 205"],
  },
  { day: "Sat", kind: "run", title: "Long run", note: "7.0 mi" },
  {
    day: "Sun",
    kind: "lift",
    title: "Lower A",
    lines: [
      "Squat 3x4 @ 245",
      "RDL 2x8 @ 205",
      "Lunge 1x10 @ 40",
      "Calf 2x12 @ 180",
    ],
    note: "then easy run, 3.0 mi, 6 PM",
    today: true,
  },
];

type Checks = "loading" | "ready" | "off";

type DryState =
  | { kind: "idle" }
  | { kind: "ok"; view: DryRunView; finalText: string; forText: string }
  | { kind: "stopped"; message: string };

/** The mark CodeMirror draws for an issue; the fix idea goes under the message. */
function toMark(i: EditorIssue): Diagnostic {
  return {
    from: i.from,
    to: i.to,
    severity: i.severity,
    source: i.code,
    message: i.message,
    renderMessage: i.suggestion
      ? () => {
        const box = document.createElement("div");
        const msg = document.createElement("div");
        msg.textContent = i.message;
        const fix = document.createElement("div");
        fix.className = "cm-lint-fix";
        fix.textContent = `Fix: ${i.suggestion}`;
        box.append(msg, fix);
        return box;
      }
      : undefined,
  };
}

export function ProgramEditorPage() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lspp = useRef<Lspp | null>(null);
  const [text, setText] = useState(SAMPLE);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [checks, setChecks] = useState<Checks>("loading");
  const [issues, setIssues] = useState<EditorIssue[]>([]);
  const [formatNote, setFormatNote] = useState("");
  const [dry, setDry] = useState<DryState>({ kind: "idle" });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // CodeMirror calls this on its own debounce, against the text as it is then.
    const check = (v: EditorView): Diagnostic[] => {
      const api = lspp.current;
      if (!api) return [];
      const doc = v.state.doc;
      const source = doc.toString();
      const errors = api.diagnose(source);
      if (!errors.ok) {
        if (errors.kind === "trap") setChecks("off");
        setIssues([]);
        return [];
      }
      const warnings = api.lint(source);
      const found = toIssues(
        errors.value,
        warnings.ok ? warnings.value : [],
        doc.length,
      );
      setIssues(found);
      return found.map(toMark);
    };
    const editor = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: SAMPLE,
        extensions: [
          basicSetup,
          linter(check, { delay: 300 }),
          lintGutter(),
          EditorView.updateListener.of((vu) => {
            if (!vu.docChanged) return;
            setText(vu.state.doc.toString());
            setFormatNote("");
          }),
        ],
      }),
    });
    view.current = editor;
    let alive = true;
    loadLspp().then((api) => {
      if (!alive) return;
      lspp.current = api;
      setChecks(api ? "ready" : "off");
      if (api) forceLinting(editor);
    });
    return () => {
      alive = false;
      view.current = null;
      editor.destroy();
    };
  }, []);

  const jumpTo = (i: EditorIssue) => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ selection: { anchor: i.from }, scrollIntoView: true });
    editor.focus();
  };

  const format = () => {
    const editor = view.current;
    const api = lspp.current;
    if (!editor || !api) return;
    const before = editor.state.doc.toString();
    const result = api.format(before);
    if (!result.ok) {
      setFormatNote(`Couldn't format: ${result.message}`);
      return;
    }
    const outcome = formatOutcome(result.value);
    if (outcome.text !== undefined) {
      editor.dispatch({
        changes: { from: 0, to: before.length, insert: outcome.text },
        selection: {
          anchor: caretAfterFormat(
            before,
            editor.state.selection.main.head,
            outcome.text,
          ),
        },
        userEvent: "input.format",
      });
    }
    // Set after the dispatch, whose update listener clears the note.
    setFormatNote(outcome.note);
  };

  const dryRun = () => {
    const api = lspp.current;
    const editor = view.current;
    if (!api || !editor) return;
    const programText = editor.state.doc.toString();
    const syntax = api.diagnose(programText);
    if (syntax.ok && syntax.value.length > 0) {
      setDry({
        kind: "stopped",
        message: "Fix the syntax errors before a dry run.",
      });
      return;
    }
    // The baseline settings, until real settings reach the web app.
    const settings = api.settingsFromCore(createBaselineDocument().settings);
    if (!settings.ok) {
      setDry({ kind: "stopped", message: settings.message });
      return;
    }
    const result = api.dryRun({
      programText,
      name: sampleBlock.name,
      settings: settings.value,
    });
    setDry(
      result.ok
        ? {
          kind: "ok",
          view: dryRunView(result.value),
          finalText: result.value.finalText,
          forText: programText,
        }
        : { kind: "stopped", message: result.message },
    );
  };

  const { errors: errorCount, warnings: warningCount } = countIssues(issues);
  const listed = issues.slice(0, MAX_LISTED_ISSUES);
  const lineCount = text.split("\n").length;

  return (
    <div>
      <PageHeader
        kicker={`Program · Week ${sampleBlock.week} of ${sampleBlock.of}`}
        title={sampleBlock.name}
      >
        <div className="lede-grid">
          <div className="lede-left">
            <div className="block-line">
              {sampleBlock.focus}
              <span>{` · ${sampleBlock.profile}`}</span>
            </div>
            <BlockBar
              numbered
              week={sampleBlock.week}
              of={sampleBlock.of}
              deloadWeek={sampleBlock.deloadWeek}
            />
            <Bunch
              items={[
                { value: "62", label: "sets a week" },
                { value: "37", label: "NL85 sets" },
                { value: "5 h", label: "with warm-ups" },
              ]}
            />
          </div>
          <div className="lede-actions">
            <button type="button" className="btn-primary">
              Generate next block
            </button>
            <p className="kbd-hint">
              No deload due. Next planned: week {sampleBlock.deloadWeek}.
            </p>
          </div>
        </div>
      </PageHeader>
      <div className="two-col editor-split">
        <Panel
          title="LS++ source"
          aside={
            <button
              type="button"
              className="btn-secondary small"
              onClick={format}
              disabled={checks !== "ready"}
            >
              Format
            </button>
          }
        >
          <div
            className="code-editor"
            ref={host}
            role="textbox"
            aria-label="Program source"
            aria-multiline="true"
          />
          <div className="editor-status">
            {checks === "loading"
              ? <Pill tone="mute">Checking</Pill>
              : checks === "off"
              ? <Pill tone="mute">LS++ checks unavailable</Pill>
              : (
                <Pill
                  tone={errorCount > 0
                    ? "bad"
                    : warningCount > 0
                    ? "warn"
                    : "ok"}
                >
                  {issueSummary(issues)}
                </Pill>
              )}
            <span>
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
            <span className="editor-note" role="status">{formatNote}</span>
          </div>
          {listed.length > 0
            ? (
              <ul className="issue-list" aria-label="Problems in the program">
                {listed.map((i) => (
                  <li key={`${i.severity}-${i.from}-${i.message}`}>
                    <button
                      type="button"
                      className={`issue ${i.severity}`}
                      onClick={() =>
                        jumpTo(i)}
                    >
                      <span className="issue-pos">{issuePosition(i)}</span>
                      <span>
                        {i.message}
                        {i.suggestion
                          ? <span className="issue-fix">{i.suggestion}</span>
                          : null}
                      </span>
                    </button>
                  </li>
                ))}
                {issues.length > listed.length
                  ? (
                    <li className="issue-more">
                      and {issues.length - listed.length} more
                    </li>
                  )
                  : null}
              </ul>
            )
            : null}
          <DictateButton onTranscript={setTranscript} />
          {transcript !== null && (
            <label className="dictate-transcript">
              <span className="kbd-hint">
                Transcript. Check the numbers; importing it comes with the text
                import screen.
              </span>
              <textarea
                rows={3}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
            </label>
          )}
        </Panel>
        <Panel title="Week preview">
          <ul className="preview-days">
            {PREVIEW.map((d) => (
              <li key={d.day} className={d.today ? "today" : undefined}>
                <span className="preview-day">{d.day}</span>
                <TypeTag kind={d.kind} />
                <span className="preview-what">
                  <b>{d.title}</b>
                  {d.lines ? ` · ${d.lines.join(" · ")}` : null}
                  {d.note
                    ? <em>{`${d.lines ? " " : " · "}${d.note}`}</em>
                    : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="kbd-hint">
            Week totals: 62 sets · NL85 37 · about 5 h with warm-ups.
          </p>
        </Panel>
      </div>
      <Panel
        title="Dry run"
        className="dry-run"
        aside={
          <button
            type="button"
            className="btn-secondary small"
            onClick={dryRun}
            disabled={checks !== "ready"}
          >
            Run
          </button>
        }
      >
        <p className="kbd-hint">
          Plays the program forward as if every set is hit. Nothing is saved.
        </p>
        {dry.kind === "stopped"
          ? <p className="dry-stopped" role="status">{dry.message}</p>
          : null}
        {dry.kind === "ok"
          ? (
            <div role="status">
              <p className="dry-summary">
                {dry.view.summary}
                {dry.forText !== text
                  ? <Pill tone="note">The program changed since this run</Pill>
                  : null}
              </p>
              <ol className="dry-sessions">
                {dry.view.sessions.map((s, si) => (
                  <li key={`${si}-${s.title}`}>
                    <b>{s.title}</b>
                    <ul>
                      {s.lines.map((l, li) => (
                        <li key={`${li}-${l.name}`}>
                          <span>{l.name}</span>
                          <span className="num">{l.sets}</span>
                        </li>
                      ))}
                    </ul>
                    {s.errors.map((e, ei) => (
                      <p key={`${ei}-${e}`} className="dry-stopped">{e}</p>
                    ))}
                  </li>
                ))}
              </ol>
              <details className="dry-final">
                <summary>Program after these sessions</summary>
                <pre>{dry.finalText}</pre>
              </details>
            </div>
          )
          : null}
      </Panel>
    </div>
  );
}
