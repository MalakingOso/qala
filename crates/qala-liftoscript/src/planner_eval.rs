//! Port of `pages/planner/plannerEvaluator.ts`.
//!
//! The TS wires `reuse.exercise`, `progress.reuse.exercise`,
//! `update.reuse.exercise` and `descriptions.reuse.exercise` as pointers into
//! the evaluated weeks, and later passes read through them while other
//! exercises are still being edited. Here every evaluated exercise lives in an
//! arena and those four pointers are indexes in side tables. The `Box` trees of
//! `IPlannerProgramExercise.reuse.exercise` are only built when the result is
//! returned, from the exercises' final state, which is what the TS output shows
//! once it is serialized. Reuse loops are cut at the repeat (the TS would
//! overflow the stack serializing them).
//!
//! JS object identity is used in two places: `originalProgress === progress`
//! and `originalUpdate === update`. Each progress/update object carries an id
//! that is copied where the TS shares the object (the property hoisted onto
//! every instance by `fillSingleProperties`) and fresh where it builds a new one.
#![allow(clippy::result_large_err)]

use std::collections::{BTreeMap, HashMap, HashSet};

use indexmap::{IndexMap, IndexSet};

use crate::exercise::{exercise_to_key, CustomExercises, ExerciseType};
use crate::js::{js_parse_int, js_sort_by, js_trim};
use crate::planner_exercise_eval::{
    get_line_and_offset_at, planner_key_from_exercise_variations, planner_key_from_full_name_with,
    IPlannerEvalFullResult, IPlannerExerciseEvaluatorDay, IPlannerExerciseEvaluatorWeek,
    PlannerExerciseEvaluator, PlannerExerciseEvaluatorMode,
};
use crate::planner_parse;
use crate::planner_program_exercise as pe;
use crate::progress::{create_empty_script_bindings, create_script_functions};
use crate::script_runner::ScriptRunner;
use crate::types::exercise_view::custom_exercise_to_view;
use crate::types::{
    IDayData, IDayDataRequired, IEither, IErrorKind, IPlannerEvalResult, IPlannerProgram,
    IPlannerProgramDay, IPlannerProgramExercise, IPlannerProgramExerciseWarmupSet,
    IPlannerProgramReuse, IPlannerProgramReuseSource, IPlannerReuseSection, IPlannerSyntaxPointer,
    IProgramExerciseDescriptions, IProgramExerciseProgress, IProgramExerciseProgressType,
    IProgramExerciseUpdate, IProgramExerciseUpdateType, IProgramMode, IScriptFnContext, ISettings,
    PlannerSyntaxError,
};
use crate::util::generator::UidSource;
use crate::weight;

type Res<T> = Result<T, PlannerSyntaxError>;

/// `{ evaluatedWeeks, exerciseFullNames }` of `PlannerEvaluator_evaluate`/`forceEvaluate`.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannerEvalOutput {
    pub evaluated_weeks: Vec<Vec<IPlannerEvalResult>>,
    pub exercise_full_names: Vec<String>,
}

/// `{ evaluatedWeeks, exerciseFullNames }` of `PlannerEvaluator_evaluateFull`.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannerEvalFullOutput {
    pub evaluated_weeks: IPlannerEvalFullResult,
    pub exercise_full_names: Vec<String>,
}

/// The three fields `PlannerEvaluator_compareExerciseOrder` reads.
#[derive(Debug, Clone, Copy, Default)]
pub struct ExerciseOrderKey {
    pub exercise_index: Option<i64>,
    pub notused: Option<bool>,
    pub is_repeat: Option<bool>,
}

impl From<&IPlannerProgramExercise> for ExerciseOrderKey {
    fn from(e: &IPlannerProgramExercise) -> Self {
        ExerciseOrderKey { exercise_index: Some(e.exercise_index), notused: e.notused, is_repeat: e.is_repeat }
    }
}

/// `PlannerEvaluator_compareExerciseOrder`: the JS number (always an integer) the comparator returns.
pub fn compare_exercise_order(ex1: ExerciseOrderKey, ex2: ExerciseOrderKey) -> i64 {
    let i1 = ex1.exercise_index.unwrap_or(0);
    let i2 = ex2.exercise_index.unwrap_or(0);
    if i1 != i2 {
        return i1 - i2;
    }
    if ex1.notused.unwrap_or(false) != ex2.notused.unwrap_or(false) {
        return if ex1.notused.unwrap_or(false) { -1 } else { 1 };
    }
    (if ex1.is_repeat.unwrap_or(false) { 0 } else { 1 }) - (if ex2.is_repeat.unwrap_or(false) { 0 } else { 1 })
}

/// `PlannerEvaluator_getFirstError`: the last failing day, like the TS loop.
pub fn get_first_error(evaluated_weeks: &[Vec<IPlannerEvalResult>]) -> Option<&PlannerSyntaxError> {
    let mut error = None;
    for week in evaluated_weeks {
        for day in week {
            if let IEither::Failure(e) = day {
                error = Some(e);
            }
        }
    }
    error
}

/// `PlannerEvaluator_getDayIndexFromWeekAndDayInWeekIndex`
pub fn get_day_index_from_week_and_day_in_week_index(
    evaluated_weeks: &[Vec<IPlannerEvalResult>],
    week_index: usize,
    day_in_week_index: usize,
) -> Option<usize> {
    day_index_of(evaluated_weeks.iter().map(|w| w.len()), week_index, day_in_week_index)
}

fn day_index_of(week_lens: impl Iterator<Item = usize>, week_index: usize, day_in_week_index: usize) -> Option<usize> {
    let mut day_index = 0;
    for (i, len) in week_lens.enumerate() {
        for j in 0..len {
            if i == week_index && j == day_in_week_index {
                return Some(day_index);
            }
            day_index += 1;
        }
    }
    None
}

/// `PlannerEvaluator_changeExerciseName`
pub fn change_exercise_name(text: &str, from: &str, to: &str, settings: &ISettings) -> String {
    let evaluator = PlannerExerciseEvaluator::new(text, settings, PlannerExerciseEvaluatorMode::PerDay, None);
    let tree = planner_parse::parse(text);
    evaluator.change_exercise_name(&tree, from, to)
}

/// `PlannerEvaluator_evaluateDay`
pub fn evaluate_day(
    day: &IPlannerProgramDay,
    day_data: IDayDataRequired,
    settings: &ISettings,
    uid: &mut dyn UidSource,
) -> IPlannerEvalResult {
    let tree = planner_parse::parse(&day.exercise_text);
    let mut evaluator =
        PlannerExerciseEvaluator::new(&day.exercise_text, settings, PlannerExerciseEvaluatorMode::PerDay, Some(day_data));
    match evaluator.evaluate(&tree, uid) {
        IEither::Success(weeks) => {
            let exercises = weeks
                .into_iter()
                .next()
                .and_then(|w| w.days.into_iter().next())
                .map(|d| d.exercises)
                .unwrap_or_default();
            IEither::Success(exercises)
        }
        IEither::Failure(e) => IEither::Failure(e),
    }
}

