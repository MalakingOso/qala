# Pending decisions

Every choice the owner still has to make, in one list. `docs/DECISIONS.md` is the log of choices already made; this file is the queue. An item leaves the queue only through the session protocol below, which writes the answer into the source documents at the moment it is given, so the queue and the docs can never disagree.

`docs/ROADMAP.md` groups the open items by what each one blocks.

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
   - Decide now, build later (owner, 2026-10-14): the session changes docs only. When a Record in names code, or the answer needs code work, add a line to "To implement" at the end of this file instead, and build the list after the session.
6. If an answer contradicts an earlier decided row, stop and say so before writing anything. The owner resolves the conflict first.
7. If a session turns up a new pending choice that has no item here, append it with the next free D number and the same fields, then carry on.
8. If the owner ends the session with items still open, say how many remain and which one is next.

## Look and feel

### D01 Overall register (L18)

- Status: [x] decided 2026-10-13: serious minimal, the current Beamer direction; the cartoon-like direction drops.
- Question: keep the serious, minimal Beamer direction, or lean playful, almost cartoon-like?
- Options: serious minimal (current) / playful cartoon-like. One wins and the other drops.
- Default: none. This is the only open row in the decision log.
- Blocks: any further visual direction work.
- Record in: `docs/DECISIONS.md` L18, `docs/DESIGN.md` 1.

### D02 Desktop sans face (L16)

- Status: [x] decided 2026-10-14: DM Sans, as one variable Latin woff2 in `apps/web/public/fonts`, with the system stack behind it.
- Question: which proportional sans for desktop UI text? `--font-ui` is a system stack stand-in.
- Options: name a face (then a one-line change plus a font file) / keep the stack.
- Default: keep the stack until the owner picks.
- Blocks: nothing. Cosmetic.
- Record in: `docs/DECISIONS.md` L16, `docs/DESIGN.md` 3.1, `apps/web/src/theme/desktop.css`.

## Rust core and shared logic

### D03 Generator port (S6, B31)

- Status: [x] decided 2026-10-14: defer. Later the phone should add workouts and pull generated workouts from the server (D36).
- Question: the Rust core plan is built past the point of approval: `qala-core` (engine, HLC, records, plates), LS++ and the Kotlin FFI are merged and in use. What's left is B31: port the generator to Rust anyway, for one implementation, when no phone screen authors programs? (B36, Kotlin instead of Rust for shared logic, moved to D32.)
- Options: defer / port it.
- Default: defer, revisit after R3.
- Blocks: R4 only.
- Record in: `docs/DECISIONS.md` S6 note, `docs/rust-core.md` 7 (R4), appendix B question 31.

### D04 TS and Rust coexistence rules (B6, B7, B8)

- Status: [x] decided 2026-10-14: Rust is the main implementation; each TS package is deleted once its Rust port checks out on every target, and TS is only the reference for that check (B6, B7). Upstream liftosaur is not followed (B8).
- Question: confirm two rules the build already follows, and answer one it hasn't hit yet. B6: both implementations live with no deadline, and TS goes per package only after golden vectors pass on all targets (every TS package is still in `packages/`). B7: TS is the oracle until a case is reviewed by hand (the vectors come from the `golden:engine`, `golden:plates` and `golden:liftoscript` Deno tasks and Rust is tested against them). B8: who owns upstream liftosaur fixes now that Rust is the phone's runtime?
- Options: confirm B6 and B7 / reopen either; for B8, accept the default or set another.
- Default: confirm; B8 tracked in a list and ported by hand on request.
- Blocks: nothing new; B8 bites the first time upstream ships a fix worth taking.
- Record in: `docs/DECISIONS.md` S6 and S17 notes, `docs/rust-core.md` 9, appendix B questions 6, 7, 8.

### D05 Platform direction (B2, B3, B4)

- Status: [x] decided 2026-10-14: confirmed all three. Android only, one generated token source, Rust for logic that must match across platforms and Kotlin for UI and platform glue.
- Question: B2 is settled in practice: the app is native Kotlin on Jetpack Compose (not Compose Multiplatform), Android only, with the shared logic in Rust behind UniFFI, which Swift can also call. Confirm it. B3 is built as the plan's default: `scripts/tokens_to_kotlin.ts` generates Android's `design/.../Tokens.kt` from the web's `theme/tokens.css` (`deno task gen:android`), both sides test contrast on those tokens, and nothing else is shared. Confirm it. B4: is Rust a language you'll maintain, or should it sit behind a stable API you rarely touch? D32 is the live case.
- Options: confirm B2 and B3 / reopen either. B4: accept the default / change it.
- Default: confirm B2 and B3; B4 Rust only for logic that must match across platforms.
- Blocks: design drift policy (B3), how much logic goes into Rust vs Kotlin (B4).
- Record in: `docs/DECISIONS.md` S7 note, `docs/android-native.md` 3 and 4, appendix B questions 2, 3, 4.

