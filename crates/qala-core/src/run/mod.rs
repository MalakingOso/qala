//! The GPS run pipeline: a port of `packages/run` (docs/rust-core.md R1), plus the incremental
//! [`recorder::Recorder`] the phone's foreground service drives with the screen locked.
//!
//! Units follow the TS package: metres, seconds, m/s. `Fix::t` is seconds on the fix source's own
//! monotonic clock, never callback time, so a batch delivered late after screen lock gives the
//! same numbers as on-time delivery.
//!
//! Hard rules (docs/rust-core.md 3): no clock, no `HashMap` iteration order, no panics. Where TS
//! silently drops a non-finite fix (`filter.ts`), the inner types do the same; the JSON boundary
//! in `run_api` rejects non-finite input instead.
//!
//! GPX, TCX and XML export stay in TS (nothing on the phone exports files).

// `!(x > 0.0)` is deliberate throughout: it is the NaN-aware form the TS uses (`!(movingSec > 0)`
// is true for NaN, `movingSec <= 0` is not), and clippy's suggested rewrite changes behaviour.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

pub mod autopause;
pub mod cues;
pub mod filter;
pub mod geo;
pub mod guided;
pub mod pace;
pub mod recorder;
pub mod splits;
mod trig;

pub use recorder::{
    process_run, Live, ProcessedRun, PushResult, Recorder, RecorderConfig, RunEvent,
};

use crate::js::{ser_num, ser_opt_num};
use serde::{Deserialize, Serialize};

/// Why a run function refused its input. The numeric pipeline itself never fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
    /// An option or workout field outside what the pipeline accepts.
    InvalidOption(String),
    /// A fix was pushed after `finish`.
    Finished,
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::InvalidOption(m) => f.write_str(m),
            RunError::Finished => f.write_str("the recorder is finished; no more fixes"),
        }
    }
}

impl std::error::Error for RunError {}

/// One raw GPS fix as captured.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Fix {
    /// Seconds, the fix's own timestamp.
    pub t: f64,
    /// Degrees.
    pub lat: f64,
    /// Degrees.
    pub lon: f64,
    /// Horizontal accuracy in metres (Android's 68% radius, used as one sigma).
    pub acc: f64,
    /// Beats per minute, when a strap is connected.
    #[serde(default)]
    pub hr: Option<f64>,
    /// Steps per minute.
    #[serde(default)]
    pub cad: Option<f64>,
    /// Metres above the ellipsoid. Recorded only; gain comes from the server DEM.
    #[serde(default)]
    pub ele: Option<f64>,
}

/// One accepted fix after filtering, with cumulative Vincenty distance.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredPoint {
    #[serde(serialize_with = "ser_num")]
    pub t: f64,
    #[serde(serialize_with = "ser_num")]
    pub lat: f64,
    #[serde(serialize_with = "ser_num")]
    pub lon: f64,
    /// Filtered speed in m/s (Kalman velocity magnitude).
    #[serde(serialize_with = "ser_num")]
    pub speed_mps: f64,
    /// Cumulative filtered distance in metres.
    #[serde(serialize_with = "ser_num")]
    pub dist_m: f64,
    /// Horizontal accuracy of the raw fix that produced this point.
    #[serde(serialize_with = "ser_num")]
    pub acc: f64,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub hr: Option<f64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub cad: Option<f64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub ele: Option<f64>,
    /// True when the segment from the previous point spans a re-anchor jump and its distance was
    /// not counted.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub gap: bool,
}

impl FilteredPoint {
    /// A bare sample (the `{t, distM}` and `{t, speedMps}` shapes the pace, split and auto-pause
    /// functions read), for callers that do not have a full point.
    pub fn sample(t: f64, dist_m: f64, speed_mps: f64, hr: Option<f64>) -> Self {
        FilteredPoint {
            t,
            lat: 0.0,
            lon: 0.0,
            speed_mps,
            dist_m,
            acc: 0.0,
            hr,
            cad: None,
            ele: None,
            gap: false,
        }
    }
}

/// One auto-paused interval on the fix clock.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseInterval {
    #[serde(serialize_with = "ser_num")]
    pub start_t: f64,
    #[serde(serialize_with = "ser_num")]
    pub end_t: f64,
}

/// One split boundary crossing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    /// 1-based split number.
    pub index: u32,
    /// Length of this split in metres (the split unit, except a trailing partial).
    #[serde(serialize_with = "ser_num")]
    pub dist_m: f64,
    /// Duration of this split in seconds.
    #[serde(serialize_with = "ser_num")]
    pub sec: f64,
    /// Cumulative distance at this boundary in metres.
    #[serde(serialize_with = "ser_num")]
    pub cum_dist_m: f64,
    /// Elapsed seconds from the first fix to this boundary.
    #[serde(serialize_with = "ser_num")]
    pub cum_sec: f64,
    /// Mean HR over the split, when HR samples exist.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub hr_avg: Option<f64>,
}

/// What kind of step a workout step is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkoutStepKind {
    Warmup,
    Work,
    Recover,
    Cooldown,
}

/// One step of a typed run workout (`RunWorkout.steps`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutStep {
    pub kind: WorkoutStepKind,
    /// The step ends after covering this distance (first of distance and seconds wins).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub distance_m: Option<f64>,
    /// The step ends after this many seconds on the run clock (moving time).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub seconds: Option<f64>,
    /// Centre of the pace zone in m/s.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub target_mps: Option<f64>,
    /// Slow edge of the pace zone in m/s.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub pace_lo_mps: Option<f64>,
    /// Fast edge of the pace zone in m/s.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub pace_hi_mps: Option<f64>,
    /// Target HR zone number (HR coaching is not built, DECISIONS R6).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub hr_zone: Option<f64>,
    /// Execute this step this many times in a row (default 1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num"
    )]
    pub repeat: Option<f64>,
}

/// Typed run workout. The `type` and `name` fields of the TS object are carried by callers; the
/// machine only reads the steps.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RunWorkout {
    pub steps: Vec<WorkoutStep>,
}
