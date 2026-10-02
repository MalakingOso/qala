# ADR 0003: Load zoom rework

Status: Accepted in part (2026-10-02). The desktop port is built as U27, in
the U25 look. The phone and the Android `frame()` port are out of scope for
now; the rest of this record is the interview that led there.

## Reference (verified 2026-10-02 from the live site)

Gentler Streak's "Gentler Stories" page, "Move for Life" section: three
cards, the middle one headed "Three views, one path forward" with the copy
and a phone playing an 11.16s 1920x1080 H.264 clip (4 MB, muted). Frames
confirm the teardown: Yorhart hero plus "Great Effort Today" fixed; an
eye/wave glyph that swaps with the view; one module morphing readiness
pill, perspective slab (a real tilt), 10-day band (10 points, ringed last,
day axis), dense 30-day zigzag on a rising area with sparse ticks, then
the reverse path back so the content loops seamlessly. Probed behavior:
the tag carries no loop or autoplay attributes, the element reports
`loop:false`, yet it plays on viewport entry and wraps at the end, so
the loop is a Framer-component JS replay. Owner's flags stand: the
10-day window looks back despite "plan ahead"; a ~1s mid-transition
overlap glitch; the loop lives in the component setting. Only the
action pattern transfers (one module, toggle tap, continuous morph,
axis carries scale); stops, encoding, and toggle are Qala's own
(owner: "but applied to this project").

## U24 as recorded (branch `load-zoom`, unmerged)

Owner direction, 2026-10-02: the zoom is for workouts in the hero, not the
readiness ring; levels Day, Week, 3 weeks, Block; pinch plus picker plus
swipe; one component shared by the phone Today hero (opens Day) and the
desktop Overview lede (opens 3 weeks); user-driven, coded from data, no
video, no autoplay, no 3D tilt, no target band. Amends U13 (strip becomes
the Week level) and U20 (ribbon becomes the 3-week level).

## Branch state (researched, not judged)

- Two commits on `load-zoom` (worktree `qala-load-zoom`), +2641/-735.
- New: `logic/loadZoom.ts` (1074 lines, pure `frame()` of block days and
  camera `{z, anchor}`), `shared/charts/LoadZoom.tsx` (702 lines, SVG plus a
  custom rAF tween hook and pointer/pinch/wheel/keyboard gestures),
  `logic/loadZoom.test.ts` (506 lines). Suite is 276 green on the branch.
- Deleted: `WeeklyLoad.tsx` (U13 strip) and `WeekRibbon.tsx` (U20 ribbon).
- One y-scale for Day/Week/3 weeks; Block rescales to the largest week and
  crossfades stacked days into the week bar over the last 15%.
- Slots under 24px at 3 weeks on a phone depart from DESIGN 6.2's hit rule
  (admitted in U24). DESIGN 6's table already assigns "needing zoom and
  drag" time series to uPlot (S4); the branch hand-builds both.

## Settled (owner, 2026-10-02)

- Q1: start fresh from main. The `load-zoom` branch stays unmerged; the
  strip (U13) and ribbon (U20) remain the shipped charts until a fresh
  build replaces them. (Whether the branch is deleted or kept as a parts
  donor is still open, folds into the scope contract.) Amended
  2026-10-02: the fresh build took the branch's pure geometry
  (`logic/loadZoom.ts`) and gesture and tween code (`LoadZoom.tsx`) as its
  parts and redrew them, so the branch is a parts donor, still unmerged.
  The ribbon is replaced on the desktop only; the phone keeps the U13
  strip.
- Q2: capture the action, not the clip (owner: "i don't want the video
  i want the action that the video is capturing"). The heroes get the
  toggle-driven view morph, user-driven and coded from data; no video,
  no autoplay, no ambient loop, no play-once. U24's "user-driven, not
  autoplay" stands confirmed against the reference.

## Open questions (this interview)

- Q3: shape of the morph: continuous one-scale camera with tilt,
  continuous without tilt, or distinct level designs with a cut.
  Artifacts for review (all six render and transition with zero
  console errors, verified 2026-10-02): `mockups/load-zoom-a-tilt.html`
  (Q3a), `mockups/load-zoom-b-flat.html` (Q3b), `mockups/load-zoom-c-cut.html`
  (Q3c), `mockups/load-zoom-d-flip.html` (alternating-axis flip),
  `mockups/load-zoom-e-cube.html` (cube), `mockups/load-zoom-f-dolly.html`
  (dolly), over `mockups/load-zoom-core.js` / `load-zoom-core.css`.
  Answered 2026-10-02: a continuous one-scale camera with no tilt (the
  shape of Q3b), drawn in the U25 look at every level. The mockups stay
  as the record of the options.
- Q4+: toggle behavior and remaining inputs, clean sheet vs salvaged
  geometry, Android `frame()` port (S10), doc updates. Answered
  2026-10-02: the picker sits on the Overview title row (not under the
  chart), geometry is salvaged and reworked into per-kind pieces (lift
  under run), the Android port is out of scope, and the docs are DECISIONS
  U27 (amending U20, U21 and U25), DESIGN 6.3, 6.5 and 7.15.

## Scope contract

Owner, 2026-10-02: merge the load zoom into the new look on main, "just on
the web", the new look at every level, and the chart takes the lede.

Artifact boundary:

- Desktop Overview only. No change under `shell-phone/`, `index.css`,
  `WeeklyLoad.tsx` or `apps/android`.
- New: `logic/loadZoom.ts` and its tests, `shared/charts/LoadZoom.tsx`
  (with the exported `ZoomPicker`). Removed: `shared/charts/WeekRibbon.tsx`.
  Kept: `logic/weekRibbon.ts` (the loadZoom logic imports it).
- Changed: `shell-desktop/OverviewPage.tsx` (no left column, a new kicker,
  the picker on the title row, a zoom-named title), `parts.tsx`
  (`PageHeader` takes an `action`), `weekFocus.tsx` (six weeks, an exact
  anchor day), `theme/desktop.css` (the `.ribbon*` rules become `.lz-*`),
  `store/sample.ts` and `store/types.ts` (`sampleBlockWeeks`, `runLabel`,
  `deload`), `public/sw.js` (cache version).

Done means:

- `deno test src/logic/` and `tsc --noEmit` pass.
- Every level (Day, Week, 3 weeks, Block) draws in the U25 look in light and
  dark, including mid-zoom frames (`?z=0.5`, `1.5`, `2.5` in a dev build).
- The picker, ctrl-wheel pinch, shift-wheel pan, the keyboard, the ruler's
  week names and the toolbar's week switcher all move the chart and the
  title; reduced motion snaps; no console errors.
- The phone Today strip is unchanged.

Open for the owner to look at: 15px bars at 3 weeks across a chart about
1,070px wide (the old column was about 660px), and the kicker dropping
"Lower A complete" to stay on one line. `withRail` stays in
`logic/loadZoom.ts` (unused by the app) only to keep its tests.
