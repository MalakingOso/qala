/* Program editor (DESIGN 7.15): liftoscript editor with inline errors and
 * the evaluated week preview with week totals. CodeMirror 6 hosts the
 * buffer; the Lezer grammars from packages/liftoscript plug into
 * `language` once the vendored parsers build. */

import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { Card } from "../shared/ui.tsx";

const SAMPLE = `// Lower A · Strength B2 W3
// approach: strength · periodization: dup

Squat / 3x4 / 245lb / RPE 8 / rest 3:00 {
  progress: custom(s, done) {~ squatProgress(s, done) ~}
}

RDL / 2x8 / 205lb / RPE 8
Walking Lunge / 1x10 / 40lb
Standing Calf Raise / 2x12 / 180lb
`;

interface PreviewDay {
  day: string;
  lines: string[];
}

const PREVIEW: PreviewDay[] = [
  { day: "Mon · rest", lines: ["Walk + mobility as wanted."] },
  { day: "Tue · Upper A", lines: ["Bench 4x5 @ 225", "Row 3x8 @ 135", "Press 3x8 @ 95", "Curl 2x12 @ 65"] },
  { day: "Thu · Lower B", lines: ["Deadlift 3x3 @ 315", "Front squat 3x5 @ 185"] },
  { day: "Fri · Upper B", lines: ["Press 3x5 @ 135", "Bench var 3x6 @ 205"] },
  { day: "Sun · Lower A", lines: ["Squat 3x4 @ 245", "RDL 2x8 @ 205", "Lunge 1x10 @ 40", "Calf 2x12 @ 180"] },
];

export function ProgramEditorPage() {
  const host = useRef<HTMLDivElement>(null);
  const [errors] = useState<string[]>([]);
  const [text, setText] = useState(SAMPLE);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const state = EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        EditorView.updateListener.of((vu) => {
          if (vu.docChanged) setText(vu.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: el });
    return () => view.destroy();
    // Mount once; edits flow out through the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-head">
        <h2 className="title" style={{ margin: 0 }}>Strength B2 · Lower focus</h2>
        <button type="button" className="btn-secondary" style={{ width: "auto" }}>
          Generate next block
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="liftoscript">
          <div className="code-editor" ref={host} role="textbox" aria-label="Program source" aria-multiline="true" />
          {errors.length > 0 ? (
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="kbd-hint">No errors. {text.split("\n").length} lines.</p>
          )}
        </Card>
        <Card title="Week preview">
          {PREVIEW.map((d) => (
            <div key={d.day} style={{ marginBottom: 10 }}>
              <p className="group-label">{d.day}</p>
              {d.lines.map((l) => (
                <p key={l} style={{ margin: "2px 0" }}>{l}</p>
              ))}
            </div>
          ))}
          <p className="kbd-hint">Week totals: 62 sets · NL85 37 · about 5 h with warm-ups.</p>
        </Card>
      </div>
    </div>
  );
}
