# Qala phone app (Capacitor 8 wrapper)

Bundles the `apps/web` phone shell (`#/phone/...`) into an APK so GPS keeps
recording with the screen locked. The desktop shell stays a PWA; the phone
shell still builds as a PWA for lifting-only use (incl. iOS).

## Build

From the repo root (signing keystore lives outside the repo):

```
deno task build          # builds apps/web into apps/web/dist
npx cap sync android     # run inside apps/phone after npm install
./gradlew assembleRelease -p apps/phone/android
```

`npm install` inside `apps/phone` pulls the real plugin packages declared in
`package.json`; until then `src/capacitor.d.ts` carries matching ambient
interfaces so `tsc --noEmit` passes on glue alone.

## Native pieces

- `capacitor.config.ts`: app id `com.qala.app`, `webDir: ../web/dist`,
  background-geolocation defaults (foreground service + notification copy).
- `src/native/geolocation.ts`: capture-only recorder; fixes forwarded with
  their own timestamps, deduplicated by timestamp; run-in-progress persists
  locally so a killed app loses seconds.
- `src/native/audioCues.ts`: TTS cues. Gate: verify Spotify ducking on the
  Nothing Phone before guided workouts.
- `src/native/hrm.ts`: optional BLE heart-rate strap (0x180D/0x2A37).
- `android/.../AndroidManifest.xml`: location (incl. background),
  foreground-service location, notifications, BLE permissions + the
  `RunRecordingService` (type location).

## Sideload (Nothing Phone)

1. Install the signed APK (unknown sources allowed for the installer).
2. Exempt Qala from battery optimisation before the first long run.
3. Grant location + notifications at first run start; grant background
   location when recording starts. Gate: a 2 h locked-screen recording
   must show no raw-fix gap over 10 s.
