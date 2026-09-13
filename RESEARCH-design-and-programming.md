# Qala research: Runkeeper-flavoured design language, and strength/hypertrophy programming for the generator

Written 2026-09-13 as input to PLAN.md (sections 3 "Look", 9, 12). Part A covers the visual system and information architecture. Part B covers the programming parameters for the generator in `packages/generator` and the metrics for the desktop graphs.

Each number says where it came from. "CSS" means read from Runkeeper's shipped stylesheet or from computed styles in headless Chromium. "Pixel" means a median colour sampled from an official screenshot. "Unverified" means I couldn't get it from a primary source.

Screenshots and raw captures are in `/tmp/claude-1000/-home-berkley-Programming-qala/7c814f87-c16b-4bc8-a33b-a9c462009576/scratchpad/runkeeper/`:

| File | What it is |
|---|---|
| `runkeeper_com_cms__{desktop,mobile}.png` | Marketing site, home |
| `runkeeper_com_cms_train__*`, `_race__*`, `_start_running__*` | Train, Race and Start pages |
| `computed-*.json` | Computed styles for h1/h2/h3, p, buttons and nav on all four pages |
| `style.css` | The theme stylesheet (`runkeeper_theme_2_0/dist/style.css`) |
| `play_shot_1..8.png` | Google Play screenshots, current 2026 app |
| `appstore_shot_2..6.png` | App Store screenshots. Shot 1 is Runkeeper's own icon; shots 7-10 are other apps' icons from the listing's "You might also like" strip (10 is Nike Run Club). None of 1 or 7-10 are screens |
| `journey_frames.png` | Five frames of the live-run screen, from the homepage GIF |
| `raceplan_frames.png` | Race plan week strip, from the homepage GIF |
| `rk_start_screen.png`, `rk_activity_in_progress.png`, `rk_activity_saved.png` | 2023 iOS and Android screens from Runkeeper's beginner guide |

---

# Part A: Runkeeper design language

## A1. What Runkeeper actually uses

### Colour

| Role | Hex | Source |
|---|---|---|
| Navy ink: headings, huge numerals, icons, active tab | `#001E62` | CSS (225 uses). Live-run numerals in the GIF sample as `#001c60`, same ink |
| Deeper navy variants (hover, pressed) | `#00184E`, `#00123B` | CSS |
| Secondary text on the site | `rgba(0, 30, 98, 0.75)` | CSS (computed on `p`) |
| Periwinkle CTA blue: site buttons, 2023 Start button, play/pause circle, race-plan header | `#485CC7` | CSS (125 uses). Pause/play samples `#485cc4` / `#445cc4` |
| Darker periwinkle (hover) | `#3A4A9F`, `#2B3777` | CSS |
| Lavender tints: badges, disabled, washes | `#B6B8DC`, `#E4E5F3` | CSS. Workout blocks in the plan detail sample `#e0e4f0` |
| Teal: progress bars, completed checks, goal rings, charts | `#08A49C` (app), `#2DC9D7` (site) | Pixel (progress bar, zone 2 bar `#09a69d`) and CSS |
| Chart teal pair: walk and run bars | `#19ABB8`, `#1D5E7C`, light `#A5E8EE` | Pixel |
| Heart-rate zones 1-5 | `#3A4A9F` / `#2DC9D7` / `#EDE04B` / `#FCC89B` / `#E04F39` | CSS. Pixel samples in the app: `#2f3ea3 / #09a69d / #eee04b / #fcc79b / #e04f3a`, so the site and app palettes match |
| Streak orange ring / peach band | `#EC8034` / `#FCECDC` | Pixel (App Store streak screen) |
| Target band on interval pages | `#F4F4E0` | Pixel. The CSS has `#FAF8DD` |
| Heart icon | `#E04C38` | Pixel |
| Body text (Bootstrap default) | `#212529` | CSS |
| Recessed rows, gray blocks | `#F3F3F3`, `#E0E0E0` | Pixel |
| Live-run labels (TIME, MILES) | `#6C6C74` | Pixel |
| Store screenshot frame gradient | `#011E64` -> `#2E3EA0` | Pixel |
| Route line on the activity map | not found | **Unverified.** No public post-run map screenshot turned up. Comparison lines in Personal Bests are a periwinkle blue plus teal |

Grounds are plain white in the app. There are no drop shadows in the app screens, only 1px light-gray card borders with roughly 12px radius.

One change between versions: in the 2023 screens the Start button is periwinkle `#485CC7`. In the 2026 Play screenshots the Start button and the active interval card are navy (samples `#081d5e`, `#011e62`), while play/pause stays periwinkle. The current app keeps periwinkle for the in-run control and uses navy for the pre-run CTA.

### Type

- **Marketing site.** One family, `"ASICS Webfont"`, in four faces (400 and 700, each normal and italic). This is the proprietary ASICS brand typeface.
  - Chan's case study calls it "ASICS Font 3.0". Kontrapunkt describes a bespoke brand typeface it built with Bruce Mau Design.
  - `h1, h2, h3 { font-style: italic }` is set globally in the stylesheet.
- **App.** Noto Sans. Per Nikki Chan's 2023 rebrand case study, ASICS Font 3.0 was proposed first. It was rejected because it's narrow and condensed, which hurt readability, and because it lacked language coverage. The live-run numerals look like Noto Sans Bold. That is a visual match, not checked against the binary.

Computed styles from the marketing site (headless Chromium, 1440px wide):

| Element | Font | Size | Weight / style | Colour | Other |
|---|---|---|---|---|---|
| h1 "Together, we run." | ASICS Webfont | 90px | 700 italic | `#001E62` | letter-spacing 0.25px |
| h2 section titles | ASICS Webfont | 67px | 700 italic | `#001E62` | letter-spacing 0.25px |
| h3 card titles ("Tiny Wins") | ASICS Webfont | 18-21px | 700, italic or normal | `#001E62` | |
| Body `p` | ASICS Webfont | 21px | 400 | `rgba(0,30,98,.75)` | |
| Eyebrow "COACH CORRINE" | ASICS Webfont | 16px | 400 | `#001E62` | uppercase, letter-spacing 6px |
| Primary button | ASICS Webfont | 18px | 700 | white on `#485CC7` | radius 28.8px (pill), 2px border same colour, padding 10px 30px 12px |
| Secondary button | ASICS Webfont | 18px | 700 | `#485CC7` on white | same pill, 2px `#485CC7` border |
| Header "Download the App" | ASICS Webfont | 14px | 700 | white on `#485CC7` | radius 24px, padding 8px 16px |
| Nav links | ASICS Webfont | 16px | 700 | `#001E62` | padding 10px 14px 15px |

Radii in the stylesheet cluster at 0, 0.25rem, 0.5rem, 1rem, 1.5rem and 50%. There are no box shadows on buttons or cards.

**Why we substitute.** ASICS Font 3.0 is a proprietary brand asset, so we can't ship it. Noto Sans would be legal (OFL), but it's the generic Android face and would erase the Beamer flavour. Recursive is already Beamer's UI face and can produce a heavy oblique on its own (A3). The ASICS stripes, the Runkeeper wordmark and the "GO" badge artwork are trademarks, so leave all three out. Colour values and layout patterns aren't protectable, but we still adapt the palette rather than cloning it.

## A2. Information architecture (from public screens)

- **Bottom tabs (2026 Play screenshots).** Me, Training, Start, Community, Challenges.
  - In the 2023 screens the fifth tab was "Explore".
  - There is no "Feed" tab. The feed lives inside Community ("Community Feed" plus "Running Groups").
  - Settings sit behind a gear on the Start screen.
