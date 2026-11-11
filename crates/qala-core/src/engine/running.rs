//! Running in the engine: `packages/engine/running.ts` lines 1-264 (PLAN 6.4,
//! docs/research/RESEARCH-running.md). SI units in and out. The cross-modal rules that follow
//! in the TS file are out of scope for this port. Lines 160-240 hold the run-load helpers merged
//! in from `packages/run/load.ts` (R1): guarded for NaN and zero, on this module's one
//! `gap_factor`.
//!
//! All set-equivalent weights are derived assumptions (docs/PLAN.md 6.4). `**` in TS is
//! `powf` here, never `powi`, so the polynomial goes through the same libm `pow` path.

// `!(x > 0.0)` in the run-load helpers is the NaN-aware form the TS uses; see `run/mod.rs`.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

use super::state::{BestEffort, GradeSegment, SrpeRtssPair};
use crate::js::js_max;
use crate::time::{parse_iso, TimeError};

/// Minetti 2002 energy-cost polynomial, `grade` as a fraction.
pub fn minetti_cost(grade: f64) -> f64 {
    let i = grade;
    155.4 * i.powf(5.0) - 30.4 * i.powf(4.0) - 43.3 * i.powf(3.0)
        + 46.3 * i.powf(2.0)
        + 19.5 * i
        + 3.6
}

/// Cost at `grade` relative to flat.
pub fn minetti_ratio(grade: f64) -> f64 {
    minetti_cost(grade) / minetti_cost(0.0)
}

/// GAP factor: the Minetti ratio uphill; downhill `max(Minetti, 0.88)`, capped at 1.0 beyond
/// -18% (PLAN 6.4 / RESEARCH 3).
pub fn gap_factor(grade: f64) -> f64 {
    if grade >= 0.0 {
        return minetti_ratio(grade);
    }
    if grade <= -0.18 {
        return 1.0;
    }
    js_max(minetti_ratio(grade), 0.88)
}

/// Normalised graded pace from speed and mean grade.
pub fn ngp(speed_mps: f64, grade: f64) -> f64 {
    speed_mps * gap_factor(grade)
}

/// Mean GAP factor over a grade profile, weighted by metres; 1 for a missing, empty or
/// zero-length profile.
pub fn mean_gap_factor(profile: Option<&[GradeSegment]>) -> f64 {
    let Some(profile) = profile else {
        return 1.0;
    };
    if profile.is_empty() {
        return 1.0;
    }
    let total = profile.iter().fold(0.0, |a, s| a + s.meters);
    if total <= 0.0 {
        return 1.0;
    }
    profile
        .iter()
        .fold(0.0, |a, s| a + gap_factor(s.grade) * s.meters)
        / total
}

/// `ngp / threshold pace`.
pub fn intensity_factor(ngp_mps: f64, threshold_pace_mps: f64) -> f64 {
    ngp_mps / threshold_pace_mps
}

/// rTSS = hours x IF^2 x 100. Exactly 100 for 1 h at threshold on flat.
pub fn rtss(hours: f64, intensity: f64) -> f64 {
    hours * intensity * intensity * 100.0
}

/// Daniels and Gilbert VDOT from one effort (coefficients from calculator sites, secondary).
pub fn vdot_from_effort(distance_m: f64, seconds: f64) -> f64 {
    let t_min = seconds / 60.0;
    let v = distance_m / t_min; // m/min
    let vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
    let frac = 0.8 + 0.1894393 * (-0.012778 * t_min).exp() + 0.2989558 * (-0.1932605 * t_min).exp();
    vo2 / frac
}

/// Riegel `T2 = T1 x (D2/D1)^1.06`, valid for 3.5 to 230 min (assumption, PLAN 6.4).
pub fn riegel(seconds1: f64, d1: f64, d2: f64) -> f64 {
    seconds1 * (d2 / d1).powf(1.06)
}

// ---- Run load helpers (merged from packages/run/load.ts) ----

/// Grade-adjusted speed: the flat speed costing the same effort. 0 for a speed that is not
/// positive (NaN included).
pub fn grade_adjusted_speed(speed_mps: f64, grade: f64) -> f64 {
    if !(speed_mps > 0.0) {
        return 0.0;
    }
    speed_mps * gap_factor(grade)
}

