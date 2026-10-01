//! Port of `models/exercise.ts`: the built-in exercise seed DB and the `Exercise_*` helpers that
//! the evaluation path reaches (plus the small pure ones around them).
//!
//! The seed DB lives in `data/exercises.json` (written by `scripts/export_exercises.ts`) and is
//! parsed once into a `OnceLock`.
//!
//! Settings integration: the helpers only read a handful of `ISettings` fields. Until `types.rs`
//! has the real settings type they take `&dyn ExerciseSettings`, which the settings type should
//! implement. The data types defined here (`ExerciseType`, `CustomExercise`, `ExerciseData`,
//! `Weight`, `Unit`) are plain serde shapes of the TS interfaces, so `types.rs` can re-export them
//! or convert to them.
//!
//! Not ported: `Exercise_getWarmupSets` and its helpers (need `ISet`/uid generation, so they sit
//! with the program evaluator; the threshold tables are exposed as `warmup_values`),
//! `Exercise_allExpanded`/`searchNames`/filter/sort/similar* (UI picker code; `allExpanded`
//! depends on the image manifest), and the custom exercise mutators (redux state edits).
//!
//! Known JS divergences: object key order for integer-like custom exercise ids (JS sorts them
//! first, `IndexMap` keeps insertion order), and `toLowerCase` special cases beyond what Rust's
//! `to_lowercase` does for the same code points.

use crate::muscle::{self, is_js_whitespace, MuscleGroupsSettings};
use crate::util::string::camel_case;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    Kg,
    Lb,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Weight {
    pub value: f64,
    pub unit: Unit,
}

/// `IExerciseType`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExerciseType {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equipment: Option<String>,
}

impl ExerciseType {
    pub fn new(id: &str, equipment: Option<&str>) -> Self {
        ExerciseType { id: id.to_string(), equipment: equipment.map(|e| e.to_string()) }
    }
}

/// `IMetaExercises`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaExercises {
    #[serde(default)]
    pub body_parts: Vec<String>,
    #[serde(default)]
    pub target_muscles: Vec<String>,
    #[serde(default)]
    pub synergist_muscles: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sorted_equipment: Option<Vec<String>>,
}

/// `IExercise`. Built-in and custom exercises both resolve to this.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exercise {
    pub id: String,
    pub name: String,
    pub default_warmup: Option<u32>,
    pub equipment: Option<String>,
    pub default_equipment: Option<String>,
    pub types: Vec<String>,
    pub onerm: Option<f64>,
    pub starting_weight_lb: f64,
    pub starting_weight_kg: f64,
}

/// `ICustomExercise` (the fields the evaluation path reads).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomExercise {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default)]
    pub meta: MetaExercises,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_equipment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<Vec<String>>,
}

/// `IAllCustomExercises`. Insertion order is the JS key order.
pub type CustomExercises = IndexMap<String, CustomExercise>;

/// `IExerciseDataValue`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseData {
    #[serde(default)]
    pub rm1: Option<Weight>,
    #[serde(default)]
    pub rounding: Option<f64>,
    #[serde(default)]
    pub equipment: Option<IndexMap<String, Option<String>>>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub muscle_multipliers: Option<IndexMap<String, Option<f64>>>,
    #[serde(default)]
    pub is_unilateral: Option<bool>,
    #[serde(default)]
    pub volume_multiplier: Option<f64>,
}

/// `IMuscleMultiplier`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MuscleMultiplier {
    pub muscle: String,
    pub multiplier: f64,
}

/// The slice of `ISettings` that the exercise helpers read.
pub trait ExerciseSettings {
    /// `settings.units`.
    fn units(&self) -> Unit;
    /// `settings.exercises`.
    fn custom_exercises(&self) -> &CustomExercises;
    /// `settings.exerciseData[key]`.
    fn exercise_data(&self, key: &str) -> Option<&ExerciseData>;
    /// `settings.planner.synergistMultiplier`.
    fn synergist_multiplier(&self) -> f64;
    /// `settings.muscleGroups`.
    fn muscle_groups(&self) -> &MuscleGroupsSettings;
    /// `Equipment_currentEquipment(settings)[equipment]?.name`.
    fn custom_equipment_name(&self, equipment: &str) -> Option<&str>;
    /// `Equipment_getUnitOrDefaultForExerciseType(settings, type)`.
    fn unit_for_exercise_type(&self, exercise_type: &ExerciseType) -> Unit;
}

// ---------------------------------------------------------------------------------------
// Seed DB
// ---------------------------------------------------------------------------------------

/// One entry of the seed DB: `allExercisesList[id]` merged with `metadata[id]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinExercise {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub default_warmup: Option<u32>,
    #[serde(default)]
    pub default_equipment: Option<String>,
    #[serde(default)]
    pub types: Vec<String>,
    pub starting_weight_kg: f64,
    pub starting_weight_lb: f64,
    #[serde(flatten)]
    pub meta: MetaExercises,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbFile {
    equipments: Vec<String>,
    equipment_names: IndexMap<String, String>,
    exercise_kinds: Vec<String>,
    exercises: Vec<BuiltinExercise>,
}

pub struct ExerciseDb {
    pub equipments: Vec<String>,
    pub equipment_names: IndexMap<String, String>,
    pub exercise_kinds: Vec<String>,
    pub exercises: Vec<BuiltinExercise>,
    by_id: IndexMap<String, usize>,
    name_to_id: IndexMap<String, String>,
}

impl ExerciseDb {
    fn build(file: DbFile) -> ExerciseDb {
        let mut by_id = IndexMap::new();
        let mut name_to_id = IndexMap::new();
        for (i, e) in file.exercises.iter().enumerate() {
            by_id.insert(e.id.clone(), i);
            // Later entries overwrite earlier ones, like the TS reduce.
            name_to_id.insert(e.name.to_lowercase(), e.id.clone());
        }
        ExerciseDb {
            equipments: file.equipments,
            equipment_names: file.equipment_names,
            exercise_kinds: file.exercise_kinds,
            exercises: file.exercises,
            by_id,
            name_to_id,
        }
    }

    pub fn get(&self, id: &str) -> Option<&BuiltinExercise> {
        self.by_id.get(id).map(|&i| &self.exercises[i])
    }
}

static DB: OnceLock<ExerciseDb> = OnceLock::new();

/// The parsed seed DB. A malformed embedded file yields an empty DB (a unit test guards it).
pub fn db() -> &'static ExerciseDb {
    DB.get_or_init(|| {
        let file = serde_json::from_str::<DbFile>(include_str!("../data/exercises.json")).unwrap_or(DbFile {
            equipments: Vec::new(),
            equipment_names: IndexMap::new(),
            exercise_kinds: Vec::new(),
            exercises: Vec::new(),
        });
        ExerciseDb::build(file)
    })
}

