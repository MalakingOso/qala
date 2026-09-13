# Research report: automatic rest timer and warm-up generator

Tags: [RCT] randomised allocation or order stated in the abstract, or PubMed type Randomized Controlled Trial (crossovers included), [obs] observational, non-randomised, counterbalanced-only or unstated-order study, [meta] meta-analysis or systematic review, [model] modelling study, [expert] expert opinion or coach practice, [secondary] number taken from a review or another paper, not the primary source, [weak] thin or contradictory evidence, [derived] computed or chosen here, with the working shown.

Scope: both features sit on the data model in PLAN.md sections 3, 6.2-6.4 and 12. Per set: weight, reps, RPE. Check-in: RP soreness 1-4 per muscle, PRS 0-10. Engine bindings already defined in PLAN M1: `prs`, `soreness` (max over target muscles, 1-4), `fatigueLocal` (0-1), `readiness` (0-1). Program `approach`: strength (1-6 reps at 80-95%), hypertrophy (8-15 reps at 60-80%), maintenance (6-10 reps). Plates: barbell and dumbbell 5 lb steps.

# Part 1. Automatic rest timer

## 1.1 Rest interval by goal: chronic outcomes

| Source | Design | Rest compared | Finding | Tag |
|---|---|---|---|---|
| de Salles 2009, Sports Med 39:765, doi:10.2165/11315230-000000000-00000 | Review, 35 studies | 30 s to 5 min | Loads 50-90% 1RM: 3-5 min allows more reps over sets and larger strength gains. Its advice of 30-60 s for hypertrophy rested on acute growth hormone, a rationale later studies dropped | [secondary] |
| Willardson 2006, J Strength Cond Res 20:978 (PMID 17194236) | Review | | Loads < 90% 1RM: 3-5 min for strength. Hypertrophy: 30-60 s (same GH rationale) | [secondary] |
| Grgic 2017, Eur J Sport Sci 17:983, doi:10.1080/17461391.2017.1340524 | Systematic review, 6 studies | <= 60 s vs > 60 s | Both work for hypertrophy; trained lifters with sensitive measures may do better with long rest. Cites de Souza 2010: cutting rest from 2 min to 30 s over 6 wk did not hurt hypertrophy | [meta] |
| Grgic 2018, Sports Med 48:137, doi:10.1007/s40279-017-0788-x | Systematic review, 23 studies, 491 people | | Short rest (< 60 s) still builds strength. Trained lifters need > 2 min to maximise it; untrained do fine with 60-120 s | [meta] |
| Schoenfeld 2016, J Strength Cond Res 30:1805, doi:10.1519/JSC.0000000000001272 | 21 trained men, 8 wk, 3 x 8-12RM, 7 exercises, 3 d/wk | 1 vs 3 min | 3 min: larger squat and bench 1RM gains and anterior thigh thickness; triceps trend (p = 0.06). Thickness change, via Grgic 2017's table: anterior quads +13.3% vs +6.9%, triceps +7.0% vs +0.5% | [RCT]; % [secondary] |
| Longo 2022, J Strength Cond Res 36:1554, doi:10.1519/JSC.0000000000003668 | 28 people, unilateral knee extension at 80%, 10 wk, protocols allocated per leg | 1 vs 3 min, with and without volume load matching | Quad CSA +13.1% (3 min) and +12.9% (1 min with volume load matched to 3 min) vs +6.8% (1 min) and +6.6% (3 min matched down to 1 min). 1RM the same in all | [obs, within-subject] |
| Singer 2024, Front Sports Act Living 6:1429789, doi:10.3389/fspor.2024.1429789 | Bayesian meta, 9 studies, 19 measurements | short vs longer, 4 categories | SMD 0.48 short vs 0.56 longer. Controlled contrasts favour longer rest: arm 0.13, thigh 0.17 (both CrIs cross 0). Small benefit above 60 s; no appreciable difference above 90 s. Failure vs non-failure did not change the rest effect | [meta] |
| Willardson & Burkett 2008, J Strength Cond Res 22:146, doi:10.1519/JSC.0b013e31815f912d | 15 trained men, squat, several mesocycles | 2 vs 4 min | Same strength gains; 4 min lifted more volume on heavy days. The authors suggest lifters adapt to shorter rest over time | [RCT, small] |
| Simao 2022, J Strength Cond Res 36:540, doi:10.1519/JSC.0000000000003606 | 33 trained men, 8 wk, 3 sets at 75% to failure, 4 upper-body lifts | fixed 75 s vs self-selected | Self-selected: more reps (chest press 26.1 vs 21.5, pulldown 30.1 vs 24.9). Strength gains equal. Fixed rest was 37% more time-efficient | [RCT] |

What longer rest buys: mostly volume load. Longo 2022 is the cleanest test: short rest with volume load topped up grew muscle like long rest, and long rest capped at the short-rest volume load grew like short rest. Singer 2024 puts the hypertrophy plateau at about 90 s. For strength, trained lifters gain from resting more than 2 min (Grgic 2018), with no extra gain from 4 min over 2 min in the one squat trial that tested it (Willardson & Burkett 2008).

Recommended default: strength main lifts 3 min, never below 2 min; hypertrophy compounds 2 min (main lifts 2.5 min, see 1.5), never below 90 s; isolation 90 s, never below 60 s. Untrained lifters in their first block can use the lower end (Grgic 2018). Long rest pays through volume load, so a lifter who can hit prescribed reps on shorter rest loses little.

## 1.2 Rest and next-set performance (acute)

