/* One codebase, two shells (PLAN 3). Hash routes: #/ landing,
 * #/phone/* logger + run recorder, #/desktop/* author. The Capacitor
 * wrapper boots straight into #/phone/today. */

import { useEffect, useState } from "react";
import { QalaProvider, useQala } from "./store/qalaStore.tsx";
import { applyTheme, applyTitleFont, watchSystemTheme } from "./theme/theme.ts";
import { PhoneShell } from "./shell-phone/PhoneShell.tsx";
import { DesktopShell } from "./shell-desktop/DesktopShell.tsx";
import { LandingPage } from "./shell-phone/pages/LandingPage.tsx";

export function useHashRoute(): string {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "#/" : window.location.hash || "#/"
  );
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

function Shell() {
  const route = useHashRoute();
  const { settings } = useQala();

  useEffect(() => {
    applyTheme(settings.theme);
    return watchSystemTheme(settings.theme);
  }, [settings.theme]);
  useEffect(() => {
    applyTitleFont(settings.titleFont);
  }, [settings.titleFont]);

  if (route === "/" || route === "") return <LandingPage />;
  if (route.startsWith("/desktop")) return <DesktopShell route={route} />;
  return <PhoneShell route={route} />;
}

export function App() {
  return (
    <QalaProvider>
      <Shell />
    </QalaProvider>
  );
}
