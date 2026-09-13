# Qala: design system and screens

The single reference for how Qala looks and behaves on screen. The owner's choices behind it are in `DECISIONS.md` (codes like L4 or U3 below point there). Engine rules the screens display are in `PLAN.md` section 6. The review canvas that shows all of this is `mockups/qala-app-mockups.html` (section 8 below).

## 1. Principles

1. **Beamer first.** Qala should look like a sibling of the owner's Beamer app: off-white ground, white surfaces, 2px borders, hard offset shadows, small radii. (L1)
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
  --accent:#fb923c; /* 8.37 */ --accent-subtle:rgba(251,146,60,.12); --on-accent:#0b1020; /* white would be 2.26 */
  --run:#8e9cf0; --progress:#2dd4bf; --progress-fill:#2dd4bf; --danger:#f87171; --success:#4ade80;
  --note:#2a2412; --note-border:rgba(251,191,36,.30); --note-ink:#fbbf24;
  --viz-1:#e0652b; --viz-2:#6f80e6; --viz-3:#16a390;
  --int-1:#184f95; --int-2:#256abf; --int-3:#3987e5; --int-4:#6da7ec; --int-5:#9ec5f4;
  --mark-gray:#39425f; --low-zone:rgba(248,113,113,.40);
  --bar:#6b7384; --bar-collar:#9aa1ad;
  --shadow-card:2px 4px 0 0 #2a3350; --shadow-cta:2px 4px 0 0 #3a4466, 0 0 0 1px #fb923c;   /* black shadows vanish on the dark ground */
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
| Warm-up | `bike`, `cylinder` foam roller, `vibrate` Theragun, `circle-check` |
| Run | `play`, `pause`, `route`, `signal-high` GPS, `volume-2` cues, `zap` guidance, `heart-pulse`, `mountain`, `timer` |
| Data and notices | `gauge`, `list-checks`, `clock`, `x` |

## 5. Components

Anatomy copies Beamer; phone controls scale up to a 44px minimum touch target.

1. **Card:** `--bg-surface`, 2px `--border`, `--radius-md`, 14-16px padding, flat at rest, `--shadow-card` on hover or press.
2. **Group:** one bordered container with a `--bg-recessed` header band holding the group label, optional right-side action, 2px divider rows inside.
3. **Buttons:** primary is ember fill, `--on-accent` text, `--radius`, `--shadow-cta`, 52px tall on phone; the **large primary** on Today is 64px with a 22px icon. Secondary is a 2px bordered surface button. No pills.
4. **Chips and segmented controls:** 4px radius chips on `--bg-active`; segmented controls are one bordered strip with the selected cell on `--bg-active`.
5. **Toggles:** square-cornered, ember when on.
6. **Tab bar:** 72px, 2px top border, a 3px ember bar above the active tab's icon.
7. **Exercise note card:** `--note` fill, `--note-border`, sticky-note icon, date label, Got it / Pin / Resolved.
8. **Plate drawing and plate chips.** The drawing shows one side of the bar: sleeve to the left, collar and bar label to the right, plates heaviest innermost, each plate labeled with its weight (rotated on tall plates, below on small ones). Plate heights step down with weight. Chips are small filled rectangles in plate color with the weight printed, used as shorthand ("45 · 45 · 10"). Colors, text color on each, and editability are in PLAN 6.8; defaults: 55 red `#d64541`, 45 blue `#2f6bd1`, 35 yellow `#e9b824` (ink text), 25 green `#2f9c5a`, 10 white `#eef0f4` with a hairline (ink text), 5 charcoal `#3b404c`, 2.5 silver `#b9bfca` (ink text).
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
- Palettes are validated with the dataviz script in both themes before use:
  - Categorical (time split: warm-up, lifting, rest): light `#c2410c #485cc7 #08a49c` on `#ffffff` passes every check (worst adjacent CVD delta E 20.6); dark `#e0652b #6f80e6 #16a390` on `#121a33` passes (worst adjacent CVD delta E 15.2).
  - Ordinal (intensity zones): one-hue blue, light `#86b6ef #5598e7 #2a78d6 #1c5cab #104281`, dark `#184f95 #256abf #3987e5 #6da7ec #9ec5f4`, both pass `--ordinal`.
  - Emphasis: `--mark-gray` for context with ember for the point of the chart.

### 6.3 Chart catalog

| Chart | Where | Form | Library |
|---|---|---|---|
| This week's load | Today hero, Body | stacked columns per day, lifting under running, done filled, planned outlined, today highlighted and named | visx |
| Readiness ring | Today hero | ring meter out of 100 with average and low markers (6.4) | visx `Arc` |
| Readiness, last 7 days | Body | line with markers, average and low as hairlines | visx |
| Where the time went | Session complete | one stacked horizontal bar, categorical | visx |
| Sets by muscle | Session complete, Progress | horizontal bars, earlier this week in gray with today in ember, hairlines at 10 and 20 | visx |
| Main-lift e1RM, recent | Session complete, Progress | 2px line with markers, today's point in ember, tested 1RMs as diamonds | visx |
| Main-lift e1RM, full history | Desktop graphs | the same encoding with zoom and drag | uPlot |
| Reps by intensity | Session complete | one stacked bar, ordinal ramp, NL85 as the headline figure | visx |
| Reps at 85%+ vs block target | Progress | bullet bars with an ember target tick | visx |
| Fatigue by muscle | Body | bars split lifting and running | visx |
| Running fitness | Progress | sparkline | visx |
| Splits | Run summary | table with inline bars | visx |
| Pace, heart rate, elevation | Run summary, desktop run detail | synced time series | uPlot |
| Fitness and fatigue curves, calibration residuals | Desktop graphs, calibration | time series | uPlot |

