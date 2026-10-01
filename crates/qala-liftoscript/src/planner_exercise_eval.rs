//! Port of `pages/planner/plannerExerciseEvaluator.ts`, plus the helpers it
//! shares with `plannerKey.tsx` (`PlannerKey_*`) and
//! `plannerProgramExercise.ts` (`buildProgress`, `shortNameFromFullName`).
//! Those two live here because the evaluator needs them and their own
//! modules sit on top of this one; the later ports can re-export them.
//!
//! Offsets are UTF-16 code units, like JS string indices and the parser's
//! nodes. The evaluator keeps the script as UTF-16 and slices it that way.
//!
//! TS throws `PlannerSyntaxError`; every fallible step here returns
//! `Result<_, PlannerSyntaxError>` and `evaluate` turns it into an `IEither`.
//! Evaluation order, message text and error ranges follow the TS exactly,
//! including its quirks (see the comments at each one).

// `PlannerSyntaxError` carries the whole error detail; boxing it would only add noise here.
#![allow(clippy::result_large_err)]

use std::collections::BTreeSet;

use indexmap::{IndexMap, IndexSet};
use serde::{Deserialize, Serialize};

use crate::exercise::{
    equipment_name, exercise_build_name, exercise_find_by_name_and_equipment,
    exercise_find_by_name_equipment, exercise_to_key, CustomExercises, Exercise, ExerciseSettings,
    ExerciseType,
};
use crate::js::{js_parse_float, js_parse_int, js_str_len, js_trim, js_truthy_num};
use crate::planner_parse::{Node, NodeKind};
use crate::planner_state_vars;
use crate::progress::{create_empty_script_bindings, create_script_functions};
use crate::script_runner::ScriptRunner;
use crate::types::exercise_view::ExerciseSettingsView;
use crate::types::{
    IDayData, IDayDataRequired, IEither, IErrorDetails, IErrorKind, IExerciseType,
    IPlannerProgramExercise, IPlannerProgramExerciseGlobals, IPlannerProgramExercisePoints,
    IPlannerProgramExerciseRepRange, IPlannerProgramExerciseSet,
    IPlannerProgramExerciseSetVariation, IPlannerProgramExerciseSuperset,
    IPlannerProgramExerciseVariation, IPlannerProgramExerciseWarmupSet, IPlannerProgramProperty,
    IPlannerProgramReuse, IPlannerProgramReuseSource, IPlannerReuseSection, IPlannerSyntaxPointer,
    IPlannerTopLineItem, IPlannerTopLineType, IProgramExerciseDescriptions,
    IProgramExerciseProgress, IProgramExerciseProgressType, IProgramExerciseUpdate,
    IProgramExerciseUpdateType, IProgramMode, IProgramState, IPropertyMeta, IScriptFnContext,
    ISettings, IUnit, IWeight, LiftoscriptSyntaxError, PlannerSyntaxError, ScriptValue, WarmupType,
};
use crate::util::generator::UidSource;
use crate::util::object::is_equal;
use crate::util::string::unindent;
use crate::weight;

// ---------------------------------------------------------------------------
// public types

/// `IPlannerExerciseEvaluatorMode`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlannerExerciseEvaluatorMode {
    PerDay,
    Full,
    OnSet,
}

impl PlannerExerciseEvaluatorMode {
    pub fn from_name(s: &str) -> Option<Self> {
        match s {
            "perday" => Some(Self::PerDay),
            "full" => Some(Self::Full),
            "onset" => Some(Self::OnSet),
            _ => None,
        }
    }
}

/// One day of `IPlannerExerciseEvaluatorWeek.days`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlannerExerciseEvaluatorDay {
    pub name: String,
    pub line: i64,
    pub exercises: Vec<IPlannerProgramExercise>,
}

/// `IPlannerExerciseEvaluatorWeek`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlannerExerciseEvaluatorWeek {
    pub name: String,
    pub line: i64,
    pub days: Vec<IPlannerExerciseEvaluatorDay>,
}

/// `IPlannerEvalFullResult`
pub type IPlannerEvalFullResult = IEither<Vec<IPlannerExerciseEvaluatorWeek>, PlannerSyntaxError>;

/// The `{ message, details }` failure of `PlannerProgramExercise_buildProgress`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProgressBuildError {
    pub message: String,
    pub details: IErrorDetails,
}

/// The `opts` of `PlannerProgramExercise_buildProgress`.
#[derive(Debug, Clone, Default)]
pub struct BuildProgressOpts {
    pub reuse_fullname: Option<String>,
    pub script: Option<String>,
}

/// Result of `extractNameParts`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NameParts {
    pub name: String,
    pub label: Option<String>,
    pub equipment: Option<String>,
}

// ---------------------------------------------------------------------------
// helpers shared with other modules

/// Builds the `IExercise` object the TS puts into `exerciseType` from the
/// exercise DB view. Key order follows the TS spreads: built-ins give
/// `id, name, defaultWarmup, defaultEquipment, types, startingWeightLb,
/// startingWeightKg, equipment`; customs give the custom's own keys, then
/// `defaultWarmup, types, startingWeightKg, startingWeightLb`, then `equipment`.
pub fn exercise_to_i_exercise(
    e: &Exercise,
    exercises: &crate::types::IAllCustomExercises,
) -> IExerciseType {
    let mut extra: IndexMap<String, serde_json::Value> = IndexMap::new();
    let w = |value: f64, unit: IUnit| {
        serde_json::to_value(IWeight { value, unit }).unwrap_or(serde_json::Value::Null)
    };
    if let Some(custom) = exercises.get(&e.id) {
        if let Ok(serde_json::Value::Object(map)) = serde_json::to_value(custom) {
            for (k, v) in map {
                if k != "id" && k != "equipment" {
                    extra.insert(k, v);
                }
            }
        }
        extra.insert("defaultWarmup".to_string(), serde_json::json!(45));
        extra.insert(
            "types".to_string(),
            serde_json::json!(custom.types.clone().unwrap_or_default()),
        );
        extra.insert("startingWeightKg".to_string(), w(0.0, IUnit::Kg));
        extra.insert("startingWeightLb".to_string(), w(0.0, IUnit::Lb));
    } else {
        extra.insert("name".to_string(), serde_json::json!(e.name));
        if let Some(dw) = e.default_warmup {
            extra.insert("defaultWarmup".to_string(), serde_json::json!(dw));
        }
        if let Some(de) = &e.default_equipment {
            extra.insert("defaultEquipment".to_string(), serde_json::json!(de));
        }
        extra.insert("types".to_string(), serde_json::json!(e.types));
        extra.insert(
            "startingWeightLb".to_string(),
            w(e.starting_weight_lb, IUnit::Lb),
        );
        extra.insert(
            "startingWeightKg".to_string(),
            w(e.starting_weight_kg, IUnit::Kg),
        );
    }
    IExerciseType {
        id: e.id.clone(),
        equipment: e.equipment.clone(),
        extra,
    }
}

/// `PlannerExerciseEvaluator.extractNameParts` (the TS memoizes it; here it is recomputed).
pub fn extract_name_parts_with(s: &str, custom: &CustomExercises) -> NameParts {
    let mut pieces = s.split(':');
    let first = pieces.next().unwrap_or("");
    let rest: Vec<&str> = pieces.collect();
    let (label, name_equipment) = if rest.is_empty() {
        (String::new(), js_trim(first).to_string())
    } else {
        (
            js_trim(first).to_string(),
            js_trim(&rest.join(":")).to_string(),
        )
    };
    let label_opt = if label.is_empty() { None } else { Some(label) };
    match exercise_find_by_name_and_equipment(&name_equipment, custom) {
        Some(m) => NameParts {
            name: m.name,
            label: label_opt,
            equipment: m.equipment,
        },
        None => NameParts {
            name: name_equipment,
            label: label_opt,
            equipment: None,
        },
    }
}

/// `extractNameParts(str, exercises)` over the settings' custom exercises.
pub fn extract_name_parts(s: &str, exercises: &crate::types::IAllCustomExercises) -> NameParts {
    let view = custom_view(exercises);
    extract_name_parts_with(s, &view)
}

fn custom_view(exercises: &crate::types::IAllCustomExercises) -> CustomExercises {
    exercises
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                crate::types::exercise_view::custom_exercise_to_view(v),
            )
        })
        .collect()
}

/// `PlannerProgramExercise_shortNameFromFullName`
pub fn short_name_from_full_name_with(full_name: &str, custom: &CustomExercises) -> String {
    let parts = extract_name_parts_with(full_name, custom);
    match parts.equipment.as_deref().filter(|e| !e.is_empty()) {
        Some(eq) => format!("{}, {}", parts.name, equipment_name(Some(eq))),
        None => parts.name,
    }
}

/// `PlannerProgramExercise_shortNameFromFullName(fullName, settings)`
pub fn short_name_from_full_name(full_name: &str, settings: &ISettings) -> String {
    short_name_from_full_name_with(full_name, &custom_view(&settings.exercises))
}

fn lower_key(label: Option<&str>, key: &str) -> String {
    let prefix = match label {
        Some(l) if !l.is_empty() => format!("{}-", l),
        _ => String::new(),
    };
    format!("{}{}", prefix, key).to_lowercase()
}

/// `PlannerKey_fromExerciseVariations`
pub fn planner_key_from_exercise_variations(
    variations: &[IPlannerProgramExerciseVariation],
    label: Option<&str>,
) -> String {
    let key_part = variations
        .iter()
        .map(|v| match &v.exercise_type {
            Some(t) => exercise_to_key(&ExerciseType::from(t)),
            None => v.name.clone(),
        })
        .collect::<Vec<_>>()
        .join("_");
    lower_key(label, &key_part)
}

/// `PlannerKey_fromLabelNameAndEquipment`
pub fn planner_key_from_label_name_and_equipment_with(
    label: Option<&str>,
    name: &str,
    equipment: Option<&str>,
    custom: &CustomExercises,
) -> String {
    let key = match exercise_find_by_name_equipment(custom, name, equipment) {
        Some(e) => exercise_to_key(&ExerciseType {
            id: e.id,
            equipment: e.equipment,
        }),
        None => name.to_string(),
    };
    lower_key(label, &key)
}

/// `PlannerKey_fromFullName`
pub fn planner_key_from_full_name_with(full_name: &str, custom: &CustomExercises) -> String {
    let segments: Vec<&str> = full_name.split('|').collect();
    if segments.len() == 1 {
        let parts = extract_name_parts_with(full_name, custom);
        return planner_key_from_label_name_and_equipment_with(
            parts.label.as_deref(),
            &parts.name,
            parts.equipment.as_deref(),
            custom,
        );
    }
    let mut label: Option<String> = None;
    let key_parts: Vec<String> = segments
        .iter()
        .enumerate()
        .map(|(i, segment)| {
            let cleaned = strip_bang(js_trim(segment));
            let parts = extract_name_parts_with(&cleaned, custom);
            if i == 0 {
                label = parts.label.clone();
            }
            match exercise_find_by_name_equipment(custom, &parts.name, parts.equipment.as_deref()) {
                Some(e) => exercise_to_key(&ExerciseType {
                    id: e.id,
                    equipment: e.equipment,
                }),
                None => parts.name,
            }
        })
        .collect();
    lower_key(label.as_deref(), &key_parts.join("_"))
}

