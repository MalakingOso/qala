//! Golden tests for the engine port: every case in `testdata/golden/engine/*.json`, produced by
//! the TS engine, must be reproduced by `qala_core::engine`.
//!
//! The shape of each file is documented in `testdata/golden/engine/README.md`. Cases are
//! compared as parsed JSON: floats with the case `tolerance` (relative, plus the README's
//! absolute floor), everything else exactly, object key order ignored. The goldens write
//! non-finite numbers as the strings "NaN", "Infinity" and "-Infinity"; inputs are revived to
//! real non-finite `f64`s and outputs are written back the same way before comparing.

use qala_core::engine::decay::{
    apply_input, decay_record, decay_value, muscle_tau, TAU_DAMAGE, TAU_FITNESS_LIFT,
    TAU_FITNESS_RUN, TAU_SYSTEMIC,
};
use qala_core::engine::e1rm::{best_observation, observe_set, rts_lookup, E1rmObservation};
use qala_core::engine::kalman::{init_kalman, kalman_predict, kalman_update, theta_of};
use qala_core::engine::readiness::{fatigue_local, predict_readiness};
use qala_core::engine::running::{
    critical_speed, descent_damage, gap_factor, intensity_factor, mean_gap_factor, minetti_cost,
    minetti_ratio, ngp, rbe_factor, riegel, rtss, run_set_equivalents, run_zone, srpe_load_ratio,
    vdot_from_effort, SRPE_PER_100_RTSS_PRIOR,
};
use qala_core::engine::session::{calibrate, log_session};
use qala_core::engine::state::{
    BestEffort, Checkin, EngineState, GradeSegment, KalmanState, SetLog, SrpeRtssPair, Workout,
};
use qala_core::time::days_between;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

const DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/golden/engine/");

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
// Reviving inputs and writing outputs
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

fn req_num(obj: &Value, key: &str) -> f64 {
    num(obj.get(key).unwrap_or_else(|| panic!("missing {key}")))
}

fn text<'a>(obj: &'a Value, key: &str) -> &'a str {
    obj.get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing string {key}"))
}

