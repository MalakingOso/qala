# M4 mockup options

Status: historical; archived 2026-10-13. M4 is built and merged. This records the options that were on the table, and the build may differ from the recommendations.

Design-only options for the M4 screens, from the parallel mockup track in
`docs/PLAN-rail-refresh.md`. Open `mockups/m4-index.html`. Every page shows its
options side by side in 390 px phone frames, light and dark (a theme switch in
the corner, or the system setting). The owner was away, so each topic ends with
one recommendation that gets built unless it is overruled.

Shared across the pages: Beamer calm surfaces, Qala Test for page titles and
hero numerals only, Recursive for UI text, glass only on floating chrome (the
rail strip and the preview bar), the notch rail on Today frames only, and the
Friday sample day. The tokens are in `mockups/m4-core.css` (the rail slice's
light values plus the DESIGN.md dark values), the icons in `mockups/m4-icons.js`
(Lucide, the existing vocabulary), the helpers in `mockups/m4-core.js`.

## 1. Check-in screen (`m4-checkin.html`)

Shown for a lift day (Friday, Lower A, five muscles) and a rest day (Sunday,
the four fixed muscles, with the rest-day tip). Save reads "Save check-in" on
both, writes the record, marks the stage done and returns to Today.

**A, stacked scales.** The web layout in the refresh style. Recovery is one
strip of 11 cells (about 30 px wide, 48 px tall) with the three anchor words;
each muscle is a row with its last-trained line and a 4-cell strip (44 px
cells) that rewrites the line to the meaning of the picked value. Everything
is visible and every answer is one tap, but the recovery cells are narrower
than the 48 px target and the screen runs long.

**B, numeral, stepper, tiles.** Recovery is a 76 px Qala Test numeral with 52 px
minus and plus buttons and a dot track for jumps. Soreness is a two-column grid
of tiles with the meaning under each. Best recovery control for one hand, and
shorter than A, but the 4-cell strips shrink to about 32 px wide.

**C, slider and meanings.** Recovery is a drag slider with a live numeral.
Soreness is a summary list; a tap opens the four meanings as full-width rows, so
people answer in words, not numbers. Least ambiguous and compact, but two taps
per muscle, and a slider is the weakest control for hitting an exact number.

**Recommendation: A.** Its soreness cells are the largest of the three and every
answer is one tap, which is what a daily 20-second check-in needs. If the 30 px
recovery cells test badly on a phone, swap in B's numeral and stepper for
recovery only, because the two halves are independent.

## 2. Skip sheet (`m4-skip-sheet.html`)

Shown as Sick for this day only, and as Injured for 7 days. Copy follows
DESIGN 7.18: each reason says what happens and nothing counts against you, with
no warning color and no count.

**A, full page, reason rows.** Five bordered rows with a blurb each, muscle chips
under Injured (disabled "Pick a muscle first" until one is picked), a note, a
four-cell span strip, then Skip and Keep training. Nothing is hidden, but it is
a long scroll for a two-tap decision and it replaces Today instead of sitting
over it.

**B, bottom sheet with a result line.** A sheet over Today. Reasons are compact
tiles, the muscle chips appear only under Injured, and a "What happens" line
rewrites itself for the picked reason, muscle and span. The span strip stays
visible, the note hides behind "Add a note". One screen for most reasons; the
injured state scrolls inside the sheet.

**C, one tap, details on request.** Tapping a reason skips today at once (Undo
on Today is the safety net). "Longer than today, or add a note" turns the list
into chips and opens span, muscle and note with an explicit Skip button. Fastest
for the common case, but a one-tap skip surprises people who expect a confirm,
and the injured case costs the most taps.

**Recommendation: B.** It keeps Today in view, answers the no-guilt copy rule
with the live result line before anyone commits, and fits one screen for four of
the five reasons. A skip with no confirm (C) is the wrong default for an action
that shifts the plan.

## 3. Status banner and "Feeling better?" (`m4-status-banner.html`)

Four states (sick, vacation, injured with the muscle named, break), each in
context and as a cropped row. Skipped stages show hollow rings on the rail and
there is no ember "now" dot when nothing is left to do. An injured day is not a
skipped day: the lift still runs, so that rail keeps normal dots. Undo ends the
status. The hero keeps See plan only; a second Undo in the hero repeats the
banner's.

**A, pinned strip in the head.** A recessed strip under the title with icon,
status and span, one line of meaning, and Undo. Always on screen and always in
thumb reach, with no notch needed. Costs about 70 px of permanent height and the
two dense lines are the hardest to read.

**B, status card in the scroll.** The first card on Today, notched around the
rail like the others: icon tile, status, span, the sentence, Undo and Change.
Reads like the rest of Today and has room for the prompt. It scrolls away, which
matters little on a short screen.

**C, status takes the hero.** A 48 px icon block, the status in Qala Test, one
paragraph that names what is skipped, Undo beside See plan. The clearest and the
tallest; it pushes the day's cards down, which is wrong for an injured day that
still has a lift.

