# Research briefs

Four briefs in one file. Each one says at the top that nothing in it is a finding yet: the sources were located and skimmed, and every number that reaches `docs/PLAN.md` must arrive as a sourced line with a tag, not copied from here. The evidence reports are separate; see `README.md` in this folder.

Contents: 1 starting strength, 2 body composition, 3 mindfulness, 4 beginner and race run plans.


## Brief 1. Starting strength and the first year of lifting

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** The sources in section 10 were located and skimmed that day to show the brief is answerable and to name where the evidence sits. Most still need reading in full, and every number that reaches `docs/PLAN.md` must arrive as a sourced line with a tag, not copied from here.

Tags (same convention as the other reports): [RCT] randomised trial, [obs] observational/cohort, [meta] pooled analysis, [model] modelling study, [expert] expert opinion/coach practice, [secondary] number taken from a review, blog or calculator rather than the primary source, [weak] thin or contradictory evidence, [derived] number computed from the named anchors with the derivation shown.

### 1. Why a beginner path is not the current program with the numbers turned down

`docs/PLAN.md` section 6.3 builds volume targets on RP's landmarks "for intermediate lifters", and section 12's templates start at a 4x5 or 4x8 week 1 with a `referenceRm` already in hand. Three things break for someone who has never lifted:

- There is no reference 1RM to freeze. `docs/PLAN.md` section 3 (History) starts cold with population defaults for about six weeks, which is a fine bridge for someone resuming and useless for someone starting.
- RP's MV/MEV/MAV/MRV row is the intermediate column. The novice column is lower, and the difference matters most for a muscle nobody has trained: the first weeks are about tolerable volume and technique, not stimulus ranges.
- The default progression in section 6.3 is double progression plus a deload every 5-6 weeks. A true novice does not need a deload in the first block; they need the load to go up often enough to keep proving the muscle is trainable.

So this brief is not "the same plan, gentler". It has to answer what the first six months actually need, which is a different set of questions.

### 2. Volume: the novice landmarks

- Read RP's novice, intermediate and advanced columns for all muscles (RP's *Optimal Training* tables, and the table set republished by Greg Nuckols) and put them beside the intermediate table already in section 6.3. Decide whether Qala carries three columns in the engine or one column plus an experience scalar.
- The engine already has an `experience` generator input (`docs/PLAN.md` section 12). It is currently only consulted for main-lift frequency (section 12, "beginner 2-3x"). The question is how much of the volume model it should reach.
- Check what ACSM's current public guidance says about weekly sets per muscle group for beginners against the 10-20 band the owner settled on (T2, DECISIONS). ACSM's 2026 update press material claims 10-15 sets per muscle per week for beginners; that is [secondary] until the primary document is read, and it sits below the owner's floor, so the conflict has to be surfaced to the owner rather than resolved silently.
- Cumulative-fatigue question: does the fractional-set weighting (target 1.0, synergist 0.5) behave the same at novice volumes, where indirect work from a couple of full-body days is most of the training? A tag [derived] assumption either way.

### 3. Frequency and split

- Faigenbaum 2009 (ACSM position stand, MSSE 41:857) is the anchor: novice 2-3 d/wk for the whole body, intermediate 3-4, advanced 4-5. Confirm from the primary text and quote the evidence category.
- The generator already splits by days per week and has an `experience` input. What is missing is the split rule for a novice: 2 days is not the same shape as 3, and section 12's "2-3 full body, 4 upper/lower, 5-6 push/pull/legs" does not say which.
- Slot composition for a novice day: how many main-lift slots versus muscle slots, and which movements are safe to teach from cold. This pairs with the exercise selection rules in section 12 and the equipment match.

### 4. Progression scheme

