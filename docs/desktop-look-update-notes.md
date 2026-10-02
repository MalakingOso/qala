# Desktop look update: notes for the morning

Written 2026-10-01 night, after implementing the refined desktop look on `main`. This is the list of things I was unsure about and what I did instead of asking. Skim the first section, then the questions.

## Where the work is

- It is on `main`, in a separate worktree at `/home/berkley/Programming/qala-main`. Your main checkout was on `android-kotlin` with another Claude session running in it, and a branch can only be checked out in one place, so I did not switch it. `apps/web/node_modules` in the worktree is a symlink to the original (excluded in `.git/info/exclude`).
- To look at it: `cd /home/berkley/Programming/qala-main/apps/web && npx vite`, then open `#/desktop/overview`.
- The commits are local. Nothing is pushed. No attribution lines, per your CLAUDE.md.
- To get `main` back in the original checkout later: finish or park `android-kotlin`, `git worktree remove ../qala-main`, then `git checkout main`.

## What changed

- A numbered sidebar under the Qk icon, a toolbar (search, week switcher, Workout view), and a lede card on every desktop page (kicker, title, ink rule). Cards have a resting shadow, tables are dense with LIFT and RUN tags and PR and note pills.
- Overview is now Week in review. The week chart shows three weeks with one in focus (week 2 left, week 3 now, week 4 right): everything before today on a gray wash, today on an ember edge, the future week dashed, the focused week at full strength.
- Body uses the real recovery map, front and back side by side, with the fatigue curve under it.
- Lifts, Running, History, Programs, Exercises, Coach memory, Calibration and Settings were redesigned from what each page already held. Lift, run, session and muscle detail pages got the new header only.
- Decisions are recorded as L16 and U20 to U23 in `DECISIONS.md`, and DESIGN.md 3.1, 6.3 and 7.15 are updated.
- The phone shell, `tokens.css` and the Kotlin app are untouched. All new CSS is in `apps/web/src/theme/desktop.css`, scoped to `.page-desktop`, built on existing tokens, so dark mode works (checked).

## Questions I answered myself, please confirm or overrule

1. **Which sans?** I used a system stack (`--font-ui`, first line of `desktop.css`), the same stack Muse's mockups used. It will look different on every OS. Pick a face and it is a one-line change plus a font file. Titles and big figures use Qala Test (Muse's Georgia was a stand-in for it).
2. **Chip shape.** Muse's filter chips were pills. L1 says no pill radius anywhere, so mine are 4px rounded. Say if you want the pills.
3. **No avatar.** Qala has no accounts, so I left out the round "B". The toolbar search and week switcher are new behavior, not in the app before. Search only navigates (pages, lifts, exercises, sessions; Ctrl or Cmd K). The week switcher only moves the focus among the three loaded weeks.
4. **Past versus future look.** You said weeks 2 and 4 should read clearly. I read week 2 as past and week 4 as the plan, so week 4 is dashed rather than "past". Week 4 was "behind" in your words; if you meant both flanks as history, that is a different treatment.
5. **Deload in week 6.** Muse's copy said "deload next week". Body's existing text says "Next planned: week 6", so I used week 6 everywhere. The block bar shows it as the outlined cell.
6. **Muse's numbers I did not use.** "+1.5 vs plan", run paces, and the "holds at 245 next week" quote are not in the app's data. Overview uses the data (6 sessions, readiness +8 clear, 11.0 miles, VDOT +2.0) and the phone's own coach sentence.
7. **Chart title kept in the ribbon.** The week ribbon still carries its "Weekly load" title and Table toggle (the shared chart shell). Easy to hide if it reads as clutter.

## Sample data I changed, and conflicts I found

- Upper A was dated Sep 6, a Sunday before the Mon to Sun week, so the sessions list and the week bars disagreed (Monday's bar had no session). I changed its date to Sep 7. The phone's exercise note dated Sep 6 is unchanged.
- Weeks 2 and 4 are invented sample numbers (`sampleWeeks` in `store/sample.ts`). Week 3 is a copy of the existing sample week with Sunday's lift done (510), because the session list already has Lower A logged. The phone's `sampleWeekLoad` is untouched because a test pins its totals.
- **Unresolved conflict:** the phone's Today still shows the lift as "now" (`sampleStages`) while the desktop says "Lower A complete". Both come from the sample; I did not touch the phone's stages.
- Programs' week preview used to be Tue, Thu, Fri, Sun. I moved it to Mon, Wed, Fri, Sun plus the runs, to match the week's sessions.
- Calibration shows the sample's theta "4.0 (prior)" next to lifts that have 34, 31 and 22 observations, even though theta frees at 20. I kept the app's values, so the page contradicts itself until the sample or the engine changes.
- The recovery map's wording ("Ready Sat") uses the real clock, not the sample's Sunday, as before. It will read differently on different days.

## What a real build still needs

- The engine has to supply the previous and next week's `WeekLoad` (see `store/types.ts`). Today `shell-desktop/weekFocus.tsx` reads `sampleWeeks`.
- "Generate next block" is not wired (it was not before). "Add exercise" does not exist, so the Exercises page only says how custom entries work. Hide and the filters keep their state only while the page is open.
- The coach flag, notes and Accept or Reject still write through the existing store, and I checked that they still work.

## Housekeeping

- Service worker cache bumped to `qala-v3` so installed copies pick up the new CSS.
- Old desktop-only shell rules were removed from `index.css` (`.sidebar`, `.desktop-*`). `.toolbar-link` stays because the landing page uses it.
- Checks run: `tsc --noEmit` clean; `vite build` clean; `deno test --allow-read src/logic/` 19 passed (the contrast test needs `--allow-read`, nothing to do with this work); `deno fmt` on the files I touched. `deno lint` has one problem left, in `MuscleRun.tsx` (`axisLabel={"V̇"}`), which was already there; the autofix would break the escape, so I left it.
- I looked at every desktop route at 1440, 1000 and 600 pixels wide, Overview in dark, and clicked through search, the week switcher, filters, Accept and Dismiss. There are no automated visual tests, and I did not test with a screen reader.
- Muse's three mockup files in `mockups/` are untracked and untouched. The Claude canvas link from earlier is a separate artifact and was not updated.
