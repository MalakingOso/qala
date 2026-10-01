//! Port of `models/progress.ts`: script bindings and functions, entry
//! navigation, `applyBindings` and the update-script runner.
//!
//! Workout-recording actions stay in the app shell, as in the TS.
//!
//! `Progress_runUpdateScriptForEntry` takes an `IPlannerProgramExercise` in TS.
//! `run_update_script_for_entry` takes the few values it reads from it
//! (`UpdateScriptExercise`); the caller fills them with the
//! `PlannerProgramExercise_*` helpers.

#![allow(clippy::result_large_err)]

use indexmap::IndexMap;

use crate::equipment::get_unit_for_exercise_type;
use crate::js::{js_max, js_round, js_trunc_len};
use crate::script_eval::SyntaxResult;
use crate::script_fns::{EvalValue, IScriptFnName, IScriptFunctions};
use crate::script_runner::ScriptRunner;
use crate::set::is_empty_or_finished;
use crate::stats::get_current_moving_average_bodyweight;
use crate::types::{
    HistoryEntryVtype, IDayData, IExerciseType, IHistoryEntry, IHistoryRecord, IPercentage, IProgramMode,
    IProgramState, IProgressMode, IScriptBindings, IScriptFnContext, ISet, ISettings, IStats, IUnit, IWeight,
    ScriptValue, SetVtype, WeightOrPct,
};
use crate::util::collection::find_index_reverse;
use crate::util::generator::UidSource;
use crate::weight::{self, UnitOrPct};

/// The result of `Progress_defaultEngineBindings`: neutral values for the Qala
/// engine bindings.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EngineBindingDefaults {
    pub readiness: f64,
    pub prs: f64,
    pub soreness: f64,
    pub fatigue_local: f64,
    pub deload: f64,
    pub rec_weight_pct: f64,
    pub rec_sets: f64,
}

/// `Progress_defaultEngineBindings`
pub fn default_engine_bindings() -> EngineBindingDefaults {
    EngineBindingDefaults {
        readiness: 1.0,
        prs: 0.0,
        soreness: 1.0,
        fatigue_local: 0.0,
        deload: 0.0,
        rec_weight_pct: 0.0,
        rec_sets: 0.0,
    }
}

/// `Progress_createEmptyScriptBindings`
pub fn create_empty_script_bindings(
    day_data: &IDayData,
    settings: &ISettings,
    exercise: Option<&IExerciseType>,
) -> IScriptBindings {
    let rm1 = match exercise {
        Some(e) => weight::onerm(e, settings),
        None => weight::build(0.0, IUnit::Lb),
    };
    let d = default_engine_bindings();
    IScriptBindings {
        day: day_data.day as f64,
        week: day_data.week.unwrap_or(1) as f64,
        day_in_week: day_data.day_in_week.unwrap_or(day_data.day) as f64,
        completed_weights: vec![],
        original_weights: vec![],
        weights: vec![],
        reps: vec![],
        min_reps: vec![],
        rpe: vec![],
        amraps: vec![],
        logrpes: vec![],
        askweights: vec![],
        completed_reps: vec![],
        completed_reps_left: vec![],
        completed_rpe: vec![],
        is_completed: vec![],
        timers: vec![],
        set_time: vec![],
        completed_set_time: vec![],
        completed_set_time_left: vec![],
        w: vec![],
        r: vec![],
        cr: vec![],
        cw: vec![],
        mr: vec![],
        program_number_of_sets: 0.0,
        number_of_sets: 0.0,
        completed_number_of_sets: 0.0,
        ns: 0.0,
        set_variation_index: 1.0,
        exercise_variation_index: 1.0,
        description_index: 1.0,
        bodyweight: weight::build(0.0, settings.units),
        set_index: 1.0,
        rm1,
        readiness: d.readiness,
        prs: d.prs,
        soreness: d.soreness,
        fatigue_local: d.fatigue_local,
        deload: d.deload,
        rec_weight_pct: d.rec_weight_pct,
        rec_sets: d.rec_sets,
        aliased: Default::default(),
    }
}

