//! The incremental recorder and the batch pipeline built on it. New in R1: `packages/run` has
//! only the batch `processRun`; a foreground service with the screen locked needs live numbers
//! and cue events one fix at a time (docs/android-native.md 5).
//!
//! `push_fix` feeds one raw fix through the causal pipeline (filter, auto-pause clock, guided
//! machine, periodic cues) and returns the events it produced plus a snapshot of the live
//! numbers. One push appends zero to `reanchor_count` points (a re-anchor flushes the buffered
//! fixes that agreed), and each point is processed in order against the prefix ending at it, so
//! the events are exactly what the batch pass produces at that point. `finish` returns the batch
//! [`ProcessedRun`]; [`process_run`] is "push every fix, then finish", so the two cannot drift.
//!
//! Per-push work is O(1) in the track length apart from two binary searches (the 20 s and 30 s
//! pace windows). `finish` is O(n) once: it recomputes pauses, splits and paces over the stored
//! points with the batch functions, which is what makes the result equal to TS's.
//!
//! The guided clock is the causal moving time at each fix (`autopause::causal_moving_sec`), the
//! one decision that differs from the old batch pass (owner, 2026-11-11): a replay of the stored
//! fixes after a process kill gives the same cues. A manual [`Recorder::advance`] is not in the
//! fixes, so recovery must replay the advances too; the phone persists them (phase A2).

use super::autopause::{compute_pauses, AutoPauseOptions, CausalClock, PauseResult, PauseState};
use super::cues::{CueConfig, CueEvent, CueScheduler};
use super::filter::{FilterOptions, FixFilter};
use super::guided::{ExpandedStep, GuidedEvent, GuidedOptions, GuidedRun, StepRemaining};
use super::pace::{average_pace, cue_pace, current_pace, PaceResult};
use super::splits::{compute_splits, SplitOptions};
use super::{FilteredPoint, Fix, PauseInterval, RunError, RunWorkout, Split};
use crate::js::{ser_num, ser_opt_num};
use serde::Serialize;

/// Everything a recorder or a batch run is configured with. All fields default to the documented
/// values; periodic cues are off by default.
#[derive(Debug, Clone, Default)]
pub struct RecorderConfig {
    pub filter: FilterOptions,
    pub autopause: AutoPauseOptions,
    pub splits: SplitOptions,
    /// When present, the guided machine runs over the track.
    pub workout: Option<RunWorkout>,
    pub guided: GuidedOptions,
    pub cues: CueConfig,
}

/// One event for the phone: a guided-workout event or a periodic cue. Serialized as the bare
/// inner object, which carries its own `type`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(untagged)]
pub enum RunEvent {
    Guided(GuidedEvent),
    Cue(CueEvent),
}

/// The step in progress and what is left of it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStep {
    pub step: ExpandedStep,
    pub remaining: StepRemaining,
}

/// The numbers the Live screen shows, as of the last accepted fix.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    /// Accepted points so far.
    pub points: usize,
    /// Cumulative filtered distance in metres.
    #[serde(serialize_with = "ser_num")]
    pub dist_m: f64,
    /// Moving seconds as known now (the causal clock): paused time is already taken out.
    #[serde(serialize_with = "ser_num")]
    pub moving_sec: f64,
    /// Seconds from the first to the last accepted fix, pauses included.
    #[serde(serialize_with = "ser_num")]
    pub elapsed_sec: f64,
    /// 20 s window pace, `None` while the window is too short.
    pub current: Option<PaceResult>,
    /// 30 s window pace, the one the cues use.
    pub cue: Option<PaceResult>,
    /// Distance over moving time.
    pub avg: Option<PaceResult>,
    /// True while an auto-pause is in effect.
    pub paused: bool,
    /// The guided step in progress, when a workout is running.
    pub step: Option<LiveStep>,
    /// True once every step of the workout has ended.
    pub workout_complete: bool,
}

/// What one `push_fix` or `advance` returns.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PushResult {
    pub events: Vec<RunEvent>,
    pub live: Live,
}

/// The processed run: everything the Summary and the engine handoff need.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessedRun {
    /// Total filtered distance in metres.
    #[serde(serialize_with = "ser_num")]
    pub distance_m: f64,
    /// Seconds excluding paused intervals.
    #[serde(serialize_with = "ser_num")]
    pub moving_sec: f64,
    /// Seconds from the first to the last accepted fix, pauses included.
    #[serde(serialize_with = "ser_num")]
    pub elapsed_sec: f64,
    /// Mean speed over moving time in m/s (0 when there is none).
    #[serde(serialize_with = "ser_num")]
    pub avg_speed_mps: f64,
    /// 20 s window speed at the last fix, `None` when the window is too short.
    #[serde(serialize_with = "ser_opt_num")]
    pub current_speed_mps: Option<f64>,
    /// 30 s window speed at the last fix.
    #[serde(serialize_with = "ser_opt_num")]
    pub cue_speed_mps: Option<f64>,
    pub splits: Vec<Split>,
    pub paused: Vec<PauseInterval>,
    pub points: Vec<FilteredPoint>,
    /// Guided events in track order (only when a workout was given).
    pub guided_events: Vec<GuidedEvent>,
}

