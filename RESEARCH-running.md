# Research report: running in an adaptive lifting engine (interference, sequencing, load, per-muscle fatigue, running fitness, progression, scheduling)

Tags: [RCT] randomised trial, [obs] observational/cohort, [model] modelling study, [expert] expert opinion/coach practice, [secondary] number taken from a review, blog or calculator, not the primary source, [weak] thin or contradictory evidence, [derived] number computed in this report from the named anchors; the derivation is shown next to it.

Context: the engine in PLAN.md section 6 has per-muscle fatigue G_m (tau 2-2.5 d, input RPE-weighted set counts), systemic fatigue G_s (tau 10 d, input sRPE x minutes / 100), per-lift fitness F_l (tau 45 d), a Kalman-corrected e1RM observation, RP soreness/performance check-ins and PRS readiness. This report asks what running should add to each of those.

## 1. Concurrent training interference

| Source | Scope | Strength | Power / explosive | Hypertrophy | Moderators | Tag |
|---|---|---|---|---|---|---|
| Wilson 2012, JSCR 26:2293, doi:10.1519/JSC.0b013e31823a3e2d | 21 studies, 422 ES | ES strength-only 1.76, concurrent 1.44, endurance-only 0.78 | 0.91 / 0.55 / 0.11, all groups differ | 1.23 / 0.85 / 0.27 | Running, not cycling, reduced hypertrophy and strength. Endurance frequency r -0.26 to -0.35 and duration r -0.29 to -0.75 with the three outcomes | [RCT pooled], older, small studies |
| Schumann 2022, Sports Med 52:601, doi:10.1007/s40279-021-01587-7 | 43 studies, >= 4 wk, identical RT prescription with and without aerobic | SMD -0.06 (95% CI -0.20 to 0.09) | -0.28 (-0.48 to -0.08) | -0.01 (-0.16 to 0.18) | Explosive loss only in same-session training (p = 0.043), not when >= 3 h apart. No effect of cycling vs running, > 5 vs < 5 sessions/wk, untrained vs active, age | [RCT pooled], best current estimate |
| Petre 2021, Sports Med 51:991, doi:10.1007/s40279-021-01426-9 | 27 studies, lower-body 1RM | Trained -0.35 (p < 0.01), moderately trained -0.20 (p = 0.08), untrained 0.03 | | | In trained lifters, same session -0.66 vs different sessions -0.10 | [RCT pooled] |
| Sabag 2018, J Sports Sci 36:2472, doi:10.1080/02640414.2018.1464636 | HIIT + RT vs RT | Lower body -0.248 (p = 0.049); upper body no difference | | No difference | Cycling HIIT -0.377 (p = 0.074), running HIIT -0.176 (p = 0.261) | [RCT pooled], contradicts Wilson on modality |
| Huiberts 2024, Sports Med 54:485, doi:10.1007/s40279-023-01943-9 | 59 studies, 1346 people | Lower-body strength men -0.43 (-0.64 to -0.22), women 0.08 (-0.34 to 0.49) | No sex difference | Insufficient data | No strength-status effect on strength outcomes | [RCT pooled] |
| Held 2026, Sports Med 56:1489, doi:10.1007/s40279-026-02401-y | Umbrella: 17 meta-analyses, 144 studies, 1492 people | CT comparable to RT | Comparable | Comparable | CT beats RT for aerobic capacity (SMD 0.77); RT before ET trends better for strength | [secondary umbrella], mostly recreational |
| Ferraro-Farro 2026, Int J Sports Med 47:747, doi:10.1055/a-2820-4527 | 9 RCTs, sprint interval training + RT | Lower body 0.01, upper -0.06 | Jump 0.11 (0.41 for sprints <= 10 s) | | VO2max +0.78 vs RT alone | [RCT pooled], small |

Mechanism reviews (Fyfe 2014, Sports Med 44:743, doi:10.1007/s40279-014-0162-1; Coffey & Hawley 2017, J Physiol 595:2883, doi:10.1113/JP272270) say the molecular "AMPK blocks mTOR" story has not held up in acute human studies and interference probably comes from several integrated processes, including residual fatigue. [secondary review]

Reading across them: the interference that remains after 2021 is small and concentrated in explosive strength and lower-body strength of trained men who run and lift in the same session. Modality is contradictory (Wilson: running hurts, cycling does not; Sabag: cycling trends worse; Schumann: no difference), so the engine should not encode a running-vs-cycling penalty. Training status is also contradictory (Petre: trained only; Schumann and Huiberts: no status effect). The only dose-response evidence is Wilson's correlations with endurance frequency and duration; no meta-analysis gives a weekly running threshold.

Recommended default: treat running as compatible with strength and hypertrophy and protect lower-body strength and power rather than muscle size. Pooled effects are near zero for maximal strength (SMD -0.06) and hypertrophy (-0.01), small for explosive strength (-0.28), and larger for trained lifters doing both in one session (-0.66). Do not encode a running-vs-cycling penalty; the meta-analyses disagree. Scale any interference warning with running frequency and duration, the only dose variables with evidence.

## 2. Sequencing and spacing