fn flag(obj: &Value, key: &str) -> bool {
    obj.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// The canon form of a number: non-finite values become strings, as in the goldens.
fn out_num(x: f64) -> Value {
    if x.is_nan() {
        json!("NaN")
    } else if x == f64::INFINITY {
        json!("Infinity")
    } else if x == f64::NEG_INFINITY {
        json!("-Infinity")
    } else {
        json!(x)
    }
}

fn out_opt(x: Option<f64>) -> Value {
    x.map_or(Value::Null, out_num)
}

fn set_log(v: &Value) -> SetLog {
    SetLog {
        w: req_num(v, "w"),
        r: req_num(v, "r"),
        rpe: opt_num(v, "rpe"),
        target_rpe: opt_num(v, "targetRpe"),
        target_reps_min: opt_num(v, "targetRepsMin"),
        target_reps_max: opt_num(v, "targetRepsMax"),
        completed: flag(v, "completed"),
        warmup: flag(v, "warmup"),
        tested1rm: flag(v, "tested1rm"),
        joint_pain: flag(v, "jointPain"),
    }
}

fn kalman_in(v: &Value) -> KalmanState {
    let rows = v["P"].as_array().expect("P rows");
    let mut p = [[0.0; 3]; 3];
    for (i, row) in rows.iter().enumerate() {
        for (j, x) in row.as_array().expect("P row").iter().enumerate() {
            p[i][j] = num(x);
        }
    }
    KalmanState {
        p0: req_num(v, "p0"),
        k1: req_num(v, "k1"),
        k2: req_num(v, "k2"),
        theta_prior: req_num(v, "thetaPrior"),
        p,
        obs: req_num(v, "obs"),
        r: req_num(v, "R"),
    }
}

fn kalman_out(k: &KalmanState) -> Value {
    let p: Vec<Value> =
        k.p.iter()
            .map(|row| Value::Array(row.iter().map(|x| out_num(*x)).collect()))
            .collect();
    json!({
        "p0": out_num(k.p0), "k1": out_num(k.k1), "k2": out_num(k.k2),
        "thetaPrior": out_num(k.theta_prior), "P": p, "obs": out_num(k.obs), "R": out_num(k.r),
    })
}

fn observation_out(o: Option<E1rmObservation>) -> Value {
    match o {
        None => Value::Null,
        Some(o) => json!({ "e1rm": out_num(o.e1rm), "tested": o.tested }),
    }
}

fn efforts_in(v: &Value) -> Vec<BestEffort> {
    v.as_array()
        .expect("efforts")
        .iter()
        .map(|e| BestEffort {
            distance_m: req_num(e, "distanceM"),
            seconds: req_num(e, "seconds"),
            date: text(e, "date").to_string(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Tol {
    /// Bit-for-bit equal doubles.
    Exact,
    /// The README rule: `a == e || |a - e| <= t * max(|a|, |e|) + 1e-12`.
    Rel(f64),
}

fn numbers_match(a: f64, e: f64, tol: Tol) -> bool {
    if a == e || (a.is_nan() && e.is_nan()) {
        return true;
    }
    match tol {
        Tol::Exact => false,
        Tol::Rel(t) => (a - e).abs() <= t * a.abs().max(e.abs()) + 1e-12,
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

/// Runs `run` on every case of `file` and checks the result. Returns after reporting all
/// failures at once.
fn run_file(file: &str, tol_override: Option<Tol>, run: impl Fn(&Case) -> Result<Value, String>) {
    let cases = load(file);
    let mut failures: Vec<String> = Vec::new();
    let mut failed_cases = 0;
    for case in &cases {
        let tol = tol_override.unwrap_or(match case.tolerance {
            Some(t) => Tol::Rel(t),
            None => Tol::Exact,
        });
        let outcome = catch_unwind(AssertUnwindSafe(|| run(case)));
        let mut errs = Vec::new();
        match outcome {
            Ok(Ok(actual)) => compare("$", &case.expected, &actual, tol, &mut errs),
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
    eprintln!("{file}.json: {} cases ok", cases.len());
}

fn args(case: &Case) -> &Value {
    &case.input["args"]
}

fn fn_name(case: &Case) -> &str {
    case.input["fn"].as_str().expect("input.fn")
}

// ---------------------------------------------------------------------------
// decay.json
// ---------------------------------------------------------------------------

fn run_decay(case: &Case) -> Result<Value, String> {
    let a = args(case);
    Ok(match fn_name(case) {
        "daysBetween" => {
            out_num(days_between(text(a, "aIso"), text(a, "bIso")).map_err(|e| e.to_string())?)
        }
        "decayValue" => out_num(decay_value(
            req_num(a, "x"),
            req_num(a, "dtDays"),
            req_num(a, "tau"),
        )),
        "applyInput" => out_num(apply_input(
            req_num(a, "x"),
            req_num(a, "dtDays"),
            req_num(a, "tau"),
            req_num(a, "k"),
            req_num(a, "input"),
        )),
        "muscleTau" => out_num(muscle_tau(text(a, "muscle"))),
        "decayRecord" => {
            let rec: BTreeMap<String, f64> = a["rec"]
                .as_object()
                .expect("rec")
                .iter()
                .map(|(k, v)| (k.clone(), num(v)))
                .collect();
            let dt = req_num(a, "dtDays");
            let out = match &a["tauFor"] {
                Value::String(s) if s == "muscleTau" => decay_record(&rec, dt, muscle_tau),
                other => {
                    let tau = num(other);
                    decay_record(&rec, dt, |_| tau)
                }
            };
            Value::Object(
                out.into_iter()
                    .map(|(k, v)| (k, out_num(v)))
                    .collect::<Map<_, _>>(),
            )
        }
        "TAU_CONSTANTS" => json!({
            "TAU_FITNESS_LIFT": TAU_FITNESS_LIFT, "TAU_SYSTEMIC": TAU_SYSTEMIC,
            "TAU_FITNESS_RUN": TAU_FITNESS_RUN, "TAU_DAMAGE": TAU_DAMAGE,
        }),
        other => return Err(format!("unknown decay fn {other}")),
    })
}

#[test]
fn golden_decay() {
    run_file("decay", None, run_decay);
}

// ---------------------------------------------------------------------------
// e1rm.json
// ---------------------------------------------------------------------------

fn run_e1rm(case: &Case) -> Result<Value, String> {
    let a = args(case);
    Ok(match fn_name(case) {
        "observeSet" => observation_out(observe_set(&set_log(&a["s"]))),
        "bestObservation" => {
            let sets: Vec<SetLog> = a["sets"]
                .as_array()
                .expect("sets")
                .iter()
                .map(set_log)
                .collect();
            observation_out(best_observation(&sets))
        }
        "rtsLookup" => {
            let l = rts_lookup(req_num(a, "reps"), req_num(a, "rpe"));
            json!({ "pct": out_opt(l.pct), "verified": l.verified, "useRule3Fallback": l.use_rule3_fallback })
        }
        other => return Err(format!("unknown e1rm fn {other}")),
    })
}

#[test]
fn golden_e1rm() {
    run_file("e1rm", None, run_e1rm);
}

// ---------------------------------------------------------------------------
// kalman.json
// ---------------------------------------------------------------------------

fn run_kalman(case: &Case) -> Result<Value, String> {
    let a = args(case);
    Ok(match fn_name(case) {
        "initKalman" => kalman_out(&init_kalman(
            req_num(a, "p0"),
            req_num(a, "k1"),
            req_num(a, "thetaPrior"),
            opt_num(a, "R").unwrap_or(4.0),
        )),
        "kalmanUpdate" => kalman_out(&kalman_update(
            &kalman_in(&a["k"]),
            req_num(a, "fitness"),
            req_num(a, "fatigue"),
            req_num(a, "y"),
            opt_num(a, "noiseScale").unwrap_or(1.0),
        )),
        "kalmanPredict" => out_num(kalman_predict(
            &kalman_in(&a["k"]),
            req_num(a, "fitness"),
            req_num(a, "fatigue"),
        )),
        "thetaOf" => out_num(theta_of(&kalman_in(&a["k"]))),
        other => return Err(format!("unknown kalman fn {other}")),
    })
}

#[test]
fn golden_kalman() {
    run_file("kalman", None, run_kalman);
}

/// Kalman uses only `+ - * /`, so with the TS operation order the doubles are identical to the
/// last bit (the README says so). A drift here means the order of operations changed.
#[test]
fn golden_kalman_is_bit_exact() {
    run_file("kalman", Some(Tol::Exact), run_kalman);
}

/// The `... step NN` cases form chains where each step starts from the previous TS result.
/// Feed the Rust result of step n into step n+1 instead and check every step, so a rounding
/// difference cannot hide behind the tolerance by being reset at each step.
#[test]
fn golden_kalman_chains_carry_rust_state() {
    let cases = load("kalman");
    let mut chains: BTreeMap<String, Vec<&Case>> = BTreeMap::new();
    for c in &cases {
        if fn_name(c) == "kalmanUpdate" {
            if let Some((prefix, _)) = c.name.split_once(" step ") {
                chains.entry(prefix.to_string()).or_default().push(c);
            }
        }
    }
    assert!(
        chains.len() >= 5,
        "expected the five documented chains, found {}",
        chains.len()
    );
    let mut errs = Vec::new();
    for (prefix, steps) in &chains {
        let mut state: Option<KalmanState> = None;
        for c in steps {
            let a = args(c);
            let k = state.take().unwrap_or_else(|| kalman_in(&a["k"]));
            let next = kalman_update(
                &k,
                req_num(a, "fitness"),
                req_num(a, "fatigue"),
                req_num(a, "y"),
                opt_num(a, "noiseScale").unwrap_or(1.0),
            );
            compare(
                &c.name,
                &c.expected,
                &kalman_out(&next),
                Tol::Rel(1e-9),
                &mut errs,
            );
            state = Some(next);
        }
        eprintln!("chain {prefix:?}: {} steps", steps.len());
    }
    assert!(
        errs.is_empty(),
        "{}",
        errs.iter().take(40).cloned().collect::<Vec<_>>().join("\n")
    );
}

// ---------------------------------------------------------------------------
// running.json
// ---------------------------------------------------------------------------

fn run_running(case: &Case) -> Result<Value, String> {
    let a = args(case);
    Ok(match fn_name(case) {
        "minettiCost" => out_num(minetti_cost(req_num(a, "grade"))),
        "minettiRatio" => out_num(minetti_ratio(req_num(a, "grade"))),
        "gapFactor" => out_num(gap_factor(req_num(a, "grade"))),
        "ngp" => out_num(ngp(req_num(a, "speedMps"), req_num(a, "grade"))),
        "meanGapFactor" => {
            let profile: Option<Vec<GradeSegment>> = a.get("profile").map(|p| {
                p.as_array()
                    .expect("profile")
                    .iter()
                    .map(|s| GradeSegment {
                        grade: req_num(s, "grade"),
                        meters: req_num(s, "meters"),
                    })
                    .collect()
            });
            out_num(mean_gap_factor(profile.as_deref()))
        }
        "intensityFactor" => out_num(intensity_factor(
            req_num(a, "ngpMps"),
            req_num(a, "thresholdPaceMps"),
        )),
        "rtss" => out_num(rtss(req_num(a, "hours"), req_num(a, "IF"))),
        "vdotFromEffort" => out_num(vdot_from_effort(
            req_num(a, "distanceM"),
            req_num(a, "seconds"),
        )),
        "riegel" => out_num(riegel(
            req_num(a, "seconds1"),
            req_num(a, "d1"),
            req_num(a, "d2"),
        )),
        "criticalSpeed" => out_opt(
            critical_speed(&efforts_in(&a["efforts"]), text(a, "nowIso"))
                .map_err(|e| e.to_string())?,
        ),
        "runZone" => out_num(run_zone(req_num(a, "ngpMps"), req_num(a, "csMps"))),
        "runSetEquivalents" => {
            let e = run_set_equivalents(req_num(a, "km"), req_num(a, "z"));
            json!({
                "quads": out_num(e.quads), "calves": out_num(e.calves),
                "glutes": out_num(e.glutes), "hamstrings": out_num(e.hamstrings),
            })
        }
        "rbeFactor" => out_num(rbe_factor(req_num(a, "n"))),
        "descentDamage" => {
            let d = descent_damage(req_num(a, "descentM"), req_num(a, "rbe"));
            json!({ "quads": out_num(d.quads), "calves": out_num(d.calves) })
        }
        "srpeLoadRatio" => {
            let pairs: Vec<SrpeRtssPair> = a["pairs"]
                .as_array()
                .expect("pairs")
                .iter()
                .map(|p| SrpeRtssPair {
                    srpe_load: req_num(p, "srpeLoad"),
                    r_tss: req_num(p, "rTSS"),
                })
                .collect();
            out_num(srpe_load_ratio(&pairs))
        }
        "SRPE_PER_100_RTSS_PRIOR" => out_num(SRPE_PER_100_RTSS_PRIOR),
        other => return Err(format!("unknown running fn {other}")),
    })
}

#[test]
fn golden_running() {
    run_file("running", None, run_running);
}

// ---------------------------------------------------------------------------
// log_session.json
// ---------------------------------------------------------------------------

fn from_golden<T: serde::de::DeserializeOwned>(v: &Value, what: &str) -> Result<T, String> {
    serde_json::from_value(v.clone()).map_err(|e| format!("cannot read {what}: {e}"))
}

fn to_golden<T: serde::Serialize>(v: &T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| format!("cannot write result: {e}"))
}

/// Input `{state, workout}`, expected: the `EngineState` after `logSession`.
fn run_log_session(case: &Case) -> Result<Value, String> {
    let state: EngineState = from_golden(&case.input["state"], "state")?;
    let workout: Workout = from_golden(&case.input["workout"], "workout")?;
    let next = log_session(&state, &workout).map_err(|e| e.to_string())?;
    to_golden(&next)
}

#[test]
fn golden_log_session() {
    run_file("log_session", None, run_log_session);
}

// ---------------------------------------------------------------------------
// calibrate.json
// ---------------------------------------------------------------------------

/// Input `{history}`, expected: the `EngineState` after `calibrate`. The shuffled variants
/// check the chronological sort and its stability on identical instants.
fn run_calibrate(case: &Case) -> Result<Value, String> {
    let history: Vec<Workout> = from_golden(&case.input["history"], "history")?;
    let state = calibrate(&history).map_err(|e| e.to_string())?;
    to_golden(&state)
}

#[test]
fn golden_calibrate() {
    run_file("calibrate", None, run_calibrate);
}

// ---------------------------------------------------------------------------
// fatigue_local.json, readiness.json, readiness_decay.json
// ---------------------------------------------------------------------------

/// Input `{gm}`, expected: a number (NaN propagates, as `Math.min` and `Math.max` do).
fn run_fatigue_local(case: &Case) -> Result<Value, String> {
    Ok(out_num(fatigue_local(req_num(&case.input, "gm"))))
}

#[test]
fn golden_fatigue_local() {
    run_file("fatigue_local", None, run_fatigue_local);
}

/// Which session muscles a readiness case runs with.
#[derive(Clone, Copy)]
enum Muscles {
    /// `sessionMuscles` when present, else the soreness keys in the file's own key order,
    /// which is the insertion order TS uses for `Object.keys` (the goldens do not sort them).
    AsInTs,
    /// `sessionMuscles` when present, else `None`: the Rust default of sorted soreness keys.
    RustDefault,
}

/// Input `{state, checkin, now, sessionMuscles?}`, expected: the `Readiness`. For
/// `readiness.json` `now` equals `state.updated`; `readiness_decay.json` decays to `now`.
fn run_readiness(case: &Case, muscles: Muscles) -> Result<Value, String> {
    let state: EngineState = from_golden(&case.input["state"], "state")?;
    let checkin: Checkin = from_golden(&case.input["checkin"], "checkin")?;
    let now = text(&case.input, "now");
    let explicit: Option<Vec<String>> = match case.input.get("sessionMuscles") {
        Some(v) => Some(from_golden(v, "sessionMuscles")?),
        None => match muscles {
            Muscles::AsInTs => Some(
                case.input["checkin"]["soreness"]
                    .as_object()
                    .map(|o| o.keys().cloned().collect())
                    .unwrap_or_default(),
            ),
            Muscles::RustDefault => None,
        },
    };
    let r =
        predict_readiness(&state, &checkin, explicit.as_deref(), now).map_err(|e| e.to_string())?;
    to_golden(&r)
}

#[test]
fn golden_readiness() {
    run_file("readiness", None, |c| run_readiness(c, Muscles::AsInTs));
}

#[test]
fn golden_readiness_decay() {
    run_file("readiness_decay", None, |c| {
        run_readiness(c, Muscles::AsInTs)
    });
}

/// Without `sessionMuscles` Rust uses the sorted soreness keys. That only changes the order
/// of a float sum and of the muscles named in the `sore-blocked:` reason, so it must still
/// land inside the tolerance on every golden case that omits the list.
#[test]
fn golden_readiness_with_rust_default_muscle_order() {
    for file in ["readiness", "readiness_decay"] {
        let omitted = |c: &Case| c.input.get("sessionMuscles").is_none();
        let cases: Vec<Case> = load(file).into_iter().filter(omitted).collect();
        assert!(
            !cases.is_empty(),
            "{file}.json has no case without sessionMuscles"
        );
        let mut errs = Vec::new();
        for c in &cases {
            let actual = run_readiness(c, Muscles::RustDefault).expect("readiness");
            let mut e = Vec::new();
            compare(
                "$",
                &c.expected,
                &actual,
                Tol::Rel(c.tolerance.unwrap_or(1e-9)),
                &mut e,
            );
            errs.extend(e.into_iter().map(|e| format!("{file}: {:?}: {e}", c.name)));
        }
        assert!(errs.is_empty(), "{}", errs.join("\n"));
        eprintln!(
            "{file}.json: {} cases without sessionMuscles ok with sorted keys",
            cases.len()
        );
    }
}

// ---------------------------------------------------------------------------
// The comparator itself
// ---------------------------------------------------------------------------

#[test]
fn comparator_rules() {
    let check = |g: Value, a: Value, tol: Tol| {
        let mut errs = Vec::new();
        compare("$", &g, &a, tol, &mut errs);
        errs.len()
    };
    let rel = Tol::Rel(1e-9);
    assert_eq!(check(json!(1), json!(1.0), Tol::Exact), 0);
    assert_eq!(check(json!(1.000000002), json!(1.0), rel), 1);
    assert_eq!(check(json!(1.000000002), json!(1.0), Tol::Rel(1e-6)), 0);
    assert_eq!(check(json!(1e-13), json!(0), rel), 0); // absolute floor
    assert_eq!(check(json!(1e-11), json!(0), rel), 1);
    assert_eq!(check(json!(1.5), json!(1.5000000000000002), Tol::Exact), 1);
    assert_eq!(check(json!("NaN"), json!(null), rel), 0);
    assert_eq!(check(json!("NaN"), json!(1), rel), 1);
    assert_eq!(check(json!(null), json!(null), rel), 0);
    assert_eq!(check(json!(null), json!(0), rel), 1);
    assert_eq!(
        check(
            json!({"a": 1, "b": [1, 2]}),
            json!({"b": [1, 2], "a": 1}),
            Tol::Exact
        ),
        0
    );
    assert_eq!(
        check(json!({"a": 1}), json!({"a": 1, "b": 2}), Tol::Exact),
        1
    );
    assert_eq!(
        check(json!({"a": 1, "b": 2}), json!({"a": 1}), Tol::Exact),
        1
    );
    assert_eq!(check(json!([1, 2]), json!([1, 2, 3]), Tol::Exact), 1);
    assert_eq!(check(json!([1, 2]), json!([2, 1]), Tol::Exact), 2);
    assert_eq!(check(json!("a"), json!("b"), Tol::Exact), 1);
    assert_eq!(check(json!(true), json!(false), Tol::Exact), 1);
    // The readiness runner relies on parsed objects keeping the file's key order.
    let ordered: Value = serde_json::from_str(r#"{"b":1,"a":2}"#).unwrap();
    assert_eq!(
        ordered
            .as_object()
            .unwrap()
            .keys()
            .next()
            .map(String::as_str),
        Some("b")
    );
    assert!(num(&json!("NaN")).is_nan());
    assert_eq!(out_num(f64::NEG_INFINITY), json!("-Infinity"));
}