fn builtin_to_exercise(b: &BuiltinExercise) -> Exercise {
    Exercise {
        id: b.id.clone(),
        name: b.name.clone(),
        default_warmup: b.default_warmup,
        equipment: None,
        default_equipment: b.default_equipment.clone(),
        types: b.types.clone(),
        onerm: None,
        starting_weight_lb: b.starting_weight_lb,
        starting_weight_kg: b.starting_weight_kg,
    }
}

fn custom_to_exercise(c: &CustomExercise) -> Exercise {
    Exercise {
        id: c.id.clone(),
        name: c.name.clone(),
        default_warmup: Some(45),
        equipment: None,
        default_equipment: c.default_equipment.clone(),
        types: c.types.clone().unwrap_or_default(),
        onerm: None,
        starting_weight_lb: 0.0,
        starting_weight_kg: 0.0,
    }
}

/// `maybeGetExercise`: a custom exercise (deleted or not) wins over a built-in with the same id.
fn maybe_get_exercise(id: &str, custom: &CustomExercises) -> Option<Exercise> {
    match custom.get(id) {
        Some(c) => Some(custom_to_exercise(c)),
        None => db().get(id).map(builtin_to_exercise),
    }
}

/// `getExercise`: unknown ids fall back to squat.
fn get_exercise(id: &str, custom: &CustomExercises) -> Exercise {
    maybe_get_exercise(id, custom).unwrap_or_else(|| {
        db().get("squat").map(builtin_to_exercise).unwrap_or_else(|| Exercise {
            id: "squat".to_string(),
            name: "Squat".to_string(),
            default_warmup: None,
            equipment: None,
            default_equipment: None,
            types: Vec::new(),
            onerm: None,
            starting_weight_lb: 0.0,
            starting_weight_kg: 0.0,
        })
    })
}

fn with_equipment(mut e: Exercise, equipment: Option<String>) -> Exercise {
    e.equipment = equipment;
    e
}

// ---------------------------------------------------------------------------------------
// Small string helpers (JS semantics)
// ---------------------------------------------------------------------------------------

fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `name.toLowerCase().replace(/\s*,\s*/g, ",")`.
fn normalize_exercise_name(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut pending = String::new();
    let mut after_comma = false;
    for c in lower.chars() {
        if is_js_whitespace(c) {
            if !after_comma {
                pending.push(c);
            }
        } else if c == ',' {
            pending.clear();
            out.push(',');
            after_comma = true;
        } else {
            out.push_str(&pending);
            pending.clear();
            out.push(c);
            after_comma = false;
        }
    }
    out.push_str(&pending);
    out
}

/// `StringUtils_uncamelCase`: `([a-z])([A-Z])` -> `$1 $2`, non-overlapping.
fn uncamel_case(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len() + 4);
    let mut i = 0;
    while i < chars.len() {
        if i + 1 < chars.len() && chars[i].is_ascii_lowercase() && chars[i + 1].is_ascii_uppercase() {
            out.push(chars[i]);
            out.push(' ');
            out.push(chars[i + 1]);
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

// ---------------------------------------------------------------------------------------
// Equipment names
// ---------------------------------------------------------------------------------------

/// `equipmentToBarKey`.
pub fn equipment_to_bar_key(equipment: Option<&str>) -> Option<&'static str> {
    match equipment {
        Some("barbell") => Some("barbell"),
        Some("dumbbell") => Some("dumbbell"),
        Some("ezbar") => Some("ezbar"),
        _ => None,
    }
}

/// `equipmentName` without settings: the built-in display name, or "" for unknown equipment.
pub fn equipment_name(equipment: Option<&str>) -> String {
    equipment_name_with(equipment, None)
}

/// `equipmentName(equipment, equipmentSettings)`; the settings only supply custom names.
pub fn equipment_name_with(equipment: Option<&str>, settings: Option<&dyn ExerciseSettings>) -> String {
    if let (Some(eq), Some(s)) = (equipment, settings) {
        if let Some(n) = s.custom_equipment_name(eq) {
            if !n.is_empty() {
                return js_trim(n).to_string();
            }
        }
    }
    match equipment {
        Some(eq) => db().equipment_names.get(eq).cloned().unwrap_or_default(),
        None => String::new(),
    }
}

// ---------------------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------------------

/// `Exercise_getMetadata`: built-in metadata only, empty for unknown ids.
pub fn exercise_get_metadata(id: &str) -> MetaExercises {
    db().get(id).map(|b| b.meta.clone()).unwrap_or_default()
}

/// `Exercise_exists`: exact (case sensitive) name match against built-ins, then live customs.
pub fn exercise_exists(name: &str, custom: &CustomExercises) -> bool {
    if db().exercises.iter().any(|e| e.name == name) {
        return true;
    }
    custom.iter().any(|(k, c)| !k.is_empty() && !c.is_deleted && c.name == name)
}

/// `Exercise_isCustom`.
pub fn exercise_is_custom(id: &str, custom: &CustomExercises) -> bool {
    custom.contains_key(id)
}

/// `Exercise_findById`.
pub fn exercise_find_by_id(id: &str, custom: &CustomExercises) -> Option<Exercise> {
    maybe_get_exercise(id, custom)
}

/// First live and first deleted custom exercise id whose normalized name equals `key`
/// (the TS name index, built lazily per lookup here).
fn custom_name_lookup<'a>(custom: &'a CustomExercises, key: &str) -> (Option<&'a str>, Option<&'a str>) {
    let mut live = None;
    let mut deleted = None;
    for ce in custom.values() {
        if ce.name.is_empty() || ce.id.is_empty() {
            continue;
        }
        if live.is_some() && deleted.is_some() {
            break;
        }
        let slot = if ce.is_deleted { &mut deleted } else { &mut live };
        if slot.is_none() && normalize_exercise_name(&ce.name) == key {
            *slot = Some(ce.id.as_str());
        }
    }
    (live, deleted)
}

/// `Exercise_findIdByName`. Live customs beat built-ins, built-ins beat deleted customs.
pub fn exercise_find_id_by_name(name: &str, custom: &CustomExercises) -> Option<String> {
    let key = normalize_exercise_name(name);
    let (live, deleted) = custom_name_lookup(custom, &key);
    if let Some(id) = live {
        return Some(id.to_string());
    }
    if let Some(id) = db().name_to_id.get(&name.to_lowercase()) {
        if !id.is_empty() {
            return Some(id.clone());
        }
    }
    deleted.map(|s| s.to_string())
}

/// `Exercise_get`: unknown ids resolve to squat; equipment comes from `exercise_type`.
pub fn exercise_get(exercise_type: &ExerciseType, custom: &CustomExercises) -> Exercise {
    with_equipment(get_exercise(&exercise_type.id, custom), exercise_type.equipment.clone())
}

/// `Exercise_find`.
pub fn exercise_find(exercise_type: &ExerciseType, custom: &CustomExercises) -> Option<Exercise> {
    maybe_get_exercise(&exercise_type.id, custom).map(|e| with_equipment(e, exercise_type.equipment.clone()))
}

