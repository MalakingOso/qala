//! Port of `models/weight.ts`. Function names are the TS names without the
//! `Weight_` prefix in snake_case (`Weight_build` is `weight::build`).
//!
//! TS builds weights through a cache keyed by `value_unit`; the cache is only
//! an allocation optimization and is dropped here (weights are `Copy`). Be
//! aware that this also removes reference identity, which TS code relying on
//! `===` between weight objects could observe (see `util::object::changed_keys_with`).
//!
//! Number-or-weight arguments take `impl Into<ScriptValue>` (or
//! `Into<WeightOrNumber>`), so `weight::gt(w, 5.0)` and `weight::eq(a, b)` both work.

use crate::equipment::{
    get_equipment_data_for_exercise_type, get_unit_or_default_for_exercise_type, smallest_plate,
};
use crate::exercise::{exercise_get, CustomExercises, ExerciseType};
use crate::js::{js_max, js_min, js_number_to_string, js_parse_float, js_round, js_to_fixed, js_trim_end};
use crate::types::exercise_view::custom_exercise_to_view;
use crate::types::{
    IExerciseType, IPercentage, IPercentageUnit, IPlate, ISettings, IUnit, IWeight, ScriptValue,
    WeightOrNumber, WeightOrPct,
};
use crate::util::collection::{compress_array, sort};
use crate::util::math::{self, IAssignmentOp};

/// `Weight_zero`
pub const ZERO: IWeight = IWeight { value: 0.0, unit: IUnit::Lb };

/// `IUnit | "%"`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitOrPct {
    Unit(IUnit),
    Percent,
}

impl From<IUnit> for UnitOrPct {
    fn from(u: IUnit) -> Self {
        UnitOrPct::Unit(u)
    }
}

/// Result of `Weight_type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WeightKind {
    Weight,
    Percentage,
    Number,
}

/// An operation TS would throw on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeightError(pub String);

impl std::fmt::Display for WeightError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for WeightError {}

/// Result of `Weight_calculatePlates`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatesResult {
    pub plates: Vec<IPlate>,
    pub plates_weight: IWeight,
    pub total_weight: IWeight,
}

// ---------------------------------------------------------------------------
// building and checking

/// `Weight_build`
pub fn build(value: f64, unit: IUnit) -> IWeight {
    IWeight { value, unit }
}

/// `Weight_buildPct`
pub fn build_pct(value: f64) -> IPercentage {
    IPercentage::new(value)
}

/// `Weight_buildAny`
pub fn build_any(value: f64, unit: UnitOrPct) -> WeightOrPct {
    match unit {
        UnitOrPct::Percent => WeightOrPct::Percentage(build_pct(value)),
        UnitOrPct::Unit(u) => WeightOrPct::Weight(build(value, u)),
    }
}

/// `Weight_clone`
pub fn clone(value: IWeight) -> IWeight {
    build(value.value, value.unit)
}

/// `Weight_isOrPct`
pub fn is_or_pct(v: &ScriptValue) -> bool {
    !v.is_number()
}

/// `Weight_is`
pub fn is(v: &ScriptValue) -> bool {
    v.is_weight()
}

/// `Weight_isPct`
pub fn is_pct(v: &ScriptValue) -> bool {
    v.is_percentage()
}

/// `Weight_type`
pub fn type_of(value: impl Into<ScriptValue>) -> WeightKind {
    match value.into() {
        ScriptValue::Number(_) => WeightKind::Number,
        ScriptValue::Percentage(_) => WeightKind::Percentage,
        ScriptValue::Weight(_) => WeightKind::Weight,
    }
}

/// `Weight_oppositeUnit`
pub fn opposite_unit(unit: IUnit) -> IUnit {
    match unit {
        IUnit::Kg => IUnit::Lb,
        IUnit::Lb => IUnit::Kg,
    }
}

// ---------------------------------------------------------------------------
// display and parsing

/// `Weight_display`
pub fn display(weight: impl Into<ScriptValue>, with_unit: bool) -> String {
    match weight.into() {
        ScriptValue::Number(n) => js_number_to_string(n),
        ScriptValue::Percentage(p) => {
            format!("{}{}", js_number_to_string(p.value), if with_unit { "%" } else { "" })
        }
        ScriptValue::Weight(w) => {
            let v = js_number_to_string(js_parse_float(&js_to_fixed(w.value, 2)));
            if with_unit {
                format!("{} {}", v, w.unit.as_str())
            } else {
                v
            }
        }
    }
}

/// `Weight_print`
pub fn print(weight: impl Into<ScriptValue>) -> String {
    match weight.into() {
        ScriptValue::Number(n) => math::n2(n),
        ScriptValue::Weight(w) => format!("{}{}", math::n2(w.value), w.unit.as_str()),
        ScriptValue::Percentage(p) => format!("{}%", math::n2(p.value)),
    }
}

/// `Weight_printNull`: empty string for `None`.
pub fn print_null(weight: Option<ScriptValue>) -> String {
    match weight {
        None => String::new(),
        Some(w) => print(w),
    }
}

/// `Weight_printOrNumber`: numbers print raw, weights with `print`.
pub fn print_or_number(weight: impl Into<ScriptValue>) -> String {
    match weight.into() {
        ScriptValue::Number(n) => js_number_to_string(n),
        other => print(other),
    }
}