- **Start.**
  - Top bar: gear on the left, "+" on the right (manual activity).
  - Full-bleed map. Round floating buttons over it include a hazard triangle, a broadcast-style button (probably Live Tracking; unverified), the shoe tracker and recenter.
  - A right-hand rail on the 2026 map carries widgets: a streak flame with a count, a goal target, elevation, and a collapse control. The 2025 update notes describe widgets for streaks, goals, challenges and stats vs last week.
  - A GPS signal chip bottom-left with bars ("Good GPS" on Android).
  - A 2x2 settings card: Activity (Running), Workout (None, or e.g. "1.9 mi Surges"), Music (Select), Audio Stats (e.g. Time, or every 5 min).
  - A full-width Start button with fully rounded ends.
  - Modes are GPS and Stopwatch (treadmill, indoor).
- **Live run.** Three or four swipeable pages with page dots.
  - Page 1 stacks huge navy numerals: TIME (about 64pt), then MILES (the largest, about 100pt), then a split row of CURRENT PACE | AVG PACE (about 40pt).
  - Labels are small gray uppercase. Sections are separated by hairline dividers.
  - Bottom bar: camera, a large periwinkle circular play/pause, settings gear.
  - Swiping left shows the map with live splits by mile.
  - During guided or interval workouts:
    - A min/mi vs mi/h toggle.
    - Segment cards ("Warm Up 2.5 km @ 7:35-8:36 min/mi" with the current pace as a big numeral). The active segment is an inverted navy card, and finished segments get a teal check.
    - A target page with a pale yellow TARGET band, "0.3 mi DISTANCE LEFT", a teal progress bar, AVG SPLIT PACE and HEART RATE.
- **Post-run "Review and Save".**
  - A stat row: miles, time, min/mi, calories.
  - "How did this run feel?" with five emoji faces.
  - Name, Category, Add a Picture, "How Did It Go?" notes.
  - Map privacy (Followers), average heart rate, a shoe with a teal wear bar, "I ran with...".
  - A Save pill.
- **Activity Summary.** Time in heart-rate zones as five horizontal bars with %, an elevation area chart in teal, and a pace line chart. Splits, pace and elevation charts are premium ("GO").
- **Training.**
  - "Train for a Race" -> "Half Marathon Plan".
  - The date range sits above a Sun-Sat week strip, with a weather icon and temperature on each training day.
  - "Workouts This Week" rows: day and date plus weather on the left; workout name, distance and pace range on the right; row actions for date and "Set Time".
  - Workout detail:
    - Title, then an Outdoor | Treadmill segmented control.
    - A vertical timeline: WARM UP, then WORKOUT (Tempo and Recovery blocks with an "x4" repeat), then COOL DOWN, each with target pace and distance.
    - A filled "Select Workout" pill and an outline "Mark as Complete" pill.
  - Plan setup asks distance, date, target pace, days per week and which days. Plans run 5-16 weeks.
- **Guided Workouts.** Audio coaching by named coaches (Erin, Corinne, Sean, Jess, Julia) at relative effort, with no paces.
  - Plans: My First 5K, My Fastest 5K and My First 10K, each 6 weeks and 18 workouts.
  - Singles: 5-, 7- and 10-minute runs, speed work, race tune-ups, treadmill runs, Sound Stretch, meditations.
  - Named single workouts on the site include "Tiny Wins" (Coach Jess) and "I Am A Runner". "Surges" shows up as an interval workout.
  - The audio doesn't end the activity.
- **Me.**
  - Avatar with a navy streak pill (flame and count), a semicircular progress gauge, and lifetime totals (activities, hours, mi).
  - Stats with a Days/Weeks/Months/Years segmented control and stacked bars.
  - Metric tiles (Distance, Avg Pace, Activities, Calories) showing Today vs Yesterday with a green trend arrow.
  - Goals: a ring "25 /50", "Total Distance: 25 mi to go", and a Goal Insights projection chart.
  - Shoe tracker, Achievements, and Personal Bests (Rank | Compare; 1M/3M/year/Lifetime).
- **Streaks.** A weekly streak kept alive by one tracked outdoor activity of 15+ minutes (manual entries excluded). The screen shows a hero with a huge week number beside an orange flame ring, current and best streak, and a flame calendar. A new Active Days goal counts one activity per day.
- **Challenges.** Monthly distance challenges, a participant count, invite friends, and a History page.

## A3. Merged design language for Qala

**Take from Runkeeper:**
- **Huge tabular numerals in navy ink.** The live-run stack and the lift logger's weight x reps both read at arm's length.
- **Navy as display ink.** It goes on headings and big numbers only. Body text stays Beamer's near-black.
- **A pill primary CTA for the one action on a screen.** Start, Log set, Save. Everything else stays a 4px Beamer button.
- **Italic heavy display headlines.** Screen titles and section heads on the phone.
- **The screen structure.** Page dots on the live screen, the week strip, the segment timeline for intervals and for supersets/circuits, the "How did this feel?" row (it maps onto our sRPE and performance taps), and the streak hero.
- **Data colours.** A periwinkle route/series blue and a teal progress colour. These are data colours, not accents.
- **Whitespace.** Hairline dividers between stacked numerals instead of boxes.

**Keep from Beamer:**
- The off-white `#f5f5f7` ground with white surfaces.
- Flat cards with 2px tinted borders and hard offset shadows (no blur). The shadow moves from accent-tinted to navy-tinted.
- Recursive for UI and DM Mono for tables, set logs and small numbers.
- Radii of 4/6/8px on everything except the pill CTA.
- The CTA press behaviour: shadow disappears and the element shifts 1px/2px.

**Accent recommendation: keep ember `#C2410C` as the single action accent. Add Runkeeper's navy as display ink and periwinkle/teal as data colours. PLAN.md's "ember accent" line stands; the Look row gains navy ink, the pill CTA and full-axis Recursive.**

Reasons:
1. **Contrast doesn't decide it.** White on ember is 5.18:1 and white on `#485CC7` is 5.78:1. Both pass AA for 14px bold and larger.
2. **Switching to indigo-blue loses Qala's identity twice.** Beamer's accent is indigo `#4B0082`, so Qala would read as a Beamer skin. Runkeeper's CTA blue is the most recognisable single thing to copy from it, so Qala would also read as a Runkeeper clone.
3. **Orange on navy is already inside Runkeeper's own system.** The streak flame ring is `#EC8034` on `#001C60`, and zone 5 is `#E04F39`. An ember pill with a navy hard shadow under navy numerals reads as the same family without borrowing their CTA.
4. **Split accents make the app feel like two apps.** One colour for lifting and another for running doubles the token surface, and users stop knowing what "the button colour" means. Running gets its identity from the route-blue map line, the teal progress bars and the big numerals, which is where Runkeeper's look actually lives.

## A4. Heavy italic display face from Recursive (no new family, but a new file)

Beamer's `assets/fonts/Recursive-Variable.woff2` (56 KB) is a subset with **only the `wght` axis (300-1000)**. I checked it with fontTools: there's no `slnt`, `CASL`, `CRSV` or `MONO`. With that file a browser can only fake the italic by skewing the glyphs.

The full Recursive (OFL 1.1, github.com/arrowtype/recursive, release v1.085) has five axes: `MONO 0..1`, `CASL 0..1`, `wght 300..1000`, `slnt -15..0` and `CRSV 0..1` (default 0.5). Google Fonts' Latin woff2 with all five axes is 305 KB.

Recommended build: pin `CASL=0` and `CRSV=0` and keep `wght`, `slnt` and `MONO`. That came to 146 KB as woff2 when I ran `fontTools.varLib.instancer` on the Google Latin subset. Pinning `MONO=0` as well gives 114 KB, but then the hero numerals below need DM Mono.

```
fonttools varLib.instancer Recursive_VF_1.085.ttf CASL=0 CRSV=0 -o Recursive-qala.ttf
pyftsubset Recursive-qala.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215" --layout-features='*' --flavor=woff2 --output-file=Recursive-qala.woff2
```

