//! Port of `parser.ts`: `ScriptRunner`, the entry point for running a
//! Liftoscript script.
//!
//! Typical use (what `runFinishDayScript` does):
//!
//! ```ignore
//! let fns = progress::create_script_functions(&settings);
//! let mut ctx = IScriptFnContext { prints: vec![], unit: settings.units, exercise_type: Some(ex) };
//! let mut runner = ScriptRunner::new(
//!     script, &mut state, &mut other_states, &mut bindings, &fns,
//!     settings.units, &mut ctx, IProgramMode::Planner,
//! );
//! runner.execute(None)?;           // parse + evaluate, mutates state/bindings/ctx
//! let updates = runner.get_updates().to_vec();
//! ```
//!
//! `memoize` from the TS is only a cache and is skipped, as is the alert
//! throttle in `safe`.

#![allow(clippy::result_large_err)]

use indexmap::{IndexMap, IndexSet};

use crate::js::{js_max, js_min, js_round};
use crate::progress::{create_empty_script_bindings, create_script_functions};
use crate::script_eval::{LiftoscriptEvaluator, SyntaxResult};
use crate::script_fns::{EvalValue, IScriptFunctions};
use crate::script_parse::{self, Node, NodeKind};
use crate::types::errors::{IErrorKind, LiftoscriptSyntaxError};
use crate::types::{
    IDayData, IExerciseType, ILiftoscriptEvaluatorUpdate, IPercentage, IProgramMode, IProgramState, IScriptBindings,
    IScriptFnContext, ISettings, IUnit, IWeight, ScriptValue,
};
use crate::weight;

/// The `type` argument of `ScriptRunner.execute`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecuteType {
    Reps,
    Weight,
    Timer,
    Rpe,
}

/// What `ScriptRunner.execute` returns.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExecuteResult {
    Number(f64),
    Weight(IWeight),
    Percentage(IPercentage),
    Bool(bool),
}

pub struct ScriptRunner<'a> {
    script: &'a str,
    state: &'a mut IProgramState,
    other_states: &'a mut IndexMap<String, IProgramState>,
    bindings: &'a mut IScriptBindings,
    fns: &'a IScriptFunctions<'a>,
    units: IUnit,
    context: &'a mut IScriptFnContext,
    mode: IProgramMode,
    updates: Vec<ILiftoscriptEvaluatorUpdate>,
}

fn wrong_result_type(message: &str, expected: &str) -> LiftoscriptSyntaxError {
    LiftoscriptSyntaxError::new(
        message,
        0,
        0,
        0,
        0,
        IErrorKind::WrongResultType {
            expected: expected.to_string(),
        },
    )
}

