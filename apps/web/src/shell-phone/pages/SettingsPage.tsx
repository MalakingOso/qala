/* Settings (DESIGN 7.13), groups in order: Units; Bars and plates;
 * Equipment; Warm-up; Rest timer; Check-ins; Running; Coach; Appearance. */

import { useQala } from "../../store/qalaStore.tsx";
import { Group, GroupRow } from "../../shared/ui.tsx";

function Toggle({ on, onFlip, label }: { on: boolean; onFlip: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={onFlip}>
      <span className="knob" aria-hidden="true" />
    </button>
  );
}

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
          <span>Weight · lb</span>
          <span className="kbd-hint">Distance · mi · pace min/mi</span>
        </GroupRow>
      </Group>
      <Group label="Bars and plates" action={<a className="link-btn" href="#/phone/plates">Calculator</a>}>
        <GroupRow>
          <span>Default bar · {s.defaultBar} lb</span>
          <span className="kbd-hint">collar {s.collarWeight} lb</span>
        </GroupRow>
        <GroupRow>
          <span>Plate colors</span>
          <span className="kbd-hint">bumper · editable</span>
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
            <span>{label}</span>
            <Toggle on={s.equipment[k]} onFlip={() => flipEq(k)} label={label} />
          </GroupRow>
        ))}
      </Group>
      <Group label="Warm-up">
        <GroupRow>
          <span>Build a warm-up</span>
          <Toggle on={s.warmup.enabled} onFlip={() => u((p) => ({ ...p, warmup: { ...p.warmup, enabled: !p.warmup.enabled } }))} label="Build a warm-up" />
        </GroupRow>
        <GroupRow>
          <span>Soft tissue</span>
          <Toggle on={s.warmup.softTissue} onFlip={() => u((p) => ({ ...p, warmup: { ...p.warmup, softTissue: !p.warmup.softTissue } }))} label="Soft tissue" />
        </GroupRow>
        <GroupRow>
          <span>Prefer Theragun</span>
          <Toggle on={s.warmup.preferPercussion} onFlip={() => u((p) => ({ ...p, warmup: { ...p.warmup, preferPercussion: !p.warmup.preferPercussion } }))} label="Prefer Theragun" />
        </GroupRow>
        <GroupRow>
          <span>Time · {s.warmup.minutes} min</span>
        </GroupRow>
      </Group>
      <Group label="Rest timer">
        <GroupRow>
          <span>Automatic</span>
          <Toggle on={s.rest.auto} onFlip={() => u((p) => ({ ...p, rest: { ...p.rest, auto: !p.rest.auto } }))} label="Automatic rest" />
        </GroupRow>
        <GroupRow>
          <span>Learn from taps</span>
          <Toggle on={s.rest.learnFromTaps} onFlip={() => u((p) => ({ ...p, rest: { ...p.rest, learnFromTaps: !p.rest.learnFromTaps } }))} label="Learn from taps" />
        </GroupRow>
        <GroupRow>
          <span>Show plates for next set</span>
          <Toggle on={s.rest.showNextPlates} onFlip={() => u((p) => ({ ...p, rest: { ...p.rest, showNextPlates: !p.rest.showNextPlates } }))} label="Show plates" />
        </GroupRow>
        <GroupRow>
          <span>Alert · {s.rest.alert}</span>
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
          <Toggle on={s.run.audioCues} onFlip={() => u((p) => ({ ...p, run: { ...p.run, audioCues: !p.run.audioCues } }))} label="Audio cues" />
        </GroupRow>
        <GroupRow>
          <span>Auto-pause</span>
          <Toggle on={s.run.autoPause} onFlip={() => u((p) => ({ ...p, run: { ...p.run, autoPause: !p.run.autoPause } }))} label="Auto-pause" />
        </GroupRow>
        <GroupRow>
          <span>Heart-rate strap</span>
          <Toggle on={s.run.hrStrap} onFlip={() => u((p) => ({ ...p, run: { ...p.run, hrStrap: !p.run.hrStrap } }))} label="Heart-rate strap" />
        </GroupRow>
        <GroupRow>
          <span>Offline map area</span>
          <span className="kbd-hint">home region cached</span>
        </GroupRow>
      </Group>
      <Group label="Coach">
        <GroupRow>
          <span>Status · {s.coach.status}</span>
        </GroupRow>
        <GroupRow>
          <span>Limits · {s.coach.limits}</span>
        </GroupRow>
      </Group>
      <Group label="Appearance">
        <GroupRow>
          <span>Theme · {s.theme}</span>
          <span>
            {(["light", "dark", "system"] as const).map((t) => (
              <button key={t} type="button" className="chip" aria-pressed={s.theme === t} onClick={() => u((p) => ({ ...p, theme: t }))}>
                {t}
              </button>
            ))}
          </span>
        </GroupRow>
        <GroupRow>
          <span>Title font · {s.titleFont === "qalaTest" ? "Qala Test" : "Faustina"}</span>
          <span>
            <button type="button" className="chip" onClick={() => u((p) => ({ ...p, titleFont: "qalaTest" as const }))}>Qala Test</button>{" "}
            <button type="button" className="chip" onClick={() => u((p) => ({ ...p, titleFont: "faustina" as const }))}>Faustina</button>
          </span>
        </GroupRow>
      </Group>
    </div>
  );
}
