//! Port of `liftoscriptFns.ts`: function signatures, arity, argument checks and
//! the value type the evaluator passes around.
//!
//! The TS uses valibot schemas and `v.is`. Here every schema that appears in
//! `liftoscriptFnSignatures` is a small enum and `is_valid_arg` replays what
//! `v.is` does on a dynamic value (valibot `number()` rejects NaN, so a weight
//! whose value is NaN is invalid too).
//!
//! `IScriptFunctions` is the Rust form of the TS callbacks record. The bodies
//! live in `progress.rs` (`Progress_createScriptFunctions`).

use crate::js::js_number_to_string;
use crate::types::{IPercentage, IScriptStaticType, ISettings, IUnit, IWeight, ScriptValue};
use crate::weight;

/// What a Liftoscript expression evaluates to in TS:
/// `number | boolean | IWeight | IPercentage | (IWeight | IPercentage | number | undefined)[]`,
/// plus `undefined` (only `print()` with no arguments yields it).
#[derive(Debug, Clone, PartialEq)]
pub enum EvalValue {
    Undefined,
    Bool(bool),
    Number(f64),
    Weight(IWeight),
    Percentage(IPercentage),
    Array(Vec<Option<ScriptValue>>),
}

impl EvalValue {
    /// JS truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            EvalValue::Undefined => false,
            EvalValue::Bool(b) => *b,
            EvalValue::Number(n) => *n != 0.0 && !n.is_nan(),
            EvalValue::Weight(_) | EvalValue::Percentage(_) | EvalValue::Array(_) => true,
        }
    }

    /// JS string coercion (`${value}` and `String(value)`).
    pub fn to_js_string(&self) -> String {
        match self {
            EvalValue::Undefined => "undefined".to_string(),
            EvalValue::Bool(b) => b.to_string(),
            EvalValue::Number(n) => js_number_to_string(*n),
            EvalValue::Weight(_) | EvalValue::Percentage(_) => "[object Object]".to_string(),
            EvalValue::Array(items) => items
                .iter()
                .map(|i| match i {
                    None => String::new(),
                    Some(ScriptValue::Number(n)) => js_number_to_string(*n),
                    Some(_) => "[object Object]".to_string(),
                })
                .collect::<Vec<_>>()
                .join(","),
        }
    }

    pub fn from_script_value(v: ScriptValue) -> EvalValue {
        match v {
            ScriptValue::Number(n) => EvalValue::Number(n),
            ScriptValue::Weight(w) => EvalValue::Weight(w),
            ScriptValue::Percentage(p) => EvalValue::Percentage(p),
        }
    }

    /// The value as a plain script value (number, weight or percentage), `None`
    /// for booleans, arrays and undefined.
    pub fn as_script_value(&self) -> Option<ScriptValue> {
        match self {
            EvalValue::Number(n) => Some(ScriptValue::Number(*n)),
            EvalValue::Weight(w) => Some(ScriptValue::Weight(*w)),
            EvalValue::Percentage(p) => Some(ScriptValue::Percentage(*p)),
            _ => None,
        }
    }
}

impl From<ScriptValue> for EvalValue {
    fn from(v: ScriptValue) -> Self {
        EvalValue::from_script_value(v)
    }
}

impl From<f64> for EvalValue {
    fn from(n: f64) -> Self {
        EvalValue::Number(n)
    }
}

impl From<IWeight> for EvalValue {
    fn from(w: IWeight) -> Self {
        EvalValue::Weight(w)
    }
}

/// `IScriptFnName`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IScriptFnName {
    RoundWeight,
    RoundConvertWeight,
    CalculateTrainingMax,
    Calculate1RM,
    RpeMultiplier,
    Floor,
    Ceil,
    Round,
    Sum,
    Min,
    Max,
    ZeroOrGte,
    Print,
    Increment,
    Decrement,
    Sets,
}