```css
@font-face {
  font-family: "Recursive";
  src: url("fonts/Recursive-qala.woff2") format("woff2");
  font-weight: 300 1000;
  font-style: oblique 0deg 15deg;   /* lets font-style: oblique 15deg drive slnt -15 */
  font-display: swap;
}
.display {                        /* echoes the 700-italic ASICS headline */
  font-family: var(--font-ui);
  font-weight: 900;
  font-style: oblique 15deg;      /* slnt -15 */
  font-variation-settings: "MONO" 0;
  line-height: 1.0;
  letter-spacing: 0.003em;        /* Runkeeper: 0.25px at 90px */
  color: var(--ink-display);
}
.num-hero {                       /* live-run and logger hero numerals */
  font-family: var(--font-ui);
  font-weight: 800;
  font-style: normal;
  font-variation-settings: "MONO" 1;
  line-height: 1.0;
  color: var(--ink-display);
}
```

Why these values:
- **`CRSV 0`.** Past `slnt -14` Recursive switches to cursive letterforms automatically (single-storey a and g) unless CRSV is pinned to 0. Cursive reads as script, not as a sporty grotesk oblique. Pinning it in the file makes the behaviour independent of CSS.
- **`CASL 0`.** "Linear" is the closest match to a grotesk. CASL toward 1 is the Beamer-playful end and doesn't suit a headline.
- **`wght 900`.** It matches the visual weight of ASICS 700 at display sizes. 1000 fills counters at 40px and below.
- **`MONO 1` for hero numerals.** DM Mono's heaviest published weight is Medium 500 (the family is 300/400/500, and Beamer bundles 400 and 500). That looks thin at 100px next to Runkeeper's bold numerals. Recursive's digits are already tabular (600 units in every instance I measured). The colon and period, though, are 350 units at `MONO 0` and 600 at `MONO 1`. With `MONO 1`, "9:59" -> "10:00" doesn't jitter.
- **DM Mono stays** for set tables, history rows, charts and anything at 11-17px.
- **`font-variation-settings` doesn't merge.** A child that sets it replaces the parent's whole list, so give each class a complete list. Use `font-weight`/`font-style` for wght and slnt so they inherit normally.

## A5. Token set (light and dark)

```css
:root {
  /* Ground (Beamer) */
  --bg: #f5f5f7;
  --bg-surface: #ffffff;
  --bg-hover: #f1f3f9;
  --bg-active: #e8ebf4;
  --bg-recessed: #f1f3f9;

  /* Ink: navy for display, near-black for body */
  --ink-display: #001e62;          /* 14.16 on bg, 15.42 on surface, 12.94 on bg-active */
  --fg: #0f152a;                   /* 16.61 on bg */
  --fg-secondary: #4a5578;         /* 6.74 on bg, 7.34 on surface: small caps labels (TIME, MILES) */
  --fg-muted: #64708b;             /* 4.56 on bg, 4.96 on surface: AA for normal text, just */
  --fg-faint: #94a0b8;             /* 2.42: disabled and decorative only, never readable text */

  /* Structure: navy-tinted instead of accent-tinted */
  --border: rgba(0, 30, 98, 0.12);
  --border-strong: rgba(0, 30, 98, 0.25);

  /* Accent: ember, actions only */
  --accent: #c2410c;               /* as text: 4.76 on bg, 5.18 on surface */
  --accent-hover: #9a3412;         /* white on it 7.31 */
  --on-accent: #ffffff;            /* white on accent 5.18 */
  --accent-subtle: rgba(194, 65, 12, 0.08);  /* accent text on it (over white) 4.62; use --accent-hover for 6.52 */
  --accent-wash: rgba(194, 65, 12, 0.04);

  /* Data colours (charts, maps, progress); never button fills */
  --run-route: #485cc7;            /* 5.31 on bg; line gets a 2px white casing on maps */
  --run-route-casing: #ffffff;
  --progress: #0a8078;             /* lines and text: 4.80 on white */
  --progress-fill: #08a49c;        /* bars and rings, non-text: 3.09 on white */
  --series-2: #3a4a9f;
  --zone-1: #3a4a9f;
  --zone-2: #08a49c;
  --zone-3: #e5c73a;               /* about 1.7 on white: non-text bar fill only, always next to a text label */
  --zone-4: #fb923c;               /* non-text fill, same rule */
  --zone-5: #c2410c;               /* top zone shares ember */
  --target-band: #faf8dd;
  --streak: #ea7a2e;
  --streak-wash: #fcecdc;

  /* Status */
  --danger: #b91c1c;               /* 5.94 on bg (Beamer's #dc2626 is 4.44, fails for small text) */
  --danger-subtle: rgba(185, 28, 28, 0.06);
  --success: #15803d;              /* 4.61 on bg (#16a34a is 3.03, fails) */

  /* Radii (Beamer) plus pill */
  --radius: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-pill: 999px;

  /* Hard offset shadows, zero blur (Beamer), navy-tinted */
  --shadow-card: 2px 4px 0 0 rgba(0, 30, 98, 0.12);
  --shadow-cta: 2px 4px 0 0 #001e62;
  --shadow-modal: 4px 8px 0 0 rgba(0, 30, 98, 0.15), 0 0 0 2px var(--border);

  /* Type */
  --font-ui: "Recursive", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-num: "DM Mono", "Cascadia Code", ui-monospace, monospace;
  --num-hero: clamp(72px, 26vw, 112px);   /* live distance, logger weight */
  --num-xl: clamp(48px, 16vw, 72px);      /* live time */
  --num-lg: 40px;                          /* pace pair, reps */
  --display-1: clamp(32px, 9vw, 44px);
  --display-2: 24px;
  --label-caps: 12px;                      /* weight 600, letter-spacing 0.06em, uppercase, --fg-secondary */

  /* Motion (Beamer) */
  --duration-fast: 150ms;
  --duration: 200ms;
  --ease: cubic-bezier(0.25, 1, 0.5, 1);
}

/* The dark token list below must appear twice: once under :root[data-theme="dark"]
   and once inside @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }.
   Plain CSS can't share one declaration block between a media query and an attribute
   selector, so either duplicate it or generate both from one list at build time. */
:root[data-theme="dark"] {
  --bg: #0b1020;
  --bg-surface: #121a33;
  --bg-hover: #171f3a;
  --bg-active: #1d2647;
  --bg-recessed: #0f1529;

  --ink-display: #e8ecf6;          /* 16.01 on bg, 14.54 on surface, 12.50 on bg-active */
  --fg: #e8ecf6;
  --fg-secondary: #aab4cc;         /* 9.11 on bg, 8.28 on surface */
  --fg-muted: #8a93ab;             /* 6.17 on bg, 5.60 on surface */
  --fg-faint: #5a6480;             /* decorative only */

  --border: rgba(232, 236, 246, 0.12);
  --border-strong: rgba(232, 236, 246, 0.24);

  --accent: #fb923c;               /* 8.37 on bg, 7.60 on surface */
  --accent-hover: #fdba74;
  --on-accent: #0b1020;            /* dark text on accent 8.37; on hover 11.23. White on #fb923c is 2.26: never */
  --accent-subtle: rgba(251, 146, 60, 0.12);  /* accent text on it over surface 6.32 */
  --accent-wash: rgba(251, 146, 60, 0.06);

  --run-route: #8e9cf0;            /* 7.36 on bg, 6.68 on surface */
  --run-route-casing: #0b1020;
  --progress: #2dd4bf;             /* 9.24 on surface */
  --progress-fill: #2dd4bf;
  --series-2: #9aa6f5;
  --zone-1: #7b8ef0;
  --zone-2: #2dd4bf;
  --zone-3: #facc15;
  --zone-4: #fdba74;
  --zone-5: #fb923c;
  --target-band: #2a2a1c;
  --streak: #fb923c;
  --streak-wash: #2e2834;

  --danger: #f87171;               /* 6.22 on surface */
  --danger-subtle: rgba(248, 113, 113, 0.10);
  --success: #4ade80;              /* 9.87 on surface */

  /* A dark offset shadow disappears on a dark ground (#000 vs bg is 1.11), so use a lit navy edge */
  --shadow-card: 2px 4px 0 0 #2a3566;                  /* 1.62 vs bg, about as quiet as the light card shadow */
  --shadow-cta: 2px 4px 0 0 #3b4a8a;                   /* 2.28 vs bg */
  --shadow-modal: 4px 8px 0 0 #3b4a8a, 0 0 0 2px var(--border);
}
```