/// `Progress_createScriptBindings`. The short names `w`, `r`, `mr`, `cr` and
/// `cw` alias their long forms, as the TS arrays do (see `IScriptBindings::aliased`).
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
) -> IScriptBindings {
    let mut b = create_empty_script_bindings(day_data, settings, Some(&entry.exercise));
    let flag = |v: Option<bool>| if v == Some(true) { Some(1.0) } else { None };
    for set in &entry.sets {
        b.weights.push(set.weight);
        b.original_weights.push(
            set.original_weight
                .unwrap_or(WeightOrPct::Weight(weight::build(0.0, settings.units))),
        );
        b.reps.push(set.reps);
        b.min_reps.push(set.min_reps);
        b.completed_reps.push(set.completed_reps);
        b.completed_reps_left.push(set.completed_reps_left);
        b.completed_rpe.push(set.completed_rpe);
        b.completed_weights.push(set.completed_weight);
        b.rpe.push(set.rpe);
        b.amraps.push(flag(set.is_amrap));
        b.logrpes.push(flag(set.log_rpe));
        b.askweights.push(flag(set.ask_weight));
        b.timers.push(set.timer);
        b.set_time.push(set.set_timer);
        b.completed_set_time.push(set.completed_set_timer);
        b.completed_set_time_left.push(set.completed_set_timer_left);
        b.is_completed.push(if set.is_completed == Some(true) { 1 } else { 0 });
    }
    b.w = b.weights.clone();
    b.r = b.reps.clone();
    b.cr = b.completed_reps.clone();
    b.cw = b.completed_weights.clone();
    b.mr = b.min_reps.clone();
    b.ns = entry.sets.len() as f64;
    b.program_number_of_sets = program_number_of_sets;
    b.number_of_sets = entry.sets.len() as f64;
    b.completed_number_of_sets = entry.sets.iter().filter(|s| s.is_completed == Some(true)).count() as f64;
    b.set_index = set_index.unwrap_or(1.0);
    b.set_variation_index = set_variation_index.unwrap_or(1.0);
    b.exercise_variation_index = exercise_variation_index.unwrap_or(1.0);
    b.description_index = description_index.unwrap_or(1.0);
    b.bodyweight = bodyweight.unwrap_or(weight::build(0.0, settings.units));
    b.aliased.0 = true;
    b
}

/// `Progress_createScriptFunctions`. The functions themselves are
/// `IScriptFunctions::call`.
pub fn create_script_functions(settings: &ISettings) -> IScriptFunctions<'_> {
    IScriptFunctions { settings }
}

fn apply_rounding(num: Option<&EvalValue>, rounder: fn(f64) -> f64) -> EvalValue {
    match num {
        Some(EvalValue::Number(n)) => EvalValue::Number(rounder(*n)),
        Some(EvalValue::Weight(w)) => EvalValue::Weight(weight::build(rounder(w.value), w.unit)),
        Some(EvalValue::Percentage(p)) => EvalValue::Percentage(weight::build_pct(rounder(p.value))),
        _ => EvalValue::Number(0.0),
    }
}

fn flatten_script_args(args: &[EvalValue]) -> Vec<ScriptValue> {
    let mut result = Vec::new();
    for arg in args {
        match arg {
            EvalValue::Array(items) => result.extend(items.iter().flatten().copied()),
            other => {
                if let Some(v) = other.as_script_value() {
                    result.push(v);
                }
            }
        }
    }
    result
}

fn sum(args: &[EvalValue]) -> EvalValue {
    let flat = flatten_script_args(args);
    if flat.is_empty() {
        return EvalValue::Number(0.0);
    }
    let mut acc = ScriptValue::Number(0.0);
    for a in flat {
        acc = weight::op(None, acc, a, |x, y| x + y);
    }
    EvalValue::from_script_value(acc)
}

fn min(args: &[EvalValue]) -> EvalValue {
    let flat = flatten_script_args(args);
    let Some(first) = flat.first().copied() else {
        return EvalValue::Number(0.0);
    };
    let mut acc = first;
    for a in flat {
        if weight::lt(a, acc) {
            acc = a;
        }
    }
    EvalValue::from_script_value(acc)
}

