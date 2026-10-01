//! Port of `pages/planner/models/plannerProgram.ts`, the evaluation path:
//! `isValid`, `evaluate`, `evaluateFull`, `evaluateText`, `generateFullText`,
//! `topLineItems`, `groupedTopLines` and `compact`. The editing and export
//! helpers (replaceWeight, replaceExercise, replaceAndValidateExercise,
//! modifyTopLineItems, topLineItemToText, switchToUnit, hasNonSelectedWeightUnit,
//! usedExercises, usedEquipment, convertExportedPlannerToProgram,
//! buildExportedProgram, getExportedPlannerProgram, thrownErrorMessage) are
//! only called from UI code and are not ported.
#![allow(clippy::result_large_err)]

use std::collections::HashMap;

use indexmap::{IndexMap, IndexSet};

pub use crate::planner_eval::{PlannerEvalFullOutput, PlannerEvalOutput};
/// `PlannerProgram_evaluateText`
pub use crate::planner_exercise_eval::planner_program_evaluate_text as evaluate_text;
use crate::js::{js_sort_by, js_trim};
use crate::planner_eval::{self, ExerciseOrderKey};
use crate::planner_exercise_eval::{PlannerExerciseEvaluator, PlannerExerciseEvaluatorMode};
use crate::planner_parse;
use crate::types::{
    IDayDataRequired, IPlannerEvalResult, IPlannerProgram, IPlannerProgramWeek, IPlannerTopLineItem,
    IPlannerTopLineType, ISettings, PlannerSyntaxError,
};
use crate::util::generator::UidSource;

/// `renameMapping` value of `PlannerProgram_compact`: `{ to, dayData? }`.
#[derive(Debug, Clone, PartialEq)]
pub struct RenameTarget {
    pub to: String,
    pub day_data: Option<IDayDataRequired>,
}

/// `PlannerProgram_isValid`
pub fn is_valid(program: Option<&IPlannerProgram>, settings: &ISettings, uid: &mut dyn UidSource) -> bool {
    let Some(program) = program else { return false };
    let out = evaluate(program, settings, uid);
    out.evaluated_weeks.iter().all(|week| week.iter().all(|day| day.is_success()))
}

/// `PlannerProgram_evaluate`
pub fn evaluate(program: &IPlannerProgram, settings: &ISettings, uid: &mut dyn UidSource) -> PlannerEvalOutput {
    planner_eval::evaluate(program, settings, uid)
}

/// `PlannerProgram_evaluateFull`
pub fn evaluate_full(text: &str, settings: &ISettings, uid: &mut dyn UidSource) -> PlannerEvalFullOutput {
    planner_eval::evaluate_full(text, settings, uid)
}

/// `PlannerProgram_generateFullText`
pub fn generate_full_text(weeks: &[IPlannerProgramWeek]) -> String {
    let mut full_text = String::new();
    for week in weeks {
        if let Some(description) = &week.description {
            let lines: Vec<String> = description
                .split('\n')
                .map(|l| if l.is_empty() { "//".to_string() } else { format!("// {}", l) })
                .collect();
            full_text.push_str(&lines.join("\n"));
            full_text.push('\n');
        }
        full_text.push_str(&format!("# {}\n", week.name));
        for day in &week.days {
            if let Some(description) = &day.description {
                let lines: Vec<String> = description.split('\n').map(|l| format!("// {}", l)).collect();
                full_text.push_str(&lines.join("\n"));
                full_text.push('\n');
            }
            full_text.push_str(&format!("## {}\n", day.name));
            full_text.push_str(&format!("{}\n\n", day.exercise_text));
        }
        full_text.push('\n');
    }
    full_text
}

/// One `topLineMap` per day, with `dayData` counting days across weeks.
fn top_line_maps(
    program: &IPlannerProgram,
    settings: &ISettings,
) -> Result<Vec<Vec<Vec<IPlannerTopLineItem>>>, PlannerSyntaxError> {
    let mut day_index = 0;
    let mut mapping = Vec::new();
    for (week_index, week) in program.weeks.iter().enumerate() {
        let mut week_map = Vec::new();
        for (day_in_week_index, day) in week.days.iter().enumerate() {
            let tree = planner_parse::parse(&day.exercise_text);
            let evaluator = PlannerExerciseEvaluator::new(
                &day.exercise_text,
                settings,
                PlannerExerciseEvaluatorMode::PerDay,
                Some(IDayDataRequired {
                    day: day_index + 1,
                    day_in_week: day_in_week_index as i64 + 1,
                    week: week_index as i64 + 1,
                }),
            );
            day_index += 1;
            week_map.push(evaluator.top_line_map(&tree)?);
        }
        mapping.push(week_map);
    }
    Ok(mapping)
}

/// `PlannerProgram_topLineItems`. The TS throws a `PlannerSyntaxError` from the evaluator; that is the `Err`.
pub fn top_line_items(
    program: &IPlannerProgram,
    settings: &ISettings,
) -> Result<Vec<Vec<Vec<IPlannerTopLineItem>>>, PlannerSyntaxError> {
    let mut mapping = top_line_maps(program, settings)?;
    for week_index in 0..mapping.len() {
        for day_index in 0..mapping[week_index].len() {
            // the TS iterates the live array, so an item pushed onto this very day is visited too
            let mut i = 0;
            while i < mapping[week_index][day_index].len() {
                let exercise = mapping[week_index][day_index][i].clone();
                i += 1;
                for r in exercise.repeat.clone().unwrap_or_default() {
                    if r < 1 {
                        continue;
                    }
                    let Some(reuse_day) = mapping.get_mut(r as usize - 1).and_then(|w| w.get_mut(day_index)) else {
                        continue;
                    };
                    let present = reuse_day
                        .iter()
                        .any(|e| e.kind == IPlannerTopLineType::Exercise && e.value == exercise.value);
                    if present {
                        continue;
                    }
                    if let Some(descriptions) = &exercise.descriptions {
                        for (di, d) in descriptions.iter().enumerate() {
                            if di != 0 {
                                reuse_day.push(plain_item(IPlannerTopLineType::Empty, ""));
                            }
                            reuse_day.push(plain_item(IPlannerTopLineType::Description, d));
                        }
                    }
                    let mut copy = exercise.clone();
                    copy.repeat = None;
                    copy.is_repeat = Some(true);
                    reuse_day.push(copy);
                }
            }
        }
    }
    Ok(mapping)
}

fn plain_item(kind: IPlannerTopLineType, value: &str) -> IPlannerTopLineItem {
    IPlannerTopLineItem {
        kind,
        value: value.to_string(),
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
    }
}

/// `PlannerProgram_groupedTopLines`
pub fn grouped_top_lines(top_line: Vec<Vec<Vec<IPlannerTopLineItem>>>) -> Vec<Vec<Vec<Vec<IPlannerTopLineItem>>>> {
    let mut grouped: Vec<Vec<Vec<Vec<IPlannerTopLineItem>>>> = Vec::new();
    for week in top_line {
        let mut week_groups = Vec::new();
        for day in week {
            let mut group: Vec<Vec<IPlannerTopLineItem>> = Vec::new();
            let mut reset = true;
            for line in day {
                if reset {
                    group.push(Vec::new());
                    reset = false;
                }
                let is_exercise = line.kind == IPlannerTopLineType::Exercise;
                if let Some(last) = group.last_mut() {
                    last.push(line);
                }
                if is_exercise {
                    reset = true;
                }
            }
            week_groups.push(group);
        }
        grouped.push(week_groups);
    }
    for week in grouped.iter_mut() {
        for day in week.iter_mut() {
            let groups = std::mem::take(day);
            *day = js_sort_by(groups, |g1, g2| {
                let ex1 = g1.iter().find(|l| l.kind == IPlannerTopLineType::Exercise);
                let ex2 = g2.iter().find(|l| l.kind == IPlannerTopLineType::Exercise);
                match (ex1, ex2) {
                    (Some(a), Some(b)) => planner_eval::compare_exercise_order(a.into(), b.into()) as f64,
                    _ => 0.0,
                }
            });
        }
    }
    grouped
}

impl From<&IPlannerTopLineItem> for ExerciseOrderKey {
    fn from(l: &IPlannerTopLineItem) -> Self {
        ExerciseOrderKey { exercise_index: l.exercise_index, notused: l.notused, is_repeat: l.is_repeat }
    }
}

fn exercises_of(day: &IPlannerEvalResult) -> Option<&Vec<crate::types::IPlannerProgramExercise>> {
    day.data()
}

/// `PlannerProgram_compact`. The TS mutates and returns `plannerProgram`; here it is taken and returned by value.
/// Where the TS would throw a `TypeError` for a week missing from the old evaluation, the lookup finds nothing.
pub fn compact(
    old_planner_program: &IPlannerProgram,
    mut planner_program: IPlannerProgram,
    settings: &ISettings,
    additional_repeating_exercises: Option<&IndexSet<String>>,
    rename_mapping: Option<&IndexMap<String, RenameTarget>>,
    uid: &mut dyn UidSource,
) -> Result<IPlannerProgram, PlannerSyntaxError> {
    let mut repeating_exercises: IndexSet<String> = IndexSet::new();
    let evaluated_weeks = evaluate(old_planner_program, settings, uid).evaluated_weeks;
    let new_evaluated_weeks = evaluate(&planner_program, settings, uid).evaluated_weeks;
    for ev in [&evaluated_weeks, &new_evaluated_weeks] {
        for week in ev.iter() {
            for day in week.iter() {
                for exercise in exercises_of(day).into_iter().flatten() {
                    if !exercise.repeat.is_empty() {
                        repeating_exercises.insert(exercise.key.clone());
                    }
                }
            }
        }
    }
    if let Some(extra) = additional_repeating_exercises {
        for ex in extra {
            repeating_exercises.insert(ex.clone());
        }
    }

    // keyed `${key}_${dayInWeekIndex}`
    let mut declaring_week_indexes: HashMap<String, IndexSet<usize>> = HashMap::new();
    for (week_index, week) in evaluated_weeks.iter().enumerate() {
        for (day_in_week_index, day) in week.iter().enumerate() {
            for exercise in exercises_of(day).into_iter().flatten() {
                if exercise.is_repeat != Some(true) && !exercise.repeat.is_empty() {
                    declaring_week_indexes
                        .entry(format!("{}_{}", exercise.key, day_in_week_index))
                        .or_default()
                        .insert(week_index);
                }
            }
        }
    }

    let old_key_for = |value: &str, week_index: usize, day_in_week_index: usize| -> String {
        let Some(mapping) = rename_mapping else { return value.to_string() };
        mapping
            .iter()
            .find(|(_, v)| {
                v.to == value
                    && v.day_data.is_none_or(|d| {
                        d.week == week_index as i64 + 1 && d.day_in_week == day_in_week_index as i64 + 1
                    })
            })
            .map(|(k, _)| k.clone())
            .unwrap_or_else(|| value.to_string())
    };

    let mut last_descriptions: HashMap<usize, Option<String>> = HashMap::new();
    for week in planner_program.weeks.iter_mut() {
        for (day_in_week_index, day) in week.days.iter_mut().enumerate() {
            match last_descriptions.get(&day_in_week_index) {
                None | Some(None) => {
                    last_descriptions.insert(day_in_week_index, day.description.clone());
                }
                Some(last) if *last == day.description => {
                    day.description = None;
                }
                Some(_) => {
                    last_descriptions.insert(day_in_week_index, day.description.clone());
                }
            }
        }
    }

    let mut mapping = top_line_maps(&planner_program, settings)?;

    for declaring_pass in [true, false] {
        for week_index in 0..mapping.len() {
            for day_index in 0..mapping[week_index].len() {
                for line_index in 0..mapping[week_index][day_index].len() {
                    let line = mapping[week_index][day_index][line_index].clone();
                    if line.kind != IPlannerTopLineType::Exercise
                        || line.used == Some(true)
                        || !repeating_exercises.contains(&line.value)
                    {
                        continue;
                    }
                    let declaring_key =
                        format!("{}_{}", old_key_for(&line.value, week_index, day_index), day_index);
                    let is_declaring = declaring_week_indexes
                        .get(&declaring_key)
                        .is_some_and(|s| s.contains(&week_index));
                    if is_declaring != declaring_pass {
                        continue;
                    }
                    let claim_week = |repeat_week_index: usize, mapping: &mut Vec<Vec<Vec<IPlannerTopLineItem>>>| -> bool {
                        let Some(repeat_day) = mapping.get_mut(repeat_week_index).and_then(|w| w.get_mut(day_index))
                        else {
                            return false;
                        };
                        let mut claimed = Vec::new();
                        for (i, e) in repeat_day.iter().enumerate() {
                            if e.kind != IPlannerTopLineType::Exercise
                                || e.used == Some(true)
                                || e.value != line.value
                                || e.sections_to_reuse != line.sections_to_reuse
                                || e.exercise_index != line.exercise_index
                                || e.descriptions.clone().unwrap_or_default()
                                    != line.descriptions.clone().unwrap_or_default()
                            {
                                continue;
                            }
                            let old_key = old_key_for(&line.value, repeat_week_index, day_index);
                            if declaring_week_indexes
                                .get(&format!("{}_{}", old_key, day_index))
                                .is_some_and(|s| s.contains(&repeat_week_index))
                            {
                                continue;
                            }
                            let old_exercise = evaluated_weeks
                                .get(repeat_week_index)
                                .and_then(|w| w.get(day_index))
                                .and_then(exercises_of)
                                .and_then(|d| d.iter().find(|ex| ex.key == old_key));
                            if old_exercise.is_some_and(|ex| ex.repeating.contains(&(week_index as i64 + 1))) {
                                claimed.push(i);
                            }
                        }
                        for i in &claimed {
                            repeat_day[*i].used = Some(true);
                        }
                        !claimed.is_empty()
                    };
                    let mut first_week = week_index + 1;
                    let mut last_week = week_index + 1;
                    let mut repeat_week_index = week_index + 1;
                    while repeat_week_index < mapping.len() {
                        if !claim_week(repeat_week_index, &mut mapping) {
                            break;
                        }
                        last_week = repeat_week_index + 1;
                        repeat_week_index += 1;
                    }
                    if declaring_pass {
                        let mut repeat_week_index = week_index as i64 - 1;
                        while repeat_week_index >= 0 {
                            if !claim_week(repeat_week_index as usize, &mut mapping) {
                                break;
                            }
                            first_week = repeat_week_index as usize + 1;
                            repeat_week_index -= 1;
                        }
                    }
                    mapping[week_index][day_index][line_index].repeat_ranges = Some(if first_week == last_week {
                        Vec::new()
                    } else {
                        vec![format!("{}-{}", first_week, last_week)]
                    });
                }
            }
        }
    }

    for (week_index, week) in mapping.iter().enumerate() {
        let Some(program_week) = planner_program.weeks.get_mut(week_index) else { continue };
        for (day_index, day) in week.iter().enumerate() {
            let Some(program_day) = program_week.days.get_mut(day_index) else { continue };
            let mut text = String::new();
            let mut ongoing_descriptions = false;
            for line in day {
                match line.kind {
                    IPlannerTopLineType::Description => {
                        ongoing_descriptions = true;
                    }
                    IPlannerTopLineType::Exercise => {
                        ongoing_descriptions = false;
                        if line.used != Some(true) {
                            if let Some(descriptions) = line.descriptions.as_ref().filter(|d| !d.is_empty()) {
                                let kept: Vec<&str> =
                                    descriptions.iter().map(|s| s.as_str()).filter(|d| !js_trim(d).is_empty()).collect();
                                text.push_str(&format!("{}\n", kept.join("\n\n")));
                            }
                            let mut repeat_str = String::new();
                            let has_order = line.order.is_some_and(|o| o != 0);
                            let has_ranges = line.repeat_ranges.as_ref().is_some_and(|r| !r.is_empty());
                            if has_order || has_ranges {
                                let mut parts: Vec<String> = Vec::new();
                                if let (true, Some(o)) = (has_order, line.order) {
                                    parts.push(o.to_string());
                                }
                                if let (true, Some(r)) = (has_ranges, line.repeat_ranges.as_ref()) {
                                    parts.push(r.join(","));
                                }
                                repeat_str = format!("[{}]", parts.join(","));
                            }
                            let name = format!(
                                "{}{}",
                                line.full_name.as_deref().unwrap_or("undefined"),
                                repeat_str
                            );
                            let mut parts = vec![name];
                            if let Some(s) = line.sections.as_ref().filter(|s| !s.is_empty()) {
                                parts.push(s.clone());
                            }
                            text.push_str(&format!("{}\n", parts.join(" / ")));
                        }
                    }
                    IPlannerTopLineType::Empty => {
                        if !ongoing_descriptions {
                            text.push_str(&format!("{}\n", line.value));
                        }
                    }
                    IPlannerTopLineType::Comment => {
                        text.push_str(&format!("{}\n", line.value));
                    }
                }
            }
            program_day.exercise_text = js_trim(&text).to_string();
        }
    }

    Ok(planner_program)
}