/// `PlannerKey_fromFullName(fullName, exercises)`
pub fn planner_key_from_full_name(
    full_name: &str,
    exercises: &crate::types::IAllCustomExercises,
) -> String {
    planner_key_from_full_name_with(full_name, &custom_view(exercises))
}

/// `.replace(/^!\s*/, "")`
fn strip_bang(s: &str) -> String {
    match s.strip_prefix('!') {
        Some(rest) => crate::js::js_trim_start(rest).to_string(),
        None => s.to_string(),
    }
}

fn weight_or_zero_lb(v: Option<crate::types::WeightOrPct>) -> ScriptValue {
    match v {
        Some(w) => w.into(),
        None => ScriptValue::Weight(weight::build(0.0, IUnit::Lb)),
    }
}

fn truthy(s: Option<&String>) -> Option<&str> {
    s.map(|x| x.as_str()).filter(|x| !x.is_empty())
}

fn parse_int_or(arg: Option<&String>, default: f64) -> f64 {
    match truthy(arg) {
        Some(a) => js_parse_int(a, 10),
        None => default,
    }
}

const DP_SCRIPT: &str = "for (var.i in completedReps) {
  if (weights[var.i] == 0 && completedWeights[var.i] != 0) {
    weights[var.i] = completedWeights[var.i]
  }
}
if (completedReps >= reps && completedRPE <= RPE) {
  if (completedReps >= state.maxReps) {
    reps = state.minReps
    for (var.i in completedReps) {
      var.isInitial = weights[var.i] == 0 && completedWeights[var.i] != 0
      if (var.isInitial) {
        weights[var.i] = completedWeights[var.i] + state.increment
      } else {
        weights[var.i] += (completedWeights[var.i] - weights[var.i]) + state.increment
      }
    }
  } else {
    for (var.i in completedReps) {
      reps[var.i] = completedReps[var.i] + 1 > state.maxReps ?
        state.maxReps :
        completedReps[var.i] + 1
    }
  }
}";

const LP_SCRIPT: &str = "for (var.i in completedReps) {
  if (weights[var.i] == 0 && completedWeights[var.i] != 0) {
    weights[var.i] = completedWeights[var.i]
  }
}
if (completedReps >= reps && completedRPE <= RPE) {
  state.successCounter += 1
  if (state.successCounter >= state.successes) {
    for (var.i in completedReps) {
      var.isInitial = weights[var.i] == 0 && completedWeights[var.i] != 0
      if (var.isInitial) {
        weights[var.i] = completedWeights[var.i] + state.increment
      } else {
        weights[var.i] += (completedWeights[var.i] - weights[var.i]) + state.increment
      }
    }
    state.successCounter = 0
    state.failureCounter = 0
  }
}
if (state.decrement > 0 && state.failures > 0) {
  if (!(completedReps >= minReps && completedRPE <= RPE)) {
    state.failureCounter += 1
    if (state.failureCounter >= state.failures) {
      weights -= state.decrement
      state.failureCounter = 0
      state.successCounter = 0
    }
  }
}";

const SUM_SCRIPT: &str = "for (var.i in completedReps) {
if (weights[var.i] == 0 && completedWeights[var.i] != 0) {
  weights[var.i] = completedWeights[var.i]
}
}
if (sum(completedReps) >= state.reps) {
for (var.i in completedReps) {
  weights[var.i] = completedWeights[var.i] + state.increment
}
}";

/// `PlannerProgramExercise_buildProgress`
pub fn build_progress(
    kind: IProgramExerciseProgressType,
    args: &[String],
    opts: BuildProgressOpts,
) -> Result<IProgramExerciseProgress, ProgressBuildError> {
    let num = |n: f64| ScriptValue::Number(n);
    let ok = |kind, state, state_metadata, script, reuse| IProgramExerciseProgress {
        kind,
        state,
        state_metadata,
        script,
        reuse,
        liftoscript_node: None,
    };
    match kind {
        IProgramExerciseProgressType::None => Ok(ok(
            IProgramExerciseProgressType::None,
            IProgramState::new(),
            Default::default(),
            None,
            None,
        )),
        IProgramExerciseProgressType::Lp => {
            let increment = match truthy(args.first()) {
                Some(a) => weight::parse_pct(Some(a)),
                None => Some(weight::build(0.0, IUnit::Lb).into()),
            };
            let decrement = match truthy(args.get(3)) {
                Some(a) => weight::parse_pct(Some(a)),
                None => Some(weight::build(0.0, IUnit::Lb).into()),
            };
            let mut state = IProgramState::new();
            state.insert("increment".to_string(), weight_or_zero_lb(increment));
            state.insert("successes".to_string(), num(parse_int_or(args.get(1), 1.0)));
            state.insert(
                "successCounter".to_string(),
                num(parse_int_or(args.get(2), 0.0)),
            );
            state.insert("decrement".to_string(), weight_or_zero_lb(decrement));
            let failures_default = if decrement.map(|d| d.value()).unwrap_or(0.0) > 0.0 {
                1.0
            } else {
                0.0
            };
            state.insert(
                "failures".to_string(),
                num(parse_int_or(args.get(4), failures_default)),
            );
            state.insert(
                "failureCounter".to_string(),
                num(parse_int_or(args.get(5), 0.0)),
            );
            Ok(ok(
                IProgramExerciseProgressType::Lp,
                state,
                Default::default(),
                Some(LP_SCRIPT.to_string()),
                None,
            ))
        }
        IProgramExerciseProgressType::Dp => {
            let increment = match truthy(args.first()) {
                Some(a) => weight::parse_pct(Some(a)),
                None => Some(weight::build(0.0, IUnit::Lb).into()),
            };
            let mut state = IProgramState::new();
            state.insert("increment".to_string(), weight_or_zero_lb(increment));
            state.insert("minReps".to_string(), num(parse_int_or(args.get(1), 0.0)));
            state.insert("maxReps".to_string(), num(parse_int_or(args.get(2), 0.0)));
            Ok(ok(
                IProgramExerciseProgressType::Dp,
                state,
                Default::default(),
                Some(DP_SCRIPT.to_string()),
                None,
            ))
        }
        IProgramExerciseProgressType::Sum => {
            let increment = match truthy(args.get(1)) {
                Some(a) => weight::parse_pct(Some(a)),
                None => Some(weight::build(0.0, IUnit::Lb).into()),
            };
            let mut state = IProgramState::new();
            state.insert("reps".to_string(), num(parse_int_or(args.first(), 0.0)));
            state.insert("increment".to_string(), weight_or_zero_lb(increment));
            Ok(ok(
                IProgramExerciseProgressType::Sum,
                state,
                Default::default(),
                Some(SUM_SCRIPT.to_string()),
                None,
            ))
        }
        IProgramExerciseProgressType::Custom => {
            let mut error: Option<ProgressBuildError> = None;
            let mut collect = |message: &str, value: &str| -> Result<(), ()> {
                error = Some(ProgressBuildError {
                    message: message.to_string(),
                    details: IErrorKind::InvalidStateVariable {
                        value: value.to_string(),
                    }
                    .into(),
                });
                Ok(())
            };
            let (state, state_metadata) =
                planner_state_vars::from_args(args, &mut collect).unwrap_or_default();
            if let Some(e) = error {
                return Err(e);
            }
            let reuse = opts
                .reuse_fullname
                .filter(|r| !r.is_empty())
                .map(|full_name| IPlannerProgramReuse {
                    full_name,
                    source: IPlannerProgramReuseSource::Specific,
                    week: None,
                    day: None,
                    exercise: None,
                });
            Ok(ok(
                IProgramExerciseProgressType::Custom,
                state,
                state_metadata,
                opts.script,
                reuse,
            ))
        }
    }
}

/// `PlannerExerciseEvaluator.fnArgsToStateVars`. The error callback is
/// required here (see `planner_state_vars::from_args`).
pub fn fn_args_to_state_vars<E>(
    fn_args: &[String],
    on_error: &mut dyn FnMut(&str, &str) -> Result<(), E>,
) -> Result<(IProgramState, crate::types::IProgramStateMetadata), E> {
    planner_state_vars::from_args(fn_args, on_error)
}

// ---------------------------------------------------------------------------
// positions

/// Static `PlannerExerciseEvaluator.getLineAndOffset`, taking the node's `from`.
/// Lines split on `\n`; each counts its UTF-16 length plus one. A position past
/// the end yields `[lineCount, lastLineLength + 1]`, as in the TS.
pub fn get_line_and_offset_at(script: &str, from: usize) -> (i64, i64) {
    let units: Vec<u16> = script.encode_utf16().collect();
    line_and_offset(&units, from)
}

fn line_and_offset(units: &[u16], from: usize) -> (i64, i64) {
    let mut offset = 0usize;
    let mut line = 1i64;
    let mut line_len: usize;
    let mut i = 0usize;
    loop {
        // length of the current line, including the virtual newline
        let start = i;
        while i < units.len() && units[i] != 10 {
            i += 1;
        }
        line_len = i - start + 1;
        if from >= offset && from < offset + line_len {
            return (line, (from - offset) as i64);
        }
        offset += line_len;
        if i >= units.len() {
            break;
        }
        i += 1;
        line += 1;
    }
    (line, line_len as i64)
}

/// Static `getLineAndOffset(script, node)`.
pub fn get_line_and_offset(script: &str, node: &Node) -> (i64, i64) {
    get_line_and_offset_at(script, node.from)
}

fn children_of(node: &Node) -> &[Node] {
    node.children()
}

fn assert_node(name: &str) -> PlannerSyntaxError {
    PlannerSyntaxError::new(
        format!(
            "Missing required nodes for {}, this should never happen",
            name
        ),
        0,
        0,
        0,
        1,
        IErrorKind::Internal {
            node: name.to_string(),
        },
    )
}

type Res<T> = Result<T, PlannerSyntaxError>;

enum Section {
    Sets {
        data: Vec<IPlannerProgramExerciseSet>,
        is_current: bool,
    },
    Progress(IProgramExerciseProgress),
    Update(IProgramExerciseUpdate),
    Id(Vec<i64>),
    Reuse(IPlannerProgramReuse),
    Warmup(Vec<IPlannerProgramExerciseWarmupSet>),
    Superset(IPlannerProgramExerciseSuperset),
    Used,
}

fn ends_with_weight_or_pct(s: &str) -> bool {
    s.ends_with("lb") || s.ends_with("kg") || s.ends_with('%')
}

fn is_nan_int(s: &str) -> bool {
    js_parse_int(s, 10).is_nan()
}

// ---------------------------------------------------------------------------
// the evaluator

pub struct PlannerExerciseEvaluator<'a> {
    units: Vec<u16>,
    mode: PlannerExerciseEvaluatorMode,
    day_data: IDayDataRequired,
    settings: &'a ISettings,
    view: ExerciseSettingsView<'a>,
    weeks: Vec<IPlannerExerciseEvaluatorWeek>,
    exercise_index: i64,
    latest_descriptions: Vec<Vec<String>>,
}