/// Splits `s` into (number text, unit text) for `^([\-+]?[0-9.]+)\s*(unit)$`.
fn split_num_suffix<'a>(s: &'a str, suffixes: &[&'a str], allow_space: bool) -> Option<(&'a str, &'a str)> {
    for suffix in suffixes {
        if let Some(body) = s.strip_suffix(suffix) {
            let body = if allow_space { js_trim_end(body) } else { body };
            let digits = body.strip_prefix(['-', '+']).unwrap_or(body);
            if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit() || c == '.') {
                return Some((body, suffix));
            }
        }
    }
    None
}

fn to_unit(s: &str) -> IUnit {
    if s == "kg" {
        IUnit::Kg
    } else {
        IUnit::Lb
    }
}

/// `Weight_parse`: `"12.5 kg"`, `"+10lb"`. `None` when the shape does not match.
pub fn parse(s: &str) -> Option<IWeight> {
    let (num, unit) = split_num_suffix(s, &["kg", "lb"], true)?;
    Some(build(math::round_float(js_parse_float(num), 2), to_unit(unit)))
}

/// `Weight_parsePct`: a percentage like `"85%"`, else falls back to `parse`.
pub fn parse_pct(s: Option<&str>) -> Option<WeightOrPct> {
    let s = s?;
    if let Some((num, _)) = split_num_suffix(s, &["%"], false) {
        return Some(WeightOrPct::Percentage(build_pct(math::round_float(js_parse_float(num), 2))));
    }
    parse(s).map(WeightOrPct::Weight)
}

fn is_strict_number(s: &str) -> bool {
    let body = s.strip_prefix(['-', '+']).unwrap_or(s);
    let (int, frac) = match body.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (body, None),
    };
    let all_digits = |x: &str| x.chars().all(|c| c.is_ascii_digit());
    match frac {
        None => !int.is_empty() && all_digits(int),
        Some(f) => !f.is_empty() && all_digits(f) && all_digits(int),
    }
}

/// `Weight_strictParse`: like `parse`, but the number must be a well-formed decimal.
pub fn strict_parse(s: &str) -> Option<IWeight> {
    let unit = ["kg", "lb"].iter().find(|u| s.ends_with(**u))?;
    let num = js_trim_end(&s[..s.len() - 2]);
    if !is_strict_number(num) {
        return None;
    }
    let value = js_parse_float(num);
    if !value.is_finite() {
        return None;
    }
    Some(build(math::round_float(value, 2), to_unit(unit)))
}

// ---------------------------------------------------------------------------
// conversion and arithmetic

/// `Weight_convertTo` for weights: kg and lb use factor 2.205 and round to 0.5.
pub fn convert_to(weight: IWeight, unit: IUnit) -> IWeight {
    if weight.unit == unit {
        weight
    } else if weight.unit == IUnit::Kg && unit == IUnit::Lb {
        build(js_round((weight.value * 2.205) / 0.5) * 0.5, unit)
    } else {
        build(js_round(weight.value / 2.205 / 0.5) * 0.5, unit)
    }
}

/// `Weight_convertTo` for any value: numbers and percentages pass through.
pub fn convert_value_to(weight: impl Into<ScriptValue>, unit: UnitOrPct) -> ScriptValue {
    match (weight.into(), unit) {
        (ScriptValue::Weight(w), UnitOrPct::Unit(u)) => ScriptValue::Weight(convert_to(w, u)),
        (other, _) => other,
    }
}

/// `Weight_operation` for two arguments, at least one a weight. The result
/// is in the first weight's unit.
pub fn operation(
    weight: impl Into<WeightOrNumber>,
    value: impl Into<WeightOrNumber>,
    o: impl Fn(f64, f64) -> f64,
) -> Result<IWeight, WeightError> {
    match (weight.into(), value.into()) {
        (WeightOrNumber::Number(a), WeightOrNumber::Weight(b)) => Ok(build(o(a, b.value), b.unit)),
        (WeightOrNumber::Weight(a), WeightOrNumber::Number(b)) => Ok(build(o(a.value, b), a.unit)),
        (WeightOrNumber::Weight(a), WeightOrNumber::Weight(b)) => {
            Ok(build(o(a.value, convert_to(b, a.unit).value), a.unit))
        }
        (WeightOrNumber::Number(_), WeightOrNumber::Number(_)) => {
            Err(WeightError("Weight.operation should never work with numbers only".to_string()))
        }
    }
}

fn operation_wn(weight: IWeight, value: WeightOrNumber, o: impl Fn(f64, f64) -> f64) -> IWeight {
    match value {
        WeightOrNumber::Number(b) => build(o(weight.value, b), weight.unit),
        WeightOrNumber::Weight(b) => build(o(weight.value, convert_to(b, weight.unit).value), weight.unit),
    }
}

/// `Weight_add`
pub fn add(weight: IWeight, value: impl Into<WeightOrNumber>) -> IWeight {
    operation_wn(weight, value.into(), |a, b| a + b)
}

/// `Weight_subtract`
pub fn subtract(weight: IWeight, value: impl Into<WeightOrNumber>) -> IWeight {
    operation_wn(weight, value.into(), |a, b| a - b)
}

/// `Weight_multiply`
pub fn multiply(weight: IWeight, value: impl Into<WeightOrNumber>) -> IWeight {
    operation_wn(weight, value.into(), |a, b| a * b)
}