/// `PlannerEvaluator_forceEvaluate`. Ids come from `uid`.
pub fn force_evaluate(planner: &IPlannerProgram, settings: &ISettings, uid: &mut dyn UidSource) -> PlannerEvalOutput {
    let mut ctx = Ctx::new(settings);
    ctx.per_day_weeks(planner, uid);
    ctx.post_process();
    let exercise_full_names = ctx.meta.full_names.iter().cloned().collect();
    PlannerEvalOutput { evaluated_weeks: ctx.materialize_weeks(), exercise_full_names }
}

/// `PlannerEvaluator_evaluate` (the TS memoizes by program text; there is no cache here).
pub fn evaluate(planner: &IPlannerProgram, settings: &ISettings, uid: &mut dyn UidSource) -> PlannerEvalOutput {
    force_evaluate(planner, settings, uid)
}

/// `PlannerEvaluator_evaluateFull`
pub fn evaluate_full(full_program_text: &str, settings: &ISettings, uid: &mut dyn UidSource) -> PlannerEvalFullOutput {
    let mut ctx = Ctx::new(settings);
    let full = ctx.full_weeks(full_program_text, uid);
    let names = |ctx: &Ctx| ctx.meta.full_names.iter().cloned().collect::<Vec<String>>();
    let (shape, id_weeks) = match full {
        Err(e) => {
            return PlannerEvalFullOutput {
                evaluated_weeks: IEither::Failure(e),
                exercise_full_names: names(&ctx),
            }
        }
        Ok(pair) => pair,
    };
    // `PlannerProgram_fullToWeekEvalResult`
    ctx.weeks = id_weeks.into_iter().map(|w| w.into_iter().map(Day::Ok).collect()).collect();
    ctx.post_process();
    for week in &ctx.weeks {
        for day in week {
            if let Day::Err(e) = day {
                return PlannerEvalFullOutput {
                    evaluated_weeks: IEither::Failure(e.clone()),
                    exercise_full_names: names(&ctx),
                };
            }
        }
    }
    let mut out_weeks = Vec::new();
    for (w, week) in shape.into_iter().enumerate() {
        let mut days = Vec::new();
        for (d, day) in week.days.into_iter().enumerate() {
            let exercises = match ctx.weeks.get(w).and_then(|ws| ws.get(d)) {
                Some(Day::Ok(ids)) => ids.iter().map(|id| ctx.materialize(*id, &mut Vec::new())).collect(),
                _ => Vec::new(),
            };
            days.push(IPlannerExerciseEvaluatorDay { name: day.name, line: day.line, exercises });
        }
        out_weeks.push(IPlannerExerciseEvaluatorWeek { name: week.name, line: week.line, days });
    }
    PlannerEvalFullOutput { evaluated_weeks: IEither::Success(out_weeks), exercise_full_names: names(&ctx) }
}

// ---------------------------------------------------------------------------
// working state

struct Ex {
    data: IPlannerProgramExercise,
    reuse_t: Option<usize>,
    progress_t: Option<usize>,
    update_t: Option<usize>,
    descr_t: Option<usize>,
    progress_id: u64,
    update_id: u64,
    /// Non-zero when the progress/update reuse record is the one object the TS
    /// shares between sibling instances; resolving it for one resolves all.
    progress_reuse_id: u64,
    update_reuse_id: u64,
}

// Private and short-lived; boxing the error would only add noise at its few uses.
#[allow(clippy::large_enum_variant)]
enum Day {
    Ok(Vec<usize>),
    Err(PlannerSyntaxError),
}

struct Prop<T> {
    value: T,
    id: u64,
    day_data: IDayDataRequired,
}

#[derive(Default)]
struct Meta {
    /// key -> week index -> day index -> exercise. JS integer keys iterate ascending, hence the BTreeMaps.
    by_exercise_week_day: IndexMap<String, BTreeMap<i64, BTreeMap<i64, usize>>>,
    by_week_day_exercise: HashSet<(i64, i64, String)>,
    full_names: IndexSet<String>,
    notused: HashSet<String>,
    id: HashMap<String, (Vec<i64>, IDayDataRequired)>,
    progress: HashMap<String, Prop<IProgramExerciseProgress>>,
    update: HashMap<String, Prop<IProgramExerciseUpdate>>,
    warmup: HashMap<String, (Vec<IPlannerProgramExerciseWarmupSet>, IDayDataRequired)>,
}

struct Ctx<'a> {
    settings: &'a ISettings,
    custom: CustomExercises,
    arena: Vec<Ex>,
    weeks: Vec<Vec<Day>>,
    meta: Meta,
    next_id: u64,
}

fn err(full_name: &str, message: &str, point: IPlannerSyntaxPointer, kind: IErrorKind) -> PlannerSyntaxError {
    PlannerSyntaxError::from_point(Some(full_name), message, point, kind.into())
}

fn is_custom_progress(p: &IProgramExerciseProgress) -> bool {
    p.kind == IProgramExerciseProgressType::Custom
}

fn starts_with_dots(d: &IProgramExerciseDescriptions) -> bool {
    d.values.len() == 1 && d.values[0].value.starts_with("...")
}

/// `PlannerKey_fromPlannerExercise`
fn planner_key_from_planner_exercise(e: &IPlannerProgramExercise, custom: &CustomExercises) -> String {
    if e.exercise_variations.len() > 1 {
        planner_key_from_exercise_variations(&e.exercise_variations, e.label.as_deref())
    } else if let Some(t) = &e.exercise_type {
        let key = exercise_to_key(&ExerciseType::from(t));
        let prefix = match e.label.as_deref() {
            Some(l) if !l.is_empty() => format!("{}-", l),
            _ => String::new(),
        };
        format!("{}{}", prefix, key).to_lowercase()
    } else {
        planner_key_from_full_name_with(&e.full_name, custom)
    }
}

impl<'a> Ctx<'a> {
    fn new(settings: &'a ISettings) -> Self {
        let custom: CustomExercises =
            settings.exercises.iter().map(|(k, v)| (k.clone(), custom_exercise_to_view(v))).collect();
        Ctx { settings, custom, arena: Vec::new(), weeks: Vec::new(), meta: Meta::default(), next_id: 1 }
    }

    fn fresh_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn add(&mut self, data: IPlannerProgramExercise) -> usize {
        let progress_id = if data.progress.is_some() { self.fresh_id() } else { 0 };
        let update_id = if data.update.is_some() { self.fresh_id() } else { 0 };
        self.arena.push(Ex {
            data,
            reuse_t: None,
            progress_t: None,
            update_t: None,
            descr_t: None,
            progress_id,
            update_id,
            progress_reuse_id: 0,
            update_reuse_id: 0,
        });
        self.arena.len() - 1
    }

    fn key_of_full_name(&self, full_name: &str) -> String {
        planner_key_from_full_name_with(full_name, &self.custom)
    }

    // ---- evaluation entry points