impl<'a> PlannerExerciseEvaluator<'a> {
    /// `new PlannerExerciseEvaluator(script, settings, mode, dayData?)`
    pub fn new(
        script: &'a str,
        settings: &'a ISettings,
        mode: PlannerExerciseEvaluatorMode,
        day_data: Option<IDayDataRequired>,
    ) -> Self {
        PlannerExerciseEvaluator {
            units: script.encode_utf16().collect(),
            mode,
            day_data: day_data.unwrap_or(IDayDataRequired {
                day: 1,
                week: 1,
                day_in_week: 1,
            }),
            settings,
            view: settings.exercise_view(),
            weeks: Vec::new(),
            exercise_index: 0,
            latest_descriptions: Vec::new(),
        }
    }

    fn slice(&self, from: usize, to: usize) -> String {
        let to = to.min(self.units.len());
        let from = from.min(to);
        String::from_utf16_lossy(&self.units[from..to])
    }

    /// `getValue`: the node text with newlines and tabs escaped.
    fn value(&self, node: &Node) -> String {
        self.value_trim(node)
            .replace('\n', "\\n")
            .replace('\t', "\\t")
    }

    /// `getValueTrim`: the raw node text (despite the name, nothing is trimmed).
    fn value_trim(&self, node: &Node) -> String {
        self.slice(node.from, node.to)
    }

    fn line_and_offset(&self, node: &Node) -> (i64, i64) {
        line_and_offset(&self.units, node.from)
    }

    fn point(&self, node: &Node) -> IPlannerSyntaxPointer {
        let (line, offset) = self.line_and_offset(node);
        IPlannerSyntaxPointer {
            line,
            offset,
            from: node.from as i64,
            to: node.to as i64,
        }
    }

    fn error(&self, message: &str, node: &Node, kind: IErrorKind) -> PlannerSyntaxError {
        self.error_details(message, node, kind.into())
    }

    fn error_details(
        &self,
        message: &str,
        node: &Node,
        details: IErrorDetails,
    ) -> PlannerSyntaxError {
        PlannerSyntaxError::from_point(None, message, self.point(node), details)
    }

    /// `PlannerExerciseEvaluator.applyChangesToScript`
    pub fn apply_changes_to_script(script: &str, ranges: &[(usize, usize, String)]) -> String {
        let mut units: Vec<u16> = script.encode_utf16().collect();
        let mut offset: i64 = 0;
        for (from, to, replacement) in ranges {
            let rep: Vec<u16> = replacement.encode_utf16().collect();
            let a = ((*from as i64 + offset).max(0) as usize).min(units.len());
            let b = ((*to as i64 + offset).max(0) as usize).min(units.len());
            let tail: Vec<u16> = units[b.max(a)..].to_vec();
            units.truncate(a);
            units.extend_from_slice(&rep);
            units.extend(tail);
            offset += rep.len() as i64 - (*to as i64 - *from as i64);
        }
        String::from_utf16_lossy(&units)
    }

    /// `PlannerExerciseEvaluator.isEqualProperty`
    pub fn is_equal_property(a: &IPlannerProgramProperty, b: &IPlannerProgramProperty) -> bool {
        a.fn_name == b.fn_name
            && a.fn_args.join(",") == b.fn_args.join(",")
            && a.script == b.script
            && a.body == b.body
    }

    /// `PlannerExerciseEvaluator.isEqualProgress`
    pub fn is_equal_progress(a: &IProgramExerciseProgress, b: &IProgramExerciseProgress) -> bool {
        let pick = |p: &IProgramExerciseProgress| {
            let mut m = serde_json::Map::new();
            m.insert(
                "type".to_string(),
                serde_json::to_value(p.kind).unwrap_or_default(),
            );
            m.insert(
                "state".to_string(),
                serde_json::to_value(&p.state).unwrap_or_default(),
            );
            m.insert(
                "stateMetadata".to_string(),
                serde_json::to_value(&p.state_metadata).unwrap_or_default(),
            );
            if let Some(s) = &p.script {
                m.insert("script".to_string(), serde_json::json!(s));
            }
            if let Some(r) = &p.reuse {
                m.insert("reuse".to_string(), serde_json::json!(r.full_name));
            }
            serde_json::Value::Object(m)
        };
        is_equal(&pick(a), &pick(b), &[])
    }

    /// `PlannerExerciseEvaluator.isEqualUpdate`
    pub fn is_equal_update(a: &IProgramExerciseUpdate, b: &IProgramExerciseUpdate) -> bool {
        let pick = |p: &IProgramExerciseUpdate| {
            let mut m = serde_json::Map::new();
            m.insert(
                "type".to_string(),
                serde_json::to_value(p.kind).unwrap_or_default(),
            );
            if let Some(s) = &p.script {
                m.insert("script".to_string(), serde_json::json!(s));
            }
            if let Some(r) = &p.reuse {
                m.insert("reuse".to_string(), serde_json::json!(r.full_name));
            }
            serde_json::Value::Object(m)
        };
        is_equal(&pick(a), &pick(b), &[])
    }

    /// `parse`: the first error node in document order becomes a "Syntax error".
    pub fn parse(&self, expr: &Node) -> Res<()> {
        fn find(n: &Node) -> Option<&Node> {
            if n.is_error() {
                return Some(n);
            }
            n.children().iter().find_map(find)
        }
        match find(expr) {
            Some(n) => Err(self.error("Syntax error", n, IErrorKind::Parse)),
            None => Ok(()),
        }
    }

    // ---- sets

    fn get_warmup_reps(set_parts: &str) -> (f64, f64) {
        let mut it = set_parts.split('x');
        let mut number_of_sets_str = it.next().unwrap_or("").to_string();
        let reps_opt = it.next().map(|s| s.to_string());
        if number_of_sets_str.is_empty() {
            return (1.0, 1.0);
        }
        let reps_str = match reps_opt.filter(|s| !s.is_empty()) {
            Some(r) => r,
            None => {
                let r = number_of_sets_str.clone();
                number_of_sets_str = "1".to_string();
                r
            }
        };
        (
            js_parse_int(&number_of_sets_str, 10),
            js_parse_int(&reps_str, 10),
        )
    }

    fn get_rep_range(set_parts: &str) -> Option<IPlannerProgramExerciseRepRange> {
        if set_parts.is_empty() {
            return None;
        }
        let mut it = set_parts.split('x');
        let number_of_sets_str = it.next().unwrap_or("");
        // TS would throw a TypeError here when there is no "x"; the grammar always has one.
        let rep_range_str = it.next()?;
        let mut rr = rep_range_str.split('-');
        let first = rr.next().unwrap_or("");
        let second = rr.next();
        let (minrep_str, max_str): (Option<&str>, &str) = match second.filter(|s| !s.is_empty()) {
            Some(m) => (Some(first), m),
            None => (None, first),
        };
        // The TS calls `maxrepStr.replace(/\+/g, "")` and drops the result, so the
        // string keeps its "+" and parseInt stops at it.
        let is_amrap = max_str.ends_with('+');
        Some(IPlannerProgramExerciseRepRange {
            number_of_sets: js_parse_int(number_of_sets_str, 10),
            minrep: minrep_str.map(|s| js_parse_int(s, 10)),
            maxrep: Some(js_parse_int(max_str, 10)),
            is_amrap,
            is_quick_add_set: number_of_sets_str.ends_with('+'),
        })
    }

    fn get_weight(&self, expr: Option<&Node>) -> Option<IWeight> {
        let expr = expr?;
        if expr.kind == NodeKind::WeightWithPlus || expr.kind == NodeKind::Weight {
            let value = self.value(expr).replacen('+', "", 1);
            let unit = if value.contains("kg") {
                IUnit::Kg
            } else {
                IUnit::Lb
            };
            Some(weight::build(js_parse_float(&value), unit))
        } else {
            None
        }
    }

    fn evaluate_warmup_set(&self, expr: &Node) -> Res<IPlannerProgramExerciseWarmupSet> {
        if expr.kind != NodeKind::WarmupExerciseSet {
            return Err(assert_node("ExerciseSection"));
        }
        let set_parts: String = expr
            .get_children(NodeKind::WarmupSetPart)
            .into_iter()
            .map(|n| self.value(n))
            .collect::<Vec<_>>()
            .join("");
        let (number_of_sets, reps) = Self::get_warmup_reps(&set_parts);
        let percentage_node = expr.get_child(NodeKind::Percentage);
        let weight_node = expr.get_child(NodeKind::Weight);
        let percentage =
            percentage_node.map(|n| js_parse_float(&self.value(n).replacen('%', "", 1)));
        let w = self.get_weight(weight_node);
        // `if (percentage)`: a 0% percentage falls through to the weight branch.
        match percentage {
            Some(p) if js_truthy_num(p) => Ok(IPlannerProgramExerciseWarmupSet {
                kind: WarmupType,
                number_of_sets,
                reps,
                percentage: Some(p),
                weight: None,
            }),
            _ => Ok(IPlannerProgramExerciseWarmupSet {
                kind: WarmupType,
                number_of_sets,
                reps,
                percentage: None,
                weight: w,
            }),
        }
    }

    fn evaluate_set(&self, expr: &Node) -> Res<IPlannerProgramExerciseSet> {
        if expr.kind != NodeKind::ExerciseSet {
            return Err(assert_node("ExerciseSection"));
        }
        let set_parts: String = expr
            .get_children(NodeKind::SetPart)
            .into_iter()
            .map(|n| self.value(n))
            .collect::<Vec<_>>()
            .join("");
        let rep_range = Self::get_rep_range(&set_parts);
        let rpe_node = expr.get_child(NodeKind::Rpe);
        let timer_node = expr.get_child(NodeKind::Timer);
        let set_timer_node = expr.get_child(NodeKind::SetTimer);
        let auto_node = expr.get_child(NodeKind::Auto);
        let percentage_node = expr.get_child(NodeKind::PercentageWithPlus);
        let weight_node = expr.get_child(NodeKind::WeightWithPlus);
        let label_node = expr.get_child(NodeKind::SetLabel);
        let ask_weight_node = expr.get_child(NodeKind::AskWeight);
        let ask_weight = ask_weight_node.is_some()
            || weight_node.is_some_and(|n| self.value(n).contains('+'))
            || percentage_node.is_some_and(|n| self.value(n).contains('+'));
        let log_rpe = rpe_node.map(|n| self.value(n).contains('+'));
        let mut rpe = rpe_node
            .map(|n| js_parse_float(&self.value(n).replacen('@', "", 1).replacen('+', "", 1)));
        if rpe.is_some_and(f64::is_nan) {
            rpe = None;
        }
        let mut timer = timer_node.map(|n| js_parse_int(&self.value(n).replacen('s', "", 1), 10));
        let mut set_timer: Option<f64> = None;
        let mut is_overflow_set_timer: Option<bool> = None;
        if let Some(n) = set_timer_node {
            // "60s+|30s" or "60s|?": the active timer on the left, the rest timer on the right.
            let v = self.value(n);
            let mut it = v.split('|');
            let left = it.next().unwrap_or("");
            let right = it.next().unwrap_or("");
            is_overflow_set_timer = if left.contains('+') { Some(true) } else { None };
            set_timer = Some(js_parse_int(
                &left.replacen('s', "", 1).replacen('+', "", 1),
                10,
            ));
            timer = if right == "?" {
                None
            } else {
                Some(js_parse_int(&right.replacen('s', "", 1), 10))
            };
        }
        let auto = if auto_node.is_some() {
            Some(true)
        } else {
            None
        };
        let percentage = percentage_node.map(|n| {
            let v = self.value(n);
            let cleaned = match v.find(['%', '+']) {
                Some(i) => format!("{}{}", &v[..i], &v[i + 1..]),
                None => v,
            };
            js_parse_float(&cleaned)
        });
        let w = self.get_weight(weight_node);
        let label = label_node.map(|n| {
            children_of(n)
                .iter()
                .map(|c| self.value(c))
                .collect::<Vec<_>>()
                .join(" ")
        });
        if let (Some(ln), Some(l)) = (label_node, &label) {
            if !l.is_empty() && js_str_len(l) > 8 {
                return Err(self.error(
                    "Label length should be 8 chars max",
                    ln,
                    IErrorKind::LabelTooLong { max: 8 },
                ));
            }
        }
        Ok(IPlannerProgramExerciseSet {
            rep_range,
            timer,
            set_timer,
            is_overflow_set_timer,
            auto,
            log_rpe,
            rpe,
            weight: w,
            percentage,
            label,
            ask_weight: Some(ask_weight),
        })
    }

