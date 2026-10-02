/* Program editor (DESIGN 7.15, DECISIONS U21): where the block stands, the
 * one ember action (generate the next block), the liftoscript source with
 * inline errors, and the evaluated week preview. CodeMirror 6 hosts the
 * buffer; the Lezer grammars from packages/liftoscript plug into `language`
 * once the vendored parsers build. */

import { useEffect, useRef, useState } from "react";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { sampleBlock } from "../store/sample.ts";
import { BlockBar, Bunch, PageHeader, Panel, Pill, TypeTag } from "./parts.tsx";

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
        <Panel title="liftoscript">
          <div
            className="code-editor"
            ref={host}
            role="textbox"
            aria-label="Program source"
            aria-multiline="true"
          />
          <div className="editor-status">
            {errors.length > 0
              ? (
                <ul>
                  {errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )
              : <Pill tone="ok">No errors</Pill>}
            <span>{text.split("\n").length} lines</span>
          </div>
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
    </div>
  );
}
