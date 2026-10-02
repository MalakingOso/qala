# Handoff: phone rail + type refresh

Branch `phone-refresh`, worktree `qala-phone-refresh`. Visual exploration only:
no app code touched. Everything below is decided except the Parked section.
Mockups live in `mockups/` next to this doc; open
[phone-refresh-index.html](../mockups/phone-refresh-index.html) to click through.

## Locked decisions

### Type: three faces, nine levels

Running text leaves DM Mono. The mix, from the font deep dive and levels demo:

- Qala Test owns brand moments only: page titles and hero numerals
  (timers, top sets, stat tiles).
- Recursive (OFL, Arrow Type) owns everything UI: card titles, body, stats,
  buttons, labels. Variable wght 300-1000 + slnt; tabular digits by default
  so stat columns align with zero CSS; tallest x-height measured
  (0.526); 105 KB latin woff2 with real obliques. Replaces the desktop
  system-stack stand-in too.
- DM Mono keeps records: set logs, tables, LS++ code, chart ticks.

DM Sans was cut (proportional-only digits, no tnum anywhere, verified in the
binary). Public Sans, Source Sans 3, Atkinson Hyperlegible Next, Figtree, and
Plex Sans were specimened and passed over; runner-up is Source Sans 3 if
Recursive's quirk ever feels wrong at phone sizes.

### Rail: fixed mid-screen channel, tight notch

The day runner lives as six tiny dots in a 28px frosted strip hugging the
left edge with no gap, fixed at the vertical middle of the screen. It never
scrolls. Scrolling boxes deform around it with a tight rectangular notch that
hugs the strip's contour (~8px whitespace, small inner corners echoing the
strip). Seams exist only where a card is: no permanent box, no floating lines.
Full 8-point behavior spec is written on the rail demo page itself
(item 12 below), including gestures (tap/swipe-right opens, up/down steps
stages, preview with Back to now), the 252px slide-out menu, text clearance
(44px inset; true tight-wrap reflow is the implementation target), and motion
tokens (open 260ms expo-out, close 200ms ease-in, stagger 25ms/row, all frozen
under reduced-motion).

### Glass budget

Frosted glass sits only on floating chrome, never content: the rail strip,
the menu-adjacent preview bar, the coach trigger states. Phone calm screens
keep Beamer surfaces (2px borders, hard offset shadows, small radii).
Desktop gets glass in three places: sticky toolbar, command palette, sync
pill; dense content untouched.

### Coach radial

The Drawboard circle becomes a press-and-pick ring for coach questions,
voice commands, notes, and workout changes (swap, drop set, +30 s rest),
triggered by an ember button or long-press on the set card. The trigger icon
is TBD (plus placeholder); four candidates are specimened.

## Mockup inventory

Current direction: 12, 13 (option A), 15. History kept for reference.

1. Today (early soft-sheet direction, superseded by Beamer pass)
2. Workout focus mode (ember ground direction, parked)
3. Rest (ember ground direction, parked)
4. Live run (map HUD direction, parked)
5. Plan (calm direction, softly superseded)
6. Desktop overview with glass toolbar, palette, sync pill
7. Font deep dive: six OFL body specimens with measured facts
8. Type levels: nine-level ladder, six-way sans switcher
9. Rail overlay, line variant (right-side pop-out, superseded)
10. Rail options: left cut-in vs bottom grabber (superseded)
11. Coach radial behavior demo (icon now placeholder)
12. Rail spec demo: fixed channel, scroll morph, menu, written spec
13. Rail iterations: dots vs angle vs micro vs tabs
14. Coach button icons: talk, voice, whistle, headphones
15. Today + rail working slice: the whole spec running

## Prior art found in research

- Samsung Edge panels ship a translucent edge handle on nearly every screen;
  swipe opens panels; handle position, size, and transparency are user
  configurable. Closest shipped precedent for handle-plus-swipe chrome.
- Material 3 Expressive Navigation Rail is one component in two states:
  collapsed 96dp icon column and expanded 220-360dp labeled panel, and the
  expanded rail officially replaces the navigation drawer. Precedent for the
  strip-to-menu relationship and its transition.
- BOOX NeoReader's floating toolbar collapses to the screen edge so it never
  covers text, expands on swipe, and is draggable. Precedent for the
  collapse-to-edge behavior.
- Press-drag-release radial menus (Second Life pie menu; current SwiftUI and
  React Native radial implementations with springs and haptics) validate the
  coach radial gesture: hold, fan out under the thumb, slide, release.
- iOS `NSTextContainer.exclusionPaths` is the exact "text morphs around a
  box" primitive: bezier regions text will not enter, combinable, updatable
  live. iOS is not a Qala target, but it is the reference semantics.
- CSS `shape-outside` (MDN) wraps inline content around float shapes, but
  floats scroll with content, so it cannot do a fixed obstacle with reflow.
  That is why the spec uses a guaranteed inset, not reflow.

## Implementation guidance

PWA/web: the prototype's approach ports directly. One fixed overlay layer
redraws notch geometry from live card rects on scroll via rAF-throttled
repaints; menu and scrim animate transform- and opacity-only. Measured in
headless Chromium: locked 16.7ms frames, zero over-32ms frames across the
menu transition. Keep it that way: never recompute layout per scroll frame
beyond rect reads, and keep the seam paint to two SVG path writes.

Android (Jetpack Compose, per apps/android): follow the official performance
guidance, which matches the prototype's structure. Defer scroll-state reads
out of Composition into layout/draw-phase lambda modifiers
(`graphicsLayer`, `offset`, `drawBehind`); use `derivedStateOf` where a
rapidly changing value feeds downstream state. Android has no direct
exclusion-paths equivalent, so ship the spec's uniform inset first; the
investigation path for true tight wrap is `LeadingMarginSpan`-style
indents or manual per-line layout, explicitly phase two, not launch.

Motion tokens: open 260ms `cubic-bezier(.25,1,.5,1)`, close 200ms ease-in,
row stagger +25ms each starting 40ms, preview bar 220ms expand, toast 2.2s.
All frozen under `prefers-reduced-motion` / system animation-off.

Suggested order: fonts + type tokens first (touches everything), then the
Today shell with fixed channel and morphing cards, then menu + preview,
then coach radial, then desktop glass.

## Parked / open

- Coach trigger icon: four options specimened (item 14), no pick yet.
- Ember focus-ground direction for sessions (items 2-4): parked, not dead.
- True tight-wrap text reflow around the rail: phase two on both platforms.
- Device validation: swipe thresholds, scroll physics against the fixed
  channel, and Android WebView/Compose frame pacing need a real phone;
  the prototype only proves the desktop-Chromium case.

## Sources consulted

- https://www.webpronews.com/the-samsung-feature-most-power-users-have-never-touched-is-sitting-right-on-their-screen/
- https://www.androidpolice.com/put-favorite-apps-in-edge-panel-home-screen-is-finally-clean/
- https://github.com/material-components/material-components-android/blob/HEAD/docs/components/NavigationRail.md
- https://github.com/ny000815/glassfan/blob/HEAD/README.md
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/shape-outside
- https://developer.android.com/develop/ui/compose/performance/bestpractices
- https://developer.android.com/codelabs/jetpack-compose-performance
- https://www.objc.io/issues/5-ios7/getting-to-know-textkit/