Contrast notes. All values are WCAG 2.x relative-luminance ratios, computed in Python.
- Every readable text token clears 4.5:1 on both grounds in both themes. The exception is `--fg-faint`, which is 2.42 in light and is marked decorative.
- Beamer's own `--fg-muted #94a0b8` is 2.42 on `#f5f5f7`. Qala renames it `--fg-faint` and stops using it for text.
- Beamer's `--danger #DC2626` (4.44) and `--success #16A34A` (3.03) fail for body-size text on the off-white, so both get darkened.
- Dark CTA text has to be dark: white on `#fb923c` is 2.26 and on `#f97316` is 2.80.
- `--run-route` as a map line needs 3:1 against the tiles. `#485CC7` is 5.04 on a typical `#f2efe9` map ground. The white casing covers dark or satellite tiles.

**Component rules the tokens assume:**
- **Pill CTA.** `--radius-pill`, 52px tall on the phone, Recursive 700 at 17-18px, `--accent` fill, `--on-accent` text, `--shadow-cta`. On `:active`, drop the shadow and `translate(1px, 2px)`, same as Beamer. Use at most one per screen.
- **Secondary pill.** Surface fill, 2px `--accent` border, accent text. It's for "Mark as Complete"-style alternates.
- **Cards.** Beamer as is: 2px `--border`, `--radius-md`, `--shadow-card` on hover (desktop) or always (phone lists).
- **Live screen.**
  - No cards. The stack is `--num-xl` time, `--num-hero` distance, and a two-column `--num-lg` current pace | avg pace, with 1px `--border` dividers.
  - Labels are `--label-caps`.
  - Page dots use `--ink-display` (active) and `--fg-faint` (inactive).
  - Bottom bar: an icon button, then a 72px `--accent` circle for pause/resume with `--shadow-cta`, then an icon button.
- **Lift logger.** The same stack idea: `--num-hero` weight, `--num-lg` reps and RPE, DM Mono for the set table under it.
- **Headings.** `.display` for screen titles on the phone. Desktop panel titles stay Beamer's DM Mono 17px.

**IA for Qala's phone shell**, adapted and not copied. It uses four tabs because a self-hosted app for a few users doesn't need Community or Challenges:
- **Me.** Streak hero (weekly: at least one logged session, lift or run), e1RM trends, weekly sets per muscle vs target, goals.
- **Training.** Week strip with each day's session (lift day name or run workout; weather optional later), today's session card, check-in entry.
- **Start.** Run start: map, GPS chip, 2x2 card (Activity, Workout, Audio cues, Music), pill Start. The lift "Start session" also lives here as a segmented toggle.
- **History.** Session list, run summaries with splits.

Settings sit behind a gear, as in Runkeeper. The lift post-session sheet borrows "Review and Save": sRPE as a 0-10 row, the per-muscle performance taps, notes, Save pill.

---

# Part B: Programming approaches for the generator

## B1. Evidence on periodization models

- **Rhea et al. 2002** (JSCR 16:250; PMID 11991778).
  - Design: 20 recreationally trained men, 12 weeks, 3 sets of bench and leg press 3 days a week.
  - LP ran 8RM for weeks 1-4, 6RM for weeks 5-8 and 4RM for weeks 9-12. DUP ran 8RM Monday, 6RM Wednesday, 4RM Friday.
  - Bench: LP +14.4%, DUP +28.8%. Leg press: LP +25.6%, DUP +55.8%.
  - Small, short, and novice-leaning, but it started the DUP literature.
- **Zourdos et al. 2016** (JSCR 30:784; doi:10.1519/JSC.0000000000001165).
  - 18 college powerlifters, 6 weeks, DUP ordered either hypertrophy-power-strength (HPS) or hypertrophy-strength-power (HSP).
  - HPS gained more on bench (+8.1% vs +2.7%) and squat (+10.5% vs +7.9%); effect sizes above 0.5 favoured HPS. Total: +8.7% vs +6.7%.
  - HPS also lifted more squat and bench volume, probably because the power day sits between the hypertrophy and strength days as a lighter recovery day.
  - The protocol is in B3.
- **Harries, Lubans, Callister 2015** (JSCR 29:1113; doi:10.1519/JSC.0000000000000712). 17 studies, 510 participants. No LP vs UP difference for upper- or lower-body 1RM: bench p=0.37, leg press p=0.07, squat p=0.72.
- **Williams et al. 2017** (Sports Med 47:2083; doi:10.1007/s40279-017-0734-y).
  - Periodized beat non-periodized for 1RM, ES 0.43 (0.27-0.58). After removing outliers it was 0.23, and there's evidence of publication bias.
  - Meta-regression found UP did better than LP (b=0.51, p=0.001), untrained lifters gained more, and longer studies and higher frequency helped.
- **Moesgaard et al. 2022** (Sports Med 52:1647; doi:10.1007/s40279-021-01636-1). 35 volume-equated studies.
  - Periodized vs non-periodized: 1RM ES 0.31, hypertrophy ES 0.13 (not significant).
  - **UP vs LP: 1RM ES 0.31 overall, 0.61 in trained lifters, 0.06 in untrained. Hypertrophy ES 0.05, no difference.**
- **Block periodization.**
  - Painter et al. 2012 (IJSPP 7:161; doi:10.1123/ijspp.7.2.161): no significant group differences in D-I track athletes, with trends toward block and better strength per unit of volume load.
  - Painter 2018 follow-up (Sports 6:3): DUP did 60% more volume load for similar isometric gains.
  - Bartolomei et al. 2014 (JSCR 28:990): block had a 79.8% likelihood of a better force-power curve in trained men; lower body was unchanged.
  - Issurin 2010 (Sports Med 40:189) is conceptual: accumulation, transmutation and realization blocks with concentrated loads. The evidence is thin and mostly from athletes, not lifters.

**Generator rule that follows:**
- **Novice.** Linear. Moesgaard's untrained ES is 0.06, so there's no benefit from the extra complexity.
- **Intermediate or advanced, strength goal.** DUP in HPS order (trained ES 0.61; Zourdos order effect).
- **Meet prep.** A block structure (accumulation -> intensification -> realization/taper) with DUP inside the accumulation and intensification blocks.
- **Hypertrophy goal.** Periodization model doesn't matter for muscle growth (ES 0.05-0.13), so vary rep ranges for joint comfort and interest, and put the engineering effort into volume and proximity to failure.

## B2. Intensity, reps and RPE tables

**RTS/Tuchscherer %1RM by reps and RPE (strength range).**
- The RPE 10 row for 1-10 reps is 100, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, and the RPE 9.5 row starts 97.8, 93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1.
- Each full RPE point shifts one column (x reps @ RPE r = x+1 reps @ RPE r+1), and each half point uses the 9.5 row the same way.
- The rows come from a vbtcoach reproduction and are **unverified against RTS's original**. Helms 2016 (Strength Cond J 38(4):42) credits the RTS manual as the origin of the RIR-based RPE scale, and its "83% is about a 6RM" matches 6@10 = 83.7.

