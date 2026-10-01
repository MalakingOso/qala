//! Port of the pure parts of `models/muscle.ts`: the screen-muscle tables, muscle group
//! resolution against user settings, and the points arithmetic helpers.
//!
//! Not ported: `Muscle_getPointsFor*` and `Muscle_getUnifiedPointsFor*` (they need an evaluated
//! program and history entries, which belong to the evaluator wave) and the muscle group
//! mutators (`create/update/delete/restore`), which are redux-style state edits.

use indexmap::IndexMap;
use crate::util::string::capitalize;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// One entry of `settings.muscleGroups.data`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuscleGroupData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muscles: Option<Vec<String>>,
}

/// Shape of `settings.muscleGroups` (`IMuscleGroupsSettings`). The foundation `types.rs` may
/// replace this with its own type; the functions below only need `data`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MuscleGroupsSettings {
    #[serde(default)]
    pub data: IndexMap<String, MuscleGroupData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MuscleTables {
    screen_muscles: Vec<String>,
    available_muscles: Vec<String>,
    screen_muscle_to_muscles: IndexMap<String, Vec<String>>,
    muscle_to_screen_muscles: IndexMap<String, Vec<String>>,
}

static TABLES: OnceLock<MuscleTables> = OnceLock::new();

fn tables() -> &'static MuscleTables {
    TABLES.get_or_init(|| {
        serde_json::from_str(include_str!("../data/muscles.json")).unwrap_or(MuscleTables {
            screen_muscles: Vec::new(),
            available_muscles: Vec::new(),
            screen_muscle_to_muscles: IndexMap::new(),
            muscle_to_screen_muscles: IndexMap::new(),
        })
    })
}

/// The built-in screen muscles (`screenMuscles` in types.ts), in declaration order.
pub fn screen_muscles() -> &'static [String] {
    &tables().screen_muscles
}

/// Every `IMuscle` (`availableMuscles` in types.ts), in declaration order.
pub fn available_muscles() -> &'static [String] {
    &tables().available_muscles
}

/// Default muscles of a built-in screen muscle (`screenMuscleToMuscleMapping`).
pub fn default_muscles_of_screen_muscle(screen_muscle: &str) -> Option<&'static [String]> {
    tables().screen_muscle_to_muscles.get(screen_muscle).map(|v| v.as_slice())
}

/// Reverse of the default table (`muscleToScreenMuscleMapping`), in screen-muscle order.
pub fn default_screen_muscles_of_muscle(muscle: &str) -> &'static [String] {
    tables().muscle_to_screen_muscles.get(muscle).map(|v| v.as_slice()).unwrap_or(&[])
}

/// `Muscle_getBuiltinMuscleGroups`.
pub fn muscle_get_builtin_muscle_groups() -> Vec<String> {
    screen_muscles().to_vec()
}

/// `Muscle_isBuiltInMuscleGroup`.
pub fn muscle_is_built_in_muscle_group(muscle_group: &str) -> bool {
    screen_muscles().iter().any(|s| s == muscle_group)
}

/// `Muscle_getAvailableMuscleGroups`: visible built-ins first, then custom groups.
pub fn muscle_get_available_muscle_groups(groups: &MuscleGroupsSettings) -> Vec<String> {
    let mut out: Vec<String> = screen_muscles()
        .iter()
        .filter(|sm| !groups.data.get(sm.as_str()).and_then(|d| d.is_hidden).unwrap_or(false))
        .cloned()
        .collect();
    out.extend(groups.data.keys().filter(|k| !muscle_is_built_in_muscle_group(k)).cloned());
    out
}

/// `Muscle_getHiddenMuscleGroups`.
pub fn muscle_get_hidden_muscle_groups(groups: &MuscleGroupsSettings) -> Vec<String> {
    screen_muscles()
        .iter()
        .filter(|sm| groups.data.get(sm.as_str()).and_then(|d| d.is_hidden).unwrap_or(false))
        .cloned()
        .collect()
}

