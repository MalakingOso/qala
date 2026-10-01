//! Port of `runtime.ts`: the Qala runtime over the liftoscript stack
//! (engine bindings, finish-day scripts, core document bridges).
//!
//! The TS imports its document types from `@qala/core`. Here `CoreProgram`,
//! `CoreSettings`, `LiftEntry`, `LiftSession` (and the pieces they hold) are
//! plain serde types with only the fields the bridges read. Unknown fields
//! are ignored on input.
//!
//! Callbacks of `runAllFinishDayScripts` (`onError`, `engineFor`) are
//! closures; `userPromptedStateVars` is a map. Ids come from a `UidSource`
//! where a function creates sets or exercises.

#![allow(clippy::result_large_err)]

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize};

use crate::equipment;
use crate::exercise::{exercise_find_by_name, CustomExercises};
use crate::js::{js_max, js_min, js_round};
use crate::planner_program;
use crate::planner_program_exercise as ppe;
use crate::program::{self, ProgramError};
use crate::program_exercise;
use crate::program_to_planner::{ConvertOpts, ProgramToPlanner};
use crate::progress;
use crate::script_fns::IScriptFunctions;
use crate::script_runner::ScriptRunner;
use crate::stats;
use crate::types::{
    HistoryEntryVtype, IByTag, IDayData, IEither, IEvaluatedProgram, IExerciseType,
    IHistoryEntry, IHistoryRecord, IHistoryRecordVtype, ILiftoscriptEvaluatorUpdate,
    IPlannerProgram, IPlannerProgramExercise, IPlannerProgramWeek, IProgram, PlannerSyntaxError, IProgramMode, IProgramState,
    IScriptBindings, IScriptFnContext, ISet, ISettings, IStats, IUnit, IWeight, PlannerVtype, ProgramVtype,
    SetVtype, WeightOrPct,
};
use crate::util::generator::UidSource;
use crate::util::object;
use crate::weight;

// ---------------------------------------------------------------------------
// core document types (`packages/core/schema.ts`, the parts used here)

/// `Settings.units`
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CoreUnits {
    pub weight: String,
    pub distance: String,
}

/// `Settings` of `@qala/core`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CoreSettings {
    pub units: CoreUnits,
}

/// `Program` of `@qala/core`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct CoreProgram {
    pub name: String,
    pub text: String,
}

/// `LiftSet`
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct LiftSet {
    pub w: IWeight,
    #[serde(with = "crate::js::num")]
    pub r: f64,
    #[serde(default, with = "crate::js::num_opt", skip_serializing_if = "Option::is_none")]
    pub rpe: Option<f64>,
    pub completed: bool,
}

/// `LiftEntry`
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftEntry {
    pub exercise_id: String,
    pub sets: Vec<LiftSet>,
}

/// `LiftSession`
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftSession {
    pub id: String,
    pub date: String,
    pub program_id: String,
    pub day: String,
    pub entries: Vec<LiftEntry>,
}

/// One planned set handed to `qalaLiftEntryToHistoryEntry`.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize)]
pub struct PlannedSet {
    #[serde(default)]
    pub weight: Option<IWeight>,
    #[serde(default, with = "crate::js::num_opt")]
    pub reps: Option<f64>,
}

// ---------------------------------------------------------------------------
// engine bindings

/// A number from engine input. Accepts a JSON number, `null`/absent (default
/// applies) or the strings "NaN", "Infinity", "-Infinity" (the golden files'
/// spelling of non-finite numbers).
fn de_input_num<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Num(f64),
        Str(String),
        Null,
    }
    Ok(match Raw::deserialize(d)? {
        Raw::Num(n) => Some(n),
        Raw::Null => None,
        Raw::Str(s) => match s.as_str() {
            "NaN" => Some(f64::NAN),
            "Infinity" => Some(f64::INFINITY),
            "-Infinity" => Some(f64::NEG_INFINITY),
            other => Some(crate::js::js_number_from_str(other)),
        },
    })
}

