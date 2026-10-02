# Pending decisions

Every choice the owner still has to make, in one list. `docs/DECISIONS.md` is the log of choices already made; this file is the queue. An item leaves the queue only through the session protocol below, which writes the answer into the source documents at the moment it is given, so the queue and the docs can never disagree.

## How to run a session (agent instructions)

The owner goes through this file with an agent, one item at a time. The agent running the session follows this protocol exactly.

1. Start by reading this file and saying how many items are still open. Ask which item to take: the owner names one (`D06`) or says `next`, which means the first open item in file order.
2. Present the item: its question, the options, the default or recommendation, and what it blocks. Keep it short. Do not present more than one item at once.
3. The owner answers. A default is not a decision: if the owner says "go with the default" or "your call", that counts as an explicit answer and you record it as decided with that note. Silence, a skipped item, or an unrelated reply never decides anything.
4. The moment the owner answers, before presenting the next item, update every document in the item's Record in list:
   - In `docs/DECISIONS.md`, set the named row's status to decided with the date, and adjust the decision text if the owner overturned the default.
   - In the named spec sections, change the text to match the choice. If the owner overturned a "default in the plan", rewrite the plan text; do not leave the old default standing next to a contradicting log row.
   - In `docs/rust-core.md` appendix B, mark the named question settled or answered, same as the existing settled entries.
   - Here, tick the item's box, add the date and a one-line answer.
5. Read back the changed lines so the owner can check them, then ask for the next item.
6. If an answer contradicts an earlier decided row, stop and say so before writing anything. The owner resolves the conflict first.
7. If a session turns up a new pending choice that has no item here, append it with the next free D number and the same fields, then carry on.
8. If the owner ends the session with items still open, say how many remain and which one is next.

## Look and feel

### D01 Overall register (L18)

- Status: [ ] open
- Question: keep the serious, minimal Beamer direction, or lean playful, almost cartoon-like?
- Options: serious minimal (current) / playful cartoon-like. One wins and the other drops.
- Default: none. This is the only open row in the decision log.
- Blocks: any further visual direction work.
- Record in: `docs/DECISIONS.md` L18, `docs/DESIGN.md` 1.

### D02 Desktop sans face (L16)

- Status: [ ] open
- Question: which proportional sans for desktop UI text? `--font-ui` is a system stack stand-in.
- Options: name a face (then a one-line change plus a font file) / keep the stack.
- Default: keep the stack until the owner picks.
- Blocks: nothing. Cosmetic.
- Record in: `docs/DECISIONS.md` L16, `docs/DESIGN.md` 3.1, `apps/web/src/theme/desktop.css`.

## Rust core and shared logic

### D03 Approve the Rust core plan (S6)

- Status: [ ] open
- Question: approve the workspace scope (run, math, engine, LS++), the R0 to R5 order, and deferring the generator port? Includes B31 (port the generator anyway for purity?) and B36 (keep run, math and engine in Rust rather than writing them in Kotlin and accepting the fork with the web?).
- Options: approve as written / approve with changes / reject.
- Default: approve as written (order and deferral are the recommendation).
- Blocks: R0 and everything after it.
- Record in: `docs/DECISIONS.md` S6, `docs/rust-core.md` status and 7, appendix B questions 31 and 36.

### D04 TS and Rust coexistence rules (B6, B7, B8)

- Status: [ ] open
- Question: three rules for living with two implementations. How long do both exist (B6)? When Rust and TS disagree on an edge case, which is right (B7)? Who owns upstream liftosaur fixes once the vendored copy stops being the runtime (B8)?
- Options: accept the defaults / set different ones.
- Default: no deadline, TS deleted per package after golden vectors pass on all targets; TS is the oracle until a case is reviewed by hand; upstream fixes tracked in a list and ported by hand on request.
- Blocks: R1 onward (the rules bite with the first ported module).
- Record in: `docs/DECISIONS.md` S6 and S17 notes, `docs/rust-core.md` 9, appendix B questions 6, 7, 8.

### D05 Platform direction (B2, B3, B4)

- Status: [ ] open
- Question: is native Kotlin the only Android app or is Compose Multiplatform kept open for iOS (B2)? Is two UI codebases drifting acceptable (B3)? Is Rust a language the owner will maintain, or must it hide behind a stable API (B4)?
- Options: accept the defaults / change them.
- Default: Android only with the native layer isolated from the core; one shared token file and nothing else shared; Rust only for logic that must match across platforms.
- Blocks: module layout (B2), design drift policy (B3), how much logic goes into Rust vs Kotlin (B4).
- Record in: `docs/DECISIONS.md` S7 note, `docs/android-native.md` 3 and 4, appendix B questions 2, 3, 4.

### D06 Record sync (S11, B11, B13)

- Status: [ ] open
- Question: approve record sync replacing Automerge? Includes B11 (per-user SQLite on the server, and losing one write silently on a same-field conflict?) and B13 (sync in the background or only with the app open?).
- Options: approve as written / approve with changes / keep Automerge after all.
- Default: approve; yes to SQLite and silent loser; sync on app open, run end and workout end.
- Blocks: A3, the server sync rewrite, both clients.
- Record in: `docs/DECISIONS.md` S11, `docs/rust-core.md` 4, `docs/android-native.md` 6 and 9, appendix B questions 11 and 13.

