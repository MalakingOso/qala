# Research brief: starting strength, and the first year of lifting

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** The sources in section 10 were located and skimmed that day to show the brief is answerable and to name where the evidence sits. Most still need reading in full, and every number that reaches `docs/PLAN.md` must arrive as a sourced line with a tag, not copied from here.

Tags (same convention as the other reports): [RCT] randomised trial, [obs] observational/cohort, [meta] pooled analysis, [model] modelling study, [expert] expert opinion/coach practice, [secondary] number taken from a review, blog or calculator rather than the primary source, [weak] thin or contradictory evidence, [derived] number computed from the named anchors with the derivation shown.

## 1. Why a beginner path is not the current program with the numbers turned down

`docs/PLAN.md` section 6.3 builds volume targets on RP's landmarks "for intermediate lifters", and section 12's templates start at a 4x5 or 4x8 week 1 with a `referenceRm` already in hand. Three things break for someone who has never lifted:

- There is no reference 1RM to freeze. `docs/PLAN.md` section 3 (History) starts cold with population defaults for about six weeks, which is a fine bridge for someone resuming and useless for someone starting.
- RP's MV/MEV/MAV/MRV row is the intermediate column. The novice column is lower, and the difference matters most for a muscle nobody has trained: the first weeks are about tolerable volume and technique, not stimulus ranges.
- The default progression in section 6.3 is double progression plus a deload every 5-6 weeks. A true novice does not need a deload in the first block; they need the load to go up often enough to keep proving the muscle is trainable.

So this brief is not "the same plan, gentler". It has to answer what the first six months actually need, which is a different set of questions.

## 2. Volume: the novice landmarks

- Read RP's novice, intermediate and advanced columns for all muscles (RP's *Optimal Training* tables, and the table set republished by Greg Nuckols) and put them beside the intermediate table already in section 6.3. Decide whether Qala carries three columns in the engine or one column plus an experience scalar.
- The engine already has an `experience` generator input (`docs/PLAN.md` section 12). It is currently only consulted for main-lift frequency (section 12, "beginner 2-3x"). The question is how much of the volume model it should reach.
- Check what ACSM's current public guidance says about weekly sets per muscle group for beginners against the 10-20 band the owner settled on (T2, DECISIONS). ACSM's 2026 update press material claims 10-15 sets per muscle per week for beginners; that is [secondary] until the primary document is read, and it sits below the owner's floor, so the conflict has to be surfaced to the owner rather than resolved silently.
- Cumulative-fatigue question: does the fractional-set weighting (target 1.0, synergist 0.5) behave the same at novice volumes, where indirect work from a couple of full-body days is most of the training? A tag [derived] assumption either way.

## 3. Frequency and split

- Faigenbaum 2009 (ACSM position stand, MSSE 41:857) is the anchor: novice 2-3 d/wk for the whole body, intermediate 3-4, advanced 4-5. Confirm from the primary text and quote the evidence category.
- The generator already splits by days per week and has an `experience` input. What is missing is the split rule for a novice: 2 days is not the same shape as 3, and section 12's "2-3 full body, 4 upper/lower, 5-6 push/pull/legs" does not say which.
- Slot composition for a novice day: how many main-lift slots versus muscle slots, and which movements are safe to teach from cold. This pairs with the exercise selection rules in section 12 and the equipment match.

## 4. Progression scheme

- The open question is whether a novice should double progress or add load every session ("linear" in the coach sense, not the periodization sense). Sources to read: RP on novice linear progression, Zourdos 2016 (doi:10.1519/JSC.0000000000001165) on non-linear versus linear in trained lifters, Colquhoun 2017 meta-analysis on non-linear versus linear periodization (its conclusion is that the two are near-equivalent in trained lifters, which says little about novices and must not be borrowed for them), Moesgaard 2022 (already cited in section 12: undulating versus linear ES 0.06 untrained, 0.61 trained).
- In-session autoregulation (Helms 2018, already in section 6.3) presumes a lifter who can judge RPE meaningfully. For a novice, the honest default may be a fixed prescription for the first block with RPE recorded but not steering.
- Deload timing: section 12 plans a deload week every 5-6 weeks for everyone. Decide whether the first block for a novice ends in a deload or in a test week.

## 5. Starting weights with no 1RM

This is the piece with no research answer and the most product work.

- Options to evaluate: an estimated 1RM from a self-reported best (gym max or "how much can you deadlift"), a percentage of bodyweight for the main lifts, an initial fixed load followed by ramp sets and the +5 lb cadence, or a first-block "work up to a good set" session.
- Whichever is chosen, section 6.7's ramp generator already takes "neither reference 1RM nor e1RM" as a case: `I = 1 / (1 + (reps + RIR) / 30)`. A novice path should exercise that branch from day one, not as a fallback.
- The generator should write the chosen starting load into `programs[id].referenceRm` with `source` extended to a fourth value (today it is `kalman` or `tested`), so the block-frozen reference has an honest provenance.