fn max(args: &[EvalValue]) -> EvalValue {
    let flat = flatten_script_args(args);
    let Some(first) = flat.first().copied() else {
        return EvalValue::Number(0.0);
    };
    let mut acc = first;
    for a in flat {
        if weight::lt(acc, a) {
            acc = a;
        }
    }
    EvalValue::from_script_value(acc)
}

fn zero_or_gte(a: &[Option<ScriptValue>], b: &[Option<ScriptValue>]) -> bool {
    for i in 0..a.len().max(b.len()) {
        let a_val = a.get(i).copied().flatten();
        let b_val = b.get(i).copied().flatten();
        if let (Some(av), Some(bv)) = (a_val, b_val) {
            if !weight::eq(av, 0.0) && weight::lt(av, bv) {
                return false;
            }
        }
    }
    true
}

fn arg_array(args: &[EvalValue], i: usize) -> Vec<Option<ScriptValue>> {
    match args.get(i) {
        Some(EvalValue::Array(items)) => items.clone(),
        _ => vec![],
    }
}

fn arg_num(args: &[EvalValue], i: usize) -> f64 {
    match args.get(i) {
        Some(EvalValue::Number(n)) => *n,
        _ => f64::NAN,
    }
}

fn at_or_none(v: &mut Vec<Option<f64>>, i: usize, value: Option<f64>) {
    if i as f64 >= crate::script_eval::MAX_SETS {
        return;
    }
    while v.len() <= i {
        v.push(None);
    }
    v[i] = value;
}

