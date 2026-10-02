# Qala

Qala is a self-hosted app that plans and records both lifting and running from one adaptive engine. This file is the glossary. Decisions live in `docs/DECISIONS.md`, the screen-by-screen spec in `docs/DESIGN.md`, the build plan in `docs/PLAN.md`.

## Language

### Training structure

**Split**:
The weekly layout of training days (a microcycle) — which days train which lifts or runs.
_Avoid_: Schedule, routine

**Block**:
A multi-week span (a mesocycle, 2-7 weeks) with one programming character — hypertrophy, strength, peaking, work capacity, or athletic maintenance — and its own split.
_Avoid_: Phase, cycle, program

**Macrocycle**:
A sequence of blocks toward a long-term goal or a race/meet date.

### Program language

**LS++ (Liftoscript++)**:
Qala's program language: liftosaur's liftoscript plus additive extensions, file extension `.lspp`. The name covers the language, not one codebase: `packages/liftoscript` is the vendored TypeScript oracle and the desktop authoring runtime, `crates/qala-lspp` is the Rust port behind wasm (web, server) and UniFFI (Android).
_Avoid_: liftoscript for new programs (that name means liftosaur's language or the TS package)

**Reference 1RM**:
The 1RM a block's percentage-based loads are computed against, fixed for the whole block so intensity-zone counts don't drift as the live e1RM estimate moves. Updates only at block boundaries or on a new tested 1RM.
_Avoid_: Training max, e1RM (e1RM is the live Kalman estimate; reference 1RM is the block-frozen value derived from it)

### Time off

**Skip**:
One training day off with a reason (break, vacation, sick, injured, scheduling). A skip is rest, never a miss.
_Avoid_: Miss (a day with no log and no reason)

**Shift**:
What vacation and sick days do to the plan: the scheduled work pushes out instead of being absorbed as rest. Breaks and scheduling conflicts rest in place; injuries train around the hurt muscle.

**Training status**:
The persistent version of a skip reason. Stays on from its start day until its end day, or until the user sets Active again. A one-day skip wins over the status for its own day.
_Avoid_: Status alone (too vague; the coach and sync have their own)

### Engine state

**Readiness**:
A 0-1 score set at session start from the check-in (PRS, soreness) and current fatigue state. It's an input to recommendations, rest, and warm-up sizing, not a recommendation itself.

**Fitness** vs **Fatigue**:
Fitness (`F`) is the slow-decaying trained-capacity state per lift or for running. Fatigue (`G`) is the fast-decaying per-muscle or systemic load state. Both decay exponentially on their own time constant and feed the Kalman e1RM observation together.

**Hard set**:
A completed work set with logged RPE >= 7 (or the program's target RPE if none logged); a main-lift hard set also needs load >= 50% of the reference 1RM. The unit weekly volume counting is built on.

**Direct set** vs **Fractional set**:
A direct set trains a muscle as its target. A fractional set also counts synergist work at half weight (`fracSets = directSets + 0.5 * synergist hard sets`). RP's MEV/MRV caps constrain direct sets; the owner's 10-20 band constrains fractional sets.

### Today screen

**Stage**:
One step of a day's plan shown on the Today rail — check-in, warm-up, lift, recover, run, wind down. A day only shows the stages it actually has; a rest day shows check-in, recover, wind down.

**Rail**:
The Today screen's left-edge timeline of the day's stages. Flicks between stage cards to preview or look back; snaps to "now" 10 s after left idle.

### Coach

**Coach**:
The conversational tab backed by the local Gemma model. Open-ended within fitness/training/health/recovery topics — it declines requests outside that persona — but any actionable suggestion it makes still resolves to one of docs/PLAN.md 11's features and passes through the same clamped envelope as every other Gemma-touched number in the app. See `docs/adr/0001-coach-open-chat.md`.
_Avoid_: Assistant, chatbot (both imply unbounded actions, which Coach doesn't have)

**Mobility (warm-up)** vs **mobility (check-in)**:
Two different things that share a word. The warm-up generator's *dynamic mobility* block (PLAN 6.7) is a structured, tracked set of drills before a lift. Check-in's *mobility* is an untracked suggestion line shown on rest days, drawn from soreness answers and owned equipment — not a stage, not logged.
_Avoid_: writing "mobility" alone in a context where both could apply
