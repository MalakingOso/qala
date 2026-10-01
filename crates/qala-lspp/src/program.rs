//! Port of `models/program.ts`: evaluated-program construction and day
//! navigation, plus `Program_nextHistoryEntry`.
//!
//! Not ported (nothing on the evaluation path reaches them):
//! `Program_evaluateCachedPlanner`, `Program_evaluatePlannerWeeks`,
//! `Program_findPlannerExercise`, `Program_changeExerciseName` (they sit on
//! `PlannerEvaluator_evaluate` / the cached evaluator),
//! `Program_exportedPlannerProgramToExportedProgram` (export shell).
//! `Program_evaluate` is the memoized `Program_forceEvaluate`; here it is the
//! same function (no cache).
//!
//! Randomness enters through a `UidSource` argument, as in the other modules.

use indexmap::IndexMap;

use crate::exercise::{exercise_get_is_unilateral, warmup_values, ExerciseSettings, ExerciseType};
use crate::equipment::get_unit_or_default_for_exercise_type;
use crate::js::{js_order_keys, js_parse_float};
use crate::planner_eval;
use crate::planner_program_exercise as ppe;
use crate::pp;
use crate::progress::{self, UpdateScriptExercise};
use crate::program_exercise;
use crate::program_set;
use crate::types::{
    EvaluatedProgramType, HistoryEntryVtype, IByTag, IDayData, IDayDataRequired, IEvaluatedProgram,
    IEvaluatedProgramDay, IEvaluatedProgramError, IEvaluatedProgramWeek, IExerciseType, IHistoryEntry,
    IPlannerEvalResult, IPlannerProgram, IPlannerProgramDay, IPlannerProgramExercise,
    IPlannerProgramWeek, IProgram, IProgramExerciseWarmupSet, IProgramState, ISet, ISettings, IStats,
    IWeight, PlannerVtype, ProgramVtype, ScriptValue, SetVtype, WeightOrNumber, WeightOrPct,
};
use crate::util::collection::sort_by;
use crate::util::generator::UidSource;
use crate::weight;

/// An error the TS would throw as a non-syntax exception (a `TypeError` from
/// reading a missing field, for example). Library code returns it instead.
#[derive(Debug, Clone, PartialEq)]
pub struct ProgramError(pub String);

impl std::fmt::Display for ProgramError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ProgramError {}

// ---------------------------------------------------------------------------
// listing

/// `Program_getAllProgramExercises`
pub fn get_all_program_exercises(program: &IEvaluatedProgram) -> Vec<&IPlannerProgramExercise> {
    program
        .weeks
        .iter()
        .flat_map(|w| w.days.iter().flat_map(|d| d.exercises.iter()))
        .collect()
}

/// `Program_getAllUsedProgramExercises`: not `notused` and typed.
pub fn get_all_used_program_exercises(program: &IEvaluatedProgram) -> Vec<&IPlannerProgramExercise> {
    get_all_program_exercises(program)
        .into_iter()
        .filter(|e| e.notused != Some(true) && e.exercise_type.is_some())
        .collect()
}

/// `Program_getAllProgramExercisesWithType`
pub fn get_all_program_exercises_with_type(program: &IEvaluatedProgram) -> Vec<&IPlannerProgramExercise> {
    get_all_program_exercises(program)
        .into_iter()
        .filter(|e| e.exercise_type.is_some())
        .collect()
}

