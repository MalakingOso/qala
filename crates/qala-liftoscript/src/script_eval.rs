//! Port of `liftoscriptEvaluator.ts`. The evaluator walks the generic tree from
//! `script_parse` the same way the TS walks the Lezer tree: `getChildren(node)`
//! is `node.children`, `node.getChild(kind)` is `node.child(kind)`, and a Lezer
//! cursor loop is `node.descendants()` (pre-order).
//!
//! Where the TS would crash on a missing child (a `TypeError` on `undefined`)
//! this port returns the internal "Missing required nodes" error instead.
//!
//! Known gaps against JS: `in` checks on objects also see prototype keys in JS
//! (`"constructor" in {}` is true); here they do not.

#![allow(clippy::result_large_err)]

use indexmap::{IndexMap, IndexSet};

use crate::js::{js_number_to_string, js_parse_float, js_round, js_str_len, js_trunc_len};
use crate::script_fns::{
    accepts_type_at, arg_signature, arity, binding_static_type, is_fn_name, is_valid_arg, EvalValue, IScriptFnName,
    IScriptFunctions,
};
use crate::script_parse::{self, Node, NodeKind};
use crate::types::errors::{IErrorKind, LiftoscriptSyntaxError};
use crate::types::{
    IAssignmentOp, ILiftoscriptEvaluatorUpdate, ILiftoscriptVariableValue, IPercentage, IProgramMode, IProgramState,
    IScriptBindings, IScriptFnContext, IScriptStaticType, ITargetIndex, IUnit, IWeight, JsNumber, ScriptValue,
    WeightOrPct,
};
use crate::util::math;
use crate::weight::{self, UnitOrPct};

pub use crate::script_fns::EvalValue as Value;

/// The TS `NodeName` enum is the parser's `NodeKind`.
pub type NodeName = NodeKind;

pub type SyntaxResult<T> = Result<T, LiftoscriptSyntaxError>;

/// `assert(name)` in the TS: an internal error for a tree that lacks a node the
/// grammar guarantees.
fn assert_err(name: NodeKind) -> LiftoscriptSyntaxError {
    LiftoscriptSyntaxError::new(
        format!("Missing required nodes for {}, this should never happen", name.name()),
        0,
        0,
        0,
        1,
        IErrorKind::Internal {
            node: name.name().to_string(),
        },
    )
}

fn static_type_name(t: IScriptStaticType) -> &'static str {
    match t {
        IScriptStaticType::Number => "number",
        IScriptStaticType::Weight => "weight",
        IScriptStaticType::Percentage => "percentage",
        IScriptStaticType::Array => "array",
    }
}

fn parse_op(s: &str) -> Option<IAssignmentOp> {
    match s {
        "=" => Some(IAssignmentOp::Assign),
        "+=" => Some(IAssignmentOp::AddAssign),
        "-=" => Some(IAssignmentOp::SubAssign),
        "*=" => Some(IAssignmentOp::MulAssign),
        "/=" => Some(IAssignmentOp::DivAssign),
        _ => None,
    }
}

/// An element of a comparison operand: `x ?? 0`.
fn operand_item(v: Option<ScriptValue>) -> ScriptValue {
    v.unwrap_or(ScriptValue::Number(0.0))
}

fn comparator(l: ScriptValue, r: ScriptValue, op: &str) -> bool {
    match op {
        ">" => weight::gt(l, r),
        "<" => weight::lt(l, r),
        ">=" => weight::gte(l, r),
        "<=" => weight::lte(l, r),
        "==" => weight::eq(l, r),
        _ => !weight::eq(l, r),
    }
}

/// `comparing`. Both sides are non-boolean values.
fn comparing(left: &EvalValue, right: &EvalValue, op: &str) -> bool {
    let scalar = |v: &EvalValue| -> ScriptValue { operand_item(v.as_script_value()) };
    match (left, right) {
        (EvalValue::Array(l), EvalValue::Array(r)) => l
            .iter()
            .enumerate()
            .all(|(i, li)| comparator(operand_item(*li), operand_item(r.get(i).copied().flatten()), op)),
        (EvalValue::Array(l), r) => {
            let r = scalar(r);
            l.iter().all(|li| comparator(operand_item(*li), r, op))
        }
        (l, EvalValue::Array(r)) => {
            let l = scalar(l);
            r.iter().all(|ri| comparator(l, operand_item(*ri), op))
        }
        (l, r) => comparator(scalar(l), scalar(r), op),
    }
}

/// `Array.isArray(v) ? v[0] : v`
fn first_of(v: EvalValue) -> EvalValue {
    match v {
        EvalValue::Array(items) => match items.first().copied().flatten() {
            Some(s) => EvalValue::from_script_value(s),
            None => EvalValue::Undefined,
        },
        other => other,
    }
}

/// `Weight_is(v) ? v.value : typeof v === "number" ? v : v ? 1 : 0`
fn number_of(v: &EvalValue) -> f64 {
    match v {
        EvalValue::Weight(w) => w.value,
        EvalValue::Number(n) => *n,
        other => {
            if other.truthy() {
                1.0
            } else {
                0.0
            }
        }
    }
}

/// `Weight_is(v) || Weight_isPct(v) || typeof v === "number" ? v : v ? 1 : 0`
fn state_value_of(v: &EvalValue) -> ScriptValue {
    match v.as_script_value() {
        Some(s) => s,
        None => ScriptValue::Number(if v.truthy() { 1.0 } else { 0.0 }),
    }
}

/// `toNumber`
fn to_number(v: &EvalValue) -> f64 {
    match v {
        EvalValue::Number(n) => *n,
        EvalValue::Bool(_) => 0.0,
        EvalValue::Weight(w) => w.value,
        EvalValue::Percentage(p) => p.value,
        EvalValue::Array(items) => items.first().copied().flatten().map(|s| s.value()).unwrap_or(0.0),
        EvalValue::Undefined => 0.0,
    }
}

/// `arr.slice(0, end)`
fn slice_to<T: Clone>(v: &[T], end: f64) -> Vec<T> {
    v[..js_trunc_len(end, v.len())].to_vec()
}

/// Most sets one exercise may have (the owner: more than 30 is unreasonable). TS has no limit (JS arrays are sparse and
/// the heap would give out first); a dense `Vec` here would allocate tens of GB
/// for `numberOfSets = 1e9`, so past this the script gets an error instead.
pub const MAX_SETS: f64 = 30.0;

/// `arr[i] = value`, leaving holes (`pad`) when `i` is past the end. Writes past
/// `MAX_SETS` are dropped rather than padding a dense `Vec` out to a huge index.
fn set_at<T: Clone>(v: &mut Vec<T>, i: usize, value: T, pad: T) {
    if i as f64 >= MAX_SETS {
        return;
    }
    while v.len() <= i {
        v.push(pad.clone());
    }
    v[i] = value;
}