impl IScriptFunctions<'_> {
    fn as_weight(&self, value: Option<&EvalValue>) -> IWeight {
        match value {
            Some(EvalValue::Weight(w)) => *w,
            Some(EvalValue::Number(n)) => weight::build(*n, self.settings.units),
            _ => weight::build(f64::NAN, self.settings.units),
        }
    }

    fn increment(&self, value: Option<&EvalValue>, context: &IScriptFnContext, up: bool) -> EvalValue {
        let settings = self.settings;
        let ex = context.exercise_type.as_ref();
        let apply = |w: IWeight| {
            if up {
                weight::increment(w, settings, ex)
            } else {
                weight::decrement(w, settings, ex)
            }
        };
        match value {
            Some(EvalValue::Number(n)) => EvalValue::Weight(apply(weight::build(*n, context.unit))),
            Some(EvalValue::Percentage(p)) => {
                EvalValue::Percentage(weight::build_pct(if up { p.value + 1.0 } else { p.value - 1.0 }))
            }
            Some(EvalValue::Weight(w)) => EvalValue::Weight(apply(*w)),
            _ => EvalValue::Undefined,
        }
    }

    /// Call one Liftoscript builtin. `args` are already validated by the evaluator.
    pub fn call(
        &self,
        name: IScriptFnName,
        args: &[EvalValue],
        context: &mut IScriptFnContext,
        bindings: &mut IScriptBindings,
    ) -> EvalValue {
        let settings = self.settings;
        match name {
            IScriptFnName::RoundWeight | IScriptFnName::RoundConvertWeight => {
                let ex = context.exercise_type.as_ref();
                let unit = get_unit_for_exercise_type(settings, ex).unwrap_or(settings.units);
                let w = self.as_weight(args.first());
                EvalValue::Weight(if name == IScriptFnName::RoundWeight {
                    weight::round(w, settings, unit, ex)
                } else {
                    weight::round_convert_to(w, settings, unit, ex)
                })
            }
            IScriptFnName::CalculateTrainingMax => {
                let reps = arg_num(args, 1);
                let reps = if reps == 0.0 || reps.is_nan() { 0.0 } else { reps };
                EvalValue::Weight(weight::get_training_max(self.as_weight(args.first()), reps, settings))
            }
            IScriptFnName::Calculate1RM => EvalValue::Weight(weight::get_one_rep_max(
                self.as_weight(args.first()),
                arg_num(args, 1),
                None,
            )),
            IScriptFnName::RpeMultiplier => {
                let reps = match args.first() {
                    Some(EvalValue::Weight(w)) => w.value,
                    Some(EvalValue::Number(n)) => *n,
                    _ => f64::NAN,
                };
                let rpe = match args.get(1) {
                    None | Some(EvalValue::Undefined) => 10.0,
                    Some(EvalValue::Weight(w)) => w.value,
                    Some(EvalValue::Number(n)) => *n,
                    _ => f64::NAN,
                };
                EvalValue::Number(weight::rpe_multiplier(reps, rpe))
            }
            IScriptFnName::Floor => apply_rounding(args.first(), f64::floor),
            IScriptFnName::Ceil => apply_rounding(args.first(), f64::ceil),
            IScriptFnName::Round => apply_rounding(args.first(), js_round),
            IScriptFnName::Sum => sum(args),
            IScriptFnName::Min => min(args),
            IScriptFnName::Max => max(args),
            IScriptFnName::Increment => self.increment(args.first(), context, true),
            IScriptFnName::Decrement => self.increment(args.first(), context, false),
            IScriptFnName::ZeroOrGte => EvalValue::Bool(zero_or_gte(&arg_array(args, 0), &arg_array(args, 1))),
            IScriptFnName::Print => {
                let mut flat: Vec<EvalValue> = Vec::new();
                for arg in args {
                    match arg {
                        EvalValue::Array(items) => flat.extend(items.iter().map(|i| match i {
                            Some(v) => EvalValue::from_script_value(*v),
                            None => EvalValue::Number(0.0),
                        })),
                        EvalValue::Undefined => flat.push(EvalValue::Number(0.0)),
                        other => flat.push(other.clone()),
                    }
                }
                // ScriptValue has no boolean, so a printed boolean is stored as 1 or 0.
                context.prints.push(
                    flat.iter()
                        .map(|v| match v {
                            EvalValue::Bool(b) => ScriptValue::Number(if *b { 1.0 } else { 0.0 }),
                            other => other.as_script_value().unwrap_or(ScriptValue::Number(0.0)),
                        })
                        .collect(),
                );
                flat.into_iter().next().unwrap_or(EvalValue::Undefined)
            }
            IScriptFnName::Sets => {
                let from = arg_num(args, 0);
                let to = arg_num(args, 1);
                let min_reps = arg_num(args, 2);
                let reps = arg_num(args, 3);
                let is_amrap = arg_num(args, 4);
                let weight_arg = args
                    .get(5)
                    .and_then(|a| a.as_script_value())
                    .unwrap_or(ScriptValue::Number(f64::NAN));
                let timer = arg_num(args, 6);
                let rpe = arg_num(args, 7);
                let log_rpe = arg_num(args, 8);
                let ex = context.exercise_type.clone();
                let mut i: usize = 0;
                while (i as f64) < bindings.number_of_sets {
                    let fi = i as f64;
                    if fi >= from - 1.0 && fi < to {
                        let weight_value = weight::convert_to_weight(bindings.rm1, weight_arg, context.unit);
                        at_or_none(
                            &mut bindings.min_reps,
                            i,
                            if reps != min_reps { Some(min_reps) } else { None },
                        );
                        at_or_none(&mut bindings.reps, i, Some(reps));
                        while bindings.original_weights.len() <= i {
                            bindings.original_weights.push(WeightOrPct::Weight(weight::ZERO));
                        }
                        bindings.original_weights[i] = WeightOrPct::Weight(weight_value);
                        let rounded = weight::round(weight_value, settings, context.unit, ex.as_ref());
                        while bindings.weights.len() <= i {
                            bindings.weights.push(None);
                        }
                        bindings.weights[i] = Some(rounded);
                        at_or_none(&mut bindings.rpe, i, if rpe != 0.0 { Some(rpe) } else { None });
                        at_or_none(&mut bindings.amraps, i, Some(if is_amrap != 0.0 { 1.0 } else { 0.0 }));
                        at_or_none(&mut bindings.logrpes, i, Some(if log_rpe != 0.0 { 1.0 } else { 0.0 }));
                        at_or_none(&mut bindings.timers, i, if timer != 0.0 { Some(timer) } else { None });
                    }
                    i += 1;
                }
                bindings.sync_aliases();
                EvalValue::Number(to - from)
            }
        }
    }
}