| Source | Protocol | Rest | Finding | Tag |
|---|---|---|---|---|
| Willardson & Burkett 2005, J Strength Cond Res 19:23, doi:10.1519/R-13853.1 | 15 men, squat and bench, 4 sets at 8RM | 1, 2, 5 min | Volume 5 > 2 > 1 min for both lifts | [obs] |
| Willardson & Burkett 2006a, J Strength Cond Res 20:396, doi:10.1519/R-17735.1 | 16 trained men, bench, 5 sets at 80% and 50% 1RM | 1, 2, 3 min | 3 min gave more total reps than 2 or 1 min at both loads | [obs] |
| Willardson & Burkett 2006b, J Strength Cond Res 20:400, doi:10.1519/R-16314.1 | 15 men, squat and bench at 15RM, 5 sets | 30 s, 1, 2 min | Set-1 reps never sustained at any rest; lower the load over sets if rest is short | [obs] |
| Ratamess 2007, Eur J Appl Physiol 100:1, doi:10.1007/s00421-007-0394-y | 8 trained men, bench 5 x 10 at 75% or 5 x 5 at 85% | 30 s, 1, 2, 3, 5 min | 30 s and 1 min: 15-55% drops. 2 min: held for 2 sets, then -8 to -29% on sets 3-5. 3 min: sets 4-5 about 21% below sets 1-3. 5 min: only set 5 dropped | [RCT, crossover] |
| Senna 2011, J Strength Cond Res 25:3157, doi:10.1519/JSC.0b013e318212e23b | 15 trained men, 5 sets at 10RM: bench, leg press, chest fly, leg extension | 1, 3, 5 min | Bench: 3 = 5 > 1 min. The other three: 1 < 3 < 5. Reps fell from set 2 with 1 min, from set 3 with 3-5 min. Multi- and single-joint showed the same pattern | [obs] |
| Scudese 2015, J Strength Cond Res 29:3079, doi:10.1097/JSC.0000000000000214 | 16 trained men, bench 5 sets at 3RM | 1, 2, 3, 5 min | 2, 3, 5 min all beat 1 min and did not differ. Pre-set RPE rose from set 2 with 1 min; authors suggest at least 3 min for lower perceived exertion | [RCT, crossover] |
| Senna 2016, J Strength Cond Res 30:710, doi:10.1519/JSC.0000000000001142 | 15 trained men, 5 sets at 3RM | 1, 2, 3, 5 min | Chest fly: 2 min enough. Bench: 3-5 min needed, 5 min beat 2 min (12.9 vs 9.5 total reps) | [obs] |
| Senna 2017, J Hum Kinet 58:197, doi:10.1515/hukin-2017-0077 | 16 trained men, triceps pulldown, 4 sets at 80% or 50% 1RM | 1, 3, 5 min | 1 min lost reps vs 3 min at both loads; 3 vs 5 min differed only at 50% | [RCT, crossover] |
| Rosa 2023, J Strength Cond Res 37:1350, doi:10.1519/JSC.0000000000004508 | Smith squat and leg extension at 10RM | 1, 2, 3 min | Largest gap 1 vs 2-3 min; 2 vs 3 min trivial for both. Squat raised lactate more than leg extension | [RCT] |
| Kassiano 2020, J Sports Med Phys Fitness 60:992, doi:10.23736/S0022-4707.20.10612-1 | 20 women, leg press pyramid 60-80% to failure | 1, 2, 3 min | Volume 3 min > 1 min; 2 = 3 min | [RCT, crossover] |
| Millender 2021, Int J Exerc Sci 14:1178, doi:10.70252/EADO7587 | 14 trained women, chest and leg press to failure | 1 vs 3 min | Less total volume with 1 min on both | [RCT, crossover] |
| Yamazaki 2025, J Strength Cond Res 39:1123, doi:10.1519/JSC.0000000000005202 | 13 trained men, 5 sets at 85% to failure | 4 vs 8 min; alternating bench and squat with 4 min between | Bench volume load 2164 vs 1668 kg (+30%, derived 2164/1668); squat 2899 vs 2337 kg (+24%). Alternating gave squat 2778 kg, not different from 8 min | [RCT, crossover] |
| McMahon 2024, J Strength Cond Res 38:1527, doi:10.1519/JSC.0000000000004832 | 8 people, 4 sets of 8 maximal isometric reps | 2 vs 5 min | Volume +15% with 5 min (derived 11212/9748); torque drop pre-post -17% vs -4% | [obs, isometric] |
| Nuckols 2026, PeerJ 14:e20542, doi:10.7717/peerj.20542 | 21 men and 21 women, bench at 75% in sets of 5, 90 s rest, to failure | fixed 90 s | Women did 58.3 reps vs men 29.6, attributed to faster recovery during rest. Recovery over 72 h was the same | [obs] |

Proximity to failure:

| Source | Finding | Tag |
|---|---|---|
| Santos 2021, J Strength Cond Res 35:1372, doi:10.1519/JSC.0000000000002915 | 12 women, 4 sets of fast squats at 10RM, 2 min rest. To failure: 11.6 reps in set 1, 3.6 in set 4. Stopping at 20% velocity loss: 7.6, then 5.4. Totals similar (26.3 vs 24.5), with higher RPE and discomfort after failure | [RCT] |
| Fonseca 2020, J Exerc Sci Fit 18:94, doi:10.1016/j.jesf.2020.01.004 | 22 trained men, volume-load-matched squat. Not to failure: jump height and power back at 10 min. To failure: still down at 20-30 min | [RCT] |
| Refalo 2024, J Sports Sci 42:85, doi:10.1080/02640414.2024.2321021 | 18 trained people, 8 wk, failure vs 1-2 RIR: same quad growth; failure had larger velocity and rep loss | [RCT] |
| Robinson 2024, Sports Med 54:2209, doi:10.1007/s40279-024-02069-2 | Meta-regressions on estimated RIR: hypertrophy rises as sets end nearer failure; strength is flat across RIR | [meta] |
| Grgic 2017 (above), citing Wernbom 2007 | Longer rest is favoured after maximal or near-maximal efforts; shorter rest may be fine for submaximal sets not taken to failure | [secondary] |

