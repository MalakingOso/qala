//! Auto-pause: `packages/run/autopause.ts`. Below 0.6 m/s held 5 s pauses; above 1.0 m/s held
//! 3 s resumes. Paused time is excluded from moving time, never from elapsed.
//!
//! The pause interval starts retroactively at the first sub-threshold sample and ends at the
//! first above-resume sample, so the still seconds and the 3 s confirmation run-up count as
//! documented: stillness excluded, running included. A run that ends mid-pause closes the
//! interval at the last fix.
//!
//! Also here, new in R1: the causal moving clock ([`causal_moving_sec`], [`CausalClock`]) the
//! guided machine runs on, so a live recorder and the batch pipeline see the same numbers.

use super::{FilteredPoint, PauseInterval};
use crate::js::{js_max, js_min};

/// Optional overrides; `None` keeps the default.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct AutoPauseOptions {
    /// Speed under which the low timer runs (m/s). Default 0.6.
    pub low_mps: Option<f64>,
    /// Seconds under `low_mps` that trigger a pause. Default 5.
    pub low_hold_sec: Option<f64>,
    /// Speed above which the resume timer runs (m/s). Default 1.0.
    pub high_mps: Option<f64>,
    /// Seconds above `high_mps` that resume. Default 3.
    pub high_hold_sec: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PauseState {
    Moving,
    Paused,
}

/// Streaming state machine. Feed samples in timestamp order.
#[derive(Debug, Clone)]
pub struct AutoPause {
    low_mps: f64,
    low_hold_sec: f64,
    high_mps: f64,
    high_hold_sec: f64,

    state: PauseState,
    low_start: Option<f64>,
    high_start: Option<f64>,
    pause_start: f64,
    last_t: f64,
    intervals: Vec<PauseInterval>,
}

impl AutoPause {
    pub fn new(opts: &AutoPauseOptions) -> Self {
        AutoPause {
            low_mps: opts.low_mps.unwrap_or(0.6),
            low_hold_sec: opts.low_hold_sec.unwrap_or(5.0),
            high_mps: opts.high_mps.unwrap_or(1.0),
            high_hold_sec: opts.high_hold_sec.unwrap_or(3.0),
            state: PauseState::Moving,
            low_start: None,
            high_start: None,
            pause_start: 0.0,
            last_t: f64::NEG_INFINITY,
            intervals: Vec::new(),
        }
    }

    pub fn state(&self) -> PauseState {
        self.state
    }

    /// Start of the open pause, back-dated to the first sub-threshold sample, or `None` while
    /// moving.
    pub fn open_pause_start(&self) -> Option<f64> {
        (self.state == PauseState::Paused).then_some(self.pause_start)
    }

    /// The closed pauses so far.
    pub fn intervals(&self) -> &[PauseInterval] {
        &self.intervals
    }

    pub fn update(&mut self, t: f64, speed_mps: f64) -> PauseState {
        if t > self.last_t {
            self.last_t = t;
        }
        if self.state == PauseState::Moving {
            if speed_mps < self.low_mps {
                if self.low_start.is_none() {
                    self.low_start = Some(t);
                }
                let low_start = self.low_start.unwrap_or(t);
                if t - low_start >= self.low_hold_sec {
                    self.state = PauseState::Paused;
                    self.pause_start = low_start;
                    self.low_start = None;
                    self.high_start = None;
                }
            } else {
                self.low_start = None;
            }
        } else if speed_mps > self.high_mps {
            if self.high_start.is_none() {
                self.high_start = Some(t);
            }
            let high_start = self.high_start.unwrap_or(t);
            if t - high_start >= self.high_hold_sec {
                self.state = PauseState::Moving;
                self.intervals.push(PauseInterval {
                    start_t: self.pause_start,
                    end_t: high_start,
                });
                self.high_start = None;
                self.low_start = None;
            }
        } else {
            self.high_start = None;
        }
        self.state
    }

    /// Call after the last sample: closes an open pause at the final timestamp.
    pub fn finish(&mut self) -> &[PauseInterval] {
        if self.state == PauseState::Paused && self.last_t != f64::NEG_INFINITY {
            self.intervals.push(PauseInterval {
                start_t: self.pause_start,
                end_t: self.last_t,
            });
            self.state = PauseState::Moving;
        }
        &self.intervals
    }
}

/// Total paused seconds overlapping `[from_t, to_t]`.
pub fn paused_overlap(intervals: &[PauseInterval], from_t: f64, to_t: f64) -> f64 {
    let mut total = 0.0;
    for p in intervals {
        let s = js_max(p.start_t, from_t);
        let e = js_min(p.end_t, to_t);
        if e > s {
            total += e - s;
        }
    }
    total
}

/// Moving seconds on the fix clock between two timestamps.
pub fn moving_elapsed_at(intervals: &[PauseInterval], from_t: f64, to_t: f64) -> f64 {
    if to_t <= from_t {
        return 0.0;
    }
    to_t - from_t - paused_overlap(intervals, from_t, to_t)
}

/// Moving seconds as known at fix time `t`, with no look-ahead: the first fix's time `t0`, the
/// closed pauses so far (`closed_sec`) and the open pause, back-dated to its start. This is the
/// clock the guided machine runs on. It steps back by up to `low_hold_sec` at the fix that
/// confirms a pause (the still seconds that were counted as moving are excluded retroactively)
/// and holds while paused. The association matters: the guided end checks are `>=` differences.
pub fn causal_moving_sec(t0: f64, t: f64, closed_sec: f64, open_pause_start: Option<f64>) -> f64 {
    t - t0
        - closed_sec
        - match open_pause_start {
            None => 0.0,
            Some(start) => t - start,
        }
}

/// The incremental form of the causal clock: one [`AutoPause`] fed in order, O(1) per sample.
#[derive(Debug, Clone)]
pub struct CausalClock {
    machine: AutoPause,
    t0: Option<f64>,
    closed_sec: f64,
    seen: usize,
}

impl CausalClock {
    pub fn new(opts: &AutoPauseOptions) -> Self {
        CausalClock {
            machine: AutoPause::new(opts),
            t0: None,
            closed_sec: 0.0,
            seen: 0,
        }
    }

    /// Feeds one sample and returns the moving clock at it.
    pub fn push(&mut self, t: f64, speed_mps: f64) -> f64 {
        let t0 = *self.t0.get_or_insert(t);
        self.machine.update(t, speed_mps);
        let intervals = self.machine.intervals();
        while self.seen < intervals.len() {
            let iv = intervals[self.seen];
            self.seen += 1;
            self.closed_sec += iv.end_t - iv.start_t;
        }
        causal_moving_sec(t0, t, self.closed_sec, self.machine.open_pause_start())
    }

    pub fn state(&self) -> PauseState {
        self.machine.state()
    }
}

/// The guided clock at every point: `out[i]` depends only on `points[..=i]`.
pub fn causal_clock_trace(points: &[FilteredPoint], opts: &AutoPauseOptions) -> Vec<f64> {
    let mut clock = CausalClock::new(opts);
    points
        .iter()
        .map(|p| clock.push(p.t, p.speed_mps))
        .collect()
}

/// Pauses, moving time and elapsed time for one run.
#[derive(Debug, Clone, PartialEq)]
pub struct PauseResult {
    pub paused: Vec<PauseInterval>,
    pub moving_sec: f64,
    pub elapsed_sec: f64,
}

/// Batch convenience: pauses, moving time and elapsed time for one run. Reads `t` and
/// `speed_mps` of each point.
pub fn compute_pauses(points: &[FilteredPoint], opts: &AutoPauseOptions) -> PauseResult {
    let mut machine = AutoPause::new(opts);
    for p in points {
        machine.update(p.t, p.speed_mps);
    }
    let paused = machine.finish().to_vec();
    let (Some(first), Some(last)) = (points.first(), points.last()) else {
        return PauseResult {
            paused,
            moving_sec: 0.0,
            elapsed_sec: 0.0,
        };
    };
    if points.len() < 2 {
        return PauseResult {
            paused,
            moving_sec: 0.0,
            elapsed_sec: 0.0,
        };
    }
    let elapsed_sec = last.t - first.t;
    let moving_sec = js_max(0.0, elapsed_sec - paused_overlap(&paused, first.t, last.t));
    PauseResult {
        paused,
        moving_sec,
        elapsed_sec,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hold(speed: f64, from: usize, count: usize) -> Vec<FilteredPoint> {
        (0..count)
            .map(|i| FilteredPoint::sample((from + i) as f64, 0.0, speed, None))
            .collect()
    }

    #[test]
    fn a_60_s_stop_pauses_once_and_moving_excludes_it() {
        let mut pts = hold(3.0, 0, 60);
        pts.extend(hold(0.0, 60, 60));
        pts.extend(hold(3.0, 120, 61));
        let r = compute_pauses(&pts, &AutoPauseOptions::default());
        assert_eq!(
            r.paused,
            vec![PauseInterval {
                start_t: 60.0,
                end_t: 120.0
            }]
        );
        assert_eq!(r.elapsed_sec, 180.0);
        assert_eq!(r.moving_sec, 120.0);
    }

    #[test]
    fn a_short_dip_never_pauses() {
        let mut pts = hold(3.0, 0, 30);
        pts.extend(hold(0.0, 30, 3));
        pts.extend(hold(3.0, 33, 30));
        let r = compute_pauses(&pts, &AutoPauseOptions::default());
        assert!(r.paused.is_empty());
        assert_eq!(r.moving_sec, r.elapsed_sec);
    }

    #[test]
    fn a_run_ending_mid_pause_closes_at_the_last_fix() {
        let mut pts = hold(3.0, 0, 30);
        pts.extend(hold(0.0, 30, 30));
        let r = compute_pauses(&pts, &AutoPauseOptions::default());
        assert_eq!(
            r.paused,
            vec![PauseInterval {
                start_t: 30.0,
                end_t: 59.0
            }]
        );
        assert_eq!(r.moving_sec, 30.0);
        // Fewer than two points: nothing to measure.
        let one = compute_pauses(&pts[..1], &AutoPauseOptions::default());
        assert_eq!((one.moving_sec, one.elapsed_sec), (0.0, 0.0));
        assert_eq!(
            compute_pauses(&[], &AutoPauseOptions::default()).paused,
            vec![]
        );
    }

    #[test]
    fn the_causal_clock_steps_back_when_a_pause_is_confirmed_and_holds() {
        let mut pts = hold(3.0, 0, 30);
        pts.extend(hold(0.0, 30, 30));
        let clock = causal_clock_trace(&pts, &AutoPauseOptions::default());
        assert_eq!(clock[34], 34.0);
        assert_eq!(clock[35], 30.0);
        assert_eq!(clock[59], 30.0);
        // Resume: 3 s above 1.0 m/s after the stop closes the interval and the clock runs again.
        pts.extend(hold(3.0, 60, 10));
        let clock = causal_clock_trace(&pts, &AutoPauseOptions::default());
        assert_eq!(clock[62], 30.0);
        assert_eq!(clock[63], 33.0);
        assert_eq!(clock[69], 39.0);
    }
}
