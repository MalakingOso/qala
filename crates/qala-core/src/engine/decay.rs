//! Discrete-time decay: `packages/engine/decay.ts`, plus `decayAll` from mod.ts.
//!
//! `x_t = x_{t-1} * exp(-dt/tau) + k*input`, with `dt` in days from ISO 8601 instants (exact
//! milliseconds, so DST and month lengths cannot skew it).

use super::state::EngineState;
use crate::js::is_js_whitespace;
use std::collections::BTreeMap;

pub use crate::time::days_between;

pub const TAU_FITNESS_LIFT: f64 = 45.0;
pub const TAU_SYSTEMIC: f64 = 10.0;
pub const TAU_FITNESS_RUN: f64 = 42.0;
pub const TAU_DAMAGE: f64 = 5.0;

/// `x * exp(-dt/tau)`; unchanged when `dt` is not positive (or NaN).
pub fn decay_value(x: f64, dt_days: f64, tau: f64) -> f64 {
    if dt_days.is_nan() || dt_days <= 0.0 {
        return x;
    }
    x * (-dt_days / tau).exp()
}

/// Decay then add `k * input`.
pub fn apply_input(x: f64, dt_days: f64, tau: f64, k: f64, input: f64) -> f64 {
    decay_value(x, dt_days, tau) + k * input
}

/// Decays every value of a record with a per-key tau.
pub fn decay_record(
    rec: &BTreeMap<String, f64>,
    dt_days: f64,
    tau_for: impl Fn(&str) -> f64,
) -> BTreeMap<String, f64> {
    rec.iter()
        .map(|(k, v)| (k.clone(), decay_value(*v, dt_days, tau_for(k))))
        .collect()
}

/// Muscle ids with the slower 2.5 d fatigue tau, after lowercasing and dropping `_` and spaces.
const TAU_2_5: [&str; 11] = [
    "lats",
    "upperback",
    "upper-back",
    "back",
    "quads",
    "quadriceps",
    "hamstrings",
    "glutes",
    "calves",
    "lowerback",
    "lower-back",
];

/// Per-muscle fatigue tau (PLAN 6.2): 2.0 d default, 2.5 d for posterior and large groups.
pub fn muscle_tau(muscle: &str) -> f64 {
    let key: String = muscle
        .to_lowercase()
        .chars()
        .filter(|c| *c != '_' && !is_js_whitespace(*c))
        .collect();
    if TAU_2_5.contains(&key.as_str()) {
        2.5
    } else {
        2.0
    }
}

/// `decayAll` in mod.ts: decays every fitness and fatigue field of `s` by `dt` days in place.
/// A `dt` that is not positive leaves the state untouched.
pub fn decay_all(s: &mut EngineState, dt: f64) {
    if dt.is_nan() || dt <= 0.0 {
        return;
    }
    for v in s.fitness.values_mut() {
        *v = decay_value(*v, dt, TAU_FITNESS_LIFT);
    }
    s.fatigue_muscle = decay_record(&s.fatigue_muscle, dt, muscle_tau);
    s.run_fatigue_muscle = decay_record(&s.run_fatigue_muscle, dt, muscle_tau);
    for v in s.fatigue_damage.values_mut() {
        *v = decay_value(*v, dt, TAU_DAMAGE);
    }
    for v in s.run_fatigue_damage.values_mut() {
        *v = decay_value(*v, dt, TAU_DAMAGE);
    }
    s.fatigue_systemic = decay_value(s.fatigue_systemic, dt, TAU_SYSTEMIC);
    s.fitness_run = decay_value(s.fitness_run, dt, TAU_FITNESS_RUN);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decay_value_follows_the_exponential() {
        assert_eq!(decay_value(10.0, 0.0, 5.0), 10.0);
        assert_eq!(decay_value(10.0, -3.0, 5.0), 10.0);
        assert_eq!(decay_value(10.0, f64::NAN, 5.0), 10.0);
        let v = decay_value(10.0, 5.0, 5.0);
        assert!((v - 10.0 * (-1.0f64).exp()).abs() < 1e-15);
        assert_eq!(decay_value(0.0, 5.0, 5.0), 0.0);
    }

    #[test]
    fn apply_input_decays_then_adds() {
        let v = apply_input(10.0, 5.0, 5.0, 2.0, 3.0);
        assert!((v - (10.0 * (-1.0f64).exp() + 6.0)).abs() < 1e-15);
        assert_eq!(apply_input(10.0, 0.0, 5.0, 2.0, 3.0), 16.0);
    }

    #[test]
    fn muscle_tau_groups() {
        for m in [
            "quads",
            "Quads",
            "lats",
            "upper_back",
            "Upper Back",
            "upper-back",
            "lower back",
            "LowerBack",
            "calves",
            "glutes",
            "hamstrings",
            "quadriceps",
            "back",
        ] {
            assert_eq!(muscle_tau(m), 2.5, "{m}");
        }
        for m in [
            "chest",
            "biceps",
            "triceps",
            "shoulders",
            "delts",
            "abs",
            "forearms",
            "backs",
            "",
        ] {
            assert_eq!(muscle_tau(m), 2.0, "{m}");
        }
    }

    #[test]
    fn decay_record_uses_the_per_key_tau() {
        let mut rec = BTreeMap::new();
        rec.insert("quads".to_string(), 8.0);
        rec.insert("chest".to_string(), 8.0);
        let out = decay_record(&rec, 2.0, muscle_tau);
        assert_eq!(out["quads"], 8.0 * (-2.0f64 / 2.5).exp());
        assert_eq!(out["chest"], 8.0 * (-1.0f64).exp());
    }

    #[test]
    fn decay_all_touches_every_field_and_skips_non_positive_dt() {
        let mut s = EngineState::default();
        s.fitness.insert("squat".into(), 4.0);
        s.fatigue_muscle.insert("quads".into(), 6.0);
        s.fatigue_damage.insert("quads".into(), 2.0);
        s.run_fatigue_muscle.insert("calves".into(), 3.0);
        s.run_fatigue_damage.insert("calves".into(), 1.0);
        s.fatigue_systemic = 5.0;
        s.fitness_run = 7.0;
        let before = s.clone();
        decay_all(&mut s, 0.0);
        assert_eq!(s, before);
        decay_all(&mut s, -1.0);
        assert_eq!(s, before);
        decay_all(&mut s, f64::NAN);
        assert_eq!(s, before);
        decay_all(&mut s, 10.0);
        assert_eq!(s.fitness["squat"], 4.0 * (-10.0f64 / 45.0).exp());
        assert_eq!(s.fatigue_muscle["quads"], 6.0 * (-10.0f64 / 2.5).exp());
        assert_eq!(s.fatigue_damage["quads"], 2.0 * (-10.0f64 / 5.0).exp());
        assert_eq!(s.run_fatigue_muscle["calves"], 3.0 * (-10.0f64 / 2.5).exp());
        assert_eq!(s.run_fatigue_damage["calves"], 1.0 * (-10.0f64 / 5.0).exp());
        assert_eq!(s.fatigue_systemic, 5.0 * (-10.0f64 / 10.0).exp());
        assert_eq!(s.fitness_run, 7.0 * (-10.0f64 / 42.0).exp());
    }

    #[test]
    fn days_between_is_reexported() {
        assert_eq!(
            days_between("2026-01-01T00:00:00Z", "2026-01-03T12:00:00Z"),
            Ok(2.5)
        );
    }
}
