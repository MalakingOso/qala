/* Plate calculator sheet (DESIGN 7.12): big target figure, bar choice,
 * the loaded bar for one side, the arithmetic, and the inventory as the
 * plates themselves. */

import { useState } from "react";
import { useQala } from "../../store/qalaStore.tsx";
import {
  Card,
  Group,
  PlateChips,
  PlateDrawing,
  ScalePicker,
  SecondaryButton,
  Stepper,
  Toggle,
} from "../../shared/ui.tsx";
import {
  bumperColorFor,
  nearestLoadable,
  planPlates,
} from "../../../../../packages/core/plates.ts";
import { Minus, Plus } from "../../shared/icons.ts";

export function PlateCalcPage() {
  const { settings, updateSettings } = useQala();
  const [target, setTarget] = useState(245);
  // The EZ bar is chosen for this screen only, so it doesn't change the bar
  // every lift's plates are planned with; 45 and 35 set the default.
  const [ez, setEz] = useState(false);
  const barWeight = ez ? settings.ezBar : settings.defaultBar;
  const plan = planPlates(
    target,
    barWeight,
    settings.plates,
    settings.collarWeight,
  );
  const load = nearestLoadable(plan);
  const perSide = load?.perSide ?? [];
  // 55s are optional and switched per session: sometimes they are there,
  // sometimes not. Off by default.
  const p55 = settings.plates.find((p) => p.weight === 55);
  const pairs55 = typeof p55?.pairs === "number" ? p55.pairs : 1;
  const set55 = (pairs: number | null) =>
    updateSettings((s) => {
      const rest = s.plates.filter((p) => p.weight !== 55);
      return {
        ...s,
        plates: pairs === null ? rest : [
          { weight: 55, pairs, color: p55?.color ?? bumperColorFor(55, "lb") },
          ...rest,
        ],
      };
    });
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Plates</h1>
        <SecondaryButton small href="#/phone/settings">
          Edit plates
        </SecondaryButton>
      </div>
      <Card hero>
        <div className="calc-top">
          <Stepper
            label="Target"
            value={target}
            unit="lb"
            step={5}
            onStep={(d) => setTarget((t) => Math.max(barWeight, t + d))}
          />
          <div className="calc-bar">
            <span className="group-label">Bar</span>
            <ScalePicker<number | "ez">
              label="Bar"
              options={[
                { value: 45, label: "45" },
                { value: 35, label: "35" },
                { value: "ez", label: `EZ ${settings.ezBar}` },
              ]}
              value={ez ? "ez" : settings.defaultBar}
              onPick={(b) => {
                if (b === "ez") return setEz(true);
                setEz(false);
                updateSettings((s) => ({ ...s, defaultBar: b }));
              }}
            />
          </div>
        </div>
        <PlateDrawing
          perSide={perSide}
          barWeight={barWeight}
          bar={ez ? "ez" : "straight"}
          label={`Plates for ${target}`}
          inventory={settings.plates}
        />
        <p className="calc-sum">
          {barWeight} {ez ? "EZ " : ""}bar + 2 × {load ? load.perSideTotal : 0}
          {" "}
          = <strong className="figure">{load ? load.total : "—"}</strong>
          {load && load.total !== target
            ? (
              <span className="kbd-hint">
                nearest you can load to {target}
              </span>
            )
            : null}
        </p>
      </Card>
      <Group label="Your plates">
        <div className="group-row plate-55">
          <span className="inventory-plate">
            <PlateChips
              plates={[55]}
              inventory={settings.plates}
              mode="single"
            />
            <span>55 lb</span>
          </span>
          {p55
            ? (
              <span className="pair-step">
                <button
                  type="button"
                  aria-label="One fewer pair of 55s"
                  disabled={pairs55 <= 1}
                  onClick={() => set55(pairs55 - 1)}
                >
                  <Minus size={16} />
                </button>
                <span className="kbd-hint">
                  {pairs55} {pairs55 === 1 ? "pair" : "pairs"}
                </span>
                <button
                  type="button"
                  aria-label="One more pair of 55s"
                  onClick={() => set55(pairs55 + 1)}
                >
                  <Plus size={16} />
                </button>
              </span>
            )
            : <span className="kbd-hint plate-55-off">off for now</span>}
          <Toggle
            on={!!p55}
            label="Use 55 lb plates"
            onFlip={() => set55(p55 ? null : 1)}
          />
        </div>
        {settings.plates.filter((p) => p.weight !== 55).map((p) => (
          <div className="group-row" key={p.weight}>
            <span className="inventory-plate">
              <PlateChips
                plates={[p.weight]}
                inventory={settings.plates}
                mode="single"
              />
              <span>{p.weight} lb</span>
            </span>
            <span className="kbd-hint">
              {p.pairs === "enough"
                ? "plenty"
                : `${p.pairs} ${p.pairs === 1 ? "pair" : "pairs"}`}
            </span>
          </div>
        ))}
      </Group>
    </div>
  );
}