    // ---- properties

    fn property_value_node<'n>(&self, expr: &'n Node, property: &str) -> Res<&'n Node> {
        expr.get_child(NodeKind::FunctionExpression).ok_or_else(|| {
            self.error(
                &format!("Missing value for the property '{}'", property),
                expr,
                IErrorKind::MissingPropertyValue {
                    property: property.to_string(),
                },
            )
        })
    }

    fn evaluate_id(&self, expr: &Node) -> Res<Vec<i64>> {
        if expr.kind != NodeKind::ExerciseProperty {
            return Err(assert_node("ExerciseProperty"));
        }
        let value_node = self.property_value_node(expr, "id")?;
        let fn_name_node = value_node
            .get_child(NodeKind::FunctionName)
            .ok_or_else(|| assert_node("FunctionName"))?;
        let fn_name = self.value(fn_name_node);
        if fn_name != "tags" {
            return Err(self.error(
                &format!("There's no such id type - '{}'", fn_name),
                fn_name_node,
                IErrorKind::UnknownIdType {
                    name: fn_name.clone(),
                },
            ));
        }
        let fn_args: Vec<String> = value_node
            .get_children(NodeKind::FunctionArgument)
            .into_iter()
            .map(|n| self.value(n))
            .collect();
        if fn_args.is_empty() {
            return Err(self.error(
                "You should provide the list of numbers in \"tags\"",
                fn_name_node,
                IErrorKind::InvalidTags,
            ));
        }
        Ok(fn_args
            .iter()
            .map(|t| js_parse_int(t, 10))
            .filter(|t| !t.is_nan())
            .map(|t| t as i64)
            .collect())
    }

    /// The ScriptRunner plumbing the evaluator uses twice: build a runner over
    /// `script` in the given mode and hand it to `f`.
    fn with_runner<T>(
        &self,
        script: &str,
        state: &mut IProgramState,
        exercise_type: Option<IExerciseType>,
        mode: IProgramMode,
        f: impl FnOnce(&mut ScriptRunner<'_>) -> T,
    ) -> T {
        let mut other_states = IndexMap::new();
        let day: IDayData = self.day_data.into();
        let mut bindings = create_empty_script_bindings(&day, self.settings, None);
        let fns = create_script_functions(self.settings);
        let mut context = IScriptFnContext {
            prints: Vec::new(),
            unit: self.settings.units,
            exercise_type,
        };
        let mut runner = ScriptRunner::new(
            script,
            state,
            &mut other_states,
            &mut bindings,
            &fns,
            self.settings.units,
            &mut context,
            mode,
        );
        f(&mut runner)
    }

    fn reuse_body(&self, value_node: &Node) -> Option<String> {
        value_node
            .get_child(NodeKind::ReuseLiftoscript)
            .and_then(|n| n.get_child(NodeKind::ReuseSection))
            .and_then(|n| n.get_child(NodeKind::ExerciseName))
            .map(|n| self.value(n))
    }

    fn evaluate_update(
        &self,
        expr: &Node,
        exercise_type: Option<&IExerciseType>,
    ) -> Res<IProgramExerciseUpdate> {
        if expr.kind != NodeKind::ExerciseProperty {
            return Err(assert_node("ExerciseProperty"));
        }
        let value_node = self.property_value_node(expr, "update")?;
        let fn_name_node = value_node
            .get_child(NodeKind::FunctionName)
            .ok_or_else(|| assert_node("FunctionName"))?;
        let fn_name = self.value(fn_name_node);
        let fn_args: Vec<String> = value_node
            .get_children(NodeKind::FunctionArgument)
            .into_iter()
            .map(|n| self.value(n))
            .collect();
        if fn_name != "custom" {
            return Err(self.error(
                &format!("There's no such update progression exists - '{}'", fn_name),
                fn_name_node,
                IErrorKind::UnknownUpdate {
                    name: fn_name.clone(),
                },
            ));
        }
        let liftoscript_node = value_node.get_child(NodeKind::Liftoscript);
        let script = liftoscript_node.map(|n| self.value_trim(n));
        if !fn_args.is_empty() {
            return Err(self.error(
                "State variables for the update script are taken from \"progress\" block",
                fn_name_node,
                IErrorKind::UpdateStateFromProgress,
            ));
        }
        let body = self.reuse_body(value_node);
        let mut meta: Option<IPropertyMeta> = None;
        if let Some(s) = script.as_deref().filter(|s| !s.is_empty()) {
            let mut state = IProgramState::new();
            let keys: IndexSet<String> = self.with_runner(
                s,
                &mut state,
                exercise_type.cloned(),
                IProgramMode::Update,
                |r| r.get_state_variable_keys(),
            );
            meta = Some(IPropertyMeta {
                state_keys: Some(keys),
            });
        }
        let has_script = script.as_deref().is_some_and(|s| !s.is_empty());
        let has_body = body.as_deref().is_some_and(|s| !s.is_empty());
        if !has_script && !has_body {
            return Err(self.error(
                "'custom' update requires either to specify Liftoscript block or specify which one to reuse",
                value_node,
                IErrorKind::CustomWithoutScript { section: IPlannerReuseSection::Update },
            ));
        }
        Ok(IProgramExerciseUpdate {
            kind: IProgramExerciseUpdateType::Custom,
            script,
            reuse: body
                .filter(|b| !b.is_empty())
                .map(|full_name| IPlannerProgramReuse {
                    full_name,
                    source: IPlannerProgramReuseSource::Specific,
                    week: None,
                    day: None,
                    exercise: None,
                }),
            liftoscript_node: liftoscript_node.map(|n| {
                serde_json::json!({"$lezerNode": "Liftoscript", "from": n.from, "to": n.to})
            }),
            meta,
        })
    }

    fn progression_arg(
        &self,
        node: &Node,
        f: &str,
        index: i64,
        expected: &str,
        message: &str,
    ) -> PlannerSyntaxError {
        self.error(
            message,
            node,
            IErrorKind::ProgressionArgument {
                r#fn: f.to_string(),
                index,
                expected: expected.to_string(),
            },
        )
    }

    fn validate_progress(
        &self,
        fn_name: &str,
        fn_args: &[String],
        fn_name_node: &Node,
        value_node: &Node,
    ) -> Res<()> {
        if !["lp", "sum", "dp", "custom", "none"].contains(&fn_name) {
            return Err(self.error(
                &format!("There's no such progression exists - '{}'", fn_name),
                fn_name_node,
                IErrorKind::UnknownProgression {
                    name: fn_name.to_string(),
                },
            ));
        }
        let arg = |i: usize| fn_args.get(i).map(|s| s.as_str());
        const WP: &str = "weightOrPercentage";
        if fn_name == "lp" {
            if fn_args.len() > 6 {
                return Err(self.error(
                    "Linear Progression 'lp' only has 6 arguments max",
                    value_node,
                    IErrorKind::ProgressionArity {
                        r#fn: "lp".to_string(),
                        max: 6,
                    },
                ));
            } else if arg(0).is_some_and(|a| !a.is_empty() && !ends_with_weight_or_pct(a)) {
                return Err(self.progression_arg(
                    value_node, "lp", 0, WP,
                    "1st argument of 'lp' should be weight (ending with 'lb' or 'kg') or percentage (ending with '%'). For example '10lb' or '30%'.",
                ));
            } else if arg(1).is_some_and(is_nan_int) {
                return Err(self.progression_arg(
                    value_node,
                    "lp",
                    1,
                    "number",
                    "2nd argument of 'lp' should be a number of attempts - i.e. a number",
                ));
            } else if arg(2).is_some_and(is_nan_int) {
                return Err(self.progression_arg(
                    value_node, "lp", 2, "number",
                    "3rd argument of 'lp' should be a current number of successful attempts up to date - i.e. a number",
                ));
            } else if arg(3).is_some_and(|a| !ends_with_weight_or_pct(a)) {
                return Err(self.progression_arg(
                    value_node, "lp", 3, WP,
                    "4th argument of 'lp' should be weight (ending with 'lb' or 'kg') or percentage (ending with '%'). For example '10lb' or '30%'.",
                ));
            } else if arg(4).is_some_and(is_nan_int) {
                return Err(self.progression_arg(
                    value_node,
                    "lp",
                    4,
                    "number",
                    "5th argument of 'lp' should be a number of failed attempts - i.e. a number",
                ));
            } else if arg(5).is_some_and(is_nan_int) {
                return Err(self.progression_arg(
                    value_node, "lp", 5, "number",
                    "6th argument of 'lp' should be a current number of failed attempts up to date - i.e. a number",
                ));
            }
        } else if fn_name == "sum" {
            if fn_args.len() > 2 {
                return Err(self.error(
                    "Reps Sum Progression 'sum' only has 2 arguments max",
                    value_node,
                    IErrorKind::ProgressionArity {
                        r#fn: "sum".to_string(),
                        max: 2,
                    },
                ));
            } else if arg(0).is_none_or(is_nan_int) {
                return Err(self.progression_arg(
                    value_node,
                    "sum",
                    0,
                    "number",
                    "1st argument of 'sum' should be a number of reps - i.e. a number",
                ));
            } else if arg(1).is_none_or(|a| !ends_with_weight_or_pct(a)) {
                return Err(self.progression_arg(
                    value_node, "sum", 1, WP,
                    "2nd argument of 'sum' should be weight (ending with 'lb' or 'kg') or percentage (ending with '%'). For example '10lb' or '30%'.",
                ));
            }
        } else if fn_name == "dp" {
            if fn_args.len() != 3 {
                return Err(self.error(
                    "Double Progression 'dp' should have 3 arguments",
                    value_node,
                    IErrorKind::ProgressionArity {
                        r#fn: "dp".to_string(),
                        max: 3,
                    },
                ));
            } else if arg(0).is_none_or(|a| !ends_with_weight_or_pct(a)) {
                return Err(self.progression_arg(
                    value_node, "dp", 0, WP,
                    "1st argument of 'dp' should be weight (ending with 'lb' or 'kg') or percentage (ending with '%'). For example '10lb' or '30%'.",
                ));
            } else if arg(1).is_none_or(is_nan_int) {
                return Err(self.progression_arg(
                    value_node,
                    "dp",
                    1,
                    "number",
                    "2nd argument of 'dp' should be min reps in the range - i.e. a number, like 8",
                ));
            } else if arg(2).is_none_or(is_nan_int) {
                return Err(self.progression_arg(
                    value_node,
                    "dp",
                    2,
                    "number",
                    "3rd argument of 'dp' should be max reps in the range - i.e. a number, like 12",
                ));
            }
        } else if fn_name == "custom" {
            let script = value_node
                .get_child(NodeKind::Liftoscript)
                .map(|n| self.value_trim(n));
            let body = self.reuse_body(value_node);
            let has_script = script.as_deref().is_some_and(|s| !s.is_empty());
            let has_body = body.as_deref().is_some_and(|s| !s.is_empty());
            if !has_script && !has_body {
                return Err(self.error(
                    "'custom' progression requires either to specify Liftoscript block or specify which one to reuse",
                    value_node,
                    IErrorKind::CustomWithoutScript { section: IPlannerReuseSection::Progress },
                ));
            }
        }
        Ok(())
    }

    fn evaluate_progress(
        &self,
        expr: &Node,
        exercise_type: Option<&IExerciseType>,
    ) -> Res<IProgramExerciseProgress> {
        match self.evaluate_progress_impl(expr, exercise_type)? {
            Ok(p) => Ok(p),
            Err(e) => Err(self.error_details(&e.message, expr, e.details)),
        }
    }

    /// `evaluateProgressImpl`: the outer `Result` is a thrown error, the inner one is the TS `IEither`.
    fn evaluate_progress_impl(
        &self,
        expr: &Node,
        exercise_type: Option<&IExerciseType>,
    ) -> Res<Result<IProgramExerciseProgress, ProgressBuildError>> {
        if expr.kind != NodeKind::ExerciseProperty {
            return Err(assert_node("ExerciseProperty"));
        }
        let Some(value_node) = expr.get_child(NodeKind::FunctionExpression) else {
            if expr.get_child(NodeKind::None).is_some() {
                return Ok(build_progress(
                    IProgramExerciseProgressType::None,
                    &[],
                    BuildProgressOpts::default(),
                ));
            }
            return Err(self.error(
                "Missing value for the property 'progress'",
                expr,
                IErrorKind::MissingPropertyValue {
                    property: "progress".to_string(),
                },
            ));
        };
        let fn_name_node = value_node
            .get_child(NodeKind::FunctionName)
            .ok_or_else(|| assert_node("FunctionName"))?;
        let fn_name = self.value(fn_name_node);
        let fn_args: Vec<String> = value_node
            .get_children(NodeKind::FunctionArgument)
            .into_iter()
            .map(|n| self.value(n))
            .collect();
        self.validate_progress(&fn_name, &fn_args, fn_name_node, value_node)?;
        let kind = match fn_name.as_str() {
            "lp" => IProgramExerciseProgressType::Lp,
            "sum" => IProgramExerciseProgressType::Sum,
            "dp" => IProgramExerciseProgressType::Dp,
            "custom" => IProgramExerciseProgressType::Custom,
            _ => IProgramExerciseProgressType::None,
        };
        if kind != IProgramExerciseProgressType::Custom {
            return Ok(build_progress(kind, &fn_args, BuildProgressOpts::default()));
        }
        let liftoscript_node = value_node.get_child(NodeKind::Liftoscript);
        let script = liftoscript_node.map(|n| self.value_trim(n));
        let mut on_error = |message: &str, value: &str| -> Result<(), PlannerSyntaxError> {
            Err(self.error(
                message,
                fn_name_node,
                IErrorKind::InvalidStateVariable {
                    value: value.to_string(),
                },
            ))
        };
        let (mut state, _) = fn_args_to_state_vars(&fn_args, &mut on_error)?;
        if let Some(s) = script.as_deref().filter(|s| !s.is_empty()) {
            let outcome = self.with_runner(
                s,
                &mut state,
                exercise_type.cloned(),
                IProgramMode::Planner,
                |r| r.parse().map(|_| ()),
            );
            if let Err(e) = outcome {
                return Err(match liftoscript_node {
                    Some(n) => {
                        let (line, _) = self.line_and_offset(n);
                        self.rethrow_script_error(e, line, n)
                    }
                    // TS rethrows the LiftoscriptSyntaxError itself; PlannerSyntaxError is the only error type here.
                    None => e.into(),
                });
            }
        }
        let body = self.reuse_body(value_node);
        Ok(build_progress(
            kind,
            &fn_args,
            BuildProgressOpts {
                script,
                reuse_fullname: body,
            },
        ))
    }

    /// Shifts a script error to the position of the script inside the planner text.
    fn rethrow_script_error(
        &self,
        e: LiftoscriptSyntaxError,
        line: i64,
        node: &Node,
    ) -> PlannerSyntaxError {
        PlannerSyntaxError::new(
            e.message,
            line + e.line,
            e.offset,
            node.from as i64 + e.from,
            node.from as i64 + e.to,
            e.details,
        )
    }

    fn evaluate_warmup(&self, expr: &Node) -> Res<Vec<IPlannerProgramExerciseWarmupSet>> {
        if expr.kind != NodeKind::ExerciseProperty {
            return Err(assert_node("ExerciseProperty"));
        }
        if expr.get_child(NodeKind::None).is_some() {
            return Ok(Vec::new());
        }
        if let Some(sets_node) = expr.get_child(NodeKind::WarmupExerciseSets) {
            let sets = sets_node.get_children(NodeKind::WarmupExerciseSet);
            if !sets.is_empty() {
                return sets
                    .into_iter()
                    .map(|s| self.evaluate_warmup_set(s))
                    .collect();
            }
        }
        Ok(Vec::new())
    }

    fn evaluate_superset(&self, expr: &Node) -> Res<IPlannerProgramExerciseSuperset> {
        if expr.kind != NodeKind::Superset {
            return Err(assert_node("Superset"));
        }
        match expr.get_child(NodeKind::ExerciseName) {
            Some(n) => Ok(IPlannerProgramExerciseSuperset {
                name: self.value(n),
            }),
            None => Err(assert_node("ExerciseName")),
        }
    }

    fn evaluate_property(
        &self,
        expr: &Node,
        exercise_type: Option<&IExerciseType>,
    ) -> Res<Section> {
        if expr.kind != NodeKind::ExerciseProperty {
            return Err(assert_node("ExerciseProperty"));
        }
        let name_node = expr
            .get_child(NodeKind::ExercisePropertyName)
            .ok_or_else(|| assert_node("ExercisePropertyName"))?;
        let name = self.value(name_node);
        match name.as_str() {
            "progress" => Ok(Section::Progress(
                self.evaluate_progress(expr, exercise_type)?,
            )),
            "update" => Ok(Section::Update(self.evaluate_update(expr, exercise_type)?)),
            "warmup" => Ok(Section::Warmup(self.evaluate_warmup(expr)?)),
            "id" => Ok(Section::Id(self.evaluate_id(expr)?)),
            "used" => Ok(Section::Used),
            _ => Err(self.error(
                &format!("There's no such property exists - '{}'", name),
                name_node,
                IErrorKind::UnknownProperty { name: name.clone() },
            )),
        }
    }

    fn get_reuse_week_day(&self, week_day_node: Option<&Node>) -> (Option<i64>, Option<i64>) {
        let Some(node) = week_day_node else {
            return (None, None);
        };
        let result: Vec<Option<i64>> = node
            .get_children(NodeKind::WeekOrDay)
            .into_iter()
            .map(|n| match children_of(n).first() {
                Some(c) if c.kind == NodeKind::Int => Some(js_parse_int(&self.value(c), 10) as i64),
                _ => None,
            })
            .collect();
        if result.len() == 1 {
            (None, result[0])
        } else {
            (
                result.first().copied().flatten(),
                result.get(1).copied().flatten(),
            )
        }
    }

    fn evaluate_reuse_node(&self, expr: &Node) -> Res<IPlannerProgramReuse> {
        if expr.kind != NodeKind::ReuseSectionWithWeekDay {
            return Err(assert_node("ReuseSectionWithWeekDay"));
        }
        let name_node = expr
            .get_child(NodeKind::ReuseSection)
            .and_then(|n| n.get_child(NodeKind::ExerciseName))
            .ok_or_else(|| assert_node("ExerciseName"))?;
        let name = self.value(name_node);
        let (week, day) = self.get_reuse_week_day(expr.get_child(NodeKind::WeekDay));
        Ok(IPlannerProgramReuse {
            full_name: name,
            source: IPlannerProgramReuseSource::Overall,
            week,
            day,
            exercise: None,
        })
    }

    fn evaluate_section(&self, expr: &Node, exercise_type: Option<&IExerciseType>) -> Res<Section> {
        if expr.kind != NodeKind::ExerciseSection {
            return Err(assert_node("ExerciseSection"));
        }
        if let Some(reuse_node) = expr.get_child(NodeKind::ReuseSectionWithWeekDay) {
            return Ok(Section::Reuse(self.evaluate_reuse_node(reuse_node)?));
        }
        if let Some(sets_node) = expr.get_child(NodeKind::ExerciseSets) {
            let sets = sets_node.get_children(NodeKind::ExerciseSet);
            let is_current = sets_node.get_child(NodeKind::CurrentVariation).is_some();
            if !sets.is_empty() {
                let data: Res<Vec<_>> = sets.into_iter().map(|s| self.evaluate_set(s)).collect();
                return Ok(Section::Sets {
                    data: data?,
                    is_current,
                });
            }
        }
        if let Some(superset) = expr.get_child(NodeKind::Superset) {
            return Ok(Section::Superset(self.evaluate_superset(superset)?));
        }
        match expr.get_child(NodeKind::ExerciseProperty) {
            Some(property) => self.evaluate_property(property, exercise_type),
            None => Err(assert_node("ExerciseProperty")),
        }
    }

    // ---- exercise level

    fn add_description(&mut self, value: &str) {
        let value = value.strip_prefix("//").unwrap_or(value);
        if self.latest_descriptions.is_empty() {
            self.latest_descriptions.push(Vec::new());
        }
        if let Some(last) = self.latest_descriptions.last_mut() {
            last.push(value.to_string());
        }
    }

    fn get_order(&self, expr: &Node) -> Res<i64> {
        if expr.kind != NodeKind::ExerciseExpression {
            return Err(assert_node("ExerciseExpression"));
        }
        let Some(repeat) = expr.get_child(NodeKind::Repeat) else {
            return Ok(0);
        };
        for c in children_of(repeat) {
            if c.kind == NodeKind::Rep {
                return Ok(js_parse_int(&self.value(c), 10) as i64);
            }
        }
        Ok(0)
    }

    fn get_repeat(&self, expr: &Node) -> Res<Vec<i64>> {
        if expr.kind != NodeKind::ExerciseExpression {
            return Err(assert_node("ExerciseExpression"));
        }
        let Some(repeat) = expr.get_child(NodeKind::Repeat) else {
            return Ok(Vec::new());
        };
        let mut result: BTreeSet<i64> = BTreeSet::new();
        for c in children_of(repeat) {
            if c.kind == NodeKind::RepRange {
                let nums: Vec<f64> = children_of(c)
                    .iter()
                    .map(|n| js_parse_int(&self.value(n), 10))
                    .collect();
                let from = nums.first().copied().unwrap_or(f64::NAN);
                let to = nums.get(1).copied().unwrap_or(f64::NAN);
                let mut i = from;
                while i <= to {
                    result.insert(i as i64);
                    i += 1.0;
                }
                break;
            }
        }
        Ok(result.into_iter().collect())
    }

    fn get_repeat_ranges(numbers: &[i64]) -> Vec<String> {
        if numbers.is_empty() {
            return Vec::new();
        }
        let mut ranges = Vec::new();
        let mut start = numbers[0];
        let mut end = numbers[0];
        for &n in &numbers[1..] {
            if n == end + 1 {
                end = n;
            } else {
                ranges.push(format!("{}-{}", start, end));
                start = n;
                end = n;
            }
        }
        ranges.push(format!("{}-{}", start, end));
        ranges
    }

    fn get_is_not_used(&self, expr: &Node) -> Res<bool> {
        if expr.kind != NodeKind::ExerciseExpression {
            // The TS asserts "ExerciseSection" here.
            return Err(assert_node("ExerciseSection"));
        }
        for section in expr.get_children(NodeKind::ExerciseSection) {
            for property in section.get_children(NodeKind::ExerciseProperty) {
                let name = property
                    .get_child(NodeKind::ExercisePropertyName)
                    .map(|n| self.value_trim(n));
                if name.as_deref() == Some("used") && property.get_child(NodeKind::None).is_some() {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    /// First property-name node among the sections whose text is `name`.
    fn property_name_node<'n>(&self, sections: &[&'n Node], name: &str) -> Option<&'n Node> {
        sections
            .iter()
            .filter_map(|s| {
                s.get_child(NodeKind::ExerciseProperty)
                    .and_then(|p| p.get_child(NodeKind::ExercisePropertyName))
            })
            .find(|n| self.value_trim(n) == name)
    }

    fn evaluate_exercise(&mut self, expr: &Node, uid: &mut dyn UidSource) -> Res<()> {
        match expr.kind {
            NodeKind::EmptyExpression | NodeKind::TripleLineComment => {
                if !self.latest_descriptions.is_empty() {
                    self.latest_descriptions.push(Vec::new());
                }
                Ok(())
            }
            NodeKind::Week => {
                if self.mode == PlannerExerciseEvaluatorMode::PerDay {
                    return Err(self.error(
                        "You cannot specify weeks in the per-day exercise lists. Switch to the full program mode for that.",
                        expr,
                        IErrorKind::WeeksNotAllowedInDayMode,
                    ));
                }
                let week_name = js_trim(self.value_trim(expr).trim_start_matches('#')).to_string();
                let (line, _) = self.line_and_offset(expr);
                self.weeks.push(IPlannerExerciseEvaluatorWeek {
                    name: week_name,
                    line,
                    days: Vec::new(),
                });
                // The TS reads week = weeks.length + 1 after the push, so it is one ahead of the week being read.
                self.day_data = IDayDataRequired {
                    day: self.day_data.day,
                    week: self.weeks.len() as i64 + 1,
                    day_in_week: 0,
                };
                Ok(())
            }
            NodeKind::Day => {
                if self.mode == PlannerExerciseEvaluatorMode::PerDay {
                    return Err(self.error(
                        "You cannot specify days in the per-day exercise lists. Switch to the full program mode for that.",
                        expr,
                        IErrorKind::DaysNotAllowedInDayMode,
                    ));
                }
                if self.weeks.is_empty() {
                    return Err(self.error(
                        "You need to specify a week before a day",
                        expr,
                        IErrorKind::DayWithoutWeek,
                    ));
                }
                let day_name = js_trim(self.value_trim(expr).trim_start_matches('#')).to_string();
                let (line, _) = self.line_and_offset(expr);
                if let Some(w) = self.weeks.last_mut() {
                    w.days.push(IPlannerExerciseEvaluatorDay {
                        name: day_name,
                        line,
                        exercises: Vec::new(),
                    });
                }
                self.day_data = IDayDataRequired {
                    day: self.day_data.day + 1,
                    week: self.day_data.week,
                    day_in_week: self.day_data.day_in_week + 1,
                };
                self.exercise_index = 0;
                Ok(())
            }
            NodeKind::LineComment => {
                let value = js_trim(&self.value_trim(expr)).to_string();
                self.add_description(&value);
                Ok(())
            }
            NodeKind::ExerciseExpression => self.evaluate_exercise_expression(expr, uid),
            _ => Err(self.error(
                &format!("Unexpected node type {}", expr.name()),
                expr,
                IErrorKind::UnexpectedNode {
                    node: expr.name().to_string(),
                },
            )),
        }
    }

    fn evaluate_exercise_expression(&mut self, expr: &Node, uid: &mut dyn UidSource) -> Res<()> {
        let last_week_has_no_days = self.weeks.last().is_none_or(|w| w.days.is_empty());
        if self.mode == PlannerExerciseEvaluatorMode::Full && last_week_has_no_days {
            return Err(self.error(
                "You should first define a week and a day before listing exercises.",
                expr,
                IErrorKind::ExerciseWithoutDay,
            ));
        } else if self.weeks.is_empty() {
            self.weeks.push(IPlannerExerciseEvaluatorWeek {
                name: "Week 1".to_string(),
                line: 1,
                days: vec![IPlannerExerciseEvaluatorDay {
                    name: "Day 1".to_string(),
                    line: 1,
                    exercises: Vec::new(),
                }],
            });
        }
        let variations_node = expr
            .get_child(NodeKind::ExerciseVariations)
            .ok_or_else(|| assert_node("ExerciseVariations"))?;
        let name_node = variations_node;
        let full_name = self.value(variations_node);
        let mut exercise_variations: Vec<IPlannerProgramExerciseVariation> = Vec::new();
        let mut label: Option<String> = None;
        for (i, variation_node) in variations_node
            .get_children(NodeKind::ExerciseVariation)
            .into_iter()
            .enumerate()
        {
            let is_current = variation_node
                .get_child(NodeKind::CurrentVariation)
                .is_some();
            let variation_name_node = variation_node
                .get_child(NodeKind::ExerciseName)
                .ok_or_else(|| assert_node("ExerciseName"))?;
            let variation_full_name = self.value(variation_name_node);
            let custom = self.view.custom_exercises();
            let parts = extract_name_parts_with(&variation_full_name, custom);
            if i == 0 {
                label = parts.label.clone();
            }
            let short = short_name_from_full_name_with(&variation_full_name, custom);
            let variation_exercise_type = exercise_find_by_name_and_equipment(&short, custom)
                .map(|e| exercise_to_i_exercise(&e, &self.settings.exercises));
            exercise_variations.push(IPlannerProgramExerciseVariation {
                exercise_type: variation_exercise_type,
                name: parts.name,
                is_current,
            });
        }
        let current_variation_index = exercise_variations.iter().position(|v| v.is_current);
        let active = exercise_variations.get(current_variation_index.unwrap_or(0));
        let name = active.map(|v| v.name.clone()).unwrap_or_default();
        let exercise: Option<IExerciseType> = active.and_then(|v| v.exercise_type.clone());
        let equipment: Option<String> = exercise.as_ref().and_then(|e| e.equipment.clone());
        let key = planner_key_from_exercise_variations(&exercise_variations, label.as_deref());
        let short_name = exercise_build_name(&name, &self.view, None, equipment.as_deref());
        let mut notused = self.get_is_not_used(expr)?;
        let section_nodes = expr.get_children(NodeKind::ExerciseSection);
        let mut set_variations: Vec<IPlannerProgramExerciseSetVariation> = Vec::new();
        let mut all_sets: Vec<IPlannerProgramExerciseSet> = Vec::new();
        let mut all_warmup_sets: Option<Vec<IPlannerProgramExerciseWarmupSet>> = None;
        let mut reuse: Option<IPlannerProgramReuse> = None;
        let repeat = self.get_repeat(expr)?;
        let order = self.get_order(expr)?;
        let text = js_trim(&self.value_trim(expr)).to_string();
        let mut tags: Vec<i64> = Vec::new();
        let mut progress: Option<IProgramExerciseProgress> = None;
        let mut update: Option<IProgramExerciseUpdate> = None;
        let mut superset: Option<IPlannerProgramExerciseSuperset> = None;
        let section_type = exercise.as_ref().map(|e| IExerciseType {
            id: e.id.clone(),
            equipment: equipment.clone(),
            extra: IndexMap::new(),
        });
        for section_node in &section_nodes {
            match self.evaluate_section(section_node, section_type.as_ref())? {
                Section::Sets { data, is_current } => {
                    all_sets.extend(data.iter().cloned());
                    if data.iter().any(|s| s.rep_range.is_some()) {
                        set_variations.push(IPlannerProgramExerciseSetVariation {
                            sets: data,
                            is_current,
                        });
                    }
                }
                Section::Warmup(data) => all_warmup_sets.get_or_insert_with(Vec::new).extend(data),
                Section::Progress(p) => progress = Some(p),
                Section::Update(u) => update = Some(u),
                Section::Reuse(r) => reuse = Some(r),
                Section::Id(t) => tags.extend(t),
                Section::Superset(s) => superset = Some(s),
                Section::Used => notused = true,
            }
        }
        let no_range = |s: &&IPlannerProgramExerciseSet| s.rep_range.is_none();
        let rpe = all_sets.iter().filter(no_range).find_map(|s| s.rpe);
        let timer = all_sets.iter().filter(no_range).find_map(|s| s.timer);
        let set_timer = all_sets.iter().filter(no_range).find_map(|s| s.set_timer);
        let is_overflow_set_timer = all_sets
            .iter()
            .filter(no_range)
            .find_map(|s| s.is_overflow_set_timer);
        let auto = all_sets.iter().filter(no_range).find_map(|s| s.auto);
        let percentage = all_sets.iter().filter(no_range).find_map(|s| s.percentage);
        let global_weight = all_sets.iter().filter(no_range).find_map(|s| s.weight);
        let log_rpe = all_sets.iter().filter(no_range).find_map(|s| s.log_rpe);
        let ask_weight = all_sets.iter().filter(no_range).find_map(|s| s.ask_weight);
        let (line, _) = self.line_and_offset(expr);
        let raw_descriptions: Vec<String> = self
            .latest_descriptions
            .iter()
            .map(|d| d.join("\n"))
            .collect();
        let current_description_index = raw_descriptions
            .iter()
            .position(|d| js_trim_start_bang(d).is_some());
        let mut descriptions: Vec<crate::types::IPlannerProgramExerciseDescription> =
            raw_descriptions
                .iter()
                .enumerate()
                .map(|(i, d)| crate::types::IPlannerProgramExerciseDescription {
                    value: js_trim_start_bang(d).unwrap_or_else(|| d.clone()),
                    is_current: Some(i) == current_description_index,
                })
                .collect();
        if descriptions.len() > 1 {
            descriptions.retain(|d| !d.value.is_empty());
        }
        for d in descriptions.iter_mut() {
            d.value = unindent(&d.value);
        }
        self.latest_descriptions = Vec::new();
        let full_name_point = self.point(name_node);
        let reuse_set_point = section_nodes
            .iter()
            .find_map(|n| n.get_child(NodeKind::ReuseSectionWithWeekDay))
            .map(|n| self.point(n));
        let progress_point = self
            .property_name_node(&section_nodes, "progress")
            .map(|n| self.point(n));
        let update_point = self
            .property_name_node(&section_nodes, "update")
            .map(|n| self.point(n));
        let id_point = self
            .property_name_node(&section_nodes, "id")
            .map(|n| self.point(n));
        // On the property name rather than on the sets, so `warmup: none` still records where it was written.
        let warmup_point = self
            .property_name_node(&section_nodes, "warmup")
            .map(|n| self.point(n));
        let superset_point = section_nodes
            .iter()
            .find_map(|n| n.get_child(NodeKind::Superset))
            .map(|n| self.point(n));

        let planner_exercise = IPlannerProgramExercise {
            id: uid.generate_uid(8),
            key,
            full_name,
            short_name,
            exercise_type: exercise,
            label,
            day_data: self.day_data,
            text,
            repeating: repeat.clone(),
            repeat,
            order,
            superset,
            name,
            equipment,
            exercise_index: self.exercise_index,
            line,
            tags,
            notused: Some(notused),
            evaluated_set_variations: Vec::new(),
            set_variations,
            exercise_variations,
            descriptions: IProgramExerciseDescriptions {
                values: descriptions,
                reuse: None,
            },
            warmup_sets: all_warmup_sets,
            reuse,
            progress,
            update,
            globals: IPlannerProgramExerciseGlobals {
                rpe,
                log_rpe,
                ask_weight,
                timer,
                set_timer,
                is_overflow_set_timer,
                auto,
                percentage,
                weight: global_weight,
            },
            points: IPlannerProgramExercisePoints {
                full_name: full_name_point,
                superset_point,
                reuse_set_point,
                progress_point,
                id_point,
                update_point,
                warmup_point,
            },
            is_repeat: None,
        };
        if let Some(day) = self.weeks.last_mut().and_then(|w| w.days.last_mut()) {
            day.exercises.push(planner_exercise);
        }
        if !notused {
            self.exercise_index += 1;
        }
        Ok(())
    }

    fn evaluate_program(
        &mut self,
        expr: &Node,
        uid: &mut dyn UidSource,
    ) -> Res<Vec<IPlannerExerciseEvaluatorWeek>> {
        if expr.kind != NodeKind::Program {
            return Err(self.error(
                &format!("Unexpected node type {}", expr.name()),
                expr,
                IErrorKind::UnexpectedNode {
                    node: expr.name().to_string(),
                },
            ));
        }
        self.weeks = Vec::new();
        self.exercise_index = 0;
        for child in children_of(expr) {
            self.evaluate_exercise(child, uid)?;
        }
        Ok(self.weeks.clone())
    }

    /// `evaluate(programNode)`. Ids come from `uid` (the TS uses `Math.random`).
    pub fn evaluate(
        &mut self,
        program_node: &Node,
        uid: &mut dyn UidSource,
    ) -> IPlannerEvalFullResult {
        let result = self
            .parse(program_node)
            .and_then(|_| self.evaluate_program(program_node, uid));
        result.into()
    }

    /// `hasWeightInUnit(programNode, unit)`
    pub fn has_weight_in_unit(&self, program_node: &Node, unit: IUnit) -> bool {
        fn walk(this: &PlannerExerciseEvaluator<'_>, n: &Node, unit: IUnit) -> bool {
            if this.get_weight(Some(n)).is_some_and(|w| w.unit == unit) {
                return true;
            }
            n.children().iter().any(|c| walk(this, c, unit))
        }
        walk(self, program_node, unit)
    }

    /// `switchWeightsToUnit(programNode, settings)`. A script error from the
    /// embedded Liftoscript propagates, as the TS exception does.
    pub fn switch_weights_to_unit(
        &self,
        program_node: &Node,
        settings: &ISettings,
    ) -> Result<String, LiftoscriptSyntaxError> {
        let mut nodes: Vec<&Node> = Vec::new();
        fn collect<'n>(n: &'n Node, out: &mut Vec<&'n Node>) {
            out.push(n);
            for c in n.children() {
                collect(c, out);
            }
        }
        collect(program_node, &mut nodes);
        let mut script: Vec<u16> = self.units.clone();
        let mut shift: i64 = 0;
        let splice = |script: &mut Vec<u16>, from: usize, to: usize, new: &str, shift: &mut i64| {
            let new16: Vec<u16> = new.encode_utf16().collect();
            let a = ((from as i64 + *shift).max(0) as usize).min(script.len());
            let b = ((to as i64 + *shift).max(0) as usize)
                .min(script.len())
                .max(a);
            let tail: Vec<u16> = script[b..].to_vec();
            script.truncate(a);
            script.extend_from_slice(&new16);
            script.extend(tail);
        };
        for node in nodes {
            if node.kind == NodeKind::Weight {
                if let Some(w) = self.get_weight(Some(node)) {
                    if w.unit != settings.units {
                        let old_str = weight::print(w);
                        let new_str = weight::print(weight::smart_convert(w, settings.units));
                        splice(&mut script, node.from, node.to, &new_str, &mut shift);
                        shift += new_str.encode_utf16().count() as i64
                            - old_str.encode_utf16().count() as i64;
                    }
                }
            } else if node.kind == NodeKind::Liftoscript {
                let old = self.value_trim(node);
                let mut state = IProgramState::new();
                let new = {
                    let day = IDayData {
                        day: 1,
                        week: Some(1),
                        day_in_week: Some(1),
                    };
                    let mut other_states = IndexMap::new();
                    let mut bindings = create_empty_script_bindings(&day, settings, None);
                    let fns = create_script_functions(settings);
                    let mut context = IScriptFnContext {
                        prints: Vec::new(),
                        unit: settings.units,
                        exercise_type: None,
                    };
                    let mut runner = ScriptRunner::new(
                        &old,
                        &mut state,
                        &mut other_states,
                        &mut bindings,
                        &fns,
                        settings.units,
                        &mut context,
                        IProgramMode::Planner,
                    );
                    runner.switch_weights_to_unit(settings.units)?
                };
                splice(&mut script, node.from, node.to, &new, &mut shift);
                shift += new.encode_utf16().count() as i64 - old.encode_utf16().count() as i64;
            }
        }
        Ok(String::from_utf16_lossy(&script))
    }

    /// `changeExerciseName(node, from, to)`
    pub fn change_exercise_name(&self, node: &Node, from: &str, to: &str) -> String {
        let mut script: Vec<u16> = self.units.clone();
        let mut shift: i64 = 0;
        fn walk<'n>(n: &'n Node, out: &mut Vec<&'n Node>) {
            out.push(n);
            for c in n.children() {
                walk(c, out);
            }
        }
        let mut nodes = Vec::new();
        walk(node, &mut nodes);
        for n in nodes {
            if n.kind == NodeKind::ExerciseName {
                let name = self.value(n);
                if name == from {
                    let to16: Vec<u16> = to.encode_utf16().collect();
                    let a = ((n.from as i64 + shift).max(0) as usize).min(script.len());
                    let b = ((n.to as i64 + shift).max(0) as usize)
                        .min(script.len())
                        .max(a);
                    let tail: Vec<u16> = script[b..].to_vec();
                    script.truncate(a);
                    script.extend_from_slice(&to16);
                    script.extend(tail);
                    shift += to.encode_utf16().count() as i64 - name.encode_utf16().count() as i64;
                }
            }
        }
        String::from_utf16_lossy(&script)
    }

    /// `changeWeightsToCompletedWeights(oldScript)`
    pub fn change_weights_to_completed_weights(old_script: &str) -> String {
        let tree = crate::planner_parse::parse(old_script);
        let mut nodes: Vec<&Node> = Vec::new();
        fn walk<'n>(n: &'n Node, out: &mut Vec<&'n Node>) {
            out.push(n);
            for c in n.children() {
                walk(c, out);
            }
        }
        walk(&tree, &mut nodes);
        let mut script: Vec<u16> = old_script.encode_utf16().collect();
        let mut shift: i64 = 0;
        for n in nodes {
            if n.kind == NodeKind::Liftoscript {
                let value = crate::planner_parse::slice16(old_script, n.from, n.to);
                let new_value =
                    crate::script_eval::LiftoscriptEvaluator::change_weights_to_complete_weights(
                        &value,
                    );
                let new16: Vec<u16> = new_value.encode_utf16().collect();
                let a = ((n.from as i64 + shift).max(0) as usize).min(script.len());
                let b = ((n.to as i64 + shift).max(0) as usize)
                    .min(script.len())
                    .max(a);
                let tail: Vec<u16> = script[b..].to_vec();
                script.truncate(a);
                script.extend_from_slice(&new16);
                script.extend(tail);
                shift += new16.len() as i64 - value.encode_utf16().count() as i64;
            }
        }
        String::from_utf16_lossy(&script)
    }

    /// `topLineMap(programNode)`
    pub fn top_line_map(&self, program_node: &Node) -> Res<Vec<IPlannerTopLineItem>> {
        if program_node.kind != NodeKind::Program {
            return Err(self.error(
                &format!(
                    "Unexpected node type {} - should be Program",
                    program_node.name()
                ),
                program_node,
                IErrorKind::UnexpectedNode {
                    node: program_node.name().to_string(),
                },
            ));
        }
        let mut result: Vec<IPlannerTopLineItem> = Vec::new();
        let mut last_descriptions: Vec<Vec<String>> = Vec::new();
        let mut ongoing_descriptions = false;
        let mut exercise_index: i64 = 0;
        let item = |kind, value: String| IPlannerTopLineItem {
            kind,
            value,
            exercise_index: None,
            notused: None,
            order: None,
            full_name: None,
            repeat: None,
            repeat_ranges: None,
            is_repeat: None,
            descriptions: None,
            sections: None,
            sections_to_reuse: None,
            used: None,
        };
        for child in children_of(program_node) {
            match child.kind {
                NodeKind::ExerciseExpression => {
                    ongoing_descriptions = false;
                    let name_node = child
                        .get_child(NodeKind::ExerciseVariations)
                        .ok_or_else(|| assert_node("ExerciseVariations"))?;
                    let full_name = self.value(name_node);
                    let key =
                        planner_key_from_full_name_with(&full_name, self.view.custom_exercises());
                    let repeat = self.get_repeat(child)?;
                    let repeat_ranges = Self::get_repeat_ranges(&repeat);
                    let order = self.get_order(child)?;
                    let is_used = !self.get_is_not_used(child)?;
                    let sections_nodes = child.get_children(NodeKind::ExerciseSection);
                    let sections = sections_nodes
                        .iter()
                        .map(|s| js_trim(&self.value_trim(s)).to_string())
                        .collect::<Vec<_>>()
                        .join(" / ");
                    let sections_to_reuse = sections_nodes
                        .iter()
                        .filter(
                            |section| match section.get_child(NodeKind::ExerciseProperty) {
                                None => true,
                                Some(properties) => {
                                    let property_name = properties
                                        .get_child(NodeKind::ExercisePropertyName)
                                        .map(|n| self.value(n));
                                    if property_name.as_deref() == Some("progress") {
                                        properties.get_child(NodeKind::None).is_some()
                                    } else {
                                        false
                                    }
                                }
                            },
                        )
                        .map(|s| js_trim(&self.value_trim(s)).to_string())
                        .collect::<Vec<_>>()
                        .join(" / ");
                    let mut it = item(IPlannerTopLineType::Exercise, key);
                    it.full_name = Some(full_name);
                    it.order = Some(order);
                    it.notused = Some(!is_used);
                    it.exercise_index = Some(exercise_index);
                    it.repeat = Some(repeat);
                    it.repeat_ranges = Some(repeat_ranges);
                    it.descriptions =
                        Some(last_descriptions.iter().map(|d| d.join("\n")).collect());
                    it.sections = Some(sections);
                    it.sections_to_reuse = Some(sections_to_reuse);
                    result.push(it);
                    if is_used {
                        exercise_index += 1;
                    }
                    last_descriptions = Vec::new();
                }
                NodeKind::LineComment => {
                    ongoing_descriptions = true;
                    let description = js_trim(&self.value_trim(child)).to_string();
                    if last_descriptions.is_empty() {
                        last_descriptions.push(Vec::new());
                    }
                    if let Some(l) = last_descriptions.last_mut() {
                        l.push(description.clone());
                    }
                    result.push(item(IPlannerTopLineType::Description, description));
                }
                NodeKind::TripleLineComment => {
                    result.push(item(
                        IPlannerTopLineType::Comment,
                        js_trim(&self.value_trim(child)).to_string(),
                    ));
                }
                NodeKind::EmptyExpression => {
                    result.push(item(IPlannerTopLineType::Empty, String::new()));
                    if ongoing_descriptions {
                        last_descriptions.push(Vec::new());
                    }
                }
                _ => {
                    return Err(self.error(
                        &format!(
                            "Unexpected node type {}, should be only exercise, comment, description or empty line",
                            child.name()
                        ),
                        child,
                        IErrorKind::UnexpectedNode { node: child.name().to_string() },
                    ));
                }
            }
        }
        Ok(result)
    }
}