/// `Program_getProgramExerciseByTypeWeekAndDay`
pub fn get_program_exercise_by_type_week_and_day<'a>(
    program: &'a IEvaluatedProgram,
    exercise_type: &IExerciseType,
    week_number: i64,
    day_in_week: i64,
) -> Option<&'a IPlannerProgramExercise> {
    for (week_index, week) in program.weeks.iter().enumerate() {
        for (day_in_week_index, day) in week.days.iter().enumerate() {
            for e in &day.exercises {
                if week_index as i64 + 1 == week_number
                    && day_in_week_index as i64 + 1 == day_in_week
                    && e.exercise_type.as_ref().is_some_and(|t| t == exercise_type)
                {
                    return Some(e);
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// evaluation

fn empty_evaluated_program(program: &IProgram) -> IEvaluatedProgram {
    IEvaluatedProgram {
        kind: EvaluatedProgramType,
        id: program.id.clone(),
        planner: IPlannerProgram {
            vtype: PlannerVtype,
            name: program.name.clone(),
            weeks: vec![IPlannerProgramWeek {
                name: "Week 1".to_string(),
                description: None,
                days: vec![IPlannerProgramDay {
                    name: "Day 1".to_string(),
                    description: None,
                    exercise_text: String::new(),
                    id: None,
                }],
                id: None,
            }],
        },
        name: program.name.clone(),
        errors: vec![],
        next_day: program.next_day,
        weeks: vec![IEvaluatedProgramWeek {
            name: "Week 1".to_string(),
            description: None,
            days: vec![IEvaluatedProgramDay {
                name: "Day 1".to_string(),
                day_data: IDayDataRequired { day: 1, week: 1, day_in_week: 1 },
                description: None,
                exercises: vec![],
            }],
        }],
        states: IndexMap::new(),
    }
}

fn build_weeks(
    planner: &IPlannerProgram,
    evaluated_weeks: &[Vec<IPlannerEvalResult>],
) -> (Vec<IEvaluatedProgramWeek>, Vec<IEvaluatedProgramError>) {
    let mut day_num = 0;
    let mut errors = Vec::new();
    let mut weeks = Vec::new();
    for (week_index, week) in planner.weeks.iter().enumerate() {
        let mut days = Vec::new();
        for (day_in_week_index, day) in week.days.iter().enumerate() {
            day_num += 1;
            let day_data = IDayDataRequired {
                day: day_num,
                week: week_index as i64 + 1,
                day_in_week: day_in_week_index as i64 + 1,
            };
            let evaluated_day = evaluated_weeks.get(week_index).and_then(|w| w.get(day_in_week_index));
            let exercises = match evaluated_day.and_then(|d| d.data()) {
                Some(data) => sort_by(data, |e| e.order as f64, false),
                None => vec![],
            };
            if let Some(error) = evaluated_day.and_then(|d| d.error()) {
                errors.push(IEvaluatedProgramError { error: error.clone(), day_data });
            }
            days.push(IEvaluatedProgramDay {
                name: day.name.clone(),
                description: day.description.clone(),
                day_data,
                exercises,
            });
        }
        weeks.push(IEvaluatedProgramWeek {
            name: week.name.clone(),
            description: week.description.clone(),
            days,
        });
    }
    (weeks, errors)
}

fn build_evaluated_program(
    program: &IProgram,
    planner: &IPlannerProgram,
    evaluated_weeks: &[Vec<IPlannerEvalResult>],
) -> IEvaluatedProgram {
    let (weeks, errors) = build_weeks(planner, evaluated_weeks);
    let mut states: IByTag<IProgramState> = IndexMap::new();
    pp::iterate(evaluated_weeks, |exercise, _, _, _, _| {
        for tag in &exercise.tags {
            let entry = states.entry(tag.to_string()).or_default();
            for (k, v) in ppe::get_state(exercise) {
                entry.insert(k, v);
            }
        }
        false
    });
    IEvaluatedProgram {
        kind: EvaluatedProgramType,
        id: program.id.clone(),
        errors,
        planner: planner.clone(),
        name: program.name.clone(),
        next_day: program.next_day,
        weeks,
        states: js_order_keys(states),
    }
}

/// `Program_forceEvaluate`
pub fn force_evaluate(program: &IProgram, settings: &ISettings, uid: &mut dyn UidSource) -> IEvaluatedProgram {
    let Some(planner) = &program.planner else {
        return empty_evaluated_program(program);
    };
    let out = planner_eval::force_evaluate(planner, settings, uid);
    build_evaluated_program(program, planner, &out.evaluated_weeks)
}

/// `Program_evaluate` (the memoized `forceEvaluate`; no cache here).
pub fn evaluate(program: &IProgram, settings: &ISettings, uid: &mut dyn UidSource) -> IEvaluatedProgram {
    force_evaluate(program, settings, uid)
}

/// `Program_getNumberOfExerciseInstances`
pub fn get_number_of_exercise_instances(program: &IEvaluatedProgram, exercise_key: &str) -> usize {
    let mut count = 0;
    pp::iterate2(&program.weeks, |e, _, _, _, _| {
        if e.key == exercise_key {
            count += 1;
        }
        false
    });
    count
}

/// `Program_uses1RM`
pub fn uses_1rm(program: &IEvaluatedProgram) -> bool {
    get_all_program_exercises(program)
        .into_iter()
        .any(program_exercise::does_use_1rm)
}

/// `Program_usesRPE`
pub fn uses_rpe(program: &IEvaluatedProgram) -> bool {
    get_all_program_exercises(program)
        .into_iter()
        .any(program_exercise::does_use_rpe)
}

// ---------------------------------------------------------------------------
// day navigation

/// `Program_numberOfDays`
pub fn number_of_days(program: &IEvaluatedProgram) -> i64 {
    program.weeks.iter().map(|w| w.days.len() as i64).sum()
}

/// `Program_getWeekFromDay`
pub fn get_week_from_day(program: &IEvaluatedProgram, day: i64) -> i64 {
    let mut days_total = 0;
    for (i, week) in program.weeks.iter().enumerate() {
        days_total += week.days.len() as i64;
        if days_total >= day {
            return i as i64 + 1;
        }
    }
    1
}

fn day_number(day_counts: impl Iterator<Item = usize>, week: i64, day_in_week: i64) -> i64 {
    let mut day_index = 1;
    for (w, count) in day_counts.enumerate() {
        for d in 0..count {
            if w as i64 == week - 1 && d as i64 == day_in_week - 1 {
                return day_index;
            }
            day_index += 1;
        }
    }
    -1
}

/// `Program_getDayNumber` for an evaluated program. -1 when not found.
pub fn get_day_number(program: &IEvaluatedProgram, week: i64, day_in_week: i64) -> i64 {
    day_number(program.weeks.iter().map(|w| w.days.len()), week, day_in_week)
}

/// `Program_getDayNumber` for a planner program.
pub fn get_day_number_planner(program: &IPlannerProgram, week: i64, day_in_week: i64) -> i64 {
    day_number(program.weeks.iter().map(|w| w.days.len()), week, day_in_week)
}

/// `Program_getDayInWeek`
pub fn get_day_in_week(program: &IEvaluatedProgram, day: i64) -> i64 {
    let mut days_total = 0;
    for week in &program.weeks {
        days_total += week.days.len() as i64;
        if days_total >= day {
            return day - (days_total - week.days.len() as i64);
        }
    }
    1
}

/// `Program_getDayData`
pub fn get_day_data(program: &IEvaluatedProgram, day: i64) -> IDayDataRequired {
    IDayDataRequired {
        day,
        week: get_week_from_day(program, day),
        day_in_week: get_day_in_week(program, day),
    }
}

/// `Program_getProgramDay`
pub fn get_program_day(program: &IEvaluatedProgram, day: i64) -> Option<&IEvaluatedProgramDay> {
    let mut a_day = 0;
    for week in &program.weeks {
        for d in &week.days {
            a_day += 1;
            if day == a_day {
                return Some(d);
            }
        }
    }
    None
}

/// `Program_getProgramDay`, mutable.
pub fn get_program_day_mut(program: &mut IEvaluatedProgram, day: i64) -> Option<&mut IEvaluatedProgramDay> {
    let mut a_day = 0;
    for week in program.weeks.iter_mut() {
        for d in week.days.iter_mut() {
            a_day += 1;
            if day == a_day {
                return Some(d);
            }
        }
    }
    None
}

/// `Program_getDayName`. The TS interpolates `programDay?.name`, so a missing
/// day gives the text "undefined".
pub fn get_day_name(program: &IEvaluatedProgram, day: i64) -> String {
    let day_data = get_day_data(program, day);
    let program_day = get_program_day(program, day);
    let week = usize::try_from(day_data.week - 1).ok().and_then(|i| program.weeks.get(i));
    let is_multiweek = program.weeks.len() > 1 && week.is_some();
    let prefix = match (is_multiweek, week) {
        (true, Some(w)) => format!("{} - ", w.name),
        _ => String::new(),
    };
    let name = program_day.map_or("undefined", |d| d.name.as_str());
    format!("{prefix}{name}")
}

/// `Program_getListOfDays`: `(day number as text, label)` pairs.
pub fn get_list_of_days(program: &IEvaluatedProgram) -> Vec<(String, String)> {
    let mut days = Vec::new();
    let is_really_multiweek = program.weeks.len() > 1;
    let mut day_index = 0;
    for week in &program.weeks {
        for day in &week.days {
            day_index += 1;
            let prefix = if is_really_multiweek { format!("{} - ", week.name) } else { String::new() };
            days.push((day_index.to_string(), format!("{prefix}{}", day.name)));
        }
    }
    days
}

/// `Program_getProgramWeek`. `None` when the program has no weeks.
pub fn get_program_week(program: &IEvaluatedProgram, day: Option<i64>) -> Option<&IEvaluatedProgramWeek> {
    let day = match day {
        Some(d) if d != 0 => d,
        _ => 1,
    };
    usize::try_from(get_week_from_day(program, day) - 1)
        .ok()
        .and_then(|i| program.weeks.get(i))
        .or_else(|| program.weeks.first())
}

/// `Program_getProgramDayExercises`: typed exercises of a day.
pub fn get_program_day_exercises(program_day: &IEvaluatedProgramDay) -> Vec<&IPlannerProgramExercise> {
    program_day.exercises.iter().filter(|e| e.exercise_type.is_some()).collect()
}

/// `Program_getProgramDayUsedExercises`
pub fn get_program_day_used_exercises(program_day: &IEvaluatedProgramDay) -> Vec<&IPlannerProgramExercise> {
    program_day
        .exercises
        .iter()
        .filter(|e| e.notused != Some(true) && e.exercise_type.is_some())
        .collect()
}

/// `Program_getProgramExercise`
pub fn get_program_exercise<'a>(
    day: i64,
    program: Option<&'a IEvaluatedProgram>,
    key: Option<&str>,
) -> Option<&'a IPlannerProgramExercise> {
    let (key, program) = (key?, program?);
    get_program_day(program, day)?.exercises.iter().find(|e| e.key == key)
}

/// `Program_getFirstProgramExercise`: matches `key` or `fullName`.
pub fn get_first_program_exercise<'a>(
    program: Option<&'a IEvaluatedProgram>,
    key: Option<&str>,
) -> Option<&'a IPlannerProgramExercise> {
    let (key, program) = (key?, program?);
    get_all_program_exercises(program)
        .into_iter()
        .find(|e| e.key == key || e.full_name == key)
}