- The open question is whether a novice should double progress or add load every session ("linear" in the coach sense, not the periodization sense). Sources to read: RP on novice linear progression, Zourdos 2016 (doi:10.1519/JSC.0000000000001165) on non-linear versus linear in trained lifters, Colquhoun 2017 meta-analysis on non-linear versus linear periodization (its conclusion is that the two are near-equivalent in trained lifters, which says little about novices and must not be borrowed for them), Moesgaard 2022 (already cited in section 12: undulating versus linear ES 0.06 untrained, 0.61 trained).
- In-session autoregulation (Helms 2018, already in section 6.3) presumes a lifter who can judge RPE meaningfully. For a novice, the honest default may be a fixed prescription for the first block with RPE recorded but not steering.
- Deload timing: section 12 plans a deload week every 5-6 weeks for everyone. Decide whether the first block for a novice ends in a deload or in a test week.

### 5. Starting weights with no 1RM

This is the piece with no research answer and the most product work.

- Options to evaluate: an estimated 1RM from a self-reported best (gym max or "how much can you deadlift"), a percentage of bodyweight for the main lifts, an initial fixed load followed by ramp sets and the +5 lb cadence, or a first-block "work up to a good set" session.
- Whichever is chosen, section 6.7's ramp generator already takes "neither reference 1RM nor e1RM" as a case: `I = 1 / (1 + (reps + RIR) / 30)`. A novice path should exercise that branch from day one, not as a fallback.
- The generator should write the chosen starting load into `programs[id].referenceRm` with `source` extended to a fourth value (today it is `kalman` or `tested`), so the block-frozen reference has an honest provenance.

### 6. Technique and ramp sets

- How much technique work a cold lifter needs before load, and whether Qala's ramp sets (section 6.7) are the right instrument or whether a novice needs tempo, pauses or a coached cue per rep.
- Whether the per-set `note` and the exercise notes feature (T9) are the right surface for technique cues that repeat every session.

### 7. Injury: what actually causes it in beginners

- The popular answer is "too much too soon". The brief needs the real distribution: acute load spikes, unfamiliar movement, technique breakdown under fatigue, insufficient recovery, training through joint pain, and the ego load that gets added on the last set.
- Note that the same question is being asked for running in brief 4, section 2 of this file, and the answer is contested there (Frandsen 2025). Share the read.
- What the app must do rather than warn about: the joint-pain tap (section 6.3 `injuryRisk` flag), the soreness grid (section 3, Check-in), the per-muscle reactive deload (section 6.3), and the injury skip that trains around a muscle (U24). Check each against a cold start, where there is no 4-week baseline to be below.
- Also read what the literature says about instruction and spotter use at the first exposure to the squat, deadlift and overhead press, since those are the movements in the beginner program by definition.

### 8. Nutrition

- Protein: Jäger 2017 (JISSN 14:20, doi:10.1186/s12970-017-0177-8) is the anchor at 1.4-2.0 g/kg/day for most exercising individuals, superseding Campbell 2007. Read the per-meal distribution claim rather than the abstract's range alone.
- Energy: surplus versus maintenance for hypertrophy in a novice, and what happens to a beginner who is also trying to run (see brief 4 of this file). The engine has no nutrition state, and this brief should say whether that is deliberate.
- Creatine monohydrate: read the ISSN position stand (Antonio and Ciccone) and decide whether the coach may mention it inside the U8 envelope or whether it is out of scope for a product aimed at beginners.
- Alcohol, and the "eat enough to recover" advice that has no number behind it. Find whether any number exists.

### 9. Recovery, sleep and expectations

- Sleep and injury risk in lifters, and the effect Qala should have. Note that `settings.dailyWellness` (section 7) is off by default; decide whether the beginner path turns it on, and whether the readiness inputs should read a sleep field the user actually keeps.
- Time to visible results for a novice, by goal. This is the material for the podcast (section 11) and it is also the thing a beginner needs most from the app: the honest week-4 expectation, not the extreme case.
- The discouragement problem. C25K's dropout literature (in the running brief) is the closest analogue available and should be read before the beginner path is designed, not after.