/// Grade-adjusted pace in s/m. Infinity for a pace that is not positive.
pub fn grade_adjusted_pace(pace_sec_per_m: f64, grade: f64) -> f64 {
    if !(pace_sec_per_m > 0.0) {
        return f64::INFINITY;
    }
    pace_sec_per_m / gap_factor(grade)
}

/// Total grade-adjusted distance: the sum of `meters x gap_factor(grade)` over segments with a
/// positive length.
pub fn gap_distance_m(segments: &[GradeSegment]) -> f64 {
    let mut total = 0.0;
    for s in segments {
        if s.meters > 0.0 {
            total += s.meters * gap_factor(s.grade);
        }
    }
    total
}

/// Normalised graded pace as a speed (m/s): grade-adjusted distance over moving time. This is the
/// distance-weighted mean GAP speed; TrainingPeaks' exact NGP quartic weighting is proprietary.
/// 0 when the time is not positive or the distance is negative or NaN.
pub fn ngp_from_gap_distance(gap_dist_m: f64, moving_sec: f64) -> f64 {
    if !(moving_sec > 0.0) || !(gap_dist_m >= 0.0) {
        return 0.0;
    }
    gap_dist_m / moving_sec
}

/// rTSS straight from a grade-adjusted run: 0 on a non-positive threshold or time. The engine's
/// [`intensity_factor`] and [`rtss`] stay unguarded (they have vectors), so the guards live here.
pub fn rtss_from_run(gap_dist_m: f64, moving_sec: f64, threshold_mps: f64) -> f64 {
    let ngp_value = ngp_from_gap_distance(gap_dist_m, moving_sec);
    let intensity = if threshold_mps > 0.0 && ngp_value >= 0.0 {
        intensity_factor(ngp_value, threshold_mps)
    } else {
        0.0
    };
    let hours = moving_sec / 3600.0;
    if hours >= 0.0 && intensity >= 0.0 {
        rtss(hours, intensity)
    } else {
        0.0
    }
}

/// Threshold speed (m/s) from a recent race: Riegel-project to one hour, the fastest pace
/// sustainable for about an hour. An assumption until critical speed has three efforts. The
/// inverse of [`riegel`], written out so the bits match the TS.
pub fn threshold_pace_from_race(race_dist_m: f64, race_sec: f64) -> f64 {
    if !(race_dist_m > 0.0) || !(race_sec > 0.0) {
        return 0.0;
    }
    // Distance coverable in 3600 s at Riegel-equivalent effort, over 3600 s.
    let d = race_dist_m * (3600.0 / race_sec).powf(1.0 / 1.06);
    d / 3600.0
}

/// A distance and the time it took.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Effort {
    pub distance_m: f64,
    pub seconds: f64,
}

/// Critical speed: the least-squares slope of distance against time through the best 400, 800
/// and 5000 m efforts of the last 90 days (Smyth 2020). `None` when fewer than three of those
/// distances qualify.
///
/// Errors only when `now_iso` does not parse (TS would see NaN and return null). An effort
/// whose own date does not parse is skipped, as TS skips it when `NaN >= cutoff` is false.
pub fn critical_speed(efforts: &[BestEffort], now_iso: &str) -> Result<Option<f64>, TimeError> {
    let cutoff = parse_iso(now_iso)? - 90 * 86_400_000;
    let mut pts: Vec<(f64, f64)> = Vec::new(); // (t, d)
    for target in [400.0, 800.0, 5000.0] {
        let mut best: Option<&BestEffort> = None;
        for e in efforts {
            if e.distance_m != target {
                continue;
            }
            match parse_iso(&e.date) {
                Ok(ms) if ms >= cutoff => {}
                _ => continue,
            }
            // reduce((a, b) => a.seconds < b.seconds ? a : b): on a tie the later effort wins.
            best = match best {
                Some(a) if a.seconds < e.seconds => Some(a),
                Some(_) | None => Some(e),
            };
        }
        let Some(best) = best else {
            continue;
        };
        pts.push((best.seconds, best.distance_m));
    }
    if pts.len() < 3 {
        return Ok(None);
    }
    let n = pts.len() as f64;
    let mt = pts.iter().fold(0.0, |a, p| a + p.0) / n;
    let md = pts.iter().fold(0.0, |a, p| a + p.1) / n;
    let num = pts.iter().fold(0.0, |a, p| a + (p.0 - mt) * (p.1 - md));
    let den = pts.iter().fold(0.0, |a, p| a + (p.0 - mt) * (p.0 - mt));
    if den <= 0.0 {
        return Ok(None);
    }
    Ok(Some(num / den))
}

// ---- Set-equivalents (fatigue only; never counted toward MEV/MRV) ----

/// Zone weight: 0.5 easy, 1.0 steady, 1.5 hard. Stored in state as a plain number.
pub type RunZone = f64;
pub const ZONE_EASY: RunZone = 0.5;
pub const ZONE_STEADY: RunZone = 1.0;
pub const ZONE_HARD: RunZone = 1.5;

/// `z` from grade-adjusted speed against CS: below 0.78 easy, 0.78 to 1.0 steady, above CS hard.
pub fn run_zone(ngp_mps: f64, cs_mps: f64) -> RunZone {
    let r = ngp_mps / cs_mps;
    if r < 0.78 {
        ZONE_EASY
    } else if r <= 1.0 {
        ZONE_STEADY
    } else {
        ZONE_HARD
    }
}

/// Per-muscle set-equivalents of a run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunSetEq {
    pub quads: f64,
    pub calves: f64,
    pub glutes: f64,
    pub hamstrings: f64,
}

/// `q = 0.18 x z per km`; splits anchored on knee-extensor force loss (derived).
pub fn run_set_equivalents(km: f64, z: RunZone) -> RunSetEq {
    let q = 0.18 * z * km;
    RunSetEq {
        quads: q,
        calves: 0.8 * q,
        glutes: 0.5 * q,
        hamstrings: (if z == 1.5 { 0.8 } else { 0.4 }) * q,
    }
}

/// Repeated bout factor: `max(0.65, 1 - 0.035n)`, n = runs with 200 m+ descent in 42 d.
pub fn rbe_factor(n: f64) -> f64 {
    js_max(0.65, 1.0 - 0.035 * n)
}

/// Eccentric damage per 100 m descended on grades below -5%.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DescentDamage {
    pub quads: f64,
    pub calves: f64,
}

/// Quads 0.4 and calves 0.25 per 100 m, scaled by the repeated-bout factor.
pub fn descent_damage(descent_m: f64, rbe: f64) -> DescentDamage {
    let units = descent_m / 100.0;
    DescentDamage {
        quads: 0.4 * units * rbe,
        calves: 0.25 * units * rbe,
    }
}

/// Prior 3.6 sRPE-load units per 100 rTSS (derived, unvalidated).
pub const SRPE_PER_100_RTSS_PRIOR: f64 = 3.6;