    /// `PlannerEvaluator_getPerDayEvaluatedWeeks`
    fn per_day_weeks(&mut self, planner: &IPlannerProgram, uid: &mut dyn UidSource) {
        let mut day_index = 0;
        for (week_index, week) in planner.weeks.iter().enumerate() {
            let mut week_days = Vec::new();
            for (day_in_week_index, day) in week.days.iter().enumerate() {
                let day_data = IDayDataRequired {
                    week: week_index as i64 + 1,
                    day_in_week: day_in_week_index as i64 + 1,
                    day: day_index + 1,
                };
                let result = evaluate_day(day, day_data, self.settings, uid);
                day_index += 1;
                match result {
                    IEither::Success(exercises) => {
                        let ids: Vec<usize> = exercises.into_iter().map(|e| self.add(e)).collect();
                        let mut failure = None;
                        for id in &ids {
                            if let Err(e) = self.fill_in_metadata(*id, day_data) {
                                failure = Some(e);
                                break;
                            }
                        }
                        week_days.push(match failure {
                            Some(e) => Day::Err(e),
                            None => Day::Ok(ids),
                        });
                    }
                    IEither::Failure(e) => week_days.push(Day::Err(e)),
                }
            }
            self.weeks.push(week_days);
        }
    }

    /// `PlannerEvaluator_getFullEvaluatedWeeks`: the shape of the full result plus the exercise ids per day.
    #[allow(clippy::type_complexity)]
    fn full_weeks(
        &mut self,
        text: &str,
        uid: &mut dyn UidSource,
    ) -> Res<(Vec<IPlannerExerciseEvaluatorWeek>, Vec<Vec<Vec<usize>>>)> {
        let mut evaluator = PlannerExerciseEvaluator::new(text, self.settings, PlannerExerciseEvaluatorMode::Full, None);
        let tree = planner_parse::parse(text);
        let weeks = evaluator.evaluate(&tree, uid).into_result()?;
        let mut shape = Vec::new();
        let mut id_weeks = Vec::new();
        for week in weeks {
            let mut shape_days = Vec::new();
            let mut id_days = Vec::new();
            for day in week.days {
                let ids: Vec<usize> = day.exercises.into_iter().map(|e| self.add(e)).collect();
                id_days.push(ids);
                shape_days.push(IPlannerExerciseEvaluatorDay { name: day.name, line: day.line, exercises: Vec::new() });
            }
            shape.push(IPlannerExerciseEvaluatorWeek { name: week.name, line: week.line, days: shape_days });
            id_weeks.push(id_days);
        }
        let mut day_index = 0;
        for (week_index, week) in id_weeks.iter().enumerate() {
            for (day_in_week_index, ids) in week.iter().enumerate() {
                for id in ids {
                    let day_data = IDayDataRequired {
                        week: week_index as i64 + 1,
                        day_in_week: day_in_week_index as i64 + 1,
                        day: day_index + 1,
                    };
                    self.fill_in_metadata(*id, day_data)?;
                }
                day_index += 1;
            }
        }
        Ok((shape, id_weeks))
    }

    // ---- metadata

    /// `PlannerEvaluator_fillInMetadata`
    fn fill_in_metadata(&mut self, id: usize, day_data: IDayDataRequired) -> Res<()> {
        // dp progress with rep ranges swaps in the range script
        let swap = {
            let d = &self.arena[id].data;
            d.progress.as_ref().is_some_and(|p| p.kind == IProgramExerciseProgressType::Dp)
                && d.set_variations.iter().any(|sv| {
                    sv.sets.iter().any(|s| s.rep_range.as_ref().is_some_and(|r| r.minrep.is_some()))
                })
        };
        if swap {
            let nid = self.fresh_id();
            let ex = &mut self.arena[id];
            if let Some(p) = ex.data.progress.as_mut() {
                p.script = Some(pe::build_dp_range_script());
            }
            ex.progress_id = nid;
        }
        let ex = &self.arena[id].data;
        let key = ex.key.clone();
        let full_name = ex.full_name.clone();
        let name = ex.name.clone();
        let msg_tail = |existing: &IDayDataRequired| {
            format!(
                "week {}, day {} and week {}, day {}",
                existing.week + 1,
                existing.day_in_week + 1,
                day_data.week,
                day_data.day_in_week
            )
        };
        if self.meta.by_week_day_exercise.contains(&(day_data.week - 1, day_data.day_in_week - 1, key.clone())) {
            return Err(err(
                &full_name,
                "Another exercise with the same name is already used in this day. Combine them together, or add a label to separate out.",
                ex.points.full_name,
                IErrorKind::DuplicateExerciseInDay { key },
            ));
        }
        if !ex.tags.is_empty() {
            if let Some((existing_tags, existing_day)) = self.meta.id.get(&key) {
                if *existing_tags != ex.tags {
                    let point = ex.points.id_point.unwrap_or(ex.points.full_name);
                    return Err(err(
                        &full_name,
                        &format!(
                            "Same property 'id' is specified with different arguments in multiple weeks/days for exercise '{}': both in {}",
                            name,
                            msg_tail(existing_day)
                        ),
                        point,
                        IErrorKind::ConflictingProperty {
                            property: "id".to_string(),
                            exercise: name,
                            a: (*existing_day).into(),
                            b: day_data.into(),
                        },
                    ));
                }
            }
            self.meta.id.insert(key.clone(), (ex.tags.clone(), day_data));
        }
        if let Some(progress) = &ex.progress {
            if progress.kind != IProgramExerciseProgressType::None {
                if let Some(existing) = self.meta.progress.get(&key) {
                    if !PlannerExerciseEvaluator::is_equal_progress(progress, &existing.value) {
                        let point = ex.points.progress_point.unwrap_or(ex.points.full_name);
                        return Err(err(
                            &full_name,
                            &format!(
                                "Same property 'progress' is specified with different arguments in multiple weeks/days for exercise '{}': both in {}",
                                name,
                                msg_tail(&existing.day_data)
                            ),
                            point,
                            IErrorKind::ConflictingProperty {
                                property: "progress".to_string(),
                                exercise: name,
                                a: existing.day_data.into(),
                                b: day_data.into(),
                            },
                        ));
                    }
                }
                self.meta.progress.insert(
                    key.clone(),
                    Prop { value: progress.clone(), id: self.arena[id].progress_id, day_data },
                );
            }
        }
        let ex = &self.arena[id].data;
        if let Some(update) = &ex.update {
            if let Some(existing) = self.meta.update.get(&key) {
                if !PlannerExerciseEvaluator::is_equal_update(update, &existing.value) {
                    let point = ex.points.update_point.unwrap_or(ex.points.full_name);
                    return Err(err(
                        &full_name,
                        &format!(
                            "Same property 'update' is specified with different arguments in multiple weeks/days for exercise '{}': both in {}",
                            name,
                            msg_tail(&existing.day_data)
                        ),
                        point,
                        IErrorKind::ConflictingProperty {
                            property: "update".to_string(),
                            exercise: name,
                            a: existing.day_data.into(),
                            b: day_data.into(),
                        },
                    ));
                }
            }
            self.meta
                .update
                .insert(key.clone(), Prop { value: update.clone(), id: self.arena[id].update_id, day_data });
        }
        let ex = &self.arena[id].data;
        if ex.notused == Some(true) {
            self.meta.notused.insert(key.clone());
        }
        if let Some(warmup_sets) = &ex.warmup_sets {
            let scheme = serde_json::to_string(warmup_sets).unwrap_or_default();
            if let Some((existing_sets, existing_day)) = self.meta.warmup.get(&key) {
                if serde_json::to_string(existing_sets).unwrap_or_default() != scheme {
                    return Err(err(
                        &full_name,
                        &format!(
                            "Different warmup sets are specified in multiple weeks/days for exercise '{}': both in {}",
                            name,
                            msg_tail(existing_day)
                        ),
                        ex.points.warmup_point.unwrap_or(ex.points.full_name),
                        IErrorKind::ConflictingProperty {
                            property: "warmup".to_string(),
                            exercise: name,
                            a: (*existing_day).into(),
                            b: day_data.into(),
                        },
                    ));
                }
            }
            self.meta.warmup.insert(key.clone(), (warmup_sets.clone(), day_data));
        }
        self.meta.by_week_day_exercise.insert((day_data.week - 1, day_data.day_in_week - 1, key.clone()));
        self.set_by_exercise_week_day(&key, day_data.week - 1, day_data.day_in_week - 1, id);
        self.meta.full_names.insert(full_name);
        Ok(())
    }