/// The batch summary of a track: pauses, splits, paces. The one place both `process_run` and
/// `Recorder::finish` get their numbers from.
fn summarize(
    points: Vec<FilteredPoint>,
    guided_events: Vec<GuidedEvent>,
    autopause: &AutoPauseOptions,
    splits: &SplitOptions,
) -> ProcessedRun {
    let pauses = if points.len() >= 2 {
        compute_pauses(&points, autopause)
    } else {
        PauseResult {
            paused: Vec::new(),
            moving_sec: 0.0,
            elapsed_sec: 0.0,
        }
    };
    let split_list = compute_splits(&points, splits);
    let cur = current_pace(&points, None);
    let cue = cue_pace(&points, None);
    let avg = match points.last() {
        Some(last) if points.len() >= 2 => average_pace(last.dist_m, pauses.moving_sec),
        _ => None,
    };
    ProcessedRun {
        distance_m: points.last().map_or(0.0, |p| p.dist_m),
        moving_sec: pauses.moving_sec,
        elapsed_sec: pauses.elapsed_sec,
        avg_speed_mps: avg.map_or(0.0, |a| a.speed_mps),
        current_speed_mps: cur.map(|c| c.speed_mps),
        cue_speed_mps: cue.map(|c| c.speed_mps),
        splits: split_list,
        paused: pauses.paused,
        points,
        guided_events,
    }
}

#[derive(Debug, Clone)]
pub struct Recorder {
    filter: FixFilter,
    clock: CausalClock,
    guided: Option<GuidedRun>,
    cues: CueScheduler,
    autopause: AutoPauseOptions,
    splits: SplitOptions,
    /// Every guided event so far, for `finish`.
    guided_events: Vec<GuidedEvent>,
    /// The causal moving clock at the last accepted point.
    last_clock: f64,
    finished: bool,
}

impl Recorder {
    /// Errors on an option the pipeline refuses (`reanchor_count` 0, a workout that expands to
    /// too many steps, a non-positive cue interval).
    pub fn new(cfg: &RecorderConfig) -> Result<Self, RunError> {
        if !cfg.cues.is_valid() {
            return Err(RunError::InvalidOption(
                "cue intervals must be finite and positive".into(),
            ));
        }
        let guided = match &cfg.workout {
            Some(w) => Some(GuidedRun::new(w, &cfg.guided)?),
            None => None,
        };
        Ok(Recorder {
            filter: FixFilter::new(&cfg.filter)?,
            clock: CausalClock::new(&cfg.autopause),
            guided,
            cues: CueScheduler::new(cfg.cues),
            autopause: cfg.autopause,
            splits: cfg.splits,
            guided_events: Vec::new(),
            last_clock: 0.0,
            finished: false,
        })
    }

    /// Accepted points so far.
    pub fn points(&self) -> &[FilteredPoint] {
        self.filter.points()
    }

    /// The causal moving clock at the last accepted point (0 before the first).
    pub fn moving_sec(&self) -> f64 {
        self.last_clock
    }

    /// Feeds one raw fix and returns the events it produced and the live numbers.
    pub fn push_fix(&mut self, fix: &Fix) -> Result<PushResult, RunError> {
        let mut events = Vec::new();
        self.push_inner(fix, &mut events)?;
        Ok(PushResult {
            events,
            live: self.live(),
        })
    }

    fn push_inner(&mut self, fix: &Fix, events: &mut Vec<RunEvent>) -> Result<(), RunError> {
        if self.finished {
            return Err(RunError::Finished);
        }
        let added = self.filter.push(fix);
        let total = self.filter.points().len();
        for i in total - added..total {
            let points = self.filter.points();
            let p = points[i];
            let moving = self.clock.push(p.t, p.speed_mps);
            self.last_clock = moving;
            if let Some(guided) = self.guided.as_mut() {
                // The 30 s pace as of this point: the prefix ending here, never the future.
                let cue = cue_pace(&points[..=i], Some(p.t));
                for e in guided.update(cue.map(|c| c.speed_mps), p.dist_m, moving) {
                    self.guided_events.push(e);
                    events.push(RunEvent::Guided(e));
                }
            }
            for c in self.cues.update(p.dist_m, moving) {
                events.push(RunEvent::Cue(c));
            }
        }
        Ok(())
    }