/// `/^\s*!/` test and `.replace(/^\s*!/, "")` in one: `Some(rest)` when the
/// text starts with optional whitespace and a `!`.
fn js_trim_start_bang(s: &str) -> Option<String> {
    crate::js::js_trim_start(s)
        .strip_prefix('!')
        .map(|r| r.to_string())
}

// ---------------------------------------------------------------------------
// plannerExerciseEvaluatorText.ts

/// `IPlannerExerciseEvaluatorTextDay`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlannerExerciseEvaluatorTextDay {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub exercises: Vec<String>,
}

/// `IPlannerExerciseEvaluatorTextWeek`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IPlannerExerciseEvaluatorTextWeek {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub days: Vec<IPlannerExerciseEvaluatorTextDay>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NonExerciseKind {
    Comment,
    TripleLineComment,
    Empty,
}

#[derive(Debug, Clone)]
struct NonExerciseLine {
    kind: NonExerciseKind,
    line: String,
}

/// `fullTextLineToWeekdayDescription`
fn full_text_line_to_weekday_description(line: &NonExerciseLine) -> String {
    let strip = |prefix: &str, text: &str| -> String {
        // `.replace(/^\s*PREFIX\s*/, "")`
        match crate::js::js_trim_start(text).strip_prefix(prefix) {
            Some(rest) => crate::js::js_trim_start(rest).to_string(),
            None => text.to_string(),
        }
    };
    match line.kind {
        NonExerciseKind::Comment => js_trim(&strip("//", &line.line)).to_string(),
        NonExerciseKind::TripleLineComment => js_trim(&strip("///", &line.line)).to_string(),
        NonExerciseKind::Empty => String::new(),
    }
}

