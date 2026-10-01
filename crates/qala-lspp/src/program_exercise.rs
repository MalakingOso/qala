//! Port of `models/programExercise.ts`.
//!
use indexmap::IndexMap;

use crate::js::js_truthy_num;
use crate::pp;
use crate::planner_program_exercise as ppe;
use crate::program_set;
use crate::script_runner::ScriptRunner;
use crate::types::{
    IEvaluatedProgram, IExerciseType, ILiftoscriptEvaluatorUpdate, IPlannerProgramExercise,
    IPlannerProgramExerciseEvaluatedSet, IProgramExerciseWarmupSet,
    ISettings, ITargetIndex, IUnit, IWeightChange, ScriptValue, WeightOrPct,
};
use crate::util::collection::sort_by;
use crate::util::math::{self, IAssignmentOp};
use crate::weight;

/// `ProgramExercise_hasUserPromptedVars`
pub fn has_user_prompted_vars(program_exercise: &IPlannerProgramExercise) -> bool {
    ppe::get_state_metadata(program_exercise)
        .values()
        .any(|m| m.user_prompted.unwrap_or(false))
}

/// `ProgramExercise_getQuickAddSets`
pub fn get_quick_add_sets(program_exercise: &IPlannerProgramExercise) -> bool {
    ppe::sets(program_exercise, None)
        .iter()
        .any(|set| set.rep_range.as_ref().is_some_and(|r| r.is_quick_add_set))
}

/// `ProgramExercise_getEnableRpe`
pub fn get_enable_rpe(program_exercise: &IPlannerProgramExercise) -> bool {
    ppe::sets(program_exercise, None)
        .iter()
        .any(|set| set.rpe.is_some())
}

fn warmup_set_to_key(set: &IProgramExerciseWarmupSet) -> String {
    format!(
        "{}-{}-{}",
        crate::js::js_number_to_string(set.reps),
        weight::print(set.threshold),
        weight::print_or_number(set.value)
    )
}

/// `ProgramExercise_groupWarmupsSets`: consecutive equal sets collapse to `(first, count)`.
pub fn group_warmups_sets(
    sets: &[IProgramExerciseWarmupSet],
) -> Vec<(IProgramExerciseWarmupSet, usize)> {
    let mut last_key: Option<String> = None;
    let mut groups: Vec<(IProgramExerciseWarmupSet, usize)> = Vec::new();
    for set in sets {
        let key = warmup_set_to_key(set);
        if last_key.as_deref() != Some(key.as_str()) {
            groups.push((set.clone(), 0));
        }
        if let Some(g) = groups.last_mut() {
            g.1 += 1;
        }
        last_key = Some(key);
    }
    groups
}

/// `ProgramExercise_approxTimeMs`
pub fn approx_time_ms(program_exercise: &IPlannerProgramExercise, settings: &ISettings) -> f64 {
    let current = program_exercise
        .evaluated_set_variations
        .get(ppe::current_evaluated_set_variation_index(program_exercise));
    match current {
        Some(sv) => {
            let total: f64 = sv.sets.iter().fold(0.0, |memo, set| {
                memo + program_set::approx_time_ms(set, settings, program_exercise.superset.is_some())
            });
            if js_truthy_num(total) {
                total
            } else {
                0.0
            }
        }
        None => 0.0,
    }
}

/// `ProgramExercise_doesUse1RM`
pub fn does_use_1rm(program_exercise: &IPlannerProgramExercise) -> bool {
    let uses_percentage_weights = program_exercise.evaluated_set_variations.iter().any(|v| {
        v.sets.iter().any(|set| {
            matches!(set.weight, Some(WeightOrPct::Percentage(_)))
                || program_set::is_eligible_for_inferred_weight(set)
        })
    });
    let uses_rm1_var = is_using_variable(program_exercise, "rm1");
    uses_percentage_weights || uses_rm1_var
}

/// `ProgramExercise_doesUseRPE`
pub fn does_use_rpe(program_exercise: &IPlannerProgramExercise) -> bool {
    if program_exercise.globals.log_rpe == Some(true) || program_exercise.globals.rpe.is_some() {
        return true;
    }
    program_exercise
        .evaluated_set_variations
        .iter()
        .any(|v| v.sets.iter().any(|set| set.log_rpe || set.rpe.is_some()))
}

