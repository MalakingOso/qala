import type { CapacitorConfig } from "@capacitor/core";

// Capacitor 8 wrapper (PLAN 3, 8a). The React phone build is bundled into
// the APK, never loaded from a URL; sync still goes over Tailscale to
// wss://callisto.taila63f23.ts.net:8443. Android first; ios/ later.
const config: CapacitorConfig = {
  appId: "com.qala.app",
  appName: "Qala",
  webDir: "../web/dist",
  backgroundColor: "#f5f5f7",
  android: {
    allowMixedContent: false,
  },
  plugins: {
    BackgroundGeolocation: {
      // @capgo/background-geolocation (MPL-2.0). Foreground service with a
      // persistent notification; see android/AndroidManifest.xml.
      stationaryRadius: 10,
      distanceFilter: 5,
      desiredAccuracy: 10,
      showsBackgroundLocationIndicator: true,
      notificationTitle: "Qala is recording your run",
      notificationText: "GPS active. Thanks for leaving the screen locked.",
    },
  },
};

export default config;