/// `PlannerExerciseEvaluatorText`: splits a full program text into weeks and days
/// of raw exercise text, keeping comments with the line they belong to.
pub struct PlannerExerciseEvaluatorText {
    units: Vec<u16>,
    weeks: Vec<IPlannerExerciseEvaluatorTextWeek>,
    ongoing_lines: Vec<NonExerciseLine>,
}

impl PlannerExerciseEvaluatorText {
    pub fn new(script: &str) -> Self {
        PlannerExerciseEvaluatorText {
            units: script.encode_utf16().collect(),
            weeks: Vec::new(),
            ongoing_lines: Vec::new(),
        }
    }

    fn value(&self, node: &Node) -> String {
        let to = node.to.min(self.units.len());
        let from = node.from.min(to);
        String::from_utf16_lossy(&self.units[from..to])
    }

    fn week_day_ongoing_lines(&self) -> (Vec<NonExerciseLine>, Vec<NonExerciseLine>) {
        let mut any_comment_started = false;
        let mut comment_started = false;
        let mut lines_to_previous_exercise: Vec<NonExerciseLine> = Vec::new();
        let mut next_lines: Vec<NonExerciseLine> = Vec::new();
        for line in &self.ongoing_lines {
            if !any_comment_started && line.kind == NonExerciseKind::Empty {
                continue;
            }
            if line.kind == NonExerciseKind::Comment
                || line.kind == NonExerciseKind::TripleLineComment
            {
                any_comment_started = true;
            }
            if line.kind == NonExerciseKind::Comment {
                comment_started = true;
            }
            if any_comment_started && !comment_started {
                lines_to_previous_exercise.push(line.clone());
            }
            if comment_started && line.kind == NonExerciseKind::Comment {
                next_lines.push(line.clone());
            }
        }
        while next_lines
            .last()
            .is_some_and(|l| l.kind == NonExerciseKind::Empty)
        {
            next_lines.pop();
        }
        while lines_to_previous_exercise
            .last()
            .is_some_and(|l| l.kind == NonExerciseKind::Empty)
        {
            lines_to_previous_exercise.pop();
        }
        (lines_to_previous_exercise, next_lines)
    }