/// `Exercise_getById`: unknown ids resolve to squat, equipment is the exercise's default.
pub fn exercise_get_by_id(id: &str, custom: &CustomExercises) -> Exercise {
    let e = get_exercise(id, custom);
    let eq = e.default_equipment.clone();
    with_equipment(e, eq)
}

/// `Exercise_getByIds`.
pub fn exercise_get_by_ids(ids: &[String], custom: &CustomExercises) -> Vec<Exercise> {
    ids.iter().map(|id| exercise_get_by_id(id, custom)).collect()
}

/// `Exercise_findByName`: trims, resolves, equipment is the default.
pub fn exercise_find_by_name(name: &str, custom: &CustomExercises) -> Option<Exercise> {
    let id = exercise_find_id_by_name(js_trim(name), custom)?;
    let e = exercise_find_by_id(&id, custom)?;
    let eq = e.default_equipment.clone();
    Some(with_equipment(e, eq))
}

/// `Exercise_findByNameEquipment`: resolves the name and stamps the given equipment on it.
pub fn exercise_find_by_name_equipment(custom: &CustomExercises, name: &str, equipment: Option<&str>) -> Option<Exercise> {
    let id = exercise_find_id_by_name(name, custom)?;
    let e = exercise_find_by_id(&id, custom)?;
    Some(with_equipment(e, equipment.map(|s| s.to_string())))
}

/// `Exercise_findByNameAndEquipment`: parses "Name, Equipment" and resolves custom/built-in
/// collisions the same way the TS does.
pub fn exercise_find_by_name_and_equipment(name_and_equipment: &str, custom: &CustomExercises) -> Option<Exercise> {
    // None: no comma. Some(None): comma but the suffix is not equipment (TS `null`).
    let mut equipment: Option<Option<String>> = None;
    let mut name: Option<String> = None;
    let parts: Vec<&str> = name_and_equipment.split(',').map(js_trim).collect();
    if parts.len() > 1 {
        let last = parts[parts.len() - 1].to_lowercase();
        let found = db()
            .equipments
            .iter()
            .find(|e| equipment_name(Some(e.as_str())).to_lowercase() == last);
        match found {
            Some(e) => {
                equipment = Some(Some(e.clone()));
                name = Some(parts[..parts.len() - 1].join(", "));
            }
            None => equipment = Some(None),
        }
    }
    let name = name.unwrap_or_else(|| name_and_equipment.to_string());
    let exercise_id = exercise_find_id_by_name(&name, custom);
    let equipment_is_null = matches!(equipment, Some(None));
    match exercise_id {
        Some(id) if !equipment_is_null => {
            if let Some(bare) = custom.get(&id) {
                let full_key = normalize_exercise_name(name_and_equipment);
                let (live, deleted) = custom_name_lookup(custom, &full_key);
                let full_id = live.or(if bare.is_deleted { deleted } else { None });
                if let Some(full_id) = full_id {
                    if full_id != id {
                        if let Some(e) = exercise_find_by_id(full_id, custom) {
                            return Some(e);
                        }
                    }
                }
            }
            let e = exercise_find_by_id(&id, custom)?;
            let eq = match equipment {
                Some(Some(eq)) => Some(eq),
                _ => e.default_equipment.clone(),
            };
            Some(with_equipment(e, eq))
        }
        _ => {
            let id = exercise_find_id_by_name(name_and_equipment, custom)?;
            exercise_find_by_id(&id, custom)
        }
    }
}

/// `Exercise_all`: live custom exercises, then every built-in with its default equipment.
pub fn exercise_all(custom: &CustomExercises) -> Vec<Exercise> {
    let mut out: Vec<Exercise> =
        custom.iter().filter(|(_, c)| !c.is_deleted).map(|(id, _)| get_exercise(id, custom)).collect();
    out.extend(db().exercises.iter().map(|b| {
        let e = builtin_to_exercise(b);
        let eq = e.default_equipment.clone();
        with_equipment(e, eq)
    }));
    out
}

// ---------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------

/// `Exercise_buildName`.
pub fn exercise_build_name(name: &str, settings: &dyn ExerciseSettings, label: Option<&str>, equipment: Option<&str>) -> String {
    let mut s = name.to_string();
    if let Some(eq) = equipment.filter(|e| !e.is_empty()) {
        s = format!("{}, {}", name, equipment_name_with(Some(eq), Some(settings)));
    }
    if let Some(l) = label.filter(|l| !l.is_empty()) {
        s = format!("{}: {}", l, s);
    }
    s
}

/// `Exercise_fullName`: the equipment is appended only when it differs from the default.
pub fn exercise_full_name(exercise: &Exercise, settings: &dyn ExerciseSettings, label: Option<&str>) -> String {
    let equipment = match &exercise.equipment {
        Some(e) if exercise.default_equipment.as_ref() != Some(e) => Some(e.as_str()),
        _ => None,
    };
    exercise_build_name(&exercise.name, settings, label, equipment)
}

/// `Exercise_reverseName`: "Equipment Name".
pub fn exercise_reverse_name(exercise: &Exercise, settings: Option<&dyn ExerciseSettings>) -> String {
    match exercise.equipment.as_deref().filter(|e| !e.is_empty()) {
        Some(eq) => format!("{} {}", equipment_name_with(Some(eq), settings), exercise.name),
        None => exercise.name.clone(),
    }
}

/// `Exercise_nameWithEquipment`: "Name, Equipment".
pub fn exercise_name_with_equipment(exercise: &Exercise, settings: Option<&dyn ExerciseSettings>) -> String {
    match exercise.equipment.as_deref().filter(|e| !e.is_empty()) {
        Some(eq) => format!("{}, {}", exercise.name, equipment_name_with(Some(eq), settings)),
        None => exercise.name.clone(),
    }
}

fn is_forbidden_name_char(c: char) -> bool {
    matches!(c, '/' | '{' | '}' | '(' | ')' | '#' | '[' | ']' | '|' | '!' | ':' | '\t' | '\n' | '\r')
}

/// `Exercise_nameError`.
pub fn exercise_name_error(name: &str) -> Option<&'static str> {
    let trimmed = js_trim(name);
    if trimmed.is_empty() {
        return Some("Name cannot be empty");
    }
    if trimmed.chars().any(is_forbidden_name_char) {
        return Some("Name cannot contain special characters: / { } ( ) # [ ] | ! :");
    }
    None
}

/// `Exercise_sanitizeName`.
pub fn exercise_sanitize_name(name: &str) -> String {
    let replaced: String = name.chars().map(|c| if is_forbidden_name_char(c) { ' ' } else { c }).collect();
    let collapsed = replaced.split(is_js_whitespace).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        "Exercise".to_string()
    } else {
        collapsed
    }
}

// ---------------------------------------------------------------------------------------
// Keys, slugs, equality
// ---------------------------------------------------------------------------------------

/// `Exercise_toKey`: `id` or `id_equipment`.
pub fn exercise_to_key(t: &ExerciseType) -> String {
    match t.equipment.as_deref().filter(|e| !e.is_empty()) {
        Some(eq) => format!("{}_{}", t.id, eq),
        None => t.id.clone(),
    }
}