/// `EngineBindingsInput`: all plain numbers, all optional.
#[derive(Debug, Clone, Copy, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineBindingsInput {
    /// Derived readiness, 0-1.
    #[serde(default, deserialize_with = "de_input_num")]
    pub readiness: Option<f64>,
    /// Perceived Recovery Status tap, 0-10.
    #[serde(default, deserialize_with = "de_input_num")]
    pub prs: Option<f64>,
    /// Max RP soreness over the exercise's target muscles, 1-4.
    #[serde(default, deserialize_with = "de_input_num")]
    pub soreness: Option<f64>,
    /// Normalised per-muscle fatigue, 0-1.
    #[serde(default, deserialize_with = "de_input_num")]
    pub fatigue_local: Option<f64>,
    /// 0 none, 1 muscle, 2 systemic.
    #[serde(default, deserialize_with = "de_input_num")]
    pub deload: Option<f64>,
    /// Engine's recommended weight change, -10..2.5.
    #[serde(default, deserialize_with = "de_input_num")]
    pub rec_weight_pct: Option<f64>,
    /// Engine's recommended set change, -2..1.
    #[serde(default, deserialize_with = "de_input_num")]
    pub rec_sets: Option<f64>,
}

/// `EngineBindings`: `Required<EngineBindingsInput>`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineBindings {
    #[serde(with = "crate::js::num")]
    pub readiness: f64,
    #[serde(with = "crate::js::num")]
    pub prs: f64,
    #[serde(with = "crate::js::num")]
    pub soreness: f64,
    #[serde(with = "crate::js::num")]
    pub fatigue_local: f64,
    #[serde(with = "crate::js::num")]
    pub deload: f64,
    #[serde(with = "crate::js::num")]
    pub rec_weight_pct: f64,
    #[serde(with = "crate::js::num")]
    pub rec_sets: f64,
}

fn clamp(n: f64, min: f64, max: f64) -> f64 {
    if !n.is_finite() {
        return min;
    }
    js_min(max, js_max(min, n))
}

/// `createEngineBindings`: clamped, absent inputs fall back to neutral defaults.
pub fn create_engine_bindings(input: Option<&EngineBindingsInput>) -> EngineBindings {
    let d = progress::default_engine_bindings();
    let i = input.copied().unwrap_or_default();
    EngineBindings {
        readiness: clamp(i.readiness.unwrap_or(d.readiness), 0.0, 1.0),
        prs: clamp(i.prs.unwrap_or(d.prs), 0.0, 10.0),
        soreness: clamp(js_round(i.soreness.unwrap_or(d.soreness)), 1.0, 4.0),
        fatigue_local: clamp(i.fatigue_local.unwrap_or(d.fatigue_local), 0.0, 1.0),
        deload: clamp(js_round(i.deload.unwrap_or(d.deload)), 0.0, 2.0),
        rec_weight_pct: clamp(i.rec_weight_pct.unwrap_or(d.rec_weight_pct), -10.0, 2.5),
        rec_sets: clamp(js_round(i.rec_sets.unwrap_or(d.rec_sets)), -2.0, 1.0),
    }
}

/// `applyEngineBindings`: merges the engine bindings into script bindings.
pub fn apply_engine_bindings(bindings: &mut IScriptBindings, engine: Option<&EngineBindingsInput>) {
    let e = create_engine_bindings(engine);
    bindings.readiness = e.readiness;
    bindings.prs = e.prs;
    bindings.soreness = e.soreness;
    bindings.fatigue_local = e.fatigue_local;
    bindings.deload = e.deload;
    bindings.rec_weight_pct = e.rec_weight_pct;
    bindings.rec_sets = e.rec_sets;
}

/// `createScriptBindings`
#[allow(clippy::too_many_arguments)]
pub fn create_script_bindings(
    day_data: &IDayData,
    entry: &IHistoryEntry,
    settings: &ISettings,
    program_number_of_sets: f64,
    bodyweight: Option<IWeight>,
    set_index: Option<f64>,
    set_variation_index: Option<f64>,
    description_index: Option<f64>,
    exercise_variation_index: Option<f64>,
    engine: Option<&EngineBindingsInput>,
) -> IScriptBindings {
    let mut bindings = progress::create_script_bindings(
        day_data,
        entry,
        settings,
        program_number_of_sets,
        bodyweight,
        set_index,
        set_variation_index,
        description_index,
        exercise_variation_index,
    );
    apply_engine_bindings(&mut bindings, engine);
    bindings
}