**"Feeling better?"** from the second sick day, once per session, never on the
skip sheet. A is a centered dialog (the web's), B a bottom sheet, C an inline
question inside the status card with "I am better" and "Still sick".

**Recommendation: banner B, prompt C.** A card is the same vocabulary as the
rest of Today, notches correctly, costs no pinned height, and carries Undo and
Change. The inline prompt never blocks a sick person who opened the app for one
number; if it proves too easy to miss, the fallback is the bottom sheet.

## 4. Empty states (`m4-empty-states.html`)

A fresh install has no program, check-ins, runs or weights, so there is no lift
day: the rail shows the three rest-day stages and check-in is "now". Training
weekdays still default to Mon, Wed, Fri, Sat.

**A, quiet cards.** Every card keeps its slot with one plain sentence about what
fills it and one action where there is one (Check in, Add a program, Plan a run,
Log weight, Open Settings). The week card shows the training days as dashed
cells, tying it to the new Settings picker. Most useful and honest; five "nothing
yet" cards in a row make a long, slightly bleak first screen.

**B, skeleton shape.** Each card is drawn as it will look with data: en dashes
where numbers go, a dashed readiness ring, a dashed week. No layout jump when
data arrives, but only one action and a screen of dashes reads as broken.

**C, Start here and one-liners.** One card merges the stage hero with a
three-step list; the other four shrink to one-line rows. Shortest, with one clear
path, but Today then has a second layout that must switch off as records arrive.

**Recommendation: A.** It is the only option where every card explains itself and
points somewhere, and it needs no second layout, only per-card empty branches.
Trim the copy in the build if the first screen feels long.

## 5. Training weekdays (`m4-weekdays.html`)

Shown in Settings under the Training status group, as the default and as the
edge where one day is left (it cannot be turned off, and the screen says why).
The one-line explanation is "Lifts land on these days. The rest are rest days."

**A, day strip.** One bordered strip of seven Mon to Sun cells, picked days in
ink, with a "4 days a week: Mon, Wed, Fri, Sat" line. The pattern reads at a
glance and it is the picker idiom used everywhere else. Smallest control (about
46 px cells) and it shows nothing about the result.

**B, strip plus the next seven days.** The same strip and a live list of which
program day lands on which weekday. Answers "what does this change" with the
result, but it is the longest and duplicates Plan.

**C, seven toggle rows.** A normal Settings group with the square ember toggle
per weekday and "Lift day" or "Rest day" under each name. Largest targets and
the cleanest for TalkBack, but the weekly pattern is hard to see in seven rows.

**Recommendation: A.** The pattern is the point, and one strip is the smallest
change to Settings. Give each cell its full weekday name as its accessibility
label, and if testing shows people want to see the consequence, add B's preview
later without changing the control.

## 6. Dark pass for the rail (`m4-dark-rail.html`)

Light reference beside three dark sets, as notched Today frames with the glass
preview bar, as the open menu, as dot states, and as a value table.

**Light.** The current values with the seam stroke on the card border and the
white literals turned into tokens.

**A, mirror.** Strip tint is surface at .62 (the plan's own rule) and every light
value is inverted, so the selected menu row is a light slab. Closest to the light
design; the strip almost vanishes into the ground and the slab is loud.

**B, lifted.** The strip lifts to the active surface at .72 with a stronger
border, later dots get a 3:1 outline, and the selected row is a lifted fill with
a 2 px ink border. The strip reads as raised chrome and nothing shouts.

**C, recessed.** A near-black slot with no hard shadow, brighter dots, a 3 px ink
bar on the selected row and the stronger border for the seam. Neat, but the slot
blends into the ground and the shadow-free strip breaks the hard-shadow rule.

**Recommendation: B.** Its strip is the only one that reads as a 28 px target
against the dark ground, and its selected row keeps text contrast above 11:1
without a bright slab. Values: tint `rgba(31,42,77,.72)`, border
`rgba(232,236,246,.34)`, later dot `#3a4466` with an `.50` border, halo
`rgba(31,42,77,.95)`, seam `rgba(232,236,246,.16)`, scrim `rgba(3,6,16,.60)`,
selected row `#1f2a4d` with a `.60` border. These are already the dark defaults
in `m4-core.css`.

Findings in the light spec that the dark pass surfaced:

- The prototype's seam stroke is `rgba(15,21,42,.24)`, darker than the card
  border (`.16`). The M3 plan already says the seam uses the card's own border,
  so the light column here uses `.16`.
- The selected-row text and the selected-dot halo are hard-coded white in the
  prototype; they must be tokens or they stay white in dark.
- The scrim is ink at .22 in light. Ink is light in dark, so the same token would
  lighten the screen; dark needs a near-black scrim.
- A later dot's border is about 1.7:1 against the strip in light. The dark sets
  hold about 3:1, and light should be raised to match.

## Notes

- The Playwright MCP browser tools failed here (no Chrome at
  `/opt/google/chrome`), so the pages were checked with a `playwright-core`
  script on the cached Chromium instead: every page at 390 px and 1360 to 1700 px,
  light and dark, no horizontal overflow, and the taps on the check-in, skip,
  weekday and inline-prompt controls exercised. The mockups load fonts from
  `../apps/web/public/fonts`, so serve them from the repo root, not from
  `mockups/`.
- Not verified on a device. Widths were checked in desktop Chromium, which runs
  about 6% wider than Android text, so wrapping in the check-in and banner
  copy needs a look on the emulator at build time.