/// `Program_getProgramExerciseFromDay`
pub fn get_program_exercise_from_day<'a>(
    program_day: Option<&'a IEvaluatedProgramDay>,
    key: Option<&str>,
) -> Option<&'a IPlannerProgramExercise> {
    let (key, program_day) = (key?, program_day?);
    program_day.exercises.iter().find(|e| e.key == key)
}

/// `Program_getProgramExerciseForKeyAndDay`. A hit outside the day comes back
/// as a copy with `dayData` replaced, so this returns an owned exercise.
pub fn get_program_exercise_for_key_and_day(
    program: &IEvaluatedProgram,
    day: i64,
    key: &str,
) -> Option<IPlannerProgramExercise> {
    let day_exercises = get_program_day(program, day)
        .map(get_program_day_used_exercises)
        .unwrap_or_default();
    if let Some(e) = day_exercises.into_iter().find(|pe| pe.key == key) {
        return Some(e.clone());
    }
    let mut found = get_all_program_exercises_with_type(program).into_iter().find(|pe| pe.key == key)?.clone();
    found.day_data = get_day_data(program, day);
    Some(found)
}

/// `Program_getProgramExerciseForKeyAndShortDayData`
pub fn get_program_exercise_for_key_and_short_day_data(
    program: &IEvaluatedProgram,
    week: i64,
    day_in_week: i64,
    key: &str,
) -> Option<IPlannerProgramExercise> {
    let day = get_day_number(program, week, day_in_week);
    get_program_exercise_for_key_and_day(program, day, key)
}