| Source | Design | Finding | Tag |
|---|---|---|---|
| Murlasits 2018, J Sports Sci 36:1212, doi:10.1080/02640414.2017.1364405 | Meta, same-session order | Strength first: lower-body 1RM +3.96 kg (0.81 to 7.10) vs endurance first; VO2max unaffected by order (+0.39 ml/kg/min, CI crosses 0) | [RCT pooled] |
| Eddens 2018, Sports Med 48:177, doi:10.1007/s40279-017-0784-1 | Meta, 10 studies | Resistance-endurance order: +6.91% lower-body dynamic strength (1.96 to 11.87); no order effect on hypertrophy, isometric strength, VO2max | [RCT pooled] |
| Robineau 2016, JSCR 30:672, doi:10.1519/JSC.0000000000000798 | 58 rugby players, 7 wk, 2 strength + 2 aerobic sessions/wk, strength always first, 0 / 6 / 24 h gap | Bench and half-squat gains lower with 0 h than 6 h, 24 h and strength-only. Isokinetic MVC at 180 deg/s higher with 24 h than 0 and 6 h. VO2peak gains larger with 24 h than 0 or 6 h. Authors: avoid < 6 h | [RCT] |
| Sporer & Wenger 2003, JSCR 17:638, doi:10.1519/1533-4287(2003)017<0638:eoaeos>2.0.co;2 | 16 men, intervals or continuous submax aerobic, then 4 sets leg press and bench at ~75% 1RM after 4, 8, 24 h | Leg press reps lower at 4 and 8 h, normal at 24 h; no difference between interval and continuous; bench unaffected, so the effect is local to the muscles used | [RCT crossover] |
| de Souza 2007, JSCR 21:1286, doi:10.1519/R-20686.1 | 8 men, 5 km treadmill continuous (90% threshold speed) or intermittent (1:1 min at vVO2max), strength 10 min later | Only intermittent reduced leg press reps at 80% 1RM (10.8 -> 8.1); 1RM unchanged after either | [RCT crossover] |
| Panissa 2015, JSCR 29:1077, doi:10.1519/JSC.0000000000000706 | 10 men, 15 x 1:1 min at max intensity, running or cycling, then 4 sets half squat at 80% | Set-1 reps and volume down after both; set 2 down only after cycling | [RCT crossover] |
| Dutra 2026, Eur J Sport Sci 26:e70176, doi:10.1002/ejsc.70176 | 12 men, ~8 km at vRCP (5 x 8 min), 130% (10 x 3 min) or 150% (20 x 80 s) | Knee-extensor voluntary force down for at least 6 h after all three; voluntary activation down to 4 h; contractile function (Qtw) -8% vs -2% and late RFD -18% vs -8% after the fastest vs threshold protocol | [RCT crossover] |
| Doma & Deakin 2013, APNM 38:651, doi:10.1139/apnm-2012-0362 | 14 runners, strength-then-run vs run-then-strength, 6 h apart; running test next day | Next-day cost of running at 70/90% VT: 0.76/0.77 after strength-first vs 0.72/0.70 baseline (mL/kg^0.75/m). Time to exhaustion 335 s baseline, 238 s strength-first (-29%), 275 s run-first (-18%) | [RCT crossover] |
| Doma & Deakin 2014, Eur J Sport Sci 14:107, doi:10.1080/17461391.2012.726653 | 15 runners, running test 6 h after heavy whole-body, heavy lower-body or light whole-body lifting | Running economy unchanged after all; time to exhaustion above threshold reduced after both heavy sessions | [RCT crossover] |
| Doma 2015, Eur J Appl Physiol 115:1789, doi:10.1007/s00421-015-3159-z | 14 resistance-untrained men, two 6RM lower-body sessions 1 wk apart | Submaximal running impaired to 24 h after each; second bout cut CK (-58%) and DOMS (-31%) at 48 h but did not reduce the running impairment | [obs] |

Doma's reviews (Sports Med 2017, doi:10.1007/s40279-017-0758-3; Sports Med 2019, doi:10.1007/s40279-019-01072-2) add that lifting-induced muscle damage impairs subsequent endurance sessions for hours to days, more with higher intensity, eccentric emphasis and short recovery. [secondary review]

Recommended default: when both happen on one day, lift first and run at least 6 h later; 24 h apart is better when strength is the priority. Any run in the 8 h before lower-body lifting lowers the rep ceiling, so the engine should expect fewer reps and down-weight that session's lower-body e1RM as an observation. Intervals cost strength endurance, not 1RM. After a heavy lower-body session keep the next run easy; economy and time to exhaustion stay impaired for about 24 h.

## 3. Running load quantification

Formulas (x = heart-rate reserve fraction = (HRex - HRrest) / (HRmax - HRrest), D = minutes):

| Method | Formula | Needs | Evidence | Tag |
|---|---|---|---|---|
| Session RPE (Foster 2001, JSCR 15:109, PMID 11708692) | load = CR-10 x D | One tap after the run | Tracks an HR-based standard across steady, interval and team exercise; same regression across modes. In runners, Banister model driven by sRPE correlated r = 0.60 with actual 1500 m performance (Wallace 2014) | [obs] |
| Banister TRIMP (Morton 1990, J Appl Physiol 69:1171, doi:10.1152/jappl.1990.69.3.1171, full text read) | w = D x x x e^(b x), b = 1.92 men, 1.67 women | HR rest, max, mean | Example given: 14 km in 1 h at HR 150 ~ 125 TRIMP. Model r = 0.65 with 1500 m performance (Wallace 2014). Later variant multiplies by 0.64 (men) / 0.86 (women); immaterial once normalised | [model]; prefactor variant [secondary] |
| Edwards TRIMP | sum of minutes in 50-60, 60-70, 70-80, 80-90, 90-100% HRmax x 1, 2, 3, 4, 5 | HR stream | Zone table from fellrnr.com, primary not read | [secondary] |
| Lucia TRIMP (Lucia 2003, MSSE 35:872, doi:10.1249/01.MSS.0000064999.82036.B4) | minutes < VT1, VT1-VT2, > VT2 x phase multiplier (1, 2, 3 as usually quoted) | Lab thresholds or estimates | Structure from the abstract; multipliers [secondary] | [obs] |
| rTSS (TrainingPeaks) | rTSS = hours x IF^2 x 100, IF = NGP / functional threshold pace (fastest pace sustainable ~1 h) | GPS + elevation | Model r = 0.70 with 1500 m performance, best of the three in Wallace 2014 (7 runners). NGP adjusts for hills and for sustained pace; exact algorithm proprietary | [expert]; Wallace [model, small] |

