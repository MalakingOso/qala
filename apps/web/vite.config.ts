import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Qala web: one codebase, two shells. `?shell=phone` (or /phone path)
// serves the phone shell; default serves the desktop shell. The Capacitor
// wrapper in apps/phone bundles the phone shell build.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
