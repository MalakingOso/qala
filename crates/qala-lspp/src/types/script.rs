//! Script bindings and evaluator update types (`liftoscriptFns.ts`,
//! `liftoscriptEvaluator.ts`, `models/progress.ts`).

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::{IAssignmentOp, IExerciseType, IPercentage, IUnit, IWeight, ScriptValue, WeightOrPct};
use crate::js::{num, num_opt_vec};

fn one() -> f64 {
    1.0
}
fn zero() -> f64 {
    0.0
}

/// `VScriptBindings`: the variables visible to a Liftoscript program. Arrays
/// use `None` for JS `undefined` holes (serialized as `null`). The engine
/// bindings at the end have neutral defaults when absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IScriptBindings {
    #[serde(with = "num")]
    pub day: f64,
    #[serde(with = "num")]
    pub week: f64,
    #[serde(with = "num")]
    pub day_in_week: f64,
    pub completed_weights: Vec<Option<IWeight>>,
    pub original_weights: Vec<WeightOrPct>,
    pub weights: Vec<Option<IWeight>>,
    #[serde(with = "num_opt_vec")]
    pub reps: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub min_reps: Vec<Option<f64>>,
    #[serde(rename = "RPE", with = "num_opt_vec")]
    pub rpe: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub amraps: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub logrpes: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub askweights: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub completed_reps: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub completed_reps_left: Vec<Option<f64>>,
    #[serde(rename = "completedRPE", with = "num_opt_vec")]
    pub completed_rpe: Vec<Option<f64>>,
    /// each element is 0 or 1
    pub is_completed: Vec<u8>,
    #[serde(with = "num_opt_vec")]
    pub timers: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub set_time: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub completed_set_time: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub completed_set_time_left: Vec<Option<f64>>,
    pub w: Vec<Option<IWeight>>,
    #[serde(with = "num_opt_vec")]
    pub r: Vec<Option<f64>>,
    #[serde(with = "num_opt_vec")]
    pub cr: Vec<Option<f64>>,
    pub cw: Vec<Option<IWeight>>,
    #[serde(with = "num_opt_vec")]
    pub mr: Vec<Option<f64>>,
    #[serde(with = "num")]
    pub program_number_of_sets: f64,
    #[serde(with = "num")]
    pub number_of_sets: f64,
    #[serde(with = "num")]
    pub completed_number_of_sets: f64,
    #[serde(with = "num")]
    pub ns: f64,
    #[serde(with = "num")]
    pub set_variation_index: f64,
    #[serde(with = "num")]
    pub exercise_variation_index: f64,
    #[serde(with = "num")]
    pub description_index: f64,
    pub bodyweight: IWeight,
    #[serde(with = "num")]
    pub set_index: f64,
    pub rm1: IWeight,
    /// Derived readiness, 0-1. Default 1.
    #[serde(default = "one", with = "num")]
    pub readiness: f64,
    /// Perceived Recovery Status, 0-10. Default 0.
    #[serde(default = "zero", with = "num")]
    pub prs: f64,
    /// Default 1.
    #[serde(default = "one", with = "num")]
    pub soreness: f64,
    /// Default 0.
    #[serde(default = "zero", with = "num")]
    pub fatigue_local: f64,
    /// 0 none, 1 muscle, 2 systemic. Default 0.
    #[serde(default = "zero", with = "num")]
    pub deload: f64,
    #[serde(default = "zero", with = "num")]
    pub rec_weight_pct: f64,
    #[serde(default = "zero", with = "num")]
    pub rec_sets: f64,
    /// Not part of the TS shape. In TS `Progress_createScriptBindings` makes
    /// `w`, `r`, `mr`, `cr` and `cw` the same arrays as `weights`, `reps`,
    /// `minReps`, `completedReps` and `completedWeights`, so a write to one is
    /// visible through the other until `numberOfSets` is reassigned. When this
    /// flag is set the script code re-copies the short names after each write.
    #[serde(skip)]
    pub aliased: ArrayAliases,
}

/// Flag for [`IScriptBindings::aliased`]. Never affects equality.
#[derive(Debug, Clone, Copy, Default)]
pub struct ArrayAliases(pub bool);

impl PartialEq for ArrayAliases {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

impl IScriptBindings {
    /// Copy `weights`, `reps`, `minReps`, `completedReps` and `completedWeights`
    /// into their short-name aliases when the aliasing flag is on.
    pub fn sync_aliases(&mut self) {
        if self.aliased.0 {
            self.w = self.weights.clone();
            self.r = self.reps.clone();
            self.mr = self.min_reps.clone();
            self.cr = self.completed_reps.clone();
            self.cw = self.completed_weights.clone();
        }
    }
}

/// `IScriptFnContext`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IScriptFnContext {
    pub prints: Vec<Vec<ScriptValue>>,
    pub unit: IUnit,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exercise_type: Option<IExerciseType>,
}

/// `IScriptUpdateContext`
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct IScriptUpdateContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equipment: Option<String>,
}

/// `IScriptStaticType`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IScriptStaticType {
    Number,
    Weight,
    Percentage,
    Array,
}

/// One element of an assignment target: `"*"`, `"_"` or an index.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ITargetIndex {
    Wildcard,
    Underscore,
    Index(f64),
}

impl Serialize for ITargetIndex {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            ITargetIndex::Wildcard => s.serialize_str("*"),
            ITargetIndex::Underscore => s.serialize_str("_"),
            ITargetIndex::Index(n) => num::write(*n, s),
        }
    }
}

impl<'de> Deserialize<'de> for ITargetIndex {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Num(f64),
            Str(String),
        }
        match Raw::deserialize(d)? {
            Raw::Num(n) => Ok(ITargetIndex::Index(n)),
            Raw::Str(s) if s == "*" => Ok(ITargetIndex::Wildcard),
            Raw::Str(s) if s == "_" => Ok(ITargetIndex::Underscore),
            Raw::Str(_) => Err(D::Error::custom("expected \"*\", \"_\" or a number")),
        }
    }
}

/// `ILiftoscriptVariableValue<T>`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ILiftoscriptVariableValue<T> {
    pub value: T,
    pub op: IAssignmentOp,
    pub target: Vec<ITargetIndex>,
}

/// A plain number inside `ILiftoscriptVariableValue`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JsNumber(pub f64);

impl Serialize for JsNumber {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        num::write(self.0, s)
    }
}

impl<'de> Deserialize<'de> for JsNumber {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        num::deserialize(d).map(JsNumber)
    }
}

/// `ILiftoscriptEvaluatorUpdate`: `{ type, value: { value, op, target } }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum ILiftoscriptEvaluatorUpdate {
    #[serde(rename = "setVariationIndex")]
    SetVariationIndex(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "exerciseVariationIndex")]
    ExerciseVariationIndex(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "descriptionIndex")]
    DescriptionIndex(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "reps")]
    Reps(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "minReps")]
    MinReps(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "weights")]
    Weights(ILiftoscriptVariableValue<ScriptValue>),
    #[serde(rename = "timers")]
    Timers(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "setTime")]
    SetTime(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "RPE")]
    Rpe(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "logrpes")]
    Logrpes(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "amraps")]
    Amraps(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "askweights")]
    Askweights(ILiftoscriptVariableValue<JsNumber>),
    #[serde(rename = "numberOfSets")]
    NumberOfSets(ILiftoscriptVariableValue<JsNumber>),
}

impl From<IPercentage> for ILiftoscriptVariableValue<ScriptValue> {
    fn from(p: IPercentage) -> Self {
        ILiftoscriptVariableValue { value: p.into(), op: IAssignmentOp::Assign, target: vec![] }
    }
}