### D07 Tracks as blobs (S9, B10)

- Status: [ ] open
- Question: approve raw fixes living in Room plus content-addressed blobs, never as sync records? B10 says it is still worth measuring before it locks in.
- Options: approve / approve after a measurement (say what measurement) / reject.
- Default: approve, with a measurement first.
- Blocks: the `schemaVersion` migration and A3.
- Record in: `docs/DECISIONS.md` S9, `docs/rust-core.md` 5, appendix B question 10.

### D08 Engine state as derived cache (S8)

- Status: [ ] open
- Question: approve engine state rebuilt on each device from history, never synced, with the Rust core never owning a store?
- Options: approve / reject.
- Default: approve.
- Blocks: engine port (R3) and sync design.
- Record in: `docs/DECISIONS.md` S8, `docs/rust-core.md` 4.

### D09 Review the landed LS++ port (S12, S17)

- Status: [ ] open
- Question: the evaluation path is ported, merged and green. Approve it as built? Includes S17: the vendored-upstream rule ends for the Rust code (small modules by responsibility), the TS copy stays the oracle.
- Options: approve / approve with rework (say what) / reject.
- Default: approve. The port's status section is `docs/rust-core.md` Status.
- Blocks: A4 consumes the port; approval unblocks treating it as settled.
- Record in: `docs/DECISIONS.md` S12 and S17, `docs/rust-core.md` 8. Note: recording the vendored upstream commit in NOTICE or a VENDORED file stays an open chore either way (the vendor script clones depth-1 at master, so no hash is on record).

### D10 Coach stays TypeScript (S14, B33)

- Status: [ ] open
- Question: approve the Coach staying TS behind a new server route the Android tab calls, instead of porting `packages/llm` to Rust?
- Options: approve / port it to Rust instead.
- Default: approve (it needs the network regardless).
- Blocks: A6 and the server Coach route.
- Record in: `docs/DECISIONS.md` S14, `docs/rust-core.md` 7, appendix B question 33.

## Android app

### D11 Android run stack (S15, B16, B20, B21)

- Status: [ ] open
- Question: approve the run stack in `docs/android-native.md` 5? Includes B16 (depend on Play Services for Fused location, with the `LocationManager` fallback?), B20 (speech cues with ducking, tones as fallback?), B21 (resume a killed run silently and mark the gap?).
- Options: approve as written / approve with changes.
- Default: approve all three sub-answers as written.
- Blocks: A2.
- Record in: `docs/DECISIONS.md` S15, `docs/android-native.md` 5, appendix B questions 16, 20, 21.

### D12 Android maps (S16, B23)

- Status: [ ] open
- Question: approve MapLibre Native with `maplibre-compose` over a downloaded region `.pmtiles`? Includes B23's second half (glyphs and sprites bundled in the app or served by the server?) and pinning one MapLibre native line (13.5.2 stable vs the 13.6.x line).
- Options: approve as written and pick glyph/sprite home plus the native line.
- Default: approve; glyph/sprite home undecided; no default on the native line.
- Blocks: A5 map work; the server glyph/sprite routes if served.
- Record in: `docs/DECISIONS.md` S16, `docs/android-native.md` 7, appendix B question 23.

### D13 Android charts (S10, B24)

- Status: [ ] open
- Question: approve Vico for standard charts plus hand-drawn Canvas for the week strip, readiness ring and run series? B24's run-series spike (60 fps on 7,000 points with a synced crosshair) later decides whether the run series moves into Vico.
- Options: approve as written / approve with changes.
- Default: approve.
- Blocks: A5. The spike is future work; its result gets recorded here as a follow-up.
- Record in: `docs/DECISIONS.md` S10, `docs/android-native.md` 7, appendix B question 24.

### D14 Devices and SDKs (B14, B15)

- Status: [ ] open
- Question: does any device besides the Nothing Phone need to run this (B14)? Move targetSdk to 37 once Nothing OS 5.0 is stable, after retesting the service and ducking (B15)?
- Options: one phone only / name other devices; move to 37 after the retest / stay on 36.
- Default: only the owner's phone; target 36 now, move to 37 after the October retest.
- Blocks: minSdk choice (B14 only matters if another device appears); the October retest.
- Record in: `docs/DECISIONS.md` S7 note, `docs/android-native.md` 2, appendix B questions 14 and 15.

### D15 Test process (B17, B18, B19)

- Status: [ ] open
- Question: write the L5 check as a first test app, or keep it inside milestone A0 (B17)? Owner tests at gates only, with the toolchain already provisioned (B18)? Which HR strap, or buy one (B19)?
- Options: per question.
- Default: L5 check inside A0; owner at gates only; standard 0x180D strap when one exists.
- Blocks: BLE testing (B19); A0 planning.
- Record in: `docs/android-native.md` 5 and 9, appendix B questions 17, 18, 19.

