//! Port of `models/pp.ts`: iteration helpers over evaluated programs.
//!
//! The TS callbacks return `boolean | void` and stop the walk on a truthy
//! value. Here a callback returns `true` to stop.

use crate::types::{IEvaluatedProgramWeek, IPlannerEvalResult, IPlannerProgramExercise, IPlannerTopLineItem, IPlannerTopLineType};

/// `PP_iterate2`: walks every exercise of every day of every week. The
/// callback gets `(exercise, week_index, day_in_week_index, day_index, exercise_index)`
/// where `day_index` counts days across weeks.
pub fn iterate2<F>(evaluated_weeks: &[IEvaluatedProgramWeek], mut cb: F)
where
    F: FnMut(&IPlannerProgramExercise, usize, usize, usize, usize) -> bool,
{
    let mut day_index = 0;
    for (week_index, week) in evaluated_weeks.iter().enumerate() {
        for (day_in_week_index, day) in week.days.iter().enumerate() {
            for (exercise_index, exercise) in day.exercises.iter().enumerate() {
                if cb(exercise, week_index, day_in_week_index, day_index, exercise_index) {
                    return;
                }
            }
            day_index += 1;
        }
    }
}

/// `PP_iterateTopLineExercises`: walks the `exercise` lines of the grouped
/// top-line map (`[week][day][group][line]`). Indexes line up with `iterate2`.
pub fn iterate_top_line_exercises<F>(grouped_top_lines: &[Vec<Vec<Vec<IPlannerTopLineItem>>>], mut cb: F)
where
    F: FnMut(&IPlannerTopLineItem, usize, usize, usize) -> bool,
{
    let mut day_index = 0;
    for (week_index, week) in grouped_top_lines.iter().enumerate() {
        for (day_in_week_index, day) in week.iter().enumerate() {
            for group in day {
                for line in group {
                    if line.kind != IPlannerTopLineType::Exercise {
                        continue;
                    }
                    if cb(line, week_index, day_in_week_index, day_index) {
                        return;
                    }
                }
            }
            day_index += 1;
        }
    }
}

/// `PP_iterate`: like `iterate2` over per-day evaluation results; failed
/// days are skipped but still count toward `day_index`.
pub fn iterate<F>(evaluated_weeks: &[Vec<IPlannerEvalResult>], mut cb: F)
where
    F: FnMut(&IPlannerProgramExercise, usize, usize, usize, usize) -> bool,
{
    let mut day_index = 0;
    for (week_index, week) in evaluated_weeks.iter().enumerate() {
        for (day_in_week_index, day) in week.iter().enumerate() {
            if let Some(exercises) = day.data() {
                for (exercise_index, exercise) in exercises.iter().enumerate() {
                    if cb(exercise, week_index, day_in_week_index, day_index, exercise_index) {
                        return;
                    }
                }
            }
            day_index += 1;
        }
    }
}
