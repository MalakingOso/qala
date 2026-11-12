//! Guided-workout step machine: `packages/run/guided.ts`. Consumes a `RunWorkout`, emits step
//! changes and pace-zone speed up / slow down events from the 30 s cue pace.
//!
//! Hysteresis is two-fold so it does not nag at zone edges: prompts fire only outside a tolerance
//! band around the zone, and successive prompts are rate-limited by a cooldown. A step with
//! neither `distance_m` nor `seconds` never auto-completes; end it with [`GuidedRun::advance`].
//!
//! Every end check is a `>=` difference on the run clock, which is why the clock may step back by
//! a few seconds when a pause is confirmed (`autopause::causal_moving_sec`) without ending or
//! restarting anything.

use super::{RunError, RunWorkout, WorkoutStep};
use crate::js::{js_max, ser_num, ser_opt_num};
use serde::Serialize;

/// More expanded steps than this are refused (a `repeat` of a billion would not terminate in TS).
pub const MAX_EXPANDED_STEPS: usize = 10_000;

/// One workout step after repeat expansion.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct ExpandedStep {
    #[serde(flatten)]
    pub step: WorkoutStep,
    /// Position in the expanded sequence.
    pub index: usize,
}

/// Optional overrides; `None` keeps the default.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct GuidedOptions {
    /// Prompt band half-width around the zone (m/s). Default 0.1 (about 10 s/mi).
    pub tolerance_mps: Option<f64>,
    /// Minimum seconds between successive speed prompts. Default 45.
    pub prompt_cooldown_sec: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GuidedEvent {
    StepStart {
        step_index: usize,
        step: ExpandedStep,
    },
    StepEnd {
        step_index: usize,
    },
    WorkoutComplete,
    SpeedUp {
        step_index: usize,
        #[serde(serialize_with = "ser_num")]
        cue_speed_mps: f64,
    },
    SlowDown {
        step_index: usize,
        #[serde(serialize_with = "ser_num")]
        cue_speed_mps: f64,
    },
    BackInZone {
        step_index: usize,
        #[serde(serialize_with = "ser_num")]
        cue_speed_mps: f64,
    },
}

/// A finished step with what was measured over it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepSummary {
    pub step: ExpandedStep,
    pub step_index: usize,
    #[serde(serialize_with = "ser_num")]
    pub start_dist_m: f64,
    #[serde(serialize_with = "ser_num")]
    pub end_dist_m: f64,
    #[serde(serialize_with = "ser_num")]
    pub start_time_sec: f64,
    #[serde(serialize_with = "ser_num")]
    pub end_time_sec: f64,
}

/// What is left of the current step, for the live screen. `None` for an open-ended step.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRemaining {
    #[serde(serialize_with = "ser_opt_num")]
    pub dist_m: Option<f64>,
    #[serde(serialize_with = "ser_opt_num")]
    pub sec: Option<f64>,
}

/// Expand per-step repeats in place (`repeat` = total executions, default 1).
pub fn expand_workout(workout: &RunWorkout) -> Result<Vec<ExpandedStep>, RunError> {
    let mut out: Vec<ExpandedStep> = Vec::new();
    for step in &workout.steps {
        // `Math.max(1, Math.floor(step.repeat ?? 1))`: a NaN repeat gives NaN and no executions.
        let n = js_max(1.0, step.repeat.unwrap_or(1.0).floor());
        if n > MAX_EXPANDED_STEPS as f64 {
            return Err(RunError::InvalidOption(format!(
                "a step repeats {n} times; at most {MAX_EXPANDED_STEPS} steps in all"
            )));
        }
        let mut i = 0.0;
        while i < n {
            out.push(ExpandedStep {
                step: *step,
                index: out.len(),
            });
            if out.len() > MAX_EXPANDED_STEPS {
                return Err(RunError::InvalidOption(format!(
                    "the workout expands to more than {MAX_EXPANDED_STEPS} steps"
                )));
            }
            i += 1.0;
        }
    }
    Ok(out)
}

#[derive(Clone, Copy)]
struct Zone {
    lo: f64,
    hi: f64,
}

