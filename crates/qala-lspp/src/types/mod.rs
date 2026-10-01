//! Data types of the liftoscript evaluation path, ported from
//! `packages/liftoscript/src/types.ts` and `pages/planner/models/types.ts`.
//!
//! Every type (de)serializes to the same JSON shape as its TS counterpart so
//! golden JSON produced from the TS round-trips. Conventions:
//!
//! - TS names are kept (`IWeight`, `ISettings`, ...), fields are snake_case in
//!   Rust and camelCase on the wire.
//! - TS `number` is `f64`, written through `crate::js::num*` so integral
//!   values print as `1`, not `1.0`. Structural integers (indexes, week/day
//!   numbers, timestamps, ids, tags) are `i64`.
//! - `T | undefined` is `Option<T>` (skipped when `None`). `T | null | undefined`
//!   is `Option<Option<T>>` where the field needs to tell them apart.
//! - `Record<string, V>` is `IndexMap<String, V>`. JS orders integer-like keys
//!   first; code that builds such maps from computed keys should pass them
//!   through `crate::js::js_order_keys`.
//! - Literal `vtype` fields are zero-sized unit structs (`SetVtype`, ...) that
//!   serialize to the literal and reject anything else.
//! - Muscles, body parts and equipment ids stay `String` (the exercise DB
//!   modules own the closed lists).
//! - UI-only state that rides inside evaluation data (`IHistoryRecord.ui`) is
//!   carried as raw `serde_json::Value` so it round-trips untouched.

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::js::{self, num, num_opt, Num};

pub mod errors;
pub mod exercise_view;
pub mod planner;
pub mod script;

pub use errors::*;
pub use exercise_view::*;
pub use planner::*;
pub use script::*;

pub use crate::util::math::IAssignmentOp;

// ---------------------------------------------------------------------------
// helpers

/// Declares a zero-sized type that (de)serializes as one string literal.
macro_rules! literal {
    ($(#[$m:meta])* $name:ident, $lit:literal) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
        pub struct $name;

        impl ::serde::Serialize for $name {
            fn serialize<S: ::serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str($lit)
            }
        }

        impl<'de> ::serde::Deserialize<'de> for $name {
            fn deserialize<D: ::serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                use ::serde::de::Error as _;
                let v = <String as ::serde::Deserialize>::deserialize(d)?;
                if v == $lit {
                    Ok($name)
                } else {
                    Err(D::Error::custom(concat!("expected literal ", $lit)))
                }
            }
        }
    };
}
pub(crate) use literal;

/// serde module for `Option<Option<T>>` fields (`T | null | undefined`).
/// Use with `default`, `skip_serializing_if = "Option::is_none"`.
pub mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        x: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match x {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Ok(Some(Option::<T>::deserialize(d)?))
    }
}

