//! Planner exercise structures, ported from `pages/planner/models/types.ts`
//! plus the data types of `plannerExerciseEvaluator.ts`, `plannerEvaluator.ts`,
//! `models/program.ts` and `plannerProgramExercise.ts` that the evaluators
//! pass around. UI-only types (`IPlannerUi`, modals, undo/redo state, set
//! results) are not ported.
//!
//! `liftoscriptNode` (a lezer `SyntaxNode`) on `IProgramExerciseProgress`,
//! `IProgramExerciseUpdate` and `IPlannerProgramProperty` is carried as raw
//! JSON (`liftoscript_node`) so golden files round-trip; Rust code leaves it `None`.
//! `meta.stateKeys` (a JS `Set<string>`) is an `IndexSet<String>`, written
//! as a JSON array. Golden JSON has `{}` there (`JSON.stringify` drops Set
//! members); it reads as an empty set and writes back as `[]`.

use indexmap::{IndexMap, IndexSet};
use serde::{Deserialize, Serialize};

use super::{
    errors::{IEither, IPlannerSyntaxPointer, PlannerSyntaxError},
    EvaluatedProgramType, IDayDataRequired, IExerciseType, IPlannerProgram,
    IPlannerSettings, IProgram, IProgramState, IProgramStateMetadata, IWeight, WeightOrPct,
};
use crate::js::{num, num_opt};