    fn week_day_description_and_fill_last_day(&mut self) -> Option<String> {
        let (to_previous, next_lines) = self.week_day_ongoing_lines();
        if !to_previous.is_empty() {
            if let Some(day) = self.weeks.last_mut().and_then(|w| w.days.last_mut()) {
                day.exercises
                    .extend(to_previous.into_iter().map(|l| l.line));
            }
        }
        if next_lines.is_empty() {
            None
        } else {
            let joined = next_lines
                .iter()
                .map(full_text_line_to_weekday_description)
                .collect::<Vec<_>>()
                .join("\n");
            Some(js_trim(&joined).to_string())
        }
    }

    fn evaluate_line(&mut self, expr: &Node) {
        match expr.kind {
            NodeKind::Week => {
                let name = js_trim(self.value(expr).trim_start_matches('#')).to_string();
                let description = self.week_day_description_and_fill_last_day();
                self.weeks.push(IPlannerExerciseEvaluatorTextWeek {
                    name,
                    description,
                    days: Vec::new(),
                });
                self.ongoing_lines = Vec::new();
            }
            NodeKind::Day => {
                let name = js_trim(self.value(expr).trim_start_matches('#')).to_string();
                let description = self.week_day_description_and_fill_last_day();
                // The TS throws a TypeError when no week precedes the day; here the day is dropped.
                if let Some(w) = self.weeks.last_mut() {
                    w.days.push(IPlannerExerciseEvaluatorTextDay {
                        name,
                        exercises: Vec::new(),
                        description,
                    });
                }
                self.ongoing_lines = Vec::new();
            }
            NodeKind::EmptyExpression => {
                let line = self.value(expr);
                self.ongoing_lines.push(NonExerciseLine {
                    kind: NonExerciseKind::Empty,
                    line,
                });
            }
            NodeKind::LineComment => {
                let line = self.value(expr);
                self.ongoing_lines.push(NonExerciseLine {
                    kind: NonExerciseKind::Comment,
                    line,
                });
            }
            NodeKind::TripleLineComment => {
                let line = self.value(expr);
                self.ongoing_lines.push(NonExerciseLine {
                    kind: NonExerciseKind::TripleLineComment,
                    line,
                });
            }
            NodeKind::ExerciseExpression => {
                let text = self.value(expr);
                let ongoing: Vec<String> =
                    self.ongoing_lines.iter().map(|l| l.line.clone()).collect();
                if let Some(day) = self.weeks.last_mut().and_then(|w| w.days.last_mut()) {
                    day.exercises.extend(ongoing);
                    day.exercises.push(text);
                    self.ongoing_lines = Vec::new();
                }
            }
            _ => {}
        }
    }