Wallace 2014, Eur J Appl Physiol 114:11, doi:10.1007/s00421-013-2745-1: 7 trained runners, 15 wk. All three inputs worked; submaximal HR tracked modelled fitness (r -0.43 to -0.48) and HRV tracked modelled fatigue (r -0.48 to -0.59). [model]

Grade adjustment. Minetti 2002 (J Appl Physiol 93:1039, doi:10.1152/japplphysiol.01177.2001, 10 runners, gradients -0.45 to +0.45) measured level running cost 3.40 J/kg/m, 18.93 at +0.45, a minimum of 1.73 at -0.20, rising to 3.92 at -0.45. The fitted polynomial (secondary transcription, verified against multiple copies) is Cr(i) = 155.4 i^5 - 30.4 i^4 - 43.3 i^3 + 46.3 i^2 + 19.5 i + 3.6 with i as a fraction; note its level intercept is 3.6, not the measured 3.40. Ratios Cr(i)/Cr(0) computed here [derived]:

| Grade | -30% | -20% | -15% | -10% | -5% | 0 | +5% | +10% | +15% | +20% | +30% |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Minetti cost ratio | 0.68 | 0.50 | 0.51 | 0.60 | 0.76 | 1.00 | 1.30 | 1.66 | 2.06 | 2.50 | 3.49 |

Strava's 2017 heart-rate-fitted GAP (engineering blog, medium.com/strava-engineering) gives a much smaller downhill discount: minimum factor about 0.88 at -9%, back to 1.0 by -18%, vs about 0.5 at -18% in their earlier Minetti-based model. [secondary] Minetti is steady-state metabolic cost on a treadmill; the HR-based curve is closer to what a runner feels downhill, and neither captures eccentric muscle damage (section 4).

ACWR. Impellizzeri 2020 (IJSPP 15:907, doi:10.1123/ijspp.2019-0864): no study has estimated a causal effect; the ratio is mathematically coupled, adds noise and is not consistently related to injury; "no evidence supporting the use of ACWR in training-load-management systems". Lolli 2019 (BJSM 53:921, doi:10.1136/bjsports-2017-098110) shows the coupling creates spurious correlation. The original rugby finding (Hulin 2016, BJSM 50:231, doi:10.1136/bjsports-2015-094817: ACWR >= 2.11 had 16.7% injury risk that week) has not transferred to runners: in 5205 Garmin runners, ACWR showed a negative dose-response with injury (Frandsen 2025, section 6). [expert critique; obs]

No heart rate. sRPE needs no sensor and is valid across modes, so G_s stays on sRPE x minutes / 100 for runs. Pace-based intensity (rTSS, zones relative to critical speed from section 5) covers the per-muscle and fitness side. HR TRIMP is optional. If elevation is missing, grade is 0 and the descent term in section 4 is not available; show a "no elevation" note rather than guessing.

Recommended default: feed G_s from sRPE x minutes / 100 for runs exactly as for lifts, asked with one tap after the run. Compute rTSS from GPS as the external load: grade-adjust speed with the Minetti ratio uphill and a downhill factor floored near 0.88, IF = NGP / threshold pace, rTSS = hours x IF^2 x 100. Use Banister TRIMP only when HR exists. Show acute and chronic loads side by side and never compute or flag an ACWR.

## 4. Local muscle fatigue from running

Which muscles:
- Hamner & Delp 2013 (J Biomech 46:780, doi:10.1016/j.jbiomech.2012.11.024), simulations of 10 runners at 2-5 m/s: soleus gives the largest upward and forward acceleration of the body at every speed (about 2 body weights of force at 5 m/s). [model]
- Dorn 2012 (J Exp Biol 215:1944, doi:10.1242/jeb.064527): plantarflexors (soleus, gastrocnemius) dominate support up to 7 m/s; above that, iliopsoas, gluteus maximus and hamstrings drive stride frequency. Recreational running rarely exceeds 7 m/s outside sprints. [model]
- MRI after road races: half marathon raised T2 in all thigh muscles at 2-3 h and still at 1 d (Shu 2024, Eur J Sport Sci, doi:10.1002/ejsc.12189); DTI changes largest in vastus intermedius, vastus medialis, semimembranosus and adductor magnus at 3 h, gone by 3 d (Zhou 2022, doi:10.3760/cma.j.cn112137-20210716-01591). After a marathon, T2 rose in semimembranosus and both gastrocnemius heads, semimembranosus still elevated at 2 months (Zhang 2022, n = 12, doi:10.3760/cma.j.cn112137-20210626-01448); deep calf and foot muscles (tibialis posterior, FDL, FHL) +4.7 to +6.7% at 1 d (Fukano 2023, Scand J Med Sci Sports, doi:10.1111/sms.14377). [obs, small]
- Downhill: after 45 min at -15%, knee extensors lost 14-17% and plantar flexors 6-8% of isometric torque at 24-48 h, with the largest T2 change in proximal-middle vastus intermedius (Maeo 2017, Sci Rep, doi:10.1038/s41598-017-06129-8). High-intensity downhill at matched VO2 cut knee extensor torque 15% and hip extensor torque 11% (Lemire 2020, J Sports Sci, doi:10.1080/02640414.2020.1847502). Negative external work rises from 6% to 92% of total from steep uphill to steep downhill (Lemire 2024, Sports Med Open, doi:10.1186/s40798-024-00746-0). [obs]

