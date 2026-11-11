//! Golden tests for the run pipeline port: every case in `testdata/golden/run/*.json`, produced
//! by the TS `packages/run` (the oracle), must be reproduced by `qala_core::run`.
//!
//! The file format is the engine's (`testdata/golden/engine/README.md`) and the generator is
//! `scripts/golden_run.ts`. Cases are compared as parsed JSON: floats with the case `tolerance`
//! (relative, plus an absolute floor of 1e-9), everything else exactly. For the whole-run files
//! the structure is compared first (point counts, re-anchor flags, pause intervals, events) so a
//! discrete difference reads as one, and only then the numbers.
//!
//! The goldens write non-finite numbers as the strings "NaN", "Infinity" and "-Infinity"; inputs
//! are revived to real non-finite `f64`s and a field a case leaves out becomes NaN where the TS
//! would see `undefined` (a required fix field, for instance).

use qala_core::run::autopause::{
    causal_clock_trace, compute_pauses, moving_elapsed_at, paused_overlap, AutoPause,
    AutoPauseOptions, PauseState,
};
use qala_core::run::cues::CueConfig;
use qala_core::run::filter::{FilterOptions, FixFilter};
use qala_core::run::geo::{haversine_m, vincenty_m};
use qala_core::run::guided::{expand_workout, GuidedOptions, GuidedRun};
use qala_core::run::pace::{average_pace, cue_pace, current_pace, dist_at, window_speed};
use qala_core::run::splits::{compute_splits, SplitOptions};
use qala_core::run::{
    process_run, FilteredPoint, Fix, PauseInterval, Recorder, RecorderConfig, RunEvent, RunWorkout,
    WorkoutStep, WorkoutStepKind,
};
use serde_json::{json, Value};
use std::panic::{catch_unwind, AssertUnwindSafe};

const DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/golden/run/");

/// The absolute part of the float rule. A stationary run's speed or distance step is a few
/// micro-units left over from a difference of large numbers; it moves in the 11th digit with the
/// last bit of a libm call and means nothing (`scripts/golden_run.ts`, `ABS_FLOOR`).
const ABS_FLOOR: f64 = 1e-9;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

struct Case {
    name: String,
    input: Value,
    expected: Value,
    tolerance: Option<f64>,
}