/// The keys of the object `createScriptFunctions` returns, in its order.
pub fn script_function_names() -> Vec<&'static str> {
    vec![
        "roundWeight",
        "roundConvertWeight",
        "calculateTrainingMax",
        "calculate1RM",
        "rpeMultiplier",
        "floor",
        "ceil",
        "round",
        "sum",
        "min",
        "max",
        "increment",
        "decrement",
        "zeroOrGte",
        "print",
        "sets",
    ]
}

/// `createScriptFunctions`
pub fn create_script_functions(settings: &ISettings) -> IScriptFunctions<'_> {
    progress::create_script_functions(settings)
}

// ---------------------------------------------------------------------------
// update script

/// `runUpdateScriptForEntry`. `Err` carries the message of a script error
/// (the TS throws it).
#[allow(clippy::too_many_arguments)]
pub fn run_update_script_for_entry(
    entry: &IHistoryEntry,
    day_data: &IDayData,
    program_exercise: &IPlannerProgramExercise,
    other_states: &IByTag<IProgramState>,
    set_index: i64,
    settings: &ISettings,
    stats: &IStats,
    uid: &mut dyn UidSource,
) -> Result<IHistoryEntry, ProgramError> {
    let Some(exercise_type) = program_exercise.exercise_type.as_ref() else {
        return Err(ProgramError("Cannot read properties of undefined (reading 'id')".to_string()));
    };
    let state = ppe::get_state(program_exercise);
    let script = ppe::get_update_script(program_exercise);
    let set_variation_index = ppe::current_evaluated_set_variation_index(program_exercise);
    let number_of_sets = program_exercise
        .evaluated_set_variations
        .get(set_variation_index)
        .map_or(0, |v| v.sets.len());
    let update_exercise = progress::UpdateScriptExercise {
        script,
        exercise_type,
        state: &state,
        set_variation_index: set_variation_index as f64,
        description_index: ppe::current_description_index(program_exercise) as f64,
        exercise_variation_index: ppe::current_exercise_variation_index(program_exercise) as f64,
        program_number_of_sets: number_of_sets as f64,
    };
    progress::run_update_script_for_entry(
        entry,
        day_data,
        &update_exercise,
        other_states,
        set_index,
        settings,
        stats,
        uid,
    )
    .map_err(|e| ProgramError(e.message))
}

// ---------------------------------------------------------------------------
// finish day

/// `FinishDayResult`
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishDayResult {
    pub state: IProgramState,
    pub other_states: IByTag<IProgramState>,
    pub updates: Vec<ILiftoscriptEvaluatorUpdate>,
    pub bindings: IScriptBindings,
}

/// Options of `runFinishDayScript`.
#[derive(Debug, Clone, Copy, Default)]
pub struct FinishDayOpts<'a> {
    pub user_prompted_state_vars: Option<&'a IProgramState>,
    pub engine: Option<&'a EngineBindingsInput>,
}

