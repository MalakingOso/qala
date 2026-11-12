//! GPS fix filter: `packages/run/filter.ts` lines 131-340. Dedupe by timestamp, accuracy gate,
//! speed gate with re-anchor, constant-velocity Kalman filter, Vincenty distance.
//!
//! Streaming and causal: a fix is judged against what came before it only, so the same fixes give
//! the same points whether they arrive one at a time or in a late batch. One push can append zero
//! points (dropped, or buffered as a possible jump), one, or up to `reanchor_count` (a re-anchor
//! emits the buffered fixes that agreed with each other).
//!
//! Order of operations per fix, as in TS:
//! 1. drop a non-finite `t`, `lat`, `lon`, or an `acc` that is not `>= 0` or is above the gate;
//! 2. drop `t <= last accepted t` (a rejected fix never consumes its timestamp);
//! 3. speed gate against the anchor; on a reject buffer the fix, and when the newest
//!    `reanchor_count` buffered fixes agree with each other, re-anchor there;
//! 4. Kalman update in local metres, then Vincenty on the filtered positions.

use super::geo::{vincenty_m, DEG_M};
use super::trig::{cos, hypot2};
use super::{FilteredPoint, Fix, RunError};
use crate::js::js_max;
use std::collections::VecDeque;
use std::f64::consts::PI;

/// Optional overrides; `None` keeps the default.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct FilterOptions {
    /// Drop fixes with `acc` above this (m). Default 25.
    pub accuracy_gate_m: Option<f64>,
    /// Reject jumps implying more than this (m/s). Default 7.
    pub speed_gate_mps: Option<f64>,
    /// Consecutive mutually consistent rejects that force a re-anchor. Default 3, at least 1.
    pub reanchor_count: Option<u32>,
    /// Process-noise acceleration sd (m/s^2). Default 1.5.
    pub accel_noise: Option<f64>,
}

const DEFAULT_ACCURACY_GATE_M: f64 = 25.0;
const DEFAULT_SPEED_GATE_MPS: f64 = 7.0;
const DEFAULT_REANCHOR_COUNT: u32 = 3;
const DEFAULT_ACCEL_NOISE: f64 = 1.5;

/// One axis of the constant-velocity model: state `[pos, vel]` in local metres.
#[derive(Debug, Clone, Copy)]
struct AxisFilter {
    x: f64,
    v: f64,
    p00: f64,
    p01: f64,
    p11: f64,
    accel_var: f64,
}

impl AxisFilter {
    fn new(pos: f64, pos_var: f64, accel_noise: f64) -> Self {
        AxisFilter {
            x: pos,
            v: 0.0,
            p00: pos_var,
            p01: 0.0,
            // Velocity starts unknown: sd of a fast run so the first seconds converge.
            p11: 9.0,
            accel_var: accel_noise * accel_noise,
        }
    }

    fn predict(&mut self, dt: f64) {
        self.x += self.v * dt;
        let p00 = self.p00;
        let p01 = self.p01;
        // Q = G G' a^2 with G = [dt^2/2, dt].
        let q00 = 0.25 * dt * dt * dt * dt * self.accel_var;
        let q01 = 0.5 * dt * dt * dt * self.accel_var;
        let q11 = dt * dt * self.accel_var;
        self.p00 = p00 + dt * (p01 + p01) + dt * dt * self.p11 + q00;
        self.p01 = p01 + dt * self.p11 + q01;
        self.p11 += q11;
    }

    fn update(&mut self, z: f64, r: f64) {
        let y = z - self.x;
        let s = self.p00 + r;
        let k0 = self.p00 / s;
        let k1 = self.p01 / s;
        self.x += k0 * y;
        self.v += k1 * y;
        let p00 = self.p00;
        let p01 = self.p01;
        self.p00 = (1.0 - k0) * p00;
        self.p01 = (1.0 - k0) * p01;
        self.p11 -= k1 * p01;
    }
}

/// The local tangent frame and the two axis filters that live in it.
#[derive(Debug, Clone, Copy)]
struct Track {
    origin_lat: f64,
    origin_lon: f64,
    fx: AxisFilter,
    fy: AxisFilter,
}

