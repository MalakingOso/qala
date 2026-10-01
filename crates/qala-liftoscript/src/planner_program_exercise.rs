//! Port of `pages/planner/models/plannerProgramExercise.ts`: the parts the
//! evaluation path reaches. UI helpers (display sets, add set, progression
//! type, default args, create from entry, unique keys) are not ported.
//!
//! `reuse.exercise` is an owned tree here (`Box`), so the getters that follow
//! those pointers read a snapshot. `planner_eval` keeps its own arena while it
//! wires the pointers and only materializes the boxes when it returns.

use crate::exercise::{exercise_find_by_name, Exercise};
use crate::js::{js_truthy_num, js_truthy_str};
use crate::planner_exercise_eval::exercise_to_i_exercise;
pub use crate::planner_exercise_eval::{
    build_progress, short_name_from_full_name, BuildProgressOpts, ProgressBuildError,
};
use crate::types::exercise_view::custom_exercise_to_view;
use crate::types::{
    IExerciseType, IPlannerProgramExercise, IPlannerProgramExerciseEvaluatedSet,
    IPlannerProgramExerciseEvaluatedSetVariation, IPlannerProgramExerciseSet,
    IPlannerProgramExerciseSetVariation, IPlannerProgramExerciseVariation,
    IPlannerProgramExerciseWarmupSet, IProgramExerciseProgress, IProgramExerciseWarmupSet,
    IProgramState, IProgramStateMetadata, ISettings, WeightOrNumber, WeightOrPct,
};
use crate::util::math::round_to_0005;
use crate::weight;

/// `PlannerProgramExercise_getExercise`, as the `IExerciseType` (exercise
/// fields in `extra`) the script runner takes. `equipment` is the planner
/// exercise's, else the exercise's own, else its default.
pub fn get_exercise(planner_exercise: &IPlannerProgramExercise, settings: &ISettings) -> Option<IExerciseType> {
    let custom: crate::exercise::CustomExercises = settings
        .exercises
        .iter()
        .map(|(k, v)| (k.clone(), custom_exercise_to_view(v)))
        .collect();
    let mut exercise: Exercise = exercise_find_by_name(&planner_exercise.name, &custom)?;
    let from_planner = planner_exercise.equipment.as_deref().filter(|s| js_truthy_str(s));
    let own = exercise.equipment.as_deref().filter(|s| js_truthy_str(s));
    let default = exercise.default_equipment.as_deref().filter(|s| js_truthy_str(s));
    exercise.equipment = from_planner.or(own).or(default).map(|s| s.to_string());
    Some(exercise_to_i_exercise(&exercise, &settings.exercises))
}

/// `PlannerProgramExercise_setVariations`
pub fn set_variations(exercise: &IPlannerProgramExercise) -> Vec<IPlannerProgramExerciseSetVariation> {
    set_variations_with(exercise, exercise.reuse.as_ref().and_then(|r| r.exercise.as_deref()))
}

/// `set_variations` with the reused exercise given explicitly.
pub fn set_variations_with(
    exercise: &IPlannerProgramExercise,
    reuse_ex: Option<&IPlannerProgramExercise>,
) -> Vec<IPlannerProgramExerciseSetVariation> {
    let chosen: &[IPlannerProgramExerciseSetVariation] = if !exercise.set_variations.is_empty() {
        &exercise.set_variations
    } else {
        reuse_ex.map(|e| e.set_variations.as_slice()).unwrap_or(&[])
    };
    if chosen.is_empty() {
        vec![IPlannerProgramExerciseSetVariation { sets: sets_with(exercise, reuse_ex, None), is_current: true }]
    } else {
        chosen.to_vec()
    }
}

/// `PlannerProgramExercise_warmups`
pub fn warmups(exercise: &IPlannerProgramExercise) -> Option<&Vec<IPlannerProgramExerciseWarmupSet>> {
    exercise
        .warmup_sets
        .as_ref()
        .or_else(|| exercise.reuse.as_ref().and_then(|r| r.exercise.as_deref()).and_then(|e| e.warmup_sets.as_ref()))
}

/// `PlannerProgramExercise_programWarmups`
pub fn program_warmups(exercise: &IPlannerProgramExercise, settings: &ISettings) -> Option<Vec<IProgramExerciseWarmupSet>> {
    let exercise_warmups = warmups(exercise)?;
    let mut out = Vec::new();
    for ws in exercise_warmups {
        let mut i = 0.0;
        while i < ws.number_of_sets {
            let value: WeightOrNumber = match (ws.percentage, ws.weight) {
                (Some(p), _) if js_truthy_num(p) => WeightOrNumber::Number(p / 100.0),
                (_, Some(w)) => WeightOrNumber::Weight(w),
                _ => WeightOrNumber::Number(round_to_0005(weight::rpe_multiplier(ws.reps, 4.0))),
            };
            out.push(IProgramExerciseWarmupSet {
                reps: ws.reps,
                value,
                threshold: weight::build(0.0, settings.units),
            });
            i += 1.0;
        }
    }
    Some(out)
}

