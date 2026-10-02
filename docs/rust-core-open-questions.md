# Rust core and Kotlin app: open questions

Collected 2026-09-30 during planning. Answer whenever they come up; each says what it blocks and the default I'll assume until told otherwise. The plan is in `rust-core.md` and `android-native.md`. Questions where the plan already took a default are marked **Default in the plan**. Those are Claude's recommendations, written down as proposed, and every one is still open for you to overturn.

## Scope and direction

1. Does the React phone shell survive? PLAN 3 says it stays as a PWA for iOS friends who only lift. If it goes, the web only needs the desktop shell and the Rust wasm build gets simpler. Default: keep it, frozen, no new features. **Settled 2026-10-01** (S13): frozen as a PWA; the Capacitor wrapper is deleted.
2. Is native Kotlin the only Android app, or do you want Compose Multiplatform kept open for iOS later? Blocks module layout. Default: Android only, but keep the native layer isolated from the Rust core so iOS stays possible.
3. Do you accept two UI codebases (React for desktop, Compose for phone) drifting on design? Default: share one token JSON and the chart validation script, and nothing else.
4. Is Rust acceptable as a language you will maintain, or should it be hidden behind a stable API you rarely touch? Affects how much logic I put in Rust versus Kotlin. Default: Rust only for logic that must match across platforms.

## Rust core

5. ~~Is the liftoscript port worth it?~~ Answered 2026-09-30: yes, to Rust, evaluation path only (S12). Still open: how much of the 3 to 5 week estimate you are willing to spend before the phone's lifting screens, and whether a quickjs-kt stopgap is acceptable if it slips.
6. How long will you tolerate the existing TS packages and the Rust crates both existing? The plan keeps TS until each Rust replacement passes conformance. Default: no deadline, delete TS per package only after golden vectors pass on all targets.
7. Rust and TS will disagree on edge cases (rounding of .5, float formatting, Date handling). When they differ, which one is right? Default: TS is the oracle until a case is reviewed and the vector is edited by hand.
8. Who owns upstream liftosaur fixes once the vendored copy stops being the runtime? Default: tracked in an issue list, ported by hand when you ask.

## Document and sync

9. ~~Document ownership~~ Moot: Automerge is dropped (S11). Say so if you want it kept after all.
10. **Default in the plan**: tracks are not sync records; they are Room plus content-addressed blobs (S9). Still worth measuring before it is locked in.
11. ~~Fallback if Kotlin sync fails~~ Moot with record sync. New: is per-user SQLite on the server fine, and do you accept losing one write silently on a same-field conflict? Default: yes to both.
12. Answered by the decision to drop Automerge: you edit on one device at a time, so last-write-wins per field is enough. Say if concurrent editing matters more than that.
13. Do you want the phone to sync in the background (WorkManager) or only when the app is open? Default: on app open, on run end, and on workout end.

## Android specifics

14. minSdk 33 or 34 is fine for one Nothing Phone 4a Pro. Does any other device need to run this? Default: only your phone. **Default in the plan** (S7): minSdk 34. Only changes if another device needs to run it.
15. Are you willing to move targetSdk to 37 once Nothing OS 5.0 (Android 17) is stable? Default: target 36 now, retest foreground service and audio ducking on 37 in October. **Default in the plan** (S7): target 36, move to 37 after the October retest.
16. Play Services dependency: Fused location is the recommended single position source, with a LocationManager fallback. OK to depend on Google Play Services on this phone? Default: yes, fallback kept. **Default in the plan** (S15): Fused as the single source, `LocationManager` fallback.
17. Does the phone have an L5 band? Unknown; a 5-minute GnssStatus test settles it. Do you want me to write that test app first? Default: add it to the spike. **Default in the plan**: it is part of milestone A0.
18. Will you test on the phone during the build, or only at gates? The Android toolchain (JDK, SDK, Gradle, adb) is not installed on this machine at all. Default: I provision it as milestone zero, you plug the phone in for gates only. **Default in the plan**: milestone A0 provisions the toolchain.
19. Heart-rate strap: which model do you have, or will you buy one? Blocks BLE testing. Default: standard 0x180D strap, tested when you have one.

## Product behavior

20. Cue audio: speech, tones, or both? Spotify ducking is untested. Default: speech with navigation-guidance ducking, tones as the fallback. **Default in the plan** (S15): speech with ducking, tones as fallback.
21. When the recorder service is killed mid-run, should the app resume the run silently or ask? Default: resume and mark the gap. **Default in the plan** (S15): resume from Room and mark the gap.
22. Do you want TalkBack and a table view on every chart (DESIGN 6.2 says yes)? It costs real Canvas work on Android. Default: yes, built by hand for the Canvas charts.
23. Offline map: download one `.pmtiles` file for your region once, instead of the z/x/y fallback? Default: yes. The server also needs to serve glyphs and sprites, or the app bundles them. **Default in the plan** (S16): downloaded `.pmtiles`; glyphs and sprites still need a home.

## Charts, fonts and assets

24. Vico for standard charts and hand-drawn Canvas for the week strip, readiness ring and run series. OK? A 1-day spike on 7,000 points with a synced crosshair decides whether the run series stays in Vico. Default: as stated. **Default in the plan** (S10), pending the run-series spike.
25. Android needs TTF files for DM Mono (only woff2 is in the repo) and Qala Test and Faustina. The OFL permits conversion. Fine to fetch DM Mono TTF from Google Fonts? Default: yes.
26. Lucide icons: use the Lucide vector set converted to Compose ImageVectors, with `sport-shoe` for runs. OK? Default: yes.

## Process

27. Branching: one long-lived `android-native` branch, or small PRs into main behind a module? Default: new `apps/android` module on main, no long branch.
28. Do you want the decision log updated now (S1 and S2 superseded with dated notes, new S-series rows) or only after you review the plan? Default: written with the plan, marked "proposed" until you approve.
29. Uncommitted R5 and R6 edits in DECISIONS.md and PLAN.md (from the Stride review) stay as they are. Anything else in that review that should change with the move to Kotlin? Default: no.

## Added after the plan was written

30. Check in the Gradle wrapper jar (about 60 KB)? The deleted Capacitor wrapper's `package.json` (`apps/phone`, in git history) said "no Gradle binaries in the repo". Default: check it in for the native project.
31. The generator port is deferred because the phone doesn't author programs. Do you want it ported anyway for one-implementation purity? Default: defer.
32. ~~Liftoscript to Rust go/no-go~~ Answered: go (S12).
33. The Coach on the phone calls a new server route that builds the prompt and validates the response, so `packages/llm` stays TypeScript. OK? Default: yes.
34. HR-zone coaching (R6) isn't built. Build it in TS now or wait for the Rust `guided` port? Default: wait, build once.
35. ~~Automerge hydration~~ Moot.
36. With liftoscript going to Rust, would you rather the run, math and engine also stay out of Rust and live in Kotlin on the phone (one phone language, accept the fork with the web)? Default: no, keep the Rust core so the three targets share one implementation.
37. Do you still want a one-day oracle dump for liftoscript before anything else is ported? Default: yes, it is the first step of the port.
