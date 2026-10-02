# Qala: design system and screens

The single reference for how Qala looks and behaves on screen. The owner's choices behind it are in `DECISIONS.md` (codes like L4 or U3 below point there). Engine rules the screens display are in `PLAN.md` section 6. The review canvas that shows all of this is `mockups/qala-app-mockups.html` (section 8 below).

Visual refinement, 2026-09-13: a smoothing pass (`docs/visual-refinement.md`)
gave the app responsive charts, consistent controls, a full-height desktop
workspace and a recomposed Today and Plan. Those stay. Its surface treatment
(1px borders, blurred shadows, 6/10/12px radii, a logo tile) made Qala read as
a generic app rather than a Beamer sibling, and the owner had it reverted the
same day (L8). The review canvas predates both passes.

Phone visual pass, 2026-09-30 (branch `visual-update`): the owner asked for a
visual update of the whole phone app, with plates that look like plates, every
chart reviewed, consistent buttons and one vibe, and said Qala no longer has to
match Beamer (L9). The pass left `tokens.css` alone and spent that freedom on
controls, plates, charts and composition. What it changed is noted per section
below; the decisions are L9 to L11 and U14 to U19.

## 1. Principles

1. **Beamer first.** Qala should look like a sibling of the owner's Beamer app: off-white ground, white surfaces, 2px borders, hard offset shadows with zero blur, 4/6/8px radii, no pills, no logo tile (the Qala Test wordmark is the brand). Cards are flat at rest and lift on hover or press. Each screen still gets one clear reading order (L1, L8).
2. **Light and breezy.** Generous space, one strong element per card, nothing dense or dark by default.
3. **One action color.** Ember marks the one thing to do on a screen: the primary button, the current stage, today's column. Everything else is ink and gray. (L3)
4. **Numbers are the hero.** Big figures in the owner's Qala Test face; everything readable at a glance mid-set with sweaty hands.
5. **Color never works alone.** Plates show their weight, charts carry labels or legends, status colors come with a word or icon.
6. **Runkeeper only where running needs it.** Big stacked numerals and the route line on run screens; nowhere else. (L2)
7. **Explain the machine.** Every adjusted number (rest, load, a planned run turned easy) shows its reason in one line.

## 2. Tokens

Implemented in `apps/web/src/theme/tokens.css`, shared by both shells. Beamer's token names and structure (Beamer `assets/styles.css` lines 13-56), ember in place of Beamer's indigo, borders and shadows derived from the neutral ink. Contrast ratios are WCAG against `--bg`; the calculations and the Runkeeper color study behind them are in `RESEARCH-design-and-programming.md` part A (A4 for contrast).

```css
:root {
  /* surfaces */
  --bg:#f5f5f7; --bg-surface:#fff; --bg-hover:#f1f3f9; --bg-active:#e8ebf4; --bg-recessed:#f1f3f9;
  /* ink */
  --fg:#0f152a; /* 16.61 */ --fg-secondary:#4a5578; /* 6.74 */ --fg-muted:#64708b; /* 4.56 */ --fg-faint:#94a0b8; /* 2.42, decorative only */
  /* lines */
  --border:rgba(15,21,42,.10); --border-strong:rgba(15,21,42,.22); --border-width:2px; --grid:#e3e6ee;
  /* action */
  --accent:#c2410c; /* 4.76 as text */ --accent-hover:#9a3412; --accent-subtle:rgba(194,65,12,.08); --on-accent:#fff; /* 5.18 */
  /* running, progress, status */
  --run:#485cc7; --progress:#0a8078; --progress-fill:#08a49c; --danger:#b91c1c; /* 5.94 */ --success:#15803d; /* 4.61 */
  --zone-1:#3a4a9f; --zone-2:#08a49c; --zone-3:#e5c73a; --zone-4:#fb923c; --zone-5:#c2410c;   /* heart-rate zones, run screens only */
  /* notes */
  --note:#fff7e6; --note-border:rgba(180,110,0,.28); --note-ink:#8a5a00;
  /* charts (section 6): categorical, ordinal ramp, emphasis gray, low-readiness zone */
  --viz-1:#c2410c; --viz-2:#485cc7; --viz-3:#08a49c;
  --int-1:#86b6ef; --int-2:#5598e7; --int-3:#2a78d6; --int-4:#1c5cab; --int-5:#104281;
  --mark-gray:#c9ced9; --low-zone:rgba(185,28,28,.34);
  /* bar drawing */
  --bar:#9aa1ad; --bar-collar:#6b7280;
  /* shape and motion */
  --radius:4px; --radius-md:6px; --radius-lg:8px;          /* no pill radius anywhere */
  --shadow-card:2px 4px 0 0 rgba(15,21,42,.10);            /* hover and press; cards are flat at rest, except the Today hero */
  --shadow-cta:2px 4px 0 0 #4a4a4a, 0 0 0 1px #c2410c;     /* :active drops it and translates 1px 2px */
  --shadow-modal:4px 8px 0 0 rgba(15,21,42,.12), 0 0 0 2px var(--border);
  --duration-fast:150ms; --duration:200ms; --ease:cubic-bezier(0.25, 1, 0.5, 1);
}
[data-theme=dark] {
  --bg:#0b1020; --bg-surface:#121a33; --bg-hover:#18213f; --bg-active:#1f2a4d; --bg-recessed:#0f1529;
  --fg:#e8ecf6; /* 16.01 */ --fg-secondary:#aab4cc; /* 9.11 */ --fg-muted:#8a93ab; /* 6.17 */ --fg-faint:#5d6680;
  --border:rgba(232,236,246,.12); --border-strong:rgba(232,236,246,.24); --grid:#232c4a;
  --accent:#fb923c; /* 8.37 */ --accent-hover:#fdba74; --accent-subtle:rgba(251,146,60,.12); --on-accent:#0b1020; /* white would be 2.26 */
  --run:#8e9cf0; --progress:#2dd4bf; --progress-fill:#2dd4bf; --danger:#f87171; --success:#4ade80;
  --note:#2a2412; --note-border:rgba(251,191,36,.30); --note-ink:#fbbf24;
  --viz-1:#e0652b; --viz-2:#6f80e6; --viz-3:#16a390;
  --int-1:#184f95; --int-2:#256abf; --int-3:#3987e5; --int-4:#6da7ec; --int-5:#9ec5f4;
  --mark-gray:#39425f; --low-zone:rgba(248,113,113,.40);
  --bar:#6b7384; --bar-collar:#9aa1ad;
  --shadow-card:2px 4px 0 0 #2a3350; --shadow-cta:2px 4px 0 0 #3a4466, 0 0 0 1px #fb923c;   /* black shadows vanish on the dark ground */
  --shadow-modal:4px 8px 0 0 #2a3350, 0 0 0 2px var(--border);
}
```

