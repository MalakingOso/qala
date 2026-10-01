//! Port of `models/programSet.ts`.

use crate::equipment::get_unit_or_default_for_exercise_type;
use crate::types::{IExerciseType, IPlannerProgramExerciseEvaluatedSet, IProgramSet, ISettings, IWeight};
use crate::weight;

/// `ProgramSet_group`: runs of consecutive sets with the same expressions. Like
/// the TS reduce, an empty input gives one empty group.
pub fn group(sets: &[IProgramSet]) -> Vec<Vec<IProgramSet>> {
    let mut memo: Vec<Vec<IProgramSet>> = vec![vec![]];
    for set in sets {
        let differs = memo.last().and_then(|g| g.last()).is_some_and(|last| {
            last.weight_expr != set.weight_expr
                || last.reps_expr != set.reps_expr
                || last.is_amrap != set.is_amrap
                || last.rpe_expr != set.rpe_expr
                || last.log_rpe != set.log_rpe
        });
        if differs {
            memo.push(vec![]);
        }
        if let Some(g) = memo.last_mut() {
            g.push(set.clone());
        }
    }
    memo
}

/// `ProgramSet_approxSetTimeMs`
pub fn approx_set_time_ms(reps: Option<f64>, rest_timer: f64) -> f64 {
    let seconds_per_rep = 7.0;
    let prepare_time = 20.0;
    let time_to_rep = (prepare_time + reps.unwrap_or(0.0) * seconds_per_rep) * 1000.0;
    let time_to_rest = rest_timer * 1000.0;
    time_to_rep + time_to_rest
}

/// `ProgramSet_approxRestTimer`: the set's own timer, else the superset timer, else the rest timer.
pub fn approx_rest_timer(set_timer: Option<f64>, rest_timer: f64, superset_timer: Option<f64>) -> f64 {
    set_timer.or(superset_timer).unwrap_or(rest_timer)
}

/// `ProgramSet_approxTimeMs`
pub fn approx_time_ms(set: &IPlannerProgramExerciseEvaluatedSet, settings: &ISettings, is_superset: bool) -> f64 {
    let superset_timer = if is_superset { settings.timers.superset } else { None };
    // `settings.timers.workout || 0`
    let workout = match settings.timers.workout {
        Some(Some(n)) if n != 0.0 && !n.is_nan() => n,
        _ => 0.0,
    };
    let rest_timer = approx_rest_timer(set.timer, workout, superset_timer);
    approx_set_time_ms(set.maxrep, rest_timer)
}

/// `ProgramSet_isEligibleForInferredWeight`
pub fn is_eligible_for_inferred_weight(set: &IPlannerProgramExerciseEvaluatedSet) -> bool {
    set.weight.is_none() && set.maxrep.is_some() && set.rpe.is_some()
}

/// `ProgramSet_getEvaluatedWeight`
pub fn get_evaluated_weight(
    program_set: &IPlannerProgramExerciseEvaluatedSet,
    exercise_type: &IExerciseType,
    settings: &ISettings,
) -> Option<IWeight> {
    let unit = get_unit_or_default_for_exercise_type(settings, Some(exercise_type));
    let evaluated = match program_set.weight {
        Some(w) => Some(weight::evaluate_weight(w, exercise_type, settings)),
        None => match (
            is_eligible_for_inferred_weight(program_set),
            program_set.maxrep,
            program_set.rpe,
        ) {
            (true, Some(maxrep), Some(rpe)) => Some(weight::evaluate_weight(
                weight::rpe_pct(maxrep, rpe),
                exercise_type,
                settings,
            )),
            _ => None,
        },
    };
    evaluated.map(|w| weight::round_convert_to(w, settings, unit, Some(exercise_type)))
}