    /// `evaluate(expr)`. The TS throws a plain `Error` for a non-Program node; that is the `Err`.
    pub fn evaluate(
        &mut self,
        expr: &Node,
    ) -> Result<Vec<IPlannerExerciseEvaluatorTextWeek>, String> {
        if expr.kind != NodeKind::Program {
            return Err(format!("Unexpected node type {}", expr.name()));
        }
        self.ongoing_lines = Vec::new();
        self.weeks = Vec::new();
        for child in expr.children() {
            self.evaluate_line(child);
        }
        Ok(self.weeks.clone())
    }
}

/// `PlannerProgram_evaluateText(fullProgramText)`: the planner program weeks
/// (names, descriptions and the raw exercise text of each day) of a full program text.
/// Lives here because it only wraps `PlannerExerciseEvaluatorText`.
pub fn planner_program_evaluate_text(
    full_program_text: &str,
) -> Vec<crate::types::IPlannerProgramWeek> {
    let tree = crate::planner_parse::parse(full_program_text);
    let data = PlannerExerciseEvaluatorText::new(full_program_text)
        .evaluate(&tree)
        .unwrap_or_default();
    let mut weeks: Vec<crate::types::IPlannerProgramWeek> = data
        .into_iter()
        .map(|week| crate::types::IPlannerProgramWeek {
            name: week.name,
            description: week.description,
            days: week
                .days
                .into_iter()
                .map(|day| crate::types::IPlannerProgramDay {
                    name: day.name,
                    description: day.description,
                    exercise_text: js_trim(&day.exercises.join("")).to_string(),
                    id: None,
                })
                .collect(),
            id: None,
        })
        .collect();
    if weeks.is_empty() {
        weeks.push(crate::types::IPlannerProgramWeek {
            name: "Week 1".to_string(),
            description: None,
            days: vec![crate::types::IPlannerProgramDay {
                name: "Day 1".to_string(),
                description: None,
                exercise_text: String::new(),
                id: None,
            }],
            id: None,
        });
    }
    weeks
}

#[cfg(test)]
pub(crate) mod tests;