Mirror the dark block under `@media (prefers-color-scheme: dark)` for `theme: 'system'`. Beamer's own danger and success colors fail small-text contrast, so these are darker.

## 3. Type

### 3.1 Roles (L4, L5)

| Element | Face | Weight | Size phone / desktop | Figures |
|---|---|---|---|---|
| Page title | Qala Test | 700 | 28-32 / 28-40 | default |
| Card and section title | Qala Test | 700 | 15-22 / 17-24 | default |
| Big static number: weight x reps, stat tiles, readiness, session figures | Qala Test | 700 | 24-64 | default (proportional lining) |
| Ticking number: rest countdown, "of 3:45", workout clock, live run numbers, warm-up timers | Qala Test | 700, 500 for "of 3:45" | 22-150 | `font-variant-numeric: lining-nums tabular-nums` |
| Body, buttons, controls, set rows, table cells | DM Mono | 400, 500 for labels and emphasis | 13-15 / 13-14 | DM Mono's own |
| Desktop shell UI text: nav, labels, table cells, body copy, buttons (L16) | a proportional sans (`--font-ui` in `theme/desktop.css`, a system stack until the owner picks a face) | 400, 500, 600 for emphasis | 12-13 | tabular for numerals |
| Desktop numerals, chart ticks, code: load and distance columns, axis ticks, times, liftoscript | DM Mono | 400, 500 | 10-13 | DM Mono's own, tabular |
| Group labels (uppercase band) | DM Mono | 500, letter-spacing .09em | 11 | |
| Chart text: axis ticks, direct labels, legends | DM Mono | 400, 500 for the labeled value | 10-12 | tabular in axis ticks |

Qala Test has a 700 (V2 Bold) and a 500 (v1 Medium) and no italic yet; don't synthesize italics. Letter-spacing 0 on Qala Test. The dataviz guidance prefers a sans for hero figures; the owner's choice of a serif face overrides it on purpose.

A ticking number must use tabular figures: Qala Test inherits Faustina's proportional default digits (the "1" is narrower than the "0"), so a proportional countdown jiggles every second. Static large numbers keep proportional figures, which look tighter.

### 3.2 Font files

Already in the repo; copy to `apps/web/public/fonts/` at scaffold time and add the OFL texts to NOTICE.

| File | Bytes | sha256 | Source |
|---|---|---|---|
| `assets/fonts/QalaTestV2-Bold.woff2` | 29,596 | `c3cd18662bde7a0ab6d791b654793a6119a4290a3ac091d56f06f78f59f40eea` | The owner's face, made with Muse; renamed OFL fork of Faustina with the lowercase narrowed toward Alegreya and serif wedges unified on n, l, a. Build scripts in `qala-test/work/`. |
| `assets/fonts/QalaTestV2-Bold.ttf` | 75,376 | `8a3292eaa0abcbbc6c7eb789b1a70ea3ecdaa2d00c660f249fd57859010ec5a9` | same |
| `assets/fonts/QalaTest-Medium.woff2` | 29,932 | `3348e1e07d4df84488228fc447d9fe93de4b40a45fe94235917e07b01cf9bbf8` | v1 Medium |
| `assets/fonts/QalaTest-Bold.woff2` | 29,500 | `750b88bb25473f76189a9ab48a3baafde0b250a83341db4b6699db656c1fb5e5` | v1 Bold, superseded by V2 |
| `assets/fonts/QalaTest-OFL.txt` | 4,390 | `2d8f6a7be96a15fd2deaa8e6b5320cec6c253216b5a8f7e1becccfc51147b877` | Faustina's OFL 1.1, applies to the fork (Faustina has no Reserved Font Name) |
| `assets/fonts/DMMono-Regular.woff2`, `DMMono-Medium.woff2` | 14,820 / 14,988 | `e1896b13b2b1bb112fac2f9571bd6c40e118746e77a4511edbf43fbb41bf3e1e` / `9964608a849396bd00c4bfd7034afe03486469dcf20b4f6b8cbdfdd310369951` | copied from Beamer |
| `assets/fonts/DMMono-OFL.txt` | 4,484 | `2bada5ea45c3c63b7f1ea1f88ce9672c9e4f0c42b2c3b7378949084fe55a3066` | google/fonts |
| `assets/fonts/Faustina-qala.woff2`, `Faustina-Italic-qala.woff2` | 25,168 / 26,548 | `0ee13dc9b35cc8677a62ce1c3c545f7e43d6a075685b6aea119dd9d862bec1ac` / `7cf80a7f9a25b5a7751a518701cdde63ca2589b824dc6bad914ac72acd382c9a` | fallback; google/fonts variable wght 300-800, Latin subset with all layout features |
| `assets/fonts/Faustina-OFL.txt` | 4,390 | `2d8f6a7be96a15fd2deaa8e6b5320cec6c253216b5a8f7e1becccfc51147b877` | google/fonts; byte-identical to `QalaTest-OFL.txt` |

