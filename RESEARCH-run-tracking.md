# Research: GPS run recording, guided runs, maps, audio, heart rate

Written 2026-09-13 for Qala (see PLAN.md). Scope: Runkeeper-style run recording (time, distance, current and average pace, splits with voice cues, route map with mile markers, pause/resume, optional HR strap) and guided running workouts with voice prompts.

Tagging: `[verified: URL]` means I read the source (or a quoted excerpt of it) and it says what the sentence says. `[verified via search excerpt: URL]` means the source's own text as surfaced by a search tool, without reading the full page. `[unverified]` means inference, an engineering default, or a secondary source I couldn't confirm. Where a claim rests on a coordinator's reading of third-party code, it says so.

## 0. Verdict

**Screen-off PWA GPS is ruled out by the spec on both platforms.** The W3C Geolocation spec (Candidate Recommendation Snapshot, 26 March 2026, edited by Marcos Caceres of Apple and Reilly Grant of Google) says position updates are only for fully active, visible documents, and that updates for hidden documents "get silently dropped on the floor" [verified: https://www.w3.org/TR/geolocation/]. Chromium implemented exactly this in August 2026: requests made while a page is hidden stay dormant, timers pause, and no location is delivered to JavaScript until the page is visible again [verified: https://chromium.googlesource.com/chromium/src/+/4186a1ef149c1cb571a3df0d55982c719fe7b644%5E%21/]. Firefox has the same rule in code ("Don't update position if window is not fully active or the document is hidden") [verified: https://searchfox.org/firefox-main/source/dom/geolocation/Geolocation.cpp]. Locking the screen or switching apps makes the page hidden, so a 60-120 minute run with the phone in a pocket and the screen off can't be recorded by a PWA on Android Chrome or iOS Safari. Silent audio doesn't change this: audio can keep JavaScript running, but delivery of positions is gated on visibility, not on the CPU being awake. It fails by design, not just unreliably.

**Screen-on PWA is possible but poor.** With the Screen Wake Lock API holding the screen on, the page stays visible and `watchPosition` keeps delivering. On Android that works today. On iOS the Wake Lock only started working in Home Screen web apps with iOS 18.4 (31 March 2025) [verified: https://bugs.webkit.org/show_bug.cgi?id=254545]. The costs: two hours of screen-on battery drain, pocket touches, and one accidental press of the power button ends GPS delivery until the user unlocks. It's a demo mode, not a run tracker.

**Recommendation:** go native for the run recorder, which is exactly the case PLAN.md reserved Capacitor for. Build the phone shell as a Capacitor 8 app with the Preact bundle inside the APK, background GPS from a plugin backed by an Android foreground service, native TTS, and native BLE for heart rate. Sideload the APK onto the owner's Nothing Phone (no Play Store, no fees). The PWA stays as the desktop shell and as a fallback phone logger for lifting. For iOS friends later, the same Capacitor project builds for iOS, but distributing it needs the $99/year Apple Developer Program and TestFlight. Details in section 2.

An outside data point agrees: jara (GPL-3.0 Flutter running app, https://github.com/jakobbjelver/jara) went native for background GPS, using an Android foreground service with `foregroundServiceType="location"` and a persistent "Tracking your run" notification, and iOS `UIBackgroundModes` location [coordinator's reading of the jara source; not independently checked].

## 1. Can a PWA record GPS for 60-120 minutes with the screen off?

### Geolocation when hidden

- Spec: `watchPosition` waits while the document's visibility state is "hidden", and position updates for documents that aren't fully active and visible are dropped [verified: https://www.w3.org/TR/geolocation/].
- Chrome: the August 2026 Blink change pauses pending requests and their timeout timers on hide and resumes them on show, and cached positions can satisfy pending requests at unhide. No feature flag is mentioned [verified: https://chromium.googlesource.com/chromium/src/+/4186a1ef149c1cb571a3df0d55982c719fe7b644%5E%21/]. The commit is five weeks old and may not be in stable Chrome yet [unverified], but reports from before it (issue #496 below, January 2025) already describe updates stopping when the page is hidden. The commit formalises existing behaviour. Older Chromium bugs about geolocation stopping in the background exist (for example issues.chromium.org/issues/41186218), but the tracker page needs a sign-in and I couldn't read it [unverified].
- Developer reports: a January 2025 request on Google's android-browser-helper repo says "the Web Geolocation API immediately stops working as soon as the page goes from foreground to background" and asks for a native bridge. It's still open with no maintainer reply [verified: https://github.com/GoogleChrome/android-browser-helper/issues/496].
- iOS/WebKit: the spec's editors include Apple, and WebKit's `Geolocation.cpp` has a `suspend()` path that stops timers and marks geolocation suspended when the page is suspended [verified: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/Modules/geolocation/Geolocation.cpp]. A 2025 WebKit change (bug 301060) also shows `Geolocation` wired as an `ActivityStateChangeObserver` to `Page::setActivityState`, with `startUpdating`/`stopUpdating` among the touched functions. That's the hook WebKit uses to stop updates when a page stops being active [verified from the PR's commit listing: https://github.com/webkit/webkit/issues/52630]. I didn't find a WebKit bug that shows a locked Home Screen web app getting fixes. A 10-minute on-device test with the screen locked would settle the iOS case for good [unverified].

### Screen Wake Lock

- Keeps the screen from dimming and locking. It's released automatically when the document becomes hidden, and the system can refuse or release it on low battery or in power-save mode. It only covers the screen and says nothing about keeping the CPU awake [verified: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API].
- Baseline 2025 [verified: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API]. It was broken in iOS Home Screen web apps from 2023 until iOS 18.4 [verified: https://bugs.webkit.org/show_bug.cgi?id=254545].
- A PWA fallback would have to re-request the lock on `visibilitychange` back to visible (MDN pattern) and log gaps where the page was hidden [verified: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API].

### Silent audio

- Media playback on the web keeps the system out of standby on Android [verified: https://web.dev/articles/app-like-pwas]. That keeps JavaScript alive. It doesn't make the document visible, and the spec gates geolocation on visibility, so position callbacks still stop [verified: https://www.w3.org/TR/geolocation/]. Treat the silent-audio trick as dead for GPS.
- On iOS, a Home Screen web app's audio is suspended once playback has been paused for about 30 seconds on the lock screen, and it won't resume until the app is foregrounded (August 2024 report, unresolved) [verified: https://developer.apple.com/forums/thread/762582].

### Background Geolocation, Periodic Background Sync, other APIs

- No background geolocation API exists or is in progress. The W3C issue asking for background geolocation through service workers (opened 2017) is closed [verified: https://github.com/w3c/geolocation/issues/13]. The Devices and Sensors WG published the Geolocation Sensor spec as a Discontinued Draft and noted that no implementers were interested in background geolocation or geofencing [verified via search excerpt: https://www.w3.org/TR/geolocation-sensor/]. Developers were still asking for it in June 2025 [verified: https://lists.w3.org/Archives/Public/public-device-apis-log/2025Jun/0000.html].
- Periodic Background Sync is Chromium-only, only for installed apps, throttled by site engagement, with at least 12 hours between events. The Geolocation API isn't available in service workers, so it can't record a run anyway [verified via search excerpt: https://developer.chrome.com/docs/capabilities/periodic-background-sync].
- Chrome's "Freezing on Energy Saver" (Chrome 133, February 2025) freezes CPU-heavy tabs that have been hidden and silent for over 5 minutes, and exempts pages controlling devices over Web Bluetooth. The post doesn't name platforms. It's a desktop Energy Saver feature, so don't read it as Android evidence [verified: https://developer.chrome.com/blog/freezing-on-energy-saver].
- iOS 26 opens every site added to the Home Screen as a web app by default. That's a distribution nicety and doesn't change background limits [verified: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/].

## 2. The minimum native path

### Options compared

| Option | Background GPS | Cost | Fit for Qala |
|---|---|---|---|
| Trusted Web Activity | No. A TWA is Chrome showing the page, so the visibility rule still applies. Location delegation only passes the permission through [verified: https://github.com/GoogleChrome/android-browser-helper/issues/496; delegation semantics via search excerpt: https://issues.chromium.org/issues/513119757] | Free | Doesn't solve the problem without writing a native service plus a postMessage bridge anyway (the open request in issue #496) |
| Tiny native companion (Kotlin service that records and posts to the server or the PWA) | Yes | Free | Two apps, two UIs, a handoff protocol. More code than Capacitor for the same result |
| Capacitor + `@capacitor-community/background-geolocation` | Yes, via an Android foreground service; iOS via background location mode [verified: https://github.com/capacitor-community/background-geolocation/blob/master/README.md] | Free, MIT, v1.2.26, peer dep `@capacitor/core >=3.0.0` [verified: https://registry.npmjs.org/@capacitor-community/background-geolocation/latest] | README documents Capacitor 3-7 only; no GitHub releases and no Capacitor 8 statement found [verified: https://github.com/capacitor-community/background-geolocation/releases] |
| Capacitor + `@capgo/background-geolocation` | Yes | Free, MPL-2.0. Supports Capacitor 8 and only the latest major is maintained. Independent implementation, not a fork [verified: https://github.com/Cap-go/capacitor-background-geolocation] | Best match for a new Capacitor 8 project |
| Capacitor + `@transistorsoft/capacitor-background-geolocation` | Yes, plus motion detection, survives force-quit and reboot [verified: https://capawesome.io/blog/alternative-to-transistorsoft-background-geolocation/] | Release builds need a license key; debug builds don't [verified: https://docs.transistorsoft.com/capacitor/setup/]. $399 for 1 app id up to $999 for 100, perpetual with 1 year of updates, covers iOS and Android [verified: https://docs.transistorsoft.com/purchase/]. Since v9 (March 2026) Android release builds need a key too [verified: https://capawesome.io/blog/alternative-to-transistorsoft-background-geolocation/] | Built for fleet tracking and geofencing. Overkill for a user-started run |
| Capacitor + Capawesome background geolocation | Yes, Capacitor 8+ only, with a native SQLite queue | $99/month, $990/year, or $1,980 one-time [verified: https://capawesome.io/blog/alternative-to-transistorsoft-background-geolocation/] | Paid, and the upload queue isn't needed since Qala already syncs through automerge |

### Android specifics

- Capacitor 8 shipped December 2025, min Android API 24 [verified via search excerpt: https://ionic.io/blog/announcing-capacitor-8].
- Android 14+ requires a foreground service type and the matching permission (`FOREGROUND_SERVICE_LOCATION` for location) [verified via search excerpt: https://developer.android.com/about/versions/14/changes/fgs-types-required]. A location foreground service can't be started from the background without `ACCESS_BACKGROUND_LOCATION`, so start the service while the app is on screen, when the user taps Start [verified via search excerpt: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start].
- Android 13+ needs the `POST_NOTIFICATIONS` permission for the persistent notification. Set `android.useLegacyBridge: true` in the Capacitor config, otherwise updates to the WebView halt after 5 minutes in the background [verified: https://github.com/capacitor-community/background-geolocation/blob/master/README.md]. The capgo plugin documents the same setting [verified: https://github.com/Cap-go/capacitor-background-geolocation].
- Android throttles HTTP requests made from the WebView after about 5 minutes in the background [verified: https://github.com/capacitor-community/background-geolocation/blob/master/README.md]. For Qala: write fixes into the local automerge document during the run and let sync catch up when the app returns to the foreground. Don't design around live upload.
- Capacitor's `server.url` (load the app from a remote URL) is for live-reload during development, not production [verified via search excerpt: https://capacitorjs.com/docs/config; https://github.com/ionic-team/capacitor/discussions/4080]. So the Preact phone shell is bundled into the APK and updated by installing a new APK. Sync still goes over the Tailscale WebSocket, which needs the Tailscale app connected on the phone [unverified].
- Distribution to the owner: build a release-signed APK with a self-generated keystore and install it with `adb install` or by opening the file. No Play Console account needed [unverified, standard Android practice].
- OEM battery killers: dontkillmyapp.com tracks vendors, but I couldn't reach a Nothing page [unverified]. Test a 2-hour recording on the actual phone and, if it gets killed, exempt Qala from battery optimisation.

### iOS specifics

- `Info.plist` needs the location usage descriptions and `UIBackgroundModes` containing `location`. The status bar shows a blue indicator while location is used in the background [verified: https://github.com/capacitor-community/background-geolocation/blob/master/README.md].
- A free Apple ID can install onto your own device from Xcode, but the provisioning profile lasts 7 days [verified via search excerpt: https://bitrig.com/blog/apple-developer-program-free-vs-paid]. AltStore Classic with a free Apple ID has the same 7-day expiry plus a 3-app limit [verified via search excerpt: https://faq.altstore.io/altstore-classic/your-altstore]. Fine for a developer, not for friends.
- The Apple Developer Program is $99/year and includes TestFlight with up to 10,000 external testers [verified via search excerpt: https://bitrig.com/blog/apple-developer-program-free-vs-paid]. TestFlight builds expire after 90 days, and external testers only get a build after Beta App Review [verified via search excerpt: https://techconcepts.org/blog/testflight-guide]. So iOS friends means $99/year, a Mac with Xcode, a build roughly every 90 days, and a light review.

### Recommendation and tradeoff

Build `apps/phone` as a Capacitor 8 wrapper around the existing Preact phone shell, with `@capgo/background-geolocation` for GPS. It's free, it targets Capacitor 8, and the license (MPL-2.0) works inside an AGPL project. If it disappoints on the Nothing Phone, swap in the community plugin, whose API is close. Transistorsoft only makes sense if you later want automatic motion detection, and $399 isn't justified for a run started by pressing a button.

The tradeoff is that the phone becomes an installed app you rebuild to update, which loses the PWA's zero-install updates. The lifting logger doesn't need native, so keep the PWA route live (same code, same automerge doc). If you'd rather keep lifting as a pure PWA, the Capacitor app can be only the run recorder. I'd still ship one Capacitor phone app so there's one icon and one local document. For iOS, don't spend $99 until a friend actually wants run tracking. Until then iOS users get the PWA with lifting only, plus an honest "screen must stay on" run mode if you want it.

**Does jara change this?** No. It confirms it. A comparable app hit the same wall and solved it with the same pattern: foreground service plus iOS background location mode [coordinator's reading of jara].

## 3. GPS processing pipeline

Published parameters from commercial running apps are scarce (Strava doesn't publish its thresholds [verified: https://support.strava.com/hc/en-us/articles/115001188684-Moving-Time-Speed-and-Pace-Calculations]), so most numbers below are engineering defaults to tune against replayed runs.

### Inputs and their meaning

- Android `Location.getAccuracy()` is the horizontal radius at 68% confidence [verified: https://learn.microsoft.com/en-us/dotnet/api/android.locations.location.accuracy?view=net-android-35.0, mirroring the Android reference]. The W3C `coords.accuracy` is defined at 95% confidence [verified: https://www.w3.org/TR/geolocation/]. Native plugins pass the Android value through. Use it as a 1-sigma-ish number [unverified].
- Keep every raw fix as captured, with the fix's own timestamp, never `Date.now()` at callback time. Fixes arrive late or batched when the app is backgrounded [unverified; jara's pace window uses `DateTime.now()` and gets distorted by exactly this, per the coordinator].

### Pipeline (defaults)

| Stage | Rule | Default | Source |
|---|---|---|---|
| Dedupe | Drop a fix whose timestamp is equal to or older than the last accepted one | exact timestamp match | [unverified; jara feeds foreground and background streams into one handler without dedupe, which double-counts distance, per the coordinator] |
| Warm-up | Don't start distance until the fix quality settles | 3 consecutive fixes with accuracy <= 20 m | [unverified] |
| Accuracy gate | Reject fixes that are too uncertain; pass the rest to the filter with R = accuracy squared | reject > 25 m | [unverified; jara has no accuracy gate at all, only a 5 m distance filter, per the coordinator] |
| Speed gate | Reject a fix whose implied speed from the last accepted fix is impossible for a runner. If 3 or more consecutive fixes agree with each other, re-anchor there (you were wrong, not them) | 7 m/s (the men's marathon record pace is under 6 m/s) | [unverified] |
| Kalman filter | Constant-velocity model in local metres (east/north): state [x, y, vx, vy], R = accuracy squared per fix, process noise from an acceleration term | acceleration sd around 1-2 m/s² for running | [unverified] |
| Kalman (simpler variant) | Position-only filter from the well-known Stack Overflow answer: variance = accuracy squared at start, grows by dt·Q² between fixes, Q in metres per second | Q about 3 m/s for foot speed | [verified structure: https://gitlab.ri.se/anton.gustafsson/digitalvision/-/blob/3f047e1de05829437cc3a02939c557a4b0272c20/Assets/Mapbox/Unity/Location/LocationSmoothing/KalmanFilter.cs; https://stackoverflow.com/questions/1134579/smooth-gps-data (excerpt only); Q value unverified] |
| Distance | Sum of geodesic segments between filtered positions, counted only while moving | Vincenty on each segment (see below) | [verified accuracy figures below] |
| Stationary jitter | Don't add a segment shorter than the combined uncertainty while speed is low | skip if segment < 2 m and filtered speed < 0.5 m/s | [unverified] |
| Current pace | Distance over the trailing time window of filtered points, windowed by fix timestamps | 20 s window, display updated at 1 Hz. Guided-workout prompts use a 30 s window | [unverified; Strava is reported to smooth over 10-30 s: https://www.findyouredge.app/news/why-garmin-and-strava-show-different-pace (secondary)] |
| Average pace | Moving time divided by distance; also keep elapsed time | none | [verified concept: https://support.strava.com/hc/en-us/articles/115001188684-Moving-Time-Speed-and-Pace-Calculations] |
| Auto-pause | Pause when filtered speed stays under the threshold for the hold time; resume above a higher threshold (hysteresis). Also honour manual pause | pause < 0.6 m/s for 5 s, resume > 1.0 m/s for 3 s | [unverified; jara uses < 2.0 km/h (0.56 m/s) for 5 s, per the coordinator] |
| Splits | When cumulative distance crosses a mile or km boundary, interpolate the crossing time linearly between the two fixes that straddle it | none | [unverified] |
| Route storage | Never cap or drop old points. Downsample only for display (Douglas-Peucker) and keep the raw log | at 1 fix/s, 2 h is 7,200 fixes | [unverified; jara caps at 10,000 points by dropping the oldest, losing the start of long runs, per the coordinator] |
| Elevation | Ignore GPS altitude for gain. After the run the server samples a DEM along the filtered track, smooths over about 50 m of distance, and counts gain and loss with a hysteresis band | 3 m hysteresis | [unverified] |

### Distance formula

- A spherical model like haversine is accurate to about 0.3%. Vincenty on the ellipsoid is accurate to 0.5 mm, but it can fail to converge for nearly antipodal points, which never happens on a running segment [verified: https://www.movable-type.co.uk/scripts/latlong-vincenty.html].
- 0.3% of 16 km is up to 48 m of systematic error. Vincenty on short segments costs nothing, so use it for stored distance and splits. Haversine is fine for the live display if you want the simpler code [unverified judgement].

### Elevation from a DEM (server side)

- Copernicus GLO-30 is on AWS Open Data as Cloud Optimized GeoTIFFs, 1 arc-second (~30 m) in 1°x1° tiles, under a free licence [verified: https://copernicus-dem-30m.s3.amazonaws.com/readme.html; https://registry.opendata.aws/copernicus-dem/]. Absolute vertical accuracy is LE90 < 4 m [verified via search excerpt: https://sentinels.copernicus.eu/-/copernicus-dem-30-metre-dataset-now-freely-available]. The public release excludes a few countries (Armenia and Azerbaijan) [verified via search excerpt: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM].
- Setup: download the handful of tiles covering where the owner runs, bilinear-sample them with GDAL or a TS GeoTIFF reader on the Deno server, and store the elevation profile in the run document once the run syncs [unverified]. GLO-30 is a surface model (tree and building tops), so expect overestimated gain under forest canopy and among tall buildings [unverified].

### Testing: replay fixtures

Record raw fix logs (lat, lon, accuracy, speed, fix timestamp) from real runs and commit a few as fixtures. A replay test in `packages/run` feeds them through the pipeline and asserts total distance, split times, moving time and auto-pause intervals within tolerances. Add synthetic fixtures for the pitfalls: a duplicated stream (dedupe), a 200 m jump (speed gate), a 3-minute stop at a light (auto-pause and jitter), a batch of late-delivered fixes (timestamps), and a 2-hour run (no point cap). jara has a Maestro smoketest that replays a waypoint loop through simulated GPS to test start/stop/save without a real run, the same idea one layer up [coordinator's reading of jara].

Schema note: store fields the UI won't show yet from day one (HR samples, cadence, elevation gain and loss, raw fixes, device and plugin version) so later features need no automerge migration [unverified, suggested by jara's approach].

## 4. Maps without Google

### Tiles: self-hosted Protomaps PMTiles

- The full planet basemap is roughly 120 GB for zoom 0-15, rebuilt daily at maps.protomaps.com/builds. It's an ODbL Produced Work, so show OpenStreetMap attribution [verified: https://docs.protomaps.com/basemaps/downloads].
- Each extra zoom level roughly doubles file size [verified: https://docs.protomaps.com/basemaps/downloads].
- Reported extract: US plus Mexico at z0-15 came to 17 GB in 2023 [verified: https://github.com/protomaps/go-pmtiles/issues/68]. By the halving rule, the US alone is roughly 13-16 GB at z15, 7-8 GB at z14, and about 4 GB at z13. A metro-area bbox at z15 should land in the tens to low hundreds of MB [unverified estimates, not measured]. The planet has grown since 2023, so measure before choosing. `pmtiles extract` against the remote build only downloads the ranges it needs.
- Extract command: `pmtiles extract https://build.protomaps.com/<date>.pmtiles region.pmtiles --bbox=MIN_LON,MIN_LAT,MAX_LON,MAX_LAT --maxzoom=15 --download-threads=4`. Options include `--region=file.geojson`, plus `pmtiles verify` and `pmtiles show` [verified: https://docs.protomaps.com/pmtiles/cli; the build URL host is unverified, take the current one from https://maps.protomaps.com/builds].

### Serving from Deno

1. Put `region.pmtiles` under something like `server/data/tiles/` [unverified layout].
2. Serve it with `serveDir` from `@std/http/file-server`, which handles range requests [verified: https://github.com/denoland/docs/blob/main/runtime/fundamentals/http_server.md].
3. In the client: `npm install pmtiles maplibre-gl`, `maplibregl.addProtocol("pmtiles", new Protocol().tile)`, and a vector source with `url: "pmtiles:///tiles/region.pmtiles"` (a `pmtiles://` prefix before a normal URL) [verified: https://docs.protomaps.com/pmtiles/maplibre]. Use the Protomaps basemap style package for layers and fonts, and self-host the glyphs and sprites too, or the map will reach out to a CDN [unverified].
4. Check that `tailscale serve` passes `Range` headers and 206 responses through unchanged [unverified; test with `curl -r 0-99`].

### Offline caching

- The Cache API refuses to store 206 responses, and PMTiles is read only with range requests [verified: https://web.dev/articles/sw-range-requests; https://github.com/w3c/ServiceWorker/issues/913].
- Workarounds: (a) split reads into fixed chunks (dive-map uses 64 KiB) stored as ordinary 200 responses under synthetic keys, keyed by the archive ETag [verified: https://github.com/mauriciabad/dive-map]; or (b), simpler and my pick: have Deno decode the archive and expose `/tiles/{z}/{x}/{y}.mvt` as plain 200 responses (the `pmtiles` JS library can read from a local file source), so the service worker or the Capacitor app caches tiles like any other GET. Before a run, prefetch tiles for the planned area up to z16 overzoom [unverified design].
- In the Capacitor app, the WebView's caches work the same way, and for a planned route you could also bundle a small regional `.pmtiles` into the app's files [unverified].

### OSM raster tiles

The OSMF tile policy requires a clear User-Agent and a valid Referer, and caching for at least 7 days. It forbids bulk downloading, prefetching and offline use, requires visible "© OpenStreetMap contributors" attribution, and says heavy use may be blocked without notice [verified: https://operations.osmfoundation.org/policies/tiles/]. Fine for a quick prototype, but it rules out offline route maps, so go self-hosted.

## 5. Audio cues

### In a PWA

- Chrome gives each tab a media session that requests audio focus. Very short media (a few seconds) requests "gain transient may duck", which lowers other apps' audio instead of pausing it. Source is the Chromium media session doc as of Chrome 72 (2019), so current behaviour needs a test [verified: https://chromium.googlesource.com/chromium/src/+/refs/tags/72.0.3626.62/services/media_session/controlling_media_playback.md].
- Media playback keeps an Android device out of standby, and lock-screen controls come from the Media Session API [verified: https://web.dev/articles/app-like-pwas].
- `speechSynthesis` needs a user gesture before the first `speak()` in Chrome since M71 [verified via search excerpt: https://talkrapp.com/speechSynthesis.html]. Whether Chrome Android keeps speaking once the page is hidden is unclear; old bugs report audio stopping with the screen off [unverified: https://bugs.chromium.org/p/chromium/issues/detail?id=415344].
- iOS: speech synthesis breaks when Safari is backgrounded mid-utterance and needs a reload to recover [unverified, secondary: https://weboutloud.io/bulletin/speech_synthesis_in_safari/]. Background `<audio>` in Home Screen web apps was fixed in iOS 15.4 [verified: https://bugs.webkit.org/show_bug.cgi?id=198277], but lock-screen audio dies after 30 s paused [verified: https://developer.apple.com/forums/thread/762582].
- Net: in a screen-on PWA, pre-rendered clips ("one mile", digits, "speed up", "ease off") played through one looping `<audio>` or a Web Audio graph are more predictable than `speechSynthesis`. Since GPS stops when hidden anyway, background audio in the PWA doesn't buy much [unverified judgement].

### In the Capacitor app

- `@capacitor-community/text-to-speech` wraps native TTS. On iOS set the audio session category to "playback" so it speaks while backgrounded [verified via search excerpt: https://github.com/capacitor-community/text-to-speech]. Its docs don't mention ducking [verified via search excerpt, same URL]. Android's audio focus guide describes `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` for short prompts [unverified; https://developer.android.com/media/optimize/audio-focus, not read]. If the plugin doesn't request ducking focus, a ~30-line native method or a fork will. Check this on the phone with Spotify playing before building guided workouts.
- Guided-workout prompts should work off the 30 s pace window with a tolerance band (for example ±10 s/mile around target) and a cooldown between prompts (30-60 s) so the runner isn't nagged by GPS noise [unverified defaults]. jara only ships a beep WAV and deferred TTS [coordinator's reading], so there's nothing to borrow there.
- Qala already has Gemma on callisto, but cues need to work offline mid-run, so generate phrases on the phone from templates with native TTS, never from the server [unverified judgement].

## 6. Heart rate

- Web Bluetooth ships in Chrome for Android (6.0+), ChromeOS, Mac and Windows 10. Discovery needs HTTPS and a user gesture [verified: https://developer.chrome.com/docs/capabilities/bluetooth]. Safari on iOS doesn't support it at all; only third-party browsers like Bluefy, or an extension that polyfills it, provide it [verified: https://caniuse.com/web-bluetooth].
- Standard Heart Rate Service is 0x180D with Heart Rate Measurement characteristic 0x2A37, read through notifications [unverified; widely documented, see the HR example in https://github.com/capacitor-community/bluetooth-le].
- Does a Web Bluetooth notification stream survive screen lock? One 2026 blog says the connection drops when the tab is hidden, but it cites nothing [unverified: https://codecrispi.es/blog/web-bluetooth-2026/]. A Chromium issue about `characteristicvaluechanged` stopping exists but needs a sign-in to read [unverified: https://issues.chromium.org/issues/361986686]. Chrome's desktop freezing policy exempts pages controlling Web Bluetooth devices, which suggests Chrome wants those pages kept running [verified: https://developer.chrome.com/blog/freezing-on-energy-saver]. It's moot for Qala, because the run recorder is native and the page is hidden in the pocket either way.
- Whether Web Bluetooth works inside Android WebView (what Capacitor uses) is unclear. caniuse's "Android Browser" row says supported, but that row tracks Chrome's engine, and I found nothing that confirms WebView specifically [unverified]. Don't depend on it. Use `@capacitor-community/bluetooth-le`, which supports Android, iOS and web and ships a Polar H10 heart-rate example [verified via search excerpt: https://github.com/capacitor-community/bluetooth-le]. Scan for service 0x180D, subscribe to 0x2A37, parse the flags byte (bit 0 selects uint8 or uint16 BPM) [unverified detail].
- Keep the BLE connection in native code during a background run. Whether JS callbacks keep firing with the screen off under `useLegacyBridge` needs a test; if they don't, buffer samples natively [unverified].
- Health Connect (Android) and HealthKit (iOS) are native-only. Capacitor plugins that write workouts with routes and heart rate exist: `@capawesome-team/capacitor-health` (reads and writes workouts on both platforms) and `@flomentumsolutions/capacitor-health-extended` (workout sessions with routes and HR samples). On Android, routes need `WRITE_ROUTE` alongside the other write permissions [verified via search excerpt: https://capawesome.io/docs/sdks/capacitor/health/; https://www.npmjs.com/package/@flomentumsolutions/capacitor-health-extended]. This is optional, since HR comes straight from the strap.

## 7. Data formats and Strava

- GPX 1.1 (schema at http://www.topografix.com/GPX/1/1/gpx.xsd) carries tracks. Heart rate and cadence go in each `trkpt`'s `<extensions>` using Garmin's TrackPointExtension (v2 adds speed and course) [verified via search excerpt: https://www8.garmin.com/xmlschemas/TrackPointExtensionv2.xsd]. Emit GPX with TrackPointExtension hr and cad for best compatibility [unverified].
- TCX v2 (TrainingCenterDatabasev2.xsd) models an Activity with Laps and carries HR, cadence and calories natively. That's a natural fit for splits and intervals, since each interval can be a Lap [verified via search excerpt: https://en.wikipedia.org/wiki/Training_Center_XML].
- FIT: Garmin's FIT SDK license forbids redistribution and forbids use "so that any part of it becomes subject to any license that requires that the Licensed Technology ... be disclosed or distributed in source code form" [verified: https://github.com/garmin/fit-javascript-sdk/blob/main/LICENSE.txt]. Qala is AGPL-3.0, so `@garmin/fitsdk` (npm v21.214.0, "SEE LICENSE IN LICENSE.txt") is out [verified: https://registry.npmjs.org/@garmin/fitsdk/latest]. If FIT is ever needed, the MIT-licensed `fit-file-parser` reads and encodes FIT, and `@markw65/fit-file-writer` writes it [verified via search excerpt: https://www.npmjs.com/package/fit-file-parser; https://www.jsdelivr.com/package/npm/@markw65/fit-file-writer]. GPX and TCX cover everything Qala records, so skip FIT for v1.
- Strava upload: `POST https://www.strava.com/api/v3/uploads` with `data_type` of fit, tcx or gpx (optionally .gz), needs the `activity:write` OAuth scope, processes asynchronously, and you poll `GET /uploads/:id` at 1 s or slower (mean processing under 2 s) [verified: https://developers.strava.com/docs/uploads/].
- Strava limits: new apps get 200 requests per 15 minutes and 2,000 per day overall (100 and 1,000 for reads). They start in "Single Player Mode" (athlete capacity 1), self-upgradable to 10 athletes; more than that needs a review [verified: https://developers.strava.com/docs/rate-limits/]. That's enough for the owner plus a few friends. The server holds the OAuth refresh token and uploads TCX after sync [unverified design].