/// `Progress_isFullyEmptyOrFinishedSet`
pub fn is_fully_empty_or_finished_set(progress: &IHistoryRecord) -> bool {
    progress.entries.iter().all(is_empty_or_finished_set)
}

/// `Progress_isEmptyOrFinishedSet`
pub fn is_empty_or_finished_set(entry: &IHistoryEntry) -> bool {
    is_empty_or_finished(&entry.sets)
}

/// `Progress_getSupersetGroups`
pub fn get_superset_groups(entries: &[IHistoryEntry]) -> IndexMap<String, Vec<&IHistoryEntry>> {
    let mut groups: IndexMap<String, Vec<&IHistoryEntry>> = IndexMap::new();
    for entry in entries {
        if let Some(s) = &entry.superset {
            groups.entry(s.clone()).or_default().push(entry);
        }
    }
    groups
}

fn find_entry_index(progress: &IHistoryRecord, entry: &IHistoryEntry) -> Option<usize> {
    progress
        .entries
        .iter()
        .position(|e| e.id == entry.id)
        .or_else(|| progress.entries.iter().position(|e| std::ptr::eq(e, entry)))
}

fn entry_addr(e: &IHistoryEntry) -> usize {
    e as *const IHistoryEntry as usize
}

/// `Progress_getNextEntry`
pub fn get_next_entry<'a>(
    progress: &'a IHistoryRecord,
    entry: &'a IHistoryEntry,
    mode: IProgressMode,
    should_go_to_next_entry: bool,
) -> Option<&'a IHistoryEntry> {
    if is_fully_empty_or_finished_set(progress) {
        return None;
    }
    let mut visited_and_finished: Vec<usize> = Vec::new();
    let mut current: Option<&'a IHistoryEntry> = Some(entry);
    let mut is_initial = true;
    let superset_groups = get_superset_groups(&progress.entries);
    let len = progress.entries.len();
    while let Some(cur) = current {
        let index: i64 = find_entry_index(progress, cur).map(|i| i as i64).unwrap_or(-1);
        let next_by_index = |i: i64| -> Option<&'a IHistoryEntry> { progress.entries.get(((i + 1) as usize) % len) };
        let mut next = Some(cur);
        if mode == IProgressMode::Workout && cur.superset.is_some() && !visited_and_finished.contains(&entry_addr(cur))
        {
            let group: Vec<&'a IHistoryEntry> = cur
                .superset
                .as_ref()
                .and_then(|s| superset_groups.get(s))
                .cloned()
                .unwrap_or_default();
            if group.len() > 1 {
                let superset_index = group
                    .iter()
                    .position(|e| e.id == cur.id)
                    .map(|i| i as i64)
                    .unwrap_or(-1);
                next = group.get(((superset_index + 1) as usize) % group.len()).copied();
            } else if should_go_to_next_entry {
                next = next_by_index(index);
            } else {
                return Some(cur);
            }
        } else if is_empty_or_finished(&cur.sets) {
            if should_go_to_next_entry {
                next = next_by_index(index);
                if next.is_some_and(|n| std::ptr::eq(n, cur)) {
                    return None;
                }
            } else {
                return None;
            }
        }
        let n = next?;
        if !is_empty_or_finished(&n.sets) {
            return Some(n);
        } else if !is_initial {
            visited_and_finished.push(entry_addr(n));
        }
        is_initial = false;
        current = Some(n);
    }
    None
}

/// Index in `progress.entries` (by identity, like `entries.indexOf`) of what
/// `get_next_entry` returns. This is what `Reps_findNextEntryAndSetIndex` needs.
pub fn get_next_entry_position(
    progress: &IHistoryRecord,
    entry: &IHistoryEntry,
    mode: IProgressMode,
    should_go_to_next_entry: bool,
) -> Option<usize> {
    let next = get_next_entry(progress, entry, mode, should_go_to_next_entry)?;
    progress.entries.iter().position(|e| std::ptr::eq(e, next))
}