/// `Exercise_fromKey`: splits on `_` and keeps the first two parts.
pub fn exercise_from_key(key: &str) -> ExerciseType {
    let mut parts = key.split('_');
    let id = parts.next().unwrap_or("").to_string();
    let equipment = parts.next().map(|s| s.to_string());
    ExerciseType { id, equipment }
}

/// `Exercise_eq`.
pub fn exercise_eq(a: &ExerciseType, b: &ExerciseType) -> bool {
    a.id == b.id && a.equipment == b.equipment
}

const SLUG_EQUIPMENTS: [(&str, &str); 11] = [
    ("barbell", "barbell"),
    ("cable", "cable"),
    ("dumbbell", "dumbbell"),
    ("smith", "smith"),
    ("band", "band"),
    ("kettlebell", "kettlebell"),
    ("bodyweight", "bodyweight"),
    ("leverage-machine", "leverageMachine"),
    ("medicine-ball", "medicineball"),
    ("ez-bar", "ezbar"),
    ("trap-bar", "trapbar"),
];

/// `Exercise_toUrlSlug`.
pub fn exercise_to_url_slug(t: &ExerciseType) -> String {
    let eq_slug = t
        .equipment
        .as_deref()
        .and_then(|e| SLUG_EQUIPMENTS.iter().find(|(_, id)| *id == e).map(|(slug, _)| *slug));
    let prefix = eq_slug.map(|s| format!("{}-", s)).unwrap_or_default();
    format!("{}{}", prefix, muscle::dashcase(&uncamel_case(&t.id)))
}

/// `Exercise_toExternalUrl`.
pub fn exercise_to_external_url(t: &ExerciseType) -> String {
    format!("/exercises/{}", exercise_to_url_slug(t))
}

/// `Exercise_fromUrlSlug`: only built-in ids resolve.
pub fn exercise_from_url_slug(slug: &str) -> Option<ExerciseType> {
    let mut equipment = None;
    let mut rest = slug.to_string();
    if let Some((key, id)) = SLUG_EQUIPMENTS.iter().find(|(k, _)| slug.starts_with(k)) {
        equipment = Some(id.to_string());
        rest = slug.chars().skip(key.chars().count() + 1).collect();
    }
    let id = camel_case(&rest.replace('-', " "));
    db().get(&id).map(|_| ExerciseType { id, equipment })
}

// ---------------------------------------------------------------------------------------
// Settings-dependent helpers
// ---------------------------------------------------------------------------------------

fn round_half_up(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// `Weight_convertTo` for kg/lb weights.
fn convert_weight(w: Weight, unit: Unit) -> Weight {
    if w.unit == unit {
        return w;
    }
    let value = match (w.unit, unit) {
        (Unit::Kg, Unit::Lb) => round_half_up(w.value * 2.205 / 0.5) * 0.5,
        _ => round_half_up(w.value / 2.205 / 0.5) * 0.5,
    };
    Weight { value, unit }
}

/// `Exercise_getNotes`.
pub fn exercise_get_notes(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Option<String> {
    settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.notes.clone())
}

/// `Exercise_onerm`: the user's rm1 converted to the settings units, else the starting weight.
pub fn exercise_onerm(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Weight {
    if let Some(rm) = settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.rm1) {
        return convert_weight(rm, settings.units());
    }
    let e = exercise_get(t, settings.custom_exercises());
    match settings.units() {
        Unit::Kg => Weight { value: e.starting_weight_kg, unit: Unit::Kg },
        Unit::Lb => Weight { value: e.starting_weight_lb, unit: Unit::Lb },
    }
}

/// `Exercise_defaultRounding`.
pub fn exercise_default_rounding(t: &ExerciseType, settings: &dyn ExerciseSettings) -> f64 {
    let unit = settings.unit_for_exercise_type(t);
    let configured = settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.rounding);
    let default = if unit == Unit::Kg { 2.5 } else { 5.0 };
    let v = configured.unwrap_or(default);
    if v.is_nan() {
        v
    } else {
        v.max(0.1)
    }
}

/// `Exercise_getIsUnilateral`.
pub fn exercise_get_is_unilateral(t: &ExerciseType, settings: &dyn ExerciseSettings) -> bool {
    if let Some(v) = settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.is_unilateral) {
        return v;
    }
    match t.id.as_str() {
        "bulgarianSplitSquat" | "concentrationCurl" | "reverseGripConcentrationCurl" | "bentOverOneArmRow"
        | "cableKickback" | "cableTwist" | "russianTwist" | "lunge" | "reverseLunge" | "splitSquat" | "stepUp"
        | "pistolSquat" | "singleLegBridge" | "singleLegDeadlift" | "sideBend" | "sideCrunch" | "sideHipAbductor"
        | "sideLyingClam" | "sidePlank" | "singleLegCalfRaise" | "singleLegGluteBridgeBench"
        | "singleLegGluteBridgeStraight" | "singleLegGluteBridgeBentKnee" | "singleLegHipThrust" => true,
        "bicepCurl" | "wristCurl" | "reverseWristCurl" | "seatedPalmsUpWristCurl" | "hammerCurl" | "preacherCurl"
        | "reverseCurl" | "lyingBicepCurl" | "inclineCurl" => t.equipment.as_deref() == Some("dumbbell"),
        _ => false,
    }
}

/// `Exercise_getVolumeMultiplier`: implements loaded per rep (2 for most dumbbell lifts).
pub fn exercise_get_volume_multiplier(t: &ExerciseType, settings: &dyn ExerciseSettings) -> f64 {
    if let Some(v) = settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.volume_multiplier) {
        return v;
    }
    if t.equipment.as_deref() != Some("dumbbell") {
        return 1.0;
    }
    match t.id.as_str() {
        "arnoldPress" | "overheadPress" | "shoulderPress" | "shoulderPressParallelGrip" | "lateralRaise"
        | "frontRaise" | "seatedFrontRaise" | "reverseFly" | "uprightRow" | "benchPress" | "inclineBenchPress"
        | "declineBenchPress" | "inclineChestPress" | "chestFly" | "inclineChestFly" | "aroundTheWorld"
        | "bentOverRow" | "chestSupportedRow" | "inclineRow" | "renegadeRow" | "deadlift" | "romanianDeadlift"
        | "straightLegDeadlift" | "stiffLegDeadlift" | "shrug" | "skullcrusher" | "lunge" | "reverseLunge"
        | "splitSquat" | "bulgarianSplitSquat" | "stepUp" => 2.0,
        _ => 1.0,
    }
}