`assets/fonts/Recursive-qala.woff2` and `Recursive-OFL.txt` were removed 2026-09-13; the Qala Test files moved up from `assets/fonts/qala-test/` to `assets/fonts/` the same day, leaving only `qala-test/work/` (build scripts) and `README-test.md` behind.

### 3.3 CSS

```css
@font-face { font-family: "Qala Test"; src: url(/fonts/QalaTestV2-Bold.woff2) format("woff2"); font-weight: 700; font-display: swap; }
@font-face { font-family: "Qala Test"; src: url(/fonts/QalaTest-Medium.woff2) format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Faustina"; src: url(/fonts/Faustina-qala.woff2) format("woff2"); font-weight: 300 800; font-display: swap; }
@font-face { font-family: "DM Mono"; src: url(/fonts/DMMono-Regular.woff2) format("woff2"); font-weight: 400; }
@font-face { font-family: "DM Mono"; src: url(/fonts/DMMono-Medium.woff2) format("woff2"); font-weight: 500; }
body { font-family: "DM Mono", ui-monospace, monospace; font-size: 14px; line-height: 1.5; }
.title, .figure { font-family: "Qala Test", "Faustina", Georgia, serif; font-weight: 700; letter-spacing: 0; }
.ticking { font-variant-numeric: lining-nums tabular-nums; }
.group-label { font-family: "DM Mono", monospace; font-size: 11px; font-weight: 500; letter-spacing: .09em; text-transform: uppercase; color: var(--fg-muted); }
```

A Settings row "Title font: Qala Test / Faustina" swaps the family for anyone who prefers Faustina.

### 3.4 Faces tried and rejected (L6)

