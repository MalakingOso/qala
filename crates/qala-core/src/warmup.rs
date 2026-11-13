//! The warm-up (PLAN 6.7, DECISIONS D32): easy cardio, soft tissue with the tools the lifter owns, dynamic mobility, then
//! ramp sets worked out from each exercise's working weight. Pure: no clock, no storage.
//!
//! The plan carries structure and numbers (a machine, a tool, a muscle id, seconds, a reason code, the drill names). The app
//! words every row, so no English sentence lives here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::js::js_round;
use crate::plates::{self, PlateEntry};
use crate::rest::RestClass;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    Lb,
    Kg,
}

/// The weight a bar can be loaded to that is nearest `weight`, never under the empty bar.
///
/// Pounds on a bar go to the plate math (the nearest total the plates can make, ties below). Kilograms and lifts with no
/// bar (`bar` of zero or less: a cable stack, a dumbbell rack) stay on a placeholder, the nearest 5 lb or 2.5 kg with
/// halves up, because the plate inventory is pounds only and a stack has no plates.
pub fn round_loadable(weight: f64, unit: Unit, bar: f64, plates: &[PlateEntry]) -> f64 {
    if unit == Unit::Lb && bar > 0.0 {
        plates::round_weight(weight, bar, plates, 0.0)
    } else {
        let step = if unit == Unit::Kg { 2.5 } else { 5.0 };
        (js_round(weight / step) * step).max(bar)
    }
}