/// `Weight_divide`
pub fn divide(weight: IWeight, value: impl Into<WeightOrNumber>) -> IWeight {
    operation_wn(weight, value.into(), |a, b| a / b)
}

/// `Weight_abs`
pub fn abs(weight: IWeight) -> IWeight {
    build(weight.value.abs(), weight.unit)
}

/// `Weight_invert`
pub fn invert(weight: IWeight) -> IWeight {
    build(-weight.value, weight.unit)
}

/// `Weight_roundTo005`
pub fn round_to_005(weight: IWeight) -> IWeight {
    build(math::round_to_005(weight.value), weight.unit)
}

/// `Weight_roundTo000005`
pub fn round_to_000005(weight: IWeight) -> IWeight {
    build(math::round_to_000005(weight.value), weight.unit)
}

/// `Weight_compare`: positive when `a` is heavier. Usable as a sort comparator.
pub fn compare(a: IWeight, b: IWeight) -> f64 {
    a.value - convert_to(b, a.unit).value
}

/// `Weight_compareReverse`
pub fn compare_reverse(a: IWeight, b: IWeight) -> f64 {
    convert_to(b, a.unit).value - a.value
}

fn comparison(a: ScriptValue, b: ScriptValue, o: impl Fn(f64, f64) -> bool) -> bool {
    match (a, b) {
        (ScriptValue::Number(x), ScriptValue::Number(y)) => o(x, y),
        (ScriptValue::Number(x), other) => o(x, other.value()),
        (other, ScriptValue::Number(y)) => o(other.value(), y),
        (ScriptValue::Percentage(x), ScriptValue::Percentage(y)) => o(x.value, y.value),
        (ScriptValue::Weight(x), ScriptValue::Weight(y)) => o(x.value, convert_to(y, x.unit).value),
        _ => false,
    }
}

/// `Weight_gt`. Weights compare in the left unit; a weight against a
/// percentage is always false; a number compares against the raw `value`.
pub fn gt(weight: impl Into<ScriptValue>, value: impl Into<ScriptValue>) -> bool {
    comparison(weight.into(), value.into(), |a, b| a > b)
}

/// `Weight_lt`
pub fn lt(weight: impl Into<ScriptValue>, value: impl Into<ScriptValue>) -> bool {
    comparison(weight.into(), value.into(), |a, b| a < b)
}

/// `Weight_gte`
pub fn gte(weight: impl Into<ScriptValue>, value: impl Into<ScriptValue>) -> bool {
    comparison(weight.into(), value.into(), |a, b| a >= b)
}

/// `Weight_lte`
pub fn lte(weight: impl Into<ScriptValue>, value: impl Into<ScriptValue>) -> bool {
    comparison(weight.into(), value.into(), |a, b| a <= b)
}

/// `Weight_eq`
pub fn eq(weight: impl Into<ScriptValue>, value: impl Into<ScriptValue>) -> bool {
    comparison(weight.into(), value.into(), |a, b| a == b)
}

/// `Weight_eqNull`: both `None` is equal, one `None` is not.
pub fn eq_null(weight: Option<ScriptValue>, value: Option<ScriptValue>) -> bool {
    match (weight, value) {
        (None, None) => true,
        (Some(a), Some(b)) => eq(a, b),
        _ => false,
    }
}

/// `Weight_eqeq`: same value and same unit, no conversion.
pub fn eqeq(weight: IWeight, value: IWeight) -> bool {
    weight.value == value.value && weight.unit == value.unit
}

/// `Weight_max`: the heaviest weight, `None` for an empty slice.
pub fn max(weights: &[IWeight]) -> Option<IWeight> {
    sort(weights, |a, b| compare_reverse(*a, *b)).first().copied()
}

fn op_wn(a: IWeight, b: f64, o: &dyn Fn(f64, f64) -> f64) -> ScriptValue {
    ScriptValue::Weight(build(o(a.value, b), a.unit))
}

/// `Weight_op`: applies `o` to two script values, mixing numbers, weights
/// and percentages. A percentage against a weight is resolved through
/// `onerm` when given, else treated as a fraction (`value / 100`).
pub fn op(
    onerm: Option<IWeight>,
    a: impl Into<ScriptValue>,
    b: impl Into<ScriptValue>,
    o: impl Fn(f64, f64) -> f64,
) -> ScriptValue {
    let o: &dyn Fn(f64, f64) -> f64 = &o;
    let pct_to_value = |p: IPercentage| -> WeightOrNumber {
        match onerm {
            Some(rm) => WeightOrNumber::Weight(multiply(rm, p.value / 100.0)),
            None => WeightOrNumber::Number(math::round_float(p.value / 100.0, 4)),
        }
    };
    match (a.into(), b.into()) {
        (ScriptValue::Number(x), ScriptValue::Number(y)) => ScriptValue::Number(o(x, y)),
        (ScriptValue::Number(x), ScriptValue::Percentage(y)) => ScriptValue::Percentage(build_pct(o(x, y.value))),
        (ScriptValue::Number(x), ScriptValue::Weight(y)) => ScriptValue::Weight(build(o(x, y.value), y.unit)),
        (ScriptValue::Percentage(x), ScriptValue::Number(y)) => ScriptValue::Percentage(build_pct(o(x.value, y))),
        (ScriptValue::Percentage(x), ScriptValue::Percentage(y)) => {
            ScriptValue::Percentage(build_pct(o(x.value, y.value)))
        }
        (ScriptValue::Percentage(x), ScriptValue::Weight(y)) => match pct_to_value(x) {
            WeightOrNumber::Weight(xw) => ScriptValue::Weight(operation_wn(xw, WeightOrNumber::Weight(y), o)),
            WeightOrNumber::Number(xn) => ScriptValue::Weight(build(o(xn, y.value), y.unit)),
        },
        (ScriptValue::Weight(x), ScriptValue::Number(y)) => op_wn(x, y, o),
        (ScriptValue::Weight(x), ScriptValue::Percentage(y)) => {
            ScriptValue::Weight(operation_wn(x, pct_to_value(y), o))
        }
        (ScriptValue::Weight(x), ScriptValue::Weight(y)) => {
            ScriptValue::Weight(operation_wn(x, WeightOrNumber::Weight(y), o))
        }
    }
}

