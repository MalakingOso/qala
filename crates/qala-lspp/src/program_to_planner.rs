//! Port of `models/programToPlanner.ts`: prints an evaluated program back to
//! Liftoscript planner text.
//!
//! `convert_to_planner` is the only entry the runtime uses. The TS throws the
//! first evaluation error after logging it and calling `Dialog_alert`; the
//! Rust returns it as `Err` and drops the alert and the log line (the
//! headless dialog stub only writes to stderr).

#![allow(clippy::result_large_err)]

use indexmap::{IndexMap, IndexSet};

use crate::exercise::{
    exercise_build_name, exercise_full_name, exercise_get, exercise_to_key, ExerciseSettings,
    ExerciseType,
};
use crate::js::{is_js_whitespace, js_number_to_string, js_trim};
use crate::planner_exercise_eval::planner_key_from_full_name;
use crate::planner_program::{self as pp_text, RenameTarget};
use crate::util::generator::UidSource;
use crate::pp;
use crate::planner_program_exercise as ppe;
use crate::types::exercise_view::ExerciseSettingsView;
use crate::types::{
    IDayDataRequired, IEvaluatedProgram, IPlannerProgram, IPlannerProgramDay,
    IPlannerProgramExercise, IPlannerProgramExerciseEvaluatedSet,
    IPlannerProgramExerciseEvaluatedSetVariation,
    IPlannerProgramExerciseWarmupSet, IPlannerProgramWeek, IPlannerTopLineItem,
    IPlannerTopLineType, IProgramExerciseProgressType,
    ISettings, IUnit, PlannerSyntaxError, PlannerVtype, ScriptValue, WeightOrPct,
};
use crate::util::math::n2;
use crate::weight;

type GroupedTopLines = Vec<Vec<Vec<Vec<IPlannerTopLineItem>>>>;

/// `IPlannerToProgramConvertOpts.reorder` entry.
#[derive(Debug, Clone, PartialEq)]
pub struct ReorderEntry {
    pub day_data: IDayDataRequired,
    pub from_index: i64,
    pub to_index: i64,
}

/// `IPlannerToProgramConvertOpts.add` entry.
#[derive(Debug, Clone, PartialEq)]
pub struct AddEntry {
    pub day_data: IDayDataRequired,
    pub index: i64,
    pub full_name: String,
}

/// `IPlannerToProgramConvertOpts`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ConvertOpts {
    pub rename_mapping: Option<IndexMap<String, RenameTarget>>,
    pub reorder: Option<Vec<ReorderEntry>>,
    pub add: Option<Vec<AddEntry>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dereuse {
    Sets,
    Weight,
    Rpe,
    Timer,
    SetTimer,
    Progress,
    Update,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Shareable {
    Progress,
    Update,
    Warmup,
    Id,
}

/// `IPlannerToProgram2Globals`.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Globals {
    weight: Option<WeightOrPct>,
    rpe: Option<f64>,
    timer: Option<f64>,
    set_timer: Option<f64>,
    is_overflow_set_timer: Option<bool>,
    log_rpe: Option<bool>,
    ask_weight: Option<bool>,
}

struct Candidate<'a> {
    location: String,
    exercise: &'a IPlannerProgramExercise,
    is_origin: bool,
}

struct Target<'a> {
    location: String,
    exercise: &'a IPlannerProgramExercise,
}

type Targets<'a> = IndexMap<(Shareable, String), Target<'a>>;

pub struct ProgramToPlanner<'a> {
    program: &'a IEvaluatedProgram,
    settings: &'a ISettings,
    view: ExerciseSettingsView<'a>,
}

// ---------------------------------------------------------------------------
// small JS helpers

fn max0(x: f64) -> f64 {
    if x.is_nan() {
        x
    } else {
        x.max(0.0)
    }
}

fn js_str_opt_f64(x: Option<f64>) -> String {
    x.map_or_else(|| "undefined".to_string(), js_number_to_string)
}

fn js_str_opt_bool(x: Option<bool>) -> String {
    x.map_or_else(|| "undefined".to_string(), |b| b.to_string())
}

fn splice_start(index: i64, len: usize) -> usize {
    if index < 0 {
        (len as i64 + index).max(0) as usize
    } else {
        (index as usize).min(len)
    }
}

/// `^\/\/\s*!?\s*` replaced with `// ! `.
fn mark_current_description(value: &str) -> String {
    match value.strip_prefix("//") {
        Some(rest) => {
            let rest = rest.trim_start_matches(is_js_whitespace);
            let rest = rest.strip_prefix('!').unwrap_or(rest);
            let rest = rest.trim_start_matches(is_js_whitespace);
            format!("// ! {}", rest)
        }
        None => value.to_string(),
    }
}

/// `^(\/\/\s*)!\s*` replaced with `$1`.
fn unmark_description(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("//") {
        let after_ws = rest.trim_start_matches(is_js_whitespace);
        if let Some(tail) = after_ws.strip_prefix('!') {
            let ws_len = rest.len() - after_ws.len();
            let tail = tail.trim_start_matches(is_js_whitespace);
            return format!("//{}{}", &rest[..ws_len], tail);
        }
    }
    value.to_string()
}

fn weight_expr_to_str(w: Option<WeightOrPct>) -> String {
    match w {
        Some(w) => weight::print(w),
        None => String::new(),
    }
}

/// JS `String(value)` of a state value where it is interpolated into a template.
fn state_to_js_string(v: Option<&ScriptValue>) -> String {
    match v {
        Some(ScriptValue::Number(n)) => js_number_to_string(*n),
        Some(_) => "[object Object]".to_string(),
        None => "undefined".to_string(),
    }
}

/// Numeric comparison `v > 1` where `v` may be a non-number: objects and
/// undefined give NaN, so the comparison is false.
fn state_num(v: Option<&ScriptValue>) -> f64 {
    match v {
        Some(ScriptValue::Number(n)) => *n,
        _ => f64::NAN,
    }
}

/// `x.value > 0` on a state value: numbers have no `.value`.
fn state_dot_value(v: Option<&ScriptValue>) -> f64 {
    match v {
        Some(ScriptValue::Weight(w)) => w.value,
        Some(ScriptValue::Percentage(p)) => p.value,
        _ => f64::NAN,
    }
}

/// `Weight_print` of a state value. A missing value would throw in TS.
fn print_state(v: Option<&ScriptValue>) -> String {
    match v {
        Some(v) => weight::print(*v),
        None => "undefined".to_string(),
    }
}

