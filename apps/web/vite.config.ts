import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lsppWasm } from "./lsppWasmPlugin.ts";

// Qala web: one codebase, two shells. `?shell=phone` (or /phone path)
// serves the phone shell; default serves the desktop shell. The phone shell
// is frozen as a PWA; the Android app is native Kotlin in apps/android.
// The dev server binds IPv4 on purpose: Firefox resolves `localhost` to ::1
// and then never reaches a server that only listens on 127.0.0.1.
export default defineConfig({
  plugins: [react(), lsppWasm()],
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