Time courses:

| Session | Measure | Immediately | 24 h | 48 h | Later | Source | Tag |
|---|---|---|---|---|---|---|---|
| ~8 km at or above RCP (intervals) | KE voluntary force, VA | down | | | force still down at 6 h; VA back by 4-6 h | Dutra 2026, doi:10.1002/ejsc.70176 | [RCT crossover] |
| 5 x 1000 m | CMJ height | -4.7 to -7.2% | | | | Castellanos-Salamanca 2023, doi:10.1080/17461391.2023.2171907 | [RCT crossover] |
| Half marathon (recreational) | KE MVC, VA, RFD | -11%, -4 to -6%, -14 to -15% (men and women alike) | | | | Boccia 2018, Eur J Sport Sci 18:695, doi:10.1080/17461391.2018.1442500 | [obs] |
| Half marathon | CMJ variables | down | | most back to baseline | concentric/eccentric peak force not yet back at 48 h | Costello 2020, IJSNEM, doi:10.1123/ijsnem.2019-0312 | [RCT, control arm] |
| Marathon (elite, 2:34) | KE MVC / PF MVC / CMJ power | -22% / -17% / -13% | | CMJ -18% (day 2) | CMJ -12% at day 5; running energy cost +4% post | Petersen 2007, Eur J Appl Physiol 101:385, doi:10.1007/s00421-007-0504-x | [obs, n = 8] |
| Marathon (recreational) | strength, CMJ | down | down | down (control arm) | | Kwiecien 2020, Scand J Med Sci Sports, doi:10.1111/sms.13822 | [RCT, control arm] |
| Marathon | KE peak torque | -36% | | | depressed to 72 h, baseline by 168 h | Sherman 1984, quoted in doi:10.1080/17461390701197833 | [secondary] |
| Marathon (3:35 mean) | CK, squat jump | | | | 40 min easy runs from 48 h did not slow CK recovery; SJ better at 96 h than rest | Martinez-Navarro 2021, doi:10.1080/17461391.2020.1857441 | [RCT] |
| Downhill trail 6.5 km, 1264 m drop, fast | KE / PF MVC | -19% / -25% | | -9% / -10% (day 2) | | Giandolini 2015, Scand J Med Sci Sports, doi:10.1111/sms.12583 | [obs] |
| 45 min at -15% | KE / PF torque | | -14 to -17% / -6 to -8% (24-48 h) | | | Maeo 2017 | [obs] |
| One-legged downhill | KE MVC | down at 30 min | | -9.6% | not recovered by 96 h | Martin 2004, MSSE, doi:10.1249/01.mss.0000145526.43208.08 | [RCT] |
| 30 min at -15%, untrained | VO2 in a level run | +18.3% | | +11.7% (day 2) | | Lima 2020, doi:10.1080/17461391.2020.1727570 | [obs] |

No study found here gives a recovery time course after an easy continuous run in trained runners; Dutra 2026 (force still down 6 h after threshold work) is the upper bound, and Sporer 2003 shows continuous submaximal running still cut leg press reps at 4 and 8 h but not 24 h.

Repeated bout effect. Byrnes 1985 (J Appl Physiol 59:710, doi:10.1152/jappl.1985.59.3.710): 30 min downhill raised CK 340%; the same run 3 or 6 wk later raised it 63% and 62%; at 9 wk there was no protection. Bontemps 2025 (Eur J Sport Sci, doi:10.1002/ejsc.12240): knee extensor torque loss after a standard 15 min downhill bout was -14%, -11%, -9% after 0, 5 and 10 downhill sessions (not significant), while quadriceps soreness fell from 29.6 to 8.7 mm. So the protection is large for soreness and CK and modest for force. [obs]

Prolonged level running at 90% VT1 for 120 min cut speed at VT1 by 6.2%, and adding 30 min at -10% did not reduce it further (Barrett 2025, doi:10.1007/s00421-025-05792-4). Tiller 2024 (Sports Med, doi:10.1007/s40279-024-02127-9) argues muscle damage, not aerobic capacity, limits long ultramarathons. [obs; expert]