    /// Ends the current guided step by hand (a step with no distance or time, or a skip). Uses
    /// the last point's distance and the causal clock, never wall time. Before the first accepted
    /// fix, with no workout, or after the workout is complete, it does nothing.
    pub fn advance(&mut self) -> Result<PushResult, RunError> {
        if self.finished {
            return Err(RunError::Finished);
        }
        let mut events = Vec::new();
        if let (Some(guided), Some(last)) = (self.guided.as_mut(), self.filter.points().last()) {
            for e in guided.advance(last.dist_m, self.last_clock) {
                self.guided_events.push(e);
                events.push(RunEvent::Guided(e));
            }
        }
        Ok(PushResult {
            events,
            live: self.live(),
        })
    }

    /// The live numbers as of the last accepted fix.
    pub fn live(&self) -> Live {
        let points = self.filter.points();
        let (Some(first), Some(last)) = (points.first(), points.last()) else {
            return Live {
                points: 0,
                dist_m: 0.0,
                moving_sec: 0.0,
                elapsed_sec: 0.0,
                current: None,
                cue: None,
                avg: None,
                paused: false,
                step: None,
                workout_complete: self.guided.as_ref().is_some_and(GuidedRun::complete),
            };
        };
        let step = self.guided.as_ref().and_then(|g| {
            let step = *g.current_step()?;
            let remaining = g.remaining(last.dist_m, self.last_clock)?;
            Some(LiveStep { step, remaining })
        });
        Live {
            points: points.len(),
            dist_m: last.dist_m,
            moving_sec: self.last_clock,
            elapsed_sec: last.t - first.t,
            current: current_pace(points, None),
            cue: cue_pace(points, None),
            avg: average_pace(last.dist_m, self.last_clock),
            paused: self.clock.state() == PauseState::Paused,
            step,
            workout_complete: self.guided.as_ref().is_some_and(GuidedRun::complete),
        }
    }

    /// Closes the run and returns the batch result over everything pushed. Calling it again gives
    /// the same result; pushing after it is an error.
    pub fn finish(&mut self) -> Result<ProcessedRun, RunError> {
        self.finished = true;
        Ok(summarize(
            self.filter.points().to_vec(),
            self.guided_events.clone(),
            &self.autopause,
            &self.splits,
        ))
    }
}