/// `Exercise_defaultEquipment`: the equipment the built-in metadata lists that best matches the
/// exercise's default.
pub fn exercise_default_equipment(id: &str, custom: &CustomExercises) -> Option<String> {
    fn priorities(bar: &str) -> &'static [&'static str] {
        match bar {
            "barbell" => &["ezbar", "trapbar", "dumbbell", "kettlebell"],
            "cable" => &["band", "leverageMachine"],
            "dumbbell" => &["barbell", "kettlebell", "bodyweight"],
            "smith" => &["leverageMachine", "dumbbell", "barbell", "kettlebell", "cable"],
            "band" => &["cable", "bodyweight", "leverageMachine", "smith"],
            "kettlebell" => &["dumbbell", "barbell", "cable"],
            "bodyweight" => &["cable", "dumbbell", "barbell", "band"],
            "leverageMachine" => &["smith", "cable", "dumbbell", "barbell", "kettlebell"],
            "medicineball" => &["bodyweight", "cable"],
            "ezbar" | "trapbar" => &["barbell", "dumbbell", "cable"],
            _ => &[],
        }
    }
    let exercise = exercise_get_by_id(id, custom);
    let bar = exercise.default_equipment.filter(|b| !b.is_empty()).unwrap_or_else(|| "bodyweight".to_string());
    let sorted = exercise_get_metadata(id).sorted_equipment.unwrap_or_default();
    sorted
        .iter()
        .find(|b| **b == bar)
        .or_else(|| priorities(&bar).iter().find_map(|p| sorted.iter().find(|s| s.as_str() == *p)))
        .or_else(|| sorted.first())
        .cloned()
}

// Muscles ------------------------------------------------------------------------------

fn custom_meta<'a>(t: &ExerciseType, settings: &'a dyn ExerciseSettings) -> Option<&'a MetaExercises> {
    settings.custom_exercises().get(&t.id).map(|c| &c.meta)
}

/// `Exercise_defaultTargetMuscles`.
pub fn exercise_default_target_muscles(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    match custom_meta(t, settings) {
        Some(m) => m.target_muscles.clone(),
        None => exercise_get_metadata(&t.id).target_muscles,
    }
}

/// `Exercise_targetMuscles`: muscles with multiplier exactly 1 when the user overrides, else the defaults.
pub fn exercise_target_muscles(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    match settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.muscle_multipliers.as_ref()) {
        Some(mm) => mm.iter().filter(|(_, v)| **v == Some(1.0)).map(|(k, _)| k.clone()).collect(),
        None => exercise_default_target_muscles(t, settings),
    }
}

fn groups_of(muscles: &[String], settings: &dyn ExerciseSettings) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for m in muscles {
        for g in muscle::muscle_get_screen_muscles_from_muscle(m, settings.muscle_groups()) {
            if !out.contains(&g) {
                out.push(g);
            }
        }
    }
    out
}

/// `Exercise_defaultTargetMusclesGroups`.
pub fn exercise_default_target_muscles_groups(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    groups_of(&exercise_default_target_muscles(t, settings), settings)
}

/// `Exercise_targetMusclesGroups`.
pub fn exercise_target_muscles_groups(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    groups_of(&exercise_target_muscles(t, settings), settings)
}

