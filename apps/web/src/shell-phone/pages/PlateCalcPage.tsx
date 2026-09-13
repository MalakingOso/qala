/* Plate calculator sheet (DESIGN 7.12): big target figure, bar choice,
 * one-side drawing, arithmetic summary, editable inventory. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import {
  Card,
  Group,
  GroupRow,
  PlateChips,
  PlateDrawing,
} from "../../shared/ui.tsx";
import {
  nearestLoadable,
  planPlates,
  platesShorthand,
} from "../../../../../packages/core/plates.ts";
import { Minus, Plus } from "../../shared/icons.ts";

export function PlateCalcPage() {
  const { settings, updateSettings } = useQala();
  const [target, setTarget] = useState(245);
  const plan = planPlates(
    target,
    settings.defaultBar,
    settings.plates,
    settings.collarWeight,
  );
  const load = nearestLoadable(plan);
  const perSide = load?.perSide ?? [];
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Plate calculator</h1>
        <a className="link-btn" href="#/phone/settings">Edit inventory</a>
      </div>
      <Card hero>
        <p className="group-label">Target weight</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Less weight"
            onClick={() => setTarget((t) => Math.max(45, t - 5))}
          >
            <Minus size={18} />
          </button>
          <span className="figure" style={{ fontSize: 64 }}>{target}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="More weight"
            onClick={() => setTarget((t) => t + 5)}
          >
            <Plus size={18} />
          </button>
        </div>
        <p className="group-label">Bar</p>
        <div style={{ display: "flex", gap: 6 }}>
          {[45, 35].map((b) => (
            <button
              key={b}
              type="button"
              className="chip"
              aria-pressed={settings.defaultBar === b}
              onClick={() => updateSettings((s) => ({ ...s, defaultBar: b }))}
              style={settings.defaultBar === b
                ? { outline: "2px solid var(--accent)" }
                : undefined}
            >
              {b} lb bar
            </button>
          ))}
        </div>
        <PlateDrawing
          perSide={perSide}
          barWeight={settings.defaultBar}
          label={`Plates for ${target}`}
        />
        <p>
          {settings.defaultBar} + ({perSide.join(" + ") || "0"}) x 2 ={" "}
          <span className="figure">{load ? load.total : "not loadable"}</span>
          {load && load.total !== target
            ? <span className="kbd-hint">(nearest to {target})</span>
            : null}
        </p>
        <p>
          <PlateChips plates={perSide} /> {platesShorthand(perSide)}
        </p>
      </Card>
      <Group label="Your plates">
        {settings.plates.map((p) => (
          <GroupRow key={p.weight}>
            <span>{p.weight} lb</span>
            <span className="kbd-hint">
              {p.pairs === "enough" ? "enough" : `${p.pairs} pair(s)`}
            </span>
          </GroupRow>
        ))}
      </Group>
    </div>
  );
}