/// `Program_getEvaluatedExercise`
pub fn get_evaluated_exercise(
    program: &IProgram,
    day: i64,
    key: &str,
    settings: &ISettings,
    uid: &mut dyn UidSource,
) -> Option<IPlannerProgramExercise> {
    let evaluated = evaluate(program, settings, uid);
    let mut found = None;
    pp::iterate2(&evaluated.weeks, |e, _, _, day_index, _| {
        if day_index as i64 == day - 1 && e.key == key {
            found = Some(e.clone());
            return true;
        }
        false
    });
    found
}

/// `Program_nextDay`. `day` of `None` means the program has not started.
pub fn next_day(program: &IEvaluatedProgram, day: Option<i64>) -> i64 {
    let n = number_of_days(program);
    match day {
        // JS `day % 0` is NaN, which `Program_nextDay` maps to 1.
        Some(_) if n == 0 => 1,
        Some(d) => d % n + 1,
        None => 1,
    }
}

// ---------------------------------------------------------------------------
// misc

/// `Program_create`. `now` stands in for `Date.now()`.
pub fn create(name: &str, id: Option<&str>, now: i64, uid: &mut dyn UidSource) -> IProgram {
    use crate::types::IProgramDay;
    let id = match id {
        Some(i) if !i.is_empty() => i.to_string(),
        _ => uid.generate_uid(8),
    };
    let day_id = uid.generate_uid(8);
    IProgram {
        vtype: ProgramVtype,
        id,
        name: name.to_string(),
        url: String::new(),
        author: String::new(),
        short_description: Some(String::new()),
        description: String::new(),
        next_day: 1,
        weeks: vec![],
        is_multiweek: false,
        days: vec![IProgramDay { id: day_id, name: "Day 1".to_string(), exercises: vec![], description: None }],
        exercises: vec![],
        tags: vec![],
        deleted_days: Some(vec![]),
        deleted_weeks: Some(vec![]),
        deleted_exercises: Some(vec![]),
        cloned_at: Some(now),
        planner: None,
        updated_at: None,
        authorid: None,
        source: None,
    }
}