Derivation of sets-equivalents [derived]. No study reports running in set units, so anchor on knee-extensor force loss against a lifting session the engine already scores:
- Anchor: Bartolomei 2017 squat 8 x 10 at 70% 1RM (from RESEARCH-fatigue.md section 3): MVIC -23.6% at 30 min, -11% at 72 h. In engine units that is 8 quad set-equivalents (8 sets, target weight 1.0, setFactor 1.0 at RPE 8). Loss per set-equivalent: 23.6 / 8 = 2.95%.
- Marathon (Petersen 2007): 22 / 2.95 = 7.5 quad set-eq over 42.2 km = 0.177 per km.
- Half marathon (Boccia 2018): 11 / 2.95 = 3.7 quad set-eq over 21.1 km = 0.177 per km.
- The two races agree, so use q = 0.18 quad set-eq per km at steady effort (roughly marathon-to-threshold intensity).
- Intensity: de Souza 2007 found intervals, not continuous running at 90% threshold speed, cut leg reps; Dutra 2026 found about 2-4x the contractile impairment at 150% vs 100% RCP. Zone multipliers z = 0.5 easy, 1.0 steady/tempo, 1.5 above critical speed are chosen from those directions; no study gives them. [derived, weak]
- Zone boundaries without HR: Smyth 2020 (section 5) found marathons run at 84.8% of critical speed on average and 78.9% by 6 h finishers. The anchor races sit at z = 1.0, so the easy/steady split goes below the slowest marathon pace: easy < 0.78 CS, steady 0.78-1.0 CS, hard > CS. [derived]
- Calves: Petersen PF/KE loss 17 / 22 = 0.77, plus soleus as the largest contributor (Hamner) -> calves 0.8 q. Hamstrings: MRI and DTI involvement of semimembranosus but no force data; Dorn puts hamstrings in charge only at sprint speeds -> 0.4 q, 0.8 q above CS [weak]. Glutes: hip/knee extensor loss ratio 11 / 15 = 0.73 in Lemire's downhill test, no level data -> 0.5 q [weak]. Hip flexors and adductors have no RP row; leave them out.
- Descent: Giandolini 2015, 6.5 km with 1264 m drop, KE -19%: 19 / 2.95 = 6.4 set-eq, minus the level part 6.5 x 0.18 = 1.2, leaves 5.3 set-eq / 1264 m = 0.0042 quad set-eq per metre descended. Check against Maeo 2017 under an assumed 9 km/h (speed not given): 6.75 km, ~1010 m drop, peak loss 15.5% -> 5.3 - 1.2 = 4.1 / 1010 = 0.0040 per m. Use 0.4 quad set-eq per 100 m descended on segments steeper than -5% (the -5% cut-off is chosen, not sourced; it keeps rolling terrain out of the damage term). Calves: PF/KE loss ratio was 1.3 in Giandolini and 0.45 in Maeo; use 0.6 of the quad descent term (0.25 per 100 m). [derived, weak]
- Repeated bout factor on the descent term: Bontemps force loss 14 -> 11 -> 9% gives 0.79 after 5 sessions and 0.64 after 10; protection lasts to 6 wk but not 9 wk (Byrnes). RBE = max(0.65, 1 - 0.035 n), n = runs with >= 200 m descent in the last 42 d. [derived]
- Slower damage state: Petersen CMJ power -18% at day 2 and -12% at day 5 gives tau = 3 / ln(18/12) = 7.4 d; Giandolini KE -19% post to -9% at day 2 gives 2.7 d (includes fast acute fatigue); Sherman's baseline at 168 h sits between. Bartolomei's squat (-23.6% at 30 min to -11% at 72 h) gives 3.9 d, so the engine's 2.5 d lifting tau is already at the fast end. Route the descent term and the part of any run beyond 120 min into a per-muscle damage state with tau 5 d. [derived]

Check on the recreational marathon (3:35): first 120 min ~ 23.5 km x 0.18 = 4.2 quad set-eq into G_m; remaining 18.7 km x 0.18 = 3.4 into the damage state; total 7.6, matching the anchor. A 10 km easy run: 10 x 0.18 x 0.5 = 0.9 quad set-eq, 0.7 calves. A 40 km easy week adds 3.6 quad set-eq of fatigue.

These inputs describe fatigue only. Endurance-only training produced a hypertrophy ES of 0.27 vs 1.23 for strength training (Wilson 2012), so running set-equivalents must not count toward RP weekly MEV/MRV set targets.

Recommended default: add runs to per-muscle fatigue as sets-equivalents anchored on knee-extensor force loss: 0.18 quad set-eq per km at steady effort, x0.5 easy, x1.5 above critical speed; calves 0.8, glutes 0.5 and hamstrings 0.4 (0.8 above CS) of that. Add 0.4 quad and 0.25 calf set-eq per 100 m descended, scaled by a repeated bout factor, into a 5 d damage state together with any running beyond 120 min. All numbers are derived. They count as fatigue, never toward weekly set targets.

## 5. Running fitness, fatigue and the performance observation