/// `Weight_applyOp`: `=`, `+=`, `-=`, `*=`, `/=` on script values. `*=` and
/// `/=` round the result to 0.05.
pub fn apply_op(
    onerm: Option<IWeight>,
    old_value: impl Into<ScriptValue>,
    value: impl Into<ScriptValue>,
    opr: IAssignmentOp,
) -> ScriptValue {
    match opr {
        IAssignmentOp::Assign => value.into(),
        IAssignmentOp::AddAssign => op(onerm, old_value, value, |a, b| a + b),
        IAssignmentOp::SubAssign => op(onerm, old_value, value, |a, b| a - b),
        IAssignmentOp::MulAssign => op(onerm, old_value, value, |a, b| math::round_to_005(a * b)),
        IAssignmentOp::DivAssign => op(onerm, old_value, value, |a, b| math::round_to_005(a / b)),
    }
}

/// `Weight_convertToWeight`: number is read as `unit`, percentage of `onerm`.
pub fn convert_to_weight(onerm: IWeight, value: impl Into<ScriptValue>, unit: IUnit) -> IWeight {
    match value.into() {
        ScriptValue::Number(n) => build(n, unit),
        ScriptValue::Percentage(p) => convert_to(multiply(onerm, math::round_float(p.value / 100.0, 4)), unit),
        ScriptValue::Weight(w) => w,
    }
}

// ---------------------------------------------------------------------------
// RPE and one rep max

/// `Weight_rpeMultiplier`: fraction of 1RM for `reps` at `rpe`.
pub fn rpe_multiplier(reps: f64, rpe: f64) -> f64 {
    if reps == 1.0 && rpe == 10.0 {
        return 1.0;
    }
    let reps = js_max(js_min(reps, 24.0), 1.0);
    let rpe = js_max(js_min(rpe, 10.0), 1.0);
    let x = 10.0 - rpe + (reps - 1.0);
    if x >= 16.0 {
        return 0.5;
    }
    // Formula from the openpowerlifting RPE calculator.
    let intersection = 2.92;
    if x <= intersection {
        let (a, b, c) = (0.347619, -4.60714, 99.9667);
        (a * x * x + b * x + c) / 100.0
    } else {
        let (m, b) = (-2.64249, 97.0955);
        (m * x + b) / 100.0
    }
}

/// `Weight_rpePct`
pub fn rpe_pct(reps: f64, rpe: f64) -> IPercentage {
    build_pct(math::round_to_005(rpe_multiplier(reps, rpe) * 100.0))
}

/// `Weight_calculateRepMax`
pub fn calculate_rep_max(known_reps: f64, known_rpe: f64, known_weight: f64, target_reps: f64, target_rpe: f64) -> f64 {
    let onerm = known_weight / rpe_multiplier(known_reps, known_rpe);
    js_round(onerm * rpe_multiplier(target_reps, target_rpe))
}

/// `Weight_getOneRepMax` (`rpe` defaults to 10)
pub fn get_one_rep_max(weight: IWeight, reps: f64, rpe: Option<f64>) -> IWeight {
    if reps == 0.0 {
        build(0.0, weight.unit)
    } else if reps == 1.0 {
        weight
    } else {
        round_to_005(divide(weight, rpe_multiplier(reps, rpe.unwrap_or(10.0))))
    }
}

/// `Weight_getNRepMax`
pub fn get_n_rep_max(one_rep_max: IWeight, reps: f64) -> IWeight {
    if reps == 0.0 {
        build(0.0, one_rep_max.unit)
    } else if reps == 1.0 {
        one_rep_max
    } else {
        round_to_005(multiply(one_rep_max, rpe_multiplier(reps, 10.0)))
    }
}

/// `Weight_getTrainingMax`: 90% of the estimated 1RM, rounded to 0.05.
pub fn get_training_max(weight: IWeight, reps: f64, settings: &ISettings) -> IWeight {
    round(multiply(get_one_rep_max(weight, reps, None), 0.9), settings, weight.unit, None)
}

/// `Weight_smartConvert`: converts between kg and lb with plate-friendly rounding.
pub fn smart_convert(weight: IWeight, to_unit: IUnit) -> IWeight {
    if weight.unit == to_unit {
        return weight;
    }
    let value = weight.value;
    if weight.unit == IUnit::Kg {
        if value < 15.0 {
            build(value * 2.0, to_unit)
        } else {
            build(math::round(value * 2.25, 5.0), to_unit)
        }
    } else if value < 15.0 {
        build(math::round(value / 2.0, 0.25), to_unit)
    } else {
        build(math::round(value / 2.25, 2.5), to_unit)
    }
}