/// `Record<number, T>` keyed by program-exercise tag. Keys are decimal strings.
pub type IByTag<T> = IndexMap<String, T>;
/// `Record<string, T>`
pub type IByExercise<T> = IndexMap<String, T>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExerciseDescription {
    pub value: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExerciseGlobals {
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub rpe: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_rpe: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_weight: Option<bool>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub timer: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub set_timer: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_overflow_set_timer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub percentage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<IWeight>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExerciseRepRange {
    #[serde(with = "num")]
    pub number_of_sets: f64,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub minrep: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub maxrep: Option<f64>,
    pub is_amrap: bool,
    pub is_quick_add_set: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExerciseSet {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rep_range: Option<IPlannerProgramExerciseRepRange>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub timer: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub set_timer: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_overflow_set_timer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_rpe: Option<bool>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub rpe: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<IWeight>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub percentage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_weight: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IPlannerProgramExerciseSetVariation {
    pub sets: Vec<IPlannerProgramExerciseSet>,
    #[serde(rename = "isCurrent")]
    pub is_current: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExerciseVariation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise_type: Option<IExerciseType>,
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExerciseEvaluatedSet {
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub maxrep: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub minrep: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<WeightOrPct>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub timer: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub set_timer: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_overflow_set_timer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub rpe: Option<f64>,
    pub log_rpe: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub is_amrap: bool,
    pub is_quick_add_set: bool,
    pub ask_weight: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IPlannerProgramExerciseEvaluatedSetVariation {
    pub sets: Vec<IPlannerProgramExerciseEvaluatedSet>,
    #[serde(rename = "isCurrent")]
    pub is_current: bool,
}

super::literal!(
    /// `type: "warmup"`
    WarmupType,
    "warmup"
);

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExerciseWarmupSet {
    #[serde(rename = "type")]
    pub kind: WarmupType,
    #[serde(with = "num")]
    pub reps: f64,
    #[serde(with = "num")]
    pub number_of_sets: f64,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub percentage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<IWeight>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlannerProgramExerciseSuperset {
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IPlannerProgramReuseSource {
    Specific,
    Overall,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramReuse {
    pub full_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub week: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day: Option<i64>,
    pub source: IPlannerProgramReuseSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise: Option<Box<IPlannerProgramExercise>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IProgramExerciseProgressType {
    Custom,
    Lp,
    Dp,
    Sum,
    None,
}

/// `IProgramExerciseUpdateType`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IProgramExerciseUpdateType {
    Custom,
    Lp,
    Dp,
    Sum,
}

/// The evaluator builds `descriptions.reuse` as `{ fullName, exercise, source }`,
/// unlike the other reuse objects (`{ fullName, source, exercise }`).
fn ser_description_reuse<S: serde::Serializer>(
    r: &Option<IPlannerProgramReuse>,
    s: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let Some(r) = r else { return s.serialize_none() };
    let mut m = s.serialize_map(None)?;
    m.serialize_entry("fullName", &r.full_name)?;
    if let Some(w) = &r.week {
        m.serialize_entry("week", w)?;
    }
    if let Some(d) = &r.day {
        m.serialize_entry("day", d)?;
    }
    if let Some(e) = &r.exercise {
        m.serialize_entry("exercise", e)?;
    }
    m.serialize_entry("source", &r.source)?;
    m.end()
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IProgramExerciseDescriptions {
    pub values: Vec<IPlannerProgramExerciseDescription>,
    #[serde(default, skip_serializing_if = "Option::is_none", serialize_with = "ser_description_reuse")]
    pub reuse: Option<IPlannerProgramReuse>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IProgramExerciseProgress {
    #[serde(rename = "type")]
    pub kind: IProgramExerciseProgressType,
    pub state: IProgramState,
    pub state_metadata: IProgramStateMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse: Option<IPlannerProgramReuse>,
    /// Lezer node reduced by the golden dumper to `{"$lezerNode", "from", "to"}`.
    /// The Rust evaluator never fills it; kept so golden JSON round-trips.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liftoscript_node: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPropertyMeta {
    #[serde(default, with = "super::js_set::opt", skip_serializing_if = "Option::is_none")]
    pub state_keys: Option<IndexSet<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IProgramExerciseUpdate {
    #[serde(rename = "type")]
    pub kind: IProgramExerciseUpdateType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// Lezer node reduced by the golden dumper to `{"$lezerNode", "from", "to"}`.
    /// The Rust evaluator never fills it; kept so golden JSON round-trips.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liftoscript_node: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<IPropertyMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse: Option<IPlannerProgramReuse>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramProperty {
    pub name: String,
    pub fn_name: String,
    pub fn_args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse: Option<Box<IPlannerProgramProperty>>,
    /// Lezer node reduced by the golden dumper to `{"$lezerNode", "from", "to"}`.
    /// The Rust evaluator never fills it; kept so golden JSON round-trips.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liftoscript_node: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise_type: Option<IExerciseType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<IPropertyMeta>,
}

/// `IPlannerProgramProperty & { dayData: Required<IDayData> }`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramPropertyWithDay {
    #[serde(flatten)]
    pub property: IPlannerProgramProperty,
    pub day_data: IDayDataRequired,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExercisePoints {
    pub full_name: IPlannerSyntaxPointer,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superset_point: Option<IPlannerSyntaxPointer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse_set_point: Option<IPlannerSyntaxPointer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_point: Option<IPlannerSyntaxPointer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_point: Option<IPlannerSyntaxPointer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_point: Option<IPlannerSyntaxPointer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warmup_point: Option<IPlannerSyntaxPointer>,
}

/// The evaluation path builds each exercise's `dayData` as `{ week, dayInWeek, day }`
/// (plannerEvaluator.ts), while `IEvaluatedProgramDay.dayData` is `{ day, week, dayInWeek }`.
/// `IDayDataRequired` keeps the second order; exercises write the first.
fn ser_exercise_day_data<S: serde::Serializer>(d: &IDayDataRequired, s: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut m = s.serialize_map(Some(3))?;
    m.serialize_entry("week", &d.week)?;
    m.serialize_entry("dayInWeek", &d.day_in_week)?;
    m.serialize_entry("day", &d.day)?;
    m.end()
}

/// `IPlannerProgramExercise`. `exercise_type` is `Some` for the
/// `IPlannerProgramExerciseWithType` subtype.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramExercise {
    pub id: String,
    pub key: String,
    pub full_name: String,
    pub short_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise_type: Option<IExerciseType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(serialize_with = "ser_exercise_day_data")]
    pub day_data: IDayDataRequired,
    pub text: String,
    pub repeat: Vec<i64>,
    pub repeating: Vec<i64>,
    pub order: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superset: Option<IPlannerProgramExerciseSuperset>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equipment: Option<String>,
    pub exercise_index: i64,
    pub line: i64,
    pub tags: Vec<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notused: Option<bool>,
    pub evaluated_set_variations: Vec<IPlannerProgramExerciseEvaluatedSetVariation>,
    pub set_variations: Vec<IPlannerProgramExerciseSetVariation>,
    pub exercise_variations: Vec<IPlannerProgramExerciseVariation>,
    pub descriptions: IProgramExerciseDescriptions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warmup_sets: Option<Vec<IPlannerProgramExerciseWarmupSet>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse: Option<IPlannerProgramReuse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<IProgramExerciseProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update: Option<IProgramExerciseUpdate>,
    pub globals: IPlannerProgramExerciseGlobals,
    pub points: IPlannerProgramExercisePoints,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_repeat: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IPlannerTopLineType {
    Exercise,
    Comment,
    Description,
    Empty,
}

/// `IPlannerTopLineItem`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerTopLineItem {
    #[serde(rename = "type")]
    pub kind: IPlannerTopLineType,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise_index: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notused: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<Vec<i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat_ranges: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_repeat: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descriptions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sections: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sections_to_reuse: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub used: Option<bool>,
}

/// `IPlannerEvalResult`
pub type IPlannerEvalResult = IEither<Vec<IPlannerProgramExercise>, PlannerSyntaxError>;

// ---- models/program.ts

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IEvaluatedProgramDay {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "dayData")]
    pub day_data: IDayDataRequired,
    pub exercises: Vec<IPlannerProgramExercise>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IEvaluatedProgramWeek {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub days: Vec<IEvaluatedProgramDay>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IEvaluatedProgramError {
    pub error: PlannerSyntaxError,
    #[serde(rename = "dayData")]
    pub day_data: IDayDataRequired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IEvaluatedProgram {
    #[serde(rename = "type")]
    pub kind: EvaluatedProgramType,
    pub id: String,
    pub errors: Vec<IEvaluatedProgramError>,
    pub planner: IPlannerProgram,
    pub name: String,
    pub next_day: i64,
    pub weeks: Vec<IEvaluatedProgramWeek>,
    pub states: IByTag<IProgramState>,
}

/// `IEProgram = IProgram | IEvaluatedProgram`. Distinguished by `vtype` vs `type`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IEProgram {
    Evaluated(Box<IEvaluatedProgram>),
    Program(Box<IProgram>),
}

// ---- plannerExerciseEvaluator.ts week result

/// `IPlannerExerciseEvaluatorWeek` is evaluator-internal; callers hold
/// `Vec<Vec<IPlannerEvalResult>>` (week, day).
pub type IPlannerEvalWeeks = Vec<Vec<IPlannerEvalResult>>;

// ---- models/program (exports)

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerMainSettings {
    pub exercises: super::IAllCustomExercises,
    #[serde(with = "num")]
    pub timer: f64,
}

super::literal!(
    /// `type: "v2"`
    ExportV2Type,
    "v2"
);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IExportedPlannerProgram {
    #[serde(rename = "type")]
    pub kind: ExportV2Type,
    pub version: String,
    pub id: String,
    pub program: IPlannerProgram,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub planner_settings: Option<IPlannerSettings>,
    pub settings: IPlannerMainSettings,
}

/// `IWeightChange` from `models/programExercise.ts`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IWeightChange {
    pub original_weight: WeightOrPct,
    pub weight: WeightOrPct,
    pub current: bool,
}

// ---- plannerProgramExercise.ts progression types

/// `IProgressionType`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum IProgressionType {
    Linear(ILinearProgression),
    Double(IDoubleProgression),
    Sumreps(ISumRepsProgression),
    Custom {},
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ILinearProgression {
    pub increase: WeightOrPct,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub successes_required: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub successes_counter: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decrease: Option<WeightOrPct>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub failures_required: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub failures_counter: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IDoubleProgression {
    pub increase: WeightOrPct,
    #[serde(with = "num")]
    pub min_reps: f64,
    #[serde(with = "num")]
    pub max_reps: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ISumRepsProgression {
    pub increase: WeightOrPct,
    #[serde(with = "num")]
    pub reps: f64,
}
