/* Import screen for the program editor (docs/ls-plus-plus.md 4, DECISIONS
 * S19). Paste or dictate a program, or choose a PDF; the server reads it into
 * an edit list, asks about any exercise name it can't place, and proposes LS++
 * text. The owner answers, sees the diff against the editor and puts the text
 * in as a draft. Nothing is saved, and a down model only costs the shortcut:
 * the editor still takes the program typed by hand. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { WeightUnit } from "../../../../packages/llm/importSchema.ts";
import {
  asSentence,
  checkImportText,
  checkPdf,
  type Choices,
  confirmLines,
  describeReason,
  describeRejected,
  describeSource,
  type ImportOutcome,
  type ImportResult,
  MAX_IMPORT_CHARS,
  MAX_PDF_PAGES,
  proposalDiff,
  sendImportConfirm,
  sendImportPdf,
  sendImportText,
  SKIP,
  unanswered,
} from "../logic/programImport.ts";
import { DictateButton } from "./DictateButton.tsx";
import { FilterChips, Panel, Pill } from "./parts.tsx";

type Source = "text" | "pdf";

type Phase =
  | { kind: "idle" }
  | { kind: "working"; what: string }
  | { kind: "failed"; message: string }
  /** `from` names what was read, fixed when the request went out, so
   * switching tabs afterwards can't relabel the draft. */
  | { kind: "result"; result: ImportResult; from: string };

const SOURCES: { value: Source; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "pdf", label: "PDF" },
];

