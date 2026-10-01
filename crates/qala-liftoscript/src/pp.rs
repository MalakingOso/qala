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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::tests::{arg, check, parse_cases};
    use serde_json::{json, Value};

    // Expected values come from the TS oracle (testdata/unit/gen_unit_cases.ts
    // over models/pp.ts, results in cases_pp.json).

    fn stopper<'a>(stop: Option<&'a str>) -> impl Fn(&str) -> bool + 'a {
        move |k| stop == Some(k)
    }

    #[test]
    fn matches_oracle() {
        let cases = parse_cases(include_str!("../testdata/unit/cases_pp.json"));
        let mut errors = Vec::new();
        for c in &cases {
            let stop = c.args[1].as_str();
            let stop_at = stopper(stop);
            let mut out: Vec<Value> = Vec::new();
            match c.f.as_str() {
                "iterate2" => {
                    let weeks: Vec<IEvaluatedProgramWeek> = arg(&c.args[0]);
                    iterate2(&weeks, |ex, w, d, di, ei| {
                        out.push(json!([ex.key, w, d, di, ei]));
                        stop_at(&ex.key)
                    });
                }
                "iterate" => {
                    let weeks: Vec<Vec<IPlannerEvalResult>> = arg(&c.args[0]);
                    iterate(&weeks, |ex, w, d, di, ei| {
                        out.push(json!([ex.key, w, d, di, ei]));
                        stop_at(&ex.key)
                    });
                }
                "iterateTopLineExercises" => {
                    let top: Vec<Vec<Vec<Vec<IPlannerTopLineItem>>>> = arg(&c.args[0]);
                    iterate_top_line_exercises(&top, |line, w, d, di| {
                        out.push(json!([line.value, w, d, di]));
                        stop_at(&line.value)
                    });
                }
                other => panic!("unhandled {other}"),
            }
            check(c, &c.args[1].to_string(), Ok(Value::Array(out)), false, &mut errors);
        }
        assert!(errors.is_empty(), "{} of {} cases differ, first:\n{}", errors.len(), cases.len(), errors.join("\n"));
    }
}