impl Track {
    /// `(lon - o.lon) * DEG_M * cos(o.lat * PI / 180)`, and the same for y; the TS writes the
    /// radian conversion as `lat * Math.PI / 180` here, not `lat * (Math.PI / 180)`.
    fn geo_to_local(&self, lat: f64, lon: f64) -> (f64, f64) {
        (
            (lon - self.origin_lon) * DEG_M * cos((self.origin_lat * PI) / 180.0),
            (lat - self.origin_lat) * DEG_M,
        )
    }

    fn local_to_geo(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.origin_lat + y / DEG_M,
            self.origin_lon + x / (DEG_M * cos((self.origin_lat * PI) / 180.0)),
        )
    }
}

/// Streaming filter. Feed fixes in arrival order.
#[derive(Debug, Clone)]
pub struct FixFilter {
    accuracy_gate_m: f64,
    speed_gate_mps: f64,
    reanchor_count: usize,
    accel_noise: f64,

    track: Option<Track>,
    anchor: Option<Fix>,
    pending: VecDeque<Fix>,
    last_t: f64,
    last_lat: f64,
    last_lon: f64,
    dist_m: f64,
    points: Vec<FilteredPoint>,
}

impl FixFilter {
    /// Errors only on `reanchor_count == 0`, which TS turns into a crash on `undefined.lat`.
    pub fn new(opts: &FilterOptions) -> Result<Self, RunError> {
        let reanchor_count = opts.reanchor_count.unwrap_or(DEFAULT_REANCHOR_COUNT);
        if reanchor_count == 0 {
            return Err(RunError::InvalidOption(
                "reanchorCount must be at least 1".into(),
            ));
        }
        Ok(FixFilter {
            accuracy_gate_m: opts.accuracy_gate_m.unwrap_or(DEFAULT_ACCURACY_GATE_M),
            speed_gate_mps: opts.speed_gate_mps.unwrap_or(DEFAULT_SPEED_GATE_MPS),
            reanchor_count: reanchor_count as usize,
            accel_noise: opts.accel_noise.unwrap_or(DEFAULT_ACCEL_NOISE),
            track: None,
            anchor: None,
            pending: VecDeque::new(),
            last_t: f64::NEG_INFINITY,
            last_lat: 0.0,
            last_lon: 0.0,
            dist_m: 0.0,
            points: Vec::new(),
        })
    }

    /// Every accepted point so far.
    pub fn points(&self) -> &[FilteredPoint] {
        &self.points
    }

    /// Consumes the filter, handing over the points.
    pub fn into_points(self) -> Vec<FilteredPoint> {
        self.points
    }

    fn emit(&mut self, fix: &Fix, mark_gap: bool) {
        let r = js_max(fix.acc * fix.acc, 1.0);
        let (ll_lat, ll_lon, speed) = match self.track.as_mut() {
            None => {
                let mut tr = Track {
                    origin_lat: fix.lat,
                    origin_lon: fix.lon,
                    fx: AxisFilter::new(0.0, r, self.accel_noise),
                    fy: AxisFilter::new(0.0, r, self.accel_noise),
                };
                let p = tr.geo_to_local(fix.lat, fix.lon);
                tr.fx = AxisFilter::new(p.0, r, self.accel_noise);
                tr.fy = AxisFilter::new(p.1, r, self.accel_noise);
                let ll = tr.local_to_geo(tr.fx.x, tr.fy.x);
                let speed = hypot2(tr.fx.v, tr.fy.v);
                self.track = Some(tr);
                (ll.0, ll.1, speed)
            }
            Some(tr) => {
                let dt = js_max(fix.t - self.last_t, 0.0);
                let p = tr.geo_to_local(fix.lat, fix.lon);
                if dt > 0.0 {
                    tr.fx.predict(dt);
                    tr.fy.predict(dt);
                }
                tr.fx.update(p.0, r);
                tr.fy.update(p.1, r);
                let ll = tr.local_to_geo(tr.fx.x, tr.fy.x);
                (ll.0, ll.1, hypot2(tr.fx.v, tr.fy.v))
            }
        };
        let mut step = 0.0;
        let mut gap = false;
        if !self.points.is_empty() && !mark_gap {
            step = vincenty_m(self.last_lat, self.last_lon, ll_lat, ll_lon);
        } else if !self.points.is_empty() && mark_gap {
            gap = true;
        }
        self.dist_m += step;
        self.last_t = fix.t;
        self.last_lat = ll_lat;
        self.last_lon = ll_lon;
        self.points.push(FilteredPoint {
            t: fix.t,
            lat: ll_lat,
            lon: ll_lon,
            speed_mps: speed,
            dist_m: self.dist_m,
            acc: fix.acc,
            hr: fix.hr,
            cad: fix.cad,
            ele: fix.ele,
            gap,
        });
    }

