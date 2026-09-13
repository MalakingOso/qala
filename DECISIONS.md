# Qala: owner decisions

Every choice berkley (the owner) made while planning Qala on 2026-09-13, in one place. Each row says what was decided, what it replaced or ruled out, and where the full spec lives. `PLAN.md` is the build plan, `DESIGN.md` the design system and screen spec, `RESEARCH-*.md` the evidence. When this file and older wording elsewhere disagree, this file wins; fix the other file.

Status: **decided** means the owner said so. **Recommended** means Claude proposed it and the owner accepted it or didn't push back; confirm before building if in doubt. **Assumption** means it was chosen without asking and is cheap to change. **Open** means the owner still has to answer.

Nothing is being built yet. The owner reviews plans and mockups first and says when to start.

## 1. Product and scope

| # | Decision | Status | Replaces or rules out | Spec |
|---|---|---|---|---|
| P1 | One app for lifting and running, with one fatigue model across both. | decided | Separate lifting and running apps. The owner's complaint: "you'll do all of this working out and then it's time to run and it won't be able to just also be the app that records a run". | PLAN 1, 6.4 |
| P2 | Built around liftosaur's liftoscript: programs are text, vendored as a new TypeScript codebase, not a fork of their app. | decided | Forking liftosaur. | PLAN 3, 5 |
| P3 | Adaptive engine (fitness and fatigue, per-muscle soreness check-ins, evidence-based volume and deload rules), a local Gemma coach that can only nudge inside fixed limits, and a goal-driven generator like Evolve's. | decided | An LLM that writes programs freely. | PLAN 6, 11, 12 |
| P4 | Self-hosted on `callisto`, reached over Tailscale; several users, some on iOS, later. AGPL-3.0, public repo, liftosaur credited. | decided | Cloud hosting, accounts. | PLAN 2, 3 |
| P5 | Plan, research and mockups first; no code until the owner says build. | decided | Starting the scaffold now. | this file |
| P6 | No watch app. | decided | | PLAN 16 |

## 2. Training