| Source | Population | tau fitness | tau fatigue | k1, k2 | Fit | Tag |
|---|---|---|---|---|---|---|
| Morton 1990, J Appl Physiol 69:1171, doi:10.1152/jappl.1990.69.3.1171 (Table 2, read) | 2 men (57 and 42 y), 28 d daily running then 50 d taper; Banister TRIMP; criterion 4.2-4.7 km run converted to points | 50 (EWB), 40 (RHM) | 11, 11 | k1 1, k2 1.8 and 2.0 | r2 0.71 and 0.96 | [model, n = 2] |
| Morton 1990 illustrative defaults | | 45 | 15 | 1, 2 | | [model] |
| Kontro 2026, PLoS One 21:e0341721, doi:10.1371/journal.pone.0341721, Table 2 | Compilation: Busso 2003 cycling 41 +- 15 / 9 +- 6 and 35 +- 12 / 13 +- 3; Chalencon 2015 51 +- 14 / 10 +- 9 | | | | | [secondary] |
| Wood 2005, Eur J Appl Physiol 94:310, doi:10.1007/s00421-005-1319-2 | 1 middle-distance runner, 12 wk | parameters not in abstract | | | r2 0.92; model fitness vs speed at VT r = 0.94, vs running economy r = -0.61; model fatigue vs POMS fatigue r = 0.75 | [model, n = 1] |
| McGregor 2009, JSCR 23:2515, doi:10.1519/JSC.0b013e3181bf88be | Olympic 1500 m finalist, 7 years, pace-based TSS | CTL (42 d) | ATL (7 d) | p = CTL - ATL | p correlated with Mercier scores, quadratic relation with CTL | [model, n = 1] |
| TrainingPeaks Performance Manager | defaults | CTL 42 | ATL 7 | | | [expert] |

The identifiability problems in RESEARCH-fatigue.md section 1 apply unchanged: two runners are not a prior, only a sanity check that running taus sit in the same 40-50 / 10-15 d range as other endurance fits.

Performance observation (the e1RM analogue):
- Critical speed from GPS logs. Smyth & Muniz-Pumares 2020 (MSSE 52:2637, doi:10.1249/MSS.0000000000002412), > 25,000 runners' training files: fastest grade-adjusted efforts over 400, 800, 1000, 1500, 3000 and 5000 m; CS = slope of the distance-time line through at least three of them (R2 0.9999). CS was 3.74 +- 0.08 m/s across models; CS from 400, 800 and 5000 m predicted marathon time best (R 0.695, error 7.67%). Runners ran marathons at 84.8% +- 13.6% CS (93.0% for 150 min finishers, 78.9% for 360 min); those who ran the first half faster than 94% CS were more likely to slow by > 25%. [obs, large]
- CS separates sustainable from non-sustainable intensities, with a finite work capacity (D', the running W') above it (Jones & Vanhatalo 2017, Sports Med 47:S65, doi:10.1007/s40279-017-0688-0). [secondary review]
- VDOT (Daniels & Gilbert 1979): VO2 = -4.60 + 0.182258 v + 0.000104 v^2 (v in m/min); fraction sustainable = 0.8 + 0.1894393 e^(-0.012778 t) + 0.2989558 e^(-0.1932605 t) (t in min); VDOT = VO2 / fraction. Coefficients from calculator sites that agree with each other; primary not read. [secondary]
- Riegel: T2 = T1 x (D2/D1)^1.06, stated range 3.5-230 min. [secondary] Vickers 2016 (BMC Sports Sci Med Rehabil 8:26, doi:10.1186/s13102-016-0052-y), 2303 recreational runners: well calibrated up to the half marathon, but at least 10 min too fast for half of marathoners; MSE 381 vs 208-228 for their own models. [obs]
- Submaximal HR at a fixed grade-adjusted pace tracks fitness moderately (Wallace 2014, r -0.43 to -0.48). [model]