/// `ProgramExercise_isUsingVariable`
pub fn is_using_variable(program_exercise: &IPlannerProgramExercise, name: &str) -> bool {
    [
        ppe::get_progress_script(program_exercise),
        ppe::get_update_script(program_exercise),
    ]
    .into_iter()
    .flatten()
    .filter(|e| !e.is_empty())
    .any(|e| ScriptRunner::has_keyword(e, name))
}

/// `ProgramExercise_weightChanges`
pub fn weight_changes(
    program: &IEvaluatedProgram,
    program_exercise_key: &str,
) -> Vec<IWeightChange> {
    let mut results: IndexMap<String, IWeightChange> = IndexMap::new();
    pp::iterate2(&program.weeks, |exercise, _, _, _, _| {
        if exercise.key == program_exercise_key {
            let current_variation_index = ppe::current_evaluated_set_variation_index(exercise);
            for (variation_index, variation) in exercise.evaluated_set_variations.iter().enumerate()
            {
                for set in &variation.sets {
                    if let Some(w) = set.weight {
                        let key = weight::print(w);
                        let was_current = results.get(&key).is_some_and(|r| r.current);
                        results.insert(
                            key,
                            IWeightChange {
                                original_weight: w,
                                weight: w,
                                current: was_current
                                    || variation_index + 1 == current_variation_index,
                            },
                        );
                    }
                }
            }
        }
        false
    });
    let values: Vec<IWeightChange> = results.into_values().collect();
    sort_by(&values, |c| if c.current { 1.0 } else { 0.0 }, true)
}

/// `target[i] === "*" || target[i] === n`; a missing or `"_"` entry never matches.
fn target_matches(target: &[ITargetIndex], i: usize, n: usize) -> bool {
    match target.get(i) {
        Some(ITargetIndex::Wildcard) => true,
        Some(ITargetIndex::Index(x)) => *x == n as f64,
        _ => false,
    }
}

/// JS `Array.prototype.splice(start)` start clamp.
fn splice_start(len: usize, start: f64) -> usize {
    let rel = if start.is_nan() { 0.0 } else { start.trunc() };
    if rel < 0.0 {
        let from_end = len as f64 + rel;
        if from_end < 0.0 {
            0
        } else {
            from_end as usize
        }
    } else if rel > len as f64 {
        len
    } else {
        rel as usize
    }
}

/// `arr[index]` for a JS number index: `Some` only for an integer in range.
fn js_index(index: f64, len: usize) -> Option<usize> {
    if index.is_nan() || index != index.trunc() || index < 0.0 || index >= len as f64 {
        None
    } else {
        Some(index as usize)
    }
}

fn update_parts(
    update: &ILiftoscriptEvaluatorUpdate,
) -> (&'static str, ScriptValue, IAssignmentOp, &[ITargetIndex]) {
    use ILiftoscriptEvaluatorUpdate as U;
    let num = |v: &crate::types::ILiftoscriptVariableValue<crate::types::JsNumber>| {
        ScriptValue::Number(v.value.0)
    };
    match update {
        U::SetVariationIndex(v) => ("setVariationIndex", num(v), v.op, &v.target),
        U::ExerciseVariationIndex(v) => ("exerciseVariationIndex", num(v), v.op, &v.target),
        U::DescriptionIndex(v) => ("descriptionIndex", num(v), v.op, &v.target),
        U::Reps(v) => ("reps", num(v), v.op, &v.target),
        U::MinReps(v) => ("minReps", num(v), v.op, &v.target),
        U::Weights(v) => ("weights", v.value, v.op, &v.target),
        U::Timers(v) => ("timers", num(v), v.op, &v.target),
        U::SetTime(v) => ("setTime", num(v), v.op, &v.target),
        U::Rpe(v) => ("RPE", num(v), v.op, &v.target),
        U::Logrpes(v) => ("logrpes", num(v), v.op, &v.target),
        U::Amraps(v) => ("amraps", num(v), v.op, &v.target),
        U::Askweights(v) => ("askweights", num(v), v.op, &v.target),
        U::NumberOfSets(v) => ("numberOfSets", num(v), v.op, &v.target),
    }
}