    /// `PlannerEvaluator_setByExerciseWeekDay` on the metadata collection.
    fn set_by_exercise_week_day(&mut self, key: &str, week_index: i64, day_index: i64, id: usize) {
        self.meta
            .by_exercise_week_day
            .entry(key.to_string())
            .or_default()
            .entry(week_index)
            .or_default()
            .insert(day_index, id);
    }

    fn by_exercise_week_day(&self, key: &str, week_index: i64, day_index: i64) -> Option<usize> {
        self.meta.by_exercise_week_day.get(key)?.get(&week_index)?.get(&day_index).copied()
    }

    // ---- passes

    /// `PlannerEvaluator_iterateOverExercises`. A failure marks that day failed and goes on with the next day.
    fn iterate(&mut self, cb: &mut dyn FnMut(&mut Self, usize, usize, usize) -> Res<()>) {
        for week_index in 0..self.weeks.len() {
            for day_in_week_index in 0..self.weeks[week_index].len() {
                let mut i = 0;
                let mut failure = None;
                loop {
                    let id = match &self.weeks[week_index][day_in_week_index] {
                        Day::Ok(ids) if i < ids.len() => ids[i],
                        _ => break,
                    };
                    if let Err(e) = cb(self, week_index, day_in_week_index, id) {
                        failure = Some(e);
                        break;
                    }
                    i += 1;
                }
                if let Some(e) = failure {
                    self.weeks[week_index][day_in_week_index] = Day::Err(e);
                }
            }
        }
    }

    /// `PlannerEvaluator_postProcess`
    fn post_process(&mut self) {
        self.iterate(&mut |ctx, week_index, day_in_week_index, id| {
            ctx.fill_descriptions(id, week_index, day_in_week_index);
            ctx.fill_repeats(id, day_in_week_index);
            ctx.fill_single_properties(id);
            ctx.check_unknown_exercises(id)
        });
        self.iterate(&mut |ctx, week_index, day_in_week_index, id| {
            ctx.fill_set_reuses(id, week_index)?;
            ctx.fill_description_reuses(id, week_index)?;
            ctx.fill_progress_reuses(id)?;
            ctx.fill_update_reuses(id)?;
            ctx.check_update_script(
                id,
                IDayData {
                    week: Some(week_index as i64 + 1),
                    day_in_week: Some(day_in_week_index as i64 + 1),
                    day: day_in_week_index as i64 + 1,
                },
            )
        });
        // its own pass: reuses are wired in document order
        self.iterate(&mut |ctx, _w, _d, id| {
            ctx.check_reuse_loops(id)?;
            ctx.check_reuses_resolve(id)
        });
        for w in 0..self.weeks.len() {
            for d in 0..self.weeks[w].len() {
                if let Day::Ok(ids) = &mut self.weeks[w][d] {
                    let taken = std::mem::take(ids);
                    let arena = &self.arena;
                    *ids = js_sort_by(taken, |a, b| {
                        compare_exercise_order((&arena[*a].data).into(), (&arena[*b].data).into()) as f64
                    });
                }
            }
        }
        self.iterate(&mut |ctx, _w, _d, id| {
            ctx.fill_evaluated_set_variations(id);
            Ok(())
        });
    }

    /// `PlannerEvaluator_findLastWeekExercise` with the `descriptions != null` condition (always true here).
    fn find_last_week_exercise(&self, week_index: usize, day_index: usize, key: &str) -> Option<usize> {
        let mut i = week_index as i64 - 1;
        while i >= 0 {
            let day = self.weeks.get(i as usize).and_then(|w| w.get(day_index))?;
            if let Day::Ok(ids) = day {
                if let Some(found) = ids.iter().find(|id| self.arena[**id].data.key == key) {
                    return Some(*found);
                }
            }
            i -= 1;
        }
        None
    }

    /// `PlannerEvaluator_fillDescriptions`
    fn fill_descriptions(&mut self, id: usize, week_index: usize, day_index: usize) {
        if !self.arena[id].data.descriptions.values.is_empty() {
            return;
        }
        let key = self.arena[id].data.key.clone();
        if let Some(last) = self.find_last_week_exercise(week_index, day_index, &key) {
            self.arena[id].data.descriptions = self.arena[last].data.descriptions.clone();
        }
    }

    /// `PlannerEvaluator_fillRepeats`
    fn fill_repeats(&mut self, id: usize, day_in_week_index: usize) {
        let repeat = self.arena[id].data.repeat.clone();
        let key = self.arena[id].data.key.clone();
        for repeat_week in repeat {
            let repeat_week_index = repeat_week - 1;
            if self.by_exercise_week_day(&key, repeat_week_index, day_in_week_index as i64).is_some() {
                continue;
            }
            let day_index = if repeat_week_index < 0 {
                None
            } else {
                day_index_of(self.weeks.iter().map(|w| w.len()), repeat_week_index as usize, day_in_week_index)
            };
            let day_data = IDayDataRequired {
                week: repeat_week,
                day_in_week: day_in_week_index as i64 + 1,
                day: day_index.map(|d| d as i64).unwrap_or(0) + 1,
            };
            let mut copy = self.arena[id].data.clone();
            if let Some(r) = copy.reuse.as_mut() {
                r.exercise = None;
            }
            copy.repeat = Vec::new();
            copy.day_data = day_data;
            copy.is_repeat = Some(true);
            let (progress_id, update_id) = (self.fresh_id(), self.fresh_id());
            let new_id = self.arena.len();
            self.arena.push(Ex {
                data: copy,
                reuse_t: None,
                progress_t: None,
                update_t: None,
                descr_t: None,
                progress_id,
                update_id,
                progress_reuse_id: 0,
                update_reuse_id: 0,
            });
            self.set_by_exercise_week_day(&key, repeat_week_index, day_in_week_index as i64, new_id);
            if repeat_week_index >= 0 {
                if let Some(Day::Ok(ids)) =
                    self.weeks.get_mut(repeat_week_index as usize).and_then(|w| w.get_mut(day_in_week_index))
                {
                    ids.push(new_id);
                }
            }
        }
    }

