import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Qala web: one codebase, two shells. `?shell=phone` (or /phone path)
// serves the phone shell; default serves the desktop shell. The phone shell
// is frozen as a PWA; the Android app is native Kotlin in apps/android.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
