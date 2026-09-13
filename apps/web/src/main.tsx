import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker for the PWA build (M4/M9). Capacitor bundles local files
// and never hits this path.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline shell is best-effort; the app works without it.
    });
  });
}
