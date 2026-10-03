# Research brief: run plans for beginners and for race distances (Couch to 5K, 10K, marathon)

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** Section 7 lists what was located and skimmed that day. Anchors already carried by the plan (Minetti energy cost, rTSS, VDOT, critical speed, the 1.10x long-run rule, the 30% two-week distance rule) live in `RESEARCH-running.md` and `docs/PLAN.md` 6.4 and are not repeated here except where a beginner plan breaks them.

Tags: same convention as the other reports.

## 1. What the current generator cannot express

`docs/PLAN.md` section 12's run-plan rules assume a runner who already has a threshold pace: quality sessions are placed "at or near CS", the long run is bounded by 1.10x the longest run of the previous 30 days, and weekly distance never grows more than 30% across two weeks. All three assume history. A walk-run beginner has none of it, and two of the three are actively wrong for them:

- The 1.10x rule read literally means a first long run of any size is a 100% jump, which the engine would flag. For a cold runner the flag has no baseline to compare against.
- 30% weekly growth from zero is undefined.
- CS, VDOT and grade-adjusted pace all need at least one qualifying effort, and a walk-run interval session is not one.

So the beginner path needs its own prescription basis (section 3), and the engine's flags need a stated "no baseline" behaviour rather than silence.

## 2. The evidence base for walk-run progressions