### 10. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| Faigenbaum 2009, ACSM position stand, MSSE 41:857, doi:10.1249/MSS.0b013e3181915670 | Frequency by training level: novice 2-3 d/wk whole body, intermediate 3-4, advanced 4-5 | abstract and secondary reproductions located, primary not read |
| ACSM resistance training guidelines update, 2026 | Public guidance: all major muscle groups at least twice a week, 2-3 sets per exercise; a secondary summary claims 10-15 sets per muscle per week for beginners | [secondary] press material only; find the primary |
| Jäger 2017, JISSN 14:20, doi:10.1186/s12970-017-0177-8 | Protein 1.4-2.0 g/kg/day for most exercising individuals; per-meal distribution | abstract and open-access copy located |
| Campbell 2007, JISSN 4:50 (PMC2117006) | The original 1.4-2.0 range | superseded by Jäger 2017; keep for history only |
| Moesgaard 2022 (already cited in PLAN 12) | Undulating versus linear ES 0.06 untrained, 0.61 trained | in the plan; verify the citation at source |
| RP, *Optimal Training* | Novice/intermediate/advanced MV-MEV-MAV-MRV columns | not yet consulted for this brief |
| Frandsen 2025, PMC12421110 | "Too much, too soon" is widely accepted and thinly evidenced | read in full for the running brief, reuse here |

### 11. What has to come out of this brief

1. A novice volume table (columns, or one table plus a scalar) and the generator's `experience` reach into `packages/generator`.
2. The novice split rules for 2 and 3 days.
3. A progression scheme for the first block, and whether the first block ends in a deload or a test.
4. A starting-weight method and a fourth `referenceRm` source.
5. A cold-start pass over the soreness, joint-pain and deload rules in section 6.3.
6. Nutrition numbers the coach may state, each with a tag and a ceiling on the claim.
7. The honesty copy for week 4, which is also podcast material.
8. A test per rule above, in the shape of section 6.5.

### 12. Consumers

`docs/PLAN.md` 16d; `packages/generator` (section 12); `packages/engine` volume and progression rules (section 6.3); the Coach envelope (section 11); `docs/podcast/scripts/`, which cannot be recorded until section 11 item 7 and the injury and nutrition sections are sourced.


## Brief 2. Body composition measurement

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** Section 6 lists what was located and skimmed. The owner's position going in: stop treating the daily scale as the primary signal, get a reference measurement (DEXA), and track against that plus what the training actually does.

Tags: same convention as the other reports.

### 1. Why this is a product question and not a diatribe

The app is going to tell a person what they actually gained. That means the app needs a definition of "gained", and a defensible answer has to survive contact with measurement error. Three consequences:

- **Daily weight is noise and should be shown as a trend, not a number.** The scale reading on a given morning carries a day-to-day swing that is the same size as the change a beginner is trying to detect.
- **A reference measurement is sparse.** DEXA is a quarterly event for most people, not a daily one, so the app's job is to hold the gap between scans and make the in-between honest.
- **Composition is not size.** A kilo of fat and a kilo of muscle are different objects with different training implications, and only some measurements distinguish them. The app must not offer a number it cannot stand behind.

This is also the topic of one of the beginner podcast episodes, so the brief has to be finished before that script is final.

### 2. What DXA actually measures, and what "lean mass" means

- DXA is a three-compartment method: it reports fat mass, fat-free mass and bone mineral content, with the fat-free compartment including water. It is the reference method for body composition in sport science, and the reason it is the reference is repeatability across visits, not that it separates muscle from water or organ from connective tissue.
- **The hydration assumption.** DXA estimates fat-free tissue as a fixed hydration state. Change the hydration of the fat-free compartment and the reading moves even when nothing about the body changed. Vendor literature puts a 5% hydration variation in fat-free mass at roughly a 3% shift in the reading; that number is marketing-adjacent and must be traced to a primary study or dropped.
- **Lean mass is not muscle.** Tavoian 2019 (Sci Rep, doi:10.1038/s41598-019-46428-w) compared DXA-derived lean mass against MRI cross-sectional muscle area over time and found only a modest association between the two measures of change. That is the single most important caveat for this project, because the entire pitch of a DEXA scan to a lifter is "did I add muscle".
- What DXA is good at: comparing fat mass and fat-free mass against your own previous scan, on the same machine, at a similar time of day and in a similar hydration state. What it is not good at: telling you which part of your body the fat is on beyond its regional estimates, and anything at all about how you feel.
- Radiation dose: find the primary figure and cite it. The brief should not state a dose it cannot source, and the podcast script should not either.
- Between-scan conditions are the whole ballgame: same machine if possible, same time of day, fasted, and the hydration question above acknowledged out loud.