/// The full pipeline over raw fixes in arrival order: push every fix, then finish. Distance sums
/// Vincenty segments on the filtered track; moving time excludes auto-paused intervals; splits
/// interpolate boundary crossings on the fix clock; guided steps advance on the causal moving
/// clock with the 30 s cue pace.
pub fn process_run(fixes: &[Fix], cfg: &RecorderConfig) -> Result<ProcessedRun, RunError> {
    let mut rec = Recorder::new(cfg)?;
    let mut sink = Vec::new();
    for fix in fixes {
        sink.clear();
        rec.push_inner(fix, &mut sink)?;
    }
    rec.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::{WorkoutStep, WorkoutStepKind};

    fn fix(i: usize, speed: f64) -> Fix {
        Fix {
            t: i as f64,
            lat: 47.6062 + (speed * i as f64) / 111319.49,
            lon: -122.3321,
            acc: 3.0,
            hr: None,
            cad: None,
            ele: None,
        }
    }

    fn workout() -> RunWorkout {
        let s = |kind, seconds: Option<f64>| WorkoutStep {
            kind,
            distance_m: None,
            seconds,
            target_mps: None,
            pace_lo_mps: None,
            pace_hi_mps: None,
            hr_zone: None,
            repeat: None,
        };
        RunWorkout {
            steps: vec![
                s(WorkoutStepKind::Warmup, Some(20.0)),
                s(WorkoutStepKind::Work, Some(30.0)),
                s(WorkoutStepKind::Cooldown, None),
            ],
        }
    }

    #[test]
    fn nothing_pushed_reads_as_zeros() {
        let rec = Recorder::new(&RecorderConfig::default()).unwrap();
        let live = rec.live();
        assert_eq!((live.points, live.dist_m, live.moving_sec), (0, 0.0, 0.0));
        assert!(live.current.is_none() && live.step.is_none() && !live.paused);
    }

    #[test]
    fn a_steady_run_reads_out_after_five_seconds_and_matches_the_batch() {
        let fixes: Vec<Fix> = (0..120).map(|i| fix(i, 3.0)).collect();
        let mut rec = Recorder::new(&RecorderConfig::default()).unwrap();
        let mut last = None;
        for (i, f) in fixes.iter().enumerate() {
            let r = rec.push_fix(f).unwrap();
            if i < 5 {
                assert!(r.live.current.is_none(), "needs a 5 s window");
            }
            last = Some(r.live);
        }
        let live = last.unwrap();
        let run = rec.finish().unwrap();
        assert_eq!(live.dist_m, run.distance_m);
        assert_eq!(live.current.map(|c| c.speed_mps), run.current_speed_mps);
        assert_eq!(live.cue.map(|c| c.speed_mps), run.cue_speed_mps);
        assert!((live.moving_sec - run.moving_sec).abs() < 1e-9);
        assert_eq!(
            run,
            process_run(&fixes, &RecorderConfig::default()).unwrap()
        );
        // Idempotent.
        assert_eq!(rec.finish().unwrap(), run);
    }

    #[test]
    fn pushing_after_finish_is_an_error() {
        let mut rec = Recorder::new(&RecorderConfig::default()).unwrap();
        rec.push_fix(&fix(0, 3.0)).unwrap();
        rec.finish().unwrap();
        assert_eq!(rec.push_fix(&fix(1, 3.0)), Err(RunError::Finished));
        assert_eq!(rec.advance(), Err(RunError::Finished));
    }

    #[test]
    fn guided_events_flow_through_pushes_and_advance_ends_an_open_step() {
        let cfg = RecorderConfig {
            workout: Some(workout()),
            ..Default::default()
        };
        let mut rec = Recorder::new(&cfg).unwrap();
        assert!(
            rec.advance().unwrap().events.is_empty(),
            "no point yet, nothing to end"
        );
        let mut all: Vec<RunEvent> = Vec::new();
        let mut step_seen = None;
        for i in 0..80 {
            let r = rec.push_fix(&fix(i, 3.0)).unwrap();
            all.extend(r.events);
            if i == 30 {
                let live_step = r.live.step.expect("in the work step");
                assert_eq!(live_step.step.index, 1);
                assert_eq!(live_step.remaining.sec, Some(20.0));
                step_seen = Some(live_step);
            }
        }
        assert!(step_seen.is_some());
        // Warmup ended at 20 s, work at 50 s; the cooldown has no end condition.
        let live = rec.live();
        assert_eq!(live.step.map(|s| s.step.index), Some(2));
        let adv = rec.advance().unwrap();
        assert!(adv
            .events
            .contains(&RunEvent::Guided(GuidedEvent::WorkoutComplete)));
        assert!(rec.live().workout_complete);
        assert!(rec.live().step.is_none());
        let run = rec.finish().unwrap();
        let from_events: Vec<GuidedEvent> = all
            .iter()
            .chain(adv.events.iter())
            .filter_map(|e| match e {
                RunEvent::Guided(g) => Some(*g),
                RunEvent::Cue(_) => None,
            })
            .collect();
        assert_eq!(run.guided_events, from_events);
    }

    #[test]
    fn periodic_cues_are_a_separate_stream_from_the_guided_events() {
        let cfg = RecorderConfig {
            workout: Some(workout()),
            cues: CueConfig {
                every_dist_m: Some(100.0),
                every_sec: Some(40.0),
            },
            ..Default::default()
        };
        let plain = RecorderConfig {
            workout: Some(workout()),
            ..Default::default()
        };
        let fixes: Vec<Fix> = (0..120).map(|i| fix(i, 3.0)).collect();
        let with = process_run(&fixes, &cfg).unwrap();
        let without = process_run(&fixes, &plain).unwrap();
        assert_eq!(with, without, "cues never change the processed run");
        let mut rec = Recorder::new(&cfg).unwrap();
        let mut cues = 0;
        for f in &fixes {
            cues += rec
                .push_fix(f)
                .unwrap()
                .events
                .iter()
                .filter(|e| matches!(e, RunEvent::Cue(_)))
                .count();
        }
        // 3 m/s for 119 s is about 357 m: marks at 100, 200, 300 m and at 40, 80 s.
        assert_eq!(cues, 5);
    }

    #[test]
    fn invalid_configuration_is_refused() {
        let bad = RecorderConfig {
            filter: FilterOptions {
                reanchor_count: Some(0),
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(Recorder::new(&bad).is_err());
        let bad = RecorderConfig {
            cues: CueConfig {
                every_dist_m: Some(-1.0),
                every_sec: None,
            },
            ..Default::default()
        };
        assert!(Recorder::new(&bad).is_err());
    }

    #[test]
    fn live_serializes_for_the_phone() {
        let mut rec = Recorder::new(&RecorderConfig::default()).unwrap();
        let r = rec.push_fix(&fix(0, 3.0)).unwrap();
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["events"], serde_json::json!([]));
        assert_eq!(v["live"]["points"], serde_json::json!(1));
        assert_eq!(v["live"]["current"], serde_json::Value::Null);
        assert_eq!(v["live"]["paused"], serde_json::json!(false));
    }
}