/// `PlannerProgramExercise_evaluateSetVariations`
pub fn evaluate_set_variations(
    exercise: &IPlannerProgramExercise,
    set_variations: &[IPlannerProgramExerciseSetVariation],
) -> Vec<IPlannerProgramExerciseEvaluatedSetVariation> {
    evaluate_set_variations_with(
        exercise,
        exercise.reuse.as_ref().and_then(|r| r.exercise.as_deref()),
        set_variations,
    )
}

/// `evaluate_set_variations` with the reused exercise given explicitly.
pub fn evaluate_set_variations_with(
    exercise: &IPlannerProgramExercise,
    reuse_ex: Option<&IPlannerProgramExercise>,
    set_variations: &[IPlannerProgramExerciseSetVariation],
) -> Vec<IPlannerProgramExerciseEvaluatedSetVariation> {
    let mut out = Vec::new();
    for (i, variation) in set_variations.iter().enumerate() {
        let mut evaluated: Vec<IPlannerProgramExerciseEvaluatedSet> = Vec::new();
        for a_set in sets_with(exercise, reuse_ex, Some(i)) {
            let Some(rep_range) = &a_set.rep_range else { continue };
            let mut j = 0.0;
            while j < rep_range.number_of_sets {
                let weight = match (a_set.weight, a_set.percentage) {
                    (Some(w), _) => Some(WeightOrPct::Weight(w)),
                    (None, Some(p)) if js_truthy_num(p) => Some(WeightOrPct::Percentage(weight::build_pct(p))),
                    _ => None,
                };
                evaluated.push(IPlannerProgramExerciseEvaluatedSet {
                    maxrep: rep_range.maxrep,
                    minrep: rep_range.minrep,
                    weight,
                    timer: a_set.timer,
                    set_timer: a_set.set_timer,
                    is_overflow_set_timer: a_set.is_overflow_set_timer,
                    auto: a_set.auto,
                    rpe: a_set.rpe,
                    log_rpe: a_set.log_rpe.unwrap_or(false),
                    label: a_set.label.clone(),
                    is_amrap: rep_range.is_amrap,
                    is_quick_add_set: rep_range.is_quick_add_set,
                    ask_weight: a_set.ask_weight.unwrap_or(false),
                });
                j += 1.0;
            }
        }
        out.push(IPlannerProgramExerciseEvaluatedSetVariation { sets: evaluated, is_current: variation.is_current });
    }
    out
}

/// `PlannerProgramExercise_sets`. The result carries the exercise's globals
/// (and the reused exercise's, where the exercise has none) applied to each set.
pub fn sets(exercise: &IPlannerProgramExercise, variation_index: Option<usize>) -> Vec<IPlannerProgramExerciseSet> {
    let reuse_ex = exercise.reuse.as_ref().and_then(|r| r.exercise.as_deref());
    sets_with(exercise, reuse_ex, variation_index)
}

/// `sets` with the reused exercise given explicitly (the evaluator keeps
/// pointers in an arena, not in `exercise.reuse.exercise`).
pub fn sets_with(
    exercise: &IPlannerProgramExercise,
    reuse_ex: Option<&IPlannerProgramExercise>,
    variation_index: Option<usize>,
) -> Vec<IPlannerProgramExerciseSet> {
    let reused_sets = reuse_ex.and_then(|r| {
        let idx = variation_index.unwrap_or_else(|| current_set_variation_index(r));
        r.set_variations.get(idx).map(|sv| &sv.sets)
    });
    let default_globals = crate::types::IPlannerProgramExerciseGlobals::default();
    let reused_globals = reuse_ex.map(|r| &r.globals).unwrap_or(&default_globals);
    let variation_index = variation_index.unwrap_or_else(|| current_set_variation_index(exercise));
    let current_sets = exercise.set_variations.get(variation_index).map(|sv| &sv.sets);
    let g = &exercise.globals;
    let chosen: &[IPlannerProgramExerciseSet] = match current_sets.or(reused_sets) {
        Some(s) => s,
        None => &[],
    };
    chosen
        .iter()
        .map(|a_set| {
            let mut set = a_set.clone();
            set.rpe = g.rpe.or(set.rpe).or(reused_globals.rpe);
            set.timer = g.timer.or(set.timer).or(reused_globals.timer);
            set.set_timer = g.set_timer.or(set.set_timer).or(reused_globals.set_timer);
            set.is_overflow_set_timer = if g.set_timer.is_some() {
                Some(g.is_overflow_set_timer.unwrap_or(false))
            } else {
                set.is_overflow_set_timer.or(reused_globals.is_overflow_set_timer)
            };
            set.auto = g.auto.or(set.auto).or(reused_globals.auto);
            if g.weight.is_some() || g.percentage.is_some() {
                if g.weight.is_some() {
                    set.weight = g.weight;
                    set.percentage = None;
                } else {
                    set.percentage = g.percentage;
                    set.weight = None;
                }
            } else {
                set.weight = set.weight.or(reused_globals.weight);
                set.percentage = set.percentage.or(reused_globals.percentage);
            }
            set.log_rpe = Some(match (g.rpe, g.log_rpe) {
                (Some(_), Some(l)) => l,
                _ => set.log_rpe.or(reused_globals.log_rpe).unwrap_or(false),
            });
            set.ask_weight = Some(
                match ((g.weight.is_some() || g.percentage.is_some()), g.ask_weight) {
                    (true, Some(a)) => a,
                    _ => set.ask_weight.or(reused_globals.ask_weight).unwrap_or(false),
                },
            );
            set
        })
        .collect()
}

