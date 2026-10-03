# Research brief: body composition measurement, and not weighing yourself every morning

Status: **brief, written 2026-10-02. Nothing in this file is a finding.** Section 6 lists what was located and skimmed. The owner's position going in: stop treating the daily scale as the primary signal, get a reference measurement (DEXA), and track against that plus what the training actually does.

Tags: same convention as the other reports.

## 1. Why this is a product question and not a diatribe

The app is going to tell a person what they actually gained. That means the app needs a definition of "gained", and a defensible answer has to survive contact with measurement error. Three consequences:

- **Daily weight is noise and should be shown as a trend, not a number.** The scale reading on a given morning carries a day-to-day swing that is the same size as the change a beginner is trying to detect.
- **A reference measurement is sparse.** DEXA is a quarterly event for most people, not a daily one, so the app's job is to hold the gap between scans and make the in-between honest.
- **Composition is not size.** A kilo of fat and a kilo of muscle are different objects with different training implications, and only some measurements distinguish them. The app must not offer a number it cannot stand behind.

This is also the topic of one of the beginner podcast episodes, so the brief has to be finished before that script is final.

## 2. What DXA actually measures, and what "lean mass" means

- DXA is a three-compartment method: it reports fat mass, fat-free mass and bone mineral content, with the fat-free compartment including water. It is the reference method for body composition in sport science, and the reason it is the reference is repeatability across visits, not that it separates muscle from water or organ from connective tissue.
- **The hydration assumption.** DXA estimates fat-free tissue as a fixed hydration state. Change the hydration of the fat-free compartment and the reading moves even when nothing about the body changed. Vendor literature puts a 5% hydration variation in fat-free mass at roughly a 3% shift in the reading; that number is marketing-adjacent and must be traced to a primary study or dropped.
- **Lean mass is not muscle.** Tavoian 2019 (Sci Rep, doi:10.1038/s41598-019-46428-w) compared DXA-derived lean mass against MRI cross-sectional muscle area over time and found only a modest association between the two measures of change. That is the single most important caveat for this project, because the entire pitch of a DEXA scan to a lifter is "did I add muscle".
- What DXA is good at: comparing fat mass and fat-free mass against your own previous scan, on the same machine, at a similar time of day and in a similar hydration state. What it is not good at: telling you which part of your body the fat is on beyond its regional estimates, and anything at all about how you feel.
- Radiation dose: find the primary figure and cite it. The brief should not state a dose it cannot source, and the podcast script should not either.
- Between-scan conditions are the whole ballgame: same machine if possible, same time of day, fasted, and the hydration question above acknowledged out loud.

## 3. The other methods, and why the app should rank them

- Skinfolds: cheap, no radiation, an operator skill problem. Needs its own error figure from a primary source.
- Bioelectrical impedance (the bathroom scale with electrodes): nearly worthless for day-to-day change and very sensitive to hydration, food, sodium and recent exercise. Worth reading enough to explain in one sentence why the consumer number and the DXA number disagree.
- Air displacement (Bod Pod) and hydrostatic weighing: where they sit between DXA and skinfolds.
- Anthropometrics: circumference measurements and progress photos. These are free, repeatable at home and directly relevant to how a person looks, which is what most people actually care about. They are also the measurement a beginner can sustain for a year. The app should probably treat these as first-class alongside DXA, not as a consolation prize.
- Which methods the app will accept as a user entry, and what confidence label each one gets, is the decision this brief has to support.

## 4. The daily-weight problem, sourced

- Total body water in healthy adults fluctuates by around ±5% day to day (Bhutani 2017, PMC5506524), and body glycogen and its bound water is a large part of that swing, with sodium and gut contents on top.
- Secondary sources put the typical daily weight swing at 1-5 lb, with larger people and higher-sodium days at the top of the range. Those are clinic and vendor pages; find the primary or present the number as a range of reported experience rather than a finding.
- The behavioural literature on daily weighing is where the podcast lives: what weighing every day does to people who are trying to change their body composition, and why a weekly average of a daily number is a different measurement than a daily number.
- Read the self-monitoring literature properly rather than asserting a harm. If daily weighing is fine for some people and corrosive for others, the app should say that and default to the weekly trend.

## 5. What the app should hold

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

## 6. Sources located on 2026-10-02 (skimmed, not read in full)

| Source | What it gives | Status |
|---|---|---|
| Shepherd 2017, PMC5659281, "Body Composition by DXA" | Reviews of DXA as a method, including the difficulty of validating absolute calibration against true muscle and fat | open-access copy located |
| Kim 2024, Clin Pediatr Pract (doi:10.36011/cpp.2024.6.e13) | DXA as the three-compartment gold standard in a clinical context | abstract located |
| Tavoian 2019, Sci Rep, doi:10.1038/s41598-019-46428-w | DXA-derived lean mass changes only modestly track MRI cross-sectional muscle area changes | abstract located; this is the load-bearing citation |
| Bhutani 2017, PMC5506524 | Total body water fluctuates up to ±5% daily in healthy individuals | abstract located |
| Dexalytics and BodySpec vendor pages | SEM of measurement about 2.5-3.5% for DXA; 1-5 lb typical daily weight swing; the 5% hydration variation shifting readings ~3% | [secondary] vendor material, to be traced to primaries or dropped |
| UC Davis Health, Bod Pod, BodySpec | Method descriptions and inter-method positioning | [secondary] institutional pages |

## 7. What has to come out of this brief

1. The ranked list of measurement methods the app accepts, each with a sourced precision and the conditions under which it is comparable.
2. The hydration and "lean mass is not muscle" caveats in plain language, reusable in the app and in the podcast script.
3. A sourced position on daily weighing, and the weekly-trend default that follows from it.
4. The record shapes in section 5, with the photo-retention answer.
5. The copy for the gap between scans: what the app can honestly say after eight weeks with no measurement.
6. The "what a kilo of fat and a kilo of muscle actually are" numbers, sourced, which both the app and the script need.

## 8. Consumers

`docs/PLAN.md` 16f; the Body tab (U22); the `settings` and record schema in section 7; `docs/podcast/scripts/` for the body-composition episode.