### 3. The other methods, and why the app should rank them

- Skinfolds: cheap, no radiation, an operator skill problem. Needs its own error figure from a primary source.
- Bioelectrical impedance (the bathroom scale with electrodes): nearly worthless for day-to-day change and very sensitive to hydration, food, sodium and recent exercise. Worth reading enough to explain in one sentence why the consumer number and the DXA number disagree.
- Air displacement (Bod Pod) and hydrostatic weighing: where they sit between DXA and skinfolds.
- Anthropometrics: circumference measurements and progress photos. These are free, repeatable at home and directly relevant to how a person looks, which is what most people actually care about. They are also the measurement a beginner can sustain for a year. The app should probably treat these as first-class alongside DXA, not as a consolation prize.
- Which methods the app will accept as a user entry, and what confidence label each one gets, is the decision this brief has to support.

### 4. The daily-weight problem, sourced

- Total body water in healthy adults fluctuates by around ±5% day to day (Bhutani 2017, PMC5506524), and body glycogen and its bound water is a large part of that swing, with sodium and gut contents on top.
- Secondary sources put the typical daily weight swing at 1-5 lb, with larger people and higher-sodium days at the top of the range. Those are clinic and vendor pages; find the primary or present the number as a range of reported experience rather than a finding.
- The behavioural literature on daily weighing is where the podcast lives: what weighing every day does to people who are trying to change their body composition, and why a weekly average of a daily number is a different measurement than a daily number.
- Read the self-monitoring literature properly rather than asserting a harm. If daily weighing is fine for some people and corrosive for others, the app should say that and default to the weekly trend.

### 5. What the app should hold

Sketch of the record shape, for `docs/PLAN.md` section 7 to accept or reject:

```
bodyScans: [ { id, date, method: 'dexa' | 'skinfold' | 'bia' | 'airDisplacement' | 'hydrostatic' | 'estimate',
               fatMassKg?, fatFreeMassKg?, boneMineralContentG?, fatPercent?, notes,
               machineOrOperator?, protocol?: 'fasted'|'standard'|'unknown', source: 'user'|'import' } ],
bodyMeasures: [ { id, date, weightKg?, waistCm?, chestCm?, hipsCm?, thighCm?, armCm?, photoIds?, note } ],
weightTrend: derived, never stored   // rolling mean of the last 7 daily entries, plus the SD, shown as a band
```

Questions this raises, all for the brief rather than the build:

- Should `bodyScans` be a sync record? It is small, immutable and comparable across devices, so yes under the S11 shape. Confirm against `docs/rust-core.md` 4.
- Where does `weightTrend` get computed, and what window? Seven daily entries is [derived]; a 14-day window reacts more slowly and suits a cut.
- What does the engine do with a trend? Nothing, probably: `packages/engine` is a fatigue and performance model, and body composition is not fatigue. Say so explicitly so nobody later adds a calorie burn from it.
- The Body tab (U22) currently shows the recovery map and per-muscle fatigue. A body composition section needs to not fight that for the same screen.
- Photos are blobs like GPS tracks (S9), with the same content-addressing argument and a different privacy answer: a body photo is the most sensitive thing this app will ever hold. Decide the retention story before the field exists.

### 6. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| Shepherd 2017, PMC5659281, "Body Composition by DXA" | Reviews of DXA as a method, including the difficulty of validating absolute calibration against true muscle and fat | open-access copy located |
| Kim 2024, Clin Pediatr Pract (doi:10.36011/cpp.2024.6.e13) | DXA as the three-compartment gold standard in a clinical context | abstract located |
| Tavoian 2019, Sci Rep, doi:10.1038/s41598-019-46428-w | DXA-derived lean mass changes only modestly track MRI cross-sectional muscle area changes | abstract located; this is the load-bearing citation |
| Bhutani 2017, PMC5506524 | Total body water fluctuates up to ±5% daily in healthy individuals | abstract located |
| Dexalytics and BodySpec vendor pages | SEM of measurement about 2.5-3.5% for DXA; 1-5 lb typical daily weight swing; the 5% hydration variation shifting readings ~3% | [secondary] vendor material, to be traced to primaries or dropped |
| UC Davis Health, Bod Pod, BodySpec | Method descriptions and inter-method positioning | [secondary] institutional pages |