/// `PlannerProgramExercise_currentSetVariationIndex`
pub fn current_set_variation_index(exercise: &IPlannerProgramExercise) -> usize {
    exercise.set_variations.iter().position(|sv| sv.is_current).unwrap_or(0)
}

/// `PlannerProgramExercise_currentEvaluatedSetVariationIndex`
pub fn current_evaluated_set_variation_index(exercise: &IPlannerProgramExercise) -> usize {
    exercise.evaluated_set_variations.iter().position(|sv| sv.is_current).unwrap_or(0)
}

/// `PlannerProgramExercise_currentEvaluatedSetVariation`. `None` where the TS indexes past the end.
pub fn current_evaluated_set_variation(
    exercise: &IPlannerProgramExercise,
) -> Option<&IPlannerProgramExerciseEvaluatedSetVariation> {
    exercise.evaluated_set_variations.get(current_evaluated_set_variation_index(exercise))
}

/// `PlannerProgramExercise_currentExerciseVariationIndex`
pub fn current_exercise_variation_index(exercise: &IPlannerProgramExercise) -> usize {
    exercise.exercise_variations.iter().position(|v| v.is_current).unwrap_or(0)
}

/// `PlannerProgramExercise_currentExerciseVariation`
pub fn current_exercise_variation(exercise: &IPlannerProgramExercise) -> Option<&IPlannerProgramExerciseVariation> {
    exercise.exercise_variations.get(current_exercise_variation_index(exercise))
}

/// `PlannerProgramExercise_currentDescriptionIndex`
pub fn current_description_index(exercise: &IPlannerProgramExercise) -> usize {
    exercise.descriptions.values.iter().position(|d| d.is_current).unwrap_or(0)
}

/// `PlannerProgramExercise_currentDescription`
pub fn current_description(exercise: &IPlannerProgramExercise) -> Option<&str> {
    exercise.descriptions.values.get(current_description_index(exercise)).map(|d| d.value.as_str())
}

fn progress_reuse_exercise(e: &IPlannerProgramExercise) -> Option<&IPlannerProgramExercise> {
    e.progress.as_ref().and_then(|p| p.reuse.as_ref()).and_then(|r| r.exercise.as_deref())
}

fn update_reuse_exercise(e: &IPlannerProgramExercise) -> Option<&IPlannerProgramExercise> {
    e.update.as_ref().and_then(|p| p.reuse.as_ref()).and_then(|r| r.exercise.as_deref())
}

pub(crate) fn overall_reuse_exercise(e: &IPlannerProgramExercise) -> Option<&IPlannerProgramExercise> {
    e.reuse.as_ref().and_then(|r| r.exercise.as_deref())
}

fn own_progress_script(e: &IPlannerProgramExercise) -> Option<&str> {
    e.progress.as_ref().and_then(|p| p.script.as_deref())
}

fn own_update_script(e: &IPlannerProgramExercise) -> Option<&str> {
    e.update.as_ref().and_then(|p| p.script.as_deref())
}

/// `PlannerProgramExercise_getProgressScript`
pub fn get_progress_script(exercise: &IPlannerProgramExercise) -> Option<&str> {
    own_progress_script(exercise)
        .or_else(|| progress_reuse_exercise(exercise).and_then(own_progress_script))
        .or_else(|| progress_reuse_exercise(exercise).and_then(progress_reuse_exercise).and_then(own_progress_script))
        .or_else(|| overall_reuse_exercise(exercise).and_then(own_progress_script))
        .or_else(|| overall_reuse_exercise(exercise).and_then(progress_reuse_exercise).and_then(own_progress_script))
}

