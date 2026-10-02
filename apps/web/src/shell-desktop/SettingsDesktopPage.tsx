/* Desktop Settings: the phone's settings groups under the refined lede card,
 * flowed into two columns by CSS (`.settings-flow`). Same rows, same state. */

import { SettingsPage } from "../shell-phone/pages/SettingsPage.tsx";
import { PageHeader } from "./parts.tsx";

export function DesktopSettingsPage() {
  return (
    <div>
      <PageHeader
        kicker="Units, equipment, timers and the coach"
        title="Settings"
        ruleless
      />
      <div className="settings-flow">
        <SettingsPage embedded />
      </div>
    </div>
  );
}