## 6. Technique and ramp sets

- How much technique work a cold lifter needs before load, and whether Qala's ramp sets (section 6.7) are the right instrument or whether a novice needs tempo, pauses or a coached cue per rep.
- Whether the per-set `note` and the exercise notes feature (T9) are the right surface for technique cues that repeat every session.

## 7. Injury: what actually causes it in beginners

- The popular answer is "too much too soon". The brief needs the real distribution: acute load spikes, unfamiliar movement, technique breakdown under fatigue, insufficient recovery, training through joint pain, and the ego load that gets added on the last set.
- Note that the same question is being asked for running in `RESEARCH-run-plans-beginner-and-races.md` section 2, and the answer is contested there (Frandsen 2025). Share the read.
- What the app must do rather than warn about: the joint-pain tap (section 6.3 `injuryRisk` flag), the soreness grid (section 3, Check-in), the per-muscle reactive deload (section 6.3), and the injury skip that trains around a muscle (U24). Check each against a cold start, where there is no 4-week baseline to be below.
- Also read what the literature says about instruction and spotter use at the first exposure to the squat, deadlift and overhead press, since those are the movements in the beginner program by definition.

## 8. Nutrition

- Protein: Jäger 2017 (JISSN 14:20, doi:10.1186/s12970-017-0177-8) is the anchor at 1.4-2.0 g/kg/day for most exercising individuals, superseding Campbell 2007. Read the per-meal distribution claim rather than the abstract's range alone.
- Energy: surplus versus maintenance for hypertrophy in a novice, and what happens to a beginner who is also trying to run (see `RESEARCH-run-plans-beginner-and-races.md`). The engine has no nutrition state, and this brief should say whether that is deliberate.
- Creatine monohydrate: read the ISSN position stand (Antonio and Ciccone) and decide whether the coach may mention it inside the U8 envelope or whether it is out of scope for a product aimed at beginners.
- Alcohol, and the "eat enough to recover" advice that has no number behind it. Find whether any number exists.

## 9. Recovery, sleep and expectations

- Sleep and injury risk in lifters, and the effect Qala should have. Note that `settings.dailyWellness` (section 7) is off by default; decide whether the beginner path turns it on, and whether the readiness inputs should read a sleep field the user actually keeps.
- Time to visible results for a novice, by goal. This is the material for the podcast (section 11) and it is also the thing a beginner needs most from the app: the honest week-4 expectation, not the extreme case.
- The discouragement problem. C25K's dropout literature (in the running brief) is the closest analogue available and should be read before the beginner path is designed, not after.

## 10. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| Faigenbaum 2009, ACSM position stand, MSSE 41:857, doi:10.1249/MSS.0b013e3181915670 | Frequency by training level: novice 2-3 d/wk whole body, intermediate 3-4, advanced 4-5 | abstract and secondary reproductions located, primary not read |
| ACSM resistance training guidelines update, 2026 | Public guidance: all major muscle groups at least twice a week, 2-3 sets per exercise; a secondary summary claims 10-15 sets per muscle per week for beginners | [secondary] press material only; find the primary |
| Jäger 2017, JISSN 14:20, doi:10.1186/s12970-017-0177-8 | Protein 1.4-2.0 g/kg/day for most exercising individuals; per-meal distribution | abstract and open-access copy located |
| Campbell 2007, JISSN 4:50 (PMC2117006) | The original 1.4-2.0 range | superseded by Jäger 2017; keep for history only |
| Moesgaard 2022 (already cited in PLAN 12) | Undulating versus linear ES 0.06 untrained, 0.61 trained | in the plan; verify the citation at source |
| RP, *Optimal Training* | Novice/intermediate/advanced MV-MEV-MAV-MRV columns | not yet consulted for this brief |
| Frandsen 2025, PMC12421110 | "Too much, too soon" is widely accepted and thinly evidenced | read in full for the running brief, reuse here |

## 11. What has to come out of this brief

1. A novice volume table (columns, or one table plus a scalar) and the generator's `experience` reach into `packages/generator`.
2. The novice split rules for 2 and 3 days.
3. A progression scheme for the first block, and whether the first block ends in a deload or a test.
4. A starting-weight method and a fourth `referenceRm` source.
5. A cold-start pass over the soreness, joint-pain and deload rules in section 6.3.
6. Nutrition numbers the coach may state, each with a tag and a ceiling on the claim.
7. The honesty copy for week 4, which is also podcast material.
8. A test per rule above, in the shape of section 6.5.

## 12. Consumers

`docs/PLAN.md` 16d; `packages/generator` (section 12); `packages/engine` volume and progression rules (section 6.3); the Coach envelope (section 11); `docs/podcast/scripts/`, which cannot be recorded until section 11 item 7 and the injury and nutrition sections are sourced.