//! JSON boundary for the run pipeline, in the style of `api.rs`: one request string in, the
//! envelope `{"v":1,"result":...}` out. The batch call is stateless; the recorder is the first
//! stateful export (DECISIONS S6 said state in, state out), so these functions take the
//! [`Recorder`] the shim keeps behind a mutex.
//!
//! Requests (camelCase, like the TS options):
//!
//! - `process_run`: `{v, fixes: [Fix], opts?: Opts}` -> `ProcessedRun`.
//! - `recorder_new`: `{v, opts?: Opts}`.
//! - `recorder_push_fix`: `{v, t, lat, lon, acc, hr?, cad?, ele?}` -> `{events, live}`. One fix per
//!   call, so a push costs microseconds and nothing columnar crosses the boundary (recovery
//!   replays fix by fix; add a byte array only if that measures slow).
//! - `recorder_advance`: `{v}` -> `{events, live}`; `recorder_finish`: `{v}` -> `ProcessedRun`.
//!
//! `Opts` is `{filter?, autopause?, splits?, splitM?, workout?, guided?, cues?}`: `filter` is
//! `{accuracyGateM?, speedGateMps?, reanchorCount?, accelNoise?}`, `autopause` is `{lowMps?,
//! lowHoldSec?, highMps?, highHoldSec?}`, `splits` is `{splitM?, minPartialM?}` (`splitM` beside it
//! is the shorthand that wins), `workout` is `{steps: [{kind, distanceM?, seconds?, targetMps?,
//! paceLoMps?, paceHiMps?, hrZone?, repeat?}]}`, `guided` is `{toleranceMps?, promptCooldownSec?}`
//! and `cues` is `{everyDistM?, everySec?}` (metres and moving seconds; the app converts the
//! user's mile setting). Unknown keys in `Opts` and its sections are an error, so a typo cannot
//! silently fall back to a default.
//!
//! Errors: a malformed request or an option the pipeline refuses is `InvalidInput`; a non-finite
//! number in a fix, a bad option value, or a push after `finish` is `Evaluation`. Where TS drops a
//! non-finite fix, this boundary rejects it (docs/rust-core.md 3).