### 6.4 Readiness ring

`readiness` (0-1 from PLAN 6.2) x 100, drawn as a ring. The track is `--bg-active`; the low zone from 0 to the low line is tinted `--low-zone`; the value arc is slimmer and round-capped, `--progress-fill` at or above the low line and `--danger` below it with a "low" word next to the ring. A dark tick marks the owner's 28-day average; a red tick marks the low line at `mean - 1.5 SD` of the same window (the z <= -1.5 flag in PLAN 6.2). A check-in with PRS <= 4 counts as low whatever the number. Until 14 check-ins exist, the average tick is hidden and the low line sits at 50 (assumption). A two-line legend under the ring: "your avg 76", "low under 64".

## 7. Screens

Sample numbers below match the mockups: Sunday, Strength block 2 week 3, Lower A, squat 3 x 4 at 245 lb, reference 1RM 280, quads rated 4, readiness 72.

### 7.0 Navigation (U1, U2)

Today, Plan, Body, Progress, Coach (decided 2026-09-13). Settings and history are header buttons. Starting a lift or run happens from Today or a Plan day; there is no Start tab.

### 7.1 Today (U3)

Layout: header (date and block week, history and settings buttons), a timeline rail on the left edge (70px), the stage card to its right, the tab bar.

**Timeline rail.** The day's stages in order: check-in, warm-up, lift, recover, run, wind down, each with its planned time. Stages without a planned item are skipped; a rest day shows check-in, recover and wind down (decided; DECISIONS U10). Done stages are teal with a check; the current stage is a larger ember node with the CTA shadow; later stages are outlined. A vertical flick on the rail or the card moves between stage cards to preview what's next or look back; small chevrons at the rail's ends show it scrolls. It snaps back to "now" after 10 s idle (decided; DECISIONS U9) and advances on its own when a stage completes (warm-up done, session finished, run saved) or its planned time passes.

**Stage cards.** One hero card per stage, with a card shadow so it reads as the thing on screen:

| Stage | Card |
|---|---|
| Before the lift ("Now · warm-up, then lift") | Title from the program day plus a nickname from its first main lift: "Lower A · Squat day". Left: the top set and one reason line ("A little under your average, so squat holds."). Right: the readiness ring and its legend. This week's load with today outlined and labeled. A warm-up and lift time strip. The large Start warm-up button. Below the card: "Then: Easy run · 3.0 mi · 6 pm". |
| After the lift ("Now · recover") | "Lift done", three figures (58 min, 20,420 lb +6%, 1 PR), this week's load with today's lift now filled and the run still outlined, one recovery line, the large "See session" button, a secondary "Run earlier instead". Below: "Next · in 9 h 40 m · Easy run". |
| During a run | Hands off to the run screens (7.14); the rail shows run as current. |
| Evening ("Now · wind down") | "Day complete", today's totals (lift minutes, run miles, load), the full week, tomorrow's plan ("Monday · rest day"), the sleep target, the large "See day summary" button. |

### 7.2 Plan (U4)

Header: block name and periodization, `< Week 3 of 6 >` with arrows, a thin strip of the block's weeks (done, current in ember, deload lighter). Day tabs Monday to Sunday with the date and a glyph (`dumbbell`, `sport-shoe`, `bed`), the selected day underlined in ember. Below: day title and length including warm-up, the Start workout button, Overview / Details. Overview is a two-column grid of exercise cards (name, sets x reps x load, a note icon when a note is waiting, a chip such as "+1 set"). Details lists the warm-up, every set, and the day's run.

### 7.3 Check-in

Title "How are you walking in?". Recovery 0-10 as a row of buttons with anchors. Soreness 1-4 for each muscle today's session trains, with when it was last trained and the four meanings. A free-text line; the coach turns it into removable chips ("Sleep 6 h", "Left knee: watch"). On a rest day, the card also surfaces a suggested mobility/recovery line (foam roller, Theragun, stretching) drawn from soreness answers and owned equipment — a tip, not a tracked stage (DECISIONS U10; see CONTEXT.md's "mobility" entry for how this differs from the warm-up's mobility block). Continue to warm-up.

### 7.4 Warm-up (T6, T7)