/// `PlannerKey_fromPlannerExercise`.
fn planner_key_from_exercise(e: &IPlannerProgramExercise, settings: &ISettings) -> String {
    let lower_label = |key: String| match e.label.as_deref().filter(|l| !l.is_empty()) {
        Some(l) => format!("{}-{}", l, key).to_lowercase(),
        None => key.to_lowercase(),
    };
    if e.exercise_variations.len() > 1 {
        let parts: Vec<String> = e
            .exercise_variations
            .iter()
            .map(|v| match &v.exercise_type {
                Some(t) => exercise_to_key(&ExerciseType::from(t)),
                None => v.name.clone(),
            })
            .collect();
        lower_label(parts.join("_"))
    } else if let Some(t) = &e.exercise_type {
        lower_label(exercise_to_key(&ExerciseType::from(t)))
    } else {
        planner_key_from_full_name(&e.full_name, &settings.exercises)
    }
}

impl<'a> ProgramToPlanner<'a> {
    pub fn new(program: &'a IEvaluatedProgram, settings: &'a ISettings) -> Self {
        ProgramToPlanner { program, settings, view: settings.exercise_view() }
    }

    fn get_current_description_exercise(
        &self,
        key: &str,
        week_index: usize,
        day_in_week_index: usize,
    ) -> Option<&'a IPlannerProgramExercise> {
        self.program
            .weeks
            .get(week_index)?
            .days
            .get(day_in_week_index)?
            .exercises
            .iter()
            .find(|e| e.key == key)
    }

    fn get_current_description_index(&self, key: &str, week_index: usize, day_in_week_index: usize) -> usize {
        self.get_current_description_exercise(key, week_index, day_in_week_index)
            .and_then(|e| e.descriptions.values.iter().position(|s| s.is_current))
            .unwrap_or(0)
    }

    fn should_reuse_sets(e: &IPlannerProgramExercise) -> bool {
        e.reuse.is_some()
    }

    fn get_dereuse_decisions(&self, exercise: &IPlannerProgramExercise) -> Vec<Dereuse> {
        let mut out: Vec<Dereuse> = Vec::new();
        let mut add = |d: Dereuse| {
            if !out.contains(&d) {
                out.push(d);
            }
        };
        let Some(reuse_exercise) = ppe::overall_reuse_exercise(exercise) else {
            return out;
        };
        let globals = self.get_globals(exercise);
        let reused_globals = self.get_globals(reuse_exercise);
        if exercise.evaluated_set_variations.len() != reuse_exercise.evaluated_set_variations.len() {
            add(Dereuse::Sets);
        }
        if ppe::current_evaluated_set_variation_index(exercise) != ppe::current_evaluated_set_variation_index(reuse_exercise) {
            add(Dereuse::Sets);
        }
        if reuse_exercise.progress.is_some() || exercise.progress.is_some() {
            let differs = match (&exercise.progress, &reuse_exercise.progress) {
                (None, _) => true,
                (Some(p), r) => {
                    r.as_ref().map(|r| r.kind) != Some(p.kind)
                        || (if let Some(pr) = &p.reuse {
                            Some(&pr.full_name) != Some(&reuse_exercise.full_name)
                        } else {
                            p.script.as_ref() != r.as_ref().and_then(|r| r.script.as_ref())
                        })
                        || !ppe::get_only_changed_state(exercise).is_empty()
                }
            };
            if differs {
                add(Dereuse::Progress);
            }
        }
        if reuse_exercise.update.is_some() || exercise.update.is_some() {
            let differs = match &exercise.update {
                None => true,
                Some(u) => {
                    if let Some(ur) = &u.reuse {
                        // `update.reuse?.fullName` is always defined when the reuse exists.
                        ur.full_name != reuse_exercise.full_name
                    } else {
                        u.script.as_ref() != reuse_exercise.update.as_ref().and_then(|x| x.script.as_ref())
                    }
                }
            };
            if differs {
                add(Dereuse::Update);
            }
        }
        if exercise.evaluated_set_variations.len() == reuse_exercise.evaluated_set_variations.len() {
            for (i, program_variation) in exercise.evaluated_set_variations.iter().enumerate() {
                let reuse_variation = &reuse_exercise.evaluated_set_variations[i];
                if program_variation.sets.len() != reuse_variation.sets.len() {
                    add(Dereuse::Sets);
                }
                for (j, program_set) in program_variation.sets.iter().enumerate() {
                    let reuse_set = reuse_variation.sets.get(j);
                    if program_set.maxrep != reuse_set.and_then(|s| s.maxrep)
                        || program_set.minrep != reuse_set.and_then(|s| s.minrep)
                    {
                        add(Dereuse::Sets);
                    }
                    let weight_differs = match reuse_set {
                        Some(rs) => {
                            !weight::eq_null(program_set.weight.map(Into::into), rs.weight.map(Into::into))
                                || Some(program_set.ask_weight) != Some(rs.ask_weight)
                        }
                        None => {
                            let a: ScriptValue = globals.weight.map_or(weight::ZERO.into(), Into::into);
                            let b: ScriptValue = reused_globals.weight.map_or(weight::ZERO.into(), Into::into);
                            !weight::eq(a, b) || globals.ask_weight != reused_globals.ask_weight
                        }
                    };
                    if weight_differs {
                        add(if globals.weight.is_some() { Dereuse::Weight } else { Dereuse::Sets });
                    }
                    let rpe_differs = match reuse_set {
                        Some(rs) => program_set.rpe != rs.rpe || program_set.log_rpe != rs.log_rpe,
                        None => globals.rpe != reused_globals.rpe || globals.log_rpe != reused_globals.log_rpe,
                    };
                    if rpe_differs {
                        add(if globals.rpe.is_some() { Dereuse::Rpe } else { Dereuse::Sets });
                    }
                    let timer_differs = match reuse_set {
                        Some(rs) => program_set.timer != rs.timer,
                        None => globals.timer != reused_globals.timer,
                    };
                    if timer_differs {
                        add(if globals.timer.is_some() { Dereuse::Timer } else { Dereuse::Sets });
                    }
                    if program_set.set_timer != reuse_set.and_then(|s| s.set_timer)
                        || program_set.is_overflow_set_timer.unwrap_or(false)
                            != reuse_set.and_then(|s| s.is_overflow_set_timer).unwrap_or(false)
                    {
                        add(if globals.set_timer.is_some() { Dereuse::SetTimer } else { Dereuse::Sets });
                    }
                }
            }
        }
        out
    }

    fn reorder_grouped_top_line(grouped: &mut GroupedTopLines, reorders: &[ReorderEntry]) {
        for reorder in reorders {
            let w = reorder.day_data.week - 1;
            let d = reorder.day_data.day_in_week - 1;
            if w < 0 || d < 0 {
                continue;
            }
            let Some(grouped_day) = grouped.get_mut(w as usize).and_then(|wk| wk.get_mut(d as usize)) else {
                continue;
            };
            let mut index_map: IndexMap<i64, usize> = IndexMap::new();
            let mut i: i64 = 0;
            for (index, group) in grouped_day.iter().enumerate() {
                let exercise = group.iter().find(|item| item.kind == IPlannerTopLineType::Exercise);
                if let Some(ex) = exercise {
                    if ex.notused != Some(true) {
                        index_map.insert(i, index);
                        i += 1;
                    }
                }
            }
            if let Some(&from_at) = index_map.get(&reorder.from_index) {
                let from = grouped_day.remove(from_at);
                // `splice(undefined, 0, x)` inserts at 0.
                let to_at = index_map.get(&reorder.to_index).copied().unwrap_or(0);
                let at = to_at.min(grouped_day.len());
                grouped_day.insert(at, from);
            }
        }
    }

    fn add_grouped_top_line(&self, grouped: &mut GroupedTopLines, adds: &[AddEntry]) {
        for add in adds {
            let w = add.day_data.week - 1;
            let d = add.day_data.day_in_week - 1;
            if w < 0 || d < 0 {
                continue;
            }
            let Some(grouped_day) = grouped.get_mut(w as usize).and_then(|wk| wk.get_mut(d as usize)) else {
                continue;
            };
            let at = splice_start(add.index, grouped_day.len());
            grouped_day.insert(
                at,
                vec![IPlannerTopLineItem {
                    kind: IPlannerTopLineType::Exercise,
                    value: planner_key_from_full_name(&add.full_name, &self.settings.exercises),
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
                }],
            );
        }
    }

    fn get_renamed_value(
        opts: &ConvertOpts,
        line: &IPlannerTopLineItem,
        week_index: usize,
        day_in_week_index: usize,
    ) -> String {
        if let Some(renamed) = opts.rename_mapping.as_ref().and_then(|m| m.get(&line.value)) {
            let day_ok = match &renamed.day_data {
                None => true,
                Some(dd) => dd.week == week_index as i64 + 1 && dd.day_in_week == day_in_week_index as i64 + 1,
            };
            if day_ok {
                return renamed.to.clone();
            }
        }
        line.value.clone()
    }

    fn add_exercise_descriptions(
        &self,
        exercise: Option<&IPlannerProgramExercise>,
        week_index: usize,
        day_in_week_index: usize,
        mut added_current_description: bool,
    ) -> Option<(Vec<String>, bool)> {
        let exercise = exercise?;
        let reuse_values = exercise
            .descriptions
            .reuse
            .as_ref()
            .and_then(|r| r.exercise.as_ref())
            .map(|e| e.descriptions.values.as_slice())
            .unwrap_or(&[]);
        if exercise.descriptions.reuse.is_none() || exercise.descriptions.values.as_slice() != reuse_values {
            let mut lines: Vec<String> = Vec::new();
            let current_index = self.get_current_description_index(&exercise.key, week_index, day_in_week_index);
            for (i, description) in exercise.descriptions.values.iter().enumerate() {
                if i > 0 {
                    lines.push(String::new());
                }
                for part in description.value.split('\n') {
                    if current_index != 0 && current_index == i && !added_current_description {
                        lines.push(format!("// ! {}", part));
                        added_current_description = true;
                    } else {
                        lines.push(format!("// {}", part));
                    }
                }
            }
            Some((lines, added_current_description))
        } else if let Some(reused) = exercise.descriptions.reuse.as_ref().and_then(|r| r.exercise.as_deref()) {
            let reused_day_data = &reused.day_data;
            let count = self.program.weeks.get(week_index).map(|w| {
                w.days.iter().filter(|day| day.exercises.iter().any(|e| e.key == reused.key)).count()
            });
            if count == Some(1) && reused_day_data.week == week_index as i64 + 1 {
                Some((vec![format!("// ...{}", reused.full_name)], added_current_description))
            } else {
                Some((
                    vec![format!(
                        "// ...{}[{}:{}]",
                        reused.full_name, reused_day_data.week, reused_day_data.day_in_week
                    )],
                    added_current_description,
                ))
            }
        } else {
            None
        }
    }

    fn get_property_targets(&self, grouped: &GroupedTopLines, opts: &ConvertOpts) -> Targets<'a> {
        let mut candidates: IndexMap<(Shareable, String), Vec<Candidate<'a>>> = IndexMap::new();
        pp::iterate_top_line_exercises(grouped, |line, week_index, day_in_week_index, day_index| {
            let value = Self::get_renamed_value(opts, line, week_index, day_in_week_index);
            let Some(exercise) = self.program_exercise(day_index + 1, &value) else {
                return false;
            };
            let location = format!("{}_{}", week_index, day_in_week_index);
            let dereuse =
                if Self::should_reuse_sets(exercise) { self.get_dereuse_decisions(exercise) } else { vec![] };
            let is_repeat = exercise.is_repeat == Some(true);
            let mut push = |prop: Shareable, is_origin: bool| {
                candidates.entry((prop, exercise.key.clone())).or_default().push(Candidate {
                    location: location.clone(),
                    exercise,
                    is_origin,
                });
            };
            if let Some(progress) = &exercise.progress {
                if progress.kind != IProgramExerciseProgressType::None
                    && (progress.reuse.is_some() || progress_script_truthy(progress.script.as_deref()))
                    && (exercise.reuse.is_none() || dereuse.contains(&Dereuse::Progress))
                {
                    push(Shareable::Progress, exercise.points.progress_point.is_some() && !is_repeat);
                }
            }
            if let Some(update) = &exercise.update {
                if (update.reuse.is_some() || progress_script_truthy(update.script.as_deref()))
                    && (exercise.reuse.is_none() || dereuse.contains(&Dereuse::Update))
                {
                    push(Shareable::Update, exercise.points.update_point.is_some() && !is_repeat);
                }
            }
            if exercise.warmup_sets.is_some() {
                push(Shareable::Warmup, exercise.points.warmup_point.is_some() && !is_repeat);
            }
            if !exercise.tags.is_empty() {
                push(Shareable::Id, exercise.points.id_point.is_some() && !is_repeat);
            }
            false
        });
        let mut targets: Targets<'a> = IndexMap::new();
        for (k, list) in candidates {
            let origin = list.iter().find(|c| c.is_origin).or_else(|| list.first());
            if let Some(origin) = origin {
                targets.insert(k, Target { location: origin.location.clone(), exercise: list[0].exercise });
            }
        }
        targets
    }

    fn get_property_source(
        targets: &Targets<'a>,
        property: Shareable,
        key: &str,
        week_index: usize,
        day_in_week_index: usize,
        fallback: &'a IPlannerProgramExercise,
    ) -> Option<&'a IPlannerProgramExercise> {
        match targets.get(&(property, key.to_string())) {
            None => Some(fallback),
            Some(t) => {
                if t.location == format!("{}_{}", week_index, day_in_week_index) {
                    Some(t.exercise)
                } else {
                    None
                }
            }
        }
    }

    /// `Program_getProgramExercise(day, program, key)`.
    fn program_exercise(&self, day: usize, key: &str) -> Option<&'a IPlannerProgramExercise> {
        let mut a_day = 0;
        for week in &self.program.weeks {
            for d in &week.days {
                a_day += 1;
                if day == a_day {
                    return d.exercises.iter().find(|e| e.key == key);
                }
            }
        }
        None
    }

    /// `convertToPlanner`. `Err` carries `program.errors[0].error`.
    pub fn convert_to_planner(&self, opts: &ConvertOpts, uid: &mut dyn UidSource) -> Result<IPlannerProgram, PlannerSyntaxError> {
        if let Some(error) = self.program.errors.first() {
            return Err(error.error.clone());
        }
        let mut planner_weeks: Vec<IPlannerProgramWeek> = Vec::new();
        let planner_program = &self.program.planner;
        let top_line_map = pp_text::top_line_items(planner_program, self.settings)?;
        let mut grouped = pp_text::grouped_top_lines(top_line_map);
        if let Some(reorder) = &opts.reorder {
            Self::reorder_grouped_top_line(&mut grouped, reorder);
        }
        if let Some(add) = &opts.add {
            self.add_grouped_top_line(&mut grouped, add);
        }
        let targets = self.get_property_targets(&grouped, opts);
        let mut day_index: usize = 0;
        let mut added_progress: IndexSet<String> = IndexSet::new();
        let mut added_update: IndexSet<String> = IndexSet::new();
        let mut added_warmups: IndexSet<String> = IndexSet::new();
        let mut added_id: IndexSet<String> = IndexSet::new();
        let empty_day: Vec<Vec<IPlannerTopLineItem>> = Vec::new();

        for (week_index, week) in self.program.weeks.iter().enumerate() {
            let mut planner_week = IPlannerProgramWeek {
                name: week.name.clone(),
                description: week.description.clone(),
                days: Vec::new(),
                id: None,
            };
            for (day_in_week_index, program_day) in week.days.iter().enumerate() {
                let mut planner_day = IPlannerProgramDay {
                    name: program_day.name.clone(),
                    description: None,
                    exercise_text: String::new(),
                    id: None,
                };
                let mut description_index: Option<usize> = None;
                let mut added_current_description = false;
                let mut finished_to_add_description = false;
                let grouped_top_lines =
                    grouped.get(week_index).and_then(|w| w.get(day_in_week_index)).unwrap_or(&empty_day);
                let mut group_text: Vec<String> = Vec::new();
                'group_loop: for group in grouped_top_lines {
                    let mut exercise_text: Vec<String> = Vec::new();
                    for (line_index, line) in group.iter().enumerate() {
                        match line.kind {
                            IPlannerTopLineType::Comment => exercise_text.push(line.value.clone()),
                            IPlannerTopLineType::Description => {
                                let key = group[line_index..]
                                    .iter()
                                    .find(|l| l.kind == IPlannerTopLineType::Exercise)
                                    .map(|l| Self::get_renamed_value(opts, l, week_index, day_in_week_index));
                                if description_index.is_none() {
                                    description_index = Some(0);
                                }
                                if finished_to_add_description {
                                    continue;
                                }
                                if let Some(key) = key {
                                    let exercise =
                                        self.get_current_description_exercise(&key, week_index, day_in_week_index);
                                    let result = self.add_exercise_descriptions(
                                        exercise,
                                        week_index,
                                        day_in_week_index,
                                        added_current_description,
                                    );
                                    if let Some((lines, added)) = result {
                                        exercise_text.extend(lines);
                                        added_current_description = added;
                                        finished_to_add_description = true;
                                    } else {
                                        let current_index =
                                            self.get_current_description_index(&key, week_index, day_in_week_index);
                                        if current_index != 0
                                            && Some(current_index) == description_index
                                            && !added_current_description
                                        {
                                            exercise_text.push(mark_current_description(&line.value));
                                            added_current_description = true;
                                        } else {
                                            exercise_text.push(unmark_description(&line.value));
                                        }
                                    }
                                } else {
                                    exercise_text.push(unmark_description(&line.value));
                                }
                            }
                            IPlannerTopLineType::Empty => {
                                if !finished_to_add_description {
                                    exercise_text.push(String::new());
                                    if let Some(i) = description_index.as_mut() {
                                        *i += 1;
                                    }
                                }
                            }
                            IPlannerTopLineType::Exercise => {
                                description_index = None;
                                let value = Self::get_renamed_value(opts, line, week_index, day_in_week_index);
                                let Some(eval_exercise) = self.program_exercise(day_index + 1, &value) else {
                                    continue 'group_loop;
                                };
                                let key = eval_exercise.key.as_str();

                                if !finished_to_add_description
                                    && (eval_exercise.descriptions.reuse.is_some()
                                        || !eval_exercise.descriptions.values.is_empty())
                                {
                                    if let Some((lines, _)) = self.add_exercise_descriptions(
                                        Some(eval_exercise),
                                        week_index,
                                        day_in_week_index,
                                        added_current_description,
                                    ) {
                                        exercise_text.extend(lines);
                                    }
                                }
                                finished_to_add_description = false;
                                added_current_description = false;

                                let mut s = String::new();
                                s.push_str(&self.get_exercise_name(eval_exercise));
                                s.push_str(" / ");
                                if eval_exercise.notused == Some(true) {
                                    s.push_str("used: none / ");
                                }
                                let variations = &eval_exercise.evaluated_set_variations;
                                let globals = self.get_globals(eval_exercise);
                                let should_reuse = Self::should_reuse_sets(eval_exercise);
                                let dereuse =
                                    if should_reuse { self.get_dereuse_decisions(eval_exercise) } else { vec![] };
                                if should_reuse {
                                    s.push_str(&self.reuse_to_str(eval_exercise));
                                    if dereuse.contains(&Dereuse::Sets) {
                                        s.push_str(" / ");
                                        s.push_str(
                                            &variations
                                                .iter()
                                                .enumerate()
                                                .map(|(i, v)| self.variation_to_string(v, &globals, i, eval_exercise))
                                                .collect::<Vec<_>>()
                                                .join(" / "),
                                        );
                                    }
                                    let mut overridden: Vec<String> = Vec::new();
                                    let plus = if globals.ask_weight == Some(true) { "+" } else { "" };
                                    if dereuse.contains(&Dereuse::Weight) && globals.weight.is_some() {
                                        overridden.push(format!("{}{}", weight_expr_to_str(globals.weight), plus));
                                    } else if dereuse.contains(&Dereuse::Weight) && globals.ask_weight == Some(true) {
                                        overridden.push("?+".to_string());
                                    }
                                    if dereuse.contains(&Dereuse::Rpe) {
                                        if let Some(rpe) = globals.rpe {
                                            overridden.push(format!(
                                                "@{}{}",
                                                n2(rpe),
                                                if globals.log_rpe == Some(true) { "+" } else { "" }
                                            ));
                                        }
                                    }
                                    if globals.set_timer.is_some()
                                        && (dereuse.contains(&Dereuse::SetTimer)
                                            || dereuse.contains(&Dereuse::Timer)
                                            || dereuse.contains(&Dereuse::Sets))
                                    {
                                        overridden.push(Self::set_timer_global_to_str(&globals));
                                    } else if dereuse.contains(&Dereuse::Timer) {
                                        if let Some(t) = globals.timer {
                                            overridden.push(format!("{}s", n2(t)));
                                        }
                                    }
                                    if !overridden.is_empty() {
                                        s.push_str(&format!(" / {}", overridden.join(" ")));
                                    }
                                } else {
                                    if !eval_exercise.set_variations.is_empty() {
                                        s.push_str(
                                            &variations
                                                .iter()
                                                .enumerate()
                                                .map(|(i, v)| self.variation_to_string(v, &globals, i, eval_exercise))
                                                .collect::<Vec<_>>()
                                                .join(" / "),
                                        );
                                    }
                                    let mut globals_str: Vec<String> = Vec::new();
                                    let plus = if globals.ask_weight == Some(true) { "+" } else { "" };
                                    if globals.weight.is_some() {
                                        globals_str.push(format!("{}{}", weight_expr_to_str(globals.weight), plus));
                                    } else if globals.ask_weight == Some(true) {
                                        globals_str.push("?+".to_string());
                                    }
                                    if let Some(rpe) = globals.rpe {
                                        globals_str.push(format!(
                                            "@{}{}",
                                            js_number_to_string(rpe),
                                            if globals.log_rpe == Some(true) { "+" } else { "" }
                                        ));
                                    }
                                    if globals.set_timer.is_some() {
                                        globals_str.push(Self::set_timer_global_to_str(&globals));
                                    } else if let Some(t) = globals.timer {
                                        globals_str.push(format!("{}s", js_number_to_string(t)));
                                    }
                                    if !globals_str.is_empty() {
                                        s.push_str(&format!(" / {}", globals_str.join(" ")));
                                    }
                                }

                                let warmup_source = if !added_warmups.contains(key) && eval_exercise.warmup_sets.is_some()
                                {
                                    Self::get_property_source(
                                        &targets,
                                        Shareable::Warmup,
                                        key,
                                        week_index,
                                        day_in_week_index,
                                        eval_exercise,
                                    )
                                } else {
                                    None
                                };
                                if let Some(src) = warmup_source {
                                    if let Some(w) = Self::warmup_sets_to_str(src.warmup_sets.as_deref()) {
                                        s.push_str(&format!(" / warmup: {}", w));
                                        added_warmups.insert(key.to_string());
                                    }
                                }

                                let id_source = if !added_id.contains(key) && !eval_exercise.tags.is_empty() {
                                    Self::get_property_source(
                                        &targets,
                                        Shareable::Id,
                                        key,
                                        week_index,
                                        day_in_week_index,
                                        eval_exercise,
                                    )
                                } else {
                                    None
                                };
                                if let Some(src) = id_source {
                                    s.push_str(&format!(" / {}", Self::id_to_str(src)));
                                    added_id.insert(key.to_string());
                                }

                                if let Some(superset) = eval_exercise.superset.as_ref().map(|s| s.name.as_str()) {
                                    if !superset.is_empty() {
                                        s.push_str(&format!(" / superset: {}", superset));
                                    }
                                }

                                if let Some(update) = &eval_exercise.update {
                                    if !added_update.contains(key)
                                        && (update.reuse.is_some() || progress_script_truthy(update.script.as_deref()))
                                    {
                                        if eval_exercise.reuse.is_none() || dereuse.contains(&Dereuse::Update) {
                                            let source = Self::get_property_source(
                                                &targets,
                                                Shareable::Update,
                                                key,
                                                week_index,
                                                day_in_week_index,
                                                eval_exercise,
                                            );
                                            if let Some(src) = source {
                                                let update_str = self.get_update(src, false, false);
                                                if !update_str.is_empty() {
                                                    s.push_str(&format!(" / {}", update_str));
                                                }
                                                added_update.insert(key.to_string());
                                            }
                                        } else if update.reuse.as_ref().map(|r| &r.full_name)
                                            == eval_exercise.reuse.as_ref().map(|r| &r.full_name)
                                        {
                                            added_update.insert(key.to_string());
                                        }
                                    }
                                }

                                if let Some(progress) = &eval_exercise.progress {
                                    if progress.kind == IProgramExerciseProgressType::None {
                                        s.push_str(" / progress: none");
                                    } else if !added_progress.contains(key)
                                        && (progress.reuse.is_some()
                                            || progress_script_truthy(progress.script.as_deref()))
                                    {
                                        if eval_exercise.reuse.is_none() || dereuse.contains(&Dereuse::Progress) {
                                            let source = Self::get_property_source(
                                                &targets,
                                                Shareable::Progress,
                                                key,
                                                week_index,
                                                day_in_week_index,
                                                eval_exercise,
                                            );
                                            if let Some(src) = source {
                                                let progress_str = self.get_progress(src, false, false);
                                                if !progress_str.is_empty() {
                                                    s.push_str(&format!(" / {}", progress_str));
                                                }
                                                added_progress.insert(key.to_string());
                                            }
                                        } else if progress.reuse.as_ref().map(|r| &r.full_name)
                                            == eval_exercise.reuse.as_ref().map(|r| &r.full_name)
                                        {
                                            added_progress.insert(key.to_string());
                                        }
                                    }
                                }
                                exercise_text.push(s);
                            }
                        }
                    }
                    if !exercise_text.is_empty() {
                        group_text.extend(exercise_text);
                    }
                }
                planner_day.exercise_text = group_text.join("\n");
                planner_day.description = program_day.description.clone();
                planner_week.days.push(planner_day);
                day_index += 1;
            }
            planner_weeks.push(planner_week);
        }
        let result = IPlannerProgram {
            vtype: PlannerVtype,
            name: self.program.name.clone(),
            weeks: planner_weeks,
        };
        let mut repeating: IndexSet<String> = IndexSet::new();
        pp::iterate2(&self.program.weeks, |exercise, _, _, _, _| {
            if !exercise.repeat.is_empty() {
                repeating.insert(planner_key_from_exercise(exercise, self.settings));
            }
            false
        });
        pp_text::compact(
            &self.program.planner,
            result,
            self.settings,
            Some(&repeating),
            opts.rename_mapping.as_ref(),
            uid,
        )
    }

    /// `materializeExercise`: the exercise as the evaluator sees it, printed
    /// back as Liftoscript.
    pub fn materialize_exercise(&self, exercise: &IPlannerProgramExercise) -> String {
        let mut parts: Vec<String> = vec![self.get_exercise_name(exercise)];
        if exercise.notused == Some(true) {
            parts.push("used: none".to_string());
        }
        let variations = &exercise.evaluated_set_variations;
        let globals = self.get_globals(exercise);
        for (i, v) in variations.iter().enumerate() {
            if !v.sets.is_empty() {
                parts.push(self.variation_to_string(v, &globals, i, exercise));
            }
        }
        let mut globals_str: Vec<String> = Vec::new();
        let plus = if globals.ask_weight == Some(true) { "+" } else { "" };
        if globals.weight.is_some() {
            globals_str.push(format!("{}{}", weight_expr_to_str(globals.weight), plus));
        } else if globals.ask_weight == Some(true) {
            globals_str.push("?+".to_string());
        }
        if let Some(rpe) = globals.rpe {
            globals_str.push(format!("@{}{}", n2(rpe), if globals.log_rpe == Some(true) { "+" } else { "" }));
        }
        if globals.set_timer.is_some() {
            globals_str.push(Self::set_timer_global_to_str(&globals));
        } else if let Some(t) = globals.timer {
            globals_str.push(format!("{}s", n2(t)));
        }
        if !globals_str.is_empty() {
            parts.push(globals_str.join(" "));
        }
        if let Some(w) = Self::warmup_sets_to_str(ppe::warmups(exercise).map(Vec::as_slice)) {
            parts.push(format!("warmup: {}", w));
        }
        if !exercise.tags.is_empty() {
            parts.push(Self::id_to_str(exercise));
        }
        if let Some(name) = exercise.superset.as_ref().map(|s| s.name.as_str()).filter(|n| !n.is_empty()) {
            parts.push(format!("superset: {}", name));
        }
        let update = self.get_update(exercise, false, true);
        if !update.is_empty() {
            parts.push(update);
        }
        let progress = self.get_progress(exercise, false, true);
        if !progress.is_empty() {
            parts.push(progress);
        }
        parts.join(" / ")
    }

    fn exercise_name_for(&self, t: &crate::types::IExerciseType, label: Option<&str>) -> String {
        let exercise = exercise_get(&ExerciseType::from(t), self.view.custom_exercises());
        exercise_full_name(&exercise, &self.view as &dyn ExerciseSettings, label)
    }

    fn get_exercise_name(&self, e: &IPlannerProgramExercise) -> String {
        let order_suffix = |name: String| if e.order > 0 { format!("{}[{}]", name, e.order) } else { name };
        let variations = &e.exercise_variations;
        if variations.len() > 1 {
            let active = variations.iter().position(|v| v.is_current).unwrap_or(0);
            let parts: Vec<String> = variations
                .iter()
                .enumerate()
                .map(|(i, variation)| {
                    let label = if i == 0 { e.label.as_deref() } else { None };
                    let segment = match &variation.exercise_type {
                        Some(t) => self.exercise_name_for(t, label),
                        None => exercise_build_name(&variation.name, &self.view as &dyn ExerciseSettings, label, None),
                    };
                    format!("{}{}", if i == active && i > 0 { "! " } else { "" }, segment)
                })
                .collect();
            order_suffix(parts.join(" | "))
        } else if let Some(t) = &e.exercise_type {
            order_suffix(self.exercise_name_for(t, e.label.as_deref()))
        } else {
            e.full_name.clone()
        }
    }

    fn reuse_to_str(&self, e: &IPlannerProgramExercise) -> String {
        // The TS throws when `reuse.exercise` is missing; getDereuseDecisions has
        // already treated that case as no reuse, so this is only reached with one.
        let Some(reuse) = &e.reuse else {
            return String::new();
        };
        let Some(reuse_exercise) = reuse.exercise.as_deref() else {
            return String::new();
        };
        let mut s = String::from("...");
        match &reuse_exercise.exercise_type {
            Some(t) => s.push_str(&self.exercise_name_for(t, reuse_exercise.label.as_deref())),
            None => s.push_str(&reuse_exercise.full_name),
        }
        // `CollectionUtils_compact([week, day])` drops falsy values, including 0.
        let wd: Vec<String> = [reuse.week, reuse.day]
            .iter()
            .filter_map(|x| x.filter(|v| *v != 0))
            .map(|v| v.to_string())
            .collect();
        if reuse.week.is_some_and(|v| v != 0) || reuse.day.is_some_and(|v| v != 0) {
            s.push_str(&format!("[{}]", wd.join(":")));
        }
        s
    }

    /// `ProgramToPlanner.getUpdate`.
    pub fn get_update(&self, e: &IPlannerProgramExercise, hide_script: bool, resolve_reuse: bool) -> String {
        Self::update_str(self.settings, &self.view, e, hide_script, resolve_reuse)
    }

    fn update_str(
        settings: &ISettings,
        view: &ExerciseSettingsView<'_>,
        e: &IPlannerProgramExercise,
        hide_script: bool,
        resolve_reuse: bool,
    ) -> String {
        let update = e.update.as_ref().or_else(|| {
            if resolve_reuse {
                ppe::overall_reuse_exercise(e).and_then(|r| r.update.as_ref())
            } else {
                None
            }
        });
        let Some(update) = update else {
            return String::new();
        };
        if resolve_reuse {
            if let Some(script) = ppe::get_update_script(e) {
                return format!("update: custom() {}", if hide_script { "{~ ... ~}" } else { script });
            }
        }
        if let Some(reuse) = &update.reuse {
            let name = match reuse.exercise.as_deref().and_then(|x| x.exercise_type.as_ref().map(|t| (x, t))) {
                Some((x, t)) => {
                    let ex = exercise_get(&ExerciseType::from(t), view.custom_exercises());
                    exercise_full_name(&ex, view as &dyn ExerciseSettings, x.label.as_deref())
                }
                None => reuse
                    .exercise
                    .as_deref()
                    .map(|x| x.full_name.clone())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| reuse.full_name.clone()),
            };
            let _ = settings;
            format!("update: custom() {{ ...{} }}", name)
        } else {
            format!(
                "update: custom() {}",
                if hide_script { "{~ ... ~}" } else { update.script.as_deref().unwrap_or("undefined") }
            )
        }
    }

    fn id_to_str(e: &IPlannerProgramExercise) -> String {
        format!(
            "id: tags({})",
            e.tags.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(", ")
        )
    }

    /// `ProgramToPlanner.getProgress`.
    pub fn get_progress(&self, e: &IPlannerProgramExercise, hide_script: bool, resolve_reuse: bool) -> String {
        let progress = e.progress.as_ref().or_else(|| {
            if resolve_reuse {
                ppe::overall_reuse_exercise(e).and_then(|r| r.progress.as_ref())
            } else {
                None
            }
        });
        let Some(progress) = progress else {
            return String::new();
        };
        let kind = match progress.kind {
            IProgramExerciseProgressType::Custom => "custom",
            IProgramExerciseProgressType::Lp => "lp",
            IProgramExerciseProgressType::Dp => "dp",
            IProgramExerciseProgressType::Sum => "sum",
            IProgramExerciseProgressType::None => "none",
        };
        let mut out = format!("progress: {}", kind);
        let state = ppe::get_state(e);
        let state_metadata = ppe::get_state_metadata(e);
        match progress.kind {
            IProgramExerciseProgressType::Custom => {
                let args_state = if resolve_reuse { state } else { ppe::get_only_changed_state(e) };
                let args: Vec<String> = args_state
                    .iter()
                    .map(|(k, v)| {
                        let plus = if state_metadata.get(k).and_then(|m| m.user_prompted) == Some(true) {
                            "+"
                        } else {
                            ""
                        };
                        format!("{}{}: {}", k, plus, weight::print(*v))
                    })
                    .collect();
                out.push_str(&format!("({})", args.join(", ")));
            }
            IProgramExerciseProgressType::Lp => {
                let increment = state.get("increment");
                let successes = state.get("successes");
                let success_counter = state.get("successCounter");
                let decrement = state.get("decrement");
                let failures = state.get("failures");
                let failure_counter = state.get("failureCounter");
                let mut args: Vec<String> = vec![print_state(increment)];
                let dec_positive = state_dot_value(decrement) > 0.0;
                if state_num(successes) > 1.0 || dec_positive {
                    args.push(state_to_js_string(successes));
                }
                if state_num(successes) > 1.0 || dec_positive {
                    args.push(state_to_js_string(success_counter));
                }
                if dec_positive {
                    args.push(print_state(decrement));
                }
                if state_num(failures) > 1.0 {
                    args.push(state_to_js_string(failures));
                }
                if state_num(failures) > 1.0 {
                    args.push(state_to_js_string(failure_counter));
                }
                out.push_str(&format!("({})", args.join(", ")));
            }
            IProgramExerciseProgressType::Dp => {
                let args = [
                    print_state(state.get("increment")),
                    state_to_js_string(state.get("minReps")),
                    state_to_js_string(state.get("maxReps")),
                ];
                out.push_str(&format!("({})", args.join(", ")));
            }
            IProgramExerciseProgressType::Sum => {
                let args = [state_to_js_string(state.get("reps")), print_state(state.get("increment"))];
                out.push_str(&format!("({})", args.join(", ")));
            }
            IProgramExerciseProgressType::None => {}
        }
        if progress.kind == IProgramExerciseProgressType::Custom {
            let resolved = if resolve_reuse { ppe::get_progress_script(e) } else { None };
            if let Some(script) = resolved {
                out.push_str(&format!(" {}", if hide_script { "{~ ... ~}" } else { script }));
            } else if let Some(reuse) = &progress.reuse {
                let name = match reuse.exercise.as_deref().and_then(|x| x.exercise_type.as_ref().map(|t| (x, t))) {
                    Some((x, t)) => self.exercise_name_for(t, x.label.as_deref()),
                    None => reuse
                        .exercise
                        .as_deref()
                        .map(|x| x.full_name.clone())
                        .filter(|n| !n.is_empty())
                        .unwrap_or_else(|| reuse.full_name.clone()),
                };
                out.push_str(&format!(" {{ ...{} }}", name));
            } else if hide_script {
                out.push_str(" {~ ... ~}");
            } else {
                out.push_str(&format!(" {}", progress.script.as_deref().unwrap_or("undefined")));
            }
        }
        out
    }

    fn get_globals(&self, exercise: &IPlannerProgramExercise) -> Globals {
        let variations = &exercise.evaluated_set_variations;
        if variations.is_empty() || variations[0].sets.is_empty() {
            let g = &exercise.globals;
            let rg = ppe::overall_reuse_exercise(exercise).map(|r| r.globals.clone()).unwrap_or_default();
            return Globals {
                weight: g.weight.or(rg.weight).map(WeightOrPct::Weight),
                rpe: g.rpe.or(rg.rpe),
                timer: g.timer.or(rg.timer),
                set_timer: g.set_timer.or(rg.set_timer),
                is_overflow_set_timer: g.is_overflow_set_timer.or(rg.is_overflow_set_timer),
                log_rpe: g.log_rpe.or(rg.log_rpe),
                ask_weight: g.ask_weight.or(rg.ask_weight),
            };
        }
        let first = &variations[0].sets[0];
        let first_weight = first.weight;
        let first_rpe = first.rpe;
        let first_log_rpe = first.log_rpe;
        let first_ask_weight = first.ask_weight;
        let first_timer = first.timer;
        let has_any_set_timer = variations.iter().any(|v| v.sets.iter().any(|s| s.set_timer.is_some()));
        let first_set_timer = first.set_timer;
        let first_is_overflow = first.is_overflow_set_timer.unwrap_or(false);
        let all = |f: &dyn Fn(&IPlannerProgramExerciseEvaluatedSet) -> bool| {
            variations.iter().all(|v| v.sets.iter().all(f))
        };
        let set_timer_is_global = first_set_timer.is_some()
            && (exercise.globals.set_timer.is_some() || exercise.reuse.is_some())
            && all(&|s| {
                s.set_timer == first_set_timer
                    && s.is_overflow_set_timer.unwrap_or(false) == first_is_overflow
                    && s.timer == first_timer
            });
        let eq_first_weight = |s: &IPlannerProgramExerciseEvaluatedSet| {
            weight::eq_null(s.weight.map(Into::into), first_weight.map(Into::into))
        };
        Globals {
            set_timer: if set_timer_is_global { first_set_timer } else { None },
            is_overflow_set_timer: if set_timer_is_global { Some(first_is_overflow) } else { None },
            weight: if first_weight.is_some() && all(&|s| eq_first_weight(s) && s.ask_weight == first_ask_weight) {
                first_weight
            } else {
                None
            },
            ask_weight: Some(all(&|s| eq_first_weight(s) && s.ask_weight)),
            rpe: if first_rpe.is_some() && all(&|s| s.rpe == first_rpe && s.log_rpe == first_log_rpe) {
                first_rpe
            } else {
                None
            },
            log_rpe: Some(all(&|s| s.rpe == first_rpe && s.log_rpe)),
            timer: if (set_timer_is_global || !has_any_set_timer)
                && first_timer.is_some()
                && all(&|s| s.timer == first_timer)
            {
                first_timer
            } else {
                None
            },
        }
    }

    fn group_variation_sets(
        sets: &[IPlannerProgramExerciseEvaluatedSet],
        exercise: &IPlannerProgramExercise,
        index: usize,
    ) -> Vec<(IPlannerProgramExerciseEvaluatedSet, usize)> {
        if sets.is_empty() {
            let original = ppe::sets(exercise, Some(index)).into_iter().next();
            let rep = original.as_ref().and_then(|o| o.rep_range.as_ref());
            return vec![(
                IPlannerProgramExerciseEvaluatedSet {
                    maxrep: Some(rep.and_then(|r| r.maxrep).filter(|v| crate::js::js_truthy_num(*v)).unwrap_or(1.0)),
                    minrep: rep.and_then(|r| r.minrep),
                    weight: Some(WeightOrPct::Weight(
                        original.as_ref().and_then(|o| o.weight).unwrap_or(weight::ZERO),
                    )),
                    log_rpe: original.as_ref().and_then(|o| o.log_rpe).unwrap_or(false),
                    is_amrap: rep.is_some_and(|r| r.is_amrap),
                    is_quick_add_set: rep.is_some_and(|r| r.is_quick_add_set),
                    ask_weight: original.as_ref().and_then(|o| o.ask_weight).unwrap_or(false),
                    rpe: original.as_ref().and_then(|o| o.rpe),
                    timer: original.as_ref().and_then(|o| o.timer),
                    label: original.as_ref().and_then(|o| o.label.clone()),
                    set_timer: None,
                    is_overflow_set_timer: None,
                    auto: None,
                },
                0,
            )];
        }
        let mut last_key: Option<String> = None;
        let mut groups: Vec<(IPlannerProgramExerciseEvaluatedSet, usize)> = Vec::new();
        for set in sets {
            let key = Self::set_to_key(set);
            if last_key.as_deref() != Some(key.as_str()) {
                groups.push((set.clone(), 0));
            }
            if let Some(g) = groups.last_mut() {
                g.1 += 1;
            }
            last_key = Some(key);
        }
        groups
    }

    fn group_warmup_sets(sets: &[IPlannerProgramExerciseWarmupSet]) -> Vec<(&IPlannerProgramExerciseWarmupSet, f64)> {
        let mut last_key: Option<String> = None;
        let mut groups: Vec<(&IPlannerProgramExerciseWarmupSet, f64)> = Vec::new();
        for set in sets {
            let key = Self::warmup_set_to_key(set);
            if last_key.as_deref() != Some(key.as_str()) {
                groups.push((set, 0.0));
            }
            if let Some(g) = groups.last_mut() {
                g.1 += set.number_of_sets;
            }
            last_key = Some(key);
        }
        groups
    }

    fn warmup_sets_to_str(warmup_sets: Option<&[IPlannerProgramExerciseWarmupSet]>) -> Option<String> {
        let warmup_sets = warmup_sets?;
        let strs: Vec<String> = Self::group_warmup_sets(warmup_sets)
            .into_iter()
            .map(|(first, length)| {
                let w: ScriptValue = match (first.weight, first.percentage) {
                    (Some(w), _) => ScriptValue::Weight(w),
                    (None, Some(p)) => ScriptValue::Percentage(weight::build_pct(p)),
                    (None, None) => ScriptValue::Weight(weight::build(0.0, IUnit::Lb)),
                };
                format!(
                    "{}x{} {}",
                    js_number_to_string(length),
                    js_number_to_string(first.reps),
                    weight::print(w)
                )
            })
            .collect();
        Some(if strs.is_empty() { "none".to_string() } else { strs.join(", ") })
    }

    fn set_timer_global_to_str(globals: &Globals) -> String {
        let overflow = if globals.is_overflow_set_timer == Some(true) { "+" } else { "" };
        let rest = match globals.timer {
            Some(t) => format!("{}s", n2(max0(t))),
            None => "?".to_string(),
        };
        format!("{}s{}|{}", n2(max0(globals.set_timer.unwrap_or(0.0))), overflow, rest)
    }

    fn variation_to_string(
        &self,
        variation: &IPlannerProgramExerciseEvaluatedSetVariation,
        globals: &Globals,
        index: usize,
        exercise: &IPlannerProgramExercise,
    ) -> String {
        let grouped = Self::group_variation_sets(&variation.sets, exercise, index);
        let mut result: Vec<String> = Vec::new();
        for (set, count) in &grouped {
            let mut s = String::new();
            s.push_str(&format!("{}{}x", count, if set.is_quick_add_set { "+" } else { "" }));
            if let Some(min) = set.minrep {
                s.push_str(&format!("{}-", n2(max0(min))));
            }
            s.push_str(&n2(max0(set.maxrep.unwrap_or(0.0))));
            if set.is_amrap {
                s.push('+');
            }
            if globals.weight.is_none() && globals.ask_weight != Some(true) {
                let weight_value = weight_expr_to_str(set.weight);
                if !weight_value.is_empty() {
                    s.push_str(&format!(" {}{}", weight_value, if set.ask_weight { "+" } else { "" }));
                } else if set.ask_weight {
                    s.push_str(" ?+");
                }
            }
            if globals.rpe.is_none() {
                if let Some(rpe) = set.rpe {
                    s.push_str(&format!(" @{}", n2(max0(rpe))));
                    if set.log_rpe {
                        s.push('+');
                    }
                }
            }
            if set.set_timer.is_some() && globals.set_timer.is_none() {
                let overflow = if set.is_overflow_set_timer == Some(true) { "+" } else { "" };
                let rest = match set.timer {
                    Some(t) => format!("{}s", n2(max0(t))),
                    None => "?".to_string(),
                };
                s.push_str(&format!(" {}s{}|{}", n2(max0(set.set_timer.unwrap_or(0.0))), overflow, rest));
            } else if set.set_timer.is_none() && globals.timer.is_none() && set.timer.is_some_and(crate::js::js_truthy_num) {
                s.push_str(&format!(" {}s", n2(max0(set.timer.unwrap_or(0.0)))));
            }
            if set.auto == Some(true) {
                s.push_str(" auto");
            }
            if let Some(label) = set.label.as_deref().filter(|l| !l.is_empty()) {
                s.push_str(&format!(" ({})", label));
            }
            result.push(s);
        }
        let prefix = if index > 0 && variation.is_current { "! " } else { "" };
        format!(
            "{}{}",
            prefix,
            result.iter().map(|r| js_trim(r)).collect::<Vec<_>>().join(", ")
        )
    }

    fn warmup_set_to_key(set: &IPlannerProgramExerciseWarmupSet) -> String {
        let w: ScriptValue = match (set.weight, set.percentage) {
            (Some(w), _) => ScriptValue::Weight(w),
            (None, Some(p)) if p != 0.0 && !p.is_nan() => ScriptValue::Percentage(weight::build_pct(p)),
            _ => ScriptValue::Number(0.0),
        };
        format!("{}-{}", js_number_to_string(set.reps), weight::print(w))
    }

    fn set_to_key(set: &IPlannerProgramExerciseEvaluatedSet) -> String {
        format!(
            "{}-{}-{}-{}-{}-{}-{}-{}-{}-{}-{}-{}",
            js_str_opt_f64(set.maxrep),
            js_str_opt_f64(set.minrep),
            weight::print_null(set.weight.map(Into::into)),
            set.is_amrap,
            js_str_opt_f64(set.rpe),
            set.log_rpe,
            js_str_opt_f64(set.timer),
            set.label.as_deref().unwrap_or("undefined"),
            set.ask_weight,
            js_str_opt_f64(set.set_timer),
            js_str_opt_bool(set.is_overflow_set_timer),
            js_str_opt_bool(set.auto),
        )
    }
}

/// JS truthiness of an optional script string: defined and non-empty.
fn progress_script_truthy(script: Option<&str>) -> bool {
    script.is_some_and(|s| !s.is_empty())
}

#[cfg(test)]
mod tests;