/// `runFinishDayScript`: runs one exercise's `progress: custom(...)` script
/// after the workout. A script syntax error comes back as `Failure(message)`.
pub fn run_finish_day_script(
    program_exercise: &IPlannerProgramExercise,
    program: &IEvaluatedProgram,
    day_data: &IDayData,
    entry: &IHistoryEntry,
    settings: &ISettings,
    stats: &IStats,
    opts: &FinishDayOpts<'_>,
) -> IEither<FinishDayResult, String> {
    let state = ppe::get_state(program_exercise);
    let set_variation_index = ppe::current_evaluated_set_variation_index(program_exercise);
    let description_index = ppe::current_description_index(program_exercise);
    let exercise_variation_index = ppe::current_exercise_variation_index(program_exercise);
    let number_of_sets = program_exercise
        .evaluated_set_variations
        .get(set_variation_index)
        .map_or(0, |v| v.sets.len());
    let mut bindings = create_script_bindings(
        day_data,
        entry,
        settings,
        number_of_sets as f64,
        stats::get_current_moving_average_bodyweight(stats, settings),
        None,
        Some(set_variation_index as f64 + 1.0),
        Some(description_index as f64 + 1.0),
        Some(exercise_variation_index as f64 + 1.0),
        opts.engine,
    );
    let fns = create_script_functions(settings);

    let mut new_state: IProgramState = state.clone();
    if let Some(prompted) = opts.user_prompted_state_vars {
        for (k, v) in prompted {
            new_state.insert(k.clone(), *v);
        }
    }
    let mut other_states = program.states.clone();

    let script = ppe::get_progress_script(program_exercise).unwrap_or_default().to_string();
    let mut fn_context = IScriptFnContext {
        prints: vec![],
        unit: settings.units,
        exercise_type: program_exercise.exercise_type.clone(),
    };
    let updates;
    {
        let mut runner = ScriptRunner::new(
            &script,
            &mut new_state,
            &mut other_states,
            &mut bindings,
            &fns,
            settings.units,
            &mut fn_context,
            IProgramMode::Planner,
        );
        if let Err(e) = runner.execute(None) {
            return IEither::Failure(e.message);
        }
        updates = runner.get_updates().to_vec();
    }

    let mut diff_other_states: IByTag<IProgramState> = IndexMap::new();
    for (key, new_other) in &other_states {
        let old = program.states.get(key);
        if Some(new_other) != old {
            let mut diff_state = IProgramState::new();
            for (key2, value) in new_other {
                let same = old.and_then(|o| o.get(key2)).is_some_and(|ov| weight::eq(*value, *ov));
                if !same {
                    diff_state.insert(key2.clone(), *value);
                }
            }
            diff_other_states.insert(key.clone(), diff_state);
        }
    }

    let state_diff = object::diff(&state, &new_state);
    IEither::Success(FinishDayResult { state: state_diff, other_states: diff_other_states, updates, bindings })
}

/// `exerciseData` entry of `runAllFinishDayScripts`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct ExerciseRm1 {
    pub rm1: IWeight,
}

/// `RunAllFinishDayScriptsResult`
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAllFinishDayScriptsResult {
    pub evaluated_program: IEvaluatedProgram,
    /// Planner source text with the new states folded back in.
    pub planner_text: String,
    pub next_day: i64,
    pub exercise_data: IndexMap<String, ExerciseRm1>,
    pub errors: Vec<String>,
}

/// `opts.engineFor`
pub type EngineFor<'a> = &'a dyn Fn(&IHistoryEntry) -> Option<EngineBindingsInput>;

/// Callbacks and maps of `runAllFinishDayScripts`' `opts`.
#[derive(Default)]
pub struct RunAllOpts<'a> {
    pub on_error: Option<&'a mut dyn FnMut(&str)>,
    pub engine_for: Option<EngineFor<'a>>,
    pub user_prompted_state_vars: Option<&'a IndexMap<String, IProgramState>>,
}

fn merge_state(dst: &mut IProgramState, src: &IProgramState) {
    for (k, v) in src {
        dst.insert(k.clone(), *v);
    }
}

fn planner_text(
    program: &IEvaluatedProgram,
    settings: &ISettings,
    uid: &mut dyn UidSource,
) -> Result<String, PlannerSyntaxError> {
    let planner = ProgramToPlanner::new(program, settings).convert_to_planner(&ConvertOpts::default(), uid)?;
    let weeks: Vec<IPlannerProgramWeek> = planner.weeks;
    Ok(planner_program::generate_full_text(&weeks))
}