// ---------------------------------------------------------------------------
// settings-dependent: evaluation, rounding, plates

fn default_rounding(exercise_type: &IExerciseType, settings: &ISettings) -> f64 {
    let units = get_unit_or_default_for_exercise_type(settings, Some(exercise_type));
    let configured = settings.exercise_data.get(&exercise_type.to_key()).and_then(|d| d.rounding);
    js_max(0.1, configured.unwrap_or(if units == IUnit::Kg { 2.5 } else { 5.0 }))
}

/// `Exercise_onerm` (the part `Weight_evaluateWeight` needs): the user's 1RM
/// in the settings units, else the exercise's starting weight.
pub fn onerm(exercise_type: &IExerciseType, settings: &ISettings) -> IWeight {
    if let Some(rm) = settings.exercise_data.get(&exercise_type.to_key()).and_then(|d| d.rm1) {
        return convert_to(rm, settings.units);
    }
    let mut custom = CustomExercises::new();
    if let Some(c) = settings.exercises.get(&exercise_type.id) {
        custom.insert(exercise_type.id.clone(), custom_exercise_to_view(c));
    }
    let e = exercise_get(&ExerciseType::from(exercise_type), &custom);
    match settings.units {
        IUnit::Kg => build(e.starting_weight_kg, IUnit::Kg),
        IUnit::Lb => build(e.starting_weight_lb, IUnit::Lb),
    }
}

/// `Weight_evaluateWeight`: a percentage becomes that share of the exercise's 1RM.
pub fn evaluate_weight(weight: impl Into<WeightOrPct>, exercise_type: &IExerciseType, settings: &ISettings) -> IWeight {
    match weight.into() {
        WeightOrPct::Weight(w) => w,
        WeightOrPct::Percentage(p) => multiply(onerm(exercise_type, settings), p.value / 100.0),
    }
}

/// `Weight_round`: without an exercise type rounds to 0.05, else to what the
/// equipment (plates or fixed weights) can load.
pub fn round(weight: IWeight, settings: &ISettings, unit: IUnit, exercise_type: Option<&IExerciseType>) -> IWeight {
    match exercise_type {
        None => round_to_005(weight),
        Some(t) => calculate_plates(weight, settings, unit, t).total_weight,
    }
}

/// `Weight_roundConvertTo`
pub fn round_convert_to(
    weight: IWeight,
    settings: &ISettings,
    unit: IUnit,
    exercise_type: Option<&IExerciseType>,
) -> IWeight {
    round(convert_to(weight, unit), settings, unit, exercise_type)
}

/// `Weight_increment`: the next loadable weight above `weight`.
pub fn increment(weight: IWeight, settings: &ISettings, exercise_type: Option<&IExerciseType>) -> IWeight {
    let equipment_data = get_equipment_data_for_exercise_type(settings, exercise_type);
    if let Some(ed) = equipment_data {
        let unit = ed.unit.unwrap_or(weight.unit);
        let round_weight = round(weight, settings, unit, exercise_type);
        if ed.is_fixed {
            let fixed: Vec<IWeight> = ed.fixed.iter().filter(|e| e.unit == unit).copied().collect();
            let items = sort(&fixed, |a, b| compare(*a, *b));
            let item = items.iter().find(|i| gt(**i, round_weight));
            item.or(items.last()).copied().unwrap_or(round_weight)
        } else {
            let smallest = multiply(smallest_plate(ed, unit), ed.multiplier);
            let mut new_weight = round_weight;
            let mut attempt = 0;
            loop {
                new_weight = add(new_weight, smallest);
                attempt += 1;
                if !(attempt < 20 && eq(round(new_weight, settings, unit, exercise_type), round_weight)) {
                    break;
                }
            }
            new_weight
        }
    } else {
        let round_weight = round(weight, settings, weight.unit, exercise_type);
        let rounding = exercise_type.map(|t| default_rounding(t, settings)).unwrap_or(1.0);
        build(round_weight.value + rounding, round_weight.unit)
    }
}

/// `Weight_decrement`: the next loadable weight below `weight`.
pub fn decrement(weight: IWeight, settings: &ISettings, exercise_type: Option<&IExerciseType>) -> IWeight {
    let equipment_data = get_equipment_data_for_exercise_type(settings, exercise_type);
    if let Some(ed) = equipment_data {
        let unit = ed.unit.unwrap_or(weight.unit);
        let round_weight = round(weight, settings, unit, exercise_type);
        if ed.is_fixed {
            let fixed: Vec<IWeight> = ed.fixed.iter().filter(|e| e.unit == unit).copied().collect();
            let items = sort(&fixed, |a, b| compare_reverse(*a, *b));
            let item = items.iter().find(|i| lt(**i, round_weight));
            item.or(items.last()).copied().unwrap_or(round_weight)
        } else {
            let smallest = multiply(smallest_plate(ed, unit), ed.multiplier);
            let subtracted = subtract(round_weight, smallest);
            let new_weight = round(subtracted, settings, unit, exercise_type);
            build(new_weight.value, new_weight.unit)
        }
    } else {
        let round_weight = round(weight, settings, weight.unit, exercise_type);
        let rounding = exercise_type.map(|t| default_rounding(t, settings)).unwrap_or(1.0);
        build(round_weight.value - rounding, round_weight.unit)
    }
}