fn zone_of(step: &ExpandedStep, tol: f64) -> Option<Zone> {
    let mut lo = step.step.pace_lo_mps;
    let mut hi = step.step.pace_hi_mps;
    if lo.is_none() && hi.is_none() {
        if let Some(target) = step.step.target_mps {
            lo = Some(target - tol);
            hi = Some(target + tol);
        }
    }
    let (mut lo, mut hi) = (lo?, hi?);
    if hi < lo {
        std::mem::swap(&mut lo, &mut hi);
    }
    Some(Zone { lo, hi })
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum OutOfZone {
    Slow,
    Fast,
}

#[derive(Debug, Clone)]
pub struct GuidedRun {
    steps: Vec<ExpandedStep>,
    tolerance_mps: f64,
    prompt_cooldown_sec: f64,

    step_index: usize,
    step_start_dist_m: f64,
    step_start_time_sec: f64,
    started: bool,
    done: bool,
    out_of_zone: Option<OutOfZone>,
    last_prompt_t: f64,
    summaries: Vec<StepSummary>,
}

impl GuidedRun {
    pub fn new(workout: &RunWorkout, opts: &GuidedOptions) -> Result<Self, RunError> {
        Ok(GuidedRun {
            steps: expand_workout(workout)?,
            tolerance_mps: opts.tolerance_mps.unwrap_or(0.1),
            prompt_cooldown_sec: opts.prompt_cooldown_sec.unwrap_or(45.0),
            step_index: 0,
            step_start_dist_m: 0.0,
            step_start_time_sec: 0.0,
            started: false,
            done: false,
            out_of_zone: None,
            last_prompt_t: f64::NEG_INFINITY,
            summaries: Vec::new(),
        })
    }

    /// Expanded steps (one TCX lap each).
    pub fn expanded_steps(&self) -> &[ExpandedStep] {
        &self.steps
    }

    /// Per-step measured summaries for finished steps.
    pub fn step_summaries(&self) -> &[StepSummary] {
        &self.summaries
    }

    pub fn current_step_index(&self) -> usize {
        self.step_index
    }

    pub fn complete(&self) -> bool {
        self.done
    }

    /// The step in progress, or `None` before the first update, after the last step, or for an
    /// empty workout.
    pub fn current_step(&self) -> Option<&ExpandedStep> {
        if !self.started || self.done {
            return None;
        }
        self.steps.get(self.step_index)
    }

    /// What is left of the current step at cumulative distance `dist_m` and run clock `time_sec`.
    /// Clamped at zero: a step that has run past its end but not yet been closed shows 0.
    pub fn remaining(&self, dist_m: f64, time_sec: f64) -> Option<StepRemaining> {
        let step = self.current_step()?;
        Some(StepRemaining {
            dist_m: step
                .step
                .distance_m
                .map(|d| js_max(0.0, d - (dist_m - self.step_start_dist_m))),
            sec: step
                .step
                .seconds
                .map(|s| js_max(0.0, s - (time_sec - self.step_start_time_sec))),
        })
    }

    /// Advance the machine. `dist_m` is cumulative run distance, `time_sec` the run clock step
    /// durations refer to (moving time), `cue_speed_mps` the 30 s pace or `None` when it is not
    /// available yet.
    pub fn update(
        &mut self,
        cue_speed_mps: Option<f64>,
        dist_m: f64,
        time_sec: f64,
    ) -> Vec<GuidedEvent> {
        let mut events = Vec::new();
        if self.done || self.steps.is_empty() {
            if !self.done && self.steps.is_empty() {
                self.done = true;
                events.push(GuidedEvent::WorkoutComplete);
            }
            return events;
        }
        let step = self.steps[self.step_index];
        if !self.started {
            self.started = true;
            self.step_start_dist_m = dist_m;
            self.step_start_time_sec = time_sec;
            events.push(GuidedEvent::StepStart {
                step_index: self.step_index,
                step,
            });
        }

        let zone = zone_of(&step, self.tolerance_mps);
        if let (Some(zone), Some(v)) = (zone, cue_speed_mps) {
            match self.out_of_zone {
                None => {
                    if v < zone.lo - self.tolerance_mps
                        && time_sec - self.last_prompt_t >= self.prompt_cooldown_sec
                    {
                        self.out_of_zone = Some(OutOfZone::Slow);
                        self.last_prompt_t = time_sec;
                        events.push(GuidedEvent::SpeedUp {
                            step_index: self.step_index,
                            cue_speed_mps: v,
                        });
                    } else if v > zone.hi + self.tolerance_mps
                        && time_sec - self.last_prompt_t >= self.prompt_cooldown_sec
                    {
                        self.out_of_zone = Some(OutOfZone::Fast);
                        self.last_prompt_t = time_sec;
                        events.push(GuidedEvent::SlowDown {
                            step_index: self.step_index,
                            cue_speed_mps: v,
                        });
                    }
                }
                Some(side) => {
                    if v >= zone.lo && v <= zone.hi {
                        self.out_of_zone = None;
                        events.push(GuidedEvent::BackInZone {
                            step_index: self.step_index,
                            cue_speed_mps: v,
                        });
                    } else if time_sec - self.last_prompt_t >= self.prompt_cooldown_sec {
                        // Still out on the same side: re-prompt, never flip sides directly.
                        let still_slow = side == OutOfZone::Slow && v < zone.lo;
                        let still_fast = side == OutOfZone::Fast && v > zone.hi;
                        if still_slow || still_fast {
                            self.last_prompt_t = time_sec;
                            events.push(if still_slow {
                                GuidedEvent::SpeedUp {
                                    step_index: self.step_index,
                                    cue_speed_mps: v,
                                }
                            } else {
                                GuidedEvent::SlowDown {
                                    step_index: self.step_index,
                                    cue_speed_mps: v,
                                }
                            });
                        } else {
                            self.out_of_zone = Some(if v < zone.lo {
                                OutOfZone::Slow
                            } else {
                                OutOfZone::Fast
                            });
                        }
                    }
                }
            }
        }

        let dist_done = step
            .step
            .distance_m
            .is_some_and(|d| dist_m - self.step_start_dist_m >= d);
        let time_done = step
            .step
            .seconds
            .is_some_and(|s| time_sec - self.step_start_time_sec >= s);
        if dist_done || time_done {
            self.finish_step(dist_m, time_sec, &mut events);
        }
        events
    }

    /// Manually end the current step (open-ended steps with no end condition).
    pub fn advance(&mut self, dist_m: f64, time_sec: f64) -> Vec<GuidedEvent> {
        let mut events = Vec::new();
        if !self.done && !self.steps.is_empty() {
            self.finish_step(dist_m, time_sec, &mut events);
        }
        events
    }

    fn finish_step(&mut self, dist_m: f64, time_sec: f64, events: &mut Vec<GuidedEvent>) {
        let step = self.steps[self.step_index];
        events.push(GuidedEvent::StepEnd {
            step_index: self.step_index,
        });
        self.summaries.push(StepSummary {
            step,
            step_index: self.step_index,
            start_dist_m: self.step_start_dist_m,
            end_dist_m: dist_m,
            start_time_sec: self.step_start_time_sec,
            end_time_sec: time_sec,
        });
        self.out_of_zone = None;
        self.step_index += 1;
        if self.step_index >= self.steps.len() {
            self.done = true;
            events.push(GuidedEvent::WorkoutComplete);
        } else {
            self.step_start_dist_m = dist_m;
            self.step_start_time_sec = time_sec;
            events.push(GuidedEvent::StepStart {
                step_index: self.step_index,
                step: self.steps[self.step_index],
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::WorkoutStepKind;

    fn step(kind: WorkoutStepKind) -> WorkoutStep {
        WorkoutStep {
            kind,
            distance_m: None,
            seconds: None,
            target_mps: None,
            pace_lo_mps: None,
            pace_hi_mps: None,
            hr_zone: None,
            repeat: None,
        }
    }

    fn intervals() -> RunWorkout {
        let work = WorkoutStep {
            seconds: Some(120.0),
            pace_lo_mps: Some(2.9),
            pace_hi_mps: Some(3.1),
            ..step(WorkoutStepKind::Work)
        };
        RunWorkout {
            steps: vec![
                WorkoutStep {
                    seconds: Some(60.0),
                    ..step(WorkoutStepKind::Warmup)
                },
                work,
                WorkoutStep {
                    seconds: Some(60.0),
                    ..step(WorkoutStepKind::Recover)
                },
                work,
                WorkoutStep {
                    seconds: Some(60.0),
                    ..step(WorkoutStepKind::Recover)
                },
                step(WorkoutStepKind::Cooldown),
            ],
        }
    }

    #[test]
    fn on_pace_intervals_step_through_with_no_nagging() {
        let mut g = GuidedRun::new(&intervals(), &GuidedOptions::default()).unwrap();
        let mut events = Vec::new();
        let (mut dist, mut time) = (0.0, 0.0);
        let mut guard = 0;
        while g.current_step_index() < 5 && guard < 1000 {
            dist += 3.0;
            time += 1.0;
            events.extend(g.update(Some(3.0), dist, time));
            guard += 1;
        }
        assert!(matches!(
            events[0],
            GuidedEvent::StepStart { step_index: 0, .. }
        ));
        assert!(!events.iter().any(|e| matches!(
            e,
            GuidedEvent::SpeedUp { .. } | GuidedEvent::SlowDown { .. }
        )));
        assert_eq!(g.current_step_index(), 5);
        assert!(
            !g.complete(),
            "the open-ended cooldown holds the workout open"
        );
        let tail = g.advance(dist, time);
        assert!(tail.contains(&GuidedEvent::WorkoutComplete));
        assert_eq!(g.step_summaries().len(), 6);
        assert!(
            g.advance(dist, time).is_empty(),
            "nothing to end once complete"
        );
    }

    #[test]
    fn slow_work_pace_prompts_rate_limited_then_backs_in_zone() {
        let mut g = GuidedRun::new(&intervals(), &GuidedOptions::default()).unwrap();
        let (mut dist, mut time) = (0.0, 0.0);
        for _ in 0..61 {
            dist += 3.0;
            time += 1.0;
            g.update(Some(3.0), dist, time);
        }
        assert_eq!(g.current_step_index(), 1);
        let mut nags = 0;
        for _ in 0..60 {
            dist += 2.5;
            time += 1.0;
            nags += g
                .update(Some(2.5), dist, time)
                .iter()
                .filter(|e| matches!(e, GuidedEvent::SpeedUp { .. }))
                .count();
        }
        assert!((1..=4).contains(&nags), "{nags}");
        let mut back = false;
        for _ in 0..60 {
            dist += 3.0;
            time += 1.0;
            back |= g
                .update(Some(3.0), dist, time)
                .iter()
                .any(|e| matches!(e, GuidedEvent::BackInZone { .. }));
        }
        assert!(back);
    }

    #[test]
    fn repeats_expand_per_step_and_degenerate_repeats_are_handled() {
        let w = |repeat: f64| RunWorkout {
            steps: vec![WorkoutStep {
                seconds: Some(60.0),
                repeat: Some(repeat),
                ..step(WorkoutStepKind::Work)
            }],
        };
        assert_eq!(expand_workout(&w(3.0)).unwrap().len(), 3);
        assert_eq!(expand_workout(&w(0.0)).unwrap().len(), 1);
        assert_eq!(expand_workout(&w(2.9)).unwrap().len(), 2);
        assert_eq!(expand_workout(&w(-4.0)).unwrap().len(), 1);
        assert_eq!(expand_workout(&w(f64::NAN)).unwrap().len(), 0);
        assert!(expand_workout(&w(1e9)).is_err());
        assert!(expand_workout(&w(f64::INFINITY)).is_err());
        let many = RunWorkout {
            steps: vec![
                WorkoutStep {
                    repeat: Some(9000.0),
                    ..step(WorkoutStepKind::Work)
                };
                2
            ],
        };
        assert!(expand_workout(&many).is_err());
    }

    #[test]
    fn an_empty_workout_completes_on_the_first_update() {
        let mut g =
            GuidedRun::new(&RunWorkout { steps: vec![] }, &GuidedOptions::default()).unwrap();
        assert_eq!(g.update(None, 0.0, 0.0), vec![GuidedEvent::WorkoutComplete]);
        assert!(g.update(None, 1.0, 1.0).is_empty());
        assert!(g.advance(1.0, 1.0).is_empty());
    }

    #[test]
    fn what_is_left_of_a_step() {
        let w = RunWorkout {
            steps: vec![WorkoutStep {
                seconds: Some(60.0),
                distance_m: Some(200.0),
                ..step(WorkoutStepKind::Work)
            }],
        };
        let mut g = GuidedRun::new(&w, &GuidedOptions::default()).unwrap();
        assert!(g.remaining(0.0, 0.0).is_none(), "not started");
        g.update(None, 1000.0, 500.0);
        let r = g.remaining(1050.0, 520.0).unwrap();
        assert_eq!(r.dist_m, Some(150.0));
        assert_eq!(r.sec, Some(40.0));
        assert_eq!(g.remaining(1500.0, 900.0).unwrap().dist_m, Some(0.0));
    }

    #[test]
    fn events_serialize_like_the_ts_objects() {
        let e = GuidedEvent::SpeedUp {
            step_index: 2,
            cue_speed_mps: 2.5,
        };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"type":"speedUp","stepIndex":2,"cueSpeedMps":2.5}"#
        );
        let s = GuidedEvent::StepStart {
            step_index: 0,
            step: ExpandedStep {
                step: WorkoutStep {
                    seconds: Some(60.0),
                    ..step(WorkoutStepKind::Warmup)
                },
                index: 0,
            },
        };
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"type":"stepStart","stepIndex":0,"step":{"kind":"warmup","seconds":60,"index":0}}"#
        );
        assert_eq!(
            serde_json::to_string(&GuidedEvent::WorkoutComplete).unwrap(),
            r#"{"type":"workoutComplete"}"#
        );
    }
}