/// `runAllFinishDayScripts`: runs every completed entry's finish-day script,
/// folds state updates into a cloned evaluated program and advances the day.
/// `Err` is the error the TS throws when the program has evaluation errors
/// (`ProgramToPlanner.convertToPlanner` rethrows the first one).
pub fn run_all_finish_day_scripts(
    program: &IEvaluatedProgram,
    day: i64,
    entries: &[IHistoryEntry],
    settings: &ISettings,
    stats: &IStats,
    mut opts: RunAllOpts<'_>,
    uid: &mut dyn UidSource,
) -> Result<RunAllFinishDayScriptsResult, PlannerSyntaxError> {
    let mut exercise_data: IndexMap<String, ExerciseRm1> = IndexMap::new();
    let mut errors: Vec<String> = Vec::new();
    let mut new_program = program.clone();
    let Some(resolved_day_data) = program::get_program_day(&new_program, day).map(|d| d.day_data) else {
        let message = format!("No program day found for day {day}; nothing was run.");
        errors.push(message.clone());
        if let Some(cb) = opts.on_error.as_mut() {
            cb(&message);
        }
        // The program's own current text, so a bad day index never yields an empty program.
        let text = planner_text(program, settings, uid)?;
        return Ok(RunAllFinishDayScriptsResult {
            evaluated_program: program.clone(),
            planner_text: text,
            next_day: day,
            exercise_data,
            errors,
        });
    };
    let day_data = IDayData {
        week: Some(resolved_day_data.week),
        day: resolved_day_data.day,
        day_in_week: Some(resolved_day_data.day_in_week),
    };
    for entry in entries {
        if entry.is_suppressed == Some(true) || !entry.sets.iter().any(|s| s.is_completed == Some(true)) {
            continue;
        }
        let program_exercise = entry
            .program_exercise_id
            .as_deref()
            .and_then(|id| program::get_program_exercise_for_key_and_day(&new_program, day, id));
        if let Some(program_exercise) = program_exercise {
            let engine = opts.engine_for.and_then(|f| f(entry));
            let prompted = opts
                .user_prompted_state_vars
                .and_then(|m| m.get(&program_exercise.key));
            let result = run_finish_day_script(
                &program_exercise,
                &new_program,
                &day_data,
                entry,
                settings,
                stats,
                &FinishDayOpts { user_prompted_state_vars: prompted, engine: engine.as_ref() },
            );
            match result {
                IEither::Success(FinishDayResult { state, other_states, updates, bindings }) => {
                    let exercise_key = entry.exercise.to_key();
                    let onerm = weight::onerm(&entry.exercise, settings);
                    if !weight::eq(bindings.rm1, onerm) {
                        exercise_data.insert(exercise_key, ExerciseRm1 { rm1: weight::round_to_005(bindings.rm1) });
                    }
                    for week in new_program.weeks.iter_mut() {
                        for d in week.days.iter_mut() {
                            for ex in d.exercises.iter_mut() {
                                if ex.key == program_exercise.key {
                                    if let Some(progress) = ex.progress.as_mut() {
                                        if let Some(es) = &entry.state {
                                            merge_state(&mut progress.state, es);
                                        }
                                        merge_state(&mut progress.state, &state);
                                    }
                                }
                            }
                        }
                    }
                    program_exercise::apply_variables(&program_exercise.key, &mut new_program, &updates, settings);
                    for (key, other) in &other_states {
                        let tag: Option<i64> = key.parse().ok();
                        for week in new_program.weeks.iter_mut() {
                            for d in week.days.iter_mut() {
                                for ex in d.exercises.iter_mut() {
                                    if tag.is_some_and(|t| ex.tags.contains(&t)) {
                                        if let Some(progress) = ex.progress.as_mut() {
                                            merge_state(&mut progress.state, other);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                IEither::Failure(error) => {
                    let message = format!("There was an error executing progress script: {error}");
                    errors.push(message.clone());
                    if let Some(cb) = opts.on_error.as_mut() {
                        cb(&message);
                    }
                }
            }
        } else if let Some(id) = &entry.program_exercise_id {
            let message = format!(
                "No program exercise found for key \"{id}\" on day {day}; its finish-day script did not run."
            );
            errors.push(message.clone());
            if let Some(cb) = opts.on_error.as_mut() {
                cb(&message);
            }
        }
    }
    let the_next_day = program::next_day(&new_program, Some(day));
    new_program.next_day = the_next_day;
    let text = planner_text(&new_program, settings, uid)?;
    Ok(RunAllFinishDayScriptsResult {
        evaluated_program: new_program,
        planner_text: text,
        next_day: the_next_day,
        exercise_data,
        errors,
    })
}

// ---------------------------------------------------------------------------
// evaluation entry points

/// `forceEvaluateText`: evaluates planner text into an evaluated program.
pub fn force_evaluate_text(
    program_text: &str,
    name: &str,
    settings: &ISettings,
    uid: &mut dyn UidSource,
) -> IEvaluatedProgram {
    let planner = IPlannerProgram {
        vtype: PlannerVtype,
        name: name.to_string(),
        weeks: planner_program::evaluate_text(program_text),
    };
    let id = uid.generate_uid(8);
    let program = IProgram {
        vtype: ProgramVtype,
        id,
        name: name.to_string(),
        url: String::new(),
        author: String::new(),
        short_description: Some(String::new()),
        description: String::new(),
        next_day: 1,
        weeks: vec![],
        is_multiweek: planner.weeks.len() > 1,
        days: vec![],
        exercises: vec![],
        tags: vec![],
        deleted_days: None,
        deleted_weeks: None,
        deleted_exercises: None,
        cloned_at: None,
        planner: Some(planner),
        updated_at: None,
        authorid: None,
        source: None,
    };
    program::force_evaluate(&program, settings, uid)
}

/// `GetDayResult`: the TS `{ dayData, exercises }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
    pub day_data: crate::types::IDayDataRequired,
    pub exercises: Vec<IPlannerProgramExercise>,
}

/// `getDay`: day-indexed view of an evaluated program.
pub fn get_day(program: &IEvaluatedProgram, day: i64) -> Option<DayView> {
    let d = program::get_program_day(program, day)?;
    Some(DayView { day_data: d.day_data, exercises: d.exercises.clone() })
}

// ---------------------------------------------------------------------------
// settings and entry bridges

/// `qalaSettingsToLiftoscript`: default liftoscript settings bridged from core settings.
pub fn qala_settings_to_liftoscript(core: &CoreSettings) -> ISettings {
    let units = if core.units.weight == "kg" { IUnit::Kg } else { IUnit::Lb };
    let mut barbell = equipment::build("Barbell");
    barbell.bar = crate::types::IEquipmentBar { lb: weight::build(45.0, IUnit::Lb), kg: weight::build(20.0, IUnit::Kg) };
    let mut plates = Vec::new();
    for v in [45.0, 35.0, 25.0, 10.0, 5.0, 2.5] {
        plates.push(crate::types::IPlate { weight: weight::build(v, IUnit::Lb), num: 8.0 });
    }
    for v in [25.0, 20.0, 15.0, 10.0, 5.0, 2.5, 1.25] {
        plates.push(crate::types::IPlate { weight: weight::build(v, IUnit::Kg), num: 8.0 });
    }
    barbell.plates = plates;
    let mut gym_equipment = IndexMap::new();
    gym_equipment.insert("barbell".to_string(), barbell);
    gym_equipment.insert("dumbbell".to_string(), equipment::build("Dumbbells"));
    default_settings(units, gym_equipment)
}

fn default_settings(units: IUnit, gym_equipment: crate::types::IAllEquipment) -> ISettings {
    use crate::types::*;
    ISettings {
        timers: Default::default(),
        gyms: vec![IGym {
            vtype: Default::default(),
            id: "default".to_string(),
            name: "Default".to_string(),
            equipment: gym_equipment,
        }],
        deleted_gyms: vec![],
        graphs: IGraphs { vtype: Default::default(), graphs: vec![] },
        graph_options: Default::default(),
        graphs_settings: Default::default(),
        exercise_stats_settings: Default::default(),
        exercises: Default::default(),
        stats_enabled: Default::default(),
        units,
        length_units: ILengthUnit::In,
        volume: 0.0,
        exercise_data: Default::default(),
        planner: IPlannerSettings {
            synergist_multiplier: 0.5,
            strength_sets_pct: 0.85,
            hypertrophy_sets_pct: 0.7,
            weekly_range_sets: Default::default(),
            weekly_frequency: Default::default(),
        },
        workout_settings: IWorkoutSettings {
            target_type: ITargetType::Target,
            should_hide_graphs: None,
            should_keep_program_exercise_id: None,
            should_show_invisible_equipment: None,
            picker_sort: None,
        },
        muscle_groups: IMuscleGroupsSettings { vtype: Default::default(), data: Default::default() },
        apple_health_sync_workout: None,
        apple_health_sync_measurements: None,
        apple_health_sync_sleep_nutrition: None,
        apple_health_anchor: None,
        google_health_sync_workout: None,
        google_health_sync_measurements: None,
        google_health_sync_sleep_nutrition: None,
        google_health_anchor: None,
        health_confirmation: None,
        ignore_do_not_disturb: None,
        current_gym_id: Some("default".to_string()),
        is_public_profile: None,
        nickname: None,
        always_on_display: None,
        vibration: None,
        start_week_from_monday: None,
        text_size: None,
        starred_exercises: None,
        recent_exercises: None,
        theme: None,
        current_bodyweight: None,
        affiliate_enabled: None,
    }
}

/// `qalaExerciseIdToType`: resolves a core exercise id by name, falling back to the raw id.
pub fn qala_exercise_id_to_type(exercise_id: &str) -> IExerciseType {
    let custom = CustomExercises::new();
    match exercise_find_by_name(exercise_id, &custom) {
        Some(found) => IExerciseType { id: found.id, equipment: found.equipment, extra: IndexMap::new() },
        None => IExerciseType { id: exercise_id.to_string(), equipment: None, extra: IndexMap::new() },
    }
}

/// `qalaLiftEntryToHistoryEntry`
pub fn qala_lift_entry_to_history_entry(
    lift_entry: &LiftEntry,
    index: i64,
    planned: Option<&[PlannedSet]>,
    program_exercise_key: Option<&str>,
    uid: &mut dyn UidSource,
) -> IHistoryEntry {
    let exercise = qala_exercise_id_to_type(&lift_entry.exercise_id);
    let sets: Vec<ISet> = lift_entry
        .sets
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let target = planned.and_then(|p| p.get(i));
            let target_weight = target.and_then(|t| t.weight);
            let completed = s.completed;
            ISet {
                vtype: SetVtype,
                id: uid.generate_uid(6),
                index: i as i64,
                reps: Some(target.and_then(|t| t.reps).unwrap_or(s.r)),
                weight: Some(match target_weight {
                    Some(w) => weight::build(w.value, w.unit),
                    None => weight::build(s.w.value, s.w.unit),
                }),
                original_weight: target_weight.map(|w| WeightOrPct::Weight(weight::build(w.value, w.unit))),
                rpe: s.rpe,
                is_completed: Some(completed),
                completed_reps: if completed { Some(s.r) } else { None },
                completed_weight: if completed { Some(weight::build(s.w.value, s.w.unit)) } else { None },
                completed_rpe: if completed { s.rpe } else { None },
                ..Default::default()
            }
        })
        .collect();
    // Same as `PlannerKey_fromExerciseType(exercise)`: the lower-cased key.
    let fallback_key = exercise.to_key().to_lowercase();
    IHistoryEntry {
        vtype: HistoryEntryVtype,
        id: format!("{}_{}", lift_entry.exercise_id, index),
        index,
        exercise,
        program_exercise_id: Some(program_exercise_key.map(|k| k.to_string()).unwrap_or(fallback_key)),
        sets,
        warmup_sets: vec![],
        ..Default::default()
    }
}

/// `qalaLiftSessionToHistoryRecord`. `start_time` is `Date.parse(session.date)`,
/// so it is NaN for a date the ISO parser rejects.
pub fn qala_lift_session_to_history_record(
    session: &LiftSession,
    day: i64,
    program_name: &str,
    program: Option<&IEvaluatedProgram>,
    uid: &mut dyn UidSource,
) -> IHistoryRecord {
    let day_exercises = program.and_then(|p| program::get_program_day(p, day)).map(|d| &d.exercises);
    let entries = session
        .entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let key = day_exercises.and_then(|ex| ex.get(i)).map(|x| x.key.as_str());
            qala_lift_entry_to_history_entry(e, i as i64, None, key, uid)
        })
        .collect();
    IHistoryRecord {
        vtype: IHistoryRecordVtype::HistoryRecord,
        date: session.date.clone(),
        program_id: session.program_id.clone(),
        program_name: program_name.to_string(),
        day,
        day_name: session.day.clone(),
        entries,
        start_time: date_parse(&session.date),
        id: 0,
        end_time: None,
        week: None,
        day_in_week: None,
        ui: None,
        intervals: None,
        deleted_program_exercises: None,
        user_prompted_state_vars: None,
        changes: None,
        timer_since: None,
        timer_mode: None,
        timer: None,
        timer_entry_index: None,
        timer_set_index: None,
        set_timer: None,
        set_timer_get_ready: None,
        amrap_modal: None,
        current_entry_index: None,
        notes: None,
        updated_at: None,
        source: None,
    }
}

/// `evaluateQalaProgram`
pub fn evaluate_qala_program(
    core_program: &CoreProgram,
    core_settings: &CoreSettings,
    uid: &mut dyn UidSource,
) -> IEvaluatedProgram {
    force_evaluate_text(
        &core_program.text,
        &core_program.name,
        &qala_settings_to_liftoscript(core_settings),
        uid,
    )
}

// ---------------------------------------------------------------------------
// Date.parse (ISO 8601 subset)

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
    }
}