    /// Feeds one fix and returns how many points it appended: 0 when it was dropped or buffered
    /// as a possible jump, 1 when accepted, and up to `reanchor_count` when a re-anchor flushes
    /// the buffered fixes that agreed. The new points are the last `n` of [`FixFilter::points`].
    pub fn push(&mut self, fix: &Fix) -> usize {
        // Dedupe against the accepted clock only: a rejected fix (bad accuracy, jump) must not
        // consume its timestamp and eat the good fix sharing it.
        if !fix.t.is_finite() {
            return 0;
        }
        if !self.points.is_empty() && fix.t <= self.last_t {
            return 0;
        }
        if !fix.lat.is_finite() || !fix.lon.is_finite() {
            return 0;
        }
        // `!(acc >= 0)` also drops NaN.
        if !(fix.acc >= 0.0) || fix.acc > self.accuracy_gate_m {
            return 0;
        }

        let Some(anchor) = self.anchor else {
            self.anchor = Some(*fix);
            self.emit(fix, false);
            return 1;
        };

        let dt = fix.t - anchor.t;
        let jump = vincenty_m(anchor.lat, anchor.lon, fix.lat, fix.lon);
        if dt > 0.0 && jump / dt <= self.speed_gate_mps {
            // Accept, flushing nothing: pending rejects stay rejected.
            self.pending.clear();
            self.anchor = Some(*fix);
            self.emit(fix, false);
            return 1;
        }

        // Possible jump: buffer and check whether the newcomers agree with each other rather
        // than with the anchor. Only the latest quorum-sized window can trigger, so the buffer
        // never grows past it.
        self.pending.push_back(*fix);
        while self.pending.len() > self.reanchor_count {
            self.pending.pop_front();
        }
        if self.pending.len() >= self.reanchor_count {
            let tail: Vec<Fix> = self.pending.iter().copied().collect();
            let mut agree = true;
            for i in 1..tail.len() {
                let a = &tail[i - 1];
                let b = &tail[i];
                let d = vincenty_m(a.lat, a.lon, b.lat, b.lon);
                if (b.t - a.t) <= 0.0 || d / (b.t - a.t) > self.speed_gate_mps {
                    agree = false;
                    break;
                }
            }
            if agree {
                // The anchor was wrong, not them: drop the jump, re-anchor at the first agreeing
                // fix and count distance only from there.
                let first = tail[0];
                let r = js_max(first.acc * first.acc, 1.0);
                self.track = Some(Track {
                    origin_lat: first.lat,
                    origin_lon: first.lon,
                    fx: AxisFilter::new(0.0, r, self.accel_noise),
                    fy: AxisFilter::new(0.0, r, self.accel_noise),
                });
                // Pin the clock so the re-anchor point predicts with dt = 0.
                self.last_t = first.t;
                self.anchor = Some(first);
                self.emit(&first, true);
                for f in &tail[1..] {
                    self.anchor = Some(*f);
                    self.emit(f, false);
                }
                self.pending.clear();
                return tail.len();
            }
        }
        0
    }
}

/// Batch convenience over [`FixFilter`]: input order is arrival order; fixes whose timestamps go
/// backwards are dropped as duplicates.
pub fn filter_fixes(fixes: &[Fix], opts: &FilterOptions) -> Result<Vec<FilteredPoint>, RunError> {
    let mut f = FixFilter::new(opts)?;
    for fix in fixes {
        f.push(fix);
    }
    Ok(f.into_points())
}