/// `Program_stateValue`. `value` is parsed with `parseFloat`.
pub fn state_value(state: &IProgramState, key: &str, value: Option<&str>) -> Option<ScriptValue> {
    let value = value?;
    let num_value = js_parse_float(value);
    Some(match state.get(key) {
        None => ScriptValue::Number(num_value),
        Some(ScriptValue::Weight(w)) => ScriptValue::Weight(weight::build(num_value, w.unit)),
        Some(ScriptValue::Percentage(_)) => ScriptValue::Percentage(weight::build_pct(num_value)),
        Some(ScriptValue::Number(_)) => ScriptValue::Number(num_value),
    })
}

// ---------------------------------------------------------------------------
// warmups (Exercise_getWarmupSets lives here: it needs set ids)

fn warmup_sets(
    specs: &[IProgramExerciseWarmupSet],
    should_skip_threshold: bool,
    weight_in: Option<IWeight>,
    settings: &ISettings,
    exercise_type: Option<&IExerciseType>,
    uid: &mut dyn UidSource,
) -> Vec<ISet> {
    let mut index = 0;
    let mut memo = Vec::new();
    for spec in specs {
        let passes = should_skip_threshold
            || weight_in.is_some_and(|w| weight::gt(w, spec.threshold));
        if !passes {
            continue;
        }
        let unit = get_unit_or_default_for_exercise_type(settings, exercise_type);
        let numeric = matches!(spec.value, WeightOrNumber::Number(_));
        if !numeric || weight_in.is_some() {
            let warmup_weight = match (spec.value, weight_in) {
                (WeightOrNumber::Number(v), Some(w)) => weight::multiply(w, v),
                (WeightOrNumber::Weight(w), _) => w,
                // Unreachable: a numeric value without a weight is skipped above.
                (WeightOrNumber::Number(_), None) => continue,
            };
            let rounded = weight::round_convert_to(warmup_weight, settings, unit, exercise_type);
            let is_unilateral = match exercise_type {
                Some(t) => is_unilateral(t, settings),
                None => false,
            };
            memo.push(ISet {
                vtype: SetVtype,
                index,
                id: uid.generate_uid(6),
                reps: Some(spec.reps),
                is_unilateral: Some(is_unilateral),
                weight: Some(rounded),
                original_weight: Some(WeightOrPct::Weight(warmup_weight)),
                is_completed: Some(false),
                ..Default::default()
            });
            index += 1;
        }
    }
    memo
}

fn is_unilateral(exercise_type: &IExerciseType, settings: &ISettings) -> bool {
    let view = settings.exercise_view();
    exercise_get_is_unilateral(&ExerciseType::from(exercise_type), &view)
}

/// `Exercise_getWarmupSets`
pub fn get_warmup_sets(
    exercise: &IExerciseType,
    weight_in: Option<IWeight>,
    settings: &ISettings,
    program_exercise_warmup_sets: Option<&[IProgramExerciseWarmupSet]>,
    uid: &mut dyn UidSource,
) -> Vec<ISet> {
    if let Some(specs) = program_exercise_warmup_sets {
        return warmup_sets(specs, true, weight_in, settings, Some(exercise), uid);
    }
    let default_warmup = {
        let view = settings.exercise_view();
        let ex = crate::exercise::exercise_get(&ExerciseType::from(exercise), view.custom_exercises());
        ex.default_warmup
    };
    let key = match default_warmup {
        Some(k @ (10 | 45 | 95)) => k,
        _ => return vec![],
    };
    let table = warmup_values(settings.units.into());
    let specs: Vec<IProgramExerciseWarmupSet> = table
        .get(&key)
        .map(|rows| {
            rows.iter()
                .map(|r| IProgramExerciseWarmupSet {
                    reps: r.reps as f64,
                    value: WeightOrNumber::Number(r.value),
                    threshold: r.threshold.into(),
                })
                .collect()
        })
        .unwrap_or_default();
    warmup_sets(&specs, false, weight_in, settings, Some(exercise), uid)
}