Four numbered groups from PLAN 6.7, each with a duration: General (the machine, pace, a timer, and why it's 10 minutes today), Soft tissue (muscle, tool, time, a check each, and why: "Sore (4): 2 min, no Theragun"), Mobility (drills and reps), Ramp sets (step, load, reps, plates per side as chips, rest; an extra step labeled "extra step: quads sore"), ending with the work sets and their plates. A footnote marks coach-practice rules. Start workout; Skip in the header.

### 7.5 Workout: one exercise (U5, T9, T10)

Top: collapse, day name and the ticking workout clock, Finish. A segmented progress bar, one segment per exercise, filled per completed set, the current one outlined. "Exercise 1 of 6 · Set 3 of 3". A returning note card when one is waiting. The exercise title and last time's sets. The logging card: weight x reps as big figures with -/+ steppers, plate shorthand chips and a calculator button, RPE chips 7-10 in half steps. Actions: Info, Swap, Note, Log set (primary). A rest preview and the next exercise. "All exercises" and a swipe hint.

### 7.6 Rest (T8, T10)

The workout top bar stays. "Back Squat · set 2 logged: 245 x 4 @ 9". The countdown as a ticking figure with "of 3:45", a progress bar, Ready early and +30 s. The next set's load as the plate drawing ("Same as last set" or the change instruction). "Why 3:45" lists base, pace, effort, readiness adjustments with their seconds. A card for the change to the next exercise ("After squats: RDL 205. Take off 45 and 10, add 35 each side.").

### 7.7 All exercises

The zoomed-out view: warm-up done, then a two-column grid of exercises with set dots, the current one outlined in ember; tap to jump. Doing them out of order is fine and history keeps the actual order.

### 7.8 Session complete (U6)

Top to bottom: title ("Lower A, done"); four stat tiles (duration, volume, hard sets, PRs, each with a delta against the same session last time); where the time went; sets by muscle this week; the main lift's e1RM over 8 sessions; reps by intensity with NL85; the exercise list with volume delta chips; two quick questions (per-muscle performance, session RPE); the day's run handoff; Finish.

### 7.9 Body

"Legs are still recovering". Readiness over 7 days. The front and back muscle map (liftosaur's SVGs). Fatigue by muscle split lifting and running, with when each is ready. Deload status. Recovery tools owned.

### 7.10 Progress

The block and week, a headline ("Squat is up 4% this block"), squat 1RM with daily best, estimate and tested markers, reps at 85%+ against the block target, sets per muscle, running fitness and weekly miles, recent sessions and "All history".

### 7.11 Coach (U8)

Open-ended conversation within fitness/training/health/recovery topics (declines unrelated requests); every actionable suggestion still passes through the P3 envelope (decided 2026-09-13; `docs/adr/0001-coach-open-chat.md`). Context chips (today's session, check-in), the conversation, a suggested change card showing engine and coach numbers side by side including plates per side, the limits, Use coach / Keep engine, and "Remember this?" memory proposals. Composer above the tab bar; "Runs on callisto".

### 7.12 Plate calculator (T10)

Target weight as a big figure with -/+, the bar choice, the plate drawing for one side, a summary (bar plus plates with counts and the arithmetic), and the owner's plate inventory with counts and an Edit action. Opened from the logging card, the rest screen, or Settings.

### 7.13 Settings

Groups in order: Units; Bars and plates (default bar, plates, plate colors, collars); Equipment you own (foam roller, Theragun, bike, rower, treadmill); Warm-up (build a warm-up, soft tissue, prefer Theragun, time); Rest timer (automatic, learn from taps, show plates for the next set, alert); Check-ins; Running (audio cues, auto-pause, heart-rate strap, offline map area); Coach (status, limits, memory); Appearance (theme, title font).

### 7.14 Running

Start (map, GPS status, the planned run, Start run), Live (time, miles largest, current and average pace as ticking figures; pause as a square ember button), Guided (step name in ember, time left, the target pace band with the current pace marker, "Speed up a little", miles and time), Summary (map with mile markers, title, six figures, splits, effort, what it means for tomorrow, Save run). Run glyphs use `sport-shoe`.

### 7.15 Desktop: program editor

Sidebar (Today, Plan, Programs, Run plans, Exercises, Body, Progress, Coach, Settings), a header with the block and Generate next block, the liftoscript editor with inline errors, and the evaluated week preview with week totals.

### 7.16 Desktop: coach memory

Dated, sourced facts with Accept / Reject for pending ones, the profile the coach reads, and the coach log including clamped and discarded adjustments.

### 7.17 Landing page (U7)

For people reaching Qala on the tailnet: headline "Lift and run from one plan.", one paragraph, Open Qala and How it decides, then four sections (how it decides, plans, running, coach) using real screen fragments; AGPL and liftosaur credit in the footer. No testimonials or invented claims.

## 8. Mockups

`mockups/build.mjs` generates `mockups/qala-app-mockups.html`, published at https://claude.ai/code/artifact/250bf70f-3bed-4593-ad17-afc44bb14a0c (version 5, 2026-09-13; made private 2026-09-13, `DECISIONS.md` section 7). Pages: Today (your pick), Today options (round 3), Phone, Desktop and web, Foundations. Regenerate with `LUCIDE_JSON=<extracted Lucide paths> node mockups/build.mjs`, then assemble and republish with the design canvas tool. The mockups are hand-drawn HTML and SVG with sample data: they do not use visx or uPlot. Runs show `sport-shoe` since version 5.
