//! Splits: `packages/run/splits.ts`. One boundary per split unit (mile by default, configurable),
//! with the crossing time interpolated linearly between the two fixes straddling it.
//!
//! Split times use the fix clock (elapsed time, pauses included): a split covers the wall time
//! between its boundary crossings. A trailing partial split is included when it reaches
//! `min_partial_m`.

use super::{FilteredPoint, Split};

/// Metres per mile (the default split unit).
pub const MILE_M: f64 = 1609.344;
/// Metres per kilometre.
pub const KM_M: f64 = 1000.0;

/// More boundaries than this are not computed (a 100 km run in 1 m splits). TS would loop
/// without bound; the JSON boundary rejects such a unit before it gets here.
pub const MAX_SPLITS: usize = 100_000;

/// Optional overrides; `None` keeps the default.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct SplitOptions {
    /// Boundary spacing in metres. Default one mile.
    pub split_m: Option<f64>,
    /// Trailing partial splits under this length (m) are dropped. Default 1.
    pub min_partial_m: Option<f64>,
}

/// Reads `t`, `dist_m` and `hr` of each point.
pub fn compute_splits(points: &[FilteredPoint], opts: &SplitOptions) -> Vec<Split> {
    let split_m = opts.split_m.unwrap_or(MILE_M);
    let min_partial_m = opts.min_partial_m.unwrap_or(1.0);
    let (Some(first), Some(last)) = (points.first(), points.last()) else {
        return Vec::new();
    };
    if !(split_m > 0.0) || points.len() < 2 {
        return Vec::new();
    }
    let t0 = first.t;
    let total = last.dist_m;
    let full = (total / split_m).floor();
    let mut splits: Vec<Split> = Vec::new();
    let mut prev_t = t0;
    let mut prev_boundary = 0.0;
    let mut seg: u32 = 1;
    let mut n = 1.0;
    while n <= full && splits.len() < MAX_SPLITS {
        let boundary = n * split_m;
        let Some(cross) = crossing_at(points, prev_boundary, boundary) else {
            break;
        };
        splits.push(Split {
            index: seg,
            dist_m: split_m,
            sec: cross.0 - prev_t,
            cum_dist_m: boundary,
            cum_sec: cross.0 - t0,
            hr_avg: cross.1,
        });
        seg += 1;
        prev_t = cross.0;
        prev_boundary = boundary;
        n += 1.0;
    }
    let rest = total - full * split_m;
    if rest >= min_partial_m {
        let end_t = last.t;
        let mut count = 0usize;
        let mut sum = 0.0;
        for p in points {
            if p.dist_m > full * split_m {
                if let Some(hr) = p.hr {
                    sum += hr;
                    count += 1;
                }
            }
        }
        splits.push(Split {
            index: seg,
            dist_m: rest,
            sec: end_t - prev_t,
            cum_dist_m: total,
            cum_sec: end_t - t0,
            hr_avg: (count > 0).then(|| sum / count as f64),
        });
    }
    splits
}

/// First crossing of `boundary` and the mean HR of the points since `from_dist`, as TS scans:
/// from the first point, remembering the previous one.
fn crossing_at(
    points: &[FilteredPoint],
    from_dist: f64,
    boundary: f64,
) -> Option<(f64, Option<f64>)> {
    let mut prev: Option<&FilteredPoint> = None;
    let mut hr_sum = 0.0;
    let mut hr_count = 0usize;
    for p in points {
        if p.dist_m > from_dist && p.dist_m < boundary {
            if let Some(hr) = p.hr {
                hr_sum += hr;
                hr_count += 1;
            }
        }
        if let Some(prev) = prev {
            if prev.dist_m < boundary && p.dist_m >= boundary {
                let span = p.dist_m - prev.dist_m;
                let t = if span > 0.0 {
                    prev.t + (p.t - prev.t) * ((boundary - prev.dist_m) / span)
                } else {
                    p.t
                };
                if let Some(hr) = p.hr {
                    hr_sum += hr;
                    hr_count += 1;
                }
                return Some((t, (hr_count > 0).then(|| hr_sum / hr_count as f64)));
            }
        }
        prev = Some(p);
    }
    None
}

/// True when a split unit is usable by the JSON boundary: finite and at least one metre.
pub fn valid_split_m(split_m: f64) -> bool {
    split_m.is_finite() && split_m >= 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(count: usize, speed: f64, dt: f64) -> Vec<FilteredPoint> {
        (0..count)
            .map(|i| {
                let t = i as f64 * dt;
                FilteredPoint::sample(t, t * speed, speed, None)
            })
            .collect()
    }

    #[test]
    fn two_miles_at_3_mps() {
        let pts = line(1100, 3.0, 1.0);
        let s = compute_splits(&pts, &SplitOptions::default());
        assert_eq!(s.len(), 3);
        assert!((s[0].sec - MILE_M / 3.0).abs() < 1e-9);
        assert_eq!(s[0].dist_m, MILE_M);
        assert_eq!(s[1].index, 2);
        assert!(s[2].dist_m < MILE_M);
        assert_eq!(s[2].cum_dist_m, pts[1099].dist_m);
    }

    #[test]
    fn crossings_interpolate_between_sparse_fixes() {
        let pts = line(120, 3.0, 10.0);
        let s = compute_splits(&pts, &SplitOptions::default());
        assert_eq!(s.len(), 3);
        assert!((s[0].sec - MILE_M / 3.0).abs() < 1e-9);
    }

    #[test]
    fn unit_is_configurable_and_degenerate_input_is_empty() {
        let pts = line(1300, 3.0, 1.0);
        let s = compute_splits(
            &pts,
            &SplitOptions {
                split_m: Some(KM_M),
                min_partial_m: None,
            },
        );
        assert_eq!(s.len(), 4);
        assert!(compute_splits(&[], &SplitOptions::default()).is_empty());
        assert!(compute_splits(&pts[..1], &SplitOptions::default()).is_empty());
        let zero = SplitOptions {
            split_m: Some(0.0),
            min_partial_m: None,
        };
        assert!(compute_splits(&pts, &zero).is_empty());
        let nan = SplitOptions {
            split_m: Some(f64::NAN),
            min_partial_m: None,
        };
        assert!(compute_splits(&pts, &nan).is_empty());
    }

    #[test]
    fn hr_is_averaged_per_split_and_partials_below_the_minimum_are_dropped() {
        let mut pts = line(700, 3.0, 1.0);
        for (i, p) in pts.iter_mut().enumerate() {
            p.hr = Some(100.0 + (i % 10) as f64);
        }
        let s = compute_splits(
            &pts,
            &SplitOptions {
                split_m: Some(KM_M),
                min_partial_m: None,
            },
        );
        assert!(s[0].hr_avg.is_some());
        let tight = SplitOptions {
            split_m: Some(1000.0),
            min_partial_m: Some(1e9),
        };
        assert_eq!(compute_splits(&pts, &tight).len(), 2);
    }

    #[test]
    fn split_unit_validation() {
        assert!(valid_split_m(1000.0));
        assert!(!valid_split_m(0.5));
        assert!(!valid_split_m(f64::NAN));
        assert!(!valid_split_m(f64::INFINITY));
    }
}
