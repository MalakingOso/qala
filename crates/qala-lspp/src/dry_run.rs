//! Dry run (DECISIONS S21): "what do the next sessions look like if I hit every rep".
//!
//! Starting from an evaluated program, each session is prescribed (`next_history_entry` for
//! every used exercise of the day), then completed as if every set hit its planned reps at its
//! planned weight, then fed through the finish-day scripts (`run_all_finish_day_scripts`). That
//! returns the progressed program, which prescribes the next session, and so on. This is the
//! same loop the `finish_day_chain_*` and rotation goldens exercise.
//!
//! Read-only: the input program is borrowed, every step works on clones, and nothing is
//! persisted. Ids come from the caller's `UidSource`, so the same input gives the same output.
//!
//! A set with no weight and `?+` (askWeight) stays blank. The dry run never invents a weight
//! for it: it is reported with `blank: true`, completed at its planned reps with no completed
//! weight, and whatever the progression script does with that (usually it needs a first
//! workout) shows up in `errors`.

use serde::Serialize;

use crate::program;
use crate::runtime::{self, RunAllOpts};
use crate::stats;
use crate::types::{IDayData, IEvaluatedProgram, IHistoryEntry, ISettings, IWeight};
use crate::util::generator::UidSource;

#[derive(Debug, Clone, Default)]
pub struct DryRunOpts {
    /// Day to start from, 1-based over the whole program. Default: the program's `next_day`.
    pub from_day: Option<i64>,
    /// How many sessions to simulate. Default: the number of days in the program (one pass,
    /// which wraps if it starts mid-program). Capped at `MAX_SESSIONS`.
    pub sessions: Option<usize>,
    /// Also stop before the first session that falls in a later week than this (1-based).
    pub through_week: Option<i64>,
}

/// Most sessions a single call will simulate.
pub const MAX_SESSIONS: usize = 400;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DrySet {
    pub reps: Option<f64>,
    pub min_reps: Option<f64>,
    pub weight: Option<IWeight>,
    pub is_amrap: bool,
    pub ask_weight: bool,
    /// `?+` with no weight: left for the lifter to fill in.
    pub blank: bool,
    pub rpe: Option<f64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DryExercise {
    pub key: String,
    pub name: String,
    pub sets: Vec<DrySet>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DrySession {
    /// 0-based position in this dry run.
    pub session: usize,
    /// 1-based day number over the whole program.
    pub day: i64,
    pub week: i64,
    pub day_in_week: i64,
    pub name: String,
    pub exercises: Vec<DryExercise>,
    /// Finish-day script errors for this session.
    pub errors: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DryRunResult {
    pub sessions: Vec<DrySession>,
    /// Blank (`?+`, no weight) sets across all simulated sessions.
    pub blank_sets: usize,
    /// The progressed program as planner text, after the last simulated session.
    pub final_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DryRunError(pub String);

impl std::fmt::Display for DryRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DryRunError {}

fn dry_set(s: &crate::types::ISet) -> DrySet {
    let ask = s.ask_weight == Some(true);
    DrySet {
        reps: s.reps,
        min_reps: s.min_reps,
        weight: s.weight,
        is_amrap: s.is_amrap == Some(true),
        ask_weight: ask,
        blank: ask && s.weight.is_none(),
        rpe: s.rpe,
    }
}

/// Marks every set as completed at its planned reps and weight. Blank sets keep no weight.
fn complete_all_hit(entry: &IHistoryEntry, unit: crate::types::IUnit) -> IHistoryEntry {
    let mut e = entry.clone();
    for set in e.sets.iter_mut() {
        let blank = set.ask_weight == Some(true) && set.weight.is_none();
        set.completed_reps = Some(set.reps.unwrap_or(0.0));
        set.completed_weight = match set.weight {
            Some(w) => Some(w),
            None if blank => None,
            None => Some(crate::weight::build(0.0, unit)),
        };
        set.is_completed = Some(true);
    }
    e
}

/// Simulates sessions as described in the module docs. `program` is not modified.
pub fn dry_run(
    program: &IEvaluatedProgram,
    settings: &ISettings,
    opts: &DryRunOpts,
    uid: &mut dyn UidSource,
) -> Result<DryRunResult, DryRunError> {
    let planned = program::number_of_days(program).max(0) as usize;
    let limit = opts.sessions.unwrap_or(planned.max(1)).min(MAX_SESSIONS);
    let mut current = program.clone();
    let mut day = opts.from_day.unwrap_or(program.next_day);
    let empty_stats = stats::get_empty();
    let mut sessions = Vec::new();
    let mut blank_sets = 0;
    let mut final_text = String::new();

    for n in 0..limit {
        let Some(pd) = program::get_program_day(&current, day) else {
            if n == 0 {
                return Err(DryRunError(format!("no day {day} in this program")));
            }
            break;
        };
        let dd = pd.day_data;
        if let Some(w) = opts.through_week {
            if dd.week > w {
                break;
            }
        }
        let day_name = pd.name.clone();
        let day_data = IDayData { week: Some(dd.week), day: dd.day, day_in_week: Some(dd.day_in_week) };
        let used: Vec<_> = program::get_program_day_used_exercises(pd).into_iter().cloned().collect();

        let mut entries = Vec::new();
        let mut exercises = Vec::new();
        for (index, pe) in used.iter().enumerate() {
            let entry = program::next_history_entry(&current, &day_data, index as i64, pe, &empty_stats, settings, uid)
                .map_err(|e| DryRunError(format!("{}: {}", pe.full_name, e)))?;
            let sets: Vec<DrySet> = entry.sets.iter().map(dry_set).collect();
            blank_sets += sets.iter().filter(|s| s.blank).count();
            exercises.push(DryExercise { key: pe.key.clone(), name: pe.full_name.clone(), sets });
            entries.push(complete_all_hit(&entry, settings.units));
        }

        let out = runtime::run_all_finish_day_scripts(&current, day, &entries, settings, &empty_stats, RunAllOpts::default(), uid)
            .map_err(|e| DryRunError(e.message))?;
        sessions.push(DrySession {
            session: n,
            day,
            week: dd.week,
            day_in_week: dd.day_in_week,
            name: day_name,
            exercises,
            errors: out.errors,
        });
        final_text = out.planner_text;
        day = out.next_day;
        current = out.evaluated_program;
    }
    Ok(DryRunResult { sessions, blank_sets, final_text })
}

#[cfg(test)]
mod tests;