impl<'a> ScriptRunner<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        script: &'a str,
        state: &'a mut IProgramState,
        other_states: &'a mut IndexMap<String, IProgramState>,
        bindings: &'a mut IScriptBindings,
        fns: &'a IScriptFunctions<'a>,
        units: IUnit,
        context: &'a mut IScriptFnContext,
        mode: IProgramMode,
    ) -> Self {
        ScriptRunner {
            script,
            state,
            other_states,
            bindings,
            fns,
            units,
            context,
            mode,
            updates: Vec::new(),
        }
    }

    fn evaluator(&mut self) -> LiftoscriptEvaluator<'_> {
        LiftoscriptEvaluator::new(
            self.script,
            &mut *self.state,
            &mut *self.other_states,
            &mut *self.bindings,
            self.fns,
            &mut *self.context,
            self.units,
            self.mode,
        )
    }

    /// `ScriptRunner.isValid`: parse in planner mode against empty bindings.
    /// `state` is not changed.
    pub fn is_valid(
        script: &str,
        state: &IProgramState,
        day_data: &IDayData,
        settings: &ISettings,
        exercise_type: Option<&IExerciseType>,
    ) -> Option<LiftoscriptSyntaxError> {
        let mut state = state.clone();
        let mut other = IndexMap::new();
        let mut bindings = create_empty_script_bindings(day_data, settings, None);
        let fns = create_script_functions(settings);
        let mut context = IScriptFnContext {
            prints: vec![],
            unit: settings.units,
            exercise_type: exercise_type.cloned(),
        };
        let mut runner = ScriptRunner::new(
            script,
            &mut state,
            &mut other,
            &mut bindings,
            &fns,
            settings.units,
            &mut context,
            IProgramMode::Planner,
        );
        runner.parse().err()
    }

    /// `ScriptRunner.parse`: parse the script and run the static checks.
    /// Returns the tree.
    pub fn parse(&mut self) -> SyntaxResult<Node> {
        let tree = script_parse::parse(self.script);
        self.evaluator().parse(&tree)?;
        Ok(tree)
    }

    /// `ScriptRunner.switchWeightsToUnit`
    pub fn switch_weights_to_unit(&mut self, to_unit: IUnit) -> SyntaxResult<String> {
        let tree = script_parse::parse(self.script);
        self.evaluator().switch_weights_to_unit(&tree, to_unit)
    }

    /// `ScriptRunner.getStateVariableKeys`
    pub fn get_state_variable_keys(&mut self) -> IndexSet<String> {
        let tree = script_parse::parse(self.script);
        self.evaluator().get_state_variable_keys(&tree)
    }

    /// `ScriptRunner.hasStateVariable`
    pub fn has_state_variable(script: &str, name: &str) -> bool {
        let tree = script_parse::parse(script);
        tree.descendants().iter().any(|n| {
            n.kind == NodeKind::StateVariable
                && n.child(NodeKind::Keyword)
                    .is_some_and(|k| LiftoscriptEvaluator::get_value(script, k) == name)
        })
    }

    /// `ScriptRunner.hasKeyword`
    pub fn has_keyword(script: &str, name: &str) -> bool {
        let tree = script_parse::parse(script);
        tree.descendants()
            .iter()
            .any(|n| n.kind == NodeKind::Keyword && LiftoscriptEvaluator::get_value(script, n) == name)
    }

    /// `ScriptRunner.safe` without the alert reporting: the default on a script error.
    pub fn safe<T>(cb: impl FnOnce() -> SyntaxResult<T>, default_value: T) -> T {
        cb().unwrap_or(default_value)
    }

    /// `ScriptRunner.execute`: parse, check and evaluate. Mutates the state,
    /// other states, bindings and function context given to `new`.
    pub fn execute(&mut self, ty: Option<ExecuteType>) -> SyntaxResult<ExecuteResult> {
        let tree = script_parse::parse(self.script);
        let units = self.units;
        let (raw, updates) = {
            let mut evaluator = self.evaluator();
            evaluator.parse(&tree)?;
            let raw = evaluator.evaluate(&tree)?;
            (raw, std::mem::take(&mut evaluator.updates))
        };
        let result = match raw {
            EvalValue::Array(items) => match items.first().copied().flatten() {
                Some(v) => EvalValue::from_script_value(v),
                None => EvalValue::Undefined,
            },
            other => other,
        };
        let result = if matches!(result, EvalValue::Undefined) {
            EvalValue::Number(0.0)
        } else {
            result
        };
        let output = Self::convert_result(units, ty, result)?;
        self.updates = updates;
        Ok(output)
    }

    /// `ScriptRunner.getUpdates`
    pub fn get_updates(&self) -> &[ILiftoscriptEvaluatorUpdate] {
        &self.updates
    }

    fn convert_result(units: IUnit, ty: Option<ExecuteType>, result: EvalValue) -> SyntaxResult<ExecuteResult> {
        let plain = |r: &EvalValue| match r {
            EvalValue::Number(n) => ExecuteResult::Number(*n),
            EvalValue::Weight(w) => ExecuteResult::Weight(*w),
            EvalValue::Percentage(p) => ExecuteResult::Percentage(*p),
            EvalValue::Bool(b) => ExecuteResult::Bool(*b),
            _ => ExecuteResult::Number(0.0),
        };
        match ty {
            Some(ExecuteType::Reps) | Some(ExecuteType::Timer) => match result {
                EvalValue::Number(n) => Ok(ExecuteResult::Number(if n < 0.0 { 0.0 } else { n })),
                _ => Err(wrong_result_type("Expected to get number as a result", "number")),
            },
            Some(ExecuteType::Rpe) => match result {
                EvalValue::Number(n) => Ok(ExecuteResult::Number(
                    js_round(js_min(10.0, js_max(0.0, n)) / 0.5) * 0.5,
                )),
                _ => Err(wrong_result_type("Expected to get number as a result", "number")),
            },
            Some(ExecuteType::Weight) => match result {
                EvalValue::Bool(_) => Err(wrong_result_type(
                    "Expected to get number, percentage or weight as a result",
                    "numberOrPercentageOrWeight",
                )),
                EvalValue::Number(n) => Ok(ExecuteResult::Weight(weight::build(n, units))),
                other => {
                    let v = other.as_script_value().unwrap_or(ScriptValue::Number(0.0));
                    if v.value() < 0.0 {
                        Ok(ExecuteResult::Weight(weight::build(0.0, units)))
                    } else {
                        Ok(plain(&other))
                    }
                }
            },
            None => Ok(plain(&result)),
        }
    }
}