/// `Progress_getNextEntryIndex`
pub fn get_next_entry_index(progress: &IHistoryRecord, entry: &IHistoryEntry, mode: IProgressMode) -> Option<usize> {
    let next = get_next_entry(progress, entry, mode, false)?;
    find_entry_index(progress, next)
}

fn truthy_opt(v: Option<f64>) -> bool {
    v.is_some_and(|n| n != 0.0 && !n.is_nan())
}

/// `Progress_applyBindings`. New sets draw their ids from `uid`.
pub fn apply_bindings(
    old_entry: &IHistoryEntry,
    bindings: &IScriptBindings,
    settings: &ISettings,
    uid: &mut dyn UidSource,
) -> IHistoryEntry {
    let last_completed_index = find_index_reverse(&bindings.completed_reps, |r| r.is_some()) + 1;
    let keep = js_max(js_max(last_completed_index as f64, bindings.number_of_sets), 0.0);
    let keep = js_trunc_len(keep, old_entry.sets.len());
    let mut entry = old_entry.clone();
    entry.sets = old_entry.sets[..keep].to_vec();

    #[derive(Clone, Copy, PartialEq)]
    enum Key {
        Rpe,
        MinReps,
        Reps,
        Weights,
        Amraps,
        Logrpes,
        Timers,
        SetTime,
        OriginalWeights,
        Askweights,
    }
    let keys = [
        Key::Rpe,
        Key::MinReps,
        Key::Reps,
        Key::Weights,
        Key::Amraps,
        Key::Logrpes,
        Key::Timers,
        Key::SetTime,
        Key::OriginalWeights,
        Key::Askweights,
    ];
    for key in keys {
        let len = match key {
            Key::Rpe => bindings.rpe.len(),
            Key::MinReps => bindings.min_reps.len(),
            Key::Reps => bindings.reps.len(),
            Key::Weights => bindings.weights.len(),
            Key::Amraps => bindings.amraps.len(),
            Key::Logrpes => bindings.logrpes.len(),
            Key::Timers => bindings.timers.len(),
            Key::SetTime => bindings.set_time.len(),
            Key::OriginalWeights => bindings.original_weights.len(),
            Key::Askweights => bindings.askweights.len(),
        };
        for i in 0..len {
            while entry.sets.len() <= i {
                let idx = entry.sets.len();
                let is_unilateral = {
                    let view = settings.exercise_view();
                    crate::exercise::exercise_get_is_unilateral(&(&entry.exercise).into(), &view)
                };
                entry.sets.push(ISet {
                    vtype: SetVtype,
                    id: uid.generate_uid(6),
                    index: idx as i64,
                    is_unilateral: Some(is_unilateral),
                    reps: Some(0.0),
                    weight: Some(weight::build(0.0, IUnit::Lb)),
                    original_weight: Some(WeightOrPct::Weight(weight::build(0.0, IUnit::Lb))),
                    ask_weight: Some(false),
                    is_completed: Some(false),
                    ..Default::default()
                });
            }
            let set = &mut entry.sets[i];
            if set.is_completed == Some(true) {
                continue;
            }
            match key {
                Key::Rpe => {
                    let v = bindings.rpe[i];
                    set.rpe = if v != Some(0.0) { v } else { None };
                }
                Key::Reps => set.reps = bindings.reps[i],
                Key::MinReps => {
                    let v = bindings.min_reps[i];
                    set.min_reps = if v != Some(0.0) { v } else { None };
                }
                Key::Weights => set.weight = bindings.weights[i],
                Key::OriginalWeights => set.original_weight = Some(bindings.original_weights[i]),
                Key::Amraps => set.is_amrap = Some(truthy_opt(bindings.amraps[i])),
                Key::Logrpes => set.log_rpe = Some(truthy_opt(bindings.logrpes[i])),
                Key::Askweights => set.ask_weight = Some(truthy_opt(bindings.askweights[i])),
                Key::Timers => set.timer = bindings.timers[i].filter(|v| *v >= 0.0),
                Key::SetTime => set.set_timer = bindings.set_time[i].filter(|v| *v >= 0.0),
            }
        }
    }
    entry
}