Recursive (body and titles), Recursive oblique, Archivo condensed italic, DM Mono titles (Beamer's own), News Cycle for Trade Gothic, Alegreya for FF Scala, Noticia Text for PMN Caecilia, and Faustina as the primary. The commercial originals (Trade Gothic, FF Scala, PMN Caecilia, FF Quadraat) would each need a webfont license covering both the PWA and the Android app.

## 4. Icons (S5)

Lucide via `lucide-react` (ISC; add to NOTICE). Stroke 2 at 24px, `currentColor`; `--fg-muted` idle, `--fg` active, ember only on the one primary action. Names verified in `lucide-static`:

| Role | Icons |
|---|---|
| Tabs | `sun` Today, `calendar-range` Plan, `activity` Body, `trending-up` Progress, `message-square-text` Coach |
| Headers | `history`, `settings`, `chevron-left`, `chevron-down`, `ellipsis-vertical` |
| Day types | `dumbbell` lift, **`sport-shoe` run** (never `footprints`), `bed` rest |
| Today stages | `circle-check` check-in, `flame` warm-up, `dumbbell` lift, `hourglass` recover, `sport-shoe` run, `moon` wind down |
| Workout | `info`, `arrow-left-right` swap, `sticky-note` note, `pin`, `check` log set, `layout-grid` all exercises, `calculator` plates, `minus`, `plus`, `triangle-alert` joint pain |
| Warm-up | `bike`, `circle-check`; the foam roller and Theragun are Blender renders (5.8a), not glyphs |
| Run | `play`, `pause`, `route`, `signal-high` GPS, `volume-2` cues, `zap` guidance, `heart-pulse`, `mountain`, `timer` |
| Data and notices | `gauge`, `list-checks`, `clock`, `x` |

## 5. Components

Anatomy started from Beamer; phone controls scale up to a 44px minimum touch target. Shared components live in `apps/web/src/shared/ui.tsx` and `shared/plates.tsx`.

1. **Card:** `--bg-surface`, 2px `--border`, `--radius-md`, 20px phone / 24px desktop padding, flat at rest, `--shadow-card` on hover or press; the Today hero carries it at rest.
2. **Group:** one bordered container with a `--bg-recessed` header band holding the group label, optional right-side action, a 2px line under the band and 1px dividers between rows (Beamer's settings groups).
3. **Buttons:** primary is ember fill, `--on-accent` text, `--radius`, `--shadow-cta`, 52px tall on phone; the large primary is 64px with a 22px icon and is what every screen's main action uses. One primary per screen. Secondary is a 2px bordered surface button; `small` is the 40px header variant for Finish, Skip and Edit. Utility actions use neutral ink. Inputs are 2px bordered, `--border-strong` on hover, ember on focus. Both button kinds keep their `onClick` when rendered as links (fixed 2026-09-30: check-in, session finish and run save never queued their ops).
4. **Chips and segmented controls:** 4px radius chips on `--bg-active`; segmented controls (view switchers: Overview / Details, the Live run pages) are one bordered strip with the selected cell on `--bg-active`. A pressed chip fills with ink.
5. **Toggles:** square-cornered, ember when on. `Toggle` is shared.
5a. **Scale picker (U14):** every choice of a value on a scale (recovery 0-10, soreness 1-4, RPE, session effort, muscle performance, bar, theme, title font) is one `ScalePicker`: a single 2px bordered strip of 48px cells, the picked cell filled with ink (`--fg` with `--bg-surface` text), optional anchor words under the ends. Ember is never used as a selected state.
5b. **Stepper:** a big figure with two 48px bordered - / + buttons under it (weight and reps, plate target).
5c. **Tool bar:** secondary per-exercise tools as one bordered strip, each an icon with a word under it (Info, Swap, Note, Joint pain).
5d. **Flow header:** in-session screens (workout, rest, all exercises) share one header: zoom out to all exercises (or back), the session with its ticking clock, and a small Finish.
6. **Tab bar:** 72px plus the device safe area, 2px top border, a 3px ember bar above the active tab's icon. Capped to the phone shell width.
7. **Exercise note card:** `--note` fill, `--note-border`, sticky-note icon, date label, Got it / Pin / Resolved.
8. **Plates and bar are rendered in Blender (L10, L12).** After several rounds of hand-drawn SVG that the owner called fake, the plates and bar are real 3D models rendered to sprites. `assets/3d/build_sprites.py` builds the scene from scratch (1 unit = 1 inch) and renders, headless: every bumper (55, 45, 35, 25, 10 lb) in each of the seven named colors, the 5, 2.5 and 1.25 lb iron plates, and the bar. `assets/3d/pack_sprites.py` trims them to WebP in `apps/web/public/plates/` (about 0.7 MB) and writes `apps/web/src/shared/plateSprites.json`. Run: `blender -b -P assets/3d/build_sprites.py -- --out /tmp/s` then `python3 assets/3d/pack_sprites.py /tmp/s apps/web/public/plates apps/web/src/shared/plateSprites.json`. The plate has the real 17.7" bumper profile and thicknesses by weight: a high outer lip, a narrow recessed groove, a lower middle field, a raised ring round a steel hub, and raised Montserrat Bold lettering (the weight on both sides of the hub, the right one upside down, and QALA curved top and bottom), white on colored plates and dark on white and silver ones. The bar follows a standard bar: a 28 mm shaft, a collar with a seam, a 50 mm polished sleeve, a blue end cap. One orthographic camera made every sprite (52 degrees round from the plate's normal, 12 degrees up), so `PlateDrawing` (`shared/plates.tsx`) places a part by moving it along the bar's axis on screen: plates stack from the collar, the sleeve and knurled shaft are repeated strips (a polished tube lit evenly repeats cleanly) and the sleeve is shortened so the plates stay large, with its tip drawn over the outermost plate. Inner plates show only their rims, so their weights are written beneath, skipped where they would crowd; the caption lists them all. `PlateChips` uses nearly face-on renders with the weight in HTML on the outermost chip. Colors come from `settings.plates`; a color with no render falls back to charcoal. The earlier SVG drawings are gone. Blender 5.2.2 and the MCP server (`uvx mcp-for-blender`) were installed for this under `~/.local`; Montserrat is OFL (copy in `assets/3d/`).

8a. **Equipment and EZ bar renders (L13, L14).** `assets/3d/build_gear.py` builds the foam roller, the Theragun and the treadmill from the owner's product photos and renders each once, three-quarter, with an orthographic camera fitted to its bounding box. `pack_gear.py` trims them to about 360 px WebP in `apps/web/public/gear/` and writes `apps/web/src/shared/gearSprites.json`. They are looks-like models: shape, proportions, colors and the features that make each read as itself (the roller's raised grid blocks and lime core, the Theragun's triangle handle and ball head, the treadmill's leaning uprights, handrails and tablet), with no brand names or logos, as the plates did with the bar maker's. A bright edge light from behind keeps the black and navy ones outlined on the dark theme. `shared/gear.tsx` shows them: `GearImage` scales one to fit a box, `GearSlot` is a fixed 64 x 44 slot so rows line up when an item has no render. They sit at the right of each soft tissue row on the warm-up, beside each item under Equipment you own in Settings, and on the Body page's recovery tools. The bike and the rower have no render yet. Run: `blender -b -P assets/3d/build_gear.py -- --out /tmp/g`, then `python3 assets/3d/pack_gear.py /tmp/g apps/web/public/gear apps/web/src/shared/gearSprites.json`, then `deno fmt` the JSON. The EZ curl bar is part of `build_sprites.py` so it uses the plates' camera and stacks with them: `ez_back` (collar, polished shaft, then one block of three steep jogs and two shallow runs in matte over the grips, bends in the vertical plane so the low camera shows them) replaces `bar_collar` and the knurl tiles behind the plates, the sleeve pieces are the straight bar's, and `ez_hero` is the whole bar for a picker. `PlateDrawing` takes `bar="ez"`, and the plate calculator's bar picker offers "EZ 25" (`settings.ezBar`; Settings lists it under Bars and plates). Render with `--only ez` and pack with `pack_sprites.py ... --merge`, which adds to `plateSprites.json` instead of rebuilding it, so the plate sprites stay byte for byte as approved. The end cap's printed text and the sleeve length are the straight bar's; a real EZ sleeve is shorter, which matters only if a stack would not fit. `build_sprites.py --icon` renders the app icon candidates (plates face on, angled and stacked, and ember plates carrying a route: a lap round the hub with a tail leaving it, so the route is the Q of QALA; and, on a transparent background, the red plate with one raised Montserrat Bold Q whose counter holds the hub, `icon-Q.png` filling the canvas and `icon-Q-maskable.png` inside the safe zone; and the plate itself as the Q, either the whole plate with a tail out of its rim (`Qa`) or a bumper ring with an open counter and a tail (`Qb`)) and `make_icons.py` lays them on contact sheets with the maskable safe zone (a circle of radius 40% of the icon size, per the Web App Manifest spec) drawn on.
8b. **App icon (L15).** The plate with one raised Q: Montserrat ExtraBold, stretched about 6% so its counter is round, scaled so the counter hugs a flat brushed-steel hub (radius 1.8 in against the 2 in bore), the tail left as the font draws it. The brushed look is an anisotropic metal with the grain running round the disc, because a flat mirror seen face on only reflects the studio's dark horizon and goes grey. The full icon adds the plate's own lettering, set as on the plates: QALA on the arc over the top, 45LB each side; QALA along the bottom runs into the Q's tail, so it is left off. Sizes: `icon-32`, `icon-48` and `icon-96` are the plain Q (the lettering is specks under about 128 px); `icon-192` and `icon-512` are the lettered icon on a transparent background filling the canvas; `icon-maskable-512` and `apple-touch-icon` (180) sit inside the 40% safe circle on the light ground, since a mask or iOS fills clear pixels. The old hand-drawn SVG icons are gone; the manifest, `index.html` and the service worker (cache bumped to `qala-v2`) point at the PNGs. The native Kotlin app (S7) has no launcher icon yet. Android wants an adaptive icon, not the web maskable PNG: the plate as the foreground layer inside the central 66 dp circle of the 108 dp canvas (about 61%, tighter than the web's 80% safe zone) over a `#f5f5f7` background layer, and the plate lands around 48 dp on screen, near the 128 px cut-over, so pick the lettered or plain-Q tier by looking at it there. Rebuild: `blender -b -P assets/3d/build_sprites.py -- --out /tmp/qala-icons --icon --only icon_qk_both,icon_q_mont800_snug`, then `python3 assets/3d/make_icons.py /tmp/qala-icons /tmp/qala-icons/out --ship apps/web/public/icons`. Qb to Qe, the other Q candidates and the ember-on-run-color G stay in `build_sprites.py --icon` as the record of what was tried.
9. **Readiness ring** (section 6.4).
10. **Timeline rail** (section 7.1).