/// `Weight_platesWeight`
pub fn plates_weight(plates: &[IPlate]) -> IWeight {
    let unit = plates.first().map(|p| p.weight.unit).unwrap_or(IUnit::Lb);
    plates
        .iter()
        .fold(build(0.0, unit), |memo, plate| add(memo, multiply(plate.weight, plate.num)))
}

/// `Weight_formatOneSide`: plates for one side as `"45/2x25/10"`. Returns an
/// empty string instead of looping forever when the multiplier is not positive.
pub fn format_one_side(settings: &ISettings, plates_arr: &[IPlate], exercise_type: &IExerciseType) -> String {
    let equipment = get_equipment_data_for_exercise_type(settings, Some(exercise_type));
    let mut plates = sort(plates_arr, |a, b| compare_reverse(a.weight, b.weight));
    let multiplier = equipment.map(|e| e.multiplier).unwrap_or(1.0);
    let mut arr: Vec<f64> = Vec::new();
    if multiplier > 0.0 {
        while let Some(plate) = plates.iter_mut().find(|p| p.num >= multiplier) {
            arr.push(plate.weight.value);
            plate.num -= multiplier;
        }
    }
    compress_array(&arr, 3).join("/")
}

/// `Weight_calculatePlates`: the plates (one side, times the multiplier) and
/// total weight that best approximate `all_weight` on the exercise's equipment.
pub fn calculate_plates(
    all_weight: IWeight,
    settings: &ISettings,
    units: IUnit,
    exercise_type: &IExerciseType,
) -> PlatesResult {
    let equipment_data = match get_equipment_data_for_exercise_type(settings, Some(exercise_type)) {
        None => {
            let rounding = default_rounding(exercise_type, settings);
            let w = build(math::round(all_weight.value, rounding), all_weight.unit);
            return PlatesResult { plates: vec![], plates_weight: w, total_weight: w };
        }
        Some(e) => e,
    };

    let original_unit = all_weight.unit;
    let weight_in_units = convert_to(all_weight, units);
    let abs_all_weight = abs(weight_in_units);
    let inverted = weight_in_units.value < 0.0;
    if equipment_data.is_fixed {
        let want_unit = equipment_data.unit.unwrap_or(units);
        let fixed: Vec<IWeight> = equipment_data.fixed.iter().filter(|w| w.unit == want_unit).copied().collect();
        let fixed = sort(&fixed, |a, b| b.value - a.value);
        let weight = fixed
            .iter()
            .find(|w| lte(**w, abs_all_weight))
            .or(fixed.last())
            .copied()
            .unwrap_or(abs_all_weight);
        let mut rounded = round_to_005(convert_to(weight, original_unit));
        if inverted {
            rounded = invert(rounded);
        }
        return PlatesResult { plates: vec![], plates_weight: rounded, total_weight: rounded };
    }
    let available: Vec<IPlate> = equipment_data.plates.iter().filter(|p| p.weight.unit == units).cloned().collect();
    let bar_weight = match settings.current_bodyweight {
        Some(bw) if equipment_data.use_bodyweight_for_bar == Some(true) => bw,
        _ => match units {
            IUnit::Lb => equipment_data.bar.lb,
            IUnit::Kg => equipment_data.bar.kg,
        },
    };
    let multiplier = if equipment_data.multiplier == 0.0 || equipment_data.multiplier.is_nan() {
        1.0
    } else {
        equipment_data.multiplier
    };
    let is_assisting = equipment_data.is_assisting.unwrap_or(false);
    let weight = round_to_000005(subtract(abs_all_weight, bar_weight));
    let available = sort(&available, |a, b| compare_reverse(a.weight, b.weight));
    let plates = calculate_plates_internal_fast(weight, &available, multiplier, is_assisting);
    let total = plates.iter().fold(build(0.0, units), |memo, plate| {
        let to_add = multiply(plate.weight, plate.num);
        if is_assisting {
            subtract(memo, to_add)
        } else {
            add(memo, to_add)
        }
    });
    let total_in_units = add(total, bar_weight);
    let total_weight = round_to_000005(convert_to(
        if inverted { invert(total_in_units) } else { total_in_units },
        original_unit,
    ));
    let the_plates_weight = convert_to(if inverted { invert(total) } else { total }, original_unit);
    PlatesResult { plates, plates_weight: the_plates_weight, total_weight }
}

struct PlateType {
    weight: IWeight,
    unit_weight: f64,
    max_units: f64,
}

struct PlateSearch<'a> {
    plate_types: &'a [PlateType],
    int_weights: &'a [f64],
    max_from: &'a [f64],
    best: Vec<f64>,
    current: Vec<f64>,
    best_remaining: f64,
    iterations: u32,
}