| RPE \ reps | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 10 | 100 | 95.5 | 92.2 | 89.2 | 86.3 | 83.7 |
| 9.5 | 97.8 | 93.9 | 90.7 | 87.8 | 85.0 | 82.4 |
| 9 | 95.5 | 92.2 | 89.2 | 86.3 | 83.7 | 81.1 |
| 8.5 | 93.9 | 90.7 | 87.8 | 85.0 | 82.4 | 79.9 |
| 8 | 92.2 | 89.2 | 86.3 | 83.7 | 81.1 | 78.6 |
| 7.5 | 90.7 | 87.8 | 85.0 | 82.4 | 79.9 | 77.4 |
| 7 | 89.2 | 86.3 | 83.7 | 81.1 | 78.6 | 76.2 |
| 6.5 | 87.8 | 85.0 | 82.4 | 79.9 | 77.4 | 75.1 |
| 6 | 86.3 | 83.7 | 81.1 | 78.6 | 76.2 | 73.9 |

The owner's strength band of 1-6 reps at 80-95% corresponds to roughly RPE 7-9 in this table.

**RIR scale** (Zourdos 2016, JSCR 30:267): RPE 10 = 0 RIR, 9 = 1, 8 = 2, 7 = 3. PLAN.md already treats reported RIR above 3 as unreliable.

**NSCA training load chart** (adapted from Landers 1984), %1RM for an n-rep max: 1 = 100, 2 = 95, 3 = 93, 4 = 90, 5 = 87, 6 = 85, 7 = 83, 8 = 80, 9 = 77, 10 = 75, 12 = 70.

**Hypertrophy loads (8-15 reps).** The RTS table as reproduced stops at 10 reps. Use the inverse Epley on the effective max, with "reps + RIR" as the effective max:

`pct(reps, RIR) = 100 / (1 + (reps + RIR) / 30)`

This matches the NSCA chart within 1.5 points at 8, 10 and 12RM (78.9 vs 80, 75.0 vs 75, 71.4 vs 70). It's less validated past about 12 (see B7), so treat it as the first-session guess and let double progression correct it.

| Reps \ RIR | 3 | 2 | 1 | 0 |
|---|---|---|---|---|
| 8 | 73.2 | 75.0 | 76.9 | 78.9 |
| 10 | 69.8 | 71.4 | 73.2 | 75.0 |
| 12 | 66.7 | 68.2 | 69.8 | 71.4 |
| 15 | 62.5 | 63.8 | 65.2 | 66.7 |

The owner's band of 8-15 reps at 60-80% maps to RIR 0-3.

**Load range equivalence for hypertrophy.**
- Schoenfeld, Grgic, Ogborn, Krieger 2017 (JSCR 31:3508): with all sets to failure, low load (60% or less) vs high load (above 60%) grew muscle equally (ES 0.03, p=0.56). 1RM favoured heavy loads (ES 0.58).
- Lopez et al. 2021 (MSSE 53:1206), network meta-analysis: no hypertrophy difference across more than 15RM, 9-15RM and 8RM or less. Strength ranked high > moderate > low (high vs low SMD about 0.6).
- Schoenfeld, Grgic, Van Every, Plotkin 2021 (Sports 9:32) is a narrative "repetition continuum" re-examination: growth happens across a wide load range, and strength is load-specific.
- Refalo 2023 (Sports Med 53:649): failure vs non-failure for hypertrophy ES 0.19 (0.00-0.37).
- Robinson 2024 (Sports Med 54:2209): hypertrophy increases closer to failure, strength doesn't (exploratory).

So for hypertrophy the owner's 8-15 rep band is a comfort and efficiency choice, not a requirement. Proximity to failure (RIR 0-3) matters more than %1RM.

**Prilepin's chart.**
- **Origin.** Alexander Prilepin, a Soviet weightlifting coach, built it from the training logs of weightlifters. It reached English through Laputin and Oleshko, *Managing the Training of Weightlifters* (1982 translation).
- **The table.** This is the common reproduction; it's **unverified against the book**, and the "1974" date and sample size claims are also unverified.

  | Zone %1RM | Reps per set | Total reps range | Optimal total |
  |---|---|---|---|
  | 55-65 | 3-6 | 18-30 | 24 |
  | 70-80 | 3-6 | 12-24 | 18 |
  | 80-90 | 2-4 | 10-20 | 15 |
  | 90+ | 1-2 | 4-10 | 7 |

- **Caveats.** It comes from Olympic lifters doing short, technical lifts, and it's observational. The only test I found is a 2016 NSCA poster by Pritchard et al., which saw good 4-week gains using it in 9 trained men.
- **Use in Qala.** A per-session, per-lift sanity check for sets at 80% and above. Warn when the session's reps in a zone exceed the range's high end. Don't use it on hypertrophy days.

## B3. Powerlifting / strength templates

All loads are %1RM of the block's reference 1RM (B6). Main lifts are squat, bench and deadlift; overhead press follows bench's pattern with ~2/3 of the sets. RPE in parentheses comes from the B2 table for the first set; later sets drift up about 0.5.

### B3.1 Linear (novice; 5 weeks + deload)

| Week | Squat / Bench | Deadlift | NL at >=85% per lift | Prilepin zone check |
|---|---|---|---|---|
| 1 | 4x5 @ 80% (RPE ~7.5) | 3x5 @ 80% | 0 | 20 reps in 80-90: top of range |
| 2 | 4x4 @ 83% (RPE 8) | 3x4 @ 83% | 0 | 16 |
| 3 | 5x3 @ 86% (RPE 8) | 3x3 @ 86% | 15 (DL 9) | 15, optimal |
| 4 | 5x2 @ 89% (RPE 8) | 3x2 @ 89% | 10 (DL 6) | 10 |
| 5 | 1x1 @ 95% (RPE 9) + 5x1 @ 92% (RPE 8) | 1x1 @ 95% + 2x1 @ 92% | 6 (DL 3) | 6 in 90+: optimal is 7 |
| 6 deload | 3x3 @ 75% | 2x3 @ 70% | 0 | |

- **Variations** (pause squat, close-grip bench, RDL): 3x6 @ RPE 7 in weeks 1-2, 3x5 @ RPE 7.5 in weeks 3-4, dropped in week 5.
- **Accessories:** 2-3 exercises, 3x8-12 @ RPE 8, using the hypertrophy rules at maintenance volume.
- **Next block:** the reference 1RM becomes the week 5 e1RM (B6), capped at +5% lower body and +2.5% upper body per block. A novice who misses reps in week 4 or 5 repeats the block at the same reference.

### B3.2 DUP, HPS order (intermediate and advanced; 5 weeks + deload)

Zourdos 2016, as run (squat and bench three times a week; deadlift on the strength day only). Read from the 2012 dissertation, Table 5:

| Week | Hypertrophy (Mon) | Power (Wed) | Strength (Fri) |
|---|---|---|---|
| 1 | 5x8 @ 75% | 5x1 @ 80% | 3 x max reps @ 85% |
| 2 | 5x8, load adjusted | 5x1 @ 80% | 3 x max @ 87.5% |
| 3-4 | 4x8, adjusted | 4x1 @ 85% | 3 x max @ 90% |
| 5 | 3x8, adjusted | 3x1 @ 90% | 3 x max @ 92.5% |
| 6 | 3x8, adjusted | 3x1 @ 90% | 3 x max @ 95% |

Sets to failure at 85-95% aren't something to generate for unsupervised users, so Qala caps the strength day with RPE instead of max reps:

| Week | H day: squat / bench | P day: squat / bench (move fast) | S day: squat / bench / deadlift | NL at >=85% (squat or bench) |
|---|---|---|---|---|
| 1 | 4x8 @ 72.5% (RIR 3) | 5x2 @ 80% (RPE <6) | 3x5 @ 82%, last set AMRAP capped at RPE 9 | 0 |
| 2 | 4x8 @ 75% (RIR 2) | 5x2 @ 82% | 3x4 @ 85% (RPE 8.5) | 12 |
| 3 | 4x7 @ 77% (RIR 2) | 5x1 @ 85% (RPE ~6) | 3x3 @ 88% (RPE 8.5) | 14 |
| 4 | 3x6 @ 79% (RIR 2) | 4x1 @ 88% (RPE 6.5) | 3x2 @ 91% (RPE 8.5-9) | 10 |
| 5 | 3x6 @ 80% (RIR 1-2) | 3x1 @ 90% (RPE 7) | 1x1 @ 95% (RPE 9) + 2x2 @ 87% | 8 |
| 6 deload | 2x8 @ 65% | 3x1 @ 75% | 2x3 @ 80% | 0 |