fn load(file: &str) -> Vec<Case> {
    let path = format!("{DIR}{file}.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    assert_eq!(doc["version"], json!(1), "{path}: unknown version");
    assert_eq!(
        doc["fn"],
        json!(file),
        "{path}: fn does not match the file name"
    );
    doc["cases"]
        .as_array()
        .unwrap_or_else(|| panic!("{path}: no cases"))
        .iter()
        .map(|c| Case {
            name: c["name"].as_str().expect("case name").to_string(),
            input: c["input"].clone(),
            expected: c["expected"].clone(),
            tolerance: c.get("tolerance").map(num),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Reviving inputs
// ---------------------------------------------------------------------------

/// A JSON number, or one of the strings the goldens use for non-finite values.
fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().expect("number in range"),
        Value::String(s) => match s.as_str() {
            "NaN" => f64::NAN,
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            other => panic!("not a number: {other:?}"),
        },
        other => panic!("not a number: {other}"),
    }
}

/// An optional number: an absent key (or null) is `None`.
fn opt_num(obj: &Value, key: &str) -> Option<f64> {
    match obj.get(key) {
        None | Some(Value::Null) => None,
        Some(v) => Some(num(v)),
    }
}

/// A field TS reads as `undefined` when it is missing: NaN, which every gate treats the same.
fn nan_if_missing(obj: &Value, key: &str) -> f64 {
    opt_num(obj, key).unwrap_or(f64::NAN)
}

fn fix_in(v: &Value) -> Fix {
    Fix {
        t: nan_if_missing(v, "t"),
        lat: nan_if_missing(v, "lat"),
        lon: nan_if_missing(v, "lon"),
        acc: nan_if_missing(v, "acc"),
        hr: opt_num(v, "hr"),
        cad: opt_num(v, "cad"),
        ele: opt_num(v, "ele"),
    }
}

fn fixes_in(v: &Value) -> Vec<Fix> {
    v.as_array().expect("fixes").iter().map(fix_in).collect()
}

fn filter_opts_in(v: Option<&Value>) -> FilterOptions {
    let Some(o) = v else {
        return FilterOptions::default();
    };
    FilterOptions {
        accuracy_gate_m: opt_num(o, "accuracyGateM"),
        speed_gate_mps: opt_num(o, "speedGateMps"),
        reanchor_count: opt_num(o, "reanchorCount").map(|n| n as u32),
        accel_noise: opt_num(o, "accelNoise"),
    }
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Tol {
    /// Bit-for-bit equal doubles.
    Exact,
    /// The README rule with the run files' floor: `a == e || |a - e| <= t * max(|a|, |e|) + 1e-9`.
    Rel(f64),
}

fn numbers_match(a: f64, e: f64, tol: Tol) -> bool {
    if a == e || (a.is_nan() && e.is_nan()) {
        return true;
    }
    match tol {
        Tol::Exact => false,
        Tol::Rel(t) => (a - e).abs() <= t * a.abs().max(e.abs()) + ABS_FLOOR,
    }
}

fn is_nonfinite_text(s: &str) -> bool {
    matches!(s, "NaN" | "Infinity" | "-Infinity")
}

/// Appends a line to `errs` for every difference between `golden` and `actual`.
fn compare(path: &str, golden: &Value, actual: &Value, tol: Tol, errs: &mut Vec<String>) {
    match (golden, actual) {
        (Value::Object(g), Value::Object(a)) => {
            for (k, gv) in g {
                match a.get(k) {
                    Some(av) => compare(&format!("{path}.{k}"), gv, av, tol, errs),
                    None => errs.push(format!("{path}.{k}: missing in the Rust result")),
                }
            }
            for k in a.keys() {
                if !g.contains_key(k) {
                    errs.push(format!("{path}.{k}: extra key in the Rust result"));
                }
            }
        }
        (Value::Array(g), Value::Array(a)) => {
            if g.len() != a.len() {
                errs.push(format!(
                    "{path}: length {} but golden has {}",
                    a.len(),
                    g.len()
                ));
                return;
            }
            for (i, (gv, av)) in g.iter().zip(a).enumerate() {
                compare(&format!("{path}[{i}]"), gv, av, tol, errs);
            }
        }
        (Value::Number(g), Value::Number(a)) => {
            let (g, a) = (
                g.as_f64().unwrap_or(f64::NAN),
                a.as_f64().unwrap_or(f64::NAN),
            );
            if !numbers_match(a, g, tol) {
                errs.push(format!("{path}: {a:?} but golden has {g:?}"));
            }
        }
        // A struct serialized with serde writes a non-finite double as null.
        (Value::String(g), Value::Null) if is_nonfinite_text(g) => {}
        (g, a) if g == a => {}
        (g, a) => errs.push(format!("{path}: {a} but golden has {g}")),
    }
}

/// The part of the result that must match exactly before any number is looked at.
type Structure = fn(&Value, &Value) -> Vec<String>;

/// Runs `run` on every case of `file`: structure first, then the numbers. Reports all failures
/// at once.
fn run_file(
    file: &str,
    tol_override: Option<Tol>,
    structure: Option<Structure>,
    run: impl Fn(&Case) -> Result<Value, String>,
) {
    let cases = load(file);
    let mut failures: Vec<String> = Vec::new();
    let mut failed_cases = 0;
    let mut worst = 0.0f64;
    for case in &cases {
        let tol = tol_override.unwrap_or(match case.tolerance {
            Some(t) => Tol::Rel(t),
            None => Tol::Exact,
        });
        let outcome = catch_unwind(AssertUnwindSafe(|| run(case)));
        let mut errs = Vec::new();
        match outcome {
            Ok(Ok(actual)) => {
                if let Some(s) = structure {
                    errs.extend(s(&case.expected, &actual));
                }
                if errs.is_empty() {
                    compare("$", &case.expected, &actual, tol, &mut errs);
                    worst = worst.max(worst_rel(&case.expected, &actual));
                }
            }
            Ok(Err(e)) => errs.push(format!("returned an error: {e}")),
            Err(_) => errs.push("panicked".to_string()),
        }
        if !errs.is_empty() {
            failed_cases += 1;
        }
        for e in errs {
            failures.push(format!("  {:?}: {e}", case.name));
        }
    }
    assert!(
        failures.is_empty(),
        "{failed_cases} of {} cases in {file}.json failed:\n{}",
        cases.len(),
        failures
            .iter()
            .take(40)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    eprintln!(
        "{file}.json: {} cases ok, worst relative error {worst:.2e}",
        cases.len()
    );
}

/// The worst relative difference between two result trees (0 when they are bit-equal), for the
/// report line that says how much margin the tolerance has.
fn worst_rel(golden: &Value, actual: &Value) -> f64 {
    match (golden, actual) {
        (Value::Object(g), Value::Object(a)) => g
            .iter()
            .filter_map(|(k, gv)| a.get(k).map(|av| worst_rel(gv, av)))
            .fold(0.0, f64::max),
        (Value::Array(g), Value::Array(a)) => g
            .iter()
            .zip(a)
            .map(|(gv, av)| worst_rel(gv, av))
            .fold(0.0, f64::max),
        (Value::Number(g), Value::Number(a)) => {
            let (g, a) = (
                g.as_f64().unwrap_or(f64::NAN),
                a.as_f64().unwrap_or(f64::NAN),
            );
            if g == a {
                0.0
            } else {
                (g - a).abs() / g.abs().max(a.abs()).max(1e-12)
            }
        }
        _ => 0.0,
    }
}

fn args(case: &Case) -> &Value {
    &case.input["args"]
}

fn fn_name(case: &Case) -> &str {
    case.input["fn"].as_str().expect("input.fn")
}

fn to_value<T: serde::Serialize>(v: &T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// geodesy.json
// ---------------------------------------------------------------------------

fn run_geodesy(case: &Case) -> Result<Value, String> {
    let a = args(case);
    let (lat1, lon1, lat2, lon2) = (
        num(&a["lat1"]),
        num(&a["lon1"]),
        num(&a["lat2"]),
        num(&a["lon2"]),
    );
    let d = match fn_name(case) {
        "vincentyM" => vincenty_m(lat1, lon1, lat2, lon2),
        "haversineM" => haversine_m(lat1, lon1, lat2, lon2),
        other => return Err(format!("unknown fn {other}")),
    };
    // A non-finite result is written as null by serde, matching the goldens' strings.
    to_value(&d)
}

#[test]
fn golden_geodesy() {
    run_file("geodesy", None, None, run_geodesy);
}

// ---------------------------------------------------------------------------
// filter.json
// ---------------------------------------------------------------------------

/// The `lineFixes` helper's arithmetic, so a 14,400 fix input is stored as a generator.
fn line_fixes(v: &Value) -> Vec<Fix> {
    let count = num(&v["count"]) as usize;
    let speed = num(&v["speedMps"]);
    let t0 = opt_num(v, "t0").unwrap_or(0.0);
    let dt = opt_num(v, "dt").unwrap_or(1.0);
    let start_lat = opt_num(v, "startLat").unwrap_or(47.6062);
    let start_lon = opt_num(v, "startLon").unwrap_or(-122.3321);
    let acc = opt_num(v, "acc").unwrap_or(3.0);
    (0..count)
        .map(|i| {
            let i = i as f64;
            Fix {
                t: t0 + i * dt,
                lat: start_lat + (speed * i * dt) / 111319.49,
                lon: start_lon,
                acc,
                hr: None,
                cad: None,
                ele: None,
            }
        })
        .collect()
}

fn run_filter(case: &Case) -> Result<Value, String> {
    let input = &case.input;
    let fixes = match input.get("line") {
        Some(line) => line_fixes(line),
        None => fixes_in(&input["fixes"]),
    };
    let mut f = FixFilter::new(&filter_opts_in(input.get("opts"))).map_err(|e| e.to_string())?;
    let mut emitted: Vec<usize> = Vec::with_capacity(fixes.len());
    for fix in &fixes {
        emitted.push(f.push(fix));
    }
    let pts = f.points();
    if let Some(step) = input.get("summary") {
        let step = num(step) as usize;
        let sampled: Vec<&FilteredPoint> = pts.iter().step_by(step).collect();
        return Ok(json!({
            "count": pts.len(),
            "first": pts.first().map(to_value).transpose()?,
            "last": pts.last().map(to_value).transpose()?,
            "sampled": to_value(&sampled)?,
            "gaps": pts.iter().filter(|p| p.gap).count(),
            "emittedTotal": emitted.iter().sum::<usize>(),
        }));
    }
    Ok(json!({ "points": to_value(&pts)?, "emitted": emitted }))
}

/// Point count, which pushes emitted what, and which points carry the re-anchor flag.
fn filter_structure(golden: &Value, actual: &Value) -> Vec<String> {
    let mut errs = Vec::new();
    for key in ["emitted", "count", "gaps", "emittedTotal"] {
        if golden.get(key) != actual.get(key) {
            errs.push(format!(
                "{key}: {:?} but golden has {:?}",
                actual.get(key),
                golden.get(key)
            ));
        }
    }
    if let (Some(g), Some(a)) = (golden.get("points"), actual.get("points")) {
        let (g, a) = (g.as_array().unwrap(), a.as_array().unwrap());
        if g.len() != a.len() {
            errs.push(format!(
                "point count {} but golden has {}",
                a.len(),
                g.len()
            ));
        } else {
            for (i, (gp, ap)) in g.iter().zip(a).enumerate() {
                if gp.get("gap") != ap.get("gap") {
                    errs.push(format!("point {i}: gap flag differs"));
                }
                for key in ["t", "acc"] {
                    if gp.get(key) != ap.get(key) {
                        errs.push(format!(
                            "point {i}: {key} {:?} but golden has {:?}",
                            ap.get(key),
                            gp.get(key)
                        ));
                    }
                }
            }
        }
    }
    errs
}

#[test]
fn golden_filter() {
    run_file("filter", None, Some(filter_structure), run_filter);
}

/// The Kalman filter's `+ - * /` and V8's `Math.hypot` are reproduced operation by operation,
/// so outside the trig calls the doubles can be identical. This reports how far off they are
/// without failing; `golden_filter` is the gate.
#[test]
fn filter_exactness_report() {
    let cases = load("filter");
    let (mut exact, mut total) = (0usize, 0usize);
    let mut per_key = std::collections::BTreeMap::<&str, (usize, usize)>::new();
    for case in &cases {
        let Ok(actual) = run_filter(case) else {
            continue;
        };
        let Some(g) = case.expected.get("points").and_then(Value::as_array) else {
            continue;
        };
        let Some(a) = actual.get("points").and_then(Value::as_array) else {
            continue;
        };
        for (gp, ap) in g.iter().zip(a) {
            for key in ["speedMps", "distM", "lat", "lon"] {
                total += 1;
                let e = per_key.entry(key).or_default();
                e.1 += 1;
                if gp.get(key) == ap.get(key) {
                    exact += 1;
                    e.0 += 1;
                }
            }
        }
    }
    eprintln!(
        "filter points: {exact} of {total} fields bit-identical to V8; per field {per_key:?}"
    );
}

// ---------------------------------------------------------------------------
// Inputs shared by the pipeline files
// ---------------------------------------------------------------------------

fn text<'a>(obj: &'a Value, key: &str) -> &'a str {
    obj.get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing string {key}"))
}

/// The `{t, speedMps}` and `{t, distM, hr?}` samples the pace, split and auto-pause functions read.
fn samples_in(v: &Value) -> Vec<FilteredPoint> {
    v.as_array()
        .expect("points")
        .iter()
        .map(|p| {
            FilteredPoint::sample(
                nan_if_missing(p, "t"),
                opt_num(p, "distM").unwrap_or(0.0),
                opt_num(p, "speedMps").unwrap_or(0.0),
                opt_num(p, "hr"),
            )
        })
        .collect()
}

fn autopause_opts_in(v: Option<&Value>) -> AutoPauseOptions {
    let Some(o) = v else {
        return AutoPauseOptions::default();
    };
    AutoPauseOptions {
        low_mps: opt_num(o, "lowMps"),
        low_hold_sec: opt_num(o, "lowHoldSec"),
        high_mps: opt_num(o, "highMps"),
        high_hold_sec: opt_num(o, "highHoldSec"),
    }
}

fn split_opts_in(v: Option<&Value>) -> SplitOptions {
    let Some(o) = v else {
        return SplitOptions::default();
    };
    SplitOptions {
        split_m: opt_num(o, "splitM"),
        min_partial_m: opt_num(o, "minPartialM"),
    }
}

fn guided_opts_in(v: Option<&Value>) -> GuidedOptions {
    let Some(o) = v else {
        return GuidedOptions::default();
    };
    GuidedOptions {
        tolerance_mps: opt_num(o, "toleranceMps"),
        prompt_cooldown_sec: opt_num(o, "promptCooldownSec"),
    }
}

fn workout_in(v: &Value) -> RunWorkout {
    let steps = v["steps"]
        .as_array()
        .expect("steps")
        .iter()
        .map(|s| WorkoutStep {
            kind: match text(s, "kind") {
                "warmup" => WorkoutStepKind::Warmup,
                "work" => WorkoutStepKind::Work,
                "recover" => WorkoutStepKind::Recover,
                "cooldown" => WorkoutStepKind::Cooldown,
                other => panic!("unknown step kind {other}"),
            },
            distance_m: opt_num(s, "distanceM"),
            seconds: opt_num(s, "seconds"),
            target_mps: opt_num(s, "targetMps"),
            pace_lo_mps: opt_num(s, "paceLoMps"),
            pace_hi_mps: opt_num(s, "paceHiMps"),
            hr_zone: opt_num(s, "hrZone"),
            repeat: opt_num(s, "repeat"),
        })
        .collect();
    RunWorkout { steps }
}

/// `ProcessRunOptions` as the TS gives them: `splitM` is shorthand that wins over `splits.splitM`.
fn config_in(opts: Option<&Value>) -> RecorderConfig {
    let Some(o) = opts else {
        return RecorderConfig::default();
    };
    let mut splits = split_opts_in(o.get("splits"));
    if let Some(m) = opt_num(o, "splitM") {
        splits.split_m = Some(m);
    }
    RecorderConfig {
        filter: filter_opts_in(o.get("filter")),
        autopause: autopause_opts_in(o.get("autopause")),
        splits,
        workout: o.get("workout").map(workout_in),
        guided: guided_opts_in(o.get("guided")),
        cues: CueConfig::default(),
    }
}

fn pause_intervals_out(p: &[PauseInterval]) -> Result<Value, String> {
    to_value(&p)
}

// ---------------------------------------------------------------------------
// autopause.json
// ---------------------------------------------------------------------------

fn run_autopause(case: &Case) -> Result<Value, String> {
    let a = args(case);
    match fn_name(case) {
        "computePauses" => {
            let r = compute_pauses(&samples_in(&a["points"]), &autopause_opts_in(a.get("opts")));
            Ok(json!({
                "paused": pause_intervals_out(&r.paused)?,
                "movingSec": to_value(&r.moving_sec)?,
                "elapsedSec": to_value(&r.elapsed_sec)?,
            }))
        }
        "causalClockTrace" => to_value(&causal_clock_trace(
            &samples_in(&a["points"]),
            &autopause_opts_in(a.get("opts")),
        )),
        "autoPauseMachine" => {
            let mut m = AutoPause::new(&autopause_opts_in(a.get("opts")));
            let (mut states, mut open, mut closed) = (Vec::new(), Vec::new(), Vec::new());
            for p in samples_in(&a["points"]) {
                let st = m.update(p.t, p.speed_mps);
                states.push(match st {
                    PauseState::Moving => "moving",
                    PauseState::Paused => "paused",
                });
                open.push(m.open_pause_start());
                closed.push(m.intervals().len());
            }
            let finished = pause_intervals_out(m.finish())?;
            Ok(
                json!({ "states": states, "open": to_value(&open)?, "closed": closed, "finished": finished }),
            )
        }
        "pausedOverlap" | "movingElapsedAt" => {
            let iv: Vec<PauseInterval> = a["intervals"]
                .as_array()
                .expect("intervals")
                .iter()
                .map(|i| PauseInterval {
                    start_t: num(&i["startT"]),
                    end_t: num(&i["endT"]),
                })
                .collect();
            let (from, to) = (num(&a["fromT"]), num(&a["toT"]));
            let d = if fn_name(case) == "pausedOverlap" {
                paused_overlap(&iv, from, to)
            } else {
                moving_elapsed_at(&iv, from, to)
            };
            to_value(&d)
        }
        other => Err(format!("unknown fn {other}")),
    }
}

/// Pauses are timestamps copied from the input, so they must be bit-equal; so must the states.
fn autopause_structure(golden: &Value, actual: &Value) -> Vec<String> {
    let mut errs = Vec::new();
    for key in ["paused", "states", "closed", "finished"] {
        if golden.get(key) != actual.get(key) {
            errs.push(format!(
                "{key}: {:?} but golden has {:?}",
                actual.get(key),
                golden.get(key)
            ));
        }
    }
    errs
}

#[test]
fn golden_autopause() {
    run_file("autopause", None, Some(autopause_structure), run_autopause);
}

// ---------------------------------------------------------------------------
// splits.json
// ---------------------------------------------------------------------------

fn run_splits(case: &Case) -> Result<Value, String> {
    let i = &case.input;
    to_value(&compute_splits(
        &samples_in(&i["points"]),
        &split_opts_in(i.get("opts")),
    ))
}

/// Split count and each split's index.
fn splits_structure(golden: &Value, actual: &Value) -> Vec<String> {
    let (g, a) = (golden.as_array().unwrap(), actual.as_array().unwrap());
    let mut errs = Vec::new();
    if g.len() != a.len() {
        errs.push(format!("{} splits but golden has {}", a.len(), g.len()));
        return errs;
    }
    for (i, (gs, as_)) in g.iter().zip(a).enumerate() {
        if gs.get("index") != as_.get("index") {
            errs.push(format!("split {i}: index differs"));
        }
        if gs.get("hrAvg").is_some() != as_.get("hrAvg").is_some() {
            errs.push(format!("split {i}: hrAvg present on one side only"));
        }
    }
    errs
}

#[test]
fn golden_splits() {
    run_file("splits", None, Some(splits_structure), run_splits);
}

// ---------------------------------------------------------------------------
// pace.json
// ---------------------------------------------------------------------------

fn pace_out(p: Option<qala_core::run::pace::PaceResult>) -> Result<Value, String> {
    to_value(&p)
}

fn run_pace(case: &Case) -> Result<Value, String> {
    let a = args(case);
    match fn_name(case) {
        "distAt" => to_value(&dist_at(&samples_in(&a["points"]), num(&a["t"]))),
        "distAtMany" => {
            let pts = samples_in(&a["points"]);
            let out: Vec<Option<f64>> = a["ts"]
                .as_array()
                .expect("ts")
                .iter()
                .map(|t| dist_at(&pts, num(t)))
                .collect();
            to_value(&out)
        }
        "windowSpeed" => pace_out(window_speed(
            &samples_in(&a["points"]),
            num(&a["nowT"]),
            num(&a["windowSec"]),
        )),
        "currentPace" => pace_out(current_pace(&samples_in(&a["points"]), opt_num(a, "nowT"))),
        "cuePace" => pace_out(cue_pace(&samples_in(&a["points"]), opt_num(a, "nowT"))),
        "averagePace" => pace_out(average_pace(num(&a["distanceM"]), num(&a["movingSec"]))),
        other => Err(format!("unknown fn {other}")),
    }
}

/// A pace reads out or it does not: `null` against a value is a discrete difference.
fn pace_structure(golden: &Value, actual: &Value) -> Vec<String> {
    // serde writes a NaN result as null, where the goldens write the string "NaN".
    let golden_nan = golden.as_str().is_some_and(is_nonfinite_text);
    if golden.is_null() != actual.is_null() && !golden_nan {
        return vec![format!("{actual} but golden has {golden}")];
    }
    Vec::new()
}

#[test]
fn golden_pace() {
    run_file("pace", None, Some(pace_structure), run_pace);
}

// ---------------------------------------------------------------------------
// guided.json
// ---------------------------------------------------------------------------

fn run_guided(case: &Case) -> Result<Value, String> {
    let a = args(case);
    match fn_name(case) {
        "expandWorkout" => {
            let steps = expand_workout(&workout_in(&a["workout"])).map_err(|e| e.to_string())?;
            to_value(&steps)
        }
        "guidedRun" => {
            let mut g = GuidedRun::new(&workout_in(&a["workout"]), &guided_opts_in(a.get("opts")))
                .map_err(|e| e.to_string())?;
            let mut events = Vec::new();
            for op in a["ops"].as_array().expect("ops") {
                let evs = if let Some(u) = op.get("update") {
                    g.update(
                        opt_num(u, "cueSpeedMps"),
                        num(&u["distM"]),
                        num(&u["timeSec"]),
                    )
                } else {
                    let adv = &op["advance"];
                    g.advance(num(&adv["distM"]), num(&adv["timeSec"]))
                };
                events.push(to_value(&evs)?);
            }
            Ok(json!({
                "events": events,
                "summaries": to_value(&g.step_summaries())?,
                "currentStepIndex": g.current_step_index(),
                "complete": g.complete(),
            }))
        }
        other => Err(format!("unknown fn {other}")),
    }
}

/// The type and step index of every event, per operation, and the finished-step list.
fn event_shape(events: &Value) -> Vec<(String, Option<u64>)> {
    events
        .as_array()
        .map(|a| {
            a.iter()
                .map(|e| {
                    (
                        e["type"].as_str().unwrap_or("?").to_string(),
                        e.get("stepIndex").and_then(Value::as_u64),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn guided_structure(golden: &Value, actual: &Value) -> Vec<String> {
    let mut errs = Vec::new();
    if let (Some(g), Some(a)) = (
        golden.get("events").and_then(Value::as_array),
        actual.get("events").and_then(Value::as_array),
    ) {
        if g.len() != a.len() {
            errs.push(format!("{} operations but golden has {}", a.len(), g.len()));
        } else {
            for (i, (ge, ae)) in g.iter().zip(a).enumerate() {
                if event_shape(ge) != event_shape(ae) {
                    errs.push(format!(
                        "operation {i}: events {:?} but golden has {:?}",
                        event_shape(ae),
                        event_shape(ge)
                    ));
                }
            }
        }
    }
    for key in ["currentStepIndex", "complete"] {
        if golden.get(key) != actual.get(key) {
            errs.push(format!(
                "{key}: {:?} but golden has {:?}",
                actual.get(key),
                golden.get(key)
            ));
        }
    }
    errs
}

#[test]
fn golden_guided() {
    run_file("guided", None, Some(guided_structure), run_guided);
}

// ---------------------------------------------------------------------------
// process_run.json and process_run_2h.json
// ---------------------------------------------------------------------------

fn run_process(case: &Case) -> Result<Value, String> {
    let i = &case.input;
    let cfg = config_in(i.get("opts"));
    let fixes = fixes_in(&i["fixes"]);
    let run = process_run(&fixes, &cfg).map_err(|e| e.to_string())?;
    let mut v = to_value(&run)?;
    // The TS result does not carry the guided clock; the generator adds it from the points.
    v["clock"] = to_value(&causal_clock_trace(&run.points, &cfg.autopause))?;
    Ok(v)
}

/// What a discrete difference would look like: how many points and splits, which points carry the
/// re-anchor flag, the pause intervals (input timestamps) and the guided event sequence.
fn process_structure(golden: &Value, actual: &Value) -> Vec<String> {
    let mut errs = filter_structure(
        &json!({ "points": golden["points"] }),
        &json!({ "points": actual["points"] }),
    );
    for key in ["paused", "guidedEvents"] {
        let (g, a) = (&golden[key], &actual[key]);
        if key == "guidedEvents" {
            if event_shape(g) != event_shape(a) {
                errs.push(format!(
                    "guidedEvents: {:?} but golden has {:?}",
                    event_shape(a),
                    event_shape(g)
                ));
            }
        } else if g != a {
            errs.push(format!("{key}: {a} but golden has {g}"));
        }
    }
    errs.extend(splits_structure(&golden["splits"], &actual["splits"]));
    for key in ["currentSpeedMps", "cueSpeedMps"] {
        if golden[key].is_null() != actual[key].is_null() {
            errs.push(format!(
                "{key}: {} but golden has {}",
                actual[key], golden[key]
            ));
        }
    }
    errs
}

#[test]
fn golden_process_run() {
    run_file("process_run", None, Some(process_structure), run_process);
}

#[test]
fn golden_process_run_2h() {
    run_file("process_run_2h", None, Some(process_structure), run_process);
}

// ---------------------------------------------------------------------------
// The recorder, fed fix by fix
// ---------------------------------------------------------------------------

/// Push every fix of every `process_run` vector one at a time and check what comes out against
/// the TS batch: the events concatenated, the final result, the live numbers at the end, and that
/// the points each push appended add up.
#[test]
fn recorder_fed_fix_by_fix_equals_the_batch() {
    let mut checked = 0;
    for file in ["process_run", "process_run_2h"] {
        for case in load(file) {
            let cfg = config_in(case.input.get("opts"));
            let fixes = fixes_in(&case.input["fixes"]);
            let mut rec = Recorder::new(&cfg).unwrap_or_else(|e| panic!("{}: {e}", case.name));
            let mut guided_events: Vec<Value> = Vec::new();
            let mut last_live = None;
            let mut added = 0usize;
            for fix in &fixes {
                let before = rec.points().len();
                let r = rec.push_fix(fix).unwrap();
                added += rec.points().len() - before;
                assert_eq!(r.live.points, rec.points().len(), "{}", case.name);
                for e in &r.events {
                    match e {
                        RunEvent::Guided(g) => guided_events.push(to_value(g).unwrap()),
                        RunEvent::Cue(_) => panic!("{}: periodic cues are off", case.name),
                    }
                }
                last_live = Some(r.live);
            }
            let run = rec.finish().unwrap();
            assert_eq!(
                added,
                run.points.len(),
                "{}: points appended per push",
                case.name
            );
            let tol = Tol::Rel(case.tolerance.unwrap_or(1e-9));

            // Concatenated push events equal the TS guidedEvents.
            let mut errs = Vec::new();
            compare(
                "$.guidedEvents",
                &case.expected["guidedEvents"],
                &Value::Array(guided_events),
                tol,
                &mut errs,
            );
            // The finished run equals the TS result (and what `process_run` gives).
            let mut v = to_value(&run).unwrap();
            v["clock"] = to_value(&causal_clock_trace(&run.points, &cfg.autopause)).unwrap();
            compare("$", &case.expected, &v, tol, &mut errs);
            assert_eq!(
                to_value(&run).unwrap(),
                to_value(&process_run(&fixes, &cfg).unwrap()).unwrap(),
                "{}",
                case.name
            );

            // Live numbers at the last push.
            if let Some(live) = last_live {
                let g = &case.expected;
                let last_dist = g["points"]
                    .as_array()
                    .and_then(|p| p.last())
                    .map_or(0.0, |p| num(&p["distM"]));
                if !numbers_match(live.dist_m, last_dist, tol) {
                    errs.push(format!(
                        "live distance {} but golden has {last_dist}",
                        live.dist_m
                    ));
                }
                for (key, got) in [
                    ("currentSpeedMps", live.current.map(|c| c.speed_mps)),
                    ("cueSpeedMps", live.cue.map(|c| c.speed_mps)),
                ] {
                    match (&g[key], got) {
                        (Value::Null, None) => {}
                        (gv, Some(x)) if numbers_match(x, num(gv), tol) => {}
                        (gv, got) => errs.push(format!("live {key} {got:?} but golden has {gv}")),
                    }
                }
                // The live moving time is the causal clock; the batch one closes an open pause at
                // the last fix. Same number, different association.
                let batch_moving = num(&g["movingSec"]);
                if (live.moving_sec - batch_moving).abs() > 1e-9 && live.points >= 2 {
                    errs.push(format!(
                        "live moving {} but golden movingSec {batch_moving}",
                        live.moving_sec
                    ));
                }
            }
            assert!(
                errs.is_empty(),
                "{} {}:\n{}",
                file,
                case.name,
                errs.iter().take(10).cloned().collect::<Vec<_>>().join("\n")
            );
            checked += 1;
        }
    }
    eprintln!("recorder: {checked} runs pushed fix by fix and equal to the TS batch");
}

/// Periodic cues over the 2 h track: every threshold fires exactly once, in order, with no gap
/// (the replay gate in rust-core 7 R1 and android-native 5).
#[test]
fn two_hour_replay_has_no_cue_gap() {
    let case = load("process_run_2h").remove(0);
    let fixes = fixes_in(&case.input["fixes"]);
    let mut cfg = config_in(case.input.get("opts"));
    cfg.cues = CueConfig {
        every_dist_m: Some(1609.344),
        every_sec: Some(300.0),
    };
    let mut rec = Recorder::new(&cfg).unwrap();
    let (mut dist_marks, mut time_marks): (Vec<u64>, Vec<u64>) = (Vec::new(), Vec::new());
    let mut cue_times: Vec<f64> = Vec::new();
    for fix in &fixes {
        for e in rec.push_fix(fix).unwrap().events {
            if let RunEvent::Cue(c) = e {
                let v = to_value(&c).unwrap();
                let n = v["n"].as_u64().unwrap();
                if v["type"] == "distanceCue" {
                    dist_marks.push(n);
                } else {
                    time_marks.push(n);
                    cue_times.push(v["movingSec"].as_f64().unwrap());
                }
            }
        }
    }
    let run = rec.finish().unwrap();
    // Every mile is read out once and in order.
    let miles = (run.distance_m / 1609.344).floor() as u64;
    assert_eq!(dist_marks, (1..=miles).collect::<Vec<_>>(), "distance cues");
    // The causal clock steps back at a confirmed pause, so the readings climb to the highest
    // clock value seen; each 5 minutes of that fires once.
    let clock = causal_clock_trace(&run.points, &cfg.autopause);
    let top = clock.iter().cloned().fold(0.0, f64::max);
    let want = (top / 300.0).floor() as u64;
    assert_eq!(time_marks, (1..=want).collect::<Vec<_>>(), "time cues");
    // No gap: consecutive time cues are never more than the interval plus a pause step-back apart
    // on the moving clock.
    for w in cue_times.windows(2) {
        assert!(w[1] - w[0] < 300.0 + 10.0, "gap between time cues: {w:?}");
    }
    assert!(
        miles >= 12 && want >= 18,
        "a real two hours: {miles} miles, {want} five-minute marks"
    );
}

/// 7,200 pushes one at a time (docs/rust-core.md 7 R1: under 1 ms per push on the phone). Run with
/// `-- --ignored --nocapture`, and with `--release` for numbers close to the shipped build.
#[test]
#[ignore]
fn perf_7200_pushes() {
    let case = load("process_run_2h").remove(0);
    let fixes = fixes_in(&case.input["fixes"]);
    let cfg = config_in(case.input.get("opts"));
    let mut rec = Recorder::new(&cfg).unwrap();
    let mut worst = std::time::Duration::ZERO;
    let started = std::time::Instant::now();
    for fix in &fixes {
        let t = std::time::Instant::now();
        let r = rec.push_fix(fix).unwrap();
        std::hint::black_box(&r);
        worst = worst.max(t.elapsed());
    }
    let total = started.elapsed();
    eprintln!(
        "{} pushes: mean {:.1} us, max {:.1} us ({})",
        fixes.len(),
        total.as_secs_f64() * 1e6 / fixes.len() as f64,
        worst.as_secs_f64() * 1e6,
        if cfg!(debug_assertions) {
            "test profile: opt-level 2 for qala-core, debug assertions on"
        } else {
            "release profile"
        }
    );
    assert!(
        worst < std::time::Duration::from_millis(5),
        "a push took {worst:?}"
    );
}