### D16 Chart accessibility on Android (B22)

- Status: [ ] open
- Question: TalkBack semantics plus a table view on every chart, hand-built for the Canvas charts, as DESIGN 6.2 requires on web?
- Options: yes / no.
- Default: yes.
- Blocks: A5 chart work.
- Record in: `docs/DECISIONS.md` S10 note, `docs/android-native.md` 7, appendix B question 22.

### D17 Fonts and icons (B25, B26)

- Status: [ ] open
- Question: confirm the two asset calls as settled by building. B25 (DM Mono TTF): settled by converting the repo woff2 locally with `scripts/woff2_to_ttf.py` instead of fetching from Google Fonts; Qala Test TTFs bundled the same way. B26 (Lucide as generated Compose vectors, `sport-shoe` for runs): the 41 icons are generated and the design module builds.
- Options: confirm both / reopen either.
- Default: confirm.
- Blocks: nothing. Already built.
- Record in: `docs/android-native.md` 4, appendix B questions 25 and 26.

### D18 Process leftovers (B27, B28, B29)

- Status: [ ] open
- Question: confirm three process defaults as settled. B27: the Android code lives in `apps/android` on main, no long branch. B28: the decision log was written with the plan, marked proposed until approved (this file is the approval queue). B29: nothing else from the Stride review changes with the move to Kotlin.
- Options: confirm / reopen any of them.
- Default: confirm.
- Blocks: nothing.
- Record in: appendix B questions 27, 28, 29.

### D19 HR-zone coaching timing (B34)

- Status: [ ] open
- Question: build HR-zone coaching (R6) in TS now, or wait and build it once in whichever language `guided` lives in?
- Options: build in TS now / wait and build once.
- Default: wait, build once.
- Blocks: PLAN 16a item 2.
- Record in: `docs/DECISIONS.md` R6, `docs/PLAN.md` 16a, appendix B question 34.

### D20 Navigation library and screenshot tool

- Status: [ ] open
- Question: Navigation Compose vs Navigation 3 at A4 (the A1 shell uses a sealed `Route`, no library)? And which screenshot tool for Compose UI tests (Roborazzi vs Paparazzi vs one-off emulator screenshots)?
- Options: pick at A4 / pick now.
- Default: pick at A4 for nav; one-off emulator screenshots until a tool proves itself on compileSdk 37.
- Blocks: A4 back stacks (nav); A1+ UI test automation (screenshots).
- Record in: `docs/android-native.md` 3 and 12.

## Accounts (S22 track)

### D21 Public domain and DNS date (U6)

- Status: [ ] open
- Question: pick PUBLIC_DOMAIN (one-way door: it fixes the WebAuthn RP ID) and a DNS cutover date.
- Options: name the domain and date.
- Default: none. Everything else can proceed against a stub.
- Blocks: phase 0 of the accounts rollout.
- Record in: `docs/adr/0002-friends-family-auth.md`, `docs/plan-accounts-logins.md` 0 and 13.

### D22 Sync and blob DDL plus transport (U7)

- Status: [ ] open
- Question: the S11 track owns the sync/blob record shapes and the ws-upgrade-vs-POST decision; the accounts plan only constrains the auth mapping. Settle both when that track lands.
- Options: per the S11 design when written.
- Default: none yet.
- Blocks: A3.
- Record in: `docs/plan-accounts-logins.md` 4.3 and 13, `docs/DECISIONS.md` S11 note.

### D23 Hosted LLM fallback (U9)

- Status: [ ] open
- Question: if coach-quiet on the VPS (plan section 9) turns out unacceptable, which hosted LLM path: provider, key handling, per-user cost cap?
- Options: decide if and when quiet is unacceptable.
- Default: defer past v1.
- Blocks: nothing now.
- Record in: `docs/plan-accounts-logins.md` 9 and 13.

## Equipment renders

### D24 Bars to render (L13, PLAN 16b)

- Status: [ ] open
- Question: after the EZ bar, which bars get Blender renders (trap bar? straight barbell? others?), and does an exercise get a per-exercise bar so EZ-curl work plans with the 25 lb EZ bar?
- Options: name the bars; yes or no on the per-exercise bar.
- Default: none.
- Blocks: PLAN 16b; the plate calculator's bar picker scope.
- Record in: `docs/DECISIONS.md` L13, `docs/PLAN.md` 16b, `docs/DESIGN.md` 5.8a.

## Validations (not decisions; real-data gates)

These need the owner's data or device, not an opinion. They stay open until measured.

- V01 Route-matching thresholds (R5): about 80% overlap inside a 50 m corridor. Validate against real GPS drift and out-and-back routes, then confirm or retune in `docs/DECISIONS.md` R5 and `docs/PLAN.md` 16a.
- V02 Voice recheck (S20): E4B beat whisper on synthetic clips. Recheck both on the owner's real voice in gym noise before relying on either, then confirm in `docs/DECISIONS.md` S20 and `docs/ls-plus-plus.md` 5.