/// `Progress_getEntryId`
pub fn get_entry_id(exercise_type: &IExerciseType, label: Option<&str>) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(l) = label {
        if !l.is_empty() {
            parts.push(l.to_string());
        }
    }
    let key = exercise_type.to_key();
    if !key.is_empty() {
        parts.push(key);
    }
    parts.join("_")
}

/// `Progress_getDayData`
pub fn get_day_data(progress: &IHistoryRecord) -> IDayData {
    IDayData {
        day: progress.day,
        week: progress.week,
        day_in_week: progress.day_in_week,
    }
}

/// The parts of an `IPlannerProgramExercise` that `Progress_runUpdateScriptForEntry` reads.
pub struct UpdateScriptExercise<'a> {
    /// `PlannerProgramExercise_getUpdateScript(programExercise)`
    pub script: Option<&'a str>,
    /// `programExercise.exerciseType`
    pub exercise_type: &'a IExerciseType,
    /// `PlannerProgramExercise_getState(programExercise)` (cloned by the function)
    pub state: &'a IProgramState,
    /// `PlannerProgramExercise_currentEvaluatedSetVariationIndex`, passed on as is
    pub set_variation_index: f64,
    /// `PlannerProgramExercise_currentDescriptionIndex`, passed on as is
    pub description_index: f64,
    /// `PlannerProgramExercise_currentExerciseVariationIndex`, passed on as is
    pub exercise_variation_index: f64,
    /// `evaluatedSetVariations[setVariationIndex]?.sets.length ?? 0`
    pub program_number_of_sets: f64,
}

/// `Progress_runUpdateScriptForEntry`. `set_index` is -1 to run for the whole entry.
/// Script errors come back as `Err` (the TS throws them).
#[allow(clippy::too_many_arguments)]
pub fn run_update_script_for_entry(
    entry: &IHistoryEntry,
    day_data: &IDayData,
    exercise: &UpdateScriptExercise<'_>,
    other_states: &IndexMap<String, IProgramState>,
    set_index: i64,
    settings: &ISettings,
    stats: &IStats,
    uid: &mut dyn UidSource,
) -> SyntaxResult<IHistoryEntry> {
    let completed = usize::try_from(set_index)
        .ok()
        .and_then(|i| entry.sets.get(i))
        .is_some_and(|s| s.is_completed == Some(true));
    if set_index != -1 && !completed {
        return Ok(entry.clone());
    }
    let script = match exercise.script {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(entry.clone()),
    };
    let mut state = exercise.state.clone();
    let mut other = other_states.clone();
    let mut bindings = create_script_bindings(
        day_data,
        entry,
        settings,
        exercise.program_number_of_sets,
        get_current_moving_average_bodyweight(stats, settings),
        Some(set_index as f64 + 1.0),
        Some(exercise.set_variation_index),
        Some(exercise.description_index),
        Some(exercise.exercise_variation_index),
    );
    let mut fn_context = IScriptFnContext {
        prints: vec![],
        unit: settings.units,
        exercise_type: Some(exercise.exercise_type.clone()),
    };
    let fns = create_script_functions(settings);
    {
        let mut runner = ScriptRunner::new(
            script,
            &mut state,
            &mut other,
            &mut bindings,
            &fns,
            settings.units,
            &mut fn_context,
            IProgramMode::Update,
        );
        runner.execute(None)?;
    }
    let mut new_entry = apply_bindings(entry, &bindings, settings, uid);
    let mut merged = new_entry.state.clone().unwrap_or_default();
    for (k, v) in state {
        merged.insert(k, v);
    }
    new_entry.state = Some(merged);
    if !fn_context.prints.is_empty() {
        new_entry.update_prints = Some(fn_context.prints);
    }
    Ok(new_entry)
}

#[allow(dead_code)]
fn _unused(_: HistoryEntryVtype, _: IPercentage, _: UnitOrPct) {}