// ---------------------------------------------------------------------------
// nextHistoryEntry

/// `Program_nextHistoryEntry`. `Err` where the TS throws before its own
/// try/catch (the exercise has no evaluated set variation).
pub fn next_history_entry(
    program: &IEvaluatedProgram,
    day_data: &IDayData,
    index: i64,
    program_exercise: &IPlannerProgramExercise,
    stats: &IStats,
    settings: &ISettings,
    uid: &mut dyn UidSource,
) -> Result<IHistoryEntry, ProgramError> {
    let Some(exercise) = program_exercise.exercise_type.clone() else {
        return Err(ProgramError("Cannot read properties of undefined (reading 'id')".to_string()));
    };
    let program_sets = ppe::current_evaluated_set_variation(program_exercise)
        .map(|v| v.sets.as_slice())
        .ok_or_else(|| ProgramError("Cannot read properties of undefined (reading 'length')".to_string()))?;
    let warmups = ppe::program_warmups(program_exercise, settings);
    let mut sets: Vec<ISet> = Vec::new();
    for (i, program_set) in program_sets.iter().enumerate() {
        let min_reps = match (program_set.minrep, program_set.maxrep) {
            (Some(min), max) if Some(min) != max => Some(min),
            _ => None,
        };
        let weight = program_set::get_evaluated_weight(program_set, &exercise, settings);
        sets.push(ISet {
            vtype: SetVtype,
            id: uid.generate_uid(6),
            reps: program_set.maxrep,
            index: i as i64,
            min_reps,
            weight,
            is_unilateral: Some(is_unilateral(&exercise, settings)),
            rpe: program_set.rpe,
            timer: program_set.timer,
            set_timer: program_set.set_timer,
            is_overflow_set_timer: program_set.is_overflow_set_timer,
            auto: program_set.auto,
            log_rpe: Some(program_set.log_rpe),
            ask_weight: Some(program_set.ask_weight),
            original_weight: program_set.weight,
            is_amrap: Some(program_set.is_amrap),
            label: program_set.label.clone(),
            is_completed: Some(false),
            program_set_index: Some(i as i64),
            ..Default::default()
        });
    }
    let first_weight = sets.first().and_then(|s| s.weight);
    let warmup = get_warmup_sets(&exercise, first_weight, settings, warmups.as_deref(), uid);
    let entry = IHistoryEntry {
        vtype: HistoryEntryVtype,
        id: progress::get_entry_id(&exercise, program_exercise.label.as_deref()),
        index,
        exercise: exercise.clone(),
        program_exercise_id: Some(program_exercise.key.clone()),
        sets,
        superset: program_exercise.superset.as_ref().map(|s| s.name.clone()),
        warmup_sets: warmup,
        ..Default::default()
    };
    let state = ppe::get_state(program_exercise);
    let script = ppe::get_update_script(program_exercise);
    let set_variation_index = ppe::current_evaluated_set_variation_index(program_exercise);
    let description_index = ppe::current_description_index(program_exercise);
    let exercise_variation_index = ppe::current_exercise_variation_index(program_exercise);
    let number_of_sets = program_exercise
        .evaluated_set_variations
        .get(set_variation_index)
        .map_or(0, |v| v.sets.len());
    let update_exercise = UpdateScriptExercise {
        script,
        exercise_type: &exercise,
        state: &state,
        set_variation_index: set_variation_index as f64,
        description_index: description_index as f64,
        exercise_variation_index: exercise_variation_index as f64,
        program_number_of_sets: number_of_sets as f64,
    };
    match progress::run_update_script_for_entry(
        &entry,
        day_data,
        &update_exercise,
        &program.states,
        -1,
        settings,
        stats,
        uid,
    ) {
        Ok(e) => Ok(e),
        Err(_) => Ok(entry),
    }
}