/// `PlannerProgramExercise_getUpdateScript`
pub fn get_update_script(exercise: &IPlannerProgramExercise) -> Option<&str> {
    own_update_script(exercise)
        .or_else(|| update_reuse_exercise(exercise).and_then(own_update_script))
        .or_else(|| update_reuse_exercise(exercise).and_then(update_reuse_exercise).and_then(own_update_script))
        .or_else(|| overall_reuse_exercise(exercise).and_then(own_update_script))
        .or_else(|| overall_reuse_exercise(exercise).and_then(update_reuse_exercise).and_then(own_update_script))
}

/// `PlannerProgramExercise_getState`. The TS `visited` set only guards loops
/// that exist while a program is still being wired; a boxed tree has none.
pub fn get_state(exercise: &IPlannerProgramExercise) -> IProgramState {
    if let Some(p) = &exercise.progress {
        if p.reuse.is_none() {
            return p.state.clone();
        }
    }
    let mut state = match progress_reuse_exercise(exercise).or_else(|| overall_reuse_exercise(exercise)) {
        Some(e) => get_state(e),
        None => IProgramState::new(),
    };
    if let Some(p) = &exercise.progress {
        for (k, v) in &p.state {
            state.insert(k.clone(), *v);
        }
    }
    state
}

/// `PlannerProgramExercise_getStateMetadata`
pub fn get_state_metadata(exercise: &IPlannerProgramExercise) -> IProgramStateMetadata {
    if let Some(p) = &exercise.progress {
        if p.reuse.is_none() {
            return p.state_metadata.clone();
        }
    }
    let mut meta = match progress_reuse_exercise(exercise).or_else(|| overall_reuse_exercise(exercise)) {
        Some(e) => get_state_metadata(e),
        None => IProgramStateMetadata::new(),
    };
    if let Some(p) = &exercise.progress {
        for (k, v) in &p.state_metadata {
            meta.insert(k.clone(), v.clone());
        }
    }
    meta
}

/// `PlannerProgramExercise_getOnlyChangedState`
pub fn get_only_changed_state(exercise: &IPlannerProgramExercise) -> IProgramState {
    let original = progress_reuse_exercise(exercise).or_else(|| overall_reuse_exercise(exercise));
    let original_progress: Option<&IProgramExerciseProgress> = original.and_then(|e| e.progress.as_ref());
    let empty_state = IProgramState::new();
    let empty_meta = IProgramStateMetadata::new();
    let original_state = original_progress.map(|p| &p.state).unwrap_or(&empty_state);
    let original_meta = original_progress.map(|p| &p.state_metadata).unwrap_or(&empty_meta);
    let state = exercise.progress.as_ref().map(|p| &p.state).unwrap_or(&empty_state);
    let meta = exercise.progress.as_ref().map(|p| &p.state_metadata).unwrap_or(&empty_meta);
    state
        .iter()
        .filter(|(key, value)| match original_state.get(*key) {
            None => true,
            Some(orig) => {
                !weight::eq(*orig, **value)
                    || original_meta.get(*key).and_then(|m| m.user_prompted)
                        != meta.get(*key).and_then(|m| m.user_prompted)
            }
        })
        .map(|(k, v)| (k.clone(), *v))
        .collect()
}

/// `PlannerProgramExercise_isReusingSetsProgress`
pub fn is_reusing_sets_progress(exercise: &IPlannerProgramExercise) -> bool {
    let Some(reuse_exercise) = overall_reuse_exercise(exercise) else { return false };
    let (Some(rp), Some(p)) = (reuse_exercise.progress.as_ref(), exercise.progress.as_ref()) else {
        return false;
    };
    p.kind == rp.kind
        && (p.reuse.as_ref().map(|r| r.full_name.as_str()) == Some(reuse_exercise.full_name.as_str())
            || p.script == rp.script)
        && get_only_changed_state(exercise).is_empty()
}

/// `PlannerProgramExercise_buildDpRangeScript`
pub fn build_dp_range_script() -> String {
    "for (var.i in completedReps) {
  if (weights[var.i] == 0 && completedWeights[var.i] != 0) {
    weights[var.i] = completedWeights[var.i]
  }
}
if (completedReps >= reps && completedRPE <= RPE) {
  minReps = state.minReps
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
    minReps[var.i] = completedReps[var.i] + 1 > reps[var.i] ?
      reps[var.i] :
      completedReps[var.i] + 1
  }
}"
    .to_string()
}