/// The tools for soft tissue and the one machine for the cardio (`None` for a brisk walk).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Equipment {
    pub foam_roller: bool,
    pub percussion: bool,
    pub cardio: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmupExercise {
    pub exercise_id: String,
    pub class: RestClass,
    /// Engine muscle ids the exercise targets.
    pub muscles: Vec<String>,
    /// The top working weight of the day, none for bodyweight work (which gets no ramp).
    pub weight: Option<f64>,
    /// The reps of that set, for the intensity guess when there is no 1RM.
    pub reps: f64,
    /// The 1RM in the lifter's unit, when one is known.
    pub reference: Option<f64>,
    /// False for a dumbbell, cable or machine lift: no empty bar to start from.
    pub barbell: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmupInput {
    pub exercises: Vec<WarmupExercise>,
    pub unit: Unit,
    /// Soreness the check-in recorded, by engine muscle id, 1 to 4.
    #[serde(default)]
    pub soreness: BTreeMap<String, u8>,
    /// The check-in's recovery score, 0 to 10.
    pub recovery: Option<f64>,
    pub equipment: Equipment,
    pub prefer_percussion: bool,
    /// The time for the first three blocks, in minutes.
    pub budget_min: i32,
    pub plates: Vec<PlateEntry>,
    pub bar_weight: f64,
    pub soft_tissue: bool,
    /// Off, only the ramp sets are built.
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockKind {
    General,
    SoftTissue,
    Mobility,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    OffInSettings,
    CutForTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CardioWhy {
    /// The top set is at or over 85% of the 1RM, so 10 minutes: `top_pct` says how heavy.
    Heavy,
    Normal,
    /// Cut to 3 minutes to fit the time.
    Short,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tool {
    FoamRoller,
    Percussion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TissueWhy {
    Sore,
    Preference,
    FirstLifts,
    Warms,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Item {
    #[serde(rename_all = "camelCase")]
    Cardio { machine: Option<String>, minutes: i32, why: CardioWhy, top_pct: Option<i32> },
    #[serde(rename_all = "camelCase")]
    Tissue { muscle: String, tool: Tool, seconds: i32, why: TissueWhy, soreness: u8 },
    /// One drill of ten reps; `row` is the muscle group's row, so the screen can group them.
    #[serde(rename_all = "camelCase")]
    Mobility { row: usize, index: usize, name: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub kind: BlockKind,
    pub items: Vec<Item>,
    pub minutes: i32,
    pub skip_reason: Option<SkipReason>,
}

/// One step of a ramp: `bar` means the empty bar, at `load`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RampStep {
    pub load: f64,
    pub reps: i32,
    pub rest_sec: i32,
    pub bar: bool,
    pub extra: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ramp {
    pub exercise_id: String,
    pub work_weight: Option<f64>,
    pub steps: Vec<RampStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmupPlan {
    pub blocks: Vec<Block>,
    pub ramps: Vec<Ramp>,
    /// The warm-up's length without the ramp sets, which count as lifting time.
    pub minutes: i32,
    /// Whether the first main lift's top set is at or over 85% of its 1RM, which lengthens the cardio.
    pub heavy: bool,
}

// ---- ramp sets ----

struct Tier {
    min: f64,
    steps: &'static [(f64, i32, i32)], // percent of the working weight, reps, rest in seconds
}

const T0: Tier = Tier { min: 0.0, steps: &[(50.0, 10, 45)] };
const T1: Tier = Tier { min: 0.6, steps: &[(50.0, 8, 45), (80.0, 4, 90)] };
const T2: Tier = Tier { min: 0.75, steps: &[(45.0, 6, 45), (65.0, 4, 60), (85.0, 2, 90)] };
const T3: Tier = Tier { min: 0.85, steps: &[(40.0, 5, 45), (60.0, 3, 60), (75.0, 2, 90), (88.0, 1, 120)] };
const T4: Tier = Tier { min: 0.92, steps: &[(40.0, 5, 45), (55.0, 3, 60), (70.0, 2, 90), (82.0, 1, 120), (91.0, 1, 120)] };

fn tier_for(intensity: f64, isolation: bool) -> &'static Tier {
    if isolation || intensity < T1.min {
        &T0
    } else if intensity < T2.min {
        &T1
    } else if intensity < T3.min {
        &T2
    } else if intensity < T4.min {
        &T3
    } else {
        &T4
    }
}

/// How hard the top set is: its share of the 1RM, or from the reps when there is none (inverse Epley, no reps in reserve).
pub fn intensity_of(weight: f64, reference: Option<f64>, reps: f64) -> f64 {
    match reference {
        Some(r) if r > 0.0 => weight / r,
        _ => 1.0 / (1.0 + reps / 30.0),
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RampInput {
    pub weight: f64,
    pub intensity: f64,
    pub isolation: bool,
    /// The first exercise of the day for one of its muscles: an otherwise bare T0 gets one easy set.
    pub first_for_muscle: bool,
    /// A second lift whose muscles were already trained today: one set at 80%.
    pub already_trained_secondary: bool,
    /// Soreness 4 on the lift's muscles, or a low recovery score: one more step between the first two.
    pub extra_step: bool,
}

/// Ramp sets for one exercise: the tier from the intensity of the top set, each step a percent of the working weight rounded
/// to a loadable weight. A step under the empty bar becomes one "bar x 8", and a step equal to the one before it or to the
/// working weight is dropped.
pub fn ramp_sets(input: &RampInput, unit: Unit, bar: f64, plates: &[PlateEntry]) -> Vec<RampStep> {
    let work = round_loadable(input.weight, unit, bar, plates);
    let step = |load: f64, reps: i32, rest_sec: i32, is_bar: bool, extra: bool| RampStep { load, reps, rest_sec, bar: is_bar, extra };
    let single = |pct: f64, reps: i32, rest: i32| {
        let raw = input.weight * pct;
        if raw < bar {
            step(bar, reps, rest, true, false)
        } else {
            step(round_loadable(raw, unit, bar, plates), reps, rest, false, false)
        }
    };
    if input.already_trained_secondary {
        return vec![single(0.8, 4, 90)];
    }
    let tier = tier_for(input.intensity, input.isolation);
    if std::ptr::eq(tier, &T0) {
        return if input.first_for_muscle { vec![single(0.5, 10, 45)] } else { vec![] };
    }
    let mut steps: Vec<RampStep> = Vec::new();
    for &(pct, reps, rest) in tier.steps {
        let raw = input.weight * pct / 100.0;
        if raw < bar {
            if !steps.iter().any(|s| s.bar) {
                steps.push(step(bar, 8, 45, true, false));
            }
            continue;
        }
        let load = round_loadable(raw, unit, bar, plates);
        if steps.last().is_some_and(|s| s.load == load) {
            continue;
        }
        if load >= work {
            continue;
        }
        steps.push(step(load, reps, rest, false, false));
    }
    if input.extra_step && steps.len() >= 2 {
        let mid = round_loadable((steps[0].load + steps[1].load) / 2.0, unit, bar, plates);
        if mid != steps[0].load && mid != steps[1].load && mid < work {
            steps.insert(1, step(mid, 5, 60, false, true));
        }
    }
    steps
}

// ---- the plan ----

/// Muscles a foam roller is a poor tool for (a percussion gun takes them when one is owned).
const ROLLER_BAD: [&str; 5] = ["chest", "frontdelts", "uppertraps", "forearms", "pecs"];

/// Mobility drills by muscle group: the muscle ids a row matches (substring), and its drills.
const MOBILITY: [(&[&str], &[&str]); 7] = [
    (&["quads", "glutes"], &["Bodyweight squats", "Walking lunges", "Front-to-back leg swings"]),
    (&["hamstrings", "lowerback"], &["Bodyweight good mornings", "Glute bridges", "Straight-leg kicks"]),
    (&["calves", "ankles"], &["Knee-to-wall ankle rocks", "Calf raises", "Low pogo hops"]),
    (&["chest", "frontdelts", "triceps"], &["Incline push-ups", "Scapular push-ups", "Band pass-throughs"]),
    (&["lats", "upperback", "biceps", "reardelts"], &["Band pull-aparts", "Scapular pulls", "Thoracic open-books"]),
    (&["sidedelts", "shoulders", "overhead"], &["Wall slides", "Band pass-throughs", "Prone Y-T-W"]),
    (&["abs", "trunk", "core"], &["Dead bugs", "Bird dogs"]),
];

/// Two drills for each of up to three muscle groups the day trains; a squat and a lunge when none matches.
fn mobility_rows(muscles: &[String]) -> Vec<Vec<&'static str>> {
    let mut picked: Vec<usize> = Vec::new();
    for m in muscles {
        if picked.len() >= 3 {
            break;
        }
        if let Some(i) = MOBILITY.iter().position(|(matches, _)| matches.iter().any(|k| m.contains(k))) {
            if !picked.contains(&i) {
                picked.push(i);
            }
        }
    }
    if picked.is_empty() {
        return vec![vec!["Bodyweight squats", "Walking lunges"]];
    }
    picked.iter().map(|&i| MOBILITY[i].1.iter().take(2).copied().collect()).collect()
}

fn distinct(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for i in items {
        if !out.contains(&i) {
            out.push(i);
        }
    }
    out
}

/// The whole warm-up for a day. The cardio is 5 minutes, or 10 when the first main lift's top set is heavy (at or over 85% of
/// the 1RM). Soft tissue needs the setting on, a tool owned and time to spare. Over the time budget the soft tissue goes first,
/// then the mobility drops to one drill, then the cardio to 3 minutes. The ramp sets are never cut, and are all there is when
/// the warm-up is off in Settings.
pub fn plan_warmup(input: &WarmupInput) -> WarmupPlan {
    let unit = input.unit;
    let exercises = &input.exercises;
    let lead = exercises.iter().find(|e| e.class == RestClass::Main).or_else(|| exercises.first());
    let top_pct = lead.and_then(|l| match (l.weight, l.reference) {
        (Some(w), Some(r)) if r > 0.0 => Some(w / r),
        _ => None,
    });
    let heavy = top_pct.is_some_and(|p| p >= 0.85);
    let budget = input.budget_min;
    let mut blocks: Vec<Block> = Vec::new();

    if input.enabled {
        // 1. General.
        let minutes = if heavy { 10 } else { 5 };
        let machine = input.equipment.cardio.clone();
        blocks.push(Block {
            kind: BlockKind::General,
            items: vec![Item::Cardio {
                machine: machine.clone(),
                minutes,
                why: if heavy { CardioWhy::Heavy } else { CardioWhy::Normal },
                top_pct: top_pct.filter(|_| heavy).map(|p| js_round(p * 100.0) as i32),
            }],
            minutes,
            skip_reason: None,
        });

        // 2. Soft tissue, when a tool is owned and there is time.
        let have_tool = input.equipment.foam_roller || input.equipment.percussion;
        let trained_today = distinct(exercises.iter().flat_map(|e| e.muscles.iter().cloned()));
        let first_two = distinct(exercises.iter().take(2).flat_map(|e| e.muscles.iter().cloned()));
        let sore: Vec<String> = trained_today.iter().filter(|m| input.soreness.get(*m).copied().unwrap_or(0) >= 3).cloned().collect();
        let targets: Vec<String> = distinct(first_two.iter().cloned().chain(sore)).into_iter().take(4).collect();
        if input.soft_tissue && have_tool && budget >= 8 && !targets.is_empty() {
            let mut items = Vec::new();
            let mut total = 0;
            for m in &targets {
                let soreness = input.soreness.get(m).copied().unwrap_or(0);
                let is_sore = soreness >= 3;
                let prime_heavy = heavy && first_two.contains(m);
                let roller_bad = ROLLER_BAD.contains(&m.as_str());
                let eq = &input.equipment;
                let tool = if is_sore {
                    Tool::FoamRoller // never percussion on a sore muscle
                } else if prime_heavy && !roller_bad {
                    Tool::FoamRoller
                } else if roller_bad && eq.percussion {
                    Tool::Percussion
                } else if input.prefer_percussion && eq.percussion && !prime_heavy {
                    Tool::Percussion
                } else if eq.foam_roller {
                    Tool::FoamRoller
                } else {
                    Tool::Percussion
                };
                let seconds = if tool == Tool::Percussion { 60 } else if is_sore { 120 } else { 90 };
                let why = if is_sore {
                    TissueWhy::Sore
                } else if tool == Tool::Percussion && input.prefer_percussion {
                    TissueWhy::Preference
                } else if first_two.contains(m) {
                    TissueWhy::FirstLifts
                } else {
                    TissueWhy::Warms
                };
                total += seconds;
                items.push(Item::Tissue { muscle: m.clone(), tool, seconds, why, soreness });
            }
            blocks.push(Block { kind: BlockKind::SoftTissue, items, minutes: (total as f64 / 60.0).ceil() as i32, skip_reason: None });
        }

        // 3. Dynamic mobility: two drills of ten for up to three muscle groups.
        let drills = mobility_rows(&trained_today);
        let items: Vec<Item> = drills
            .iter()
            .enumerate()
            .flat_map(|(r, row)| row.iter().enumerate().map(move |(d, name)| Item::Mobility { row: r, index: d, name: (*name).to_string() }))
            .collect();
        blocks.push(Block { kind: BlockKind::Mobility, items, minutes: drills.len() as i32, skip_reason: None });

        // Over budget: soft tissue first, then mobility to one drill, then the cardio to three minutes.
        let mut used: i32 = blocks.iter().map(|b| b.minutes).sum();
        if used > budget {
            if let Some(i) = blocks.iter().position(|b| b.kind == BlockKind::SoftTissue) {
                used -= blocks[i].minutes;
                blocks[i] = Block { kind: BlockKind::SoftTissue, items: vec![], minutes: 0, skip_reason: Some(SkipReason::CutForTime) };
            }
        }
        if used > budget {
            if let Some(i) = blocks.iter().position(|b| b.kind == BlockKind::Mobility) {
                blocks[i].items.truncate(1);
                blocks[i].minutes = 1;
            }
            used = blocks.iter().map(|b| b.minutes).sum();
        }
        if used > budget {
            if let Some(i) = blocks.iter().position(|b| b.kind == BlockKind::General) {
                blocks[i] = Block {
                    kind: BlockKind::General,
                    items: vec![Item::Cardio { machine, minutes: 3, why: CardioWhy::Short, top_pct: None }],
                    minutes: 3,
                    skip_reason: None,
                };
            }
        }
    } else {
        // Off in Settings: no cardio, soft tissue or mobility. The ramp sets below are lifting time and stay.
        for kind in [BlockKind::General, BlockKind::SoftTissue, BlockKind::Mobility] {
            blocks.push(Block { kind, items: vec![], minutes: 0, skip_reason: Some(SkipReason::OffInSettings) });
        }
    }

    // 4. Ramp sets, per exercise.
    let mut trained: Vec<&String> = Vec::new();
    let mut ramps = Vec::new();
    for (idx, e) in exercises.iter().enumerate() {
        let steps = match e.weight {
            None => vec![],
            Some(weight) => {
                let intensity = intensity_of(weight, e.reference, e.reps);
                let already = idx > 0 && e.class == RestClass::Secondary && !e.muscles.is_empty() && e.muscles.iter().all(|m| trained.contains(&m));
                let extra = e.muscles.iter().any(|m| input.soreness.get(m) == Some(&4)) || input.recovery.is_some_and(|r| r <= 4.0);
                let first = e.muscles.iter().any(|m| !trained.contains(&m));
                let ramp = RampInput { weight, intensity, isolation: e.class == RestClass::Isolation, first_for_muscle: first, already_trained_secondary: already, extra_step: extra };
                ramp_sets(&ramp, unit, if e.barbell { input.bar_weight } else { 0.0 }, &input.plates)
            }
        };
        trained.extend(e.muscles.iter());
        ramps.push(Ramp { exercise_id: e.exercise_id.clone(), work_weight: e.weight, steps });
    }
    let minutes = blocks.iter().map(|b| b.minutes).sum();
    WarmupPlan { blocks, ramps, minutes, heavy }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plates::{Pairs, PlateEntry};

    fn plates() -> Vec<PlateEntry> {
        let p = |weight: f64| PlateEntry { weight, pairs: Pairs::Enough, color: String::new() };
        vec![p(45.0), p(35.0), p(25.0), p(10.0), p(5.0), p(2.5)]
    }

    fn ramp(weight: f64, intensity: f64) -> Vec<RampStep> {
        let input = RampInput { weight, intensity, isolation: false, first_for_muscle: true, already_trained_secondary: false, extra_step: false };
        ramp_sets(&input, Unit::Lb, 45.0, &plates())
    }

    fn loads(steps: &[RampStep]) -> Vec<f64> {
        steps.iter().map(|s| s.load).collect()
    }

    fn exercise(id: &str, class: RestClass, muscles: &[&str], weight: f64, reference: Option<f64>) -> WarmupExercise {
        WarmupExercise { exercise_id: id.into(), class, muscles: muscles.iter().map(|m| m.to_string()).collect(), weight: Some(weight), reps: 5.0, reference, barbell: true }
    }

    fn input(exercises: Vec<WarmupExercise>) -> WarmupInput {
        WarmupInput {
            exercises,
            unit: Unit::Lb,
            soreness: BTreeMap::new(),
            recovery: None,
            equipment: Equipment { foam_roller: true, percussion: true, cardio: Some("bike".into()) },
            prefer_percussion: true,
            budget_min: 15,
            plates: plates(),
            bar_weight: 45.0,
            soft_tissue: true,
            enabled: true,
        }
    }

    #[test]
    fn rounding_is_the_plate_math_in_pounds_on_a_bar_and_a_step_elsewhere() {
        assert_eq!(round_loadable(67.5, Unit::Lb, 45.0, &plates()), 65.0);
        assert_eq!(round_loadable(20.0, Unit::Lb, 45.0, &plates()), 45.0);     // never under the bar
        assert_eq!(round_loadable(32.4, Unit::Lb, 0.0, &plates()), 30.0);       // a cable stack: nearest 5
        assert_eq!(round_loadable(32.5, Unit::Lb, 0.0, &plates()), 35.0);       // halves up
        assert_eq!(round_loadable(61.0, Unit::Kg, 20.0, &plates()), 60.0);
        assert_eq!(round_loadable(5.0, Unit::Kg, 20.0, &plates()), 20.0);
    }

    #[test]
    fn the_tier_follows_the_intensity_and_each_step_is_a_loadable_weight() {
        assert_eq!(loads(&ramp(200.0, 0.5)), vec![100.0]);                      // T0: one easy set
        assert_eq!(loads(&ramp(200.0, 0.65)), vec![100.0, 160.0]);              // T1
        assert_eq!(loads(&ramp(225.0, 0.8)), vec![100.0, 145.0, 190.0]);        // T2
        let t3 = ramp(315.0, 0.88);
        assert_eq!(t3.len(), 4);
        assert_eq!(t3.last().unwrap().reps, 1);
        assert_eq!(ramp(400.0, 0.95).len(), 5);                                 // T4
    }

    #[test]
    fn a_step_under_the_bar_is_one_bar_set_and_duplicates_and_the_working_weight_are_dropped() {
        let light = ramp(65.0, 0.8);
        assert!(light[0].bar && light[0].load == 45.0 && light[0].reps == 8);
        assert_eq!(light.iter().filter(|s| s.bar).count(), 1);
        assert!(light.iter().all(|s| s.load < 65.0));
    }

    #[test]
    fn isolation_and_a_second_lift_get_one_set_and_soreness_adds_a_step() {
        let iso = RampInput { weight: 100.0, intensity: 0.9, isolation: true, first_for_muscle: false, already_trained_secondary: false, extra_step: false };
        assert!(ramp_sets(&iso, Unit::Lb, 45.0, &plates()).is_empty());
        let repeat = RampInput { weight: 150.0, intensity: 0.7, isolation: false, first_for_muscle: false, already_trained_secondary: true, extra_step: false };
        let r = ramp_sets(&repeat, Unit::Lb, 45.0, &plates());
        assert_eq!((r.len(), r[0].reps), (1, 4));
        let base = RampInput { weight: 315.0, intensity: 0.88, isolation: false, first_for_muscle: true, already_trained_secondary: false, extra_step: false };
        let plain = ramp_sets(&base, Unit::Lb, 45.0, &plates());
        let sore = ramp_sets(&RampInput { extra_step: true, ..base }, Unit::Lb, 45.0, &plates());
        assert_eq!(sore.len(), plain.len() + 1);
        assert!(sore[1].extra);
    }

    #[test]
    fn intensity_is_the_share_of_the_max_or_inverse_epley_without_one() {
        assert_eq!(intensity_of(225.0, Some(300.0), 5.0), 0.75);
        assert!((intensity_of(100.0, None, 5.0) - 1.0 / (1.0 + 5.0 / 30.0)).abs() < 1e-12);
        assert!((intensity_of(100.0, Some(0.0), 30.0) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn a_normal_day_has_cardio_soft_tissue_and_mobility_inside_the_time() {
        let day = input(vec![exercise("squat", RestClass::Main, &["quads", "glutes"], 225.0, Some(300.0)), exercise("bench", RestClass::Secondary, &["chest", "triceps"], 155.0, Some(200.0))]);
        let plan = plan_warmup(&day);
        assert!(!plan.heavy);
        assert_eq!(plan.blocks.iter().map(|b| b.kind).collect::<Vec<_>>(), vec![BlockKind::General, BlockKind::SoftTissue, BlockKind::Mobility]);
        assert_eq!(plan.blocks[0].minutes, 5);
        assert!(plan.minutes <= 15);
        // Chest is a poor roller muscle: the percussion gun takes it. Quads go to the preferred gun too.
        let tools: Vec<(String, Tool)> = plan.blocks[1].items.iter().filter_map(|i| match i { Item::Tissue { muscle, tool, .. } => Some((muscle.clone(), *tool)), _ => None }).collect();
        assert!(tools.contains(&("chest".to_string(), Tool::Percussion)));
        assert_eq!(plan.ramps.len(), 2);
    }

    #[test]
    fn a_heavy_top_set_lengthens_the_cardio_and_rolls_instead_of_hitting_the_primed_muscle() {
        let day = input(vec![exercise("squat", RestClass::Main, &["quads"], 285.0, Some(300.0))]);
        let plan = plan_warmup(&day);
        assert!(plan.heavy);
        match &plan.blocks[0].items[0] {
            Item::Cardio { minutes, why, top_pct, .. } => assert_eq!((*minutes, *why, *top_pct), (10, CardioWhy::Heavy, Some(95))),
            other => panic!("{other:?}"),
        }
        assert!(matches!(&plan.blocks[1].items[0], Item::Tissue { tool: Tool::FoamRoller, why: TissueWhy::FirstLifts, .. }));
    }

    #[test]
    fn a_sore_muscle_is_rolled_for_two_minutes_and_never_hit() {
        let mut day = input(vec![exercise("squat", RestClass::Main, &["quads"], 225.0, Some(300.0)), exercise("row", RestClass::Secondary, &["lats"], 135.0, Some(200.0)), exercise("curl", RestClass::Isolation, &["biceps"], 35.0, None)]);
        day.soreness.insert("biceps".into(), 3);
        let plan = plan_warmup(&day);
        let biceps = plan.blocks[1].items.iter().find_map(|i| match i { Item::Tissue { muscle, tool, seconds, why, .. } if muscle == "biceps" => Some((*tool, *seconds, *why)), _ => None });
        assert_eq!(biceps, Some((Tool::FoamRoller, 120, TissueWhy::Sore)));
    }

    #[test]
    fn over_the_time_the_soft_tissue_goes_then_a_mobility_drill_then_the_cardio() {
        let heavy = vec![exercise("squat", RestClass::Main, &["quads", "glutes"], 285.0, Some(300.0)), exercise("rdl", RestClass::Secondary, &["hamstrings"], 225.0, Some(300.0))];
        let tight = WarmupInput { budget_min: 8, ..input(heavy.clone()) };
        let p = plan_warmup(&tight);
        assert_eq!(p.blocks[1].skip_reason, Some(SkipReason::CutForTime));
        assert!(p.blocks[1].items.is_empty());
        let tighter = WarmupInput { budget_min: 3, ..input(heavy) };
        let p = plan_warmup(&tighter);
        assert_eq!(p.blocks[0].minutes, 3);
        assert!(matches!(&p.blocks[0].items[0], Item::Cardio { why: CardioWhy::Short, .. }));
        let mobility = p.blocks.iter().find(|b| b.kind == BlockKind::Mobility).unwrap();
        assert_eq!(mobility.items.len(), 1);
        assert_eq!(p.minutes, p.blocks.iter().map(|b| b.minutes).sum::<i32>());
    }

    #[test]
    fn off_in_settings_only_the_ramp_stays_and_no_tool_means_no_soft_tissue() {
        let day = input(vec![exercise("squat", RestClass::Main, &["quads"], 225.0, Some(300.0))]);
        let off = plan_warmup(&WarmupInput { enabled: false, ..day.clone() });
        assert!(off.blocks.iter().all(|b| b.skip_reason == Some(SkipReason::OffInSettings) && b.minutes == 0));
        assert_eq!(off.minutes, 0);
        assert!(!off.ramps[0].steps.is_empty());
        let bare = Equipment { foam_roller: false, percussion: false, cardio: None };
        let none = plan_warmup(&WarmupInput { equipment: bare, ..day });
        assert!(none.blocks.iter().all(|b| b.kind != BlockKind::SoftTissue));
        assert!(matches!(&none.blocks[0].items[0], Item::Cardio { machine: None, .. }));
    }

    #[test]
    fn a_second_lift_on_trained_muscles_and_a_dumbbell_lift_ramp_differently() {
        let day = input(vec![exercise("bench", RestClass::Main, &["chest"], 185.0, Some(250.0)), WarmupExercise { barbell: true, ..exercise("incline", RestClass::Secondary, &["chest"], 135.0, Some(200.0)) }, WarmupExercise { barbell: false, ..exercise("fly", RestClass::Main, &["sidedelts"], 20.0, Some(30.0)) }]);
        let plan = plan_warmup(&day);
        assert_eq!(plan.ramps[1].steps.len(), 1);                               // already trained: one set at 80%
        assert!(plan.ramps[2].steps.iter().all(|s| !s.bar));                    // no bar to start from
    }

    #[test]
    fn mobility_picks_up_to_three_groups_two_drills_each_with_a_fallback() {
        let rows = mobility_rows(&["quads".to_string(), "hamstrings".to_string(), "chest".to_string(), "lats".to_string()]);
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|r| r.len() == 2));
        assert_eq!(mobility_rows(&["nothing".to_string()]), vec![vec!["Bodyweight squats", "Walking lunges"]]);
    }
}