- The NHS Couch to 5K is the reference shape every beginner plan borrows: 9 weeks, 3 runs per week, a brisk 5-minute walk to start, alternating run and walk intervals, at least a rest day between runs, and a final week of continuous runs (week 9 day 1 is a 5-minute walk then 25, 28 and 30 minutes). Published as an NHS booklet and mirrored by c25k and other apps. It is a public-health programme, not a trial.
- Relph 2023 (PMC10487403) is the important paper: it studies who completes the programme and links non-completion to musculoskeletal injury, and it reports a 64% dropout in its cohort with adherence reported elsewhere around 53 ± 27%. Read it in full before designing. Two design consequences are already visible: the plan has to survive contact with a life (skips are planned, not failures), and injury needs a fast exit, not a warning.
- Ceyssens 2019 injury rates in novice runners (the figure circulating in secondary summaries is around 27% over a year, roughly a quarter to a third of runners injured annually) should be read at source, and compared against what walk-run progressions report.
- Compare the interval progressions actually published (C25K, Jeff Galloway 9-week, "Run Walk Run", Hal Higdon's Novice, the walk-run plans in the BAA/British Athletics material) and find where they agree. Agreement among coach-authored plans is [expert] consensus, not evidence, and the brief should say so.
- Frandsen 2025 (PMC12421110) found the "too much too soon" model is widely accepted but poorly supported; high-risk distance jumps exist but the simple spike rule is not what the data shows. This matters because the engine's plan already rejects ACWR (6.4) and uses a 1.10x rule. If the evidence for the spike rule is thin, the honest outcome is to say the rule is a heuristic, keep it as a heuristic, and never present it as a finding.

## 3. Prescription basis for a beginner run plan

Three candidate bases, none of which is pace:

1. **Interval durations.** The plan is "1 minute running, 90 seconds walking, repeated", which is what C25K actually prescribes. Qala's `RunWorkout` has `steps` with `seconds`, so this fits the existing schema; what it does not fit is the meaning of the step kinds (`warmup | work | recover | cooldown`). A walk break is not a `recover` step in the current engine, and calling it one would put recovery colour on the interval chart. Decide the vocabulary, probably a `walk` kind and a per-step intensity tag.
2. **Talk test or RPE.** "Conversational" is the wording in every beginner plan and needs a numeric definition so the engine can check it. Qala has sRPE and an HR option; a beginner has neither reliably.
3. **Effort against a walk-run baseline.** Once the interval ratios are known, a session's difficulty is the ratio of running to walking time, which is a number the plan can progress without any pace at all. This is the cleanest fit for the existing schema and it is [derived].

## 4. Encoding "repeat a week until it passes"

C25K's own rule is to repeat any week you could not finish before moving on, and the published plan ends with two repetitions of week 9 day 1. Today `runPlans` is a fixed list of weeks and nothing in it can say "stay here until". This is the single biggest schema change in this brief:

- Add an advance rule to the week (`advance: { when: 'completed' | 'repeatUntilContinuous', continuousSeconds? }`) rather than duplicating weeks, so the plan stays readable and the Today screen can say why it is still on week 3.
- Decide whether the repetition is manual (the user says "I got through it") or automatic (a completed session whose last interval ran unbroken). Automatic is better for the user and worse for correctness, because the recorder's auto-pause can split a clean interval into pieces. Check the auto-pause thresholds in `docs/PLAN.md` 8a (0.6 m/s held 5 s, resume above 1.0 m/s held 3 s) against walk pace before relying on it.
- Interaction with skips (U24): a beginner plan is where skipping matters most, and a shifted week should never re-run a week already passed.

## 5. 10K

- Read the plan structures that actually agree: one quality session per week, mostly easy, a long run that reaches about 75-80% of race time, 6-10 weeks, a down week every third or fourth week. Those are coach consensus; find any trial or pooled analysis behind them before they become engine rules.
- Race pacing needs a starting estimate. `settings.run.recentRace` (section 7) already carries a recent race time and section 6.4 uses Riegel to turn it into a threshold pace before CS exists. Check Riegel's error at short distances: it is derived from marathon and 10 km performances, so applying it to a first-timer's goal pace needs an explicit caveat, and a first-timer has no recent race at all. The generator must therefore ask for either a recent time or a comfortable pace, and be honest that the plan is built on an estimate.
- The taper (section 12, two weeks, volume cut 41-60%) is written for a trained runner with a real base. Decide the 10K taper for a first-timer.

## 6. Marathon

- The evidence here is much better than for 10K, and 12-week plan reviews exist (for example Knopp 2024, PMC11065819, which pools 92 sub-elite 12-week plans). Read it and see how much agreement there is across 92 real plans, which is a stronger basis than any single-author plan.
- What the review says about the final 12 weeks is the part that transfers; what it says about the 16-20 weeks before that usually rests on one author's habits.
- Long-run progression, the cutback week, and the specific question of time on feet rather than distance. Qala records distance and time, so either is available; the evidence for injury may sit in one.
- Fuelling is a whole brief of its own: carbohydrate per hour, gut training, what is drinkable on a long run, and the fact that a beginner marathon plan is mostly about not getting 30 km wrong. Qala has no nutrition state today; decide whether the run plan carries fuelling notes as text on a workout step, and if so whether the step schema grows a `fueling` field.
- Taper and race-week pacing, and the interaction with `hybridPriority` (section 6.4): the marathon block is where "lift first, 24 h apart when strength is the priority" (section 6.4 table) does the most work, and where the 42 km rule (no heavy lower body for 5 days) needs to become a race-week rule.

## 7. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| NHS Couch to 5K booklet (Better Health page and the BBC Scotland printable PDF) | 9 weeks, 3 runs/wk, walk-run intervals, warm-up walk, repeat-until-passed rule, week 9 as 25/28/30 min continuous | plan text located, primary read |
| Relph 2023, PMC10487403, "Couch-to-5K or Couch to Ouch to Couch!?" | 64% dropout in the cohort; non-completion linked to musculoskeletal injury; the programme "lacks an evidence base" | abstract and figures located, full text not read |
| Ceyssens 2019 | Injury incidence in novice runners (about 27%/yr in secondary summaries) | secondary summaries only; find the primary |
| Frandsen 2025, PMC12421110 | The "too much too soon" model is widely accepted and thinly evidenced; distance jumps are the high-risk factor | read in full for `RESEARCH-running.md` work; reuse |
| Knopp 2024, PMC11065819 | Pooled quantitative review of 92 sub-elite 12-week marathon plans | abstract located; full pool not analysed yet |
| Galloway, Higdon, Run Walk Run and the British Athletics material | The competing interval progressions | coach plans, [expert]; compare where they agree |

## 8. What has to come out of this brief

1. A `walk` step kind and an intensity tag, or a documented alternative, in the `RunWorkout` schema (section 7).
2. A week advance rule, with the auto-pause interaction checked.
3. A first-runner prescription basis (section 3) that does not need a threshold pace.
4. Defined "no baseline" behaviour for the 1.10x and 30% flags, and an honest label on them.
5. The 10K plan shape, its taper, and what the generator asks when there is no recent race.
6. The marathon plan shape from the pooled review, the long-run rule in time or distance, and the race-week rules against the hybrid table.
7. Whether fuelling is text on a step or a new field.
8. Adherence design: the dropout evidence says the plan has to survive a life. That is a product requirement, not a research finding, and it belongs in the build plan as such.

## 9. Consumers

`docs/PLAN.md` 16c; `packages/generator` run plans (section 12); `packages/run/guided.ts` and the step machine (8a, 16a); the `runPlans` schema in section 7; `docs/podcast/scripts/` for the walk-run episode.