//! Periodic audio cues: every N metres of distance and every N seconds of moving time (PLAN 8a:
//! "every 0.5 or 1 mi or every 5 min", settings). New in R1: there is no TS original, so Rust is
//! the definition (DECISIONS S6: Rust is the main implementation) and the unit tests below are its spec. The step and
//! speed-up/slow-down calls come from [`super::guided`]; these are the ones that read out the
//! time, the distance and the average pace.
//!
//! Each threshold fires once. The counters only move forward, so the moving clock stepping back
//! when a pause is confirmed (`autopause::causal_moving_sec`) cannot repeat a cue, and a push that
//! crosses several thresholds at once (a long late batch) reads out the latest one, not a burst.
//! The distance interval is in metres: the app converts the user's 0.5 or 1 mile setting.

use super::pace::average_pace;
use crate::js::{ser_num, ser_opt_num};
use serde::Serialize;

/// Which periodic cues are on. `None` is off.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct CueConfig {
    /// A distance cue at every multiple of this many metres.
    pub every_dist_m: Option<f64>,
    /// A time cue at every multiple of this many seconds of moving time.
    pub every_sec: Option<f64>,
}

impl CueConfig {
    /// Both intervals, when set, must be finite and positive.
    pub fn is_valid(&self) -> bool {
        let ok = |v: Option<f64>| v.is_none_or(|x| x.is_finite() && x > 0.0);
        ok(self.every_dist_m) && ok(self.every_sec)
    }
}

/// What to read out: the reading when the threshold was crossed.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CueEvent {
    /// The `n`th distance mark.
    DistanceCue {
        n: u64,
        #[serde(serialize_with = "ser_num")]
        dist_m: f64,
        #[serde(serialize_with = "ser_num")]
        moving_sec: f64,
        #[serde(serialize_with = "ser_opt_num")]
        avg_pace_sec_per_m: Option<f64>,
    },
    /// The `n`th time mark.
    TimeCue {
        n: u64,
        #[serde(serialize_with = "ser_num")]
        dist_m: f64,
        #[serde(serialize_with = "ser_num")]
        moving_sec: f64,
        #[serde(serialize_with = "ser_opt_num")]
        avg_pace_sec_per_m: Option<f64>,
    },
}

#[derive(Debug, Clone)]
pub struct CueScheduler {
    cfg: CueConfig,
    /// The next distance mark to fire (1-based count of intervals).
    next_dist_n: u64,
    next_time_n: u64,
}

impl CueScheduler {
    pub fn new(cfg: CueConfig) -> Self {
        CueScheduler {
            cfg,
            next_dist_n: 1,
            next_time_n: 1,
        }
    }

    /// Feed the reading after one point: cumulative distance and moving seconds. Returns the cues
    /// that fire, distance before time when both cross at once.
    pub fn update(&mut self, dist_m: f64, moving_sec: f64) -> Vec<CueEvent> {
        let mut out = Vec::new();
        let avg = average_pace(dist_m, moving_sec).map(|p| p.pace_sec_per_m);
        if let Some(every) = self.cfg.every_dist_m {
            if let Some(n) = crossed(dist_m, every, self.next_dist_n) {
                self.next_dist_n = n + 1;
                out.push(CueEvent::DistanceCue {
                    n,
                    dist_m,
                    moving_sec,
                    avg_pace_sec_per_m: avg,
                });
            }
        }
        if let Some(every) = self.cfg.every_sec {
            if let Some(n) = crossed(moving_sec, every, self.next_time_n) {
                self.next_time_n = n + 1;
                out.push(CueEvent::TimeCue {
                    n,
                    dist_m,
                    moving_sec,
                    avg_pace_sec_per_m: avg,
                });
            }
        }
        out
    }
}