    /// `PlannerEvaluator_fillSingleProperties`
    fn fill_single_properties(&mut self, id: usize) {
        let key = self.arena[id].data.key.clone();
        if self.meta.notused.contains(&key) {
            self.arena[id].data.notused = Some(true);
        }
        if let Some(p) = self.meta.progress.get(&key) {
            if self.arena[id].data.progress.is_none() {
                let ex = &mut self.arena[id];
                ex.data.progress = Some(p.value.clone());
                ex.progress_id = p.id;
            }
        }
        if let Some(u) = self.meta.update.get(&key) {
            if self.arena[id].data.update.is_none() {
                let ex = &mut self.arena[id];
                ex.data.update = Some(u.value.clone());
                ex.update_id = u.id;
            }
        }
        if let Some((sets, _)) = self.meta.warmup.get(&key) {
            self.arena[id].data.warmup_sets = Some(sets.clone());
        }
    }

    /// `PlannerEvaluator_checkUnknownExercises`
    fn check_unknown_exercises(&self, id: usize) -> Res<()> {
        let ex = &self.arena[id].data;
        if self.meta.notused.contains(&ex.key) {
            return Ok(());
        }
        let variations = &ex.exercise_variations;
        if variations.len() > 1 {
            for v in variations {
                if v.exercise_type.is_none() {
                    return Err(err(
                        &ex.full_name,
                        &format!("Unknown exercise {}", v.name),
                        ex.points.full_name,
                        IErrorKind::UnknownExercise { name: v.name.clone() },
                    ));
                }
            }
        } else if ex.exercise_type.is_none() {
            return Err(err(
                &ex.full_name,
                &format!("Unknown exercise {}", ex.name),
                ex.points.full_name,
                IErrorKind::UnknownExercise { name: ex.name.clone() },
            ));
        }
        Ok(())
    }

    /// `PlannerEvaluator_findOriginalExercisesAtWeekDay`: `(exercise, dayData)`.
    fn find_original_exercises(
        &self,
        full_name: &str,
        at_week: i64,
        at_day: Option<i64>,
    ) -> Vec<(usize, IDayDataRequired)> {
        let mut out = Vec::new();
        if at_week < 1 {
            return out;
        }
        let Some(week) = self.weeks.get(at_week as usize - 1) else { return out };
        let candidates: Vec<Option<&Day>> = match at_day {
            Some(d) => vec![if d >= 1 { week.get(d as usize - 1) } else { None }],
            None => week.iter().map(Some).collect(),
        };
        let original_key = self.key_of_full_name(full_name);
        for (day_in_week_index, day) in candidates.into_iter().enumerate() {
            let Some(Day::Ok(ids)) = day else { continue };
            for id in ids {
                let reusing_key = planner_key_from_planner_exercise(&self.arena[*id].data, &self.custom);
                if reusing_key == original_key {
                    out.push((
                        *id,
                        IDayDataRequired { week: at_week, day_in_week: day_in_week_index as i64 + 1, day: 1 },
                    ));
                }
            }
        }
        out
    }

    /// `PlannerEvaluator_forEachSiblingInstance`: every instance of the key, ascending week then day.
    fn sibling_instances(&self, key: &str) -> Vec<usize> {
        let mut out = Vec::new();
        if let Some(by_key) = self.meta.by_exercise_week_day.get(key) {
            for week in by_key.values() {
                out.extend(week.values().copied());
            }
        }
        out
    }

    /// `PlannerEvaluator_fillSetReuses`
    fn fill_set_reuses(&mut self, id: usize, week_index: usize) -> Res<()> {
        let (reuse, point, full_name) = {
            let d = &self.arena[id].data;
            match (&d.reuse, d.points.reuse_set_point) {
                (Some(r), Some(p)) => (r.clone(), p, d.full_name.clone()),
                _ => return Ok(()),
            }
        };
        let week = reuse.week.unwrap_or(week_index as i64 + 1);
        let originals = self.find_original_exercises(&reuse.full_name, week, reuse.day);
        if originals.len() > 1 {
            return Err(err(
                &full_name,
                "There're several exercises matching, please be more specific with [week:day] syntax",
                point,
                IErrorKind::ReuseAmbiguous,
            ));
        }
        let Some((orig_id, _)) = originals.first().copied() else {
            return Err(err(
                &full_name,
                &format!(
                    "No such exercise {} at week: {}{}",
                    reuse.full_name,
                    week,
                    match reuse.day {
                        Some(d) => format!(", day: {}", d),
                        None => String::new(),
                    }
                ),
                point,
                IErrorKind::ReuseTargetNotFound { full_name: reuse.full_name.clone(), week: Some(week), day: reuse.day },
            ));
        };
        self.check_self_reuse(id, orig_id, "Exercise cannot reuse itself", point, IPlannerReuseSection::Sets)?;
        let (orig_progress, orig_update) = {
            let o = &self.arena[orig_id].data;
            if o.reuse.is_some() {
                return Err(err(
                    &full_name,
                    "Original exercise cannot reuse another exercise's sets x reps",
                    point,
                    IErrorKind::ReuseChained { section: IPlannerReuseSection::Sets },
                ));
            }
            if o.exercise_variations.len() > 1 {
                return Err(err(
                    &full_name,
                    &format!(
                        "Cannot reuse '{}' - it has multiple exercise variations. Move the shared sets/progress into a 'used: none' template and reuse that instead",
                        reuse.full_name
                    ),
                    point,
                    IErrorKind::ReuseTargetMultipleVariations { full_name: reuse.full_name.clone() },
                ));
            }
            let ex = &self.arena[id].data;
            if o.progress.as_ref().is_some_and(|p| p.reuse.is_some()) && ex.progress.is_none() && o.notused != Some(true)
            {
                return Err(err(
                    &full_name,
                    "This exercise doesn't specify progress - so the original USED exercise's progress cannot reuse another exercise's progress",
                    point,
                    IErrorKind::ReuseWithoutOwnSection { section: IPlannerReuseSection::Progress },
                ));
            }
            if o.update.as_ref().is_some_and(|u| u.reuse.is_some()) && ex.update.is_none() && o.notused != Some(true) {
                return Err(err(
                    &full_name,
                    "This exercise doesn't specify 'update' - so the original exercise's 'update' cannot reuse another exercise's 'update'",
                    point,
                    IErrorKind::ReuseWithoutOwnSection { section: IPlannerReuseSection::Update },
                ));
            }
            (
                if o.progress.is_some() && ex.progress.is_none() { o.progress.clone() } else { None },
                if o.update.is_some() && ex.update.is_none() { o.update.clone() } else { None },
            )
        };
        let orig_full_name = self.arena[orig_id].data.full_name.clone();
        let key = self.arena[id].data.key.clone();
        if let Some(original_progress) = orig_progress {
            let shared = IPlannerProgramReuse {
                full_name: orig_full_name.clone(),
                week: None,
                day: None,
                source: IPlannerProgramReuseSource::Overall,
                exercise: None,
            };
            let shared_id = self.fresh_id();
            for other in self.sibling_instances(&key) {
                if self.arena[other].data.progress.is_none() {
                    let nid = self.fresh_id();
                    let ex = &mut self.arena[other];
                    ex.data.progress = Some(IProgramExerciseProgress {
                        kind: original_progress.kind,
                        state: original_progress.state.clone(),
                        state_metadata: original_progress.state_metadata.clone(),
                        script: None,
                        reuse: Some(shared.clone()),
                        liftoscript_node: None,
                    });
                    ex.progress_id = nid;
                    ex.progress_reuse_id = shared_id;
                }
            }
        }
        if let Some(original_update) = orig_update {
            let shared = IPlannerProgramReuse {
                full_name: orig_full_name,
                week: None,
                day: None,
                source: IPlannerProgramReuseSource::Overall,
                exercise: None,
            };
            let shared_id = self.fresh_id();
            for other in self.sibling_instances(&key) {
                if self.arena[other].data.update.is_none() {
                    let nid = self.fresh_id();
                    let ex = &mut self.arena[other];
                    ex.data.update = Some(IProgramExerciseUpdate {
                        kind: original_update.kind,
                        script: None,
                        liftoscript_node: None,
                        meta: None,
                        reuse: Some(shared.clone()),
                    });
                    ex.update_id = nid;
                    ex.update_reuse_id = shared_id;
                }
            }
        }
        self.arena[id].reuse_t = Some(orig_id);
        Ok(())
    }