| # | Decision | Status | Replaces or rules out | Spec |
|---|---|---|---|---|
| T1 | Strength and powerlifting: squat, bench, deadlift and variations; 1-6 reps at 80-95% 1RM; linear or daily undulating periodization; key metrics are 1RM progression and total volume at >85%. | decided (owner's numbers) | Claude's earlier 3-6 rep strength range. | PLAN 6.3, 12 |
| T2 | Hypertrophy and bodybuilding: 8-15 reps at 60-80%; 10-20 sets per muscle per week; key metrics are weekly volume per muscle and progressive overload. | decided (owner's numbers) | Claude's earlier 6-12 and 12-20 ranges. | PLAN 6.3, 12 |
| T3 | The owner's 10-20 band applies to fractional sets (indirect work counts half); RP's landmarks cap direct sets. | recommended | Treating the two as the same count. | PLAN 6.3 |
| T4 | Splits and blocks follow Evolve's structure: main-lift frequency by experience, days built from slots, block types work capacity, hypertrophy, strength and peaking, 2-7 weeks each. | decided (owner asked for it in the plan) | Fixed 4-6 week blocks only. | PLAN 12 |
| T5 | Volume carries over between blocks; the weekly +2 set ramp applies only inside hypertrophy blocks. | decided (confirmed 2026-09-13) | Evolve's flat volume, or resetting to MEV each block. | PLAN 12 |
| T6 | Warm-ups before every lift: easy cardio, soft tissue with the owner's foam roller and Theragun, dynamic mobility, then ramp sets computed from the working weight. | decided | No warm-up support. | PLAN 6.7, DESIGN 7.4 |
| T7 | A "Prefer Theragun where allowed" setting, on by default for the owner, because the owner likes it; the research default uses percussion less. | decided | Research default only. | PLAN 6.7 |
| T8 | Rest sets itself from how the lifter is doing (last set's RPE, missed reps, set number, soreness, readiness), explains each adjustment, and learns the owner's pace from "Ready early" and "+30 s". | decided | A fixed timer from the program. | PLAN 6.6, DESIGN 7.6 |
| T9 | Notes attach to an exercise and pop up the next time that exercise comes around, dated; pin or resolve them. | decided | Session-only notes. | PLAN 8, DESIGN 7.5 |
| T10 | Plate calculator: plates per side for the entered bar, color-coded, shown in full during rest for the next set and as shorthand on the logging screen, with what to change between sets. | decided | Mental math. | PLAN 6.8, DESIGN 5.8, 7.12 |
| T11 | Units: pounds and miles. | decided | | PLAN 3 |

## 3. Running

| # | Decision | Status | Replaces or rules out | Spec |
|---|---|---|---|---|
| R1 | Qala records runs itself, in the spirit of ASICS Runkeeper: time, distance, current and average pace, splits, route map, audio cues, guided workouts, run plans. Implemented anew; nothing copied from Runkeeper. | decided | Using a second app for runs. | PLAN 3, 8a |
| R2 | Running adds to the same fatigue model, including leg fatigue in lifting set-equivalents; the weights are derived from research and marked as assumptions. | decided (owner asked for it); weights are assumptions | Ignoring running fatigue. | PLAN 6.4 |
| R3 | Run plans are a typed schema next to the liftoscript program, not liftoscript. | recommended | Extending the planner grammar. | PLAN 3, 7 |
| R4 | Maps from self-hosted Protomaps tiles in MapLibre; elevation from Copernicus GLO-30 on the server. | recommended | Google Maps, OSM public tiles, GPS altitude. | PLAN 3, 8a |

## 4. Platform

| # | Decision | Status | Replaces or rules out | Spec |
|---|---|---|---|---|
| S1 | TypeScript throughout: Deno 2 for server, tooling and tests; React 19 and Vite for the frontend. | decided (owner asked for a better framework; React accepted) | Preact. | PLAN 3 |
| S2 | The phone app is a Capacitor 8 wrapper so GPS keeps recording with the screen locked; the desktop stays a PWA. | recommended (research showed a PWA can't record in the background) | Pure PWA on the phone. | PLAN 3, RESEARCH-run-tracking |
| S3 | One automerge document per user, synced over WebSocket; sign-in is the Tailscale identity. | decided (first interview) | Accounts, a cloud database. | PLAN 3, 7 |
| S4 | Charts use a real TypeScript charting stack: visx for every in-app chart, uPlot for dense or zoomable time series. The mockups keep their hand-drawn SVG. | decided (owner: "cant we using better ploting stuff since we are in typescript"); library pick recommended | Hand-rolled SVG in the app; uPlot for everything; Recharts, ECharts, Observable Plot, Chart.js. | DESIGN 6 |
| S5 | Icons from Lucide. Running is `sport-shoe`, not `footprints`. | decided | Phosphor (considered, dropped); the `footprints` icon. | DESIGN 4 |

## 5. Look and feel

| # | Decision | Status | Replaces or rules out | Spec |
|---|---|---|---|---|
| L1 | Beamer first: off-white ground, white surfaces, 2px borders, hard offset shadows, small radii, no pill buttons. Light and breezy, never oppressive. | decided (round 1 review: "we really leaned in super hard to runkeeper"; round 2: "light and breezy and not oppressive") | Round 1's Runkeeper-heavy look: navy ink, pills, oblique headlines. | DESIGN 1, 2 |
| L2 | Runkeeper's influence stays only on the run screens: big stacked numerals and the route line. | decided | Runkeeper styling across the app. | DESIGN 7.14 |
| L3 | One action color, ember `#C2410C`. | recommended (never challenged) | Indigo or a split accent. | DESIGN 2 |
| L4 | Titles and big numbers use **Qala Test**, the owner's own face (made with Muse as an OFL fork of Faustina). Faustina is the fallback and the alternate. | decided | Faustina as the title face. | DESIGN 3 |
| L5 | Everything else uses DM Mono. | decided | Recursive as the body face. | DESIGN 3 |
| L6 | Rejected title faces: Recursive oblique, Archivo condensed, then DM Mono titles. The open stand-ins for Trade Gothic (News Cycle), FF Scala (Alegreya) and PMN Caecilia (Noticia Text) were compared and not chosen. | decided | | DESIGN 3.4 |
| L7 | Plates use the standard bumper colors (55 red, 45 blue, 35 yellow, 25 green), every plate shows its number, and colors are editable to match the owner's own plates. | decided (color-coded); the 10, 5 and 2.5 lb colors are assumptions | Uncolored plates. | PLAN 6.8, DESIGN 5.8 |

## 6. Screens

| # | Decision | Status | Replaces or rules out | Spec |
|---|---|---|---|---|
| U1 | The bottom navigation follows Qala's own capabilities. | decided (owner: the Runkeeper tab bar was "a straight lift") | Me / Training / Start / History. | DESIGN 7.0 |
| U2 | Navigation Option A: Today, Plan, Body, Progress, Coach. | decided (confirmed 2026-09-13) | Option B, folding Today into Plan. | DESIGN 7.0 |
| U3 | Today: a hero card that changes through the day, this week's load chart (today outlined, highlighted and named, "Lower A · Squat day"), a readiness ring out of 100 with the owner's average and a low line, a large Start button, and a timeline rail on the left that flicks between the day's stages. After the workout the card shows the result and what's next. | decided (round 3 review) | The barbell drawing in the hero; the day-timeline and dashboard directions as standalone screens. | DESIGN 7.1 |
| U4 | Plan screen after the Volt reference: week arrows, a tab for each day of the week, one Start button, an overview grid of the day's exercises. | decided | A plain list. | DESIGN 7.2 |
| U5 | Workout shows one exercise at a time with a zoom-out to all exercises; the logger layout stays; moving between exercises is swipe, a tap on the progress segments, or the overview. | decided ("i actually don't mind your lifting in the workout that much but need a better way to go between them") | A long scrolling set table. | DESIGN 7.5, 7.7 |
| U6 | Session complete is graphical: figures, charts and comparisons, then the two quick questions. | decided ("shouldn't just be a list of time and pounds") | A receipt of minutes and pounds. | DESIGN 7.8 |
| U7 | A landing page for people reaching Qala on the tailnet. | decided (owner asked for it in the renders) | | DESIGN 7.17 |
| U8 | The Coach tab is open-ended conversation within fitness/training/health topics (declines unrelated requests); any action it proposes still passes through the P3 envelope. | decided (confirmed 2026-09-13) | Bounding the conversation itself to PLAN 11's seven features. | DESIGN 7.11, `docs/adr/0001-coach-open-chat.md` |
| U9 | The Today rail snaps back to "now" 10 s after being left idle. | decided (confirmed 2026-09-13) | Leaving it wherever the user last scrolled. | DESIGN 7.1 |
| U10 | Rest-day mobility work is a suggestion line on the check-in card (from soreness answers and owned equipment), not a tracked stage. | decided (2026-09-13) | A dedicated mobility/recovery stage on rest days. | DESIGN 7.1, 7.3 |

## 7. Questions resolved (grilled 2026-09-13)

1. Navigation: Option A (U2).
2. Volume between blocks: carries over; the ramp applies only inside hypertrophy blocks (T5).
3. Coach thread: fully open within fitness/training/health topics; actions stay clamped (U8, `docs/adr/0001-coach-open-chat.md`).
4. Today rail: 10 s idle snap-back confirmed (U9); rest-day stages stay check-in/recover/wind-down, with mobility surfaced as a check-in tip rather than a new stage (U10).
5. Plate and bar inventory: ships with the standard-bumper defaults (T10, L7); the owner's real inventory goes into Settings later, not before build.
6. Qala Test: ships v1 as-is (Bold + Medium); no further cuts committed.
7. Mockup canvas: made private.

No open questions remain from this round.

## 8. How the decisions were reached

| Round | Date | What the owner saw | What changed |
|---|---|---|---|
| Interview | 2026-09-13 | Questions | Liftoscript, engine, Gemma bounds, check-ins, sync, look from Beamer. |
| Research | 2026-09-13 | Plan text | Training approaches, running fatigue, run tracking platform, rest and warm-up evidence. |
| Mockups 1 | 2026-09-13 | Runkeeper-leaning renders | Owner: too much Runkeeper, keep Beamer, Volt-style plan and workout, warm-ups, notes, adaptive rest, new nav. |
| Mockups 2 | 2026-09-13 | Beamer-first renders with type options | Owner: DM Mono through most of the app, a display face for titles and big numbers, graphical session summary, plate calculator, rethink Today; then supplied the Qala Test font. |
| Mockups 3 | 2026-09-13 | Qala Test, plates, charts, three Today directions | Owner: hero direction with this week's load, readiness ring with average and low line, bigger Start, timeline rail. |
| Mockups 4 | 2026-09-13 | Today in three stages | Owner: `sport-shoe` icon; use a real TypeScript charting stack; write everything down. |
| Grilling | 2026-09-13 | Section 7's 7 open questions | Nav Option A; block volume carries over; Coach goes fully open (`docs/adr/0001-coach-open-chat.md`); rest-day mobility surfaces as a check-in tip; plate defaults kept; font roadmap held at v1; mockup canvas made private. |