### D06 Record sync, server side (S11, B11, B13)

- Status: [ ] open
- Question: the phone side of record sync is built in S11's shape: typed Room tables, the `field_clock` sidecar, the outbox, and the HLC in Rust with golden vectors. The server and the phone's HTTP client aren't built. Two questions are left. B11: per-user SQLite on the server, and accept losing one write silently on a same-field conflict? B13: sync in the background (WorkManager) or only with the app open?
- Options: per question.
- Default: yes to SQLite and the silent loser; sync on app open, run end and workout end.
- Blocks: A3, the server sync rewrite, real data in the web app.
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
- Question: confirm what the build already does. The engine state is rebuilt on the device from history (`data/.../engine/EngineCompute.kt` calls `buildEngineState` over the records), it has no Room table and is never synced, and `qala-core` owns no store.
- Options: confirm / reopen.
- Default: confirm.
- Blocks: nothing now; the sync design assumes it.
- Record in: `docs/DECISIONS.md` S8, `docs/rust-core.md` 4.

### D09 Review the landed LS++ port (S12, S17)

- Status: [ ] open
- Question: the evaluation path is ported, merged and green. Approve it as built? Includes S17: the vendored-upstream rule ends for the Rust code (small modules by responsibility), the TS copy stays the oracle.
- Options: approve / approve with rework (say what) / reject.
- Default: approve. The port's status section is `docs/rust-core.md` Status.
- Blocks: A4 consumes the port; approval unblocks treating it as settled.
- Record in: `docs/DECISIONS.md` S12 and S17, `docs/rust-core.md` 8. Note: recording the vendored upstream commit in NOTICE or a VENDORED file stays an open chore either way (the vendor script clones depth-1 at master, so no hash is on record).

### D10 Coach stays TypeScript (S14, B33)

- Status: [x] decided 2026-10-14: approve. The Coach stays TypeScript behind a new server route that the Android Coach tab calls.
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

### D14 targetSdk 37 (B14, B15)