    /// `PlannerEvaluator_checkSelfReuse`: identity, not key.
    fn check_self_reuse(
        &self,
        id: usize,
        original: usize,
        message: &str,
        point: IPlannerSyntaxPointer,
        section: IPlannerReuseSection,
    ) -> Res<()> {
        if id == original {
            return Err(err(&self.arena[id].data.full_name, message, point, IErrorKind::ReuseSelf { section }));
        }
        Ok(())
    }

    /// `PlannerEvaluator_findReusedDescriptions`: `(exercise holding the description)`.
    fn find_reused_descriptions(&self, reusing_name: &str, current_week_index: usize) -> Option<usize> {
        let units: Vec<char> = reusing_name.chars().collect();
        let open = units.iter().position(|c| *c == '[');
        let close = units.iter().rposition(|c| *c == ']');
        let mut week_index: Option<i64> = None;
        let mut day_index: Option<i64> = None;
        let mut name: String = reusing_name.to_string();
        if let (Some(o), Some(c)) = (open, close) {
            if c >= o + 2 {
                let inner: String = units[o + 1..c].iter().collect();
                let mut parts = inner.split(':');
                let first = parts.next().unwrap_or("");
                let int = |s: &str| {
                    let n = js_parse_int(s, 10);
                    if n.is_nan() {
                        None
                    } else {
                        Some(n as i64 - 1)
                    }
                };
                match parts.next() {
                    Some(day_str) => {
                        week_index = int(first);
                        day_index = int(day_str);
                    }
                    None => day_index = int(first),
                }
                let mut rest: String = units[..o].iter().collect();
                rest.extend(units[c + 1..].iter());
                name = rest;
            }
        }
        let name = js_trim(&name).to_string();
        let key = self.key_of_full_name(&name);
        let week = week_index.unwrap_or(current_week_index as i64);
        let by_week = self.meta.by_exercise_week_day.get(&key)?.get(&week)?;
        let index = day_index.unwrap_or(0);
        if index < 0 {
            return None;
        }
        by_week.values().nth(index as usize).copied()
    }

    /// `PlannerEvaluator_fillDescriptionReuses`
    fn fill_description_reuses(&mut self, id: usize, week_index: usize) -> Res<()> {
        let reusing_name = {
            let d = &self.arena[id].data.descriptions;
            if !starts_with_dots(d) {
                return Ok(());
            }
            js_trim(&d.values[0].value.chars().skip(3).collect::<String>()).to_string()
        };
        let Some(orig) = self.find_reused_descriptions(&reusing_name, week_index) else { return Ok(()) };
        let (full_name, point) = {
            let d = &self.arena[id].data;
            (d.full_name.clone(), d.points.full_name)
        };
        self.check_self_reuse(id, orig, "Exercise cannot reuse its own description", point, IPlannerReuseSection::Description)?;
        let o = &self.arena[orig].data;
        // a target that is itself borrowing is rejected, whether or not it has been wired yet
        if o.descriptions.reuse.is_some() || starts_with_dots(&o.descriptions) {
            return Err(err(
                &full_name,
                "Original exercise cannot reuse another description - reuse the one that writes it instead",
                point,
                IErrorKind::ReuseChained { section: IPlannerReuseSection::Description },
            ));
        }
        let values = o.descriptions.values.clone();
        let orig_full_name = o.full_name.clone();
        let ex = &mut self.arena[id];
        ex.data.descriptions = IProgramExerciseDescriptions {
            values,
            reuse: Some(IPlannerProgramReuse {
                full_name: orig_full_name,
                week: None,
                day: None,
                source: IPlannerProgramReuseSource::Specific,
                exercise: None,
            }),
        };
        ex.descr_t = Some(orig);
        Ok(())
    }

    /// `PlannerEvaluator_fillProgressReuses`
    fn fill_progress_reuses(&mut self, id: usize) -> Res<()> {
        let (progress, point, full_name, own_id) = {
            let ex = &self.arena[id];
            let Some(p) = &ex.data.progress else { return Ok(()) };
            (
                p.clone(),
                ex.data.points.progress_point.unwrap_or(ex.data.points.full_name),
                ex.data.full_name.clone(),
                ex.progress_id,
            )
        };
        if !is_custom_progress(&progress) {
            return Ok(());
        }
        let Some(reuse) = progress.reuse.as_ref().filter(|r| !r.full_name.is_empty()) else { return Ok(()) };
        let reuse_full_name = reuse.full_name.clone();
        let key = self.key_of_full_name(&reuse_full_name);
        if !self.meta.by_exercise_week_day.contains_key(&key) {
            return Err(err(
                &full_name,
                &format!("No such exercise {}", reuse_full_name),
                point,
                IErrorKind::ReuseTargetNotFound { full_name: reuse_full_name, week: None, day: None },
            ));
        }
        let Some(original) = self.meta.progress.get(&key) else {
            return Err(err(
                &full_name,
                "Original exercise should specify progress",
                point,
                IErrorKind::ReuseTargetMissingSection { section: IPlannerReuseSection::Progress },
            ));
        };
        let (original_progress, original_id, day_data) = (&original.value, original.id, original.day_data);
        // fillSingleProperties hands every instance the same progress object
        if original_id == own_id {
            return Err(err(
                &full_name,
                "Exercise cannot reuse its own progress",
                point,
                IErrorKind::ReuseSelf { section: IPlannerReuseSection::Progress },
            ));
        }
        if let Some(orig_reuse) = &original_progress.reuse {
            // the reuse pointer may not be resolved yet, so notused comes from the metadata
            let original_reuse_key = self.key_of_full_name(&orig_reuse.full_name);
            if !self.meta.notused.contains(&original_reuse_key) {
                return Err(err(
                    &full_name,
                    "Original exercise cannot reuse another progress",
                    point,
                    IErrorKind::ReuseChained { section: IPlannerReuseSection::Progress },
                ));
            }
        }
        if !is_custom_progress(original_progress) {
            return Err(err(
                &full_name,
                "Original exercise should specify custom progress",
                point,
                IErrorKind::ReuseTargetNotCustom { section: IPlannerReuseSection::Progress },
            ));
        }
        // the TS reads `state[key]` (the exercise key), not `state[stateKey]`, in the guard
        for (state_key, value) in &original_progress.state {
            if progress.state.contains_key(&key) {
                if let Some(mine) = progress.state.get(state_key) {
                    if weight::type_of(*value) != weight::type_of(*mine) {
                        return Err(err(
                            &full_name,
                            &format!("Wrong type of state variable {}", state_key),
                            point,
                            IErrorKind::ReuseStateTypeMismatch { state_key: state_key.clone() },
                        ));
                    }
                }
            }
        }
        let originals = self.find_original_exercises(&reuse_full_name_of(&progress), day_data.week, Some(day_data.day_in_week));
        let original_exercise = originals.first().map(|(i, _)| *i);
        if let Some(oe) = original_exercise {
            let o = &self.arena[oe].data;
            if o.reuse.is_some() && (o.progress.is_none() || o.progress.as_ref().is_some_and(|p| p.reuse.is_some())) {
                return Err(err(
                    &full_name,
                    &format!("Original exercise '{}' should not reuse other exercise", o.full_name),
                    point,
                    IErrorKind::ReuseChained { section: IPlannerReuseSection::Progress },
                ));
            }
        }
        if original_exercise.is_some() {
            self.arena[id].progress_t = original_exercise;
            let shared = self.arena[id].progress_reuse_id;
            if shared != 0 {
                for ex in self.arena.iter_mut().filter(|e| e.progress_reuse_id == shared) {
                    ex.progress_t = original_exercise;
                }
            }
        }
        Ok(())
    }