/// Per-user fitted ratio after 10 paired runs, else the prior.
pub fn srpe_load_ratio(pairs: &[SrpeRtssPair]) -> f64 {
    if pairs.len() >= 10 {
        let num = pairs.iter().fold(0.0, |a, p| a + p.srpe_load);
        let den = pairs.iter().fold(0.0, |a, p| a + p.r_tss);
        if den > 0.0 {
            return (num / den) * 100.0;
        }
    }
    SRPE_PER_100_RTSS_PRIOR
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) {
        assert!(
            (a - b).abs() <= 1e-12 * a.abs().max(b.abs()).max(1.0),
            "{a} vs {b}"
        );
    }

    fn effort(d: f64, s: f64, date: &str) -> BestEffort {
        BestEffort {
            distance_m: d,
            seconds: s,
            date: date.to_string(),
        }
    }

    #[test]
    fn flat_ground_is_the_reference() {
        close(minetti_cost(0.0), 3.6);
        assert_eq!(minetti_ratio(0.0), 1.0);
        assert_eq!(gap_factor(0.0), 1.0);
        assert_eq!(rtss(1.0, 1.0), 100.0);
    }

    #[test]
    fn gap_factor_shape() {
        // Uphill costs more, shallow downhill is floored at 0.88, steep downhill is capped at 1.
        assert!(gap_factor(0.05) > 1.0);
        assert!(gap_factor(0.10) > gap_factor(0.05));
        assert!(gap_factor(-0.05) >= 0.88 && gap_factor(-0.05) < 1.0);
        assert_eq!(gap_factor(-0.18), 1.0);
        assert_eq!(gap_factor(-0.5), 1.0);
        assert_eq!(gap_factor(-0.12), js_max(minetti_ratio(-0.12), 0.88));
        // Minetti 2002 at +10%: 155.4e-5 - 30.4e-4 - 43.3e-3 + 46.3e-2 + 1.95 + 3.6.
        close(
            minetti_cost(0.1),
            155.4e-5 - 30.4e-4 - 43.3e-3 + 46.3e-2 + 1.95 + 3.6,
        );
        close(ngp(3.0, 0.1), 3.0 * gap_factor(0.1));
    }

    #[test]
    fn mean_gap_factor_cases() {
        assert_eq!(mean_gap_factor(None), 1.0);
        assert_eq!(mean_gap_factor(Some(&[])), 1.0);
        let zero = [GradeSegment {
            grade: 0.1,
            meters: 0.0,
        }];
        assert_eq!(mean_gap_factor(Some(&zero)), 1.0);
        let neg = [GradeSegment {
            grade: 0.1,
            meters: -5.0,
        }];
        assert_eq!(mean_gap_factor(Some(&neg)), 1.0);
        let p = [
            GradeSegment {
                grade: 0.0,
                meters: 1000.0,
            },
            GradeSegment {
                grade: 0.1,
                meters: 1000.0,
            },
        ];
        close(mean_gap_factor(Some(&p)), (1.0 + gap_factor(0.1)) / 2.0);
    }

    #[test]
    fn vdot_of_a_known_effort() {
        // 5 km in 20:00 is a VDOT of about 49.8 on the Daniels tables.
        let v = vdot_from_effort(5000.0, 1200.0);
        assert!((v - 49.8).abs() < 0.2, "{v}");
        close(riegel(1200.0, 5000.0, 10_000.0), 1200.0 * 2f64.powf(1.06));
    }

    #[test]
    fn run_load_helpers_guard_zero_and_nan() {
        let seg = |grade, meters| GradeSegment { grade, meters };
        assert_eq!(rtss_from_run(1000.0, 300.0, 0.0), 0.0);
        assert_eq!(rtss_from_run(1000.0, 0.0, 4.0), 0.0);
        assert_eq!(rtss_from_run(f64::NAN, 300.0, 4.0), 0.0);
        assert_eq!(rtss_from_run(4.0 * 3600.0, 3600.0, 4.0), 100.0);
        assert_eq!(ngp_from_gap_distance(500.0, 0.0), 0.0);
        assert_eq!(grade_adjusted_speed(0.0, 0.05), 0.0);
        assert_eq!(grade_adjusted_pace(0.0, 0.05), f64::INFINITY);
        close(grade_adjusted_speed(3.0, 0.1), 3.0 * gap_factor(0.1));
        close(grade_adjusted_pace(0.4, 0.1), 0.4 / gap_factor(0.1));
        close(
            gap_distance_m(&[seg(0.0, 1000.0), seg(0.1, 1000.0), seg(0.1, -50.0)]),
            1000.0 + 1000.0 * gap_factor(0.1),
        );
        // 20:00 for 5 km: about 4.2 m/s over an hour.
        let t = threshold_pace_from_race(5000.0, 1200.0);
        assert!(t > 3.9 && t < 4.5, "{t}");
        assert_eq!(threshold_pace_from_race(0.0, 100.0), 0.0);
    }

    #[test]
    fn zones_and_set_equivalents() {
        assert_eq!(run_zone(2.0, 4.0), ZONE_EASY);
        assert_eq!(run_zone(3.12, 4.0), ZONE_STEADY); // exactly 0.78
        assert_eq!(run_zone(4.0, 4.0), ZONE_STEADY);
        assert_eq!(run_zone(4.01, 4.0), ZONE_HARD);
        assert_eq!(run_zone(f64::NAN, 4.0), ZONE_HARD);
        let e = run_set_equivalents(10.0, 1.0);
        close(e.quads, 1.8);
        close(e.calves, 0.8 * 1.8);
        close(e.glutes, 0.5 * 1.8);
        close(e.hamstrings, 0.4 * 1.8);
        let h = run_set_equivalents(10.0, 1.5);
        close(h.hamstrings, 0.8 * (0.18 * 1.5 * 10.0));
    }

    #[test]
    fn rbe_and_descent() {
        assert_eq!(rbe_factor(0.0), 1.0);
        close(rbe_factor(3.0), 1.0 - 0.105);
        assert_eq!(rbe_factor(100.0), 0.65);
        let d = descent_damage(300.0, 0.9);
        close(d.quads, 0.4 * 3.0 * 0.9);
        close(d.calves, 0.25 * 3.0 * 0.9);
    }

    #[test]
    fn srpe_ratio_needs_ten_pairs_and_positive_rtss() {
        let pair = |l: f64, r: f64| SrpeRtssPair {
            srpe_load: l,
            r_tss: r,
        };
        assert_eq!(srpe_load_ratio(&[]), SRPE_PER_100_RTSS_PRIOR);
        let nine: Vec<_> = (0..9).map(|_| pair(5.0, 100.0)).collect();
        assert_eq!(srpe_load_ratio(&nine), SRPE_PER_100_RTSS_PRIOR);
        let ten: Vec<_> = (0..10).map(|_| pair(5.0, 100.0)).collect();
        assert_eq!(srpe_load_ratio(&ten), 5.0);
        let zero: Vec<_> = (0..10).map(|_| pair(5.0, 0.0)).collect();
        assert_eq!(srpe_load_ratio(&zero), SRPE_PER_100_RTSS_PRIOR);
    }

    #[test]
    fn critical_speed_is_the_slope_through_three_best_efforts() {
        let now = "2026-06-01T00:00:00Z";
        // d = 4 t exactly: slope 4.
        let efforts = [
            effort(400.0, 100.0, "2026-05-20T00:00:00Z"),
            effort(800.0, 200.0, "2026-05-21T00:00:00Z"),
            effort(5000.0, 1250.0, "2026-05-22T00:00:00Z"),
        ];
        close(critical_speed(&efforts, now).unwrap().unwrap(), 4.0);
        // The best (fastest) effort per distance is used.
        let mut more = efforts.to_vec();
        more.push(effort(400.0, 120.0, "2026-05-23T00:00:00Z"));
        close(critical_speed(&more, now).unwrap().unwrap(), 4.0);
        more.push(effort(400.0, 90.0, "2026-05-24T00:00:00Z"));
        assert_ne!(critical_speed(&more, now).unwrap().unwrap(), 4.0);
    }

    #[test]
    fn critical_speed_window_and_missing_distances() {
        let now = "2026-06-01T00:00:00Z";
        let old = effort(400.0, 100.0, "2026-02-01T00:00:00Z");
        let a = effort(800.0, 200.0, "2026-05-21T00:00:00Z");
        let b = effort(5000.0, 1250.0, "2026-05-22T00:00:00Z");
        assert_eq!(
            critical_speed(&[old.clone(), a.clone(), b.clone()], now),
            Ok(None)
        );
        assert_eq!(critical_speed(&[a.clone(), b.clone()], now), Ok(None));
        assert_eq!(critical_speed(&[], now), Ok(None));
        // Exactly 90 days old still counts.
        let edge = effort(400.0, 100.0, "2026-03-03T00:00:00Z");
        assert!(critical_speed(&[edge, a.clone(), b.clone()], now)
            .unwrap()
            .is_some());
        // Same time at three distances: zero variance, no slope.
        let flat = [
            effort(400.0, 100.0, "2026-05-20T00:00:00Z"),
            effort(800.0, 100.0, "2026-05-21T00:00:00Z"),
            effort(5000.0, 100.0, "2026-05-22T00:00:00Z"),
        ];
        assert_eq!(critical_speed(&flat, now), Ok(None));
    }

    #[test]
    fn critical_speed_dates() {
        let a = effort(400.0, 100.0, "2026-05-20T00:00:00Z");
        let b = effort(800.0, 200.0, "2026-05-21T00:00:00Z");
        let c = effort(5000.0, 1250.0, "2026-05-22T00:00:00Z");
        assert!(critical_speed(&[a.clone(), b.clone(), c.clone()], "nope").is_err());
        // A corrupt effort date is skipped, which leaves too few points.
        let bad = effort(400.0, 100.0, "garbage");
        assert_eq!(
            critical_speed(&[bad, b, c], "2026-06-01T00:00:00Z"),
            Ok(None)
        );
    }
}