Recommended default: track running fitness as its own state F_run (tau 42 d; Morton's runners fitted 40 and 50 d with fatigue 11 d), fed by rTSS / 100, and let running fatigue act through the existing G_s and lower-limb G_m. The run analogue of e1RM is VDOT from any GPS effort of 3.5-230 min rated sRPE >= 8, with critical speed from 400, 800 and 5000 m bests over 90 days as a cross-check. Hold theta at Morton's k2/k1 of about 2 until 20 observations.

## 6. Progression rules and injury signals

| Source | Design | Finding | Tag |
|---|---|---|---|
| Buist 2008, AJSM 36:33, doi:10.1177/0363546507307505 | GRONORUN RCT, 532 novices, 13-wk graded plan built on the 10% rule vs standard 8-wk plan | Injury 20.8% vs 20.3% (p = 0.90). The 10% rule did not prevent injury | [RCT] |
| Nielsen 2014, JOSPT 44:739, doi:10.2519/jospt.2014.5164 | 874 novices with GPS watches, 1 yr | No overall difference by weekly progression; distance-related injuries HR 1.59 (0.96-2.66) for > 30% vs < 10% over 2 wk | [obs, exploratory] |
| Damsted 2019, JOSPT 49:230, doi:10.2519/jospt.2019.8541 | 261 half-marathon trainees, 14 wk, GPS | 20-60% weekly increase: risk difference +22.6% (0.9-44.3) at 21 d, not at 56 or 98 d | [obs] |
| Damsted 2018, Int J Sports Phys Ther 13:931, PMC6253751 | Systematic review, 4 studies | "Very limited evidence" linking load change to running injury; no difference between 10% and 24% average increases (HR 0.8) | [secondary review] |
| Frandsen 2025, BJSM 59:1203, doi:10.1136/bjsports-2024-109380 | 5205 Garmin runners, 18 months, 588,071 sessions, 1820 injured | Single run longer than the longest in the past 30 d by > 10-30%: HRR 1.64 (1.31-2.05); 30-100%: 1.52 (1.16-2.00); > 100%: 2.28 (1.50-3.48). ACWR negative dose-response; week-to-week ratio no relation | [obs, large] |
| Videbaek 2015, Sports Med 45:1017, doi:10.1007/s40279-015-0333-8 | Meta, 13 studies | Injuries per 1000 h: novices 17.8 (16.7-19.1), recreational 7.7 (6.9-8.7) | [obs pooled] |
| van Poppel 2018, Musculoskelet Sci Pract 36:48, doi:10.1016/j.msksp.2018.04.007 | 3768 event runners | Previous injury OR 3.7; more weekly training km slightly protective (OR 0.99 per km) | [obs] |
| Malisoux 2015, JSAMS 18:523, doi:10.1016/j.jsams.2014.07.014 | 517 recreational runners, 9 mo | Weekly volume < 2 h HR 3.29 and < 2 sessions/wk HR 2.41 vs more; previous injury modifies both | [obs] |
| Malisoux 2015, Scand J Med Sci Sports 25:110, doi:10.1111/sms.12154 | 264 runners, 22 wk | More weekly hours of other sports HR 0.848 per h; previous injury HR 1.72 | [obs] |
| Nielsen 2014, Int J Sports Phys Ther 9:338, PMC4060311 | 749 novices, 3 wk | BMI > 30 and > 3 km in week 1: cumulative risk difference +14.3 to +16.2% | [obs] |

Intensity distribution:
- Seiler & Kjerland 2006 (Scand J Med Sci Sports 16:49, doi:10.1111/j.1600-0838.2004.00418.x): elite junior skiers spent ~75% of sessions below VT1, 8% between thresholds, 17% above. This is the descriptive origin of "80/20". [obs]
- Munoz 2014 (IJSPP 9:265, doi:10.1123/ijspp.2012-0350): 30 recreational runners, 10 wk, 77/3/20 vs 46/35/19: 10 km improved 5.0% vs 3.6% (not significant). [RCT]
- Oliveira 2024 (Sports Med 54:2071, doi:10.1007/s40279-024-02034-z): polarized beats other distributions for VO2peak (SMD 0.24, 0.01-0.48), only in < 12 wk and highly trained athletes; no difference in time trial (-0.01). Rosenblat 2025 (Sports Med 55:655, doi:10.1007/s40279-024-02149-3), individual data: polarized vs pyramidal no difference in VO2max or time trial; competitive athletes may do better with polarized, recreational with pyramidal. Li 2026 network meta (JSCR, doi:10.1519/JSC.0000000000005415): no distribution clearly better. [RCT pooled]

Taper: Bosquet 2007 (MSSE 39:1358, doi:10.1249/mss.0b013e31806010e0): 2 wk taper (ES 0.59), volume cut 41-60% exponentially (ES 0.72), intensity and frequency kept. [RCT pooled]

Recommended default: drop the 10% rule, which failed its only trial. Flag any single run more than 10% longer than the longest run of the last 30 days (HRR 1.64) and weekly distance up more than 30% across two weeks (HR 1.59, CI crosses 1); weight flags up after a previous injury. Plans should lengthen the long run gradually, keep most running easy (polarized or pyramidal both fine), and taper two weeks with volume cut 41-60% and intensity kept.

## 7. Practical scheduling rules

Evidence-based pieces, restated from sections 2 and 4: 6 h or more between modes (Robineau 2016; Schumann 2022 same-session vs >= 3 h), lifting first when both are on one day (Murlasits 2018, Eddens 2018), leg reps down for 8 h after running of any intensity but not at 24 h (Sporer 2003), running economy and time to exhaustion down for ~24 h after heavy lower-body lifting (Doma 2013, 2015), half-marathon CMJ back by 48 h (Costello 2020), marathon power still -12% at 5 d (Petersen 2007), easy running from 48 h after a marathon does no harm (Martinez-Navarro 2021). Heavy strength work itself helps runners: 4 x 4 half squats 3x/wk for 8 wk raised 1RM 33% and improved running economy 5% (Storen 2008, MSSE 40:1087, doi:10.1249/MSS.0b013e318168da2f); a systematic review of 26 studies found better economy and time-trial performance (Beattie 2014, Sports Med 44:845, doi:10.1007/s40279-014-0157-y). [RCT; secondary review]

Coach practice:
- Barbell Medicine (barbellmedicine.com/blog/concurrent-training-and-the-interference-effect): conditioning after lifting on the same day at ~60-80% HRmax; strength-focused intermediates build from 60 to 90 to 150 min/wk of zone 1-2 over 6 wk; consider non-running modes to limit musculoskeletal fatigue; before a meet taper conditioning from 200 to 30 min/wk over 5 wk. [expert]
- Stronger by Science, Concurrent Training for the Powerlifter part 2 (strongerbyscience.com/concurrent-training-part-2): separate modes by ~24 h where possible, otherwise by a few hours; low to moderate intensity conditioning shows little interference and goes after lifting if close. [expert]
- Doma 2019 review: lifting-induced muscle damage degrades the next endurance session; manage order, recovery time, intensity and eccentric load so quality runs are not run on damaged legs. [secondary review]
- "Hard days hard, easy days easy" (stack lower-body lifting and quality runs on the same day, separated by hours, and keep the following day easy) is common hybrid-coaching practice; no trial compares it with spreading the stress. [expert, weak]

Recommended default: stack stress (expert). Put intervals or tempo on lower-body days, lifting first and the run 6 h or more later, and keep easy runs on upper-body or rest days. Swap a planned hard run to easy when the previous 24 h held 8 or more quad set-equivalents of lifting. Hold lower-body load progression while running-derived quad or calf fatigue exceeds one normal session. After a half marathon wait 48 h before heavy lower-body work; after a marathon wait 5 days, then deload lower body 50%.

## 8. Proposed engine changes (for PLAN.md section 6)

All numbers below come from the recommended defaults above; [derived] items are marked there. The running inputs are scaled by knee-extensor force loss against a scored squat session, so a running set-equivalent sits on the same scale as a lifting one. That is what lets the lifting-fitted Kalman theta stay valid when running fatigue is added to `G_weighted`; do not rescale q on its own.

States:
- `fatigueMuscleDamage[group]` for quads, calves, hamstrings, glutes: tau 5 d. Added to `G_weighted` wherever `G_m` is used (Kalman observation, readiness, bindings).
- `fitnessRun` F_run: tau 42 d, input rTSS / 100.
- `kalmanRun`: observation VDOT, theta prior 2.0 fixed until 20 observations, same filter as lifts.
- `criticalSpeed`: slope of distance vs time through the best grade-adjusted 400, 800 and 5000 m efforts in the last 90 d; recomputed after each run.

Inputs per run:
- G_s += sRPE x minutes / 100 (unchanged formula). Missing sRPE: use HR TRIMP or rTSS scaled by a per-user ratio fitted after 10 runs with both; until then prior 3.6 G_s units per 100 rTSS [derived: assumes an hour at threshold rates CR-10 6; unvalidated].
- Per km (grade-adjusted speed v): z = 0.5 if v < 0.78 CS, 1.0 if 0.78-1.0 CS, 1.5 if > CS. q = 0.18 x z. Quads q, calves 0.8 q, glutes 0.5 q, hamstrings 0.4 q (0.8 q when z = 1.5). Kilometres after minute 120 go to the damage state, the rest to G_m.
- Per 100 m descended on segments steeper than -5%: quads 0.4, calves 0.25, into the damage state, times RBE = max(0.65, 1 - 0.035 n), n = runs with >= 200 m descent in the last 42 d.
- GAP factor: Minetti ratio for grades >= 0; for downhill max(Minetti ratio, 0.88), capped at 1.0 beyond -18%.
- Running set-equivalents are excluded from weekly MEV/MAV/MRV set counts and from RP set progression.
- Run sRPE-load joins daily load for the monotony and strain flags.

Cross-modal rules (new reason codes):
- `runBeforeLift`: a run of >= 30 min ended < 8 h before a session with squat, deadlift, lunge or leg press: expected reps for those lifts -1 per set, that session's lower-body e1RM measurement noise x2.
- `liftBeforeHardRun`: >= 8 quad set-eq (G_m input) in the prior 24 h and a planned run at z = 1.5 or > 90 min: recommend an easy run.
- `sameDayOrder`: both on one day: lift first; warn when the gap is < 6 h, and < 24 h for users set to strength priority.
- `runFatigueHold`: running-derived quad or calf fatigue (G_m + damage) above that muscle's typical per-session lifting input: no load increase that day.
- `postRace`: run >= 21 km at z >= 1.0: no heavy lower-body work for 48 h; >= 42 km: 5 d, then one lower-body session at 50% sets.
- Flags: `runSpike` when a run exceeds 1.10 x the longest run in the last 30 d; `mileageJump` when 2-week distance growth is > 30%; reuse the joint-pain tap for running pain; no ACWR anywhere.
- Plan generator: 75-80% of running time at z = 0.5; 14 d taper with volume -50%, intensity and frequency kept.

Provenance: abstracts retrieved via PubMed for Wilson 2012, Schumann 2022, Petre 2021, Sabag 2018, Murlasits 2018, Eddens 2018, Huiberts 2024, Held 2026, Ferraro-Farro 2026, Fyfe 2014, Coffey & Hawley 2017, Robineau 2016, Sporer & Wenger 2003, de Souza 2007, Panissa 2015, Doma 2013/2014/2015/2017/2019, Dutra 2026, Castellanos-Salamanca 2023, Foster 2001, Lucia 2003, Minetti 2002, Wallace 2014, Wood 2005, McGregor 2009, Impellizzeri 2020, Lolli 2019, Hulin 2016, Hamner 2013, Dorn 2012, Shu 2024, Zhou 2022, Zhang 2022, Fukano 2023, Maeo 2017, Lemire 2020/2024, Boccia 2018, Costello 2020, Petersen 2007, Kwiecien 2020, Martinez-Navarro 2021, Giandolini 2015, Martin 2004, Lima 2020, Byrnes 1985, Bontemps 2025, Barrett 2025, Tiller 2024, Smyth 2020, Jones & Vanhatalo 2017, Vickers 2016, Buist 2008, Nielsen 2014 (both), Damsted 2018/2019, Frandsen 2025, Videbaek 2015, van Poppel 2018, Malisoux 2015 (both), Seiler 2006, Munoz 2014, Oliveira 2024, Rosenblat 2025, Li 2026, Bosquet 2007, Storen 2008, Beattie 2014 (retrieved 2026-09-13). Morton 1990 full text read (ResearchGate author copy). Scholar Gateway passages for Dutra 2026 and the Sherman 1984 citation in doi:10.1080/17461390701197833. Kontro 2026 Table 2 via PMC. Web sources: TrainingPeaks (rTSS, CTL/ATL), veohtu.com and fellrnr.com (TRIMP variants), Strava engineering blog (GAP 2017), aaron-schroeder.github.io (Minetti polynomial copy), Daniels-Gilbert coefficients from runbundle.com and tpjnorton.com, Barbell Medicine and Stronger by Science articles (fetched 2026-09-13).