    /// `PlannerEvaluator_checkUpdateScript`. The error ranges are taken from the
    /// recorded Lezer node (`from`), and, like the TS, the line is looked up in the script text.
    fn check_update_script(&self, id: usize, day_data: IDayData) -> Res<()> {
        let ex = &self.arena[id].data;
        let Some(update) = &ex.update else { return Ok(()) };
        if update.kind != IProgramExerciseUpdateType::Custom {
            return Ok(());
        }
        let Some(script) = update.script.as_deref().filter(|s| !s.is_empty()) else { return Ok(()) };
        let Some(node_from) = update.liftoscript_node.as_ref().and_then(|n| n.get("from")).and_then(|f| f.as_i64())
        else {
            return Ok(());
        };
        let exercise_type = pe::get_exercise(ex, self.settings);
        let mut state = self.state_of(id, &mut Vec::new());
        let mut other_states = IndexMap::new();
        let mut bindings = create_empty_script_bindings(&day_data, self.settings, None);
        let fns = create_script_functions(self.settings);
        let mut context = IScriptFnContext { prints: Vec::new(), unit: self.settings.units, exercise_type };
        let mut runner = ScriptRunner::new(
            script,
            &mut state,
            &mut other_states,
            &mut bindings,
            &fns,
            self.settings.units,
            &mut context,
            IProgramMode::Update,
        );
        match runner.parse() {
            Ok(_) => Ok(()),
            Err(e) => {
                let (line, _) = get_line_and_offset_at(script, node_from.max(0) as usize);
                Err(PlannerSyntaxError::new(
                    e.message,
                    line + e.line,
                    e.offset,
                    node_from + e.from,
                    node_from + e.to,
                    e.details,
                ))
            }
        }
    }

    /// `PlannerEvaluator_fillUpdateReuses`
    fn fill_update_reuses(&mut self, id: usize) -> Res<()> {
        let (update, point, full_name, own_id) = {
            let ex = &self.arena[id];
            let Some(u) = &ex.data.update else { return Ok(()) };
            (
                u.clone(),
                ex.data.points.update_point.unwrap_or(ex.data.points.full_name),
                ex.data.full_name.clone(),
                ex.update_id,
            )
        };
        if update.kind != IProgramExerciseUpdateType::Custom {
            return Ok(());
        }
        let Some(reuse) = update.reuse.as_ref().filter(|r| !r.full_name.is_empty()) else { return Ok(()) };
        let reuse_full_name = reuse.full_name.clone();
        let key = self.key_of_full_name(&reuse_full_name);
        if !self.meta.by_exercise_week_day.contains_key(&key) {
            return Err(err(
                &full_name,
                &format!("No such exercise {}", reuse_full_name),
                point,
                IErrorKind::ReuseTargetNotFound { full_name: reuse_full_name, week: None, day: None },
            ));
        }
        let Some(original) = self.meta.update.get(&key) else {
            return Err(err(
                &full_name,
                "Original exercise should specify update",
                point,
                IErrorKind::ReuseTargetMissingSection { section: IPlannerReuseSection::Update },
            ));
        };
        let (original_update, original_id, day_data) = (&original.value, original.id, original.day_data);
        if original_id == own_id {
            return Err(err(
                &full_name,
                "Exercise cannot reuse its own update",
                point,
                IErrorKind::ReuseSelf { section: IPlannerReuseSection::Update },
            ));
        }
        if let Some(orig_reuse) = &original_update.reuse {
            let original_reuse_key = self.key_of_full_name(&orig_reuse.full_name);
            if !self.meta.notused.contains(&original_reuse_key) {
                return Err(err(
                    &full_name,
                    "Original exercise cannot reuse another update",
                    point,
                    IErrorKind::ReuseChained { section: IPlannerReuseSection::Update },
                ));
            }
        }
        if original_update.kind != IProgramExerciseUpdateType::Custom {
            return Err(err(
                &full_name,
                "Original exercise should specify custom update",
                point,
                IErrorKind::ReuseTargetNotCustom { section: IPlannerReuseSection::Update },
            ));
        }
        let state_keys: Vec<String> = original_update
            .meta
            .as_ref()
            .and_then(|m| m.state_keys.as_ref())
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        if !state_keys.is_empty() {
            if self.arena[id].data.progress.is_none() {
                return Err(err(
                    &full_name,
                    "If 'update' block uses state variables, exercise should define them in 'progress' block",
                    point,
                    IErrorKind::UpdateStateWithoutProgress,
                ));
            }
            let state = self.state_of(id, &mut Vec::new());
            for state_key in &state_keys {
                if !state.contains_key(state_key) {
                    return Err(err(
                        &full_name,
                        &format!("Missing state variable {} that's used in the original update block", state_key),
                        point,
                        IErrorKind::ReuseMissingStateVariable { state_key: state_key.clone() },
                    ));
                }
            }
        }
        let originals = self.find_original_exercises(&update_full_name(&update), day_data.week, Some(day_data.day_in_week));
        let original_exercise = originals.first().map(|(i, _)| *i);
        if let Some(oe) = original_exercise {
            let o = &self.arena[oe].data;
            if o.reuse.is_some() && (o.update.is_none() || o.update.as_ref().is_some_and(|u| u.reuse.is_some())) {
                return Err(err(
                    &full_name,
                    &format!("Original exercise '{}' should not reuse other exercise", o.full_name),
                    point,
                    IErrorKind::ReuseChained { section: IPlannerReuseSection::Update },
                ));
            }
        }
        if original_exercise.is_some() {
            self.arena[id].update_t = original_exercise;
            let shared = self.arena[id].update_reuse_id;
            if shared != 0 {
                for ex in self.arena.iter_mut().filter(|e| e.update_reuse_id == shared) {
                    ex.update_t = original_exercise;
                }
            }
        }
        Ok(())
    }