fn opt_num(v: Option<ScriptValue>) -> Option<f64> {
    v.map(|s| s.value())
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Idx {
    Star,
    Num(f64),
}

impl Idx {
    fn target(self) -> ITargetIndex {
        match self {
            Idx::Star => ITargetIndex::Wildcard,
            Idx::Num(n) => ITargetIndex::Index(n),
        }
    }
    fn matches(self, n: f64) -> bool {
        match self {
            Idx::Star => true,
            Idx::Num(i) => i == n,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpdateKey {
    Reps,
    Weights,
    Timers,
    SetTime,
    Rpe,
    MinReps,
    SetVariationIndex,
    ExerciseVariationIndex,
    DescriptionIndex,
    NumberOfSets,
    Logrpes,
    Amraps,
    Askweights,
}

impl UpdateKey {
    fn from_name(name: &str) -> Option<UpdateKey> {
        Some(match name {
            "reps" => UpdateKey::Reps,
            "weights" => UpdateKey::Weights,
            "timers" => UpdateKey::Timers,
            "setTime" => UpdateKey::SetTime,
            "RPE" => UpdateKey::Rpe,
            "minReps" => UpdateKey::MinReps,
            "setVariationIndex" => UpdateKey::SetVariationIndex,
            "exerciseVariationIndex" => UpdateKey::ExerciseVariationIndex,
            "descriptionIndex" => UpdateKey::DescriptionIndex,
            "numberOfSets" => UpdateKey::NumberOfSets,
            "logrpes" => UpdateKey::Logrpes,
            "amraps" => UpdateKey::Amraps,
            "askweights" => UpdateKey::Askweights,
            _ => return None,
        })
    }

    fn name(self) -> &'static str {
        match self {
            UpdateKey::Reps => "reps",
            UpdateKey::Weights => "weights",
            UpdateKey::Timers => "timers",
            UpdateKey::SetTime => "setTime",
            UpdateKey::Rpe => "RPE",
            UpdateKey::MinReps => "minReps",
            UpdateKey::SetVariationIndex => "setVariationIndex",
            UpdateKey::ExerciseVariationIndex => "exerciseVariationIndex",
            UpdateKey::DescriptionIndex => "descriptionIndex",
            UpdateKey::NumberOfSets => "numberOfSets",
            UpdateKey::Logrpes => "logrpes",
            UpdateKey::Amraps => "amraps",
            UpdateKey::Askweights => "askweights",
        }
    }

    fn update(self, value: ScriptValue, op: IAssignmentOp, target: Vec<ITargetIndex>) -> ILiftoscriptEvaluatorUpdate {
        let n = || ILiftoscriptVariableValue {
            value: JsNumber(value.value()),
            op,
            target: target.clone(),
        };
        match self {
            UpdateKey::Weights => ILiftoscriptEvaluatorUpdate::Weights(ILiftoscriptVariableValue {
                value,
                op,
                target: target.clone(),
            }),
            UpdateKey::Reps => ILiftoscriptEvaluatorUpdate::Reps(n()),
            UpdateKey::Timers => ILiftoscriptEvaluatorUpdate::Timers(n()),
            UpdateKey::SetTime => ILiftoscriptEvaluatorUpdate::SetTime(n()),
            UpdateKey::Rpe => ILiftoscriptEvaluatorUpdate::Rpe(n()),
            UpdateKey::MinReps => ILiftoscriptEvaluatorUpdate::MinReps(n()),
            UpdateKey::SetVariationIndex => ILiftoscriptEvaluatorUpdate::SetVariationIndex(n()),
            UpdateKey::ExerciseVariationIndex => ILiftoscriptEvaluatorUpdate::ExerciseVariationIndex(n()),
            UpdateKey::DescriptionIndex => ILiftoscriptEvaluatorUpdate::DescriptionIndex(n()),
            UpdateKey::NumberOfSets => ILiftoscriptEvaluatorUpdate::NumberOfSets(n()),
            UpdateKey::Logrpes => ILiftoscriptEvaluatorUpdate::Logrpes(n()),
            UpdateKey::Amraps => ILiftoscriptEvaluatorUpdate::Amraps(n()),
            UpdateKey::Askweights => ILiftoscriptEvaluatorUpdate::Askweights(n()),
        }
    }
}

/// The names `name in this.bindings` is true for.
pub fn is_binding_name(name: &str) -> bool {
    binding_static_type(name).is_some()
}

/// `validNames` in `parse` (the bindings that accept an index).
fn is_indexable_binding(name: &str) -> bool {
    matches!(
        name,
        "originalWeights"
            | "weights"
            | "reps"
            | "minReps"
            | "completedReps"
            | "completedRepsLeft"
            | "completedWeights"
            | "timers"
            | "setTime"
            | "completedSetTime"
            | "completedSetTimeLeft"
            | "w"
            | "r"
            | "cr"
            | "cw"
            | "mr"
            | "completedRPE"
            | "bodyweight"
            | "RPE"
            | "setVariationIndex"
            | "exerciseVariationIndex"
            | "descriptionIndex"
            | "numberOfSets"
            | "programNumberOfSets"
            | "completedNumberOfSets"
            | "amraps"
            | "logrpes"
            | "askweights"
    )
}

enum BindingVal {
    Scalar(EvalValue),
    Array(Vec<Option<ScriptValue>>),
}

fn nums(v: &[Option<f64>]) -> BindingVal {
    BindingVal::Array(v.iter().map(|x| x.map(ScriptValue::Number)).collect())
}

fn weights(v: &[Option<IWeight>]) -> BindingVal {
    BindingVal::Array(v.iter().map(|x| x.map(ScriptValue::Weight)).collect())
}

fn binding_value(b: &IScriptBindings, name: &str) -> Option<BindingVal> {
    use BindingVal::Scalar;
    let n = |x: f64| Scalar(EvalValue::Number(x));
    Some(match name {
        "day" => n(b.day),
        "week" => n(b.week),
        "dayInWeek" => n(b.day_in_week),
        "originalWeights" => BindingVal::Array(b.original_weights.iter().map(|x| Some((*x).into())).collect()),
        "weights" => weights(&b.weights),
        "completedWeights" => weights(&b.completed_weights),
        "rm1" => Scalar(EvalValue::Weight(b.rm1)),
        "reps" => nums(&b.reps),
        "minReps" => nums(&b.min_reps),
        "amraps" => nums(&b.amraps),
        "askweights" => nums(&b.askweights),
        "logrpes" => nums(&b.logrpes),
        "timers" => nums(&b.timers),
        "setTime" => nums(&b.set_time),
        "completedSetTime" => nums(&b.completed_set_time),
        "completedSetTimeLeft" => nums(&b.completed_set_time_left),
        "RPE" => nums(&b.rpe),
        "completedRPE" => nums(&b.completed_rpe),
        "completedReps" => nums(&b.completed_reps),
        "completedRepsLeft" => nums(&b.completed_reps_left),
        "isCompleted" => BindingVal::Array(
            b.is_completed
                .iter()
                .map(|x| Some(ScriptValue::Number(f64::from(*x))))
                .collect(),
        ),
        "w" => weights(&b.w),
        "r" => nums(&b.r),
        "mr" => nums(&b.mr),
        "cr" => nums(&b.cr),
        "cw" => weights(&b.cw),
        "ns" => n(b.ns),
        "programNumberOfSets" => n(b.program_number_of_sets),
        "numberOfSets" => n(b.number_of_sets),
        "completedNumberOfSets" => n(b.completed_number_of_sets),
        "setVariationIndex" => n(b.set_variation_index),
        "exerciseVariationIndex" => n(b.exercise_variation_index),
        "bodyweight" => Scalar(EvalValue::Weight(b.bodyweight)),
        "descriptionIndex" => n(b.description_index),
        "setIndex" => n(b.set_index),
        "readiness" => n(b.readiness),
        "prs" => n(b.prs),
        "soreness" => n(b.soreness),
        "fatigueLocal" => n(b.fatigue_local),
        "deload" => n(b.deload),
        "recWeightPct" => n(b.rec_weight_pct),
        "recSets" => n(b.rec_sets),
        _ => return None,
    })
}

fn num_array_mut(b: &mut IScriptBindings, key: UpdateKey) -> Option<&mut Vec<Option<f64>>> {
    Some(match key {
        UpdateKey::Reps => &mut b.reps,
        UpdateKey::MinReps => &mut b.min_reps,
        UpdateKey::Rpe => &mut b.rpe,
        UpdateKey::Timers => &mut b.timers,
        UpdateKey::SetTime => &mut b.set_time,
        UpdateKey::Logrpes => &mut b.logrpes,
        UpdateKey::Amraps => &mut b.amraps,
        UpdateKey::Askweights => &mut b.askweights,
        _ => return None,
    })
}

/// Where an assignment to a state variable lands.
enum StateSel {
    Own,
    Other(String),
    Missing,
}

pub struct LiftoscriptEvaluator<'a> {
    script: &'a str,
    state: &'a mut IProgramState,
    other_states: &'a mut IndexMap<String, IProgramState>,
    bindings: &'a mut IScriptBindings,
    fns: &'a IScriptFunctions<'a>,
    fn_context: &'a mut IScriptFnContext,
    unit: IUnit,
    mode: IProgramMode,
    vars: IProgramState,
    pub updates: Vec<ILiftoscriptEvaluatorUpdate>,
}

impl<'a> LiftoscriptEvaluator<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        script: &'a str,
        state: &'a mut IProgramState,
        other_states: &'a mut IndexMap<String, IProgramState>,
        bindings: &'a mut IScriptBindings,
        fns: &'a IScriptFunctions<'a>,
        fn_context: &'a mut IScriptFnContext,
        unit: IUnit,
        mode: IProgramMode,
    ) -> Self {
        LiftoscriptEvaluator {
            script,
            state,
            other_states,
            bindings,
            fns,
            fn_context,
            unit,
            mode,
            vars: IndexMap::new(),
            updates: Vec::new(),
        }
    }

    /// `LiftoscriptEvaluator.getValue`: the node text with newlines and tabs escaped.
    pub fn get_value(script: &str, node: &Node) -> String {
        script_parse::get_value(script, node)
            .replace('\n', "\\n")
            .replace('\t', "\\t")
    }

    fn value_of(&self, node: &Node) -> String {
        Self::get_value(self.script, node)
    }

    fn error(&self, message: &str, node: &Node, details: IErrorKind) -> LiftoscriptSyntaxError {
        let (line, offset) = self.get_line_and_offset(node);
        LiftoscriptSyntaxError::new(
            format!("{} ({}:{})", message, line, offset),
            line,
            offset,
            node.from as i64,
            node.to as i64,
            details,
        )
    }

    fn get_line_and_offset(&self, node: &Node) -> (i64, i64) {
        let lengths: Vec<i64> = self.script.split('\n').map(|l| js_str_len(l) as i64 + 1).collect();
        let from = node.from as i64;
        let mut offset = 0i64;
        for (i, len) in lengths.iter().enumerate() {
            if from > offset && from < offset + len {
                return (i as i64 + 1, from - offset);
            }
            offset += len;
        }
        (lengths.len() as i64, lengths[lengths.len() - 1])
    }

    fn static_type_of_node(&self, node: &Node) -> Option<IScriptStaticType> {
        match node.kind {
            NodeKind::NumberExpression => Some(IScriptStaticType::Number),
            NodeKind::WeightExpression => Some(IScriptStaticType::Weight),
            NodeKind::Percentage => Some(IScriptStaticType::Percentage),
            NodeKind::VariableExpression => {
                if !node.children_of(NodeKind::VariableIndex).is_empty() {
                    return None;
                }
                let name = node.child(NodeKind::Keyword).map(|n| self.value_of(n))?;
                binding_static_type(&name)
            }
            _ => None,
        }
    }

    fn validate_fn_arg(&self, name: IScriptFnName, index: usize, node: &Node, value: &EvalValue) -> SyntaxResult<()> {
        if is_valid_arg(name, index, value) {
            return Ok(());
        }
        if matches!(value, EvalValue::Array(_)) && !accepts_type_at(name, index, IScriptStaticType::Array) {
            let arg_text = self.value_of(node);
            return Err(self.error(
                &format!(
                    "Function '{}' doesn't accept arrays. Use an index to pick one value, like '{}[1]'",
                    name.name(),
                    arg_text
                ),
                node,
                IErrorKind::FnArrayArgument {
                    r#fn: name.name().to_string(),
                    arg_text,
                },
            ));
        }
        let sig = arg_signature(name, index);
        let printed = match value {
            EvalValue::Weight(w) => weight::print(*w),
            EvalValue::Percentage(p) => weight::print(*p),
            EvalValue::Array(_) => "an array".to_string(),
            other => other.to_js_string(),
        };
        let arg_name = sig.map(|s| s.name.to_string());
        let hint = sig.map(|s| s.hint.to_string());
        Err(self.error(
            &format!(
                "Argument {} ({}) of '{}' should be {}, but got {}",
                index + 1,
                arg_name.clone().unwrap_or_else(|| "undefined".to_string()),
                name.name(),
                hint.clone().unwrap_or_else(|| "undefined".to_string()),
                printed
            ),
            node,
            IErrorKind::FnArgumentType {
                r#fn: name.name().to_string(),
                index: index as i64,
                arg_name,
                hint,
                got: printed,
            },
        ))
    }

    /// `hasKeyword`
    pub fn has_keyword(&self, expr: &Node, name: &str) -> bool {
        expr.descendants()
            .iter()
            .any(|n| n.kind == NodeKind::Keyword && self.value_of(n) == name)
    }

    fn get_weight(&mut self, expr: Option<&Node>) -> SyntaxResult<Option<IWeight>> {
        let Some(expr) = expr else { return Ok(None) };
        if expr.kind != NodeKind::WeightExpression {
            return Ok(None);
        }
        let number_node = expr.child(NodeKind::NumberExpression);
        let unit_node = expr.child(NodeKind::Unit);
        let (Some(number_node), Some(unit_node)) = (number_node, unit_node) else {
            return Err(assert_err(NodeKind::WeightExpression));
        };
        let num = match self.evaluate(number_node)? {
            EvalValue::Number(n) => n,
            _ => {
                return Err(self.error(
                    "WeightExpression must contain a number",
                    number_node,
                    IErrorKind::MalformedWeight,
                ))
            }
        };
        let unit = if self.value_of(unit_node) == "kg" {
            IUnit::Kg
        } else {
            IUnit::Lb
        };
        Ok(Some(weight::build(num, unit)))
    }

    /// `switchWeightsToUnit`
    pub fn switch_weights_to_unit(&mut self, program_node: &Node, to_unit: IUnit) -> SyntaxResult<String> {
        let mut script: Vec<u16> = self.script.encode_utf16().collect();
        let mut shift: i64 = 0;
        for node in program_node.descendants() {
            if node.kind != NodeKind::WeightExpression {
                continue;
            }
            if let Some(w) = self.get_weight(Some(node))? {
                if w.unit != to_unit {
                    let old_str: Vec<u16> = weight::print(w).encode_utf16().collect();
                    let new_str: Vec<u16> = weight::print(weight::smart_convert(w, to_unit))
                        .encode_utf16()
                        .collect();
                    let head = ((node.from as i64 + shift).max(0) as usize).min(script.len());
                    let tail = ((node.to as i64 + shift).max(0) as usize).min(script.len());
                    let mut next: Vec<u16> = script[..head].to_vec();
                    next.extend_from_slice(&new_str);
                    next.extend_from_slice(&script[tail..]);
                    script = next;
                    shift += new_str.len() as i64 - old_str.len() as i64;
                }
            }
        }
        Ok(String::from_utf16_lossy(&script))
    }

    /// `getStateVariableKeys`
    pub fn get_state_variable_keys(&self, expr: &Node) -> IndexSet<String> {
        let mut keys = IndexSet::new();
        for node in expr.descendants() {
            if node.kind == NodeKind::StateVariable {
                if let Some(k) = self.get_state_key(node) {
                    keys.insert(k);
                }
            }
        }
        keys
    }

    fn get_state_key(&self, expr: &Node) -> Option<String> {
        if expr.child(NodeKind::StateVariableIndex).is_none() {
            return expr.child(NodeKind::Keyword).map(|n| self.value_of(n));
        }
        None
    }

    /// `parse`: static checks over the whole tree. Evaluation assumes this passed.
    pub fn parse(&mut self, expr: &Node) -> SyntaxResult<()> {
        let mut vars: IndexSet<String> = IndexSet::new();
        for node in expr.descendants() {
            if node.is_error() {
                return Err(self.error("Syntax error", node, IErrorKind::Parse));
            }
            match node.kind {
                NodeKind::BuiltinFunctionExpression => self.parse_builtin(node)?,
                NodeKind::ForExpression => {
                    if let Some(v) = node.child(NodeKind::Variable) {
                        vars.insert(self.value_of(v));
                    }
                }
                NodeKind::AssignmentExpression => {
                    let Some(variable_node) = node.children.first() else {
                        continue;
                    };
                    if variable_node.kind == NodeKind::Variable {
                        vars.insert(self.value_of(variable_node));
                    } else if variable_node.kind == NodeKind::VariableExpression {
                        if let Some(name_node) = variable_node.child(NodeKind::Keyword) {
                            let name = self.value_of(name_node);
                            if self.mode == IProgramMode::Update {
                                if !matches!(
                                    name.as_str(),
                                    "reps"
                                        | "weights"
                                        | "RPE"
                                        | "minReps"
                                        | "numberOfSets"
                                        | "timers"
                                        | "setTime"
                                        | "askweights"
                                        | "amraps"
                                        | "logrpes"
                                ) {
                                    return Err(self.error(
                                        &format!("Cannot assign to '{}'", name),
                                        variable_node,
                                        IErrorKind::ReadonlyVariable { name },
                                    ));
                                }
                                let index_count = variable_node.children_of(NodeKind::VariableIndex).len();
                                if name == "numberOfSets" && index_count > 0 {
                                    return Err(self.error(
                                        &format!("{} is not an array", name),
                                        variable_node,
                                        IErrorKind::NotAnArray { name },
                                    ));
                                } else if index_count > 1 {
                                    return Err(self.error(
                                        "Can't assign to set variations, weeks or days here",
                                        variable_node,
                                        IErrorKind::IndexNotAssignableHere { name },
                                    ));
                                }
                            }
                        }
                    }
                }
                NodeKind::StateVariable => {
                    if let Some(state_key) = self.get_state_key(node) {
                        if !self.state.contains_key(&state_key) {
                            return Err(self.error(
                                &format!("There's no state variable '{}'", state_key),
                                node,
                                IErrorKind::UnknownStateVariable { state_key },
                            ));
                        }
                    }
                }
                NodeKind::Variable => {
                    let key = self.value_of(node);
                    if !vars.contains(&key) {
                        return Err(self.error(
                            &format!("There's no variable '{}'", key),
                            node,
                            IErrorKind::UnknownVariable { name: key },
                        ));
                    }
                }
                NodeKind::VariableExpression => {
                    let Some(name_node) = node.children.first() else {
                        return Err(assert_err(NodeKind::VariableExpression));
                    };
                    let name = self.value_of(name_node);
                    if node.children.get(1).is_some() {
                        if !is_indexable_binding(&name) {
                            return Err(self.error(
                                &format!("{} is not an array variable", name),
                                name_node,
                                IErrorKind::NotAnArray { name },
                            ));
                        }
                    } else if !is_binding_name(&name) {
                        return Err(self.error(
                            &format!("{} is not a valid variable", name),
                            name_node,
                            IErrorKind::UnknownVariable { name },
                        ));
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn parse_builtin(&self, node: &Node) -> SyntaxResult<()> {
        let keyword = match node.children.first() {
            Some(k) if k.kind == NodeKind::Keyword => k,
            _ => return Err(assert_err(NodeKind::BuiltinFunctionExpression)),
        };
        let fn_args = &node.children[1..];
        let name_str = self.value_of(keyword);
        let Some(name) = IScriptFnName::from_name(&name_str) else {
            return Err(self.error(
                &format!("Unknown function '{}'", name_str),
                keyword,
                IErrorKind::UnknownFunction { name: name_str },
            ));
        };
        let ar = arity(name);
        if fn_args.len() < ar.min || ar.max.is_some_and(|m| fn_args.len() > m) {
            let expected = match ar.max {
                Some(m) if m != ar.min => format!("{}-{}", ar.min, m),
                _ => format!("{}", ar.min),
            };
            return Err(self.error(
                &format!(
                    "Function '{}' expects {} argument{}, but got {}",
                    name.name(),
                    expected,
                    if ar.max == Some(1) { "" } else { "s" },
                    fn_args.len()
                ),
                keyword,
                IErrorKind::FnArity {
                    r#fn: name.name().to_string(),
                    expected,
                    got: fn_args.len() as i64,
                },
            ));
        }
        for (index, fn_arg) in fn_args.iter().enumerate() {
            let Some(static_type) = self.static_type_of_node(fn_arg) else {
                continue;
            };
            if accepts_type_at(name, index, static_type) {
                continue;
            }
            if static_type == IScriptStaticType::Array {
                let arg_text = self.value_of(fn_arg);
                return Err(self.error(
                    &format!(
                        "Function '{}' doesn't accept arrays, and '{}' is an array. Use an index to pick one value, like '{}[1]'",
                        name.name(),
                        arg_text,
                        arg_text
                    ),
                    fn_arg,
                    IErrorKind::FnArrayArgument { r#fn: name.name().to_string(), arg_text },
                ));
            }
            let sig = arg_signature(name, index);
            let arg_name = sig.map(|s| s.name.to_string());
            let hint = sig.map(|s| s.hint.to_string());
            return Err(self.error(
                &format!(
                    "Argument {} ({}) of '{}' should be {}, but '{}' is a {}",
                    index + 1,
                    arg_name.clone().unwrap_or_else(|| "undefined".to_string()),
                    name.name(),
                    hint.clone().unwrap_or_else(|| "undefined".to_string()),
                    self.value_of(fn_arg),
                    static_type_name(static_type)
                ),
                fn_arg,
                IErrorKind::FnArgumentType {
                    r#fn: name.name().to_string(),
                    index: index as i64,
                    arg_name,
                    hint,
                    got: static_type_name(static_type).to_string(),
                },
            ));
        }
        Ok(())
    }

    /// `LiftoscriptEvaluator.changeWeightsToCompleteWeights`
    pub fn change_weights_to_complete_weights(old_script: &str) -> String {
        let tree = script_parse::parse(old_script);
        let mut script: Vec<u16> = old_script.encode_utf16().collect();
        let mut shift: i64 = 0;
        for (node, parent) in tree.descendants_with_parent() {
            if node.kind != NodeKind::VariableExpression {
                continue;
            }
            let Some(keyword_node) = node.child(NodeKind::Keyword) else {
                continue;
            };
            if Self::get_value(old_script, keyword_node) != "weights" {
                continue;
            }
            let Some(parent) = parent else { continue };
            let is_target = matches!(
                parent.kind,
                NodeKind::AssignmentExpression | NodeKind::IncAssignmentExpression
            ) && parent
                .first_child()
                .is_some_and(|f| f.from == node.from && f.to == node.to);
            if is_target {
                continue;
            }
            let new_str: Vec<u16> = "completedWeights".encode_utf16().collect();
            let head = ((keyword_node.from as i64 + shift).max(0) as usize).min(script.len());
            let tail = ((keyword_node.to as i64 + shift).max(0) as usize).min(script.len());
            let mut next: Vec<u16> = script[..head].to_vec();
            next.extend_from_slice(&new_str);
            next.extend_from_slice(&script[tail..]);
            script = next;
            shift += new_str.len() as i64 - "weights".len() as i64;
        }
        String::from_utf16_lossy(&script)
    }

    fn evaluate_to_number(&mut self, expr: &Node) -> SyntaxResult<f64> {
        let v = first_of(self.evaluate(expr)?);
        Ok(number_of(&v))
    }

    fn evaluate_to_number_or_weight_or_percentage(&mut self, expr: &Node) -> SyntaxResult<ScriptValue> {
        let v = first_of(self.evaluate(expr)?);
        Ok(match v {
            EvalValue::Weight(w) => ScriptValue::Weight(w),
            EvalValue::Percentage(p) => ScriptValue::Percentage(p),
            EvalValue::Number(n) => ScriptValue::Number(n),
            other => ScriptValue::Number(if other.truthy() { 1.0 } else { 0.0 }),
        })
    }

    fn call_fn(&mut self, name: IScriptFnName, args: &[EvalValue]) -> EvalValue {
        let fns = self.fns;
        fns.call(name, args, self.fn_context, self.bindings)
    }

    fn change_number_of_sets(&mut self, expression: &Node, op: IAssignmentOp) -> SyntaxResult<EvalValue> {
        let old_number_of_sets = self.bindings.weights.len();
        let current = self.bindings.number_of_sets;
        let evaluated = math::apply_op(current, self.evaluate_to_number(expression)?, op);
        if evaluated > MAX_SETS {
            return Err(self.error(
                &format!("numberOfSets cannot be more than {}", MAX_SETS),
                expression,
                IErrorKind::Internal {
                    node: "numberOfSets".to_string(),
                },
            ));
        }

        let b = &mut *self.bindings;
        b.weights = slice_to(&b.weights, evaluated);
        b.original_weights = slice_to(&b.original_weights, evaluated);
        b.reps = slice_to(&b.reps, evaluated);
        b.min_reps = slice_to(&b.min_reps, evaluated);
        b.rpe = slice_to(&b.rpe, evaluated);
        b.w = slice_to(&b.weights, evaluated);
        b.r = slice_to(&b.reps, evaluated);
        b.mr = slice_to(&b.min_reps, evaluated);
        b.timers = slice_to(&b.timers, evaluated);
        b.set_time = slice_to(&b.set_time, evaluated);
        b.amraps = slice_to(&b.amraps, evaluated);
        b.logrpes = slice_to(&b.logrpes, evaluated);
        b.askweights = slice_to(&b.askweights, evaluated);
        b.completed_reps = slice_to(&b.completed_reps, evaluated);
        b.completed_reps_left = slice_to(&b.completed_reps_left, evaluated);
        b.cr = slice_to(&b.cr, evaluated);
        b.cw = slice_to(&b.cw, evaluated);
        b.completed_weights = slice_to(&b.completed_weights, evaluated);
        b.completed_rpe = slice_to(&b.completed_rpe, evaluated);
        b.is_completed = slice_to(&b.is_completed, evaluated);

        let ns = old_number_of_sets as i64 - 1;
        let mut i: usize = 0;
        while (i as f64) < evaluated {
            if (i as i64) > ns {
                let at = |len: usize| -> Option<usize> {
                    if ns >= 0 && (ns as usize) < len {
                        Some(ns as usize)
                    } else {
                        None
                    }
                };
                let w_ns = at(b.weights.len()).and_then(|k| b.weights[k]);
                let new_weight = weight::build(
                    w_ns.map(|w| w.value).unwrap_or(0.0),
                    w_ns.map(|w| w.unit).unwrap_or(IUnit::Lb),
                );
                set_at(&mut b.weights, i, Some(new_weight), None);
                let ow_ns = at(b.original_weights.len()).map(|k| b.original_weights[k]);
                let (ov, ou) = match ow_ns {
                    Some(WeightOrPct::Weight(w)) => (w.value, UnitOrPct::Unit(w.unit)),
                    Some(WeightOrPct::Percentage(p)) => (p.value, UnitOrPct::Percent),
                    None => (0.0, UnitOrPct::Unit(IUnit::Lb)),
                };
                set_at(
                    &mut b.original_weights,
                    i,
                    weight::build_any(ov, ou),
                    WeightOrPct::Weight(weight::ZERO),
                );
                let reps_ns = at(b.reps.len()).and_then(|k| b.reps[k]);
                set_at(&mut b.reps, i, Some(reps_ns.unwrap_or(0.0)), None);
                let v = at(b.timers.len()).and_then(|k| b.timers[k]);
                set_at(&mut b.timers, i, v, None);
                let v = at(b.set_time.len()).and_then(|k| b.set_time[k]);
                set_at(&mut b.set_time, i, v, None);
                let v = at(b.amraps.len()).and_then(|k| b.amraps[k]);
                set_at(&mut b.amraps, i, v, None);
                let v = at(b.logrpes.len()).and_then(|k| b.logrpes[k]);
                set_at(&mut b.logrpes, i, v, None);
                let v = at(b.askweights.len()).and_then(|k| b.askweights[k]);
                set_at(&mut b.askweights, i, v, None);
                let v = at(b.min_reps.len()).and_then(|k| b.min_reps[k]);
                set_at(&mut b.min_reps, i, v, None);
                let v = at(b.rpe.len()).and_then(|k| b.rpe[k]);
                set_at(&mut b.rpe, i, v, None);
                let v = b.weights.get(i).copied().flatten();
                set_at(&mut b.w, i, v, None);
                let v = b.reps.get(i).copied().flatten();
                set_at(&mut b.r, i, v, None);
                let v = b.min_reps.get(i).copied().flatten();
                set_at(&mut b.mr, i, v, None);
                set_at(&mut b.completed_reps, i, None, None);
                set_at(&mut b.completed_reps_left, i, None, None);
                set_at(&mut b.completed_weights, i, None, None);
                set_at(&mut b.completed_rpe, i, None, None);
                set_at(&mut b.cr, i, None, None);
                set_at(&mut b.cw, i, None, None);
                set_at(&mut b.is_completed, i, 0, 0);
            }
            i += 1;
        }

        b.number_of_sets = evaluated;
        b.ns = evaluated;
        b.aliased.0 = false;
        Ok(EvalValue::Number(evaluated))
    }

    fn index_nodes<'n>(index_exprs: &[&'n Node]) -> Vec<Option<&'n Node>> {
        index_exprs.iter().map(|ie| ie.children.first()).collect()
    }

    fn change_binding(
        &mut self,
        key: UpdateKey,
        expression: &Node,
        index_exprs: &[&Node],
        op: IAssignmentOp,
    ) -> SyntaxResult<EvalValue> {
        let indexes = Self::index_nodes(index_exprs);
        if indexes.len() > 1 {
            return Err(self.error(
                &format!("{} can only have 1 value inside []", key.name()),
                expression,
                IErrorKind::TooManyIndexes {
                    key: key.name().to_string(),
                    max: 1,
                },
            ));
        }
        let index_values = self.calculate_index_values(&indexes)?;
        let normalized = Self::normalize_target(index_values, 1);
        let set_index = normalized[0];
        let mut result = EvalValue::Number(0.0);
        if key == UpdateKey::Weights {
            let mut i = 0;
            while i < self.bindings.weights.len() {
                let completed = self.bindings.is_completed.get(i).copied().unwrap_or(0) != 0;
                if !completed && set_index.matches(i as f64 + 1.0) {
                    let evaluated = self.evaluate_to_number_or_weight_or_percentage(expression)?;
                    let old = self
                        .bindings
                        .weights
                        .get(i)
                        .copied()
                        .flatten()
                        .unwrap_or(weight::build(0.0, self.unit));
                    let new_value = weight::apply_op(Some(self.bindings.rm1), old, evaluated, op);
                    let value = weight::convert_to_weight(self.bindings.rm1, new_value, self.unit);
                    set_at(
                        &mut self.bindings.original_weights,
                        i,
                        WeightOrPct::Weight(value),
                        WeightOrPct::Weight(weight::ZERO),
                    );
                    let rounded = self.call_fn(IScriptFnName::RoundWeight, &[EvalValue::Weight(value)]);
                    let rounded = match rounded {
                        EvalValue::Weight(w) => Some(w),
                        _ => None,
                    };
                    set_at(&mut self.bindings.weights, i, rounded, None);
                    result = EvalValue::Weight(value);
                }
                i += 1;
            }
        } else {
            let mut i = 0;
            while i < num_array_mut(self.bindings, key).map(|a| a.len()).unwrap_or(0) {
                let completed = self.bindings.is_completed.get(i).copied().unwrap_or(0) != 0;
                if !completed && set_index.matches(i as f64 + 1.0) {
                    let evaluated = self.evaluate_to_number(expression)?;
                    let old = num_array_mut(self.bindings, key).and_then(|a| a[i]).unwrap_or(0.0);
                    let mut value = math::apply_op(old, evaluated, op);
                    if key == UpdateKey::Rpe {
                        value = math::round(math::clamp(value, Some(0.0), Some(10.0)), 0.5);
                    }
                    if matches!(key, UpdateKey::Amraps | UpdateKey::Logrpes | UpdateKey::Askweights) {
                        value = js_round(math::clamp(value, Some(0.0), Some(1.0)));
                    }
                    if let Some(arr) = num_array_mut(self.bindings, key) {
                        set_at(arr, i, Some(value), None);
                    }
                    result = EvalValue::Number(value);
                }
                i += 1;
            }
        }
        self.bindings.sync_aliases();
        Ok(result)
    }

    fn record_variable_update(
        &mut self,
        key: UpdateKey,
        expression: &Node,
        index_exprs: &[&Node],
        op: IAssignmentOp,
    ) -> SyntaxResult<EvalValue> {
        let indexes = Self::index_nodes(index_exprs);
        let (max_target_length, label): (usize, String) = match key {
            UpdateKey::SetVariationIndex | UpdateKey::ExerciseVariationIndex | UpdateKey::DescriptionIndex => {
                (2, format!("{} can only have 2 values inside [*:*]", key.name()))
            }
            UpdateKey::NumberOfSets => (3, "numberOfSets can only have 3 values inside [*:*:*]".to_string()),
            _ => (4, format!("{} can only have 4 values inside [*:*:*:*]", key.name())),
        };
        if indexes.len() > max_target_length {
            return Err(self.error(
                &label,
                expression,
                IErrorKind::TooManyIndexes {
                    key: key.name().to_string(),
                    max: max_target_length as i64,
                },
            ));
        }
        let index_values = self.calculate_index_values(&indexes)?;
        let normalized = Self::normalize_target(index_values, max_target_length);
        let target: Vec<ITargetIndex> = normalized.iter().map(|i| i.target()).collect();
        if key == UpdateKey::Weights {
            let result = self.evaluate_to_number_or_weight_or_percentage(expression)?;
            self.updates.push(key.update(result, op, target));
            return Ok(EvalValue::from_script_value(result));
        }
        let result = self.evaluate_to_number(expression)?;
        self.updates.push(key.update(ScriptValue::Number(result), op, target));
        let b = &mut *self.bindings;
        match key {
            UpdateKey::SetVariationIndex | UpdateKey::ExerciseVariationIndex | UpdateKey::DescriptionIndex => {
                if normalized[0].matches(b.week) && normalized[1].matches(b.day) {
                    match key {
                        UpdateKey::SetVariationIndex => b.set_variation_index = result,
                        UpdateKey::ExerciseVariationIndex => b.exercise_variation_index = result,
                        _ => b.description_index = result,
                    }
                }
            }
            UpdateKey::NumberOfSets => {
                if normalized[0].matches(b.week)
                    && normalized[1].matches(b.day)
                    && normalized[2].matches(b.set_variation_index)
                {
                    b.number_of_sets = result;
                    b.ns = result;
                }
            }
            _ => {}
        }
        Ok(EvalValue::Number(result))
    }

    fn calculate_index_values(&mut self, indexes: &[Option<&Node>]) -> SyntaxResult<Vec<Idx>> {
        let mut out = Vec::new();
        for ie in indexes.iter().flatten() {
            if ie.kind == NodeKind::Wildcard {
                out.push(Idx::Star);
            } else {
                let v = first_of(self.evaluate(ie)?);
                out.push(Idx::Num(number_of(&v)));
            }
        }
        Ok(out)
    }

    fn normalize_target(target: Vec<Idx>, length: usize) -> Vec<Idx> {
        let missing = length.saturating_sub(target.len());
        let mut out = vec![Idx::Star; missing];
        out.extend(target);
        out
    }

    /// `evaluate`
    pub fn evaluate(&mut self, expr: &Node) -> SyntaxResult<EvalValue> {
        match expr.kind {
            NodeKind::Program | NodeKind::BlockExpression => {
                let mut result = EvalValue::Number(0.0);
                for child in &expr.children {
                    if child.kind != NodeKind::LineComment {
                        result = self.evaluate(child)?;
                    }
                }
                Ok(result)
            }
            NodeKind::BinaryExpression => self.evaluate_binary(expr),
            NodeKind::NumberExpression => {
                let Some(number_node) = expr.child(NodeKind::Number) else {
                    return Err(assert_err(NodeKind::NumberExpression));
                };
                let value = js_parse_float(&self.value_of(number_node));
                let sign = expr.child(NodeKind::Plus).map(|p| self.value_of(p));
                Ok(EvalValue::Number(if sign.as_deref() == Some("-") {
                    -value
                } else {
                    value
                }))
            }
            NodeKind::Percentage => {
                let value = math::round_float(js_parse_float(&self.value_of(expr)), 2);
                Ok(EvalValue::Percentage(weight::build_pct(value)))
            }
            NodeKind::Ternary => {
                let (Some(condition), Some(then), Some(or)) =
                    (expr.children.first(), expr.children.get(1), expr.children.get(2))
                else {
                    return Err(assert_err(NodeKind::Ternary));
                };
                if self.evaluate(condition)?.truthy() {
                    self.evaluate(then)
                } else {
                    self.evaluate(or)
                }
            }
            NodeKind::ForExpression => self.evaluate_for(expr),
            NodeKind::IfExpression => {
                let parens = expr.children_of(NodeKind::ParenthesisExpression);
                let blocks = expr.children_of(NodeKind::BlockExpression);
                let mut block_iter = blocks.into_iter();
                for paren in parens {
                    let Some(block) = block_iter.next() else {
                        return Err(assert_err(NodeKind::BlockExpression));
                    };
                    if self.evaluate(paren)?.truthy() {
                        return self.evaluate(block);
                    }
                }
                match block_iter.next() {
                    Some(last) => self.evaluate(last),
                    None => Ok(EvalValue::Number(0.0)),
                }
            }
            NodeKind::ParenthesisExpression => match expr.children.first() {
                Some(n) => self.evaluate(n),
                None => Err(assert_err(NodeKind::ParenthesisExpression)),
            },
            NodeKind::StateVariableIndex => match expr.children.first() {
                Some(n) => self.evaluate(n),
                None => Err(assert_err(NodeKind::StateVariableIndex)),
            },
            NodeKind::AssignmentExpression => self.evaluate_assignment(expr),
            NodeKind::IncAssignmentExpression => self.evaluate_inc_assignment(expr),
            NodeKind::BuiltinFunctionExpression => self.evaluate_builtin(expr),
            NodeKind::UnaryExpression => match expr.children.get(1) {
                Some(n) => Ok(EvalValue::Bool(!self.evaluate(n)?.truthy())),
                None => Err(assert_err(NodeKind::UnaryExpression)),
            },
            NodeKind::WeightExpression => {
                let w = self.get_weight(Some(expr))?;
                Ok(EvalValue::Weight(w.unwrap_or(weight::build(0.0, self.unit))))
            }
            NodeKind::VariableExpression => self.evaluate_variable_expression(expr),
            NodeKind::StateVariable => {
                let Some(state_key) = self.get_state_key(expr) else {
                    return Err(self.error(
                        "You cannot read from other exercises states, you can only write to them",
                        expr,
                        IErrorKind::OtherStateIsWriteOnly,
                    ));
                };
                match self.state.get(&state_key) {
                    Some(v) => Ok(EvalValue::from_script_value(*v)),
                    None => Err(self.error(
                        &format!("There's no state variable '{}'", state_key),
                        expr,
                        IErrorKind::UnknownStateVariable { state_key },
                    )),
                }
            }
            NodeKind::Variable => {
                let key = self.var_key(expr);
                match self.vars.get(&key) {
                    Some(v) => Ok(EvalValue::from_script_value(*v)),
                    None => Err(self.error(
                        &format!("There's no variable '{}'", key),
                        expr,
                        IErrorKind::UnknownVariable { name: key },
                    )),
                }
            }
            NodeKind::ForInExpression => match expr.children.first() {
                Some(n) => self.evaluate(n),
                None => Err(assert_err(NodeKind::ForInExpression)),
            },
            other => Err(self.error(
                &format!("Unknown node type {}", other.name()),
                expr,
                IErrorKind::UnexpectedNode {
                    node: other.name().to_string(),
                },
            )),
        }
    }

    /// `this.getValue(node).replace("var.", "")`
    fn var_key(&self, node: &Node) -> String {
        self.value_of(node).replacen("var.", "", 1)
    }

    fn operation(
        &self,
        onerm: Option<IWeight>,
        a: &EvalValue,
        b: &EvalValue,
        o: impl Fn(f64, f64) -> f64,
    ) -> SyntaxResult<EvalValue> {
        match (a.as_script_value(), b.as_script_value()) {
            (Some(x), Some(y)) => Ok(EvalValue::from_script_value(weight::op(onerm, x, y, o))),
            _ => Err(LiftoscriptSyntaxError::new(
                format!("Can't apply operation to {} and {}", a.to_js_string(), b.to_js_string()),
                0,
                0,
                0,
                0,
                IErrorKind::InvalidWeightOperation,
            )),
        }
    }

    fn arith(&self, op: &str, a: &EvalValue, b: &EvalValue) -> SyntaxResult<EvalValue> {
        let rm1 = Some(self.bindings.rm1);
        match op {
            "+" => self.operation(rm1, a, b, |x, y| x + y),
            "-" => self.operation(rm1, a, b, |x, y| x - y),
            "*" => self.operation(rm1, a, b, |x, y| x * y),
            "/" => self.operation(rm1, a, b, |x, y| if y == 0.0 { 0.0 } else { x / y }),
            _ => self.operation(None, a, b, |x, y| if y == 0.0 { 0.0 } else { x % y }),
        }
    }

    fn evaluate_binary(&mut self, expr: &Node) -> SyntaxResult<EvalValue> {
        let (Some(left), Some(operator), Some(right)) =
            (expr.children.first(), expr.children.get(1), expr.children.get(2))
        else {
            return Err(assert_err(NodeKind::BinaryExpression));
        };
        let eval_left = self.evaluate(left)?;
        let eval_right = self.evaluate(right)?;
        let op = self.value_of(operator);
        if matches!(eval_left, EvalValue::Bool(_)) || matches!(eval_right, EvalValue::Bool(_)) {
            return match op.as_str() {
                "&&" => Ok(if eval_left.truthy() { eval_right } else { eval_left }),
                "||" => Ok(if eval_left.truthy() { eval_left } else { eval_right }),
                _ => Err(self.error(
                    &format!("Unknown operator {}", op),
                    operator,
                    IErrorKind::UnknownOperator { op: op.clone() },
                )),
            };
        }
        if matches!(op.as_str(), ">" | "<" | ">=" | "<=" | "==" | "!=") {
            return Ok(EvalValue::Bool(comparing(&eval_left, &eval_right, &op)));
        }
        if matches!(eval_left, EvalValue::Array(_)) || matches!(eval_right, EvalValue::Array(_)) {
            return Err(self.error(
                &format!("You cannot apply {} to arrays", op),
                operator,
                IErrorKind::OperatorOnArray { op: op.clone() },
            ));
        }
        if matches!(op.as_str(), "+" | "-" | "*" | "/" | "%") {
            return self.arith(&op, &eval_left, &eval_right);
        }
        Err(self.error(
            &format!(
                "Unknown operator {} between {} and {}",
                op,
                eval_left.to_js_string(),
                eval_right.to_js_string()
            ),
            operator,
            IErrorKind::UnknownOperator { op: op.clone() },
        ))
    }

    fn evaluate_for(&mut self, expr: &Node) -> SyntaxResult<EvalValue> {
        let variable_node = expr.child(NodeKind::Variable);
        let for_in = expr.child(NodeKind::ForInExpression);
        let block = expr.child(NodeKind::BlockExpression);
        let Some(variable_node) = variable_node else {
            return Err(assert_err(NodeKind::ForExpression));
        };
        let Some(for_in) = for_in else {
            return Err(assert_err(NodeKind::ForInExpression));
        };
        let Some(block) = block else {
            return Err(assert_err(NodeKind::BlockExpression));
        };
        let EvalValue::Array(items) = self.evaluate(for_in)? else {
            return Err(self.error(
                "for in expression should return an array",
                for_in,
                IErrorKind::ForInNotArray,
            ));
        };
        let key = self.var_key(variable_node);
        for i in 1..=items.len() {
            self.vars.insert(key.clone(), ScriptValue::Number(i as f64));
            self.evaluate(block)?;
        }
        Ok(EvalValue::Number(items.len() as f64))
    }

    fn state_selection(
        &mut self,
        variable_node: &Node,
        state_key: &str,
        index_node: Option<&Node>,
    ) -> SyntaxResult<StateSel> {
        match index_node {
            None => {
                if self.state.contains_key(state_key) {
                    Ok(StateSel::Own)
                } else {
                    Err(self.error(
                        &format!("There's no state variable '{}'", state_key),
                        variable_node,
                        IErrorKind::UnknownStateVariable {
                            state_key: state_key.to_string(),
                        },
                    ))
                }
            }
            Some(index_node) => {
                let index_eval = self.evaluate(index_node)?;
                let key = js_number_to_string(to_number(&index_eval));
                if self.other_states.contains_key(&key) {
                    Ok(StateSel::Other(key))
                } else {
                    Ok(StateSel::Missing)
                }
            }
        }
    }

    fn state_mut(&mut self, sel: &StateSel) -> Option<&mut IProgramState> {
        match sel {
            StateSel::Own => Some(&mut *self.state),
            StateSel::Other(k) => self.other_states.get_mut(k),
            StateSel::Missing => None,
        }
    }

    fn rm1_value(&mut self, expression: &Node) -> SyntaxResult<ScriptValue> {
        let evaluated = self.evaluate(expression)?;
        let first = first_of(evaluated);
        Ok(match first {
            EvalValue::Bool(b) => ScriptValue::Number(if b { 1.0 } else { 0.0 }),
            EvalValue::Undefined => ScriptValue::Number(0.0),
            other => other.as_script_value().unwrap_or(ScriptValue::Number(0.0)),
        })
    }

    fn unknown_variable(&self, variable: &str, node: &Node) -> LiftoscriptSyntaxError {
        self.error(
            &format!("Unknown variable '{}'", variable),
            node,
            IErrorKind::UnknownVariable {
                name: variable.to_string(),
            },
        )
    }

    fn evaluate_assignment(&mut self, expr: &Node) -> SyntaxResult<EvalValue> {
        let (variable_node, expression) = match (expr.children.first(), expr.children.get(1)) {
            (Some(v), Some(e))
                if matches!(
                    v.kind,
                    NodeKind::StateVariable | NodeKind::VariableExpression | NodeKind::Variable
                ) =>
            {
                (v, e)
            }
            _ => return Err(assert_err(NodeKind::AssignmentExpression)),
        };
        match variable_node.kind {
            NodeKind::VariableExpression => {
                let Some(name_node) = variable_node.child(NodeKind::Keyword) else {
                    return Err(self.error("Missing variable name", variable_node, IErrorKind::MissingVariableName));
                };
                let index_exprs = variable_node.children_of(NodeKind::VariableIndex);
                let variable = self.value_of(name_node);
                if variable == "rm1" {
                    if !index_exprs.is_empty() {
                        return Err(self.error(
                            "rm1 is not an array",
                            expr,
                            IErrorKind::NotAnArray {
                                name: "rm1".to_string(),
                            },
                        ));
                    }
                    let value = self.rm1_value(expression)?;
                    let w = weight::convert_to_weight(self.bindings.rm1, value, self.unit);
                    self.bindings.rm1 = w;
                    return Ok(EvalValue::Weight(w));
                }
                let key = UpdateKey::from_name(&variable);
                if self.mode == IProgramMode::Planner {
                    if let Some(key) = key {
                        return self.record_variable_update(key, expression, &index_exprs, IAssignmentOp::Assign);
                    }
                } else if self.mode == IProgramMode::Update {
                    if let Some(key) = key {
                        if key == UpdateKey::NumberOfSets {
                            return self.change_number_of_sets(expression, IAssignmentOp::Assign);
                        }
                        if !matches!(
                            key,
                            UpdateKey::SetVariationIndex
                                | UpdateKey::ExerciseVariationIndex
                                | UpdateKey::DescriptionIndex
                        ) {
                            return self.change_binding(key, expression, &index_exprs, IAssignmentOp::Assign);
                        }
                    }
                }
                Err(self.unknown_variable(&variable, variable_node))
            }
            NodeKind::Variable => {
                let key = self.var_key(variable_node);
                let value = self.evaluate(expression)?;
                let stored = state_value_of(&value);
                self.vars.insert(key, stored);
                Ok(EvalValue::from_script_value(stored))
            }
            _ => {
                let index_node = variable_node.child(NodeKind::StateVariableIndex);
                let Some(state_key_node) = variable_node.child(NodeKind::Keyword) else {
                    return Ok(EvalValue::Number(0.0));
                };
                let state_key = self.value_of(state_key_node);
                let sel = self.state_selection(variable_node, &state_key, index_node)?;
                let value = self.evaluate(expression)?;
                let stored = state_value_of(&value);
                if let Some(state) = self.state_mut(&sel) {
                    state.insert(state_key, stored);
                }
                Ok(value)
            }
        }
    }

    fn evaluate_inc_assignment(&mut self, expr: &Node) -> SyntaxResult<EvalValue> {
        let (state_var, inc_node, expression) =
            match (expr.children.first(), expr.children.get(1), expr.children.get(2)) {
                (Some(v), Some(i), Some(e))
                    if matches!(
                        v.kind,
                        NodeKind::StateVariable | NodeKind::VariableExpression | NodeKind::Variable
                    ) =>
                {
                    (v, i, e)
                }
                _ => return Err(assert_err(NodeKind::IncAssignmentExpression)),
            };
        match state_var.kind {
            NodeKind::VariableExpression => {
                let Some(name_node) = state_var.child(NodeKind::Keyword) else {
                    return Err(self.error("Missing variable name", state_var, IErrorKind::MissingVariableName));
                };
                let index_exprs = state_var.children_of(NodeKind::VariableIndex);
                let variable = self.value_of(name_node);
                if variable == "rm1" {
                    if !index_exprs.is_empty() {
                        return Err(self.error(
                            "rm1 is not an array",
                            expr,
                            IErrorKind::NotAnArray {
                                name: "rm1".to_string(),
                            },
                        ));
                    }
                    let value = EvalValue::from_script_value(self.rm1_value(expression)?);
                    let op = self.value_of(inc_node);
                    if !matches!(op.as_str(), "+=" | "-=" | "*=" | "/=") {
                        return Err(self.error(
                            &format!("Unknown operator {} after {}", op, variable),
                            inc_node,
                            IErrorKind::UnknownAssignmentOperator { op, variable },
                        ));
                    }
                    let current = EvalValue::Weight(self.bindings.rm1);
                    let binop = &op[..1];
                    let res = self.arith(binop, &current, &value)?;
                    let sv = res.as_script_value().unwrap_or(ScriptValue::Number(0.0));
                    self.bindings.rm1 = weight::convert_to_weight(self.bindings.rm1, sv, self.unit);
                    return Ok(EvalValue::Weight(self.bindings.rm1));
                }
                let key = UpdateKey::from_name(&variable);
                let check_op = |this: &Self| -> SyntaxResult<IAssignmentOp> {
                    let op = this.value_of(inc_node);
                    match parse_op(&op) {
                        Some(o) => Ok(o),
                        None => Err(this.error(
                            &format!("Unknown operator {} after {}", op, variable),
                            inc_node,
                            IErrorKind::UnknownAssignmentOperator {
                                op,
                                variable: variable.clone(),
                            },
                        )),
                    }
                };
                if self.mode == IProgramMode::Planner {
                    if let Some(key) = key {
                        if matches!(
                            key,
                            UpdateKey::Reps
                                | UpdateKey::Weights
                                | UpdateKey::Rpe
                                | UpdateKey::MinReps
                                | UpdateKey::Timers
                                | UpdateKey::SetTime
                                | UpdateKey::SetVariationIndex
                                | UpdateKey::ExerciseVariationIndex
                                | UpdateKey::DescriptionIndex
                                | UpdateKey::NumberOfSets
                        ) {
                            let op = check_op(self)?;
                            return self.record_variable_update(key, expression, &index_exprs, op);
                        }
                    }
                } else if self.mode == IProgramMode::Update {
                    if let Some(key) = key {
                        if key == UpdateKey::NumberOfSets {
                            let op = check_op(self)?;
                            return self.change_number_of_sets(expression, op);
                        }
                        if matches!(
                            key,
                            UpdateKey::Reps
                                | UpdateKey::Weights
                                | UpdateKey::Rpe
                                | UpdateKey::MinReps
                                | UpdateKey::Timers
                                | UpdateKey::SetTime
                        ) {
                            let op = check_op(self)?;
                            return self.change_binding(key, expression, &index_exprs, op);
                        }
                    }
                }
                Err(self.unknown_variable(&variable, state_var))
            }
            NodeKind::Variable => {
                let var_key = self.var_key(state_var);
                let value = state_value_of(&self.evaluate(expression)?);
                let op = self.value_of(inc_node);
                let bad_op = |this: &Self, op: String| {
                    this.error(
                        &format!("Unknown operator {} after {}", op, var_key),
                        inc_node,
                        IErrorKind::UnknownAssignmentOperator {
                            op,
                            variable: var_key.clone(),
                        },
                    )
                };
                if parse_op(&op).is_none() {
                    return Err(bad_op(self, op));
                }
                let current = self.vars.get(&var_key).copied();
                if !matches!(op.as_str(), "+=" | "-=" | "*=" | "/=") {
                    return Err(bad_op(self, op));
                }
                let cur = current
                    .map(EvalValue::from_script_value)
                    .unwrap_or(EvalValue::Undefined);
                let res = self.arith(&op[..1], &cur, &EvalValue::from_script_value(value))?;
                let stored = res.as_script_value().unwrap_or(ScriptValue::Number(0.0));
                self.vars.insert(var_key, stored);
                Ok(EvalValue::from_script_value(stored))
            }
            _ => {
                let index_node = state_var.child(NodeKind::StateVariableIndex);
                let Some(state_key_node) = state_var.child(NodeKind::Keyword) else {
                    return Ok(EvalValue::Number(0.0));
                };
                let state_key = self.value_of(state_key_node);
                let sel = self.state_selection(state_var, &state_key, index_node)?;
                let value = self.evaluate(expression)?;
                if matches!(sel, StateSel::Missing) {
                    return Ok(value);
                }
                let value = EvalValue::from_script_value(state_value_of(&value));
                let op = self.value_of(inc_node);
                let current = self
                    .state_mut(&sel)
                    .and_then(|s| s.get(&state_key).copied())
                    .unwrap_or(ScriptValue::Number(0.0));
                if !matches!(op.as_str(), "+=" | "-=" | "*=" | "/=") {
                    return Err(self.error(
                        &format!("Unknown operator {} after state.{}", op, state_key),
                        inc_node,
                        IErrorKind::UnknownAssignmentOperator {
                            op,
                            variable: format!("state.{}", state_key),
                        },
                    ));
                }
                let res = self.arith(&op[..1], &EvalValue::from_script_value(current), &value)?;
                let stored = res.as_script_value().unwrap_or(ScriptValue::Number(0.0));
                if let Some(state) = self.state_mut(&sel) {
                    state.insert(state_key, stored);
                }
                Ok(EvalValue::from_script_value(stored))
            }
        }
    }

    fn evaluate_builtin(&mut self, expr: &Node) -> SyntaxResult<EvalValue> {
        let keyword = match expr.children.first() {
            Some(k) if k.kind == NodeKind::Keyword => k,
            _ => return Err(assert_err(NodeKind::BuiltinFunctionExpression)),
        };
        let name_str = self.value_of(keyword);
        let Some(name) = IScriptFnName::from_name(&name_str).filter(|n| is_fn_name(n.name())) else {
            return Err(self.error(
                &format!("Unknown function '{}'", name_str),
                keyword,
                IErrorKind::UnknownFunction { name: name_str },
            ));
        };
        let mut arg_values = Vec::new();
        for (index, a) in expr.children[1..].iter().enumerate() {
            let value = self.evaluate(a)?;
            self.validate_fn_arg(name, index, a, &value)?;
            arg_values.push(value);
        }
        Ok(self.call_fn(name, &arg_values))
    }

    fn evaluate_variable_expression(&mut self, expr: &Node) -> SyntaxResult<EvalValue> {
        let Some(name_node) = expr.children.first() else {
            return Err(assert_err(NodeKind::VariableExpression));
        };
        let name = self.value_of(name_node);
        let index_exprs = &expr.children[1..];
        if index_exprs.iter().any(|e| e.kind != NodeKind::VariableIndex) {
            return Err(assert_err(NodeKind::VariableIndex));
        }
        match index_exprs.len() {
            0 => match binding_value(self.bindings, &name) {
                Some(BindingVal::Scalar(v)) => Ok(v),
                Some(BindingVal::Array(items)) => {
                    if name == "minReps" {
                        let reps = &self.bindings.reps;
                        Ok(EvalValue::Array(
                            items
                                .iter()
                                .enumerate()
                                .map(|(i, v)| v.or_else(|| reps.get(i).copied().flatten().map(ScriptValue::Number)))
                                .collect(),
                        ))
                    } else {
                        Ok(EvalValue::Array(items))
                    }
                }
                None => Ok(EvalValue::Undefined),
            },
            1 => {
                let Some(index_node) = index_exprs[0].children.first() else {
                    return Err(assert_err(NodeKind::VariableIndex));
                };
                if index_node.kind == NodeKind::Wildcard {
                    return Err(self.error(
                        "Can't use '*' or '_' as an index when reading from variables",
                        index_node,
                        IErrorKind::WildcardIndexOnRead,
                    ));
                }
                let index_eval = self.evaluate(index_node)?;
                let mut index = match &index_eval {
                    EvalValue::Weight(w) => w.value,
                    EvalValue::Percentage(p) => p.value,
                    EvalValue::Number(n) => *n,
                    other => {
                        if other.truthy() {
                            1.0
                        } else {
                            0.0
                        }
                    }
                };
                index -= 1.0;
                let Some(BindingVal::Array(binding)) = binding_value(self.bindings, &name) else {
                    return Err(self.error(
                        &format!("Variable {} should be an array", name),
                        name_node,
                        IErrorKind::NotAnArray { name },
                    ));
                };
                if index >= binding.len() as f64 {
                    return Err(self.error(
                        &format!(
                            "Out of bounds index {} for array {}",
                            js_number_to_string(index + 1.0),
                            name
                        ),
                        name_node,
                        IErrorKind::IndexOutOfBounds {
                            name,
                            index: index + 1.0,
                        },
                    ));
                }
                let slot = if index >= 0.0 && index == index.trunc() {
                    binding[index as usize]
                } else {
                    None
                };
                Ok(match slot {
                    Some(v) => EvalValue::from_script_value(v),
                    None => {
                        if name == "minReps" && index >= 0.0 && index == index.trunc() {
                            EvalValue::Number(self.bindings.reps.get(index as usize).copied().flatten().unwrap_or(0.0))
                        } else {
                            EvalValue::Number(0.0)
                        }
                    }
                })
            }
            _ => Err(self.error(
                &format!("Can't use [1:1] syntax when reading from the {} variable", name),
                expr,
                IErrorKind::RangeIndexOnRead { name },
            )),
        }
    }
}

#[allow(dead_code)]
fn _types(_: IPercentage, _: Option<f64>) {
    let _ = opt_num(None);
}

#[cfg(test)]
#[path = "script_eval_tests.rs"]
mod tests;