## 6. Charts (S4)

### 6.1 Libraries

**visx** for every in-app chart; **uPlot** for dense or zoomable time series. Measured 2026-09-13 (npm and bundlephobia):

| Library | Version, activity | License | Size, gzip | Rendering | Verdict |
|---|---|---|---|---|---|
| visx (`@visx/shape`, `scale`, `axis`, `group`, `grid`, `tooltip`, `responsive`, `event`) | 4.0.0 (June 2026), React 18 and 19 peers | MIT | shape 10 KB, scale 17 KB, axis 15 KB; import only what's used | SVG primitives as React components on d3 scales | **Chosen.** Low-level enough to hit every rule below exactly (outlined planned bars, 2px gaps, rounded data ends, today's highlight band) with CSS variables straight in the SVG, typed, tree-shakable. Avoid `@visx/xychart`, which pulls in react-spring. |
| uPlot | 1.6.32, commits September 2026 | MIT | 21 KB, no dependencies | Canvas | **Chosen for time series** past about 2,000 points or needing zoom and drag: a run's pace, heart rate and elevation at 1 Hz; multi-year e1RM and calibration residuals on the desktop. |
| Observable Plot | 0.6.17 | ISC | 125 KB | SVG grammar, not React | Rejected for the app; fine for one-off analysis. |
| Recharts | 3.10.1 | MIT | 144 KB | SVG component config | Rejected: its defaults fight the mark rules and it is six times the size of what visx needs. |
| ECharts | 6.1.0 | Apache-2.0 | 359 KB | Canvas or SVG with its own theme system | Rejected: size and a second theme system. |
| Chart.js with react-chartjs-2 | 4.5.1 | MIT | not measured | Canvas | Rejected: uPlot covers canvas time series smaller and faster. |
| Nivo, Victory, MUI X Charts, Unovis | current | MIT / Apache-2.0 | | | Not needed; MUI X also requires Emotion. |

Code lives in `apps/web/src/shared/charts/`. The plate drawing and the readiness ring sit there too since they share scales and tokens, though they aren't library charts.

### 6.2 Rules (from the dataviz method)

- Pick the form by the job; a single number is a stat tile, not a chart. No pies except a part-to-whole of at most 6 segments, and prefer a stacked bar.
- Bars at most 24px thick with a 4px rounded data end and a square baseline; a 2px surface gap between touching segments; lines 2px with round joins; markers at least 8px with a 2px surface ring; gridlines 1px solid `--grid`; never dashed, never a second y-axis.
- A legend for two or more series, plus selective direct labels (today, the latest point, the extreme); never a number on every mark. Text uses ink tokens, never the series color.
- **Done versus planned:** done load is filled; planned load is a 2px outline in the same series color. **Today** gets an `--accent-subtle` band, a 2px ember outline and a short ember label.
- Every chart has a table view built from the same data, tap or hover tooltips with at least a 24px hit area, and keyboard focus that shows the same as hover.
- SVG charts use `var(--token)` directly, so theme changes need no re-render. uPlot draws on canvas, so its wrapper resolves the tokens with `getComputedStyle` at mount and re-creates the plot when the theme changes.
- Measure chart width with the shared `Plot` component and draw in CSS pixels.
  Resizing a card must preserve text and stroke sizes. Legends wrap in normal
  document flow outside the SVG; labels get dedicated gutters. Trend lines use
  monotone interpolation through the recorded samples. Dense charts preserve
  missing-value gaps and observe their container's size.
- Palettes are validated with the dataviz script in both themes before use:
  - Categorical (time split: warm-up, lifting, rest): light `#c2410c #485cc7 #08a49c` on `#ffffff` passes every check (worst adjacent CVD delta E 20.6); dark `#e0652b #6f80e6 #16a390` on `#121a33` passes (worst adjacent CVD delta E 15.2).
  - Ordinal (intensity zones): one-hue blue, light `#86b6ef #5598e7 #2a78d6 #1c5cab #104281`, dark `#184f95 #256abf #3987e5 #6da7ec #9ec5f4`, both pass `--ordinal`.
  - Emphasis: `--mark-gray` for context with ember for the point of the chart.

### 6.3 Chart catalog