    /// `PlannerProgramExercise_getState` over the arena, with the loop guard.
    fn state_of(&self, id: usize, visited: &mut Vec<usize>) -> crate::types::IProgramState {
        let ex = &self.arena[id];
        if let Some(p) = &ex.data.progress {
            if p.reuse.is_none() {
                return p.state.clone();
            }
        }
        if visited.contains(&id) {
            return crate::types::IProgramState::new();
        }
        visited.push(id);
        let mut state = match ex.progress_t.or(ex.reuse_t) {
            Some(t) => self.state_of(t, visited),
            None => crate::types::IProgramState::new(),
        };
        if let Some(p) = &ex.data.progress {
            for (k, v) in &p.state {
                state.insert(k.clone(), *v);
            }
        }
        state
    }

    /// `PlannerEvaluator_checkReuseLoops`
    fn check_reuse_loops(&self, id: usize) -> Res<()> {
        let ex = &self.arena[id].data;
        let mut seen: Vec<usize> = Vec::new();
        let mut current = Some(id);
        while let Some(c) = current {
            let cur = &self.arena[c];
            if cur.data.progress.as_ref().is_some_and(|p| p.reuse.is_none()) {
                break;
            }
            if seen.contains(&c) {
                return Err(err(
                    &ex.full_name,
                    "This exercise ends up reusing itself through other exercises",
                    ex.points.progress_point.or(ex.points.reuse_set_point).unwrap_or(ex.points.full_name),
                    IErrorKind::ReuseCycle,
                ));
            }
            seen.push(c);
            current = cur.progress_t.or(cur.reuse_t);
        }
        Ok(())
    }

    fn own_progress_script(&self, id: Option<usize>) -> Option<&str> {
        self.arena[id?].data.progress.as_ref()?.script.as_deref()
    }

    fn own_update_script(&self, id: Option<usize>) -> Option<&str> {
        self.arena[id?].data.update.as_ref()?.script.as_deref()
    }

    /// `PlannerProgramExercise_getProgressScript` over the arena.
    fn progress_script(&self, id: usize) -> Option<&str> {
        let ex = &self.arena[id];
        let via = |t: Option<usize>| t.and_then(|t| self.arena[t].progress_t);
        self.own_progress_script(Some(id))
            .or_else(|| self.own_progress_script(ex.progress_t))
            .or_else(|| self.own_progress_script(via(ex.progress_t)))
            .or_else(|| self.own_progress_script(ex.reuse_t))
            .or_else(|| self.own_progress_script(via(ex.reuse_t)))
    }

    /// `PlannerProgramExercise_getUpdateScript` over the arena.
    fn update_script(&self, id: usize) -> Option<&str> {
        let ex = &self.arena[id];
        let via = |t: Option<usize>| t.and_then(|t| self.arena[t].update_t);
        self.own_update_script(Some(id))
            .or_else(|| self.own_update_script(ex.update_t))
            .or_else(|| self.own_update_script(via(ex.update_t)))
            .or_else(|| self.own_update_script(ex.reuse_t))
            .or_else(|| self.own_update_script(via(ex.reuse_t)))
    }

    /// `PlannerEvaluator_checkReusesResolve`
    fn check_reuses_resolve(&self, id: usize) -> Res<()> {
        let ex = &self.arena[id].data;
        if ex.progress.as_ref().is_some_and(is_custom_progress) && self.progress_script(id).is_none() {
            return Err(err(
                &ex.full_name,
                "Couldn't find the progress script this reuses - reuse the exercise that defines it instead",
                ex.points.progress_point.unwrap_or(ex.points.full_name),
                IErrorKind::ReuseScriptNotFound { section: IPlannerReuseSection::Progress },
            ));
        }
        if ex.update.is_some() && self.update_script(id).is_none() {
            return Err(err(
                &ex.full_name,
                "Couldn't find the update script this reuses - reuse the exercise that defines it instead",
                ex.points.update_point.unwrap_or(ex.points.full_name),
                IErrorKind::ReuseScriptNotFound { section: IPlannerReuseSection::Update },
            ));
        }
        Ok(())
    }

    /// `PlannerEvaluator_fillEvaluatedSetVariations`
    fn fill_evaluated_set_variations(&mut self, id: usize) {
        let ex = &self.arena[id];
        let reuse_ex = ex.reuse_t.map(|t| &self.arena[t].data);
        let variations = pe::set_variations_with(&ex.data, reuse_ex);
        let evaluated = pe::evaluate_set_variations_with(&ex.data, reuse_ex, &variations);
        self.arena[id].data.evaluated_set_variations = evaluated;
    }

    // ---- output

    /// Builds the owned tree of an exercise with every reuse pointer resolved to the
    /// target's final state. A pointer that would close a loop is left empty.
    fn materialize(&self, id: usize, path: &mut Vec<usize>) -> IPlannerProgramExercise {
        let ex = &self.arena[id];
        let mut d = ex.data.clone();
        path.push(id);
        let resolve = |target: Option<usize>, slot: Option<&mut IPlannerProgramReuse>, path: &mut Vec<usize>| {
            if let (Some(t), Some(r)) = (target, slot) {
                if !path.contains(&t) {
                    r.exercise = Some(Box::new(self.materialize(t, path)));
                }
            }
        };
        resolve(ex.reuse_t, d.reuse.as_mut(), path);
        resolve(ex.progress_t, d.progress.as_mut().and_then(|p| p.reuse.as_mut()), path);
        resolve(ex.update_t, d.update.as_mut().and_then(|u| u.reuse.as_mut()), path);
        resolve(ex.descr_t, d.descriptions.reuse.as_mut(), path);
        path.pop();
        d
    }

    fn materialize_weeks(&self) -> Vec<Vec<IPlannerEvalResult>> {
        self.weeks
            .iter()
            .map(|week| {
                week.iter()
                    .map(|day| match day {
                        Day::Ok(ids) => {
                            IEither::Success(ids.iter().map(|id| self.materialize(*id, &mut Vec::new())).collect())
                        }
                        Day::Err(e) => IEither::Failure(e.clone()),
                    })
                    .collect()
            })
            .collect()
    }
}

fn reuse_full_name_of(p: &IProgramExerciseProgress) -> String {
    p.reuse.as_ref().map(|r| r.full_name.clone()).unwrap_or_default()
}

fn update_full_name(u: &IProgramExerciseUpdate) -> String {
    u.reuse.as_ref().map(|r| r.full_name.clone()).unwrap_or_default()
}