impl PlateSearch<'_> {
    fn search(&mut self, index: usize, remaining: f64) {
        if self.best_remaining == 0.0 || self.iterations >= 10000 {
            return;
        }
        if remaining == 0.0 || index >= self.plate_types.len() {
            if remaining < self.best_remaining {
                self.best_remaining = remaining;
                self.best[..index].copy_from_slice(&self.current[..index]);
                for b in &mut self.best[index..] {
                    *b = 0.0;
                }
            }
            return;
        }
        self.iterations += 1;
        let w = self.int_weights[index];
        let cap = if w > 0.0 { (remaining / w).floor() } else { 0.0 };
        let max_count = js_min(self.plate_types[index].max_units, cap);
        let mut count = max_count;
        while count >= 0.0 {
            let new_remaining = remaining - count * w;
            if new_remaining - self.max_from[index + 1] >= self.best_remaining {
                count -= 1.0;
                continue;
            }
            self.current[index] = count;
            self.search(index + 1, new_remaining);
            if self.best_remaining == 0.0 {
                return;
            }
            count -= 1.0;
        }
    }
}

fn calculate_plates_internal_fast(
    weight: IWeight,
    available_plates: &[IPlate],
    multiplier: f64,
    is_assisting: bool,
) -> Vec<IPlate> {
    let target_value = if is_assisting { -weight.value } else { weight.value };
    if target_value <= 0.0 || target_value.is_nan() {
        return vec![];
    }
    let plate_types: Vec<PlateType> = available_plates
        .iter()
        .filter(|p| p.num >= multiplier)
        .map(|p| PlateType {
            weight: p.weight,
            unit_weight: p.weight.value * multiplier,
            max_units: (p.num / multiplier).floor(),
        })
        .collect();
    if plate_types.is_empty() {
        return vec![];
    }

    // Convert to integers for exact arithmetic.
    let mut max_decimals: usize = 0;
    for v in std::iter::once(target_value).chain(plate_types.iter().map(|p| p.unit_weight)) {
        let s = js_number_to_string(v);
        if let Some(dot) = s.find('.') {
            max_decimals = max_decimals.max(s.len() - dot - 1);
        }
    }
    let precision = 10f64.powi(max_decimals.min(6) as i32);
    let int_target = js_round(target_value * precision);
    let int_weights: Vec<f64> = plate_types.iter().map(|p| js_round(p.unit_weight * precision)).collect();

    // Max contribution from plates at index i and beyond (for pruning).
    let n = plate_types.len();
    let mut max_from = vec![0.0; n + 1];
    for i in (0..n).rev() {
        max_from[i] = max_from[i + 1] + int_weights[i] * plate_types[i].max_units;
    }

    let mut s = PlateSearch {
        plate_types: &plate_types,
        int_weights: &int_weights,
        max_from: &max_from,
        best: vec![0.0; n],
        current: vec![0.0; n],
        best_remaining: int_target + 1.0,
        iterations: 0,
    };
    s.search(0, int_target);

    let mut plates = Vec::new();
    for (i, pt) in plate_types.iter().enumerate() {
        if s.best[i] > 0.0 {
            plates.push(IPlate { weight: pt.weight, num: s.best[i] * multiplier });
        }
    }
    plates
}


