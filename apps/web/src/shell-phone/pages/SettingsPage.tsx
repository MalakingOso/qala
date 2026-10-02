/* Settings (DESIGN 7.13), groups in order: Units; Bars and plates;
 * Equipment; Warm-up; Rest timer; Check-ins; Running; Coach; Appearance. */

import { useQala } from "../../store/qalaStore.tsx";
import { GEAR_FOR, GearSlot } from "../../shared/gear.tsx";
import {
  Group,
  GroupRow,
  PlateChips,
  ScalePicker,
  Toggle,
} from "../../shared/ui.tsx";

export function SettingsPage() {
  const { settings: s, updateSettings: u } = useQala();
  const flipEq = (k: keyof typeof s.equipment) =>
    u((p) => ({ ...p, equipment: { ...p.equipment, [k]: !p.equipment[k] } }));
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Settings</h1>
      </div>
      <Group label="Units">
        <GroupRow>
          <span>Weight</span>
          <span className="kbd-hint">lb</span>
        </GroupRow>
        <GroupRow>
          <span>Distance and pace</span>
          <span className="kbd-hint">mi · min/mi</span>
        </GroupRow>
      </Group>
      <Group
        label="Bars and plates"
        action={<a className="link-btn" href="#/phone/plates">Calculator</a>}
      >
        <GroupRow>
          <span>Default bar</span>
          <span className="kbd-hint">{s.defaultBar} lb</span>
        </GroupRow>
        <GroupRow>
          <span>EZ bar</span>
          <span className="kbd-hint">{s.ezBar} lb</span>
        </GroupRow>
        <GroupRow>
          <span>Collars</span>
          <span className="kbd-hint">{s.collarWeight} lb</span>
        </GroupRow>
        <GroupRow>
          <span>Plate colors</span>
          <PlateChips
            plates={s.plates.map((p) => p.weight)}
            inventory={s.plates}
            mode="row"
            size={26}
          />
        </GroupRow>
      </Group>
      <Group label="Equipment you own">
        {(
          [
            ["foamRoller", "Foam roller"],
            ["percussion", "Theragun"],
            ["bike", "Bike"],
            ["rower", "Rower"],
            ["treadmill", "Treadmill"],
          ] as const
        ).map(([k, label]) => (
          <GroupRow key={k}>
            <span className="eq-label">
              <GearSlot name={GEAR_FOR[k]} />
              <span>{label}</span>
            </span>
            <Toggle
              on={s.equipment[k]}
              onFlip={() => flipEq(k)}
              label={label}
            />
          </GroupRow>
        ))}
      </Group>
      <Group label="Warm-up">
        <GroupRow>
          <span>Build a warm-up</span>
          <Toggle
            on={s.warmup.enabled}
            onFlip={() =>
              u((p) => ({
                ...p,
                warmup: { ...p.warmup, enabled: !p.warmup.enabled },
              }))}
            label="Build a warm-up"
          />
        </GroupRow>
        <GroupRow>
          <span>Soft tissue</span>
          <Toggle
            on={s.warmup.softTissue}
            onFlip={() =>
              u((p) => ({
                ...p,
                warmup: { ...p.warmup, softTissue: !p.warmup.softTissue },
              }))}
            label="Soft tissue"
          />
        </GroupRow>
        <GroupRow>
          <span>Prefer Theragun</span>
          <Toggle
            on={s.warmup.preferPercussion}
            onFlip={() =>
              u((p) => ({
                ...p,
                warmup: {
                  ...p.warmup,
                  preferPercussion: !p.warmup.preferPercussion,
                },
              }))}
            label="Prefer Theragun"
          />
        </GroupRow>
        <GroupRow>
          <span>Time</span>
          <span className="kbd-hint">{s.warmup.minutes} min</span>
        </GroupRow>
      </Group>
      <Group label="Rest timer">
        <GroupRow>
          <span>Automatic</span>
          <Toggle
            on={s.rest.auto}
            onFlip={() =>
              u((p) => ({ ...p, rest: { ...p.rest, auto: !p.rest.auto } }))}
            label="Automatic rest"
          />
        </GroupRow>
        <GroupRow>
          <span>Learn from taps</span>
          <Toggle
            on={s.rest.learnFromTaps}
            onFlip={() =>
              u((p) => ({
                ...p,
                rest: { ...p.rest, learnFromTaps: !p.rest.learnFromTaps },
              }))}
            label="Learn from taps"
          />
        </GroupRow>
        <GroupRow>
          <span>Show plates for next set</span>
          <Toggle
            on={s.rest.showNextPlates}
            onFlip={() =>
              u((p) => ({
                ...p,
                rest: { ...p.rest, showNextPlates: !p.rest.showNextPlates },
              }))}
            label="Show plates"
          />
        </GroupRow>
        <GroupRow>
          <span>Alert</span>
          <span className="kbd-hint">{s.rest.alert}</span>
        </GroupRow>
      </Group>
      <Group label="Check-ins">
        <GroupRow>
          <span>Daily sleep/stress 1-7</span>
          <span className="kbd-hint">off by default</span>
        </GroupRow>
      </Group>
      <Group label="Running">
        <GroupRow>
          <span>Audio cues</span>
          <Toggle
            on={s.run.audioCues}
            onFlip={() =>
              u((p) => ({
                ...p,
                run: { ...p.run, audioCues: !p.run.audioCues },
              }))}
            label="Audio cues"
          />
        </GroupRow>
        <GroupRow>
          <span>Auto-pause</span>
          <Toggle
            on={s.run.autoPause}
            onFlip={() =>
              u((p) => ({
                ...p,
                run: { ...p.run, autoPause: !p.run.autoPause },
              }))}
            label="Auto-pause"
          />
        </GroupRow>
        <GroupRow>
          <span>Heart-rate strap</span>
          <Toggle
            on={s.run.hrStrap}
            onFlip={() =>
              u((p) => ({ ...p, run: { ...p.run, hrStrap: !p.run.hrStrap } }))}
            label="Heart-rate strap"
          />
        </GroupRow>
        <GroupRow>
          <span>Offline map area</span>
          <span className="kbd-hint">home region cached</span>
        </GroupRow>
      </Group>
      <Group label="Coach">
        <GroupRow>
          <span>Status</span>
          <span className="kbd-hint">{s.coach.status}</span>
        </GroupRow>
        <GroupRow>
          <span>Limits</span>
          <span className="kbd-hint">{s.coach.limits}</span>
        </GroupRow>
      </Group>
      <Group label="Appearance">
        <div className="group-row stacked">
          <span>Theme</span>
          <ScalePicker
            label="Theme"
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
            value={s.theme}
            onPick={(t) => u((p) => ({ ...p, theme: t }))}
          />
        </div>
        <div className="group-row stacked">
          <span>Title font</span>
          <ScalePicker
            label="Title font"
            options={[
              { value: "qalaTest", label: "Qala Test" },
              { value: "faustina", label: "Faustina" },
            ]}
            value={s.titleFont}
            onPick={(f) => u((p) => ({ ...p, titleFont: f }))}
          />
          <span className="title font-sample">Lower A · 245 × 4</span>
        </div>
      </Group>
    </div>
  );
}