impl IScriptFnName {
    pub const ALL: [IScriptFnName; 16] = [
        IScriptFnName::RoundWeight,
        IScriptFnName::RoundConvertWeight,
        IScriptFnName::CalculateTrainingMax,
        IScriptFnName::Calculate1RM,
        IScriptFnName::RpeMultiplier,
        IScriptFnName::Floor,
        IScriptFnName::Ceil,
        IScriptFnName::Round,
        IScriptFnName::Sum,
        IScriptFnName::Min,
        IScriptFnName::Max,
        IScriptFnName::ZeroOrGte,
        IScriptFnName::Print,
        IScriptFnName::Increment,
        IScriptFnName::Decrement,
        IScriptFnName::Sets,
    ];

    /// The Liftoscript spelling.
    pub fn name(self) -> &'static str {
        match self {
            IScriptFnName::RoundWeight => "roundWeight",
            IScriptFnName::RoundConvertWeight => "roundConvertWeight",
            IScriptFnName::CalculateTrainingMax => "calculateTrainingMax",
            IScriptFnName::Calculate1RM => "calculate1RM",
            IScriptFnName::RpeMultiplier => "rpeMultiplier",
            IScriptFnName::Floor => "floor",
            IScriptFnName::Ceil => "ceil",
            IScriptFnName::Round => "round",
            IScriptFnName::Sum => "sum",
            IScriptFnName::Min => "min",
            IScriptFnName::Max => "max",
            IScriptFnName::ZeroOrGte => "zeroOrGte",
            IScriptFnName::Print => "print",
            IScriptFnName::Increment => "increment",
            IScriptFnName::Decrement => "decrement",
            IScriptFnName::Sets => "sets",
        }
    }

    pub fn from_name(name: &str) -> Option<IScriptFnName> {
        IScriptFnName::ALL.iter().copied().find(|n| n.name() == name)
    }
}

/// The valibot schemas that appear in the signatures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArgSchema {
    /// `v.number()`
    Number,
    /// `v.union([v.number(), VWeight])`
    NumberOrWeight,
    /// `v.union([v.number(), VWeight, VPercentage])`
    Scalar,
    /// `v.array(v.nullish(numberOrWeight))`
    NumberOrWeightArray,
    /// `v.union([scalar, v.boolean(), v.array(v.nullish(scalar))])`
    Aggregatable,
    /// `v.any()`
    Any,
}

/// `IScriptFnArgSignature` without the schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IScriptFnArgSignature {
    pub name: &'static str,
    pub hint: &'static str,
    pub optional: bool,
}

struct ArgDef {
    name: &'static str,
    schema: ArgSchema,
    hint: &'static str,
    optional: bool,
}

const fn arg(name: &'static str, schema: ArgSchema, hint: &'static str) -> ArgDef {
    ArgDef {
        name,
        schema,
        hint,
        optional: false,
    }
}

const WEIGHT_OR_NUMBER: &str = "a weight or a number";
const SCALAR_HINT: &str = "a number, weight or percentage";
const AGG_HINT: &str = "numbers, weights, percentages or arrays of them";