| Chart | Where | Form | Library |
|---|---|---|---|
| This week | Today hero, desktop Overview, landing | seven-day strip: one bar per day, height the day's load, fill the part done; done teal, today ember on an `--accent-subtle` band, later outlined, rest a dash; a lift/run/both/rest glyph and the day letter under each; a caption naming the tapped, hovered or focused day (today by default) and a week total line (U13) | HTML/CSS, no plotting library |
| Week ribbon | desktop Overview | three weeks side by side with one in focus (U20): the same bars and glyphs as the strip, with everything behind today on a gray wash, today on an ember edge, the week still to come dashed (a plan, not a record), a ruler of week names, date ranges and totals above, and the focus week at full strength while the other two go quiet. The toolbar's week switcher and the ruler both move the focus | HTML/CSS, no plotting library |
| Readiness ring | Today hero | ring meter out of 100 with average and low markers (6.4) | visx `Arc` |
| Readiness, last 7 days | Body | line with markers by weekday, today's value as a headline, average and low as hairlines | visx |
| Where the time went | Session complete | one stacked horizontal bar, categorical | visx |
| Sets by muscle | Session complete, Progress | horizontal bars, earlier this week in gray with today in ember, the 10-20 weekly target shaded as a band, each bar ending with its total | visx |
| Main-lift e1RM, recent | Session complete, Progress | 2px line with markers, today's point in ember, tested 1RMs as diamonds, the latest value and its change as a headline, dates or weeks on the axis | visx |
| Main-lift e1RM, full history | Desktop graphs | the same encoding with zoom and drag | uPlot |
| Reps by intensity | Session complete | one stacked bar, ordinal ramp, NL85 as the headline figure with a bracket over the 85%+ segments, counts in the legend | visx |
| Reps at 85%+ vs block target | Progress | bullet bars with an ember target tick | visx |
| Fatigue by muscle | Body | bars split lifting and running | visx |
| Running fitness | Progress | sparkline | visx |
| Splits | Run summary, desktop run detail | each mile as its difference from the run's average pace: a bar right of the center line is faster, left is slower, labeled in seconds next to the pace (U17). Bars from zero made 8:58 and 9:11 look the same and the slowest mile the longest bar | HTML/CSS |
| Pace, heart rate, elevation | Run summary, desktop run detail | synced time series | uPlot |
| Fitness and fatigue curves, calibration residuals | Desktop graphs, calibration | time series | uPlot |

### 6.4 Readiness ring

`readiness` (0-1 from PLAN 6.2) x 100, drawn as a ring. The track is `--bg-active`; the low zone from 0 to the low line is a thin `--low-zone` band just outside the track, like the red zone on a gauge (changed 2026-09-30: tinting the track under a slimmer arc showed as pink edges around the value); the value arc fills the track width and is round-capped, `--progress-fill` at or above the low line and `--danger` below it with a "low" word next to the ring. A dark tick marks the owner's 28-day average; a red tick marks the low line at `mean - 1.5 SD` of the same window (the z <= -1.5 flag in PLAN 6.2). A check-in with PRS <= 4 counts as low whatever the number. Until 14 check-ins exist, the average tick is hidden and the low line sits at 50 (assumption). A two-line legend under the ring: "your avg 76", "low under 64".

## 7. Screens

Sample numbers below match the mockups: Sunday, Strength block 2 week 3, Lower A, squat 3 x 4 at 245 lb, reference 1RM 280, quads rated 4, readiness 72.

### 7.0 Navigation (U1, U2)

Today, Plan, Body, Progress, Coach (decided 2026-09-13). Settings and history are header buttons. Starting a lift or run happens from Today or a Plan day; there is no Start tab.

### 7.1 Today (U3)

Layout: a branded utility header, date and block week above the page title, a
52px timeline rail with a 16px gap, the stage card to its right, and the tab bar.

**Timeline rail.** The day's stages in order: check-in, warm-up, lift, recover, run, wind down, each with its planned time. Stages without a planned item are skipped; a rest day shows check-in, recover and wind down (decided; DECISIONS U10). Done stages are teal with a check; the current stage is a larger ember node with the CTA shadow; later stages are outlined. A vertical flick on the rail or the card moves between stage cards to preview what's next or look back; small chevrons at the rail's ends show it scrolls. It snaps back to "now" after 10 s idle (decided; DECISIONS U9) and advances on its own when a stage completes (warm-up done, session finished, run saved) or its planned time passes.

**Stage cards.** One hero card per stage, with a card shadow so it reads as the thing on screen:

| Stage | Card |
|---|---|
| Before the lift ("Now · warm-up, then lift") | Title from the program day plus a nickname from its first main lift: "Lower A · Squat day". Left: the top set and one reason line ("A little under your average, so squat holds."). Right: the readiness ring and its legend. This week's load with today outlined and labeled. A warm-up and lift time strip. The large Start warm-up button. Below the card: "Then: Easy run · 3.0 mi · 6 pm". |
| After the lift ("Now · recover") | "Lift done", three figures (58 min, 20,420 lb +6%, 1 PR), this week's load with today's lift now filled and the run still outlined, one recovery line, the large "See session" button, a secondary "Run earlier instead". Below: "Next · in 9 h 40 m · Easy run". |
| During a run | Hands off to the run screens (7.14); the rail shows run as current. |
| Evening ("Now · wind down") | "Day complete", today's totals (lift minutes, run miles, load), the full week, tomorrow's plan ("Monday · rest day"), the sleep target, the large "See day summary" button. |

The current phone lift/warm-up card refines the original before-lift composition:
day title, top-set figure, readiness score and reason, duration, primary action,
then the next run. The ring and the week strip live in a full-width expandable
"Readiness & weekly load" section beneath the action. This avoids squeezing two
chart columns beside the rail.

Build, 2026-09-30: composition unchanged. Stage cards share one title style and no longer nest a bordered tile grid; after the lift and in the evening they show three figures in a row. The preview label has a Back to now button. The disclosure reads "Readiness and this week" with a chevron. The secondary under the hero is Run first instead. The evening card names tomorrow's actual session (Upper A) rather than a rest day.

### 7.2 Plan (U4)

Header: block name and periodization, `< Week 3 of 6 >` with arrows, a thin strip of the block's weeks (done, current in ember, deload lighter). Day tabs Monday to Sunday with the date and a glyph (`dumbbell`, `sport-shoe`, `bed`), the selected day underlined in ember. Below: day title and length including warm-up, the Start workout button, Overview / Details. Overview is a two-column grid of exercise cards (name, sets x reps x load, a note icon when a note is waiting, a chip such as "+1 set"). Details lists the warm-up, every set, and the day's run.