/// The highest mark `n >= next` with `n * every <= value`, if any. A non-finite or negative value
/// crosses nothing.
fn crossed(value: f64, every: f64, next: u64) -> Option<u64> {
    if !value.is_finite() || value < 0.0 || !(every > 0.0) {
        return None;
    }
    let reached = (value / every).floor();
    if reached + 1.0 < next as f64 {
        return None;
    }
    // `reached` is finite and at most value / every; cap it so a corrupt reading cannot overflow.
    let mut n = reached.min(1e15) as u64;
    // The division can land one off the exact multiple; settle it with the comparison the docs
    // state: mark `n` is reached when `n * every <= value`.
    if ((n + 1) as f64) * every <= value {
        n += 1;
    }
    if n > 0 && (n as f64) * every > value {
        n -= 1;
    }
    (n >= next).then_some(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dist_cfg(m: f64) -> CueConfig {
        CueConfig {
            every_dist_m: Some(m),
            every_sec: None,
        }
    }

    #[test]
    fn a_distance_cue_fires_once_per_mark() {
        let mut c = CueScheduler::new(dist_cfg(1609.344));
        assert!(c.update(1000.0, 300.0).is_empty());
        let e = c.update(1610.0, 480.0);
        assert_eq!(e.len(), 1);
        assert!(matches!(e[0], CueEvent::DistanceCue { n: 1, .. }));
        assert!(
            c.update(1700.0, 500.0).is_empty(),
            "no repeat inside the same mile"
        );
        assert!(c.update(3000.0, 900.0).is_empty());
        let e = c.update(3219.0, 960.0);
        assert!(matches!(e[0], CueEvent::DistanceCue { n: 2, .. }));
    }

    #[test]
    fn the_mark_itself_counts() {
        let mut c = CueScheduler::new(dist_cfg(1000.0));
        assert_eq!(c.update(1000.0, 300.0).len(), 1);
        // A mark is reached when `n * every <= value` in floating point: 3 * 0.1 is
        // 0.30000000000000004, and 0.3 / 0.1 is 2.9999999999999996, so 0.3 is still the second.
        let mut c = CueScheduler::new(dist_cfg(0.1));
        assert!(matches!(
            c.update(0.3, 1.0)[0],
            CueEvent::DistanceCue { n: 2, .. }
        ));
        let mut c = CueScheduler::new(dist_cfg(0.1));
        assert!(matches!(
            c.update(3.0 * 0.1, 1.0)[0],
            CueEvent::DistanceCue { n: 3, .. }
        ));
    }

    #[test]
    fn a_burst_crossing_several_marks_reads_the_latest_once() {
        let mut c = CueScheduler::new(dist_cfg(500.0));
        let e = c.update(2600.0, 800.0);
        assert_eq!(e.len(), 1);
        assert!(matches!(e[0], CueEvent::DistanceCue { n: 5, .. }));
        assert!(c.update(2700.0, 830.0).is_empty());
        assert_eq!(c.update(3000.0, 900.0).len(), 1);
    }

    #[test]
    fn time_cues_use_moving_seconds_and_never_repeat_when_the_clock_steps_back() {
        let mut c = CueScheduler::new(CueConfig {
            every_dist_m: None,
            every_sec: Some(300.0),
        });
        assert!(c.update(500.0, 299.0).is_empty());
        let e = c.update(510.0, 301.0);
        assert!(matches!(e[0], CueEvent::TimeCue { n: 1, .. }));
        // A pause is confirmed: the clock steps back below the mark, then climbs over it again.
        assert!(c.update(515.0, 297.0).is_empty());
        assert!(
            c.update(520.0, 303.0).is_empty(),
            "the 300 s mark already fired"
        );
        let e = c.update(900.0, 601.0);
        assert!(matches!(e[0], CueEvent::TimeCue { n: 2, .. }));
    }

    #[test]
    fn both_kinds_at_once_and_the_readout() {
        let mut c = CueScheduler::new(CueConfig {
            every_dist_m: Some(1000.0),
            every_sec: Some(300.0),
        });
        let e = c.update(1000.0, 300.0);
        assert_eq!(e.len(), 2);
        match (e[0], e[1]) {
            (
                CueEvent::DistanceCue {
                    avg_pace_sec_per_m: Some(a),
                    ..
                },
                CueEvent::TimeCue {
                    n: 1,
                    moving_sec,
                    dist_m,
                    ..
                },
            ) => {
                assert_eq!(a, 0.3);
                assert_eq!((moving_sec, dist_m), (300.0, 1000.0));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn off_and_bad_input() {
        let mut off = CueScheduler::new(CueConfig::default());
        assert!(off.update(1e6, 1e5).is_empty());
        let mut c = CueScheduler::new(dist_cfg(1000.0));
        assert!(c.update(f64::NAN, 10.0).is_empty());
        assert!(c.update(-5.0, 10.0).is_empty());
        assert!(c.update(f64::INFINITY, 10.0).is_empty());
        let bad = |every_dist_m| CueConfig {
            every_dist_m: Some(every_dist_m),
            every_sec: None,
        };
        assert!(!bad(0.0).is_valid());
        assert!(!bad(f64::NAN).is_valid());
        assert!(CueConfig {
            every_dist_m: Some(804.672),
            every_sec: Some(300.0)
        }
        .is_valid());
        assert!(CueConfig::default().is_valid());
    }

    #[test]
    fn serializes_for_the_phone() {
        let e = CueEvent::DistanceCue {
            n: 2,
            dist_m: 3220.0,
            moving_sec: 900.0,
            avg_pace_sec_per_m: Some(0.28),
        };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"type":"distanceCue","n":2,"distM":3220,"movingSec":900,"avgPaceSecPerM":0.28}"#
        );
    }
}