enum Sig {
    Args(&'static [ArgDef]),
    Variadic(ArgSchema, &'static str),
}

fn signature(name: IScriptFnName) -> Sig {
    use ArgSchema::*;
    match name {
        IScriptFnName::RoundWeight | IScriptFnName::RoundConvertWeight => {
            const A: &[ArgDef] = &[arg("weight", NumberOrWeight, WEIGHT_OR_NUMBER)];
            Sig::Args(A)
        }
        IScriptFnName::CalculateTrainingMax | IScriptFnName::Calculate1RM => {
            const A: &[ArgDef] = &[
                arg("weight", NumberOrWeight, WEIGHT_OR_NUMBER),
                arg("reps", Number, "a number of reps"),
            ];
            Sig::Args(A)
        }
        IScriptFnName::RpeMultiplier => {
            const A: &[ArgDef] = &[
                arg("reps", NumberOrWeight, "a number of reps"),
                ArgDef {
                    name: "rpe",
                    schema: NumberOrWeight,
                    hint: "an RPE value",
                    optional: true,
                },
            ];
            Sig::Args(A)
        }
        IScriptFnName::Floor | IScriptFnName::Ceil | IScriptFnName::Round => {
            const A: &[ArgDef] = &[arg("value", Scalar, SCALAR_HINT)];
            Sig::Args(A)
        }
        IScriptFnName::Sum | IScriptFnName::Min | IScriptFnName::Max => Sig::Variadic(Aggregatable, AGG_HINT),
        IScriptFnName::ZeroOrGte => {
            const A: &[ArgDef] = &[
                arg("values", NumberOrWeightArray, "an array, like 'completedReps'"),
                arg("targets", NumberOrWeightArray, "an array, like 'reps'"),
            ];
            Sig::Args(A)
        }
        IScriptFnName::Print => Sig::Variadic(Any, "any values"),
        IScriptFnName::Increment | IScriptFnName::Decrement => {
            const A: &[ArgDef] = &[arg("value", Scalar, SCALAR_HINT)];
            Sig::Args(A)
        }
        IScriptFnName::Sets => {
            const A: &[ArgDef] = &[
                arg("fromIndex", Number, "a number"),
                arg("toIndex", Number, "a number"),
                arg("minReps", Number, "a number"),
                arg("maxReps", Number, "a number"),
                arg("isAmrap", Number, "a number (0 or 1)"),
                arg("weight", Scalar, "a weight, number or percentage"),
                arg("timer", Number, "a number of seconds"),
                arg("rpe", Number, "a number"),
                arg("shouldLogRpe", Number, "a number (0 or 1)"),
            ];
            Sig::Args(A)
        }
    }
}

/// `LiftoscriptFns_isFnName`
pub fn is_fn_name(name: &str) -> bool {
    IScriptFnName::from_name(name).is_some()
}

/// `LiftoscriptFns_arity`. `max` is `None` for variadic functions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Arity {
    pub min: usize,
    pub max: Option<usize>,
}

pub fn arity(name: IScriptFnName) -> Arity {
    match signature(name) {
        Sig::Variadic(..) => Arity { min: 0, max: None },
        Sig::Args(args) => Arity {
            min: args.iter().filter(|a| !a.optional).count(),
            max: Some(args.len()),
        },
    }
}

/// `LiftoscriptFns_argSignature`
pub fn arg_signature(name: IScriptFnName, index: usize) -> Option<IScriptFnArgSignature> {
    match signature(name) {
        Sig::Variadic(_, hint) => Some(IScriptFnArgSignature {
            name: "values",
            hint,
            optional: false,
        }),
        Sig::Args(args) => args.get(index).map(|a| IScriptFnArgSignature {
            name: a.name,
            hint: a.hint,
            optional: a.optional,
        }),
    }
}

fn weight_valid(w: &IWeight) -> bool {
    !w.value.is_nan()
}

fn pct_valid(p: &IPercentage) -> bool {
    !p.value.is_nan()
}

fn scalar_valid(v: &ScriptValue) -> bool {
    match v {
        ScriptValue::Number(n) => !n.is_nan(),
        ScriptValue::Weight(w) => weight_valid(w),
        ScriptValue::Percentage(p) => pct_valid(p),
    }
}

fn number_or_weight_valid(v: &ScriptValue) -> bool {
    match v {
        ScriptValue::Number(n) => !n.is_nan(),
        ScriptValue::Weight(w) => weight_valid(w),
        ScriptValue::Percentage(_) => false,
    }
}

fn schema_matches(schema: ArgSchema, value: &EvalValue) -> bool {
    match schema {
        ArgSchema::Any => true,
        ArgSchema::Number => matches!(value, EvalValue::Number(n) if !n.is_nan()),
        ArgSchema::NumberOrWeight => value.as_script_value().is_some_and(|v| number_or_weight_valid(&v)),
        ArgSchema::Scalar => value.as_script_value().is_some_and(|v| scalar_valid(&v)),
        ArgSchema::NumberOrWeightArray => match value {
            EvalValue::Array(items) => items.iter().all(|i| i.as_ref().is_none_or(number_or_weight_valid)),
            _ => false,
        },
        ArgSchema::Aggregatable => match value {
            EvalValue::Bool(_) => true,
            EvalValue::Array(items) => items.iter().all(|i| i.as_ref().is_none_or(scalar_valid)),
            other => other.as_script_value().is_some_and(|v| scalar_valid(&v)),
        },
    }
}

/// `LiftoscriptFns_isValidArg`
pub fn is_valid_arg(name: IScriptFnName, index: usize, value: &EvalValue) -> bool {
    match signature(name) {
        Sig::Variadic(schema, _) => schema_matches(schema, value),
        Sig::Args(args) => match args.get(index) {
            None => true,
            Some(a) => {
                if a.optional && matches!(value, EvalValue::Undefined) {
                    return true;
                }
                schema_matches(a.schema, value)
            }
        },
    }
}

/// `LiftoscriptFns_bindingStaticType`: the static type of a binding name, from
/// its schema in `VScriptBindings`. `None` for names that are not bindings.
pub fn binding_static_type(name: &str) -> Option<IScriptStaticType> {
    match name {
        "originalWeights"
        | "weights"
        | "completedWeights"
        | "reps"
        | "minReps"
        | "amraps"
        | "askweights"
        | "logrpes"
        | "timers"
        | "setTime"
        | "completedSetTime"
        | "completedSetTimeLeft"
        | "RPE"
        | "completedRPE"
        | "completedReps"
        | "completedRepsLeft"
        | "isCompleted"
        | "w"
        | "r"
        | "mr"
        | "cr"
        | "cw" => Some(IScriptStaticType::Array),
        "day"
        | "week"
        | "dayInWeek"
        | "ns"
        | "programNumberOfSets"
        | "numberOfSets"
        | "completedNumberOfSets"
        | "setVariationIndex"
        | "exerciseVariationIndex"
        | "descriptionIndex"
        | "setIndex"
        | "readiness"
        | "prs"
        | "soreness"
        | "fatigueLocal"
        | "deload"
        | "recWeightPct"
        | "recSets" => Some(IScriptStaticType::Number),
        "rm1" | "bodyweight" => Some(IScriptStaticType::Weight),
        _ => None,
    }
}

/// `LiftoscriptFns_acceptsTypeAt`
pub fn accepts_type_at(name: IScriptFnName, index: usize, ty: IScriptStaticType) -> bool {
    let w = IWeight {
        value: 1.0,
        unit: IUnit::Lb,
    };
    let p = IPercentage::new(1.0);
    let samples: Vec<EvalValue> = match ty {
        IScriptStaticType::Number => vec![EvalValue::Number(1.0)],
        IScriptStaticType::Weight => vec![EvalValue::Weight(w)],
        IScriptStaticType::Percentage => vec![EvalValue::Percentage(p)],
        IScriptStaticType::Array => vec![
            EvalValue::Array(vec![Some(ScriptValue::Number(1.0))]),
            EvalValue::Array(vec![Some(ScriptValue::Weight(w))]),
            EvalValue::Array(vec![Some(ScriptValue::Percentage(p))]),
            EvalValue::Array(vec![]),
        ],
    };
    samples.iter().any(|s| is_valid_arg(name, index, s))
}

/// The record of callbacks `Progress_createScriptFunctions(settings)` builds.
/// `call` is implemented in `progress.rs`.
#[derive(Debug, Clone, Copy)]
pub struct IScriptFunctions<'a> {
    pub settings: &'a ISettings,
}

/// Printed form of a weight or percentage, `Weight_print`.
pub fn print_script_value(v: &ScriptValue) -> String {
    weight::print(*v)
}