Build, 2026-09-30: each day carries its own exercises (the cards used to repeat today's workout on every lift day), and the sample week matches the Today strip's days and statuses. Day tabs show the date and a done check, a skipped day is struck through. The block strip numbers its weeks with D for the deload, and the arrows and strip change the week shown. Start workout is the primary only on today; a done day offers See what you did and a later day Do this today instead. Overview is the exercise grid and Details the set list (they were swapped).

### 7.3 Check-in

Title "How are you walking in?". Recovery 0-10 as a row of buttons with anchors. Soreness 1-4 for each muscle today's session trains, with when it was last trained and the four meanings. A free-text line; the coach turns it into removable chips ("Sleep 6 h", "Left knee: watch"). On a rest day, the card also surfaces a suggested mobility/recovery line (foam roller, Theragun, stretching) drawn from soreness answers and owned equipment — a tip, not a tracked stage (DECISIONS U10; see CONTEXT.md's "mobility" entry for how this differs from the warm-up's mobility block). Continue to warm-up.

Build, 2026-09-30: recovery and soreness use the scale picker; each muscle shows the meaning of the picked value in place of a hover title. On a rest day the button saves the check-in and returns to Today instead of opening the warm-up.

### 7.4 Warm-up (T6, T7)

Four numbered groups from PLAN 6.7, each with a duration: General (the machine, pace, a timer, and why it's 10 minutes today), Soft tissue (muscle, tool, time, a check each, and why: "Sore (4): 2 min, no Theragun"), Mobility (drills and reps), Ramp sets (step, load, reps, plates per side as chips, rest; an extra step labeled "extra step: quads sore"), ending with the work sets and their plates. A footnote marks coach-practice rules. Start workout; Skip in the header.

Build, 2026-09-30: four numbered step cards with their times. Soft tissue and mobility items are check rows. Ramp sets show load, reps, plate discs and rest per row, the extra step flagged in ember, and a closing work-sets row.

### 7.5 Workout: one exercise (U5, T9, T10)

Top: collapse, day name and the ticking workout clock, Finish. A segmented progress bar, one segment per exercise, filled per completed set, the current one outlined. "Exercise 1 of 6 · Set 3 of 3". A returning note card when one is waiting. The exercise title and last time's sets. The logging card: weight x reps as big figures with -/+ steppers, plate shorthand chips and a calculator button, RPE chips 7-10 in half steps. Actions: Info, Swap, Note, Log set (primary). A rest preview and the next exercise. "All exercises" and a swipe hint.

Build, 2026-09-30: flow header (all exercises, session clock, Finish). Progress segments fill per completed set and are buttons that jump to that exercise. Weight and reps are steppers; the plate discs and shorthand open the calculator; RPE is one scale strip with "3 in the tank" and "max" anchors; Log set is the large primary. The coach banner says "Coach suggests" with Use 240 while pending, and "Coach adjusted today" with Use engine once applied; accepting moves the weight. Info, Swap, Note and Joint pain sit in a labeled tool bar under the card, and Prev / Next buttons name the neighbouring exercise.

### 7.6 Rest (T8, T10)

The workout top bar stays. "Back Squat · set 2 logged: 245 x 4 @ 9". The countdown as a ticking figure with "of 3:45", a progress bar, Ready early and +30 s. The next set's load as the plate drawing ("Same as last set" or the change instruction). "Why 3:45" lists base, pace, effort, readiness adjustments with their seconds. A card for the change to the next exercise ("After squats: RDL 205. Take off 45 and 10, add 35 each side.").

Build, 2026-09-30: the bar runs down as time passes. Ready early is the primary and becomes Start set 3 at zero, with +30 s beside it (the separate Next set button is gone). The next set's load sits on its own card with the loaded bar. Why 3:45 is a ledger: base, each adjustment with its seconds, the total. The plate change after this exercise is its own card with before and after discs.

### 7.7 All exercises

The zoomed-out view: warm-up done, then a two-column grid of exercises with set dots, the current one outlined in ember; tap to jump. Doing them out of order is fine and history keeps the actual order.

Build, 2026-09-30: flow header with a way back, the warm-up line, then numbered cards with a box per set; the current exercise has the ember border.

### 7.8 Session complete (U6)

Top to bottom: title ("Lower A, done"); four stat tiles (duration, volume, hard sets, PRs, each with a delta against the same session last time); where the time went; sets by muscle this week; the main lift's e1RM over 8 sessions; reps by intensity with NL85; the exercise list with volume delta chips; two quick questions (per-muscle performance, session RPE); the day's run handoff; Finish.

Build, 2026-09-30: exercise rows carry a volume delta badge. The performance question uses words (Beat it, Hit it, Barely, Missed) on the scale picker, session RPE has CR-10 anchors, and the run handoff is the last card with Finish session.

### 7.9 Body

"Legs are still recovering". Readiness over 7 days. The front and back muscle map (liftosaur's SVGs). Fatigue by muscle split lifting and running, with when each is ready. Deload status. Recovery tools owned.

Build, 2026-10-01: the muscle map is built (`shared/bodymap/RecoveryMap.tsx`): front and back figures from liftosaur's SVGs, each muscle tinted by how recovered it is with a label ("Quads, Ready Sat"), and a fatigue curve for the selected muscle with a swipe to the next. An earlier soreness list with a four-step meter per muscle stood in for it until then.

### 7.10 Progress

The block and week, a headline ("Squat is up 4% this block"), squat 1RM with daily best, estimate and tested markers, reps at 85%+ against the block target, sets per muscle, running fitness and weekly miles, recent sessions and "All history".

Build, 2026-09-30: the headline is the page title; reference, estimate and tested 1RM are three figures under it. Recent sessions use the shared session rows with a lift or run glyph.

### 7.11 Coach (U8)

Open-ended conversation within fitness/training/health/recovery topics (declines unrelated requests); every actionable suggestion still passes through the P3 envelope (decided 2026-09-13; `docs/adr/0001-coach-open-chat.md`). Context chips (today's session, check-in), the conversation, a suggested change card showing engine and coach numbers side by side including plates per side, the limits, Use coach / Keep engine, and "Remember this?" memory proposals. Composer above the tab bar; "Runs on callisto".

Build, 2026-09-30: the thread is coach and you turns (you filled with ink, right aligned). The suggestion card shows engine and coach side by side, the coach's plates as discs (the sample said 45 · 25 · 5 for 240, which loads 195; it is now 45 · 45 · 5 · 2.5), the limits, and Keep engine / Use coach.

### 7.12 Plate calculator (T10)

Target weight as a big figure with -/+, the bar choice, the plate drawing for one side, a summary (bar plus plates with counts and the arithmetic), and the owner's plate inventory with counts and an Edit action. Opened from the logging card, the rest screen, or Settings.

Build, 2026-09-30: target as a stepper, bar on the scale picker, the loaded bar, the arithmetic, and the inventory listed with a disc per plate. 55 lb bumpers are optional (owner, 2026-10-01): a switch at the top of the inventory adds them with a pair count, and the plate math uses them once on (245 becomes 55 · 45 a side). Settings are not persisted yet, so this resets on reload like every other setting.

### 7.13 Settings

Groups in order: Units; Bars and plates (default bar, plates, plate colors, collars); Equipment you own (foam roller, Theragun, bike, rower, treadmill); Warm-up (build a warm-up, soft tissue, prefer Theragun, time); Rest timer (automatic, learn from taps, show plates for the next set, alert); Check-ins; Running (audio cues, auto-pause, heart-rate strap, offline map area); Coach (status, limits, memory); Appearance (theme, title font).

Build, 2026-09-30: rows are label left, value right; plate colors show the inventory's discs; theme and title font use the scale picker, with a title-font sample.

### 7.14 Running

Start (map, GPS status, the planned run, Start run), Live (time, miles largest, current and average pace as ticking figures; pause as a square ember button), Guided (step name in ember, time left, the target pace band with the current pace marker, "Speed up a little", miles and time), Summary (map with mile markers, title, six figures, splits, effort, what it means for tomorrow, Save run). Run glyphs use `sport-shoe`.

Build, 2026-09-30: the map is a drawn stand-in (streets, the loop in the run color, start dot, mile markers on the summary) until MapLibre lands. Start shows GPS and a cues switch. Live switches Numbers / Splits / Map with a segmented control, shows miles largest, and pairs a square ember pause with Finish run (no hold gesture yet). Guided draws the pace band slow to fast with both edges labeled and the current pace as a marker; Back to numbers is secondary. Summary uses the splits chart and the effort scale.

### 7.15 Desktop: the refined shell (U11, U20-U23)

The sidebar has two numbered groups, Training (01 Overview, 02 Lifts, 03 Running, 04 Body, 05 History) and Workspace (06 Programs, 07 Exercises, 08 Coach memory, 09 Calibration), with Settings pinned below and the sync status under it. The numbers replace icons: the owner found the icons took away from the look. The mark at the top is the app icon (the Qk plate, L15) beside "Qala." and a small italic "training record".

The toolbar holds a search that jumps to a page, lift, exercise or session (Ctrl or Cmd K), a week switcher that moves which week is in focus, and a Workout view link to the phone shell. It has no avatar: Qala has no accounts.

Every page opens on a lede card: a kicker line, the title in Qala Test, an ink rule (2px, `--fg`), then whatever leads the page. Cards below use a serif heading over the same ink rule. Cards are white on the off-white ground with the Beamer border and a resting `--shadow-card`; tokens.css is untouched and every color is a token, so dark mode comes with it. Tables are dense: 10px uppercase headers, 12px cells, a LIFT or RUN tag, DM Mono numerals right-aligned, and PR and note pills; a session's coach flag and note sit under its row.

- Overview is the week in review: where the block stands (week 3 of 6, deload in week 6), four headline figures, and the week ribbon (6.3), then the sessions with filter chips and the estimated 1RMs.
- Lifts leads with the average e1RM gain and a ranked gain bar per lift, then one card per lift.
- Running leads with VDOT and its trend, then the runs and the latest run's splits against its own average (U17).
- Body leads with the recovery map, front and back side by side with the selected muscle's fatigue curve under them, then readiness by weekday, sets by muscle and the deload status.
- History is one filterable table. Programs shows the block, the single ember action (generate the next block), the liftoscript source and the week preview. Exercises has search, an equipment filter and a Hide action per row. Coach memory shows proposals with Accept and Reject, the profile and the log. Calibration shows observations against the 20 that free theta, the parameters and the squat residuals. Settings flows the phone's groups into two columns.

Below 1100px the two-column rows stack; below 760px the sidebar becomes a menu and the toolbar wraps. Program source and its week preview share a split view. Run detail uses three separate plots for pace, heart rate, and elevation, with synchronized time windows and cursors.

### 7.16 Desktop: coach memory

Dated, sourced facts with Accept / Reject for pending ones, the profile the coach reads, and the coach log including clamped and discarded adjustments.

### 7.17 Landing page (U7)

For people reaching Qala on the tailnet: a wide editorial hero, "Train with the
whole picture.", concise supporting copy, Open Qala and How it decides, and a
device morph on the right: one frame that loops phone, laptop, desktop and
then the bare app card (`shared/DeviceMorph.tsx`, CSS keyframes only, static
laptop under reduced motion), to show where Qala runs. Three
sections explain planning, adaptation, and progress. Open Qala enters the
desktop workspace on wide screens and Today on phones. AGPL and liftosaur
credit remain in the footer.

## 8. Mockups

`mockups/build.mjs` generates `mockups/qala-app-mockups.html`, published at https://claude.ai/code/artifact/250bf70f-3bed-4593-ad17-afc44bb14a0c (version 5, 2026-09-13; made private 2026-09-13, `DECISIONS.md` section 7). Pages: Today (your pick), Today options (round 3), Phone, Desktop and web, Foundations. Regenerate with `LUCIDE_JSON=<extracted Lucide paths> node mockups/build.mjs`, then assemble and republish with the design canvas tool. The mockups are hand-drawn HTML and SVG with sample data: they do not use visx or uPlot. Runs show `sport-shoe` since version 5.