/// `ProgramExercise_applyVariables`: applies the updates a script produced to
/// every matching exercise of the evaluated program, in place.
pub fn apply_variables(
    program_exercise_key: &str,
    program: &mut IEvaluatedProgram,
    updates: &[ILiftoscriptEvaluatorUpdate],
    settings: &ISettings,
) {
    for update in updates {
        let (key, value, op, target) = update_parts(update);
        for week_index in 0..program.weeks.len() {
            for day_in_week_index in 0..program.weeks[week_index].days.len() {
                for exercise_pos in 0..program.weeks[week_index].days[day_in_week_index]
                    .exercises
                    .len()
                {
                    let exercise = &mut program.weeks[week_index].days[day_in_week_index].exercises
                        [exercise_pos];
                    if exercise.exercise_type.is_none() || exercise.key != program_exercise_key {
                        continue;
                    }
                    apply_to_exercise(
                        exercise,
                        key,
                        value,
                        op,
                        target,
                        week_index,
                        day_in_week_index,
                        settings,
                    );
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_to_exercise(
    exercise: &mut IPlannerProgramExercise,
    key: &str,
    value: ScriptValue,
    op: IAssignmentOp,
    target: &[ITargetIndex],
    week_index: usize,
    day_in_week_index: usize,
    settings: &ISettings,
) {
    let exercise_type = exercise.exercise_type.clone().unwrap_or_default();
    let week_day_match = target_matches(target, 0, week_index + 1)
        && target_matches(target, 1, day_in_week_index + 1);
    for variation_index in 0..exercise.evaluated_set_variations.len() {
        let variation_match = week_day_match && target_matches(target, 2, variation_index + 1);
        let sets = &mut exercise.evaluated_set_variations[variation_index].sets;
        if variation_match && key == "numberOfSets" {
            if let ScriptValue::Number(v) = value {
                let new_value = math::apply_op(sets.len() as f64, v, op);
                let default_set = IPlannerProgramExerciseEvaluatedSet {
                    maxrep: Some(1.0),
                    weight: Some(WeightOrPct::Weight(weight::build(100.0, IUnit::Lb))),
                    log_rpe: false,
                    is_amrap: false,
                    is_quick_add_set: false,
                    ask_weight: false,
                    ..Default::default()
                };
                let last_set = sets.last().cloned().unwrap_or(default_set);
                sets.truncate(splice_start(sets.len(), new_value));
                let mut i = sets.len() as f64;
                while i < new_value {
                    sets.push(last_set.clone());
                    i += 1.0;
                }
            }
        }
        for (set_index, set) in sets.iter_mut().enumerate() {
            if variation_match && target_matches(target, 3, set_index + 1) {
                let set_key = match key {
                    "RPE" => Some(SetKey::Rpe),
                    "reps" => Some(SetKey::Maxrep),
                    "minReps" => Some(SetKey::Minrep),
                    "timers" => Some(SetKey::Timer),
                    "setTime" => Some(SetKey::SetTimer),
                    "weights" => Some(SetKey::Weight),
                    "amraps" => Some(SetKey::IsAmrap),
                    "logrpes" => Some(SetKey::LogRpe),
                    "askweights" => Some(SetKey::AskWeight),
                    _ => None,
                };
                if let Some(k) = set_key {
                    operation(&exercise_type, set, settings, k, value, op);
                }
            }
        }
    }
    if !week_day_match {
        return;
    }
    let ScriptValue::Number(v) = value else {
        return;
    };
    match key {
        "setVariationIndex" => {
            let mut index_value = if op == IAssignmentOp::Assign {
                v - 1.0
            } else {
                let current = ppe::current_evaluated_set_variation_index(exercise) as f64;
                weight::apply_op(
                    None,
                    ScriptValue::Number(current),
                    ScriptValue::Number(v),
                    op,
                )
                .value()
            };
            index_value %= exercise.evaluated_set_variations.len() as f64;
            for s in exercise.evaluated_set_variations.iter_mut() {
                s.is_current = false;
            }
            if let Some(i) = js_index(index_value, exercise.evaluated_set_variations.len()) {
                exercise.evaluated_set_variations[i].is_current = true;
            }
        }
        "exerciseVariationIndex" => {
            let len = exercise.exercise_variations.len();
            if len > 0 {
                let mut index_value = if op == IAssignmentOp::Assign {
                    v - 1.0
                } else {
                    let current = ppe::current_exercise_variation_index(exercise) as f64;
                    weight::apply_op(
                        None,
                        ScriptValue::Number(current),
                        ScriptValue::Number(v),
                        op,
                    )
                    .value()
                };
                let l = len as f64;
                index_value = ((index_value % l) + l) % l;
                for var in exercise.exercise_variations.iter_mut() {
                    var.is_current = false;
                }
                if let Some(i) = js_index(index_value, len) {
                    exercise.exercise_variations[i].is_current = true;
                    if let Some(t) = exercise.exercise_variations[i].exercise_type.clone() {
                        exercise.exercise_type = Some(t);
                    }
                }
            }
        }
        "descriptionIndex" => {
            let mut index_value = if op == IAssignmentOp::Assign {
                v - 1.0
            } else {
                let current = ppe::current_description_index(exercise) as f64;
                weight::apply_op(
                    None,
                    ScriptValue::Number(current),
                    ScriptValue::Number(v),
                    op,
                )
                .value()
            };
            index_value %= exercise.descriptions.values.len() as f64;
            for d in exercise.descriptions.values.iter_mut() {
                d.is_current = false;
            }
            if let Some(i) = js_index(index_value, exercise.descriptions.values.len()) {
                exercise.descriptions.values[i].is_current = true;
            }
        }
        _ => {}
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SetKey {
    Maxrep,
    Minrep,
    Weight,
    Rpe,
    Timer,
    SetTimer,
    LogRpe,
    IsAmrap,
    AskWeight,
}

/// Writes `value` into the set field the way the TS `operation` does: a weight
/// or percentage goes to `weight`, a number to the numeric keys, and a number
/// to the boolean keys as `value !== 0`. Anything else is ignored.
fn assign(set: &mut IPlannerProgramExerciseEvaluatedSet, key: SetKey, value: ScriptValue) {
    match (key, value) {
        (SetKey::Weight, ScriptValue::Weight(w)) => set.weight = Some(WeightOrPct::Weight(w)),
        (SetKey::Weight, ScriptValue::Percentage(p)) => {
            set.weight = Some(WeightOrPct::Percentage(p))
        }
        (SetKey::Maxrep, ScriptValue::Number(n)) => set.maxrep = Some(n),
        (SetKey::Minrep, ScriptValue::Number(n)) => set.minrep = Some(n),
        (SetKey::Timer, ScriptValue::Number(n)) => set.timer = Some(n),
        (SetKey::SetTimer, ScriptValue::Number(n)) => set.set_timer = Some(n),
        (SetKey::Rpe, ScriptValue::Number(n)) => set.rpe = Some(n),
        (SetKey::AskWeight, ScriptValue::Number(n)) => set.ask_weight = n != 0.0,
        (SetKey::IsAmrap, ScriptValue::Number(n)) => set.is_amrap = n != 0.0,
        (SetKey::LogRpe, ScriptValue::Number(n)) => set.log_rpe = n != 0.0,
        _ => {}
    }
}

fn operation(
    exercise_type: &IExerciseType,
    set: &mut IPlannerProgramExerciseEvaluatedSet,
    settings: &ISettings,
    key: SetKey,
    value: ScriptValue,
    op: IAssignmentOp,
) {
    if op == IAssignmentOp::Assign {
        assign(set, key, value);
        return;
    }
    let onerm = weight::onerm(exercise_type, settings);
    let mut old_value: Option<ScriptValue> = match key {
        SetKey::Maxrep => set.maxrep.map(ScriptValue::Number),
        SetKey::Minrep => set.minrep.map(ScriptValue::Number),
        SetKey::Timer => set.timer.map(ScriptValue::Number),
        SetKey::SetTimer => set.set_timer.map(ScriptValue::Number),
        SetKey::Rpe => set.rpe.map(ScriptValue::Number),
        SetKey::Weight => set.weight.map(ScriptValue::from),
        SetKey::LogRpe => Some(ScriptValue::Number(if set.log_rpe { 1.0 } else { 0.0 })),
        SetKey::IsAmrap => Some(ScriptValue::Number(if set.is_amrap { 1.0 } else { 0.0 })),
        SetKey::AskWeight => Some(ScriptValue::Number(if set.ask_weight { 1.0 } else { 0.0 })),
    };
    if old_value.is_none() && program_set::is_eligible_for_inferred_weight(set) {
        old_value = program_set::get_evaluated_weight(set, exercise_type, settings).map(ScriptValue::Weight);
    }
    let new_value = weight::apply_op(
        Some(onerm),
        old_value.unwrap_or(ScriptValue::Number(0.0)),
        value,
        op,
    );
    assign(set, key, new_value);
}

#[cfg(test)]
mod tests;