- **Deadlift:** S day only, plus one variation (RDL or deficit) on the H day at 3x6 @ RPE 7.
- **Autoregulation:** if the S-day top set comes in more than 0.5 RPE off target, adjust the next S day by 2% per 0.5 RPE (PLAN.md 6.3, Helms 2018). Helms 2018 (Front Physiol 9:247) found RPE-based loading at least as good as fixed percentages in trained men (squat ES 0.50 favouring RPE, not significant).
- **Alternative DUP (5s/3s/1s),** for users who want heavier weekly exposure:

  | Day | Scheme | Weekly change |
  |---|---|---|
  | A | 4x5 @ 80% | +2% per week |
  | B | 5x3 @ 85% | +2% per week |
  | C | 6x1 @ 90% | +2% per week; week 4 is 3 singles @ 95% |

  - Zone totals: A 20, B 15, C 6, all inside Prilepin.
  - NL at >=85% is about 21 per lift per week.

**Minimum effective strength dose.** Androulakis-Korakakis et al. 2021 (Front Sports Act Living 3:713655) put the floor for trained powerlifters at about 3-6 working sets of 1-5 reps per lift per week above 80%, at RPE 7.5-9.5, over 1-3 sessions. The generator never plans a main lift below that outside a deload.

**Volume per muscle in a strength block.** Pelland et al. 2026 (below) shows 1RM gains flatten beyond about 5 fractional sets per muscle per week. Strength blocks therefore use MEV to about 10 fractional sets per muscle and spend the time budget on intensity and main-lift practice. Growth muscles marked "emphasise" can still get hypertrophy accessories.

### B3.3 Meet prep (block + taper to a date)

Evidence on the taper:
- **Pritchard et al. 2016** (JSCR 30:1796), elite NZ raw powerlifters (n=11):
  - Volume peaked 5.2 +/- 1.7 weeks out; intensity peaked 1.9 +/- 0.8 weeks out.
  - The taper cut volume 58.9 +/- 8.4% with intensity kept or slightly reduced.
  - The last session was 3.7 +/- 1.6 days out, and accessories were dropped about 2 weeks out.
- **Pritchard et al. 2018** (JSCR 32:458): 3.5 vs 5.5 days of training cessation made no difference.
- **Pritchard et al. 2019** (IJSPP 14:458): with about 70% volume cuts, +5.9% vs -8.5% taper intensity showed no significant difference, and the higher intensity trended better.
- **Travis et al. 2020 review** (Sports 8:125):
  - Cut volume about 30-70%. Cuts of 30-50% looked better than cuts above 50%, and cuts of 25% or less were too small.
  - Keep intensity at or above 85%, or reduce it.
  - Use a step or exponential taper over 1-2 weeks.
  - Finish with 2-7 days of complete rest. Cessation of 7 days or less maintained or improved strength; 14 days lost 0.9% (squat) and 1.7% (bench).
- **Travis et al. 2021 survey** (JSCR 35 Suppl 2:S26), 364 raw lifters:
  - A step taper of 7-10 days with volume cut 41-50%.
  - Highest volume 5-8 weeks out; highest intensity 2 weeks out.
  - Last heavy session (above 85%): squat and deadlift 7-10 days out, bench under 7.
  - Final heavy lifts at 90-92.5%. The final session is 75-80% (deadlift 70-75%).
  - Last session by lift: deadlift 5.8 +/- 2.5 days out, squat 4.1 +/- 1.9, bench 3.9 +/- 1.8. Full rest 2.8 +/- 1.1 days.
- **Grgic & Mikulic 2017** (JSCR 31:2371): volume -50.5%, intensity peaking 8 +/- 3 days out, last session 3 +/- 1 days out.
- **Winwood et al. 2026 systematic review** (Sports Med, doi:10.1007/s40279-026-02500-w):
  - Tapers of 5-9 days (longer in powerlifting), volume cut about 40-45%, cessation 1.5-4 days.
  - Peak volume 4-6 weeks out, peak intensity 2-3 weeks out.
  - Last deadlift 6-8 days out, squat 5-6.5, bench 3-5.
- **Bosquet 2007** (MSSE 39:1358) is endurance-dominated: a 2-week taper with an exponential 41-60% volume cut and intensity and frequency kept.

**Generator parameters for meet prep** (12-week example; shorter preps compress the accumulation block):

| Weeks out | Block | Content |
|---|---|---|
| 12-7 | Accumulation | DUP HPS (B3.2 weeks 1-3 loads). Volume ramps to its peak in weeks 6-5 out. Accessories at hypertrophy maintenance. Deload at week 7 out if the block has run 5+ weeks |
| 6-3 | Intensification | DUP weeks 3-5 loads. NL at >=85% rises. Variations become competition-specific (pause bench, competition stance) |
| 2 | Peak intensity | Heavy singles: squat and bench top single @ 92-95% (RPE 9), deadlift @ 90-92.5%. About 25% less volume than week 3 out. Accessories dropped |
| Final 7-10 days | Taper (step) | Volume -40 to -50% of the pre-taper week, intensity >= 85% until the last heavy session |

Last-session timing, counted back from meet day:

| Lift | Last heavy session (openers, 90-92.5%) | Last session of any kind | Final session load |
|---|---|---|---|
| Deadlift | 8-10 days | 6 days | 70-75% |
| Squat | 7-9 days | 4-5 days | 75-80% |
| Bench | 5-7 days | 3-4 days | 75-80% |

- Complete rest for the final 2-3 days.
- The typical final-session schemes in Travis 2021 are squat 3x2, bench 3x3, deadlift 3x1.

PLAN.md section 12 currently says "deadlift 7-10 d, squat 4-7 d, bench 2-4 d before the date". That mixes last heavy session with last session. Replace it with the table above.

## B4. Hypertrophy / bodybuilding

**Evidence on volume:**
- **Schoenfeld, Ogborn, Krieger 2017** (J Sports Sci 35:1073; doi:10.1080/02640414.2016.1210197).
  - Each extra weekly set gave ES +0.023, about +0.37% growth.
  - By weekly sets: under 5 sets ES 0.31 (5.4%); 5-9 sets ES 0.38 (6.6%); 10+ sets ES 0.52 (9.8%).
  - The trend across the three categories was p=0.074. Without the Radaelli study it drops to +0.25% per set.
- **Pelland et al. 2026** (Sports Med 56:481; doi:10.1007/s40279-025-02344-w; SportRxiv preprint 2024). 67 studies, 2058 participants.
  - Set counting: **fractional sets** (direct = 1, indirect = 0.5) beat both direct-only and total counting by Bayes factor.
  - Hypertrophy follows a square-root curve at +0.24% per fractional set. The minimum effective dose is about 4 sets per week.
  - Diminishing returns: each further detectable gain (2.05%) costs about 6 more sets in the 5-10 range, about 8.5 in 11-18, about 10.75 in 19-29, and about 12.5 in 30-42.
  - Strength plateaus functionally beyond about 5 fractional sets per week.
  - Frequency barely affects hypertrophy (P 91%, possibly negligible) but clearly helps strength.
- **Baz-Valle et al. 2022** (J Hum Kinet 81:199; doi:10.2478/hukin-2022-0017). Trained men: 12-20 vs more than 20 sets per week showed no clear difference for quads or biceps; triceps favoured higher volume. Recommends 12-20 sets per muscle per week.

**Reconciling the owner's 10-20 sets/week with RP's landmarks.**