### 7. What has to come out of this brief

1. The ranked list of measurement methods the app accepts, each with a sourced precision and the conditions under which it is comparable.
2. The hydration and "lean mass is not muscle" caveats in plain language, reusable in the app and in the podcast script.
3. A sourced position on daily weighing, and the weekly-trend default that follows from it.
4. The record shapes in section 5, with the photo-retention answer.
5. The copy for the gap between scans: what the app can honestly say after eight weeks with no measurement.
6. The "what a kilo of fat and a kilo of muscle actually are" numbers, sourced, which both the app and the script need.

### 8. Consumers

`docs/PLAN.md` 16f; the Body tab (U22); the `settings` and record schema in section 7; `docs/podcast/scripts/` for the body-composition episode.


## Brief 3. Mindfulness at the start of a workout

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** Section 6 lists what was located and skimmed.

Tags: same convention as the other reports.

### 1. The product question, stated plainly

The owner wants a recommendation, not an implementation: before a workout, point people at **Headspace** and at **Waking Up** (Sam Harris's app, wakingup.com, founded 2018) as the starting point. So the first job is the product's own boundary, and only the second job is research.

The boundary: Qala is a training log, a planner and an adaptive engine. It is not a meditation teacher and it should not try to become one. The evidence for mindfulness in sport (section 2) is thin and mostly about anxiety and performance surrogates, not about injury, not about adherence, and not about any of the things Qala's engine can measure. If Qala grows its own meditation content it will be inventing a curriculum it has no standing to invent. So the shape to build is a short, warm, specific recommendation with a one-tap link out, and nothing else.

That recommendation still needs to be *right*, which is what the rest of this brief is for: how long, how often, at which point in the session, and what to say about it.

### 2. What the evidence does and does not say

- Wang 2023 (PMC9915077), systematic review and meta-analysis of RCTs, reports that a mindfulness-acceptance-commitment approach improves athletic performance and reduces experiential avoidance. Si 2024 (Front Psychol, doi:10.3389/fpsyg.2024.1375608) is a meta-analysis of mindfulness training on athletes' performance. Xie 2025 is a recent review reporting mostly positive trends. Tierney's systematic review reports that the effects on performance are largely indirect, arriving through sport anxiety and flow.
- Read these four and state, precisely, what the pooled effect is on what. The likely honest summary: a small-to-moderate effect on self-reported anxiety and on performance surrogates, in programmes run over weeks, in people who already practise. That is not nothing. It is also not a promise.
- What none of it support: that a short practice at the start of a workout prevents injury; that it replaces sleep; that it makes an amateur faster. Any app copy that implies those is making a claim the literature does not carry, and the copy needs to survive a reader who goes looking.
- Dose: almost all of the intervention literature is daily practice over 4 to 8 weeks, not a 3-minute sit before one session. The thing Qala is proposing sits at the edge of the evidence, and the honest framing is that it is a low-stakes habit borrowed from a well-studied practice, not a dosed intervention. Both meditation apps are built around the daily version, which is also the version that has evidence.
- Breath work is a separate literature from mindfulness practice (physiological sighs, slow-paced breathing, respiratory sinus arrhythmia, vagal tone) and it is the part most likely to have an acute, in-session effect. It is also the part Qala could plausibly do in-app without becoming a meditation app. Read it on its own terms rather than borrowing mindfulness conclusions for it.

### 3. Where in the session

The Today rail already has stages (`docs/CONTEXT.md`): check-in, warm-up, lift, recover, run, wind down. Two placements are candidates, and they are not the same decision:

- **Before the warm-up.** The session has not started, the athlete is not yet physically loaded, and this is where an app can hold attention for a few minutes without eating warm-up time (the warm-up has a time budget T in `docs/PLAN.md` 6.7 and cutting it is bad).
- **The wind-down stage.** The rail already has one, and it is the honest home for a habit that is about the whole day rather than about the set about to be lifted.

Recommendation to bring to the owner: keep the rail as it is, put the recommendation on the pre-workout screen as an optional line, and let the wind-down stage be the durable home. A new rail stage for an optional habit would be a stage most days is empty.

### 4. What the app says

Constraints that come from the decisions already made:

- No diagnosing (section 6.3 flags are rule-based and never diagnostic). Same rule for this.
- The Coach is bounded to fitness, training, health and recovery and declines the rest (U8). Meditation questions sit inside that envelope, so the Coach may answer them; it must not become the place the curriculum lives.
- No affiliate links and no referral codes without the owner deciding to (queued in `docs/decisions-pending.md`). Recommending a paid app is exactly the place where that matters.
- The apps are third parties with their own content, including a large non-dual curriculum in Waking Up. Qala should describe what each one is in one sentence and let the user choose, including choosing neither.

### 5. The open questions

- One-tap to the app, or a deep link to a specific track? Both apps expose deep links, and a deep link to a beginner sitting is more useful than a deep link to their home screen. Check what each app actually supports on Android and what the app store policy is about launching another app for this.
- What is the fallback when the user does not want or cannot install an app? A 60-second breathing routine in-app is the minimum that keeps the promise without pretending to be the curriculum. Decide whether Qala ships it; it is a small, self-contained feature that needs no research beyond section 2's breath-work read.
- Does the reminder respect the same rules as the rest of the app? `settings.dailyWellness` is off by default and the app has no push service to speak of; a mindfulness nudge that needs notification infrastructure is a bigger build than it looks.
- Nothing here should touch `readiness`, `prs` or any engine input. Say that in the plan so a future agent does not wire it in.

### 6. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| Wang 2023, PMC9915077 | Systematic review and meta-analysis of RCTs: mindfulness-acceptance-commitment improves athletic performance, reduces experiential avoidance | abstract and figures located |
| Si 2024, Front Psychol, doi:10.3389/fpsyg.2024.1375608 | Meta-analysis of mindfulness training on athletes' performance | abstract located |
| Xie 2025, S1728869X2500053 | Recent review of mindfulness-based interventions in sport, positive trends across performance, mindfulness and mental-health outcomes | abstract located |
| Tierney, systematic review (UKnowledge copy) | Effects on performance are largely indirect, via sport anxiety and flow | secondary copy of an unpublished or grey-literature review; find the primary |
| wakingup.com, about page | Waking Up is Sam Harris's non-dual meditation app, founded 2018, 600+ hours from dozens of teachers, daily lesson format | first-party page |
| Headspace, app listing | Meditation and sleep app; the everyday, non-religious framing that matches Waking Up's secular tone | app listing only |

### 7. What has to come out of this brief

1. A sourced statement of what mindfulness practice does for athletes, in three sentences the app can print and a podcast script can say, with the limits stated in the same breath.
2. The acute breath-work read, separated from practice over weeks.
3. A recommendation for or against an in-app breathing fallback.
4. The copy for both apps, and what Qala says when the user wants neither.
5. A list of claims the copy must not make.

### 8. Consumers

`docs/PLAN.md` 16e; the Today stages (`docs/CONTEXT.md`); the Coach envelope (section 11); `docs/podcast/scripts/` for the episode on starting a session.


## Brief 4. Run plans for beginners and race distances

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** Section 7 lists what was located and skimmed that day. Anchors already carried by the plan (Minetti energy cost, rTSS, VDOT, critical speed, the 1.10x long-run rule, the 30% two-week distance rule) live in `RESEARCH-running.md` and `docs/PLAN.md` 6.4 and are not repeated here except where a beginner plan breaks them.

Tags: same convention as the other reports.

### 1. What the current generator cannot express

`docs/PLAN.md` section 12's run-plan rules assume a runner who already has a threshold pace: quality sessions are placed "at or near CS", the long run is bounded by 1.10x the longest run of the previous 30 days, and weekly distance never grows more than 30% across two weeks. All three assume history. A walk-run beginner has none of it, and two of the three are actively wrong for them:

- The 1.10x rule read literally means a first long run of any size is a 100% jump, which the engine would flag. For a cold runner the flag has no baseline to compare against.
- 30% weekly growth from zero is undefined.
- CS, VDOT and grade-adjusted pace all need at least one qualifying effort, and a walk-run interval session is not one.

So the beginner path needs its own prescription basis (section 3), and the engine's flags need a stated "no baseline" behaviour rather than silence.

### 2. The evidence base for walk-run progressions

- The NHS Couch to 5K is the reference shape every beginner plan borrows: 9 weeks, 3 runs per week, a brisk 5-minute walk to start, alternating run and walk intervals, at least a rest day between runs, and a final week of continuous runs (week 9 day 1 is a 5-minute walk then 25, 28 and 30 minutes). Published as an NHS booklet and mirrored by c25k and other apps. It is a public-health programme, not a trial.
- Relph 2023 (PMC10487403) is the important paper: it studies who completes the programme and links non-completion to musculoskeletal injury, and it reports a 64% dropout in its cohort with adherence reported elsewhere around 53 ± 27%. Read it in full before designing. Two design consequences are already visible: the plan has to survive contact with a life (skips are planned, not failures), and injury needs a fast exit, not a warning.
- Ceyssens 2019 injury rates in novice runners (the figure circulating in secondary summaries is around 27% over a year, roughly a quarter to a third of runners injured annually) should be read at source, and compared against what walk-run progressions report.
- Compare the interval progressions actually published (C25K, Jeff Galloway 9-week, "Run Walk Run", Hal Higdon's Novice, the walk-run plans in the BAA/British Athletics material) and find where they agree. Agreement among coach-authored plans is [expert] consensus, not evidence, and the brief should say so.
- Frandsen 2025 (PMC12421110) found the "too much too soon" model is widely accepted but poorly supported; high-risk distance jumps exist but the simple spike rule is not what the data shows. This matters because the engine's plan already rejects ACWR (6.4) and uses a 1.10x rule. If the evidence for the spike rule is thin, the honest outcome is to say the rule is a heuristic, keep it as a heuristic, and never present it as a finding.

### 3. Prescription basis for a beginner run plan

Three candidate bases, none of which is pace:

1. **Interval durations.** The plan is "1 minute running, 90 seconds walking, repeated", which is what C25K actually prescribes. Qala's `RunWorkout` has `steps` with `seconds`, so this fits the existing schema; what it does not fit is the meaning of the step kinds (`warmup | work | recover | cooldown`). A walk break is not a `recover` step in the current engine, and calling it one would put recovery colour on the interval chart. Decide the vocabulary, probably a `walk` kind and a per-step intensity tag.
2. **Talk test or RPE.** "Conversational" is the wording in every beginner plan and needs a numeric definition so the engine can check it. Qala has sRPE and an HR option; a beginner has neither reliably.
3. **Effort against a walk-run baseline.** Once the interval ratios are known, a session's difficulty is the ratio of running to walking time, which is a number the plan can progress without any pace at all. This is the cleanest fit for the existing schema and it is [derived].

### 4. Encoding "repeat a week until it passes"

C25K's own rule is to repeat any week you could not finish before moving on, and the published plan ends with two repetitions of week 9 day 1. Today `runPlans` is a fixed list of weeks and nothing in it can say "stay here until". This is the single biggest schema change in this brief:

- Add an advance rule to the week (`advance: { when: 'completed' | 'repeatUntilContinuous', continuousSeconds? }`) rather than duplicating weeks, so the plan stays readable and the Today screen can say why it is still on week 3.
- Decide whether the repetition is manual (the user says "I got through it") or automatic (a completed session whose last interval ran unbroken). Automatic is better for the user and worse for correctness, because the recorder's auto-pause can split a clean interval into pieces. Check the auto-pause thresholds in `docs/PLAN.md` 8a (0.6 m/s held 5 s, resume above 1.0 m/s held 3 s) against walk pace before relying on it.
- Interaction with skips (U24): a beginner plan is where skipping matters most, and a shifted week should never re-run a week already passed.

### 5. 10K

- Read the plan structures that actually agree: one quality session per week, mostly easy, a long run that reaches about 75-80% of race time, 6-10 weeks, a down week every third or fourth week. Those are coach consensus; find any trial or pooled analysis behind them before they become engine rules.
- Race pacing needs a starting estimate. `settings.run.recentRace` (section 7) already carries a recent race time and section 6.4 uses Riegel to turn it into a threshold pace before CS exists. Check Riegel's error at short distances: it is derived from marathon and 10 km performances, so applying it to a first-timer's goal pace needs an explicit caveat, and a first-timer has no recent race at all. The generator must therefore ask for either a recent time or a comfortable pace, and be honest that the plan is built on an estimate.
- The taper (section 12, two weeks, volume cut 41-60%) is written for a trained runner with a real base. Decide the 10K taper for a first-timer.

### 6. Marathon

- The evidence here is much better than for 10K, and 12-week plan reviews exist (for example Knopp 2024, PMC11065819, which pools 92 sub-elite 12-week plans). Read it and see how much agreement there is across 92 real plans, which is a stronger basis than any single-author plan.
- What the review says about the final 12 weeks is the part that transfers; what it says about the 16-20 weeks before that usually rests on one author's habits.
- Long-run progression, the cutback week, and the specific question of time on feet rather than distance. Qala records distance and time, so either is available; the evidence for injury may sit in one.
- Fuelling is a whole brief of its own: carbohydrate per hour, gut training, what is drinkable on a long run, and the fact that a beginner marathon plan is mostly about not getting 30 km wrong. Qala has no nutrition state today; decide whether the run plan carries fuelling notes as text on a workout step, and if so whether the step schema grows a `fueling` field.
- Taper and race-week pacing, and the interaction with `hybridPriority` (section 6.4): the marathon block is where "lift first, 24 h apart when strength is the priority" (section 6.4 table) does the most work, and where the 42 km rule (no heavy lower body for 5 days) needs to become a race-week rule.

### 7. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| NHS Couch to 5K booklet (Better Health page and the BBC Scotland printable PDF) | 9 weeks, 3 runs/wk, walk-run intervals, warm-up walk, repeat-until-passed rule, week 9 as 25/28/30 min continuous | plan text located, primary read |
| Relph 2023, PMC10487403, "Couch-to-5K or Couch to Ouch to Couch!?" | 64% dropout in the cohort; non-completion linked to musculoskeletal injury; the programme "lacks an evidence base" | abstract and figures located, full text not read |
| Ceyssens 2019 | Injury incidence in novice runners (about 27%/yr in secondary summaries) | secondary summaries only; find the primary |
| Frandsen 2025, PMC12421110 | The "too much too soon" model is widely accepted and thinly evidenced; distance jumps are the high-risk factor | read in full for `RESEARCH-running.md` work; reuse |
| Knopp 2024, PMC11065819 | Pooled quantitative review of 92 sub-elite 12-week marathon plans | abstract located; full pool not analysed yet |
| Galloway, Higdon, Run Walk Run and the British Athletics material | The competing interval progressions | coach plans, [expert]; compare where they agree |

### 8. What has to come out of this brief

1. A `walk` step kind and an intensity tag, or a documented alternative, in the `RunWorkout` schema (section 7).
2. A week advance rule, with the auto-pause interaction checked.
3. A first-runner prescription basis (section 3) that does not need a threshold pace.
4. Defined "no baseline" behaviour for the 1.10x and 30% flags, and an honest label on them.
5. The 10K plan shape, its taper, and what the generator asks when there is no recent race.
6. The marathon plan shape from the pooled review, the long-run rule in time or distance, and the race-week rules against the hybrid table.
7. Whether fuelling is text on a step or a new field.
8. Adherence design: the dropout evidence says the plan has to survive a life. That is a product requirement, not a research finding, and it belongs in the build plan as such.

### 9. Consumers

`docs/PLAN.md` 16c; `packages/generator` run plans (section 12); `packages/run/guided.ts` and the step machine (8a, 16a); the `runPlans` schema in section 7; `docs/podcast/scripts/` for the walk-run episode.