impl From<IPercentageUnit> for UnitOrPct {
    fn from(_: IPercentageUnit) -> Self {
        UnitOrPct::Percent
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::tests::{arg, check, parse_cases, settings_named};
    use serde_json::{json, Value};

    // Expected values come from the TS oracle: testdata/unit/gen_unit_cases.ts
    // runs models/weight.ts under deno over a grid of inputs and records the
    // results in testdata/unit/cases_weight.json.

    fn unit_or_pct(v: &Value) -> UnitOrPct {
        if v.as_str() == Some("%") {
            UnitOrPct::Percent
        } else {
            UnitOrPct::Unit(arg(v))
        }
    }

    fn j<T: serde::Serialize>(x: T) -> Result<Value, String> {
        serde_json::to_value(x).map_err(|e| e.to_string())
    }

    fn run(f: &str, a: &[Value]) -> Option<Result<Value, String>> {
        let sv = |i: usize| arg::<ScriptValue>(&a[i]);
        let wt = |i: usize| arg::<IWeight>(&a[i]);
        let num = |i: usize| arg::<f64>(&a[i]);
        let unit = |i: usize| arg::<IUnit>(&a[i]);
        let osv = |i: usize| arg::<Option<ScriptValue>>(&a[i]);
        let wn = |i: usize| arg::<WeightOrNumber>(&a[i]);
        Some(match f {
            "display" => j(display(sv(0), a[1].as_bool()?)),
            "print" => j(print(sv(0))),
            "printNull" => j(print_null(osv(0))),
            "printOrNumber" => j(print_or_number(sv(0))),
            "type" => j(type_of(sv(0))),
            "convertValueTo" => j(convert_value_to(sv(0), unit_or_pct(&a[1]))),
            "convertTo" => j(convert_to(wt(0), unit(1))),
            "smartConvert" => j(smart_convert(wt(0), unit(1))),
            "abs" => j(abs(wt(0))),
            "invert" => j(invert(wt(0))),
            "roundTo005" => j(round_to_005(wt(0))),
            "roundTo000005" => j(round_to_000005(wt(0))),
            "oppositeUnit" => j(opposite_unit(unit(0))),
            "parse" => j(parse(a[0].as_str()?)),
            "parsePct" => j(parse_pct(a[0].as_str())),
            "strictParse" => j(strict_parse(a[0].as_str()?)),
            "rpeMultiplier" => j(rpe_multiplier(num(0), num(1))),
            "rpePct" => j(rpe_pct(num(0), num(1))),
            "getOneRepMax" => j(get_one_rep_max(wt(0), num(1), arg::<Option<f64>>(&a[2]))),
            "getNRepMax" => j(get_n_rep_max(wt(0), num(1))),
            "calculateRepMax" => j(calculate_rep_max(num(0), num(1), num(2), num(3), num(4))),
            "add" => j(add(wt(0), wn(1))),
            "subtract" => j(subtract(wt(0), wn(1))),
            "multiply" => j(multiply(wt(0), wn(1))),
            "divide" => j(divide(wt(0), wn(1))),
            "operation" => operation(wn(0), wn(1), |x, y| x - y).map_err(|e| e.0).and_then(j),
            "operationAdd" => operation(wn(0), wn(1), |x, y| x + y).map_err(|e| e.0).and_then(j),
            "gt" => j(gt(sv(0), sv(1))),
            "lt" => j(lt(sv(0), sv(1))),
            "gte" => j(gte(sv(0), sv(1))),
            "lte" => j(lte(sv(0), sv(1))),
            "eq" => j(eq(sv(0), sv(1))),
            "eqNull" => j(eq_null(osv(0), osv(1))),
            "eqeq" => j(eqeq(wt(0), wt(1))),
            "compare" => j(compare(wt(0), wt(1))),
            "compareReverse" => j(compare_reverse(wt(0), wt(1))),
            "max" => j(max(&arg::<Vec<IWeight>>(&a[0]))),
            "applyOp" => {
                let onerm = arg::<Option<IWeight>>(&a[0]);
                let opr: IAssignmentOp = arg(&a[3]);
                j(apply_op(onerm, sv(1), sv(2), opr))
            }
            "convertToWeight" => j(convert_to_weight(wt(0), sv(1), unit(2))),
            "platesWeight" => j(plates_weight(&arg::<Vec<IPlate>>(&a[0]))),
            "buildAny" => j(build_any(num(0), unit_or_pct(&a[1]))),
            _ => return settings_dependent(f, a),
        })
    }

    fn settings_dependent(f: &str, a: &[Value]) -> Option<Result<Value, String>> {
        let s = settings_named(a[0].as_str()?);
        let wt = |i: usize| arg::<IWeight>(&a[i]);
        let ty = |i: usize| arg::<Option<IExerciseType>>(&a[i]);
        let unit = |i: usize| arg::<IUnit>(&a[i]);
        Some(match f {
            "calculatePlates" => {
                let t = ty(3)?;
                j(calculate_plates(wt(1), &s, unit(2), &t))
            }
            "round" => j(round(wt(1), &s, unit(2), ty(3).as_ref())),
            "roundConvertTo" => j(round_convert_to(wt(1), &s, unit(2), ty(3).as_ref())),
            "increment" => j(increment(wt(1), &s, ty(2).as_ref())),
            "decrement" => j(decrement(wt(1), &s, ty(2).as_ref())),
            "evaluateWeight" => {
                let t = ty(2)?;
                j(evaluate_weight(arg::<WeightOrPct>(&a[1]), &t, &s))
            }
            "getTrainingMax" => j(get_training_max(wt(1), arg::<f64>(&a[2]), &s)),
            "formatOneSide" => {
                let t = ty(2)?;
                j(format_one_side(&s, &arg::<Vec<IPlate>>(&a[1]), &t))
            }
            _ => return None,
        })
    }

    #[test]
    fn matches_oracle() {
        let cases = parse_cases(include_str!("../testdata/unit/cases_weight.json"));
        let mut errors = Vec::new();
        let mut unknown = std::collections::BTreeSet::new();
        for c in &cases {
            match run(&c.f, &c.args) {
                Some(r) => check(c, &Value::Array(c.args.clone()).to_string(), r, false, &mut errors),
                None => {
                    unknown.insert(c.f.clone());
                }
            }
        }
        assert!(unknown.is_empty(), "unhandled fns: {unknown:?}");
        assert!(errors.is_empty(), "{} of {} cases differ, first:\n{}", errors.len(), cases.len(), errors.join("\n"));
    }

    #[test]
    fn handpicked() {
        assert_eq!(convert_to(build(100.0, IUnit::Kg), IUnit::Lb), build(220.5, IUnit::Lb));
        assert_eq!(convert_to(build(225.0, IUnit::Lb), IUnit::Kg), build(102.0, IUnit::Kg));
        assert_eq!(display(build(100.0, IUnit::Lb), true), "100 lb");
        assert_eq!(display(build(12.345, IUnit::Kg), false), "12.35");
        assert_eq!(display(IPercentage::new(85.0), true), "85%");
        assert!(gt(build(100.0, IUnit::Kg), build(200.0, IUnit::Lb)));
        assert!(!gt(build(100.0, IUnit::Kg), IPercentage::new(1.0)));
        assert!(gt(5.0, build(2.0, IUnit::Kg)));
        assert_eq!(parse("12.5 kg"), Some(build(12.5, IUnit::Kg)));
        assert_eq!(parse("1.2.3lb"), Some(build(1.2, IUnit::Lb)));
        assert_eq!(strict_parse("1.2.3lb"), None);
        assert_eq!(strict_parse("+.5kg"), Some(build(0.5, IUnit::Kg)));
        assert_eq!(rpe_multiplier(1.0, 10.0), 1.0);
        assert_eq!(rpe_multiplier(5.0, 8.0), 0.8124056000000001);
        assert_eq!(json!(ZERO), json!({"value": 0, "unit": "lb"}));
    }
}
