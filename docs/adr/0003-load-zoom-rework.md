# ADR 0003: Load zoom rework

Status: Draft (grill opened 2026-10-02). Nothing below is decided; U24 stands
until the owner overturns it through this record.

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
  build replaces them. (Whether the branch is deleted or kept as a
  parts donor is still open, folds into the scope contract.)
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
- Q4+: toggle behavior and remaining inputs, clean sheet vs salvaged
  geometry, Android `frame()` port (S10), doc updates.

## Scope contract

Unwritten. The interview ends with an artifact boundary and a done-means
checklist in this section, quoted with the owner's acceptance.