const PLACEHOLDER = `Week 1
Day 1, Lower: Squat 3x5 at 245, Romanian deadlift 3x8 at 185
Day 2, Upper: Bench 3x5 at 185, Row 3x8 at 135`;

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportPanel({
  current,
  units,
  onLoad,
  onClose,
}: {
  /** What the editor holds now; the diff is against this. */
  current: string;
  units: WeightUnit;
  /** Put the proposed text in the editor. `from` names where it came from. */
  onLoad: (text: string, from: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>("text");
  const [text, setText] = useState("");
  const [dictated, setDictated] = useState(false);
  const [dictateNote, setDictateNote] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [inputNote, setInputNote] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [choices, setChoices] = useState<Choices>({});
  const inflight = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Closing the panel stops the request, and the PDF route stops its
  // remaining model calls when the client goes away.
  useEffect(() => () => inflight.current?.abort(), []);

  const run = async (
    what: string,
    from: string,
    call: (signal: AbortSignal) => Promise<ImportOutcome>,
  ) => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    setPhase({ kind: "working", what });
    const out = await call(ctl.signal);
    if (ctl.signal.aborted) return;
    inflight.current = null;
    setPhase(
      out.ok
        ? { kind: "result", result: out.result, from }
        : { kind: "failed", message: out.message },
    );
  };

  const cancel = () => {
    inflight.current?.abort();
    inflight.current = null;
    setPhase({ kind: "idle" });
  };

  const read = () => {
    let problem: string | null;
    if (source === "text") {
      problem = checkImportText(text);
    } else {
      problem = pdf ? checkPdf(pdf) : "Choose a PDF first.";
    }
    setInputNote(problem ?? "");
    if (problem) return;
    setChoices({});
    if (source === "text") {
      run(
        "Reading the text",
        dictated ? "dictation" : "pasted text",
        (signal) => sendImportText(text, { units, signal }),
      );
    } else if (pdf) {
      run(
        "Reading the PDF. A long one can take a few minutes",
        `the PDF ${pdf.name}`,
        (signal) => sendImportPdf(pdf, { units, signal }),
      );
    }
  };

  const checkAgain = (prev: ImportResult, from: string) => {
    run("Checking your answers", from, async (signal) => {
      const out = await sendImportConfirm(prev.proposal.items, choices, {
        units,
        signal,
      });
      // The confirm step is the text route, which knows nothing of the PDF.
      return out.ok
        ? {
          ok: true,
          result: { ...out.result, source: prev.source, notes: prev.notes },
        }
        : out;
    });
  };

  const working = phase.kind === "working";
  return (
    <Panel
      title="Import"
      className="import-panel"
      aside={
        <button type="button" className="btn-secondary small" onClick={onClose}>
          Close
        </button>
      }
    >
      <FilterChips
        label="Import from"
        options={SOURCES}
        value={source}
        onPick={(v) => {
          setSource(v);
          setInputNote("");
        }}
        aside={source === "text"
          ? `${text.length.toLocaleString("en-US")} of ${
            MAX_IMPORT_CHARS.toLocaleString("en-US")
          } characters`
          : `Up to 10 MB and ${MAX_PDF_PAGES} pages`}
      />
      {source === "text"
        ? (
          <>
            <label className="import-input">
              <span className="kbd-hint">
                Paste a program or dictate one. Check the numbers in a
                transcript before you read it.
              </span>
              <textarea
                rows={7}
                value={text}
                placeholder={PLACEHOLDER}
                onChange={(e) => {
                  setText(e.target.value);
                  // Cleared and retyped is pasted text again.
                  if (e.target.value.trim() === "") setDictated(false);
                }}
              />
            </label>
            <DictateButton
              onTranscript={(t, r) => {
                setText((prev) =>
                  prev.trim() === "" ? t : `${prev.replace(/\s+$/, "")}\n${t}`
                );
                setDictated(true);
                setDictateNote(
                  r.fallback
                    ? "Transcribed by whisper.cpp because E4B wasn't available."
                    : "",
                );
              }}
            />
            {dictateNote ? <p className="kbd-hint">{dictateNote}</p> : null}
          </>
        )
        : (
          <div className="import-file">
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                setPdf(e.target.files?.[0] ?? null);
                setInputNote("");
              }}
            />
            <button
              type="button"
              className="btn-secondary small"
              onClick={() => fileInput.current?.click()}
              disabled={working}
            >
              Choose PDF
            </button>
            <span>
              {pdf ? `${pdf.name}, ${fileSize(pdf.size)}` : "No file"}
            </span>
            <p className="kbd-hint">
              MinerU reads the PDF, tables and scans included. When it's down,
              pdftotext reads PDFs that have a text layer and says so; a scan
              then can't be read.
            </p>
          </div>
        )}
      <div className="import-actions">
        {working
          ? (
            <>
              <button
                type="button"
                className="btn-secondary small"
                onClick={cancel}
              >
                Cancel
              </button>
              <span className="kbd-hint" role="status">{phase.what}...</span>
            </>
          )
          : (
            <button
              type="button"
              className="btn-secondary small"
              onClick={read}
            >
              Read program
            </button>
          )}
        {inputNote ? <span className="dry-stopped">{inputNote}</span> : null}
      </div>
      {phase.kind === "failed"
        ? <p className="dry-stopped" role="status">{phase.message}</p>
        : null}
      {phase.kind === "result"
        ? (
          <ProposalView
            result={phase.result}
            current={current}
            choices={choices}
            onChoose={(key, value) =>
              setChoices((c) => ({ ...c, [key]: value }))}
            onCheckAgain={() => checkAgain(phase.result, phase.from)}
            onLoad={(programText) => onLoad(programText, phase.from)}
            onDiscard={() => setPhase({ kind: "idle" })}
          />
        )
        : null}
    </Panel>
  );
}