/// `Date.parse` for the ECMAScript date-time string format. Anything else
/// (the engine's legacy formats) gives NaN. A date-time without an offset is
/// read as UTC.
pub fn date_parse(s: &str) -> f64 {
    parse_iso(s).map_or(f64::NAN, |ms| ms as f64)
}

fn parse_iso(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let mut i = 0;
    let digits = |i: &mut usize, n: usize| -> Option<i64> {
        if *i + n > b.len() || !b[*i..*i + n].iter().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let v = s[*i..*i + n].parse().ok()?;
        *i += n;
        Some(v)
    };
    // year
    let year = if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        let neg = b[i] == b'-';
        i += 1;
        let y = digits(&mut i, 6)?;
        if neg && y == 0 {
            return None;
        }
        if neg {
            -y
        } else {
            y
        }
    } else {
        digits(&mut i, 4)?
    };
    let (mut month, mut day) = (1, 1);
    if i < b.len() && b[i] == b'-' {
        i += 1;
        month = digits(&mut i, 2)?;
        if i < b.len() && b[i] == b'-' {
            i += 1;
            day = digits(&mut i, 2)?;
        }
    }
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    let (mut hour, mut minute, mut second, mut millis) = (0, 0, 0, 0);
    let mut offset_min = 0;
    if i < b.len() && (b[i] == b'T' || b[i] == b't') {
        i += 1;
        hour = digits(&mut i, 2)?;
        if i >= b.len() || b[i] != b':' {
            return None;
        }
        i += 1;
        minute = digits(&mut i, 2)?;
        if i < b.len() && b[i] == b':' {
            i += 1;
            second = digits(&mut i, 2)?;
            if i < b.len() && (b[i] == b'.' || b[i] == b',') {
                i += 1;
                let start = i;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i == start {
                    return None;
                }
                let frac = &s[start..i];
                let three: String = frac.chars().chain("00".chars()).take(3).collect();
                millis = three.parse().ok()?;
            }
        }
        if i < b.len() {
            match b[i] {
                b'Z' | b'z' => i += 1,
                b'+' | b'-' => {
                    let sign = if b[i] == b'-' { -1 } else { 1 };
                    i += 1;
                    let oh = digits(&mut i, 2)?;
                    if i < b.len() && b[i] == b':' {
                        i += 1;
                    }
                    let om = digits(&mut i, 2)?;
                    if oh > 23 || om > 59 {
                        return None;
                    }
                    offset_min = sign * (oh * 60 + om);
                }
                _ => return None,
            }
        }
    }
    if i != b.len() {
        return None;
    }
    if minute > 59 || second > 59 || hour > 24 || (hour == 24 && (minute != 0 || second != 0 || millis != 0)) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let ms = days * 86_400_000 + hour * 3_600_000 + minute * 60_000 + second * 1000 + millis - offset_min * 60_000;
    // JS time values are limited to +-8.64e15.
    if ms.abs() > 8_640_000_000_000_000 {
        return None;
    }
    Some(ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_parse_matches_js() {
        assert_eq!(date_parse("1970-01-01T00:00:00.000Z"), 0.0);
        assert_eq!(date_parse("2026-03-05T10:20:30.123Z"), 1772706030123.0);
        assert_eq!(date_parse("2026-03-05"), 1772668800000.0);
        assert_eq!(date_parse("2026-03-05T00:00:00Z"), 1772668800000.0);
        assert!(date_parse("not a date").is_nan());
        assert_eq!(date_parse("2026-03-05T01:00:00+01:00"), 1772668800000.0);
        assert!(date_parse("2026-02-30").is_nan());
    }

    #[test]
    fn engine_bindings_clamp() {
        let b = create_engine_bindings(Some(&EngineBindingsInput {
            soreness: Some(f64::NAN),
            deload: Some(7.0),
            ..Default::default()
        }));
        assert_eq!(b.soreness, 1.0);
        assert_eq!(b.deload, 2.0);
        assert_eq!(b.readiness, 1.0);
    }
}