/// `Exercise_defaultSynergistMuscleMultipliers`: every synergist at the planner's synergist multiplier.
pub fn exercise_default_synergist_muscle_multipliers(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<MuscleMultiplier> {
    let muscles = match custom_meta(t, settings) {
        Some(m) => m.synergist_muscles.clone(),
        None => exercise_get_metadata(&t.id).synergist_muscles,
    };
    let multiplier = settings.synergist_multiplier();
    muscles.into_iter().map(|muscle| MuscleMultiplier { muscle, multiplier }).collect()
}

/// `Exercise_defaultSynergistMuscles`.
pub fn exercise_default_synergist_muscles(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    exercise_default_synergist_muscle_multipliers(t, settings).into_iter().map(|m| m.muscle).collect()
}

/// `Exercise_synergistMuscleMultipliers`: overrides with multiplier below 1 (missing counts as 0).
pub fn exercise_synergist_muscle_multipliers(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<MuscleMultiplier> {
    match settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.muscle_multipliers.as_ref()) {
        Some(mm) => mm
            .iter()
            .filter(|(_, v)| v.unwrap_or(0.0) < 1.0)
            .map(|(k, v)| MuscleMultiplier { muscle: k.clone(), multiplier: v.unwrap_or(0.0) })
            .collect(),
        None => exercise_default_synergist_muscle_multipliers(t, settings),
    }
}

/// `Exercise_synergistMuscles`.
pub fn exercise_synergist_muscles(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    match settings.exercise_data(&exercise_to_key(t)).and_then(|d| d.muscle_multipliers.as_ref()) {
        Some(mm) => mm.iter().filter(|(_, v)| v.unwrap_or(0.0) < 1.0).map(|(k, _)| k.clone()).collect(),
        None => exercise_default_synergist_muscles(t, settings),
    }
}

/// `Exercise_defaultSynergistMusclesGroups`.
pub fn exercise_default_synergist_muscles_groups(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    groups_of(&exercise_default_synergist_muscles(t, settings), settings)
}

/// `Exercise_synergistMusclesGroups`.
pub fn exercise_synergist_muscles_groups(t: &ExerciseType, settings: &dyn ExerciseSettings) -> Vec<String> {
    groups_of(&exercise_synergist_muscles(t, settings), settings)
}

/// `Exercise_synergistMusclesGroupMultipliers`: per screen muscle, the largest synergist multiplier.
pub fn exercise_synergist_muscles_group_multipliers(t: &ExerciseType, settings: &dyn ExerciseSettings) -> IndexMap<String, f64> {
    let mut memo: IndexMap<String, f64> = IndexMap::new();
    for m in exercise_synergist_muscle_multipliers(t, settings) {
        for g in muscle::muscle_get_screen_muscles_from_muscle(&m.muscle, settings.muscle_groups()) {
            match memo.get(&g) {
                Some(&cur) if cur >= m.multiplier => {}
                _ => {
                    memo.insert(g, m.multiplier);
                }
            }
        }
    }
    memo
}

// Warmups ------------------------------------------------------------------------------

/// One row of `warmupValues(units)`: sets of `reps` at `value` times the working weight, used
/// when the working weight is above `threshold`.
#[derive(Debug, Clone, PartialEq)]
pub struct WarmupSetSpec {
    pub reps: u32,
    pub threshold: Weight,
    pub value: f64,
}

/// `warmupValues(units)`, keyed by `defaultWarmup` (10, 45, 95).
pub fn warmup_values(units: Unit) -> IndexMap<u32, Vec<WarmupSetSpec>> {
    // (threshold lb, threshold kg, value) per set, 5 reps each.
    type Row = (f64, f64, f64);
    let table: [(u32, [Row; 3]); 3] = [
        (10, [(60.0, 30.0, 0.3), (30.0, 15.0, 0.5), (10.0, 5.0, 0.8)]),
        (45, [(120.0, 60.0, 0.3), (90.0, 45.0, 0.5), (45.0, 20.0, 0.8)]),
        (95, [(150.0, 70.0, 0.3), (125.0, 60.0, 0.5), (95.0, 40.0, 0.8)]),
    ];
    table
        .iter()
        .map(|(key, rows)| {
            let sets = rows
                .iter()
                .map(|&(lb, kg, value)| WarmupSetSpec {
                    reps: 5,
                    threshold: Weight { value: if units == Unit::Lb { lb } else { kg }, unit: units },
                    value,
                })
                .collect();
            (*key, sets)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    // ---- harness ---------------------------------------------------------------------------

    #[derive(Deserialize)]
    struct GymEquipment {
        name: Option<String>,
        unit: Option<Unit>,
    }
    #[derive(Deserialize)]
    struct Gym {
        id: String,
        equipment: IndexMap<String, GymEquipment>,
    }
    #[derive(Deserialize)]
    struct Planner {
        #[serde(rename = "synergistMultiplier")]
        synergist_multiplier: f64,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TestSettings {
        units: Unit,
        exercises: CustomExercises,
        exercise_data: IndexMap<String, ExerciseData>,
        planner: Planner,
        muscle_groups: MuscleGroupsSettings,
        gyms: Vec<Gym>,
        current_gym_id: Option<String>,
    }

    impl TestSettings {
        fn gym(&self) -> Option<&Gym> {
            self.gyms.iter().find(|g| Some(&g.id) == self.current_gym_id.as_ref()).or_else(|| self.gyms.first())
        }
    }

    impl ExerciseSettings for TestSettings {
        fn units(&self) -> Unit {
            self.units
        }
        fn custom_exercises(&self) -> &CustomExercises {
            &self.exercises
        }
        fn exercise_data(&self, key: &str) -> Option<&ExerciseData> {
            self.exercise_data.get(key)
        }
        fn synergist_multiplier(&self) -> f64 {
            self.planner.synergist_multiplier
        }
        fn muscle_groups(&self) -> &MuscleGroupsSettings {
            &self.muscle_groups
        }
        fn custom_equipment_name(&self, equipment: &str) -> Option<&str> {
            self.gym()?.equipment.get(equipment)?.name.as_deref()
        }
        // Mirrors Equipment_getUnitOrDefaultForExerciseType for the cases the golden exercises.
        fn unit_for_exercise_type(&self, t: &ExerciseType) -> Unit {
            let data = self.exercise_data.get(&exercise_to_key(t));
            let equipment: Option<String> = match data {
                Some(d) if d.equipment.is_some() || d.rounding.is_some() => {
                    let gym_id = self.gym().map(|g| g.id.clone()).unwrap_or_default();
                    d.equipment.as_ref().and_then(|m| m.get(&gym_id).cloned().flatten())
                }
                _ => t.equipment.clone(),
            };
            let unit = equipment
                .filter(|e| !e.is_empty())
                .and_then(|e| self.gym().and_then(|g| g.equipment.get(&e)).and_then(|d| d.unit));
            unit.unwrap_or(self.units)
        }
    }

    const LOOKUP: &str = include_str!("../../../testdata/golden/liftoscript/exercise_lookup.json");
    const FUNCTIONS: &str = include_str!("../../../testdata/golden/liftoscript/exercise_functions.json");

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).expect("golden parses")
    }

    /// JSON equality that treats 10 and 10.0 as equal.
    fn jeq(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
            (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| jeq(p, q)),
            (Value::Object(x), Value::Object(y)) => {
                x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| jeq(v, w)))
            }
            _ => a == b,
        }
    }

    fn check(what: &str, got: Value, want: &Value) {
        assert!(jeq(&got, want), "{what}\n  got:  {got}\n  want: {want}");
    }

    fn ex_json(e: Option<Exercise>) -> Value {
        match e {
            None => Value::Null,
            Some(e) => json!({
                "id": e.id, "name": e.name, "equipment": e.equipment, "defaultEquipment": e.default_equipment,
                "defaultWarmup": e.default_warmup, "types": e.types,
                "startingWeightKg": e.starting_weight_kg, "startingWeightLb": e.starting_weight_lb,
            }),
        }
    }

    fn etype(v: &Value) -> ExerciseType {
        serde_json::from_value(v.clone()).expect("type")
    }

    fn settings_of(g: &Value) -> TestSettings {
        serde_json::from_value(g["settings"].clone()).expect("settings")
    }

    fn strs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // ---- DB --------------------------------------------------------------------------------

    #[test]
    fn db_loads_all_entries() {
        let d = db();
        assert_eq!(d.exercises.len(), 211);
        assert_eq!(d.equipments.len(), 11);
        assert_eq!(d.exercise_kinds.len(), 6);
        let mut ids: Vec<&str> = d.exercises.iter().map(|e| e.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 211);
        assert_eq!(d.exercises[0].id, "abWheel");
        let squat = d.get("squat").expect("squat");
        assert_eq!(squat.name, "Squat");
        assert!(!squat.meta.target_muscles.is_empty());
        for e in &d.exercises {
            assert_eq!(d.name_to_id.get(&e.name.to_lowercase()), Some(&e.id));
        }
    }

    #[test]
    fn name_normalization() {
        assert_eq!(normalize_exercise_name("Bench Press ,  Barbell"), "bench press,barbell");
        assert_eq!(normalize_exercise_name(" A ,B , C "), " a,b,c ");
        assert_eq!(normalize_exercise_name(",,"), ",,");
        assert_eq!(normalize_exercise_name("a  b"), "a  b");
        assert_eq!(uncamel_case("benchPressCG"), "bench Press CG");
        assert_eq!(camel_case("bench press"), "benchPress");
        assert_eq!(camel_case("Bench Press"), "benchPress");
    }

    // ---- golden: lookups --------------------------------------------------------------------

    #[test]
    fn lookups_match_ts() {
        let g = parse(LOOKUP);
        let custom: CustomExercises = serde_json::from_value(g["customExercises"].clone()).expect("customs");
        let none = CustomExercises::new();
        let results = g["results"].as_array().expect("results");
        assert!(results.len() > 1000);
        for r in results {
            let input = r["input"].as_str().expect("input");
            for (label, cx) in [("builtin", &none), ("custom", &custom)] {
                let want = &r[label];
                let w = format!("{label} {input:?}");
                check(&format!("findIdByName {w}"), json!(exercise_find_id_by_name(input, cx)), &want["findIdByName"]);
                check(&format!("findByName {w}"), ex_json(exercise_find_by_name(input, cx)), &want["findByName"]);
                check(
                    &format!("findByNameAndEquipment {w}"),
                    ex_json(exercise_find_by_name_and_equipment(input, cx)),
                    &want["findByNameAndEquipment"],
                );
                check(
                    &format!("findByNameEquipment {w}"),
                    ex_json(exercise_find_by_name_equipment(cx, input, Some("cable"))),
                    &want["findByNameEquipment"],
                );
                check(&format!("exists {w}"), json!(exercise_exists(input, cx)), &want["exists"]);
            }
        }
    }

    #[test]
    fn builtin_program_names_resolve() {
        // Spot checks on top of the golden sweep: names the built-in programs use.
        let none = CustomExercises::new();
        let e = exercise_find_by_name_and_equipment("Squat, Barbell", &none).expect("squat");
        assert_eq!((e.id.as_str(), e.equipment.as_deref()), ("squat", Some("barbell")));
        assert_eq!(exercise_find_id_by_name("bench press", &none).as_deref(), Some("benchPress"));
        assert!(exercise_find_by_name("Not An Exercise", &none).is_none());
    }

    // ---- golden: functions ------------------------------------------------------------------

    #[test]
    fn per_type_functions_match_ts() {
        let g = parse(FUNCTIONS);
        let s = settings_of(&g);
        let cx = &s.exercises;
        assert!(g["perType"].as_array().expect("perType").len() > 1000);
        for r in g["perType"].as_array().expect("perType") {
            let t = etype(&r["type"]);
            let w = format!("{:?}", t);
            let e = exercise_get(&t, cx);
            let c = |name: &str, got: Value| check(&format!("{name} {w}"), got, &r[name]);
            c("key", json!(exercise_to_key(&t)));
            c("slug", json!(exercise_to_url_slug(&t)));
            c("externalUrl", json!(exercise_to_external_url(&t)));
            c("isUnilateral", json!(exercise_get_is_unilateral(&t, &s)));
            c("volumeMultiplier", json!(exercise_get_volume_multiplier(&t, &s)));
            c("fullName", json!(exercise_full_name(&e, &s, None)));
            c("fullNameLabel", json!(exercise_full_name(&e, &s, Some("lbl"))));
            c("reverseName", json!(exercise_reverse_name(&e, Some(&s))));
            c("nameWithEquipment", json!(exercise_name_with_equipment(&e, Some(&s))));
            c("get", ex_json(Some(e)));
            c("find", ex_json(exercise_find(&t, cx)));
            let o = exercise_onerm(&t, &s);
            c("onerm", json!({"value": o.value, "unit": o.unit}));
            c("rounding", json!(exercise_default_rounding(&t, &s)));
            c("notes", json!(exercise_get_notes(&t, &s)));
            c("isCustom", json!(exercise_is_custom(&t.id, cx)));
        }
    }

    #[test]
    fn muscle_functions_match_ts() {
        let g = parse(FUNCTIONS);
        let custom = settings_of(&g);
        let mut plain = settings_of(&g);
        plain.exercises.clear();
        plain.exercise_data.clear();
        plain.muscle_groups.data.clear();
        let mm = |v: Vec<MuscleMultiplier>| json!(v);
        for r in g["perMuscle"].as_array().expect("perMuscle") {
            let t = etype(&r["type"]);
            for (variant, s) in [("custom", &custom), ("plain", &plain)] {
                let want = &r[variant];
                let w = format!("{variant} {:?}", t);
                let c = |name: &str, got: Value| check(&format!("{name} {w}"), got, &want[name]);
                c("defaultTarget", json!(exercise_default_target_muscles(&t, s)));
                c("target", json!(exercise_target_muscles(&t, s)));
                c("defaultSynergist", json!(exercise_default_synergist_muscles(&t, s)));
                c("synergist", json!(exercise_synergist_muscles(&t, s)));
                c("synergistMultipliers", mm(exercise_synergist_muscle_multipliers(&t, s)));
                c("targetGroups", json!(exercise_target_muscles_groups(&t, s)));
                c("defaultTargetGroups", json!(exercise_default_target_muscles_groups(&t, s)));
                c("synergistGroups", json!(exercise_synergist_muscles_groups(&t, s)));
                c("groupMultipliers", json!(exercise_synergist_muscles_group_multipliers(&t, s)));
                // Order matters for the multipliers map: compare key order too.
                let got_keys: Vec<String> = exercise_synergist_muscles_group_multipliers(&t, s).keys().cloned().collect();
                let want_keys: Vec<String> = want["groupMultipliers"].as_object().expect("obj").keys().cloned().collect();
                assert_eq!(got_keys, want_keys, "group multiplier order {w}");
            }
        }
    }

    #[test]
    fn per_id_functions_match_ts() {
        let g = parse(FUNCTIONS);
        let s = settings_of(&g);
        let none = CustomExercises::new();
        for r in g["perId"].as_array().expect("perId") {
            let id = r["id"].as_str().expect("id");
            let c = |name: &str, got: Value| check(&format!("{name} {id}"), got, &r[name]);
            let m = exercise_get_metadata(id);
            let want = &r["metadata"];
            // Unknown ids have an empty metadata object in TS; the Rust default is all-empty.
            check(
                &format!("metadata {id}"),
                json!({
                    "bodyParts": m.body_parts, "targetMuscles": m.target_muscles,
                    "synergistMuscles": m.synergist_muscles,
                }),
                &json!({
                    "bodyParts": want.get("bodyParts").cloned().unwrap_or(json!([])),
                    "targetMuscles": want.get("targetMuscles").cloned().unwrap_or(json!([])),
                    "synergistMuscles": want.get("synergistMuscles").cloned().unwrap_or(json!([])),
                }),
            );
            assert_eq!(m.sorted_equipment, want.get("sortedEquipment").map(|v| serde_json::from_value(v.clone()).expect("eq")));
            c("defaultEquipment", json!(exercise_default_equipment(id, &none)));
            c("defaultEquipmentCustom", json!(exercise_default_equipment(id, &s.exercises)));
            c("getById", ex_json(Some(exercise_get_by_id(id, &s.exercises))));
            c("findById", ex_json(exercise_find_by_id(id, &s.exercises)));
            c("findByIdBuiltin", ex_json(exercise_find_by_id(id, &none)));
        }
    }

    #[test]
    fn slugs_keys_names_match_ts() {
        let g = parse(FUNCTIONS);
        let s = settings_of(&g);
        for r in g["fromSlug"].as_array().expect("fromSlug") {
            let slug = r["slug"].as_str().expect("slug");
            let got = exercise_from_url_slug(slug).map(|t| json!(t)).unwrap_or(Value::Null);
            check(&format!("fromSlug {slug:?}"), got, &r["result"]);
        }
        for r in g["fromKey"].as_array().expect("fromKey") {
            let t = exercise_from_key(r["key"].as_str().expect("key"));
            check("fromKey id", json!(t.id), &r["id"]);
            check("fromKey equipment", json!(t.equipment), &r["equipment"]);
        }
        for r in g["names"].as_array().expect("names") {
            let n = r["name"].as_str().expect("name");
            check(&format!("nameError {n:?}"), json!(exercise_name_error(n)), &r["error"]);
            check(&format!("sanitize {n:?}"), json!(exercise_sanitize_name(n)), &r["sanitized"]);
        }
        for r in g["buildNames"].as_array().expect("buildNames") {
            let got = exercise_build_name(
                r["name"].as_str().expect("n"),
                &s,
                r["label"].as_str(),
                r["equipment"].as_str(),
            );
            check(&format!("buildName {}", r["result"]), json!(got), &r["result"]);
        }
        for r in g["equipmentNames"].as_array().expect("equipmentNames") {
            let e = r["equipment"].as_str().expect("e");
            check("equipmentName", json!(equipment_name(Some(e))), &r["plain"]);
            check("barKey", json!(equipment_to_bar_key(Some(e))), &r["barKey"]);
        }
        for r in g["eqSettingsNames"].as_array().expect("eqSettingsNames") {
            let e = r["equipment"].as_str().expect("e");
            check(&format!("equipmentName settings {e}"), json!(equipment_name_with(Some(e), Some(&s))), &r["withSettings"]);
        }
        for r in g["eqCases"].as_array().expect("eqCases") {
            check("eq", json!(exercise_eq(&etype(&r["a"]), &etype(&r["b"]))), &r["result"]);
        }
        assert_eq!(equipment_name(None), "");
        assert_eq!(equipment_to_bar_key(None), None);
    }

    #[test]
    fn all_and_by_ids_match_ts() {
        let g = parse(FUNCTIONS);
        let s = settings_of(&g);
        let all: Vec<Value> = exercise_all(&s.exercises).into_iter().map(|e| ex_json(Some(e))).collect();
        check("all", json!(all), &g["allList"]);
        let ids: Vec<String> = db().exercises.iter().take(5).map(|e| e.id.clone()).chain(strs(&["nope", "cCurl"])).collect();
        let by: Vec<Value> = exercise_get_by_ids(&ids, &s.exercises).into_iter().map(|e| ex_json(Some(e))).collect();
        check("getByIds", json!(by), &g["allBuiltin"]);
    }

    #[test]
    fn warmups_match_ts() {
        let g = parse(FUNCTIONS);
        for (unit, key) in [(Unit::Lb, "lb"), (Unit::Kg, "kg")] {
            let got: Value = warmup_values(unit)
                .into_iter()
                .map(|(k, sets)| {
                    let arr: Vec<Value> = sets
                        .into_iter()
                        .map(|s| json!({"reps": s.reps, "threshold": {"value": s.threshold.value, "unit": s.threshold.unit}, "value": s.value}))
                        .collect();
                    (k.to_string(), Value::Array(arr))
                })
                .collect::<serde_json::Map<String, Value>>()
                .into();
            check(&format!("warmups {key}"), got, &g["warmups"][key]);
        }
    }

    #[test]
    fn muscle_group_functions_match_ts() {
        use crate::muscle::*;
        let g = parse(FUNCTIONS);
        let custom = settings_of(&g);
        let plain = MuscleGroupsSettings::default();
        let f = &g["muscleGroupFns"];
        let cg = &custom.muscle_groups;
        check("available", json!(muscle_get_available_muscle_groups(cg)), &f["available"]);
        check("availablePlain", json!(muscle_get_available_muscle_groups(&plain)), &f["availablePlain"]);
        check("hidden", json!(muscle_get_hidden_muscle_groups(cg)), &f["hidden"]);
        for r in f["names"].as_array().expect("names") {
            let n = muscle_get_muscle_group_name(r["group"].as_str().expect("g"), cg);
            check("group name", json!(n), &r["name"]);
        }
        for r in f["musclesOf"].as_array().expect("musclesOf") {
            let gr = r["group"].as_str().expect("g");
            check(&format!("musclesOf custom {gr}"), json!(muscle_get_muscles_from_screen_muscle(gr, cg)), &r["custom"]);
            check(&format!("musclesOf plain {gr}"), json!(muscle_get_muscles_from_screen_muscle(gr, &plain)), &r["plain"]);
        }
        for r in f["groupsOf"].as_array().expect("groupsOf") {
            let m = r["muscle"].as_str().expect("m");
            check(&format!("groupsOf custom {m}"), json!(muscle_get_screen_muscles_from_muscle(m, cg)), &r["custom"]);
            check(&format!("groupsOf plain {m}"), json!(muscle_get_screen_muscles_from_muscle(m, &plain)), &r["plain"]);
            check(&format!("default table {m}"), json!(default_screen_muscles_of_muscle(m)), &r["plain"]);
        }
        for r in f["isDefault"].as_array().expect("isDefault") {
            let ms: Vec<String> = serde_json::from_value(r["muscles"].clone()).expect("muscles");
            check("isDefault", json!(muscle_is_default_muscles(r["group"].as_str().expect("g"), &ms)), &r["result"]);
        }
        for r in f["imageUrls"].as_array().expect("imageUrls") {
            check("imageUrl", json!(muscle_image_url(r["muscle"].as_str().expect("m"))), &r["url"]);
        }
        assert_eq!(available_muscles().len(), 39);
    }

    // ---- hand-written edge cases ------------------------------------------------------------

    #[test]
    fn custom_shadowing_rules() {
        let mut custom = CustomExercises::new();
        let mk = |id: &str, name: &str, deleted: bool| CustomExercise {
            id: id.into(),
            name: name.into(),
            is_deleted: deleted,
            meta: MetaExercises::default(),
            default_equipment: None,
            types: None,
        };
        custom.insert("c1".into(), mk("c1", "Squat", true));
        custom.insert("c2".into(), mk("c2", "Bench Press", false));
        custom.insert("c3".into(), mk("c3", "Gone", true));
        // A deleted custom does not shadow a built-in, a live one does, a deleted one still resolves alone.
        assert_eq!(exercise_find_id_by_name("squat", &custom).as_deref(), Some("squat"));
        assert_eq!(exercise_find_id_by_name("BENCH PRESS", &custom).as_deref(), Some("c2"));
        assert_eq!(exercise_find_id_by_name("gone", &custom).as_deref(), Some("c3"));
        assert!(!exercise_exists("Gone", &custom));
        assert!(exercise_exists("Bench Press", &custom));
        // Custom exercises list first in `all`, deleted ones are skipped.
        let all = exercise_all(&custom);
        assert_eq!(all[0].id, "c2");
        assert_eq!(all.len(), 212);
        assert_eq!(exercise_get_by_id("c1", &custom).default_warmup, Some(45));
    }

    #[test]
    fn unknown_ids_fall_back_to_squat() {
        let none = CustomExercises::new();
        let e = exercise_get(&ExerciseType::new("zzz", Some("cable")), &none);
        assert_eq!((e.id.as_str(), e.equipment.as_deref()), ("squat", Some("cable")));
        assert!(exercise_find(&ExerciseType::new("zzz", None), &none).is_none());
        assert_eq!(exercise_get_metadata("zzz"), MetaExercises::default());
    }

    #[test]
    fn key_round_trip() {
        let t = ExerciseType::new("squat", Some("barbell"));
        assert_eq!(exercise_to_key(&t), "squat_barbell");
        assert_eq!(exercise_from_key("squat_barbell"), t);
        assert_eq!(exercise_to_key(&ExerciseType::new("squat", Some(""))), "squat");
        assert_eq!(exercise_from_key("squat").equipment, None);
    }
}