function ProposalView({
  result,
  current,
  choices,
  onChoose,
  onCheckAgain,
  onLoad,
  onDiscard,
}: {
  result: ImportResult;
  current: string;
  choices: Choices;
  onChoose: (key: string, value: string) => void;
  onCheckAgain: () => void;
  onLoad: (programText: string) => void;
  onDiscard: () => void;
}) {
  const p = result.proposal;
  const diff = useMemo(
    () =>
      p.programText !== undefined ? proposalDiff(current, p.programText) : null,
    [current, p.programText],
  );
  const left = unanswered(p.confirms, choices);
  const lines = `${p.items.length} exercise ${
    p.items.length === 1 ? "line" : "lines"
  } read`;
  return (
    <div className="import-result">
      <p className="import-summary" role="status">
        {p.status === "ready"
          ? <Pill tone="ok">Ready to review</Pill>
          : p.status === "needs_confirm"
          ? (
            <Pill tone="warn">
              {p.confirms.length} {p.confirms.length === 1 ? "name" : "names"}
              {" "}
              to check
            </Pill>
          )
          : <Pill tone="bad">Can't import</Pill>}
        <span>
          {lines}
          {p.rejected.length > 0 ? `, ${p.rejected.length} left out` : ""}
        </span>
      </p>
      {result.source
        ? <p className="kbd-hint">{describeSource(result.source)}</p>
        : null}
      {result.notes.length > 0
        ? (
          <ul className="import-notes">
            {result.notes.map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}
          </ul>
        )
        : null}

      {p.status === "needs_confirm"
        ? (
          <>
            <ol className="confirm-list">
              {p.confirms.map((c) => {
                const affected = confirmLines(c, p.items);
                return (
                  <li key={c.key}>
                    <fieldset>
                      <legend>
                        <b>{c.raw}</b>
                        <span>{describeReason(c)}</span>
                      </legend>
                      <ul className="confirm-lines">
                        {affected.lines.map((l, i) => (
                          <li key={`${i}-${l}`}>{l}</li>
                        ))}
                        {affected.more > 0
                          ? <li>and {affected.more} more</li>
                          : null}
                      </ul>
                      <div className="confirm-choices">
                        {c.candidates.map((e) => (
                          <label key={e.id}>
                            <input
                              type="radio"
                              name={`confirm-${c.key}`}
                              checked={choices[c.key] === e.id}
                              onChange={() => onChoose(c.key, e.id)}
                            />
                            {e.name}
                          </label>
                        ))}
                        <label>
                          <input
                            type="radio"
                            name={`confirm-${c.key}`}
                            checked={choices[c.key] === SKIP}
                            onChange={() => onChoose(c.key, SKIP)}
                          />
                          Leave these lines out
                        </label>
                      </div>
                    </fieldset>
                  </li>
                );
              })}
            </ol>
            <div className="import-actions">
              <button
                type="button"
                className="btn-secondary small"
                disabled={left > 0}
                onClick={onCheckAgain}
              >
                Check again
              </button>
              <span className="kbd-hint">
                {left > 0
                  ? `${left} still to answer.`
                  : "Every name has an answer."}
              </span>
            </div>
          </>
        )
        : null}

      {p.status === "invalid"
        ? (
          <>
            <ul className="import-errors">
              {p.errors.map((e, i) => <li key={`${i}-${e}`}>{asSentence(e)}
              </li>)}
            </ul>
            <p className="kbd-hint">
              Fix the text and read it again, or type the program into the
              editor.
            </p>
          </>
        )
        : null}

      {p.status === "ready" && p.programText !== undefined && diff
        ? (
          <>
            <p className="kbd-hint">
              Against the editor: {diff.added}{" "}
              {diff.added === 1 ? "line" : "lines"} added, {diff.removed}{" "}
              removed.
            </p>
            <pre className="import-diff" aria-label="Changes to the program">
              {diff.lines.map((l, i) => (
                <span key={i} className={`diff-${l.op}`}>
                  {l.op === "add" ? "+ " : l.op === "remove" ? "- " : "  "}
                  {l.text}
                </span>
              ))}
            </pre>
            <div className="import-actions">
              <button
                type="button"
                className="btn-secondary small"
                onClick={() => onLoad(p.programText!)}
              >
                Put in editor
              </button>
              <button
                type="button"
                className="btn-secondary small"
                onClick={onDiscard}
              >
                Discard
              </button>
              <span className="kbd-hint">
                It goes in as an unsaved draft, and the checks run on it there.
              </span>
            </div>
          </>
        )
        : null}

      {p.rejected.length > 0
        ? (
          <details className="import-rejected">
            <summary>
              {p.rejected.length} {p.rejected.length === 1 ? "line" : "lines"}
              {" "}
              left out
            </summary>
            <ul>
              {p.rejected.map((r, i) => (
                <li key={`${i}-${r.index}`}>{describeRejected(r)}</li>
              ))}
            </ul>
          </details>
        )
        : null}
    </div>
  );
}