fn muscles_of_group(groups: &MuscleGroupsSettings, group: &str) -> Vec<String> {
    if let Some(m) = groups.data.get(group).and_then(|d| d.muscles.as_ref()) {
        return m.clone();
    }
    default_muscles_of_screen_muscle(group).map(|s| s.to_vec()).unwrap_or_default()
}

/// `Muscle_getScreenMusclesFromMuscle`: the available groups that contain `muscle`.
pub fn muscle_get_screen_muscles_from_muscle(muscle: &str, groups: &MuscleGroupsSettings) -> Vec<String> {
    muscle_get_available_muscle_groups(groups)
        .into_iter()
        .filter(|mg| muscles_of_group(groups, mg).iter().any(|m| m == muscle))
        .collect()
}

/// `Muscle_getMusclesFromScreenMuscle`: empty when the group is not available (hidden or unknown).
pub fn muscle_get_muscles_from_screen_muscle(muscle_group: &str, groups: &MuscleGroupsSettings) -> Vec<String> {
    if !muscle_get_available_muscle_groups(groups).iter().any(|g| g == muscle_group) {
        return Vec::new();
    }
    muscles_of_group(groups, muscle_group)
}

/// `Muscle_getMuscleGroupName`.
pub fn muscle_get_muscle_group_name(muscle_group: &str, groups: &MuscleGroupsSettings) -> String {
    match groups.data.get(muscle_group).and_then(|d| d.name.as_ref()) {
        Some(n) => n.clone(),
        None => capitalize(muscle_group),
    }
}

/// `Muscle_isDefaultMuscles`: set equality against the built-in table.
pub fn muscle_is_default_muscles(muscle_group: &str, muscles: &[String]) -> bool {
    let default = default_muscles_of_screen_muscle(muscle_group).unwrap_or(&[]);
    let a: std::collections::BTreeSet<&str> = default.iter().map(|s| s.as_str()).collect();
    let b: std::collections::BTreeSet<&str> = muscles.iter().map(|s| s.as_str()).collect();
    a == b
}

/// `Muscle_imageUrl`. `StringUtils_dashcase` drops `:` and `,`, turns whitespace runs into `-`
/// and lowercases.
pub fn muscle_image_url(muscle: &str) -> String {
    format!("/externalimages/muscles/muscle-{}.jpeg", dashcase(muscle))
}

pub(crate) fn dashcase(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if c == ':' || c == ',' {
            continue;
        }
        if is_js_whitespace(c) {
            in_ws = true;
            continue;
        }
        if in_ws {
            out.push('-');
            in_ws = false;
        }
        out.push(c);
    }
    if in_ws {
        out.push('-');
    }
    out.to_lowercase()
}

/// JS `\s` (also what `String.prototype.trim` strips).
pub(crate) fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | '\u{20}' | '\u{a0}' | '\u{1680}' | '\u{2028}' | '\u{2029}'
            | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    ) || ('\u{2000}'..='\u{200a}').contains(&c)
}

// ---------------------------------------------------------------------------------------
// Points arithmetic. Keys are screen muscle names, in insertion order like JS objects.
// ---------------------------------------------------------------------------------------