The two numbers count different things. The RP table in PLAN.md (e.g. chest MEV 4-6, MRV 16-24) comes from RP's practitioner articles (the chest numbers match RP's "Complete Chest Training Guide", 2024), not from a meta-analysis. RP counts **direct** sets and assumes intermediate lifters. It keeps some landmarks low because compound work already hits those muscles, and hamstrings, triceps and quads are low for exactly that reason. The 10-20 band comes from studies counting sets per muscle. Pelland shows the evidence fits best when indirect work counts as half. So the generator tracks two numbers per muscle per week:

- `D_m` = direct hard sets (exercise lists the muscle as a target).
- `F_m` = `D_m` + 0.5 x indirect hard sets (muscle is a synergist). This is the same weighting PLAN.md 6.2 already uses for fatigue input.

Rules:
1. **The owner's band constrains `F_m`.** Grow: `F_m` in [10, 20]. Emphasise: [14, 20]. Maintain: `D_m` in [MV_hi, MEV_hi], with no F floor.
2. **RP landmarks constrain `D_m`.** `D_m` >= MEV_lo when the muscle is trained at all, and `D_m` <= MRV_lo.
3. **Start of block:** `F_start = max(band_lo, MEV_hi + indirect credit)`.
4. **Ramp:** +2 F per week (RP example 12 -> 14 -> 16 -> 18 -> 20). The engine's per-muscle rule (PLAN.md 6.3: +2 / +1 / hold / reactive deload) can slow or hold it but can't push past the caps.
5. **Conflicts.** The RP ceiling wins over the owner's floor, because it's a recovery guard. The owner's ceiling of 20 wins over RP's MAV and MRV, because evidence above 20 is thin (Baz-Valle, with triceps as the exception) and Pelland's returns keep diminishing.
   - Hamstrings: MRV_lo is 8 direct, so F can reach 10 only with hinge and squat credit. If it can't, plan fewer and log reason code `VOLUME_CAPPED_BY_MRV`.
   - Back: MEV_lo is 12, so it starts at 14, not 10.
6. **Deload week:** `F` x 0.5, RIR 4, load -10%. This matches PLAN.md's Bell 2023 deload.

Worked examples (grow priority, 5 weeks plus deload):

| Muscle | RP MEV / MRV (direct) | F per week 1-5 | D cap | Deload F |
|---|---|---|---|---|
| Chest | 4-6 / 16-24 | 10, 12, 14, 16, 18 | 16 | 9 |
| Back | 12-14 / 22-30 | 14, 16, 18, 20, 20 | 22 | 10 |
| Quads | 4-6 / 14-18 | 10, 12, 14, 16, 16 | 14 | 8 |
| Hamstrings | 2-4 / 8-14 | 10, 10, 11, 12, 12 (with hinge credit) | 8 | 6 |
| Side delts | 6-8 / 24-30 | 10, 12, 14, 16, 18 | 24 | 9 |

**Per-week hypertrophy parameters** (loads from the B2 inverse-Epley table):

| Week | F target | RIR (RPE) compound | RIR (RPE) isolation | Compound reps (~%1RM) | Isolation reps (~%1RM) |
|---|---|---|---|---|---|
| 1 | start (10-14) | 3 (7) | 3 (7) | 8-12 (67-73%) | 12-15 (62-67%) |
| 2 | +2 | 2-3 (7.5) | 2 (8) | 8-12 (68-75%) | 12-15 (64-68%) |
| 3 | +2 | 2 (8) | 1-2 (8.5) | 8-12 (68-75%) | 12-15 (64-70%) |
| 4 | +2 | 1-2 (8.5) | 1 (9) | 8-12 (69-77%) | 12-15 (65-70%) |
| 5 | +2, capped | 1 (9) | 0-1 (9-10) | 8-12 (70-77%) | 12-15 (65-71%) |
| 6 deload | x0.5 | 4 (6) | 4 (6) | same reps, load -10% | same |

This replaces PLAN.md section 12's "hypertrophy 6-12 and 12-20 for isolation" with the owner's 8-15. Compounds use 8-12 and isolation 12-15. Heavy compounds may drop to 6-8 in an emphasise block; Lopez 2021 says the load range doesn't matter for growth.

**Load progression** follows PLAN.md 6.3 (double progression): when every work set hits the top of the rep range at or below target RPE on two consecutive exposures, add +2.5% or one plate step for upper body and +5% for lower body, then drop to the bottom of the range. Isolation exercises that can't move by a 5 lb step add reps up to 15, then 20, before adding load.

## B5. Volume counting rules (both goals)

1. **Work set.** Completed, not marked warm-up. For main lifts, load must also be at least 50% of the reference 1RM.
2. **Hard set (hypertrophy counting).** A work set with logged RPE >= 7 (RIR <= 3). If RPE isn't logged, use the program's target RPE when that is >= 7. Sets further from failure don't count toward `F_m`. That follows PLAN.md's RIR>3 reliability rule and Robinson 2024's proximity finding.
3. **Direct and fractional sets per muscle per week.**
   - `D_m = sum(hard sets where m is a target muscle)`.
   - `F_m = D_m + 0.5 x sum(hard sets where m is a synergist)`.
   - Weeks run Monday to Sunday in the user's time zone.
4. **Number of lifts (NL) per lift per week.** `NL = sum(reps of work sets)`.
5. **Tonnage (volume load).** Per lift: `T = sum(load x reps)`. Per muscle: `VL_m = sum(load x reps x w)`, with w = 1.0 for target and 0.5 for synergist.
   - Bodyweight movements use `load = bodyweight x factor + added load`. The factors (pull-up 1.0, dip 1.0, push-up 0.65) are assumptions, not sourced.
6. **Intensity zones** by `load / reference 1RM`: below 70, 70-79.9, 80-84.9, 85-89.9, 90+.
   - "Volume at >85%" is reported as `NL85 = reps at >= 85%` and `T85 = tonnage at >= 85%`, plus the counts for 90+.
   - No peer-reviewed paper sets an optimal NL85. Sheiko-style programming, per secondary sources (unverified), counts lifts per zone and adds 80-89% lifts in the competition cycle.
   - Use B3's tables as targets and Prilepin's ranges as per-session warnings.
7. **Average relative intensity.** `ARI = T / NL / reference 1RM`, per lift per week.
8. **Reference 1RM.** The value used to prescribe the block's percentages. It stays fixed for the block, so zone counts don't drift when e1RM moves mid-block, and it updates at block boundaries (B6).

## B6. 1RM and progression metrics, and how to display them

**Formula accuracy.**
- Reynolds et al. 2006 (JSCR 20:584): the load-reps relationship is nonlinear. 5RM predicted best (R² 0.97-0.99), and sets above 10 reps shouldn't go into linear equations.
- Mayhew et al. 2008: Brzycki and Mayhew were within about 0.5 kg when capped at 10 reps, but Brzycki blew up without the cap (+7.2 +/- 23.7 kg).
- LeSuer 1997 (JSCR 11:211, not in PubMed; unverified) reported the equations underpredict squat and bench, and that 10 reps or fewer were accurate.

Factor (1RM / load) by formula, and each formula's error vs the RTS RPE 10 row:

| Reps | Epley `1 + r/30` | Brzycki `1 / (1.0278 - 0.0278 r)` | RTS @10 `100 / pct` | Epley vs RTS | Brzycki vs RTS |
|---|---|---|---|---|---|
| 2 | 1.067 | 1.029 | 1.047 | +1.9% | -1.8% |
| 3 | 1.100 | 1.059 | 1.085 | +1.4% | -2.4% |
| 5 | 1.167 | 1.125 | 1.159 | +0.7% | -2.9% |
| 6 | 1.200 | 1.161 | 1.195 | +0.4% | -2.8% |
| 8 | 1.267 | 1.242 | 1.272 | -0.4% | -2.4% |
| 10 | 1.333 | 1.334 | 1.353 | -1.5% | -1.4% |
| 12 | 1.400 | 1.441 | n/a | | |
| 15 | 1.500 | 1.637 | n/a | | |

