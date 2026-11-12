//! Pace: the deleted TS `run/pace.ts`. 20 s current pace, 30 s audio-cue pace, average pace.
//!
//! All windows key off fix timestamps, never callback wall clock. Speeds in m/s; `pace_sec_per_m`
//! converts to min/mi in the UI. The window functions read `t` and `dist_m` of each point and
//! binary-search them, so one call is O(log n).

use super::FilteredPoint;
use crate::js::{js_max, js_min, ser_num};
use serde::Serialize;

pub const CURRENT_PACE_WINDOW_SEC: f64 = 20.0;
pub const CUE_PACE_WINDOW_SEC: f64 = 30.0;
/// Minimum window span before a pace reads out instead of `None`.
const MIN_SPAN_SEC: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaceResult {
    #[serde(serialize_with = "ser_num")]
    pub speed_mps: f64,
    /// Seconds per metre; multiply by 1609.344 and divide by 60 for min/mi.
    #[serde(serialize_with = "ser_num")]
    pub pace_sec_per_m: f64,
}

fn to_result(speed_mps: f64) -> Option<PaceResult> {
    if !speed_mps.is_finite() || speed_mps <= 0.0 {
        return None;
    }
    Some(PaceResult {
        speed_mps,
        pace_sec_per_m: 1.0 / speed_mps,
    })
}

/// Linearly interpolated cumulative distance at time `t`.
pub fn dist_at(points: &[FilteredPoint], t: f64) -> Option<f64> {
    let first = points.first()?;
    let last = points.last()?;
    if t <= first.t {
        return Some(first.dist_m);
    }
    if t >= last.t {
        return Some(last.dist_m);
    }
    let mut lo = 0usize;
    let mut hi = points.len() - 1;
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if points[mid].t <= t {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let a = &points[lo];
    let b = &points[hi];
    let span = b.t - a.t;
    if span <= 0.0 {
        return Some(a.dist_m);
    }
    Some(a.dist_m + (b.dist_m - a.dist_m) * ((t - a.t) / span))
}

/// Speed over the trailing `window_sec` ending at `now_t`: interpolated distance covered divided
/// by the actual time span. `None` when the covered span is under 5 s (run just started) or there
/// are fewer than two points.
pub fn window_speed(points: &[FilteredPoint], now_t: f64, window_sec: f64) -> Option<PaceResult> {
    if points.len() < 2 {
        return None;
    }
    let last = points.last()?;
    let end_t = js_min(now_t, last.t);
    let start_t = end_t - window_sec;
    let first_t = points.first()?.t;
    let span = end_t - js_max(start_t, first_t);
    if span < MIN_SPAN_SEC {
        return None;
    }
    let d_end = dist_at(points, end_t)?;
    let d_start = dist_at(points, js_max(start_t, first_t))?;
    to_result((d_end - d_start) / span)
}

/// Live pace over the 20 s window. Defaults to the last fix's timestamp.
pub fn current_pace(points: &[FilteredPoint], now_t: Option<f64>) -> Option<PaceResult> {
    let last = points.last()?;
    window_speed(points, now_t.unwrap_or(last.t), CURRENT_PACE_WINDOW_SEC)
}

/// Guided-workout and audio-cue pace over the 30 s window.
pub fn cue_pace(points: &[FilteredPoint], now_t: Option<f64>) -> Option<PaceResult> {
    let last = points.last()?;
    window_speed(points, now_t.unwrap_or(last.t), CUE_PACE_WINDOW_SEC)
}

/// Average pace = distance / moving time (paused time excluded, elapsed kept).
pub fn average_pace(distance_m: f64, moving_sec: f64) -> Option<PaceResult> {
    if !(moving_sec > 0.0) || !(distance_m >= 0.0) {
        return None;
    }
    to_result(distance_m / moving_sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(count: usize, speed: f64) -> Vec<FilteredPoint> {
        (0..count)
            .map(|i| FilteredPoint::sample(i as f64, i as f64 * speed, speed, None))
            .collect()
    }

    #[test]
    fn a_steady_run_reads_the_same_pace_in_every_window() {
        let pts = line(121, 3.0);
        assert_eq!(current_pace(&pts, None).unwrap().speed_mps, 3.0);
        assert_eq!(cue_pace(&pts, None).unwrap().speed_mps, 3.0);
        let avg = average_pace(pts[120].dist_m, 120.0).unwrap();
        assert_eq!(avg.speed_mps, 3.0);
        assert_eq!(avg.pace_sec_per_m, 1.0 / 3.0);
    }

    #[test]
    fn short_or_empty_tracks_read_nothing() {
        assert!(current_pace(&[], None).is_none());
        assert!(current_pace(&line(1, 3.0), None).is_none());
        // Under 5 s of track.
        assert!(current_pace(&line(5, 3.0), None).is_none());
        assert!(current_pace(&line(6, 3.0), None).is_some());
        assert!(average_pace(300.0, 0.0).is_none());
        assert!(average_pace(-1.0, 10.0).is_none());
        assert!(average_pace(0.0, 10.0).is_none());
    }

    #[test]
    fn a_window_ignores_the_future() {
        let pts = line(120, 2.8);
        let early = window_speed(&pts[..60], 59.0, 20.0).unwrap();
        let late = window_speed(&pts, 59.0, 20.0).unwrap();
        assert_eq!(early, late);
    }

    #[test]
    fn dist_at_interpolates_and_clamps() {
        let pts = line(11, 2.0);
        assert_eq!(dist_at(&pts, -5.0), Some(0.0));
        assert_eq!(dist_at(&pts, 100.0), Some(20.0));
        assert_eq!(dist_at(&pts, 2.5), Some(5.0));
        assert_eq!(dist_at(&[], 1.0), None);
    }
}