/// serde module for a JS `Set<string>`. Writes a JSON array. Reads an array,
/// or an object (the dumper's `JSON.stringify(new Set(...))` gives `{}`, which
/// loses the members; object keys are taken as members).
pub mod js_set {
    use indexmap::IndexSet;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(x: &IndexSet<String>, s: S) -> Result<S::Ok, S::Error> {
        x.serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<IndexSet<String>, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Seq(Vec<String>),
            Map(indexmap::IndexMap<String, serde::de::IgnoredAny>),
        }
        Ok(match Raw::deserialize(d)? {
            Raw::Seq(v) => v.into_iter().collect(),
            Raw::Map(m) => m.into_keys().collect(),
        })
    }

    /// For `Option<IndexSet<String>>`.
    pub mod opt {
        use indexmap::IndexSet;
        use serde::{Deserialize, Deserializer, Serialize, Serializer};

        pub fn serialize<S: Serializer>(x: &Option<IndexSet<String>>, s: S) -> Result<S::Ok, S::Error> {
            x.serialize(s)
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<IndexSet<String>>, D::Error> {
            #[derive(Deserialize)]
            struct W(#[serde(with = "super")] IndexSet<String>);
            Ok(Option::<W>::deserialize(d)?.map(|w| w.0))
        }
    }
}

literal!(
    /// `vtype: "set"`
    SetVtype,
    "set"
);
literal!(
    /// `vtype: "history_entry"`
    HistoryEntryVtype,
    "history_entry"
);
literal!(
    /// `vtype: "custom_exercise"`
    CustomExerciseVtype,
    "custom_exercise"
);
literal!(
    /// `vtype: "equipment_data"`
    EquipmentDataVtype,
    "equipment_data"
);
literal!(
    /// `vtype: "planner"`
    PlannerVtype,
    "planner"
);
literal!(
    /// `vtype: "program"`
    ProgramVtype,
    "program"
);
literal!(
    /// `vtype: "stat"`
    StatVtype,
    "stat"
);
literal!(
    /// `vtype: "graph"`
    GraphVtype,
    "graph"
);
literal!(
    /// `vtype: "graphs"`
    GraphsVtype,
    "graphs"
);
literal!(
    /// `vtype: "gym"`
    GymVtype,
    "gym"
);
literal!(
    /// `vtype: "muscle_groups_settings"`
    MuscleGroupsSettingsVtype,
    "muscle_groups_settings"
);
literal!(
    /// `type: "evaluatedProgram"`
    EvaluatedProgramType,
    "evaluatedProgram"
);

// ---------------------------------------------------------------------------
// enums and constant lists

pub const EQUIPMENTS: [&str; 11] = [
    "barbell",
    "cable",
    "dumbbell",
    "smith",
    "band",
    "kettlebell",
    "bodyweight",
    "leverageMachine",
    "medicineball",
    "ezbar",
    "trapbar",
];
pub const EXERCISE_KINDS: [&str; 6] = ["core", "pull", "push", "legs", "upper", "lower"];
pub const UNITS: [&str; 2] = ["kg", "lb"];
pub const TARGET_TYPES: [&str; 4] = ["target", "lasttime", "platescalculator", "e1rm"];
pub const STATS_WEIGHT_DEF: [&str; 1] = ["weight"];
pub const STATS_LENGTH_DEF: [&str; 13] = [
    "neck",
    "shoulders",
    "bicepLeft",
    "bicepRight",
    "forearmLeft",
    "forearmRight",
    "chest",
    "waist",
    "hips",
    "thighLeft",
    "thighRight",
    "calfLeft",
    "calfRight",
];
pub const STATS_PERCENTAGE_DEF: [&str; 1] = ["bodyfat"];
pub const STATS_HEALTH_DEF: [&str; 3] = ["sleep", "calories", "protein"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IUnit {
    #[serde(rename = "kg")]
    Kg,
    #[serde(rename = "lb")]
    Lb,
}

impl IUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            IUnit::Kg => "kg",
            IUnit::Lb => "lb",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum IPercentageUnit {
    #[default]
    #[serde(rename = "%")]
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ILengthUnit {
    #[serde(rename = "in")]
    In,
    #[serde(rename = "cm")]
    Cm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IExerciseKind {
    Core,
    Pull,
    Push,
    Legs,
    Upper,
    Lower,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ITargetType {
    #[serde(rename = "target")]
    Target,
    #[serde(rename = "lasttime")]
    Lasttime,
    #[serde(rename = "platescalculator")]
    Platescalculator,
    #[serde(rename = "e1rm")]
    E1rm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IExercisePickerSort {
    #[serde(rename = "name_asc")]
    NameAsc,
    #[serde(rename = "similar_muscles")]
    SimilarMuscles,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IProgressMode {
    Warmup,
    Workout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ITimedSetSide {
    Left,
    Right,
    Bilateral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IHistoryRecordChange {
    #[serde(rename = "order")]
    Order,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IProgramTag {
    #[serde(rename = "first-starter")]
    FirstStarter,
    #[serde(rename = "beginner")]
    Beginner,
    #[serde(rename = "barbell")]
    Barbell,
    #[serde(rename = "dumbbell")]
    Dumbbell,
    #[serde(rename = "intermediate")]
    Intermediate,
    #[serde(rename = "woman")]
    Woman,
    #[serde(rename = "ppl")]
    Ppl,
    #[serde(rename = "hypertrophy")]
    Hypertrophy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IGraphExerciseSelectedType {
    Weight,
    Volume,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IGraphMuscleGroupSelectedType {
    Volume,
    Sets,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ITheme {
    Dark,
    Light,
}

/// `"history_record" | "progress"`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IHistoryRecordVtype {
    #[serde(rename = "history_record")]
    HistoryRecord,
    #[serde(rename = "progress")]
    Progress,
}

/// `IProgramMode` from `models/program.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IProgramMode {
    Planner,
    Update,
}

// ---------------------------------------------------------------------------
// weights

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct IWeight {
    #[serde(with = "num")]
    pub value: f64,
    pub unit: IUnit,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct IPercentage {
    #[serde(with = "num")]
    pub value: f64,
    pub unit: IPercentageUnit,
}

impl IPercentage {
    pub fn new(value: f64) -> IPercentage {
        IPercentage { value, unit: IPercentageUnit::Percent }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ILength {
    #[serde(with = "num")]
    pub value: f64,
    pub unit: ILengthUnit,
}

/// `IWeight | IPercentage`
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WeightOrPct {
    Weight(IWeight),
    Percentage(IPercentage),
}

impl WeightOrPct {
    pub fn value(&self) -> f64 {
        match self {
            WeightOrPct::Weight(w) => w.value,
            WeightOrPct::Percentage(p) => p.value,
        }
    }
}

impl From<IWeight> for WeightOrPct {
    fn from(w: IWeight) -> Self {
        WeightOrPct::Weight(w)
    }
}

impl From<IPercentage> for WeightOrPct {
    fn from(p: IPercentage) -> Self {
        WeightOrPct::Percentage(p)
    }
}

/// `IWeight | number`
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WeightOrNumber {
    Number(#[serde(with = "num")] f64),
    Weight(IWeight),
}

impl From<f64> for WeightOrNumber {
    fn from(n: f64) -> Self {
        WeightOrNumber::Number(n)
    }
}

impl From<IWeight> for WeightOrNumber {
    fn from(w: IWeight) -> Self {
        WeightOrNumber::Weight(w)
    }
}

/// `number | IWeight | IPercentage`: the value type of program state, script
/// prints and every Liftoscript expression.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScriptValue {
    Number(#[serde(with = "num")] f64),
    Weight(IWeight),
    Percentage(IPercentage),
}

impl ScriptValue {
    pub fn is_number(&self) -> bool {
        matches!(self, ScriptValue::Number(_))
    }
    pub fn is_weight(&self) -> bool {
        matches!(self, ScriptValue::Weight(_))
    }
    pub fn is_percentage(&self) -> bool {
        matches!(self, ScriptValue::Percentage(_))
    }
    /// The inner `value` regardless of kind.
    pub fn value(&self) -> f64 {
        match self {
            ScriptValue::Number(n) => *n,
            ScriptValue::Weight(w) => w.value,
            ScriptValue::Percentage(p) => p.value,
        }
    }
}

impl From<f64> for ScriptValue {
    fn from(n: f64) -> Self {
        ScriptValue::Number(n)
    }
}

impl From<IWeight> for ScriptValue {
    fn from(w: IWeight) -> Self {
        ScriptValue::Weight(w)
    }
}

impl From<IPercentage> for ScriptValue {
    fn from(p: IPercentage) -> Self {
        ScriptValue::Percentage(p)
    }
}

impl From<WeightOrPct> for ScriptValue {
    fn from(w: WeightOrPct) -> Self {
        match w {
            WeightOrPct::Weight(w) => ScriptValue::Weight(w),
            WeightOrPct::Percentage(p) => ScriptValue::Percentage(p),
        }
    }
}

impl From<WeightOrNumber> for ScriptValue {
    fn from(w: WeightOrNumber) -> Self {
        match w {
            WeightOrNumber::Number(n) => ScriptValue::Number(n),
            WeightOrNumber::Weight(w) => ScriptValue::Weight(w),
        }
    }
}

/// `Record<string, number | IWeight | IPercentage>`
pub type IProgramState = IndexMap<String, ScriptValue>;

// ---------------------------------------------------------------------------
// exercises and equipment

pub type IExerciseId = String;
pub type IEquipment = String;
pub type IMuscle = String;
pub type IBodyPart = String;
pub type IScreenMuscle = String;

/// `IExerciseType`. In evaluated programs the TS puts a whole `IExercise`
/// object here (`name`, `types`, `startingWeightLb`, ...), so unknown fields
/// are kept in `extra`. Equality and hashing look at `id` and `equipment`
/// only, like `Exercise_eq`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct IExerciseType {
    pub id: IExerciseId,
    #[serde(default)]
    pub equipment: Option<IEquipment>,
    #[serde(flatten)]
    pub extra: IndexMap<String, serde_json::Value>,
}

/// Writes `id`, the extra fields, then `equipment`: the TS builds these as
/// `{ ...exercise, equipment }`, so `equipment` comes last.
impl Serialize for IExerciseType {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(None)?;
        // A custom exercise is spread from the user's object, which starts with `vtype`.
        let vtype_first = self.extra.get_index(0).is_some_and(|(k, _)| k == "vtype");
        if vtype_first {
            if let Some((k, v)) = self.extra.get_index(0) {
                m.serialize_entry(k, v)?;
            }
        }
        m.serialize_entry("id", &self.id)?;
        for (i, (k, v)) in self.extra.iter().enumerate() {
            if vtype_first && i == 0 {
                continue;
            }
            m.serialize_entry(k, v)?;
        }
        if let Some(e) = &self.equipment {
            m.serialize_entry("equipment", e)?;
        }
        m.end()
    }
}

impl PartialEq for IExerciseType {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id && self.equipment == other.equipment
    }
}

impl Eq for IExerciseType {}

impl std::hash::Hash for IExerciseType {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
        self.equipment.hash(state);
    }
}

impl IExerciseType {
    pub fn new(id: &str, equipment: Option<&str>) -> IExerciseType {
        IExerciseType { id: id.to_string(), equipment: equipment.map(|e| e.to_string()), extra: IndexMap::new() }
    }

    /// `Exercise_toKey`: `id` or `id_equipment` (an empty equipment is falsy in JS).
    pub fn to_key(&self) -> String {
        match &self.equipment {
            Some(e) if !e.is_empty() => format!("{}_{}", self.id, e),
            _ => self.id.clone(),
        }
    }

    /// `Exercise_fromKey`: splits on "_" and keeps only the first two parts.
    pub fn from_key(key: &str) -> IExerciseType {
        let mut parts = key.split('_');
        let id = parts.next().unwrap_or("").to_string();
        let equipment = parts.next().map(|e| e.to_string());
        IExerciseType { id, equipment, extra: IndexMap::new() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlate {
    pub weight: IWeight,
    #[serde(with = "num")]
    pub num: f64,
}

pub type IBars = IndexMap<String, IWeight>;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IMetaExercises {
    pub body_parts: Vec<IBodyPart>,
    pub target_muscles: Vec<IMuscle>,
    pub synergist_muscles: Vec<IMuscle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sorted_equipment: Option<Vec<IEquipment>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ICustomExercise {
    pub vtype: CustomExerciseVtype,
    pub id: IExerciseId,
    pub name: String,
    pub is_deleted: bool,
    pub meta: IMetaExercises,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_equipment: Option<IEquipment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<Vec<IExerciseKind>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloned_from: Option<IExerciseType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse_image_from: Option<IExerciseType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub large_image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub small_image_url: Option<String>,
}

pub type IAllCustomExercises = IndexMap<String, ICustomExercise>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IEquipmentBar {
    pub lb: IWeight,
    pub kg: IWeight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IEquipmentData {
    pub vtype: EquipmentDataVtype,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(with = "num")]
    pub multiplier: f64,
    pub bar: IEquipmentBar,
    pub plates: Vec<IPlate>,
    pub fixed: Vec<IWeight>,
    pub is_fixed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<IUnit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub similar_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_deleted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_bodyweight_for_bar: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_assisting: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

pub type IAllEquipment = IndexMap<String, IEquipmentData>;

// ---------------------------------------------------------------------------
// sets and history

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ISet {
    pub vtype: SetVtype,
    pub index: i64,
    pub id: String,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub reps: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_weight: Option<WeightOrPct>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<IWeight>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub min_reps: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub rpe: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_rpe: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_amrap: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub timer: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub set_timer: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_overflow_set_timer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_weight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_completed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_unilateral: Option<bool>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub completed_reps_left: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub completed_reps: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_weight: Option<IWeight>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub completed_rpe: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub completed_set_timer: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub completed_set_timer_left: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub program_set_index: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IHistoryEntryProgressSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_state: Option<IndexMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_vars: Option<IndexMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prints: Option<Vec<Vec<ScriptValue>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_prints: Option<Vec<Vec<ScriptValue>>>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IHistoryEntry {
    pub vtype: HistoryEntryVtype,
    pub exercise: IExerciseType,
    pub sets: Vec<ISet>,
    pub warmup_sets: Vec<ISet>,
    pub index: i64,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub program_exercise_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<IProgramState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vars: Option<IProgramState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_suppressed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_prints: Option<Vec<Vec<ScriptValue>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_snapshot: Option<IHistoryEntryProgressSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IProgramStateMetadataValue {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_prompted: Option<bool>,
}

pub type IProgramStateMetadata = IndexMap<String, IProgramStateMetadataValue>;

/// `[number, number | undefined | null]`
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IInterval(pub f64, pub Option<f64>);

impl Serialize for IInterval {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut seq = s.serialize_seq(Some(2))?;
        seq.serialize_element(&Num(self.0))?;
        seq.serialize_element(&self.1.map(Num))?;
        seq.end()
    }
}

impl<'de> Deserialize<'de> for IInterval {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let (a, b) = <(Num, Option<Num>)>::deserialize(d)?;
        Ok(IInterval(a.0, b.map(|n| n.0)))
    }
}

pub type IIntervals = Vec<IInterval>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ISetTimer {
    pub entry_index: i64,
    pub set_index: i64,
    pub set_id: String,
    pub id: String,
    pub side: ITimedSetSide,
    pub started_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_timing: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ISetTimerGetReady {
    pub entry_index: i64,
    pub set_index: i64,
    pub set_id: String,
    pub id: String,
    pub side: ITimedSetSide,
    pub started_at: i64,
    #[serde(with = "num")]
    pub get_ready: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAmrapModal {
    pub entry_index: i64,
    pub set_index: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_amrap: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_rpe: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_weight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_vars: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IHistoryRecord {
    pub vtype: IHistoryRecordVtype,
    pub date: String,
    pub program_id: String,
    pub program_name: String,
    pub day: i64,
    pub day_name: String,
    pub entries: Vec<IHistoryEntry>,
    #[serde(with = "num")]
    pub start_time: f64,
    pub id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub week: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day_in_week: Option<i64>,
    /// UI state (`IProgressUi`), carried as raw JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intervals: Option<IIntervals>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_program_exercises: Option<IndexMap<String, bool>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_prompted_state_vars: Option<IndexMap<String, IProgramState>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changes: Option<Vec<IHistoryRecordChange>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_since: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_mode: Option<IProgressMode>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub timer: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_entry_index: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_set_index: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_timer: Option<ISetTimer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_timer_get_ready: Option<ISetTimerGetReady>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amrap_modal: Option<IAmrapModal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_entry_index: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

// ---------------------------------------------------------------------------
// programs

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IProgramSet {
    pub reps_expr: String,
    pub weight_expr: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_amrap: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rpe_expr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_reps_expr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_rpe: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_weight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_expr: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IProgramExerciseVariation {
    pub sets: Vec<IProgramSet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quick_add_sets: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IProgramExerciseWarmupSet {
    #[serde(with = "num")]
    pub reps: f64,
    pub value: WeightOrNumber,
    pub threshold: IWeight,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IProgramExerciseReuseLogic {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected: Option<String>,
    pub states: IndexMap<String, IProgramState>,
}

/// Legacy (pre-planner) program exercise, still part of `IProgram`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IProgramExercise {
    pub exercise_type: IExerciseType,
    pub id: String,
    pub name: String,
    pub variations: Vec<IProgramExerciseVariation>,
    pub state: IProgramState,
    pub variation_expr: String,
    pub finish_day_expr: String,
    pub descriptions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_day_expr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_expr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quick_add_sets: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_rep_ranges: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_rpe: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_metadata: Option<IProgramStateMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_expr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse_logic: Option<IProgramExerciseReuseLogic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warmup_sets: Option<Vec<IProgramExerciseWarmupSet>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse_finish_day_script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse_update_day_script: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IProgramDayEntry {
    pub exercise: IExerciseType,
    pub sets: Vec<IProgramSet>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IIdRef {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IProgramWeek {
    pub id: String,
    pub name: String,
    pub days: Vec<IIdRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IProgramDay {
    pub id: String,
    pub name: String,
    pub exercises: Vec<IIdRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerProgramDay {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub exercise_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlannerProgramWeek {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub days: Vec<IPlannerProgramDay>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlannerProgram {
    pub vtype: PlannerVtype,
    pub name: String,
    pub weeks: Vec<IPlannerProgramWeek>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IProgram {
    pub vtype: ProgramVtype,
    pub exercises: Vec<IProgramExercise>,
    pub id: String,
    pub name: String,
    pub description: String,
    pub url: String,
    pub author: String,
    pub next_day: i64,
    pub days: Vec<IProgramDay>,
    pub weeks: Vec<IProgramWeek>,
    pub is_multiweek: bool,
    pub tags: Vec<IProgramTag>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_days: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_weeks: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_exercises: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloned_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub planner: Option<IPlannerProgram>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    /// `string | null | undefined`
    #[serde(default, with = "double_option", skip_serializing_if = "Option::is_none")]
    pub authorid: Option<Option<String>>,
    /// `string | null | undefined`
    #[serde(default, with = "double_option", skip_serializing_if = "Option::is_none")]
    pub source: Option<Option<String>>,
}

// ---------------------------------------------------------------------------
// day data

/// `IDayData`: `week` and `dayInWeek` are optional.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IDayData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub week: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day_in_week: Option<i64>,
    pub day: i64,
}

/// `Required<IDayData>`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IDayDataRequired {
    pub day: i64,
    pub week: i64,
    pub day_in_week: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IShortDayData {
    pub week: i64,
    pub day_in_week: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IDaySetData {
    pub week: i64,
    pub day_in_week: i64,
    pub set_variation: i64,
    pub set: i64,
}

impl From<IDayDataRequired> for IDayData {
    fn from(d: IDayDataRequired) -> Self {
        IDayData { week: Some(d.week), day: d.day, day_in_week: Some(d.day_in_week) }
    }
}

// ---------------------------------------------------------------------------
// stats

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IStatsWeightValue {
    pub vtype: StatVtype,
    pub value: IWeight,
    pub timestamp: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_uuid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IStatsLengthValue {
    pub vtype: StatVtype,
    pub value: ILength,
    pub timestamp: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_uuid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IStatsPercentageValue {
    pub vtype: StatVtype,
    pub value: IPercentage,
    pub timestamp: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_uuid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IStatsHealthValue {
    pub vtype: StatVtype,
    #[serde(with = "num")]
    pub value: f64,
    pub timestamp: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IStatsWeight {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<Vec<IStatsWeightValue>>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IStatsPercentage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bodyfat: Option<Vec<IStatsPercentageValue>>,
}

/// `Partial<Record<"neck" | "shoulders" | ..., IStatsLengthValue[]>>`
pub type IStatsLength = IndexMap<String, Vec<IStatsLengthValue>>;
/// `Partial<Record<"sleep" | "calories" | "protein", IStatsHealthValue[]>>`
pub type IStatsHealth = IndexMap<String, Vec<IStatsHealthValue>>;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IStats {
    pub weight: IStatsWeight,
    pub length: IStatsLength,
    pub percentage: IStatsPercentage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<IStatsHealth>,
}

// ---------------------------------------------------------------------------
// settings

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IStatsWeightEnabled {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IStatsPercentageEnabled {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bodyfat: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IStatsEnabled {
    pub weight: IStatsWeightEnabled,
    pub length: IndexMap<String, bool>,
    pub percentage: IStatsPercentageEnabled,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ISettingsTimers {
    /// `number | null | undefined`
    #[serde(default, with = "js::num_opt_opt", skip_serializing_if = "Option::is_none")]
    pub warmup: Option<Option<f64>>,
    /// `number | null | undefined`
    #[serde(default, with = "js::num_opt_opt", skip_serializing_if = "Option::is_none")]
    pub workout: Option<Option<f64>>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub reminder: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub superset: Option<f64>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub get_ready: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IGraph {
    #[serde(rename = "exercise")]
    Exercise { vtype: GraphVtype, id: String },
    #[serde(rename = "statsWeight")]
    StatsWeight { vtype: GraphVtype, id: String },
    #[serde(rename = "statsLength")]
    StatsLength { vtype: GraphVtype, id: String },
    #[serde(rename = "statsPercentage")]
    StatsPercentage { vtype: GraphVtype, id: String },
    #[serde(rename = "muscleGroup")]
    MuscleGroup { vtype: GraphVtype, id: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IGraphs {
    pub vtype: GraphsVtype,
    pub graphs: Vec<IGraph>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IGraphOptions {
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub moving_average_window_size: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IGraphsSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_same_x_axis: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_with_bodyweight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_with_one_rm: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_with_program_lines: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_type: Option<IGraphExerciseSelectedType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_muscle_group_type: Option<IGraphMuscleGroupSelectedType>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IExerciseStatsSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ascending_sort: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_without_workout_notes: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_without_exercise_notes: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IExerciseDataValue {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rm1: Option<IWeight>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub rounding: Option<f64>,
    /// gym id to equipment id
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equipment: Option<IndexMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muscle_multipliers: Option<IndexMap<String, Num>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_unilateral: Option<bool>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub volume_multiplier: Option<f64>,
}

pub type IExerciseData = IndexMap<String, IExerciseDataValue>;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IPlannerSettings {
    #[serde(with = "num")]
    pub synergist_multiplier: f64,
    #[serde(with = "num")]
    pub strength_sets_pct: f64,
    #[serde(with = "num")]
    pub hypertrophy_sets_pct: f64,
    pub weekly_range_sets: IndexMap<String, [Num; 2]>,
    pub weekly_frequency: IndexMap<String, Num>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IGym {
    pub vtype: GymVtype,
    pub id: String,
    pub name: String,
    pub equipment: IAllEquipment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IWorkoutSettings {
    pub target_type: ITargetType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub should_hide_graphs: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub should_keep_program_exercise_id: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub should_show_invisible_equipment: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picker_sort: Option<IExercisePickerSort>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IMuscleGroupSettingsEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muscles: Option<Vec<IMuscle>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IMuscleGroupsSettings {
    pub vtype: MuscleGroupsSettingsVtype,
    pub data: IndexMap<String, IMuscleGroupSettingsEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ISettings {
    pub timers: ISettingsTimers,
    pub gyms: Vec<IGym>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_gym_id: Option<String>,
    pub deleted_gyms: Vec<String>,
    pub graphs: IGraphs,
    pub graph_options: IndexMap<String, IGraphOptions>,
    pub graphs_settings: IGraphsSettings,
    pub exercise_stats_settings: IExerciseStatsSettings,
    pub exercises: IAllCustomExercises,
    pub stats_enabled: IStatsEnabled,
    pub units: IUnit,
    pub length_units: ILengthUnit,
    #[serde(with = "num")]
    pub volume: f64,
    pub exercise_data: IExerciseData,
    pub planner: IPlannerSettings,
    pub workout_settings: IWorkoutSettings,
    pub muscle_groups: IMuscleGroupsSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_health_sync_workout: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_health_sync_measurements: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_health_sync_sleep_nutrition: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_health_anchor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_health_sync_workout: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_health_sync_measurements: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_health_sync_sleep_nutrition: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_health_anchor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_confirmation: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_do_not_disturb: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_public_profile: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_on_display: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vibration: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_week_from_monday: Option<bool>,
    #[serde(default, with = "num_opt", skip_serializing_if = "Option::is_none")]
    pub text_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starred_exercises: Option<IndexMap<String, bool>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recent_exercises: Option<IndexMap<String, Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<ITheme>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_bodyweight: Option<IWeight>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affiliate_enabled: Option<bool>,
}

#[cfg(test)]
pub(crate) mod tests;