Epley tracks the RPE table more closely from 2 to 10 reps. Brzycki runs away above 10.

**Rule for e1RM of a set:**
1. Reps = 1 and RPE >= 9.5, or the set is flagged as a test or competition attempt: e1RM = load, marked as a **tested 1RM**.
2. RPE logged and reps + RIR <= 10: `e1RM = load / RTS_pct(reps, RPE)`. This covers the 1-6 strength range and 8-10 rep sets at RPE 8 and above.
3. RPE not logged and reps <= 10: `e1RM = load x (1 + (reps + RIR_est) / 30)`. `RIR_est` is `10 - target RPE` if the program set one, else 0, which is conservative. Special case: if reps + RIR_est = 1, then e1RM = load. The formula would return 1.033 x load for a true single, which overstates it. Don't fix this by switching to `(reps + RIR - 1) / 30`; that version drifts to about -3.9% against the RTS table at 10 reps.
4. Reps > 10 (most 12-15 rep hypertrophy sets): **no e1RM.** Track rep-range PRs instead.

**PLAN.md 6.2 change.** The Kalman observation currently uses "Epley e1RM of the best completed set". Keep Epley, apply rules 1-4 above, and exclude sets over 10 reps from the observation.

**Strength display (desktop graphs; phone Me tab):**
- **e1RM chart per main lift.**
  - Faint dots are the daily best e1RM.
  - The solid line is the Kalman estimate.
  - Filled diamonds are tested 1RMs, from rule 1 or meet results.
  - A dashed step line shows the reference 1RM per block.
  - Headline number: current e1RM in `--num-lg`, with "+x.x% this block" = `(e1RM_now - e1RM_block_start) / e1RM_block_start`.
- **Weekly volume bars per lift,** stacked by intensity zone (B5.6), with NL85 and T85 above each bar. Tonnage and NL are toggles.
- **Total** = sum of the current e1RM for squat, bench and deadlift, plus the sum of tested 1RMs when all three exist within the same 7 days.

**Hypertrophy display:**
- **Weekly `F_m` per muscle** as bars against the target band (10-20, shaded) with RP's MEV and MRV ticks for direct sets. This is the "sets per muscle vs landmarks" graph PLAN.md section 9 already names.
- **Volume load per muscle** (`VL_m`), weekly, with a 4-week least-squares slope reported as %/week.
- **Reps at load.** Per exercise, reps in the first work set at the most frequently used load, compared with the last exposure at that load: "3x10 @ 135 -> 3x12 @ 135".
- **Rep-range PR table** per exercise: best load for 8, 10, 12 and 15 reps, plus e1RM from sets of 10 reps or fewer.
- **Progressive overload flag.** Green when any of reps at load, top-set load, or `VL_m` (at equal or lower F) rose over the last 2 exposures. Neutral when flat. Amber when all fell across 3 exposures, which feeds the engine's performance-4 path.

## B7. Summary of generator parameters

| Parameter | Strength / powerlifting | Hypertrophy |
|---|---|---|
| Model | Novice: linear. Trained: DUP HPS. Meet: block + DUP + step taper | Any (model doesn't matter for growth); weekly RIR ramp |
| Reps and intensity | 1-6 reps @ 80-95% (RPE 7-9); power day 1-2 @ 80-90% at RPE <= 7 | 8-12 compound, 12-15 isolation, 60-80% (RIR 3 -> 0-1) |
| Weekly volume per muscle | MEV to ~10 F (strength plateaus beyond ~5 F) | F in [10, 20] grow, [14, 20] emphasise; D in [MEV, MRV] |
| Main-lift floor | >= 3-6 sets of 1-5 reps above 80% per lift per week | n/a |
| Block | 5 weeks + deload (PLAN.md 4-6) | 5 weeks + deload |
| Progression | Weekly % steps (B3); S-day RPE autoregulation +/-2% per 0.5 RPE | Double progression; +2 F per week, capped |
| Key metrics | e1RM trend + tested 1RM; NL, T, NL85, T85, ARI per lift | F_m and D_m vs bands; VL_m slope; reps at load; rep PRs |
| Taper | 7-10 day step, volume -40 to -50%, intensity >= 85% to last heavy session; last heavy DL 8-10 d, SQ 7-9 d, BP 5-7 d; last session DL 6, SQ 4-5, BP 3-4; 2-3 d full rest | n/a |

## Sources

Design:
- runkeeper.com/cms/ plus /train/, /race/, /start-running/, and the theme stylesheet `wp-content/themes/runkeeper_theme_2_0/dist/style.css` (fetched 2026-09-13).
- Google Play listing `com.fitnesskeeper.runkeeper.pro` and App Store id300235330 screenshots (version 16.30.1).
- Runkeeper articles: "The Beginner's Guide to Tracking Your First Workout", "Introducing Guided Workouts", "Race Training Plans: Designed for You", "Together, We Run Better" (2025 updates).
- Nikki Chan, "Runkeeper Rebrand" (justchan.co, 2023).
- Kontrapunkt, "The next step for an iconic sports brand".
- Recursive: recursive.design and github.com/arrowtype/recursive (OFL 1.1, v1.085).

Programming (DOIs where they exist):
- Rhea 2002, JSCR 16:250, PMID 11991778.
- Zourdos 2016 DUP, 10.1519/JSC.0000000000001165.
- Zourdos 2016 RIR scale, 10.1519/JSC.0000000000001049.
- Harries 2015, 10.1519/JSC.0000000000000712.
- Williams 2017, 10.1007/s40279-017-0734-y.
- Moesgaard 2022, 10.1007/s40279-021-01636-1.
- Painter 2012, 10.1123/ijspp.7.2.161.
- Painter 2018, 10.3390/sports6010003.
- Bartolomei 2014, 10.1519/JSC.0000000000000366.
- Issurin 2010, 10.2165/11319770-000000000-00000.
- Pritchard 2016, 10.1519/JSC.0000000000001292.
- Pritchard 2018, 10.1519/JSC.0000000000001803.
- Pritchard 2019, 10.1123/ijspp.2018-0489.
- Travis 2020, 10.3390/sports8090125.
- Travis 2021, 10.1519/JSC.0000000000004177.
- Grgic & Mikulic 2017, 10.1519/JSC.0000000000001699.
- Winwood 2018, 10.1519/JSC.0000000000002453.
- Winwood 2026, 10.1007/s40279-026-02500-w.
- Bosquet 2007, 10.1249/mss.0b013e31806010e0.
- Schoenfeld 2017 volume, 10.1080/02640414.2016.1210197.
- Pelland 2026, 10.1007/s40279-025-02344-w.
- Baz-Valle 2022, 10.2478/hukin-2022-0017.
- Schoenfeld 2017 load, 10.1519/JSC.0000000000002200.
- Schoenfeld 2021 continuum, 10.3390/sports9020032.
- Lopez 2021, 10.1249/MSS.0000000000002585.
- Refalo 2023, 10.1007/s40279-022-01784-y.
- Robinson 2024, 10.1007/s40279-024-02069-2.
- Helms 2016, 10.1519/SSC.0000000000000218.
- Helms 2018, 10.3389/fphys.2018.00247.
- Reynolds 2006, 10.1519/R-15304.1.
- Androulakis-Korakakis 2020, 10.1007/s40279-019-01236-0.
- Androulakis-Korakakis 2021, 10.3389/fspor.2021.713655.
- Schoenfeld 2014, 10.1519/JSC.0000000000000480.
- Brzycki 1993, JOPERD 64(1):88, 10.1080/07303084.1993.10606684.
- Epley 1985, Boyd Epley Workout.
- NSCA Training Load Chart (after Landers 1984).
- RP Strength, "Complete Chest Training Guide" (2024).
- Prilepin via Laputin & Oleshko, *Managing the Training of Weightlifters* (unverified primary).