- Status: [ ] open
- Question: the build answered B14: minSdk 34, targetSdk 36, compileSdk 37, one phone. Left is B15: move targetSdk to 37 once Nothing OS 5.0 is stable, after retesting the foreground service and audio ducking on the real phone? A second device would reopen minSdk; name one only if it turns up.
- Options: move to 37 after the retest / stay on 36.
- Default: stay on 36 until the real-phone retest, then move.
- Blocks: nothing until the real-phone pass (USB access to the phone isn't set up yet).
- Record in: `docs/DECISIONS.md` S7 note, `docs/android-native.md` 2, appendix B questions 14 and 15.

### D15 L5 check, gates and HR strap (B17, B18, B19)

- Status: [ ] open
- Question: A0 provisioned the toolchain and closed without the L5 check, and everything so far has run on the emulator only. Where does the L5 check go now (B17)? Does "owner tests at gates only" still stand (B18)? Which HR strap, or buy one (B19)?
- Options: per question.
- Default: the L5 check goes in the real-phone verification pass; owner at gates only; a standard 0x180D strap when one exists.
- Blocks: the real-phone pass (B17), BLE testing (B19).
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
- Question: the default was to pick the nav library at A4. A4 shipped without one: Today, Plan, History, Settings and the lifting flow (Warm-up, Workout, Rest, All exercises) run on a hand-written `Nav` holding a route, an origin tab and one parent (`app/.../Navigation.kt`), whose comment says the choice stays open. Keep the hand-written model, and until when, or move to Navigation Compose or Navigation 3? Separately, which screenshot tool for Compose UI tests (Roborazzi, Paparazzi, or one-off emulator screenshots)? None is in the build.
- Options: keep `Nav` until a named trigger / adopt a library now. Screenshots: pick a tool / stay with one-off screenshots.
- Default: keep `Nav` until a screen needs a third level or deep links; one-off emulator screenshots until a tool proves itself on compileSdk 37.
- Blocks: deeper back stacks (the A5 stats screens may be the first); UI test automation.
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

## Roadmap additions (2026-10-02)

These come from the four new roadmap sections in `docs/PLAN.md` 16c to 16f. None of them blocks v1; each one blocks a piece of the work it belongs to.

### D25 Which run plan ships first (R7)

- Status: [ ] open
- Question: track 1 (walk-run, Couch to 5K shape) or track 2 (10K and marathon)? And is the walk-run plan one fixed program the way the NHS writes it, or generated per person?
- Options: track 1 first / track 2 first / both, sequenced; fixed program or generated.
- Default: track 1 first, generated per person, because track 2 needs a threshold pace or a recent race time that a cold runner does not have. The fixed program is the fallback if the brief shows generation buys nothing at interval level.
- Blocks: `runPlans` schema work (the `walk` step kind and the week advance rule are shared, so they do not wait on this).
- Record in: `docs/DECISIONS.md` R7, `docs/PLAN.md` 16c, `docs/research/RESEARCH-run-plans-beginner-and-races.md` 3 and 4.

### D26 In-app breathing fallback (R8)

- Status: [ ] open
- Question: does Qala ship a 60-second paced breathing routine for people who do not want to install Headspace or Waking Up, or does the recommendation stop at the two links?
- Options: ship the routine / links only / decide after the brief's breath-work read.
- Default: decide after the brief. The acute breath-work evidence is a different literature from mindfulness practice over weeks and should be read before anything is built.
- Blocks: nothing until the mindfulness work starts.
- Record in: `docs/DECISIONS.md` R8, `docs/PLAN.md` 16e item 5, `docs/research/RESEARCH-mindfulness.md` 2 and 5.

### D27 Where the beginner exposition lives (T12)

- Status: [ ] open
- Question: how much beginner exposition is written text in the app, and how much is the Coach answering in session? Does the novice path ship before or after the podcast and blog exist?
- Options: mostly in-app text / mostly the Coach / the long form in the podcast and blog with the app keeping to one-liners; ship order either way.
- Default: in-app one-liners and the Coach for in-session questions, with the long exposition in the podcast and blog, which is one research effort serving three surfaces. The order is open because the podcast scripts are blocked on the brief either way.
- Blocks: the novice path's copy work.
- Record in: `docs/DECISIONS.md` T12, `docs/PLAN.md` 16d item 6.

### D28 Podcast audio and delivery (P7)

- Status: [ ] open
- Question: where do the rendered episodes live (served by the Deno server from outside the working tree, or content-addressed like GPS tracks)? Is an in-app player wanted, given it has to work with the screen locked? Which Kokoro voice is the narrator?
- Options: per question. Pick the voice by listening to two or three, and pin it, since Sonoro's round-robin bug made a re-render sound like a different narrator.
- Default: served from outside the repo, no in-app player until there are episodes, one pinned voice.
- Blocks: nothing until the first script is finished.
- Record in: `docs/DECISIONS.md` P7, `docs/PLAN.md` 16f items 2 to 4.

### D29 Blog home and cadence (P8)

- Status: [ ] open
- Question: where do the posts get published, and how often? Drafts stay in `docs/blog/` until this is answered.
- Options: name a home (own repo, hosted platform, or a page on the Qala site) and a rough cadence.
- Default: none. Nothing is published before the owner picks a home.
- Blocks: nothing; writing can start.
- Record in: `docs/DECISIONS.md` P8, `docs/PLAN.md` 16f items 7 and 8.

### D30 Body photos (P7)

- Status: [ ] open
- Question: does `bodyMeasures` hold progress photos at all? A body photo is the most sensitive thing this app would hold, and S9's content-addressed blob story was designed for GPS tracks.
- Options: no photos / photos as blobs with a retention rule the owner sets / photos local to the device only, never synced.
- Default: no photos until this is answered. Every other part of the body-composition thread can ship without them.
- Blocks: the `bodyMeasures` schema, nothing else.
- Record in: `docs/DECISIONS.md` P7, `docs/PLAN.md` 16f item 5, `docs/research/RESEARCH-body-composition.md` 5.

### D31 Record the Deno to Bun move (S1)

- Status: [ ] open
- Question: write the DECISIONS row for replacing Deno with Bun? `docs/PLAN-bun-migration.md` says "Decided 2026-10-13 (owner)", and another session's notes say the owner chose Bun that day (artifact "Qala Deno Exit"), but S1 still says Deno 2 and no row records the change.
- Options: record it as decided, amending S1 / reopen the choice.
- Default: record it as decided, with the move still waiting on the LS++ port and the retirement of `packages/liftoscript`, as the plan says.
- Blocks: nothing now; the move itself waits on LS++.
- Record in: `docs/DECISIONS.md` S1 (amend) and a new row, `docs/PLAN-bun-migration.md` status line, `docs/ROADMAP.md` tooling track.

### D32 Rest and warm-up planning: Kotlin or Rust (S6, R3)

- Status: [ ] open
- Question: the Android lifting flow shipped rest and warm-up planning in Kotlin (`app/.../workout/RestPlan.kt` and `Warmup.kt`, ports of `packages/engine/rest.ts` and `warmup.ts`). `docs/rust-core.md` 7 (R3) and `docs/android-native.md` 6 put them in Rust, so there are now two implementations that can drift. Keep Kotlin, or port to `qala-core`?
- Options: port to Rust oracle-first with golden vectors (as the plates port did) and switch Kotlin to call it / keep Kotlin and amend R3.
- Default: port to Rust. The Kotlin rest model is also a partial port (no learning multiplier, rep drift or low-readiness adjustment), so a port fixes that too.
- Also answers appendix B question 36 (moved here from D03): keep run, math and engine logic in Rust, or let it live in Kotlin on the phone and accept the fork with the web? Default: keep the Rust core.
- Blocks: R3's remainder, rest parity with the web.
- Record in: `docs/DECISIONS.md` S6 note, `docs/rust-core.md` 7, `docs/android-native.md` 6, `docs/ROADMAP.md` Rust track, appendix B question 36.

### D33 Prescriptions the plates cannot load

- Status: [ ] open
- Question: the debug seed's GZCLP prescribes 207.5 lb, but the default inventory has 1.25 lb plates at zero pairs, so the flow shows "loads 205". Should program weights round to what the saved inventory can load, or should the default inventory include 1.25s? And is a kg plate inventory wanted (today kg falls back to placeholder rounding)?
- Options: round prescriptions to the saved inventory / default 1.25s to plenty / leave it, the note is enough. Separately: add a kg inventory / lb only.
- Default: round prescriptions to the saved inventory, since that's what the lifter can actually put on the bar; lb only for now.
- Blocks: nothing; it's a correctness polish on the lifting flow.
- Record in: `docs/DECISIONS.md` (new row), `docs/DESIGN.md` plate sections, `docs/ROADMAP.md` Android track.

### D34 Lifting-flow behaviour that needs a call

- Status: [ ] open
- Question: four small choices the build left open. (a) When a rest ends with the app in the background: a sound, a notification, or nothing (today a haptic only while Rest shows; the web has a `rest.alert` setting)? (b) Should Today's hero say "Resume workout" when a half-logged draft exists? (c) With Automatic rest off, is a manual rest timer wanted? (d) Should a failed save show the user a message (today the draft stays and the error goes to logcat)?
- Options: per item, yes or no.
- Default: (a) a notification, (b) yes, (c) yes, a tap-to-start rest on the set row, (d) yes.
- Blocks: nothing; polish on A4.
- Record in: `docs/DECISIONS.md` (new rows), `docs/DESIGN.md` workout and rest sections.

### D35 Settings follow-ons

- Status: [ ] open
- Question: with Settings built, three follow-ons. (a) When "Build a warm-up" is off, should the Warm-up stage drop off Today's rail (today only the ramp sets remain)? (b) Should collars be editable (fixed at 0 lb now)? (c) Is the Appearance group (theme and title font, which `Theme.kt` says arrives with Settings) next?
- Options: per item, yes or no.
- Default: (a) yes, (b) no until someone uses collars, (c) yes.
- Blocks: nothing.
- Record in: `docs/DECISIONS.md` (new rows), `docs/DESIGN.md` Settings section, `docs/ROADMAP.md` Android track.

### D36 Workouts from the phone

- Status: [ ] open
- Question: the owner wants the phone, later, to add workouts and to pull generated workouts from the server (D03). Three things are open. What does "add a workout" cover: a one-off session logged outside the program, or a day or exercise written into the program text? Where does that authoring run, given S12 keeps authoring in TS on the desktop: a server route, or an LS++ authoring port in Rust? And how do generated workouts reach the phone: a route the phone calls, or records the server writes and sync delivers?
- Options: per question.
- Default: one-off workouts first; program edits through a server route that runs the TS authoring code, the same pattern as the Coach (S14); generated workouts arrive as records through sync, so they work offline once pulled.
- Blocks: nothing now; any phone authoring work.
- Record in: `docs/DECISIONS.md` (new row), `docs/rust-core.md` 7 (R4) and 8, `docs/android-native.md` (screens), `docs/ROADMAP.md` Android track.

## To implement

Code work owed by decided items, built after the session (protocol step 5). An entry leaves when it's built.

- None open. D10's Coach route and Android screen were built and merged 2026-10-14 (`90db3a6`). D02 (DM Sans) was built during the session, before this rule.

## Validations (not decisions; real-data gates)

These need the owner's data or device, not an opinion. They stay open until measured.

- V01 Route-matching thresholds (R5): about 80% overlap inside a 50 m corridor. Validate against real GPS drift and out-and-back routes, then confirm or retune in `docs/DECISIONS.md` R5 and `docs/PLAN.md` 16a.
- V02 Voice recheck (S20): E4B beat whisper on synthetic clips. Recheck both on the owner's real voice in gym noise before relying on either, then confirm in `docs/DECISIONS.md` S20 and `docs/ls-plus-plus.md` 5.