use crate::api::{parse_request, respond, ApiError, ApiResult};
use crate::run::autopause::AutoPauseOptions;
use crate::run::cues::CueConfig;
use crate::run::filter::FilterOptions;
use crate::run::guided::GuidedOptions;
use crate::run::splits::{valid_split_m, SplitOptions};
use crate::run::{process_run as run_batch, Fix, Recorder, RecorderConfig, RunError, RunWorkout};
use serde::Deserialize;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilterReq {
    accuracy_gate_m: Option<f64>,
    speed_gate_mps: Option<f64>,
    reanchor_count: Option<u32>,
    accel_noise: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AutoPauseReq {
    low_mps: Option<f64>,
    low_hold_sec: Option<f64>,
    high_mps: Option<f64>,
    high_hold_sec: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SplitsReq {
    split_m: Option<f64>,
    min_partial_m: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GuidedReq {
    tolerance_mps: Option<f64>,
    prompt_cooldown_sec: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CuesReq {
    every_dist_m: Option<f64>,
    every_sec: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OptsReq {
    filter: Option<FilterReq>,
    autopause: Option<AutoPauseReq>,
    splits: Option<SplitsReq>,
    split_m: Option<f64>,
    workout: Option<RunWorkout>,
    guided: Option<GuidedReq>,
    cues: Option<CuesReq>,
}

#[derive(Deserialize)]
struct ProcessRunReq {
    fixes: Vec<Fix>,
    #[serde(default)]
    opts: Option<OptsReq>,
}

#[derive(Deserialize)]
struct RecorderNewReq {
    #[serde(default)]
    opts: Option<OptsReq>,
}

fn run_err(e: RunError) -> ApiError {
    match e {
        RunError::InvalidOption(m) => ApiError::InvalidInput(m),
        RunError::Finished => ApiError::Evaluation(e.to_string()),
    }
}

fn finite(name: &str, v: Option<f64>) -> Result<Option<f64>, ApiError> {
    match v {
        Some(x) if !x.is_finite() => Err(ApiError::Evaluation(format!(
            "{name} must be a finite number, got {x}"
        ))),
        other => Ok(other),
    }
}

fn check_fix(fix: &Fix) -> Result<(), ApiError> {
    for (name, v) in [
        ("t", fix.t),
        ("lat", fix.lat),
        ("lon", fix.lon),
        ("acc", fix.acc),
    ] {
        if !v.is_finite() {
            return Err(ApiError::Evaluation(format!(
                "fix.{name} must be a finite number, got {v}"
            )));
        }
    }
    finite("fix.hr", fix.hr)?;
    finite("fix.cad", fix.cad)?;
    finite("fix.ele", fix.ele)?;
    Ok(())
}

fn build_config(opts: Option<OptsReq>) -> Result<RecorderConfig, ApiError> {
    let o = opts.unwrap_or_default();
    let f = o.filter.unwrap_or_default();
    let a = o.autopause.unwrap_or_default();
    let s = o.splits.unwrap_or_default();
    let g = o.guided.unwrap_or_default();
    let c = o.cues.unwrap_or_default();
    // `splitM` beside `splits` is the TS shorthand and wins over `splits.splitM`.
    let split_m = finite("splitM", o.split_m.or(s.split_m))?;
    if let Some(m) = split_m {
        if !valid_split_m(m) {
            return Err(ApiError::InvalidInput(format!(
                "splitM must be at least 1 metre, got {m}"
            )));
        }
    }
    let workout = match o.workout {
        Some(w) => {
            for (i, st) in w.steps.iter().enumerate() {
                for (name, v) in [
                    ("distanceM", st.distance_m),
                    ("seconds", st.seconds),
                    ("targetMps", st.target_mps),
                    ("paceLoMps", st.pace_lo_mps),
                    ("paceHiMps", st.pace_hi_mps),
                    ("hrZone", st.hr_zone),
                    ("repeat", st.repeat),
                ] {
                    finite(&format!("workout.steps[{i}].{name}"), v)?;
                }
            }
            Some(w)
        }
        None => None,
    };
    Ok(RecorderConfig {
        filter: FilterOptions {
            accuracy_gate_m: finite("filter.accuracyGateM", f.accuracy_gate_m)?,
            speed_gate_mps: finite("filter.speedGateMps", f.speed_gate_mps)?,
            reanchor_count: f.reanchor_count,
            accel_noise: finite("filter.accelNoise", f.accel_noise)?,
        },
        autopause: AutoPauseOptions {
            low_mps: finite("autopause.lowMps", a.low_mps)?,
            low_hold_sec: finite("autopause.lowHoldSec", a.low_hold_sec)?,
            high_mps: finite("autopause.highMps", a.high_mps)?,
            high_hold_sec: finite("autopause.highHoldSec", a.high_hold_sec)?,
        },
        splits: SplitOptions {
            split_m,
            min_partial_m: finite("splits.minPartialM", s.min_partial_m)?,
        },
        workout,
        guided: GuidedOptions {
            tolerance_mps: finite("guided.toleranceMps", g.tolerance_mps)?,
            prompt_cooldown_sec: finite("guided.promptCooldownSec", g.prompt_cooldown_sec)?,
        },
        cues: CueConfig {
            every_dist_m: finite("cues.everyDistM", c.every_dist_m)?,
            every_sec: finite("cues.everySec", c.every_sec)?,
        },
    })
}

/// `{v, fixes, opts?}` -> the batch `ProcessedRun` (push every fix, then finish).
pub fn process_run(request: &str) -> ApiResult {
    let r: ProcessRunReq = parse_request(request)?;
    for fix in &r.fixes {
        check_fix(fix)?;
    }
    let cfg = build_config(r.opts)?;
    let run = run_batch(&r.fixes, &cfg).map_err(run_err)?;
    respond(&run)
}

/// `{v, opts?}` -> a new recorder.
pub fn recorder_new(request: &str) -> Result<Recorder, ApiError> {
    let r: RecorderNewReq = parse_request(request)?;
    let cfg = build_config(r.opts)?;
    Recorder::new(&cfg).map_err(run_err)
}

/// One raw fix (`{v, t, lat, lon, acc, hr?, cad?, ele?}`) -> `{events, live}`.
pub fn recorder_push_fix(rec: &mut Recorder, request: &str) -> ApiResult {
    let fix: Fix = parse_request(request)?;
    check_fix(&fix)?;
    respond(&rec.push_fix(&fix).map_err(run_err)?)
}

/// End the current guided step by hand: `{events, live}`.
pub fn recorder_advance(rec: &mut Recorder) -> ApiResult {
    respond(&rec.advance().map_err(run_err)?)
}

/// Close the run: the batch `ProcessedRun` over everything pushed. Pushing afterwards is an error.
pub fn recorder_finish(rec: &mut Recorder) -> ApiResult {
    respond(&rec.finish().map_err(run_err)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn fixes(n: usize) -> Vec<Value> {
        (0..n)
            .map(|i| json!({"t": i as f64, "lat": 47.6062 + 3.0 * i as f64 / 111319.49, "lon": -122.3321, "acc": 3}))
            .collect()
    }

    fn result(s: &str) -> Value {
        let v: Value = serde_json::from_str(s).unwrap();
        assert_eq!(v["v"], json!(1));
        v["result"].clone()
    }

    #[test]
    fn process_run_returns_the_envelope() {
        let req = json!({"v": 1, "fixes": fixes(60), "opts": {"splitM": 100}});
        let out = result(&process_run(&req.to_string()).unwrap());
        assert_eq!(out["points"].as_array().unwrap().len(), 60);
        assert!(out["distanceM"].as_f64().unwrap() > 170.0);
        assert_eq!(out["splits"].as_array().unwrap().len(), 2);
        assert_eq!(out["guidedEvents"], json!([]));
        assert!(out["currentSpeedMps"].is_number());
    }

    #[test]
    fn the_recorder_flows_through_json_and_matches_the_batch() {
        let fx = fixes(90);
        let opts = json!({"workout": {"type": "tempo", "steps": [
            {"kind": "warmup", "seconds": 20}, {"kind": "work", "seconds": 30}, {"kind": "cooldown"}]},
            "cues": {"everyDistM": 100}});
        let mut rec = recorder_new(&json!({"v": 1, "opts": opts}).to_string()).unwrap();
        let mut events: Vec<Value> = Vec::new();
        let mut last = Value::Null;
        for f in &fx {
            let mut req = f.clone();
            req["v"] = json!(1);
            let out = result(&recorder_push_fix(&mut rec, &req.to_string()).unwrap());
            events.extend(out["events"].as_array().unwrap().iter().cloned());
            last = out["live"].clone();
        }
        assert_eq!(last["points"], json!(90));
        assert_eq!(last["step"]["step"]["index"], json!(2));
        let adv = result(&recorder_advance(&mut rec).unwrap());
        events.extend(adv["events"].as_array().unwrap().iter().cloned());
        let run = result(&recorder_finish(&mut rec).unwrap());
        // The guided events of the finished run are the guided events pushed, in order; the
        // distance cues are their own stream.
        let pushed_guided: Vec<&Value> = events
            .iter()
            .filter(|e| e["type"] != "distanceCue" && e["type"] != "timeCue")
            .collect();
        let finished: Vec<&Value> = run["guidedEvents"].as_array().unwrap().iter().collect();
        assert_eq!(pushed_guided, finished);
        assert!(events.iter().any(|e| e["type"] == "distanceCue"));
        // Same run through the batch call.
        let batch =
            result(&process_run(&json!({"v": 1, "fixes": fx, "opts": opts}).to_string()).unwrap());
        assert_eq!(batch["points"], run["points"]);
        assert!(recorder_push_fix(
            &mut rec,
            &json!({"v": 1, "t": 99, "lat": 1, "lon": 1, "acc": 1}).to_string()
        )
        .is_err());
    }

    #[test]
    fn errors_are_typed() {
        for bad in ["", "nope", "{}", "{\"v\":9}", "{\"v\":1}"] {
            assert!(
                matches!(process_run(bad), Err(ApiError::InvalidInput(_))),
                "{bad:?}"
            );
        }
        let with = |opts: Value| json!({"v": 1, "fixes": [], "opts": opts}).to_string();
        // A typo in an option name is not ignored.
        assert!(matches!(
            process_run(&with(json!({"fliter": {}}))),
            Err(ApiError::InvalidInput(_))
        ));
        assert!(matches!(
            process_run(&with(json!({"filter": {"reanchorCount": 0}}))),
            Err(ApiError::InvalidInput(_))
        ));
        assert!(matches!(
            process_run(&with(json!({"splitM": 0.5}))),
            Err(ApiError::InvalidInput(_))
        ));
        assert!(matches!(
            process_run(&with(
                json!({"workout": {"steps": [{"kind": "work", "repeat": 1e9}]}})
            )),
            Err(ApiError::InvalidInput(_))
        ));
        assert!(matches!(
            process_run(&with(json!({"workout": {"steps": [{"kind": "jog"}]}}))),
            Err(ApiError::InvalidInput(_))
        ));
        assert!(matches!(
            process_run(&with(json!({"cues": {"everySec": -5}}))),
            Err(ApiError::InvalidInput(_))
        ));
        // A missing required fix field.
        let missing = json!({"v": 1, "fixes": [{"t": 1, "lat": 2, "lon": 3}]}).to_string();
        assert!(matches!(
            process_run(&missing),
            Err(ApiError::InvalidInput(_))
        ));
    }

    #[test]
    fn non_finite_numbers_are_rejected_not_dropped() {
        let nan = Fix {
            t: f64::NAN,
            lat: 1.0,
            lon: 1.0,
            acc: 1.0,
            hr: None,
            cad: None,
            ele: None,
        };
        assert!(matches!(check_fix(&nan), Err(ApiError::Evaluation(_))));
        let inf = Fix {
            t: 1.0,
            lat: 1.0,
            lon: 1.0,
            acc: 1.0,
            hr: Some(f64::INFINITY),
            cad: None,
            ele: None,
        };
        assert!(matches!(check_fix(&inf), Err(ApiError::Evaluation(_))));
        assert!(matches!(
            finite("x", Some(f64::NAN)),
            Err(ApiError::Evaluation(_))
        ));
        // JSON cannot carry them: serde_json refuses the literal and out-of-range numbers.
        assert!(matches!(
            process_run("{\"v\":1,\"fixes\":[{\"t\":1e999,\"lat\":1,\"lon\":1,\"acc\":1}]}"),
            Err(ApiError::InvalidInput(_))
        ));
    }
}