pub type ScreenMusclePointsColl = IndexMap<String, f64>;
pub type ExercisePointsColl = IndexMap<String, ScreenMusclePointsColl>;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScreenMusclePoints {
    pub strength: ScreenMusclePointsColl,
    pub hypertrophy: ScreenMusclePointsColl,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExercisePoints {
    pub strength: ExercisePointsColl,
    pub hypertrophy: ExercisePointsColl,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct UnifiedPoints {
    pub screen_muscle_points: ScreenMusclePointsColl,
    pub exercise_points: ExercisePointsColl,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Points {
    pub screen_muscle_points: ScreenMusclePoints,
    pub exercise_points: ExercisePoints,
}

/// `Muscle_getEmptyScreenMusclesPoints`: every built-in screen muscle at zero.
pub fn muscle_get_empty_screen_muscles_points() -> ScreenMusclePointsColl {
    screen_muscles().iter().map(|s| (s.clone(), 0.0)).collect()
}

/// `ObjectUtils_findMaxValue`: starts at 0, so negatives and empty maps give 0.
fn find_max_value(obj: &ScreenMusclePointsColl) -> f64 {
    obj.values().fold(0.0, |memo, &v| if v > memo { v } else { memo })
}

fn normalize(obj: &ScreenMusclePointsColl, max_value: f64) -> ScreenMusclePointsColl {
    obj.iter().map(|(k, v)| (k.clone(), *v / max_value)).collect()
}

fn normalize_exercise_points(obj: &ExercisePointsColl, max_value: f64) -> ExercisePointsColl {
    obj.iter().map(|(k, v)| (k.clone(), normalize(v, max_value))).collect()
}

/// `Muscle_normalizePoints`.
pub fn muscle_normalize_points(points: &Points) -> Points {
    let max_strength = find_max_value(&points.screen_muscle_points.strength);
    let max_hypertrophy = find_max_value(&points.screen_muscle_points.hypertrophy);
    Points {
        screen_muscle_points: ScreenMusclePoints {
            strength: normalize(&points.screen_muscle_points.strength, max_strength),
            hypertrophy: normalize(&points.screen_muscle_points.hypertrophy, max_hypertrophy),
        },
        exercise_points: ExercisePoints {
            strength: normalize_exercise_points(&points.exercise_points.strength, max_strength),
            hypertrophy: normalize_exercise_points(&points.exercise_points.hypertrophy, max_hypertrophy),
        },
    }
}

/// `Muscle_normalizeUnifiedPoints`.
pub fn muscle_normalize_unified_points(points: &UnifiedPoints) -> UnifiedPoints {
    let max = find_max_value(&points.screen_muscle_points);
    UnifiedPoints {
        screen_muscle_points: normalize(&points.screen_muscle_points, max),
        exercise_points: normalize_exercise_points(&points.exercise_points, max),
    }
}

/// `Muscle_combinePoints`: keeps only the strength screen-muscle totals.
pub fn muscle_combine_points(points: &Points) -> Points {
    let mut strength = ScreenMusclePointsColl::new();
    for (k, v) in &points.screen_muscle_points.strength {
        let e = strength.entry(k.clone()).or_insert(0.0);
        *e += *v;
    }
    Points {
        screen_muscle_points: ScreenMusclePoints { strength, hypertrophy: IndexMap::new() },
        exercise_points: ExercisePoints::default(),
    }
}

/// `Muscle_mergeScreenMusclePoints`: key union (a's keys first), values summed.
pub fn muscle_merge_screen_muscle_points(a: &ScreenMusclePointsColl, b: &ScreenMusclePointsColl) -> ScreenMusclePointsColl {
    let mut out = ScreenMusclePointsColl::new();
    for k in a.keys().chain(b.keys()) {
        if !out.contains_key(k) {
            let sum = a.get(k).copied().unwrap_or(0.0) + b.get(k).copied().unwrap_or(0.0);
            out.insert(k.clone(), sum);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn groups(json: &str) -> MuscleGroupsSettings {
        serde_json::from_str(json).expect("valid test json")
    }

    fn strs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tables_load() {
        assert_eq!(screen_muscles().len(), 11);
        assert_eq!(available_muscles().len(), 39);
        assert_eq!(muscle_get_builtin_muscle_groups()[0], "shoulders");
        assert_eq!(default_muscles_of_screen_muscle("triceps"), Some(&strs(&["Triceps Brachii"])[..]));
        assert!(muscle_is_built_in_muscle_group("abs"));
        assert!(!muscle_is_built_in_muscle_group("neck"));
    }

    #[test]
    fn default_groups_for_muscle() {
        let g = MuscleGroupsSettings::default();
        // Matches the TS output (see data/muscles.json derivation): adductors span two groups.
        assert_eq!(muscle_get_screen_muscles_from_muscle("Adductor Brevis", &g), strs(&["hamstrings", "quadriceps"]));
        assert_eq!(muscle_get_screen_muscles_from_muscle("Teres Major", &g), strs(&["shoulders"]));
        assert_eq!(muscle_get_screen_muscles_from_muscle("Nope", &g), Vec::<String>::new());
        assert_eq!(default_screen_muscles_of_muscle("Adductor Brevis"), &strs(&["hamstrings", "quadriceps"])[..]);
    }

    #[test]
    fn custom_and_hidden_groups() {
        let g = groups(
            r#"{"data":{"shoulders":{"isHidden":true},"chest":{"name":"Pecs","muscles":["Triceps Brachii"]},
                "neck":{"name":"Neck","muscles":["Splenius"]},"empty":{}}}"#,
        );
        let avail = muscle_get_available_muscle_groups(&g);
        assert!(!avail.contains(&"shoulders".to_string()));
        assert_eq!(&avail[avail.len() - 2..], &strs(&["neck", "empty"])[..]);
        assert_eq!(muscle_get_hidden_muscle_groups(&g), strs(&["shoulders"]));
        assert_eq!(muscle_get_muscles_from_screen_muscle("shoulders", &g), Vec::<String>::new());
        assert_eq!(muscle_get_muscles_from_screen_muscle("chest", &g), strs(&["Triceps Brachii"]));
        assert_eq!(muscle_get_muscles_from_screen_muscle("empty", &g), Vec::<String>::new());
        assert_eq!(muscle_get_screen_muscles_from_muscle("Triceps Brachii", &g), strs(&["triceps", "chest"]));
        assert_eq!(muscle_get_screen_muscles_from_muscle("Splenius", &g), strs(&["back", "neck"]));
        assert_eq!(muscle_get_muscle_group_name("chest", &g), "Pecs");
        assert_eq!(muscle_get_muscle_group_name("back", &g), "Back");
        assert_eq!(muscle_get_muscle_group_name("", &g), "");
    }

    #[test]
    fn default_muscles_and_image_url() {
        assert!(muscle_is_default_muscles("biceps", &strs(&["Brachialis", "Biceps Brachii"])));
        assert!(!muscle_is_default_muscles("biceps", &strs(&["Brachialis"])));
        assert_eq!(
            muscle_image_url("Pectoralis Major Sternal Head"),
            "/externalimages/muscles/muscle-pectoralis-major-sternal-head.jpeg"
        );
    }

    #[test]
    fn points_math() {
        let mut a = ScreenMusclePointsColl::new();
        a.insert("chest".into(), 200.0);
        a.insert("back".into(), 100.0);
        let mut b = ScreenMusclePointsColl::new();
        b.insert("back".into(), 50.0);
        b.insert("abs".into(), 25.0);
        let m = muscle_merge_screen_muscle_points(&a, &b);
        assert_eq!(m.keys().collect::<Vec<_>>(), vec!["chest", "back", "abs"]);
        assert_eq!(m["back"], 150.0);
        let n = muscle_normalize_unified_points(&UnifiedPoints {
            screen_muscle_points: m,
            exercise_points: IndexMap::new(),
        });
        assert_eq!(n.screen_muscle_points["chest"], 1.0);
        assert_eq!(n.screen_muscle_points["back"], 0.75);
        assert_eq!(muscle_get_empty_screen_muscles_points().len(), 11);
        let p = muscle_combine_points(&Points {
            screen_muscle_points: ScreenMusclePoints { strength: a, hypertrophy: b },
            exercise_points: ExercisePoints::default(),
        });
        assert_eq!(p.screen_muscle_points.strength["chest"], 200.0);
        assert!(p.screen_muscle_points.hypertrophy.is_empty());
    }
}
