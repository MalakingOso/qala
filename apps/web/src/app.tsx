/* Hash routes: #/ landing, #/desktop/* author. The phone is the native
 * Kotlin app (apps/android); the web has no phone shell. */

import { useEffect, useState } from "react";
import { QalaProvider, useQala } from "./store/qalaStore.tsx";
import { applyTheme, applyTitleFont, watchSystemTheme } from "./theme/theme.ts";
import { DesktopShell } from "./shell-desktop/DesktopShell.tsx";
import { LandingPage } from "./shared/landing/LandingPage.tsx";

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
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [route]);

  useEffect(() => {
    applyTheme(settings.theme);
    return watchSystemTheme(settings.theme);
  }, [settings.theme]);
  useEffect(() => {
    applyTitleFont(settings.titleFont);
  }, [settings.titleFont]);

  if (route.startsWith("/desktop")) return <DesktopShell route={route} />;
  return <LandingPage />;
}

export function App() {
  return (
    <QalaProvider>
      <Shell />
    </QalaProvider>
  );
}
