//! Partial prescriptions (DECISIONS S21): `?+` as an explicit state to resolve, not an error.
//!
//! The language already has this: a set written `?+` evaluates to `askWeight: true` with no
//! weight, the built-in `lp` script treats a zero weight plus a completed weight as the
//! starting weight, and the workout screen shows an empty required field. What was missing is
//! a way to ask a program "which sets are still waiting for a weight", which the editor, the
//! importers and the dry run all need. This module is that query; it adds nothing to the
//! evaluator and changes no evaluated field.
//!
//! Two states are reported, both with `askWeight: true`:
//! - `blank`: no weight at all (`3x8 ?+`).
//! - `seeded`: a weight is present and the lifter is still asked (`3x8 0lb+`, `3x8 100lb+`).
//!
//! A set with no weight and no `+` (`3x8`) is not partial: it is a bodyweight or
//! script-driven set and nobody is being asked for anything.

use serde::Serialize;

use crate::types::{IEvaluatedProgram, WeightOrPct};

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PartialState {
    Blank,
    Seeded,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedSet {
    pub state: PartialState,
    /// 1-based week, day within the week, and day number over the whole program.
    pub week: i64,
    pub day_in_week: i64,
    pub day: i64,
    pub day_name: String,
    pub exercise_key: String,
    pub exercise_name: String,
    /// Which set variation (0-based) and which set within it (0-based).
    pub variation: usize,
    pub set_index: usize,
    /// 1-based line of the exercise within its day's text (the evaluator numbers lines per day).
    pub line: i64,
    pub weight: Option<WeightOrPct>,
    pub reps: Option<f64>,
}

/// Every set of the program that is still waiting for a weight, in program order.
pub fn unresolved_sets(program: &IEvaluatedProgram) -> Vec<UnresolvedSet> {
    let mut out = Vec::new();
    for week in &program.weeks {
        for day in &week.days {
            for ex in &day.exercises {
                if ex.notused == Some(true) {
                    continue;
                }
                for (vi, var) in ex.evaluated_set_variations.iter().enumerate() {
                    for (si, set) in var.sets.iter().enumerate() {
                        if !set.ask_weight {
                            continue;
                        }
                        out.push(UnresolvedSet {
                            state: if set.weight.is_none() { PartialState::Blank } else { PartialState::Seeded },
                            week: day.day_data.week,
                            day_in_week: day.day_data.day_in_week,
                            day: day.day_data.day,
                            day_name: day.name.clone(),
                            exercise_key: ex.key.clone(),
                            exercise_name: ex.full_name.clone(),
                            variation: vi,
                            set_index: si,
                            line: ex.line,
                            weight: set.weight,
                            reps: set.maxrep.or(set.minrep),
                        });
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