Exercise size and training status. ACSM 2009 recommends 2-3 min for multi-joint core lifts and 1-2 min for assistance lifts (via de Salles 2016's introduction and discussion) [guideline, secondary]. Senna 2016 supports that split at 3RM loads; Senna 2011 found no split at 10RM. Rosa 2023 found squats more metabolically costly than leg extensions at the same rest. For training status the evidence is Grgic 2018 (trained need more) and Willardson & Burkett 2008 (adaptation to shorter rest). Nuckols 2026 adds large between-person differences in how fast reps come back.

Recommended default: rest length matters most below 2 min. Between 2 and 3 min the next-set difference is trivial for 10RM work (Rosa 2023, Kassiano 2020), while 3RM-5RM compound work keeps gaining to 3-5 min (Senna 2016, Ratamess 2007). Sets to failure cost the next set more than sets stopped short (Santos 2021, Fonseca 2020), so a failed set earns extra rest. Reps drop from set 3-4 even at 3 min (Ratamess 2007, Senna 2011), so later sets on main lifts earn extra rest too. Rest recovery varies between people (Nuckols 2026), which is the case for a learned personal multiplier.

## 1.3 Self-selected and autoregulated rest

| Source | Protocol | Finding on volume | Finding on time | Tag |
|---|---|---|---|---|
| Goessler & Polito 2013 (not indexed in PubMed; summarised in de Salles 2016's introduction) | 1 min, 2 min, self-suggested | 1 min gave fewer reps than 2 min or self-suggested; self-suggested = 2 min | Self-suggested = 2 min duration | [secondary] |
| de Salles 2016, Eur J Sport Sci 16:927, doi:10.1080/17461391.2016.1161831 | 27 trained, 3 sets to failure at 75%, squat, leg press, bench, curl | Reps the same as fixed 2 min | Self-suggested rested less than 2 min on average (exact figure not in the abstract or passages read) | [RCT] |
| Simao 2022 (1.1) | 8 wk, fixed 75 s vs self-selected | More reps self-selected; strength gains equal | Fixed 37% more time-efficient | [RCT] |
| Cardozo 2020, J Bodyw Mov Ther 26:273, doi:10.1016/j.jbmt.2020.12.019 | 16 young footballers, 4 lifts | 3 min and self-selected > 1 min for session volume | Not reported in abstract | [obs] |
| Behenck 2022, J Strength Cond Res 36:781, doi:10.1519/JSC.0000000000003648 | 18 men, agonist-antagonist pairs at 10RM | 1 min lowest; self-selected = 3 min | 2 min and self-selected had the same efficiency (volume per minute) | [obs] |
| Zhang 2026, Sports Health 18:851, doi:10.1177/19417381251398823 | 20 adults, 5 sets bench press and bench pull at 75% near failure: fixed 3 min vs self-selected vs rest adjusted from the previous set's rep count | Self-selected and rep-adjusted > fixed 3 min | Fixed most time-efficient, rep-adjusted second, self-selected least. The adjustment rule was not in the abstract and no full text was available | [RCT] |
| Wolfe 2024, J Strength Cond Res 38:444, doi:10.1519/JSC.0000000000004649 | 14 trained, squat 5 x 6 at 80%; start next set when in-session PRS reached 7, vs fixed 2 min | Same concentric and eccentric force and power (except one peak eccentric power effect) and same RPE | Not reported in abstract | [obs, counterbalanced, n = 14] |
| Fidalgo 2023, Int J Exerc Sci 16:1205, doi:10.70252/BOVS2537 | Circuit HIRT, fixed 30 s vs self-selected | Fixed gave more reps (403 vs 353) | Self-selected pauses were shorter than the fixed 30 s (abstract reports 14.0 +/- 5.8 s) | [obs, circuits] |
| Fontanetti 2025, J Strength Cond Res 39:10, doi:10.1519/JSC.0000000000004939 | Post-activation jumps after 5RM squats | Readiness-scale rest matched the best fixed rest | | [obs] |

Rest by heart rate recovery: no trial found that ends lifting rest on a heart-rate threshold. Two Scholar Gateway searches and one PubMed search turned up only cardiovascular-response studies. The nearest data are Thurlow 2024 (Eur J Sport Sci 25, doi:10.1002/ejsc.12217): heart rate and VO2 recovery did not differ between minute 2 and minute 3 of a 3 min rest, in repeated sprints [obs, indirect]. Resting heart rate is also a poor proxy for local muscle recovery, which is what limits the next set.

Rest by velocity: no trial found. Mansfield 2023 (already in RESEARCH-fatigue.md, doi:10.1080/17461391.2023.2235314) shows velocity doesn't track RIR reliably in recreational lifters, and it needs a device.

Rest by RPE: no trial regulates rest by RPE. RPE enters indirectly: Scudese 2015 and Ratamess 2007 show effort climbing when rest is short. The PRS-gated rest in Wolfe 2024 is the one direct link to Qala's own scale.

Recommended default: lifters who rest until ready keep volume equal to or above fixed rest (de Salles 2016, Simao 2022, Zhang 2026). Session time is the risk: self-selected rest was the least time-efficient option in two trials. So a computed rest that the lifter can shorten ("ready early") or lengthen (+30 s) is the right shape. It matches Zhang 2026's middle option, which kept the volume gain at lower time cost. Rest ends on a timer, not heart rate or velocity. The optional in-session prompt "ready?" maps to PRS 7 (Wolfe 2024) [obs].

## 1.4 Supersets and pairing as time savers

| Source | Finding | Tag |
|---|---|---|
| Iversen 2021, Sports Med 51:2079, doi:10.1007/s40279-021-01490-1 | Supersets, drop sets and rest-pause roughly halve session time with volume kept; probably better for hypertrophy than strength; longitudinal data thin. Also: keep warm-ups exercise-specific, stretch only if flexibility is the goal | [secondary review] |
| Paz 2019, J Bodyw Mov Ther 24:263, doi:10.1016/j.jbmt.2019.06.003 | 15 trained men, antagonist pairs (bench/pulldown, incline/row, triceps/biceps), rest inside the pair 30/60/90/120 s. Volume load 5386 / 6756 / 7358 / 7463 kg. 60 s is 9.5% below 120 s (derived 6756/7463), 90 s is 1.4% below (7358/7463). Efficiency highest at 30 s | [obs] |
| Behenck 2022 (1.3) | Between pair sequences: 1 min lost volume; 2 min matched self-selected efficiency | [obs] |
| Yamazaki 2025 (1.2) | Alternating bench and squat with 4 min between exercises gave squat volume equal to 8 min straight rest | [obs] |
| Latella 2019, Sports Med 49:1861, doi:10.1007/s40279-019-01172-z | Cluster sets preserve velocity and power within a session (mean velocity SMD 0.86) | [meta] |

Recommended default: pair secondary compounds and isolation lifts with antagonists when the session runs long. Rest 90 s inside the pair (within 1.4% of 120 s volume, Paz 2019), or 60 s when time is tight (about 10% volume cost). Rest 120 s after the pair (Behenck 2022). Don't superset strength-approach main lifts; if two main lifts must alternate, use 4 min between them (Yamazaki 2025).

## 1.5 Recommended default: rest timer algorithm

Classification [derived]. `main` = exercise on the user's main-lift list (PLAN 6.2). `isolation` = exactly one muscle group in `targetMuscles` and no `synergistMuscles` from a different body part. `secondary` = everything else. Body part comes from the DB's `bodyParts`. This classification is derived and must be overridable per exercise in the overlay.

Base rest `B` in seconds, from end of set to start of next set:

| approach | main | secondary | isolation | Source |
|---|---|---|---|---|
| strength (1-6 reps) | 180 | 150 | 90 | main: Grgic 2018 [meta], Senna 2016 [obs], Ratamess 2007 [RCT]. Secondary 150 [derived] as midpoint of main 180 and ACSM's 2 min assistance ceiling. Isolation: Senna 2016 fly at 3RM needs <= 2 min, Singer 2024 plateau > 90 s [obs, meta] |
| hypertrophy (8-15 reps) | 150 | 120 | 90 | secondary 120: Rosa 2023, Kassiano 2020 (2 = 3 min at 10RM) [RCT]. Main 150 [derived]: midpoint between 120 (no gain above 2 min at 10RM) and Schoenfeld 2016's winning 180. Isolation 90: Singer 2024 [meta] |
| maintenance (6-10 reps) | 150 | 120 | 90 | no maintenance-specific study; uses the hypertrophy row [derived] |

Clamps `[min, max]` in seconds:

| approach | main | secondary | isolation | Source |
|---|---|---|---|---|
| strength | [120, 300] | [90, 240] | [60, 150] | 120: Scudese 2015, Willardson & Burkett 2008 [RCT]. 300: de Salles 2009 upper bound of 3-5 min [secondary]. Others [derived] |
| hypertrophy, maintenance | [90, 240] | [90, 180] | [60, 150] | 90 and 60: Singer 2024 (> 60 s helps, plateau > 90 s) [meta]. Upper bounds: 2 vs 3 min trivial (Rosa 2023) [RCT], rounded up [derived] |

Adjustments to the next rest after each logged work set. `d = RPE_logged - RPE_target` (use the top of a target range):

1. Effort [derived]. If RPE was logged and the set did not fail: `A_effort = clamp(30 * d, -30, +45)`, which is 15 s per 0.5 RPE. Direction comes from Scudese 2015, Ratamess 2007 and Santos 2021: harder sets cost the next set. The 30 s per RPE point is an assumption. Its only anchor is that the whole 1 vs 2 min gap (60 s) is the step that matters in Senna 2011 and Rosa 2023, and one RPE point is one rep in reserve. No RPE logged: 0.
2. Failure [derived]. If `RPE_logged >= 10`, or reps < target reps with `RPE_logged >= 9.5`: `A_fail = +60` for main and secondary, `+30` for isolation. This replaces A_effort. Direction: Fonseca 2020, Santos 2021, Grgic 2017 citing Wernbom [RCT, secondary]. Size: one 1 vs 2 min step (Senna 2011, Rosa 2023), halved for isolation, which recovered at 2 min in Senna 2016.
3. Reps short without failure [derived]. Reps below the bottom of the target range: `A_short = +30`.
4. Cumulative session fatigue [derived]. Take the larger of two terms:
   - set index: rest before set 4 or later of a strength main lift adds +30 (Ratamess 2007: with 3 min, sets 4-5 fell about 21%) [RCT].
   - drift at the same load: for hypertrophy and maintenance, `1 - reps_this_set / reps_first_set >= 0.20` adds +30 (the 20% threshold from Ratamess 2007's ~21%). For strength's fixed-rep sets, `RPE_this_set - RPE_first_set >= 1` adds +30.
5. Readiness [derived, no study]. +30 if `soreness == 4` for the exercise, or `prs <= 4` (Laurent anchors, RESEARCH-fatigue.md), or `fatigueLocal >= 0.7` (0.7 is an assumption; calibrate). Never negative: no study shows high readiness shortens the rest a lifter needs.
6. Personal multiplier `m` per (approach, class), start 1.0, bounds [0.75, 1.5] [derived].

`R = clamp(round_to_15(B * m + A_effort_or_fail + A_short + A_cum + A_ready), min, max)`.

Superset override: inside an antagonist pair, R = 90 (60 when the session is more than 10% over its time budget), and 120 after the pair [Paz 2019, Behenck 2022, obs]. Strength main lifts never pair.

Taps. "Ready early" starts the next set at any time; below the min clamp on a strength main lift it shows a one-line warning. "+30 s" extends the timer. At R the timer alerts. From the min clamp on, an optional "ready?" prompt appears, meaning PRS 7 as in Wolfe 2024 [obs, small].

Learning the personal multiplier [derived; no study tests one]. After the next set is logged, let `A` be the actual rest and `adj` the sum of adjustments that were applied. Then:
- `m_obs = clamp((A - adj) / B, 0.75, 1.5)`.
- Next set hit target (reps in range and `RPE <= target + 0.5`): `m <- m + 0.1 * (m_obs - m)`.
- Next set missed and `A < R` (the lifter started early): no update. An early start that failed shouldn't teach shorter rest.
- Next set missed and `A >= R`: `m <- m + 0.1 * (min(1.5, 1.15 * m) - m)`.
- Warm-up sets never update `m`. After 20 observed rests for a single exercise, keep a per-exercise `m` that overrides the class value.

Alpha 0.1 gives an effective memory of about 10 rests. Worked example: B = 120 s, m = 1.0, and the lifter taps ready at 90 s and hits target every time, so m_obs = 0.75. After one rest, m = 1 + 0.1 x (0.75 - 1) = 0.975. After n rests, m = 0.75 + 0.25 x 0.9^n: n = 10 gives 0.837 (prescribed 100 s, shown as 105), n = 20 gives 0.780. Justification for learning at all: large between-person recovery differences (Nuckols 2026) and adaptation to shorter rest (Willardson & Burkett 2008) [obs, RCT].

Time budget reconciliation with PLAN 12 [derived]. The generator estimates 2.5 min per work set and 4 min per main-lift set, rest included. Assume a hypertrophy set takes about 40 s (8-12 reps at about 3 s each plus 10 s setup) and a strength set about 30 s. Then secondary hypertrophy = 120 + 40 = 160 s (2.7 min), isolation 130 s (2.2 min), hypertrophy main 190 s (3.2 min), strength main 180 + 30 = 210 s (3.5 min). Mixed sessions land near 2.5 min per set, and the 4 min main-lift budget leaves 30 s headroom for adjustments. The generator should read B from this table and add 40 s (hypertrophy, maintenance) or 30 s (strength) per set, instead of the flat constants, so its 10% time-budget test and the timer agree.

Reason codes to add (so the UI can say why): `REST_FAILURE`, `REST_EFFORT_HIGH`, `REST_EFFORT_LOW`, `REST_REPS_SHORT`, `REST_LATE_SET`, `REST_DRIFT`, `REST_LOW_READINESS`, `REST_SUPERSET`.

# Part 2. Warm-ups

## 2.1 General warm-up (cardio) before lifting

| Source | Protocol | Finding | Tag |
|---|---|---|---|
| Fradkin 2010, J Strength Cond Res 24:140, doi:10.1519/JSC.0b013e3181c643a0 | Meta, 32 studies (warm-ups other than stretching) | Performance improved in 79% of criteria; little evidence of harm | [meta] |
| Bishop 2003, Sports Med 33:483, doi:10.2165/00007256-200333070-00002 | Review | Short, intense tasks can be impaired if the warm-up is too hard or recovery too short; active warm-up slightly better than passive heating | [secondary review] |
| McCrary 2015, Br J Sports Med 49:935, doi:10.1136/bjsports-2014-094228 | Systematic review, 31 RCTs, upper body | Strong evidence that high-load dynamic warm-ups enhance power and strength, short static stretching has no effect on power, and passive heating/cooling is largely ineffective. No injury data | [meta] |
| Abad 2011, J Strength Cond Res 25:2242, doi:10.1519/JSC.0b013e3181e8611b | 13 trained, leg press 1RM | 20 min bike at 60% HRmax plus specific warm-up (8 @ 50%, 3 @ 70% est. 1RM) gave 1RM 8.4% higher than specific alone | [obs, crossover, n = 13] |
| Barroso 2013, J Strength Cond Res 27:1009, doi:10.1519/JSC.0b013e3182606cd9 | 16 strength-trained men, leg press 1RM after specific warm-up | 15 min at 40% VO2max: +3%. 15 min at 70%: -4%. 5 min at 40% or 70%: same as none | [RCT] |
| Ribeiro 2014, Percept Mot Skills 119:133, doi:10.2466/25.29.PMS.119c17z7 | 15 men, 4 sets to failure at 80%: bench, squat, curl | Control, specific, aerobic and combined warm-ups gave the same total reps and fatigue index | [RCT] |
| Wilson 2025, J Sport Health Sci 14:101024, doi:10.1016/j.jshs.2025.101024 | Meta, 33 studies | Muscle warming raises rate-dependent force (voluntary +3.7% per deg C) and power but not maximum force; active no better than passive | [meta] |
| Neves 2025, Sports 13:142, doi:10.3390/sports13050142 | 22 trained men | Re-warm-up before squats done after bench improved squat velocity and power (ES 0.45-0.62); re-warm-up before bench after squats did nothing | [RCT] |
| Jeffreys 2007, Prof Strength Cond 6:12-18 (no DOI) | RAMP: Raise, Activate, Mobilise, Potentiate | Framework for ordering warm-up blocks | [expert] |

Conflict: the positive general warm-up data (Abad 2011, Barroso 2013) are 1RM tests. The one multi-set, reps-to-failure trial (Ribeiro 2014) found nothing. Wilson 2025's meta also says warmth helps speed and power, not maximum force. So for 8-15 rep hypertrophy work, general cardio is optional. For a heavy strength day it has some support, provided it stays easy (Barroso's 70% hurt).

Recommended default: 5 min easy cardio on hypertrophy and maintenance days, and it may be skipped [expert, RAMP; Ribeiro 2014 shows no volume cost from skipping]. 10 min easy on strength days whose first main lift has a top set >= 85% of the reference 1RM [derived]: between Barroso's ineffective 5 min and effective 15 min, shortened for the time budget. Intensity is easy: conversational, about 60% HRmax (Abad 2011) or 40% VO2max (Barroso 2013). Never hard.

## 2.2 Specific warm-up (ramp) sets

| Source | Protocol | Finding | Tag |
|---|---|---|---|
| Ribeiro 2020, Int J Environ Res Public Health 17:6882, doi:10.3390/ijerph17186882 | 40 trained men, 3 x 6 at 80% 1RM (the "training load") after: 6 @ 40% + 6 @ 80% of training load, or 6 @ 80% only, or 6 @ 40% only | Squat: 80%-only beat 40%-only for mean propulsive velocity (set 2 ES 0.80). Bench: the two-step warm-up beat 40%-only (time to peak velocity, total work). Few reps with light load are not enough | [obs, crossover] |
| Viveiros 2024, J Bodyw Mov Ther 40:1487, doi:10.1016/j.jbmt.2024.08.004 | 15 trained men; warm-up 15 @ 40%, 10 @ 60% or 5 @ 80% of 10RM, then 3 sets to failure of bench, incline leg press, pulldown, 2 min rest | 80% x 5 gave more total volume than 60% (p = 0.010) and 40% (p = 0.038). Authors: warm up each exercise at 80% of its starting load | [obs, crossover] |
| Souza 2024, PeerJ 12:e17347, doi:10.7717/peerj.17347 | 14 trained men, squat to failure after 3 @ 90% 1RM, or 6 fast @ 45%, or usual 8 @ 45% | No difference in total reps or volume; the heavy warm-up raised first-set volume load only | [obs, crossover] |
| Xu 2025, Sports Med 55:977, doi:10.1007/s40279-024-02170-6 | Meta, 62 PAPE studies, high risk of bias | Pre- to post-conditioning effect trivial (ES 0.12) | [meta] |
| Seitz 2016, Sports Med 46:231, doi:10.1007/s40279-015-0415-7 | Meta, 47 studies | Potentiation is larger in stronger, more experienced lifters; effects small (ES 0.19-0.51) | [meta] |
| NSCA 1RM protocol, via HPRC (hprc-online.org/physical-fitness/training-performance/what-one-rep-max) | Light load for 5-10 reps, rest 1 min; add 10-20 lb or 5-10% (upper) or 30-40 lb or 10-20% (lower) for 3-5 reps, rest 2 min | Reps fall as load rises; rest lengthens | [expert, secondary] |

Recommended default: the last ramp step should land near 80-90% of the working load (Ribeiro 2020, Viveiros 2024) [obs, crossover]. The steps below it, their count and their reps follow coach practice: reps fall as load rises, rest lengthens (NSCA) [expert]. Don't design ramps to chase potentiation; the pooled effect is trivial (Xu 2025). Later exercises for muscles already worked need one step at 80% x 4-5 or nothing. A lower-body main lift after an upper-body one gets its full ramp (Neves 2025).

### Ramp table [derived; last step anchored on crossover trials, earlier steps expert]

Relative intensity `I = W / reference_1RM` (strength blocks) or `W / e1RM` (Kalman estimate). With no estimate, use the inverse Epley formula from PLAN 12: `I = 1 / (1 + (reps + RIR) / 30)`.

| Tier | I of top work set | Ramp sets, % of working load W x reps | Rest after step |
|---|---|---|---|
| T0 | < 0.60, or any isolation lift | none; for the first exercise of a muscle group today: 1 x 10 @ 50% | 45 s |
| T1 | 0.60-0.749 | 50% x 8, 80% x 4 | 45 s, then 90 s |
| T2 | 0.75-0.849 | 45% x 6, 65% x 4, 85% x 2 | 45, 60, 90 s |
| T3 | 0.85-0.919 | 40% x 5, 60% x 3, 75% x 2, 88% x 1 | 45, 60, 90, 120 s |
| T4 | >= 0.92 | 40% x 5, 55% x 3, 70% x 2, 82% x 1, 91% x 1 | 45, 60, 90, 120, 120 s |

Sources: T1 is Ribeiro 2020's 40%/80% pattern with reps trimmed to 8 and 4 [obs plus expert]. The final step in T1-T2 (80-85%) is anchored on Viveiros 2024 and Ribeiro 2020 [obs, crossover]. T3-T4 top steps (88%, 91%) and all intermediate steps are [expert]. Rests follow the NSCA pattern of 1 min early, 2 min late [expert, secondary], with the 45/60/90/120 split [derived].

Rules [derived]:
- Round each step to the nearest 5 lb (PLAN 3), .5 rounding up.
- A step below the empty bar (45 lb) becomes "bar x 8"; two such steps merge into one.
- Drop a step that rounds to the same load as the previous step or as W.
- Secondary compound whose target muscles were already trained today: 1 x 4 @ 80% W (Viveiros 2024). Isolation: T0.
- Soreness 4 on the lift's target muscles or `prs <= 4`: insert one extra step at the mean of the first two steps' loads, x 5 reps [expert, no study].
- Time estimate per step: 30 s of work plus the rest listed.

Worked examples (barbell, 5 lb rounding):
- Hypertrophy squat 185 x 10 at RPE 8 (RIR 2): I = 1/(1 + 12/30) = 0.714, T1. 50% = 92.5, rounds to 95 x 8. 80% = 148, rounds to 150 x 4.
- Strength squat 225 x 5, reference 1RM 265: I = 0.849, T2. 45% = 101.25 -> 100 x 6; 65% = 146.25 -> 145 x 4; 85% = 191.25 -> 190 x 2.
- Bench single at 95% of a 250 lb 1RM: W = 237.5 -> 240, I = 0.96, T4. 96 -> 95 x 5; 132 -> 130 x 3; 168 -> 170 x 2; 196.8 -> 195 x 1; 218.4 -> 220 x 1.
- Overhead press 95 x 8, e1RM 125: I = 0.76, T2. 45% = 42.75, below bar -> bar x 8; 65% = 61.75 -> 60 x 4; 85% = 80.75 -> 80 x 2.

## 2.3 Foam rolling before lifting

| Source | Finding | Tag |
|---|---|---|
| Wiewelhove 2019, Front Physiol 10:376, doi:10.3389/fphys.2019.00376 | 21 studies. Pre-rolling: sprint +0.7% (ES 0.28), flexibility +4.0% (0.34), jump -1.9% (0.09), strength +1.8% (0.12), the last two negligible. Post-rolling cut muscle pain perception (+6.0%, ES 0.47) | [meta] |
| Wilke 2020, Sports Med 50:387, doi:10.1007/s40279-019-01205-7 | 26 trials: acute ROM SMD 0.74 vs no exercise; no better than stretching; duration and speed not significant moderators; smaller effect in men | [meta] |
| Konrad 2022a, Eur J Appl Physiol 122:1545, doi:10.1007/s00421-022-04927-1 | 20 studies: foam rolling and stretching give the same acute ROM immediately and at 10, 15 and 20 min | [meta] |
| Konrad 2022b, Sports Med 52:2523, doi:10.1007/s40279-022-01699-8 | 11 studies, rolling as training: ROM ES 0.82, larger over > 4 wk; worked for hamstrings and quads, not calves | [meta] |
| Konrad 2022c, Int J Environ Res Public Health 19:11638, doi:10.3390/ijerph191811638 | 8 studies: rolling as training did not change performance (ES -0.29, ns) | [meta] |
| Nakamura 2021, J Sports Sci Med 20:62, doi:10.52082/jssm.2021.62 | 45 people, calves: 30 s x 1 did nothing; 30 s x 3 (90 s) and x 10 raised dorsiflexion (d 0.26, 0.33), gone by 30 min; strength unchanged | [RCT] |
| Martinez-Aranda 2024, J Funct Morphol Kinesiol 9:20, doi:10.3390/jfmk9010020 | 25 studies in athletes: acute ROM gains, no effect on max strength or power, better perceived recovery, less DOMS | [secondary review] |
| Ormeno 2025, Sports 13:282, doi:10.3390/sports13090282 | 16 trained athletes: dynamic warm-up plus rolling reduced jump height (d -0.29 to -0.36) and RSImod vs dynamic alone; small ankle mobility gain and less soreness | [RCT, small] |

Recommended default: foam rolling is optional and cheap. Use 90 s per muscle (per side on limbs), the shortest dose with an ROM effect (Nakamura 2021) [RCT]. Put it before dynamic drills and ramp sets, within about 20 min of lifting, since the ROM effect lasted to 20 min in Konrad 2022a and was gone by 30 min in Nakamura 2021. Expect ROM and less soreness, not strength (Wiewelhove 2019). Skip it before jump or sprint work (Ormeno 2025).

## 2.4 Percussive massage (Theragun-type devices)

| Source | Dose | Finding | Tag |
|---|---|---|---|
| Konrad 2020, J Sports Sci Med 19:690 (PMID 33239942) | 5 min, calves, Hypervolt | Dorsiflexion ROM +5.4 deg (+18.4%, d 1.36); MVC torque unchanged | [obs, two conditions, n = 16] |
| Skinner 2023, J Sports Sci Med 22:496, doi:10.52082/jssm.2023.496 | 2 x 60 s hamstrings, Theragun Pro, standard ball, 20 proximal-to-distal passes | Straight-leg raise +11.4%; stiffness -6% | [obs, n = 20] |
| Bartik 2025, PeerJ 13:e20304, doi:10.7717/peerj.20304 | Theragun vs foam roller vs control | Theragun improved hamstring flexibility more than rolling or control; no effect on reactive strength, leg press power or hop endurance | [RCT, pilot] |
| Fischer 2026, BMC Sports Sci Med Rehabil 18, doi:10.1186/s13102-026-01732-7 | 3 x 30 s hamstrings, vibration roller or percussion | No ROM or stiffness change; both reduced MVIC torque | [RCT, n = 17] |
| Ormeno 2025 (2.3) | Gun added to dynamic warm-up | Reduced jump height and RSImod, slower 20 m sprint (d 0.34) | [RCT, small] |
| Szymczyk 2022, Int J Environ Res Public Health 19:15187, doi:10.3390/ijerph192215187 | 60 s on each Achilles | Drop-jump height slightly down at 5 min (-3.1%, ES -0.25, ns post hoc) | [RCT, crossover, n = 11] |
| Garcia-Sillero 2021, Int J Environ Res Public Health 18:7726, doi:10.3390/ijerph18157726 | Percussion during 3 min rests, bench 4 sets at 70% to 30% velocity loss | More total reps (44.6 vs 39.5, ES 0.87); velocity unchanged | [RCT, n = 24] |
| Ferreira 2023, J Funct Morphol Kinesiol 8:138, doi:10.3390/jfmk8030138 | Systematic review, 11 studies | Short-term ROM and flexibility gains. Strength, balance, acceleration, explosive tasks unchanged or worse; not recommended before them | [meta] |
| Sams 2023, Int J Sports Phys Ther 18:309, doi:10.26603/001c.73795 | Systematic review, 13 studies, all with quality limits | Reports acute gains in strength, explosive strength and flexibility; contradicts Ferreira 2023 on strength | [meta, weak] |
| Driller & Leabeater 2023, Sports 11:213, doi:10.3390/sports11110213 | Narrative review | Massage guns: lower evidence level, mixed results; foam rolling: high level of positive evidence for recovery | [secondary review] |
| Leabeater 2024, J Athl Train 59:310, doi:10.4085/1062-6050-0041.23 | 5 min on calves after hard exercise, 65 people | No performance or ROM benefit; small increase in soreness immediately (d -0.35) and at 4 h (d -0.48) | [obs, within-subject] |
| Zhu 2026, Chiropr Man Therap 34, doi:10.1186/s12998-026-00657-9 | Meta, 12 RCTs, post-exercise recovery | > 5 min per muscle linked to bigger jump recovery and also higher DOMS; authors call dose findings preliminary | [meta, weak] |

Conflict: the strength effect goes both ways, even within similar hamstring protocols. Konrad 2020 found no MVC change after 5 min; Fischer 2026 found MVIC reduced after 90 s; Ormeno 2025 found worse jumps and sprints. The ROM gain is consistent. On frequency settings, no warm-up study compared them; trials used the device's standard settings, and Zhu 2026's frequency findings are post-exercise and preliminary.

Does it replace or add to foam rolling? For ROM the two are interchangeable (Bartik 2025 favoured percussion for hamstrings; Fischer 2026 found no difference; Konrad 2022a equates rolling with stretching). Using both on one muscle has no supporting study.

Recommended default: one soft-tissue tool per muscle, never both [derived]. Prefer the foam roller for the prime movers of the day's first heavy lift, since its strength effect is neutral (Wiewelhove 2019). Use percussion for muscles a roller reaches badly (pecs, front delts, upper traps, forearms): 60 s per muscle, moving along the muscle, on the device's low or middle setting [expert; Skinner 2023 used 2 x 60 s]. Don't use percussion on a muscle with soreness >= 3 (Leabeater 2024 showed a small soreness increase) [derived]. Don't use percussion on prime movers before a strength-approach top set >= 85% or before jumps (Fischer 2026, Ormeno 2025, Ferreira 2023) [weak, mixed].

## 2.5 Dynamic vs static stretching before lifting

| Source | Finding | Tag |
|---|---|---|
| Behm 2016, Appl Physiol Nutr Metab 41:1, doi:10.1139/apnm-2015-0235 | Immediately after: static -3.7%, dynamic +1.3%, PNF -4.4%. Static >= 60 s per muscle -4.6% vs < 60 s -1.1%. ROM gains usually last < 30 min. Dynamic activity after stretching removed clear effects | [secondary systematic review] |
| Barroso 2012, J Strength Cond Res 26:2432, doi:10.1519/JSC.0b013e31823f2b4d | 12 strength-trained men, leg press at 80% 1RM: reps -20.8% (static), -17.8% (ballistic), -22.7% (PNF); volume -18 to -22%; 1RM down only after PNF (-5.5%). Stretch durations not in the abstract | [obs, crossover] |
| McCrary 2015 (2.1) | Short static stretching: no effect on power | [meta] |
| Iversen 2021 (1.4) | Stretch only when flexibility is the goal | [secondary review] |

Recommended default: no static or PNF stretching before lifting. Behm's < 60 s rule makes short holds "trivial" for single efforts, but Barroso 2012 measured a 20% rep loss in the multi-set work Qala programs. Use dynamic drills instead (Behm 2016, +1.3%).

## 2.6 Using the check-in to target the warm-up

No study changes a lifting warm-up based on soreness or readiness. What exists:
- Rolling after exercise reduces muscle pain perception (Wiewelhove 2019, ES 0.47) [meta], and SMR reviews report less DOMS (Martinez-Aranda 2024) [secondary review].
- A massage gun on freshly worked calves slightly increased soreness (Leabeater 2024) [obs].
- First-set volume load is still down 48 h after hard lower-body work (Goulart 2020, RESEARCH-fatigue.md section 3) [obs]. That argues for an extra ramp step to judge the day's load, not for more cardio.

Recommended default [expert, derived]: muscles with soreness 3-4 that today's session trains get 120 s of foam rolling instead of 90 s, and no percussion. A main lift whose target muscles score soreness 4, or any session with `prs <= 4`, gets one extra ramp step. Low readiness never lengthens general cardio beyond the tier default. Label all of these as expert rules in the UI.

## 2.7 Warm-up before running, and a run as the warm-up for lifting

| Source | Finding | Tag |
|---|---|---|
| Mortimer 2026, Eur J Sport Sci 26, doi:10.1002/ejsc.70163 | 25 recreational runners; standard physical warm-up before a 1-mile time trial: 1200 m easy jog, 800 m alternating jog and strides, 3 min active stretching drills. (The trial tested cognitive add-ons, which cut 8-11 s; the physical warm-up itself was not compared with none.) | [obs, protocol only] |
| Fradkin 2010, Bishop 2003 (2.1) | General warm-up helps performance; too intense a warm-up can impair short efforts | [meta, secondary review] |
| Ribeiro 2018, Eur J Sport Sci, doi:10.1080/17461391.2018.1500643 | 21 moderately trained men, continuous run at 90% anaerobic threshold, then leg press: after 3 km volume load unchanged; after 5 km -12%; after 7 km -22%. 1RM unaffected by any | [obs, crossover] |
| Conrado de Freitas 2020, J Sports Med Phys Fitness 60:374, doi:10.23736/S0022-4707.20.10227-5 | 11 trained men, 5 km high-intensity intervals before leg press: set volume -18 to -25%; a 2 x 90% conditioning set before lifting restored total volume | [RCT] |
| Barroso 2013 (2.1) | 15 min at 40% VO2max helped 1RM; at 70% it hurt | [RCT] |

Recommended default: before easy runs, no separate warm-up; run the first 5 min slower than target pace [expert]. Before tempo, interval or race efforts, use about 10-15 min easy running, then 3 min of dynamic drills, then a few short strides, matching Mortimer 2026's protocol of about 2 km plus drills [obs protocol, expert]. An easy run of up to 15 min or 3 km, whichever comes first, at conversational pace (below 0.78 CS, PLAN 6.4) counts as the general warm-up for lifting that starts within 15 min [derived]. The support is Ribeiro 2018 (3 km at 90% threshold cost no volume) and Barroso 2013 (15 min easy helped). Longer or harder runs cost lower-body volume (5 km -12%, Ribeiro 2018), which the engine already covers with the PLAN 6.4 rule (-1 rep per set after runs >= 30 min).

## 2.8 Recommended default: warm-up generator

Inputs: today's exercises in order, with class (1.5), target and synergist muscles, and working load W plus reference 1RM or e1RM; `approach`; check-in `soreness` per muscle and `prs`; owned equipment (foam roller, percussion device, bike, rower, treadmill, or none); a run finished within 15 min (distance, duration, intensity); warm-up time budget `T` for blocks 1-3, default 8 min, or 15 min when block 1 is 10 min [assumption]. Ramp sets are counted in lifting time, not in T.

Output, in order:

1. General (Raise) [expert RAMP; Barroso 2013 RCT, Abad 2011 obs]. 5 min easy on hypertrophy and maintenance days (skippable); 10 min easy when the first main lift's top set is >= 85% of reference 1RM. Easy = conversational, about 60% HRmax. Modality: owned bike, rower or treadmill; with none, 3 min of brisk walking or marching and bodyweight squats [expert]. Skip the block if an easy run of <= 15 min or <= 3 km ended within 15 min (2.7).
2. Soft tissue (optional; only with a tool owned and T >= 8 min) [derived from 2.3-2.4]. Muscles: target muscles of the first two exercises, plus any muscle trained today with soreness >= 3, capped at 4 muscles. Foam roller 90 s per muscle or side, 120 s if soreness >= 3 (Nakamura 2021 RCT; 2.6 expert). Percussion 60 s per muscle, only for muscles the roller can't reach, never on sore muscles, never on prime movers before a top set >= 85% (2.4 weak). One tool per muscle.
3. Dynamic mobility (Activate, Mobilise) [expert; Behm 2016 for dynamic over static]. 2 drills x 8-10 reps each for up to 3 muscle groups the session trains, about 1 min per group:
   - Quads and glutes: bodyweight squats, walking lunges, front-to-back leg swings.
   - Hamstrings, glutes, lower back: bodyweight good mornings, glute bridges, straight-leg kicks.
   - Calves and ankles: knee-to-wall ankle rocks, calf raises, low pogo hops.
   - Chest, front delts, triceps: incline push-ups, scapular push-ups, band or dowel pass-throughs.
   - Lats, upper back, biceps, rear delts: band pull-aparts, scapular pulls from a hang, thoracic open-book rotations.
   - Shoulders (overhead day): wall slides, band pass-throughs, prone Y-T-W raises.
   - Trunk: dead bugs, bird dogs.
4. Ramp sets per exercise from the table in 2.2, rounded to 5 lb, with the soreness and PRS extra step and the re-warm-up rule for a lower-body main lift after upper-body work.

When time is short, cut in this order: soft tissue first, then mobility down to 1 drill per group, then general down to 3 min. Ramp sets are never cut [derived from Iversen 2021's "exercise-specific warm-up first" and the RCT support for ramps in 2.2].

Example, strength squat day: top set 225 x 5 with reference 1RM 265, so I = 0.849 and tier T2. Foam roller and bike owned, quads soreness 3, PRS 6, T = 15 min. Bike 10 min easy; roll quads 120 s (soreness 3) and glutes 90 s; squats and front-to-back leg swings, 1 min. That is 14.5 min, inside T. Ramp 100 x 6, 145 x 4, 190 x 2. If quads had scored 4 or PRS were <= 4, add a step at (100 + 145)/2 = 122.5 -> 125 x 5 between the first two.

Provenance: abstracts and metadata via PubMed for every PMID-indexed source above (retrieved 2026-09-13). Scholar Gateway passages (Wiley corpus) used for de Salles 2016, Grgic 2017, Ribeiro 2018, Thurlow 2024, Mortimer 2026. Firecrawl research search was used for discovery of the percussive and foam-rolling trials; no full texts were readable there. Jeffreys 2007 citation and the NSCA 1RM warm-up steps came from web search (ResearchGate listing, HPRC page). Goessler & Polito 2013 and the Zhang 2026 adjustment rule could not be retrieved and are reported second-hand or as missing.
