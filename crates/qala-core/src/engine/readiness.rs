//! Readiness at session start: `packages/engine/readiness.ts` (PLAN 6.2).
//!
//! A 0-1 score from the PRS z-score (own rolling 4-week window), the soreness grid and the
//! normalised local and systemic fatigue. Load-driven fatigue feeds the Kalman observation and
//! per-muscle bindings, not readiness directly.
//!
//! DELIBERATE DIVERGENCE from TS (docs/archive/completed.md, M1 as built): TS `predictReadiness` reads
//! fatigue as of `state.updated`. [`predict_readiness`] first decays every fatigue field from
//! `state.updated` to an explicit `now`, with the constants and the no-decay-when-`dt <= 0`
//! rule of `decayAll`, and uses `now` as the reference time of the PRS window. For
//! `now == state.updated` the result equals TS. The decay is applied value by value as each
//! fatigue number is read, which gives the same doubles as decaying a clone first.
//!
//! Dates must parse; where TS would carry NaN along these functions return a [`TimeError`].

use super::decay::{decay_value, muscle_tau, TAU_DAMAGE, TAU_SYSTEMIC};
use super::state::{Checkin, DatedValue, EngineState};
use crate::js::{js_max, js_min, ser_num, ser_opt_num};
use crate::time::{days_between, parse_iso, TimeError};
use serde::{Deserialize, Serialize};

const WINDOW_MS: i64 = 28 * 86_400_000;

/// The readiness result. `prs_z` is `null` (not omitted) before enough history exists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    /// 0 to 1.
    #[serde(serialize_with = "ser_num")]
    pub score: f64,
    /// `None` before enough history.
    #[serde(default, serialize_with = "ser_opt_num")]
    pub prs_z: Option<f64>,
    /// z <= -1.5 or PRS <= 4.
    pub prs_flag: bool,
    pub sore_blocked_muscles: Vec<String>,
    pub reasons: Vec<String>,
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().fold(0.0, |a, b| a + b) / xs.len() as f64
}

fn sd(xs: &[f64], m: f64) -> f64 {
    if xs.len() < 2 {
        return 0.0;
    }
    (xs.iter().fold(0.0, |a, b| a + (b - m) * (b - m)) / (xs.len() - 1) as f64).sqrt()
}

/// `prsZScore`: where `prs` sits against the check-ins of the 28 days up to `now_iso`, or `None`
/// with fewer than two of them. A zero spread gives 0.
///
/// Errors only when `now_iso` does not parse. A history entry whose own date does not parse is
/// left out, as TS leaves it out when `NaN >= cutoff` is false.
pub fn prs_z_score(
    history: &[DatedValue],
    now_iso: &str,
    prs: f64,
) -> Result<Option<f64>, TimeError> {
    let cutoff = parse_iso(now_iso)? - WINDOW_MS;
    let vals: Vec<f64> = history
        .iter()
        .filter(|h| parse_iso(&h.date).is_ok_and(|ms| ms >= cutoff))
        .map(|h| h.value)
        .collect();
    if vals.len() < 2 {
        return Ok(None);
    }
    let m = mean(&vals);
    let s = sd(&vals, m);
    if s < 1e-9 {
        return Ok(Some(0.0));
    }
    Ok(Some((prs - m) / s))
}

/// Normalised local fatigue 0-1 for bindings and rest (calibrated scale): about 8 hard
/// set-equivalents is 1.0, clamped to `[0, 1]`.
pub fn fatigue_local(gm: f64) -> f64 {
    js_min(1.0, js_max(0.0, gm / 8.0))
}

/// The readiness math with every fatigue value decayed by `dt` days as it is read (`dt <= 0`
/// reads the stored values) and `now_iso` as the reference time of the PRS window.
fn readiness_at(
    state: &EngineState,
    checkin: &Checkin,
    session_muscles: &[String],
    now_iso: &str,
    dt: f64,
) -> Result<Readiness, TimeError> {
    let fatigue_muscle = |m: &str| {
        state
            .fatigue_muscle
            .get(m)
            .map_or(0.0, |v| decay_value(*v, dt, muscle_tau(m)))
    };
    let fatigue_damage = |m: &str| {
        state
            .fatigue_damage
            .get(m)
            .map_or(0.0, |v| decay_value(*v, dt, TAU_DAMAGE))
    };
    let fatigue_systemic = decay_value(state.fatigue_systemic, dt, TAU_SYSTEMIC);

    let mut reasons: Vec<String> = Vec::new();
    let mut score = 1.0;
    let prs_z = prs_z_score(&state.prs_history, now_iso, checkin.prs)?;
    let prs_flag = prs_z.is_some_and(|z| z <= -1.5) || checkin.prs <= 4.0;
    if prs_flag {
        score -= 0.3;
        reasons.push(
            if checkin.prs <= 4.0 {
                "prs-low"
            } else {
                "prs-z-low"
            }
            .to_string(),
        );
    } else if prs_z.is_some_and(|z| z < -1.0) {
        score -= 0.15;
        reasons.push("prs-dipping".to_string());
    }
    let soreness_is = |m: &str, level: f64| checkin.soreness.get(m) == Some(&level);
    let sore_blocked: Vec<String> = session_muscles
        .iter()
        .filter(|m| soreness_is(m, 4.0))
        .cloned()
        .collect();
    if !sore_blocked.is_empty() {
        score -= 0.2;
        reasons.push(format!("sore-blocked:{}", sore_blocked.join(",")));
    } else if session_muscles.iter().any(|m| soreness_is(m, 3.0)) {
        score -= 0.05;
        reasons.push("sore-healing".to_string());
    }
    let g_session = if session_muscles.is_empty() {
        0.0
    } else {
        session_muscles
            .iter()
            .fold(0.0, |a, m| a + fatigue_muscle(m) + fatigue_damage(m))
            / session_muscles.len() as f64
    };
    let local_penalty = js_min(0.2, 0.2 * fatigue_local(g_session));
    if local_penalty > 0.01 {
        score -= local_penalty;
        reasons.push("local-fatigue".to_string());
    }
    let sys_penalty = js_min(0.15, 0.15 * js_min(1.0, fatigue_systemic / 6.0));
    if sys_penalty > 0.01 {
        score -= sys_penalty;
        reasons.push("systemic-fatigue".to_string());
    }
    Ok(Readiness {
        score: js_min(1.0, js_max(0.0, score)),
        prs_z,
        prs_flag,
        sore_blocked_muscles: sore_blocked,
        reasons,
    })
}

/// `predictReadiness` of readiness.ts: the state is read as stored (no decay) and `now_iso` is
/// only the reference time of the PRS window. Errors when `now_iso` does not parse.
pub fn predict_readiness_core(
    state: &EngineState,
    checkin: &Checkin,
    session_muscles: &[String],
    now_iso: &str,
) -> Result<Readiness, TimeError> {
    readiness_at(state, checkin, session_muscles, now_iso, 0.0)
}

/// Readiness at `now_iso`: decays the state from `state.updated` to `now_iso` first (see the
/// module docs), then runs the readiness math. `session_muscles` defaults to the check-in's
/// soreness keys in sorted order (TS uses insertion order; the order only affects the
/// `sore-blocked:` reason text and the last bits of the fatigue average). Errors when
/// `state.updated` or `now_iso` does not parse.
pub fn predict_readiness(
    state: &EngineState,
    checkin: &Checkin,
    session_muscles: Option<&[String]>,
    now_iso: &str,
) -> Result<Readiness, TimeError> {
    let dt = days_between(&state.updated, now_iso)?;
    match session_muscles {
        Some(muscles) => readiness_at(state, checkin, muscles, now_iso, dt),
        None => {
            let muscles: Vec<String> = checkin.soreness.keys().cloned().collect();
            readiness_at(state, checkin, &muscles, now_iso, dt)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::decay::decay_all;
    use crate::engine::state::initial_state;

    const T0: &str = "2026-03-01T12:00:00Z";

    fn checkin(prs: f64, soreness: &[(&str, f64)]) -> Checkin {
        Checkin {
            prs,
            soreness: soreness
                .iter()
                .map(|(m, v)| ((*m).to_string(), *v))
                .collect(),
        }
    }

    fn muscles(ms: &[&str]) -> Vec<String> {
        ms.iter().map(|m| (*m).to_string()).collect()
    }

    fn state_with_history(values: &[f64]) -> EngineState {
        let mut s = initial_state();
        s.updated = T0.to_string();
        for (i, v) in values.iter().enumerate() {
            s.prs_history.push(DatedValue {
                date: format!("2026-02-{:02}T12:00:00Z", 10 + i),
                value: *v,
            });
        }
        s
    }

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-12, "{a} vs {b}");
    }

    #[test]
    fn empty_state_is_fully_ready() {
        let r = predict_readiness(
            &initial_state(),
            &checkin(8.0, &[]),
            None,
            "2026-03-01T12:00:00Z",
        )
        .unwrap();
        assert_eq!(r.score, 1.0);
        assert_eq!(r.prs_z, None);
        assert!(!r.prs_flag);
        assert!(r.sore_blocked_muscles.is_empty());
        assert!(r.reasons.is_empty());
    }

    #[test]
    fn serializes_prs_z_as_null_not_missing() {
        let r = predict_readiness(&initial_state(), &checkin(8.0, &[]), None, T0).unwrap();
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"score":1,"prsZ":null,"prsFlag":false,"soreBlockedMuscles":[],"reasons":[]}"#
        );
    }

    #[test]
    fn low_prs_flags_and_costs_point_three() {
        let r = predict_readiness(&initial_state(), &checkin(4.0, &[]), None, T0).unwrap();
        assert!(r.prs_flag);
        assert_eq!(r.score, 1.0 - 0.3);
        assert_eq!(r.reasons, ["prs-low"]);
        let r = predict_readiness(&initial_state(), &checkin(4.5, &[]), None, T0).unwrap();
        assert!(!r.prs_flag);
    }

    #[test]
    fn z_score_flag_and_dip() {
        let s = state_with_history(&[8.0, 8.5, 9.0, 8.5]);
        let r = predict_readiness(&s, &checkin(5.0, &[]), None, T0).unwrap();
        assert!(r.prs_flag);
        assert_eq!(r.reasons, ["prs-z-low"]);
        assert_eq!(r.score, 1.0 - 0.3);
        assert!(r.prs_z.unwrap() < -1.5);
        // [6, 8, 10]: mean 8, sd 2. PRS 5.6 is z = -1.2: dipping, not flagged.
        let s = state_with_history(&[6.0, 8.0, 10.0]);
        let r = predict_readiness(&s, &checkin(5.6, &[]), None, T0).unwrap();
        close(r.prs_z.unwrap(), -1.2);
        assert!(!r.prs_flag);
        assert_eq!(r.reasons, ["prs-dipping"]);
        assert_eq!(r.score, 1.0 - 0.15);
        // PRS at the mean: no reason at all.
        let r = predict_readiness(&s, &checkin(8.0, &[]), None, T0).unwrap();
        assert_eq!(r.prs_z, Some(0.0));
        assert!(r.reasons.is_empty());
    }

    #[test]
    fn z_score_edges() {
        // Zero spread gives z = 0; one point is not enough; out-of-window points are ignored.
        let s = state_with_history(&[7.0, 7.0, 7.0]);
        assert_eq!(prs_z_score(&s.prs_history, T0, 3.0), Ok(Some(0.0)));
        let one = state_with_history(&[7.0]);
        assert_eq!(prs_z_score(&one.prs_history, T0, 3.0), Ok(None));
        assert_eq!(prs_z_score(&[], T0, 3.0), Ok(None));
        let hist = vec![
            DatedValue {
                date: "2026-01-31T12:00:00Z".into(),
                value: 1.0,
            }, // 29 days: out
            DatedValue {
                date: "2026-02-01T12:00:00Z".into(),
                value: 6.0,
            }, // exactly 28 days: in
            DatedValue {
                date: "2026-02-20T12:00:00Z".into(),
                value: 10.0,
            },
        ];
        let z = prs_z_score(&hist, T0, 4.0).unwrap().unwrap();
        // mean 8, sd sqrt(8), z = -4 / sqrt(8)
        close(z, -4.0 / 8.0f64.sqrt());
        // A corrupt history date is skipped, a corrupt reference time is an error.
        let mut bad = hist.clone();
        bad.push(DatedValue {
            date: "oops".into(),
            value: 99.0,
        });
        assert_eq!(prs_z_score(&bad, T0, 4.0).unwrap().unwrap(), z);
        assert!(prs_z_score(&hist, "oops", 4.0).is_err());
    }

    #[test]
    fn soreness_blocks_and_heals() {
        let s = initial_state();
        let c = checkin(8.0, &[("quads", 4.0), ("chest", 2.0)]);
        let r = predict_readiness(&s, &c, Some(&muscles(&["quads", "chest"])), T0).unwrap();
        assert_eq!(r.score, 1.0 - 0.2);
        assert_eq!(r.sore_blocked_muscles, ["quads"]);
        assert_eq!(r.reasons, ["sore-blocked:quads"]);
        let c = checkin(8.0, &[("quads", 3.0)]);
        let r = predict_readiness(&s, &c, Some(&muscles(&["quads"])), T0).unwrap();
        assert_eq!(r.score, 1.0 - 0.05);
        assert_eq!(r.reasons, ["sore-healing"]);
        // A muscle outside the session does not count.
        let r = predict_readiness(&s, &c, Some(&muscles(&["chest"])), T0).unwrap();
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn default_muscles_are_the_sorted_soreness_keys() {
        let s = initial_state();
        let c = checkin(8.0, &[("quads", 4.0), ("chest", 4.0), ("lats", 1.0)]);
        let r = predict_readiness(&s, &c, None, T0).unwrap();
        assert_eq!(r.sore_blocked_muscles, ["chest", "quads"]);
        assert_eq!(r.reasons, ["sore-blocked:chest,quads"]);
        // An explicit empty list is respected: nothing is blocked.
        let r = predict_readiness(&s, &c, Some(&[]), T0).unwrap();
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn local_and_systemic_fatigue_penalties() {
        let mut s = initial_state();
        s.updated = T0.to_string();
        s.fatigue_muscle.insert("quads".into(), 8.0);
        let c = checkin(8.0, &[]);
        let r = predict_readiness(&s, &c, Some(&muscles(&["quads"])), T0).unwrap();
        assert_eq!(r.score, 1.0 - 0.2);
        assert_eq!(r.reasons, ["local-fatigue"]);
        // Damage counts too, and the average is over the session muscles.
        s.fatigue_muscle.insert("quads".into(), 4.0);
        s.fatigue_damage.insert("calves".into(), 4.0);
        let r = predict_readiness(&s, &c, Some(&muscles(&["quads", "calves"])), T0).unwrap();
        assert_eq!(r.score, 1.0 - 0.2 * (4.0 / 8.0));
        // Below the 0.01 cut-off the penalty is not applied.
        s.fatigue_muscle.insert("quads".into(), 0.3);
        let r = predict_readiness(&s, &c, Some(&muscles(&["quads"])), T0).unwrap();
        assert_eq!(r.score, 1.0);
        s.fatigue_systemic = 6.0;
        let r = predict_readiness(&s, &c, Some(&muscles(&[])), T0).unwrap();
        assert_eq!(r.score, 1.0 - 0.15);
        assert_eq!(r.reasons, ["systemic-fatigue"]);
        s.fatigue_systemic = 600.0;
        let r = predict_readiness(&s, &c, Some(&muscles(&[])), T0).unwrap();
        assert_eq!(r.score, 1.0 - 0.15);
    }

    #[test]
    fn all_penalties_stack_within_zero_one() {
        let mut s = state_with_history(&[8.0, 8.5, 9.0, 8.5]);
        s.fatigue_muscle.insert("quads".into(), 80.0);
        s.fatigue_systemic = 60.0;
        let c = checkin(1.0, &[("quads", 4.0)]);
        let r = predict_readiness(&s, &c, Some(&muscles(&["quads"])), T0).unwrap();
        assert_eq!(r.reasons.len(), 4);
        close(r.score, 1.0 - 0.3 - 0.2 - 0.2 - 0.15);
        assert!((0.0..=1.0).contains(&r.score));
    }

    #[test]
    fn decays_to_now_like_decay_all() {
        let mut s = initial_state();
        s.updated = T0.to_string();
        s.fatigue_muscle.insert("quads".into(), 8.0);
        s.fatigue_damage.insert("quads".into(), 4.0);
        s.fatigue_systemic = 6.0;
        let c = checkin(8.0, &[]);
        let ms = muscles(&["quads"]);
        for now in [
            "2026-03-01T12:00:00Z",
            "2026-03-02T12:00:00Z",
            "2026-03-04T00:00:00-05:00",
            "2026-03-11T12:00:00Z",
            "2026-02-20T12:00:00Z", // before updated: no decay
        ] {
            let got = predict_readiness(&s, &c, Some(&ms), now).unwrap();
            let mut decayed = s.clone();
            decay_all(&mut decayed, days_between(&s.updated, now).unwrap());
            let want = predict_readiness_core(&decayed, &c, &ms, now).unwrap();
            assert_eq!(got, want, "{now}");
        }
        // Ten days on, systemic 6 * e^-1 and local (8 e^-4 + 4 e^-2) / 8-scale.
        let r = predict_readiness(&s, &c, Some(&ms), "2026-03-11T12:00:00Z").unwrap();
        assert!(r.reasons.contains(&"systemic-fatigue".to_string()));
        assert!(r.score > 1.0 - 0.35 && r.score < 1.0);
    }

    #[test]
    fn at_updated_it_equals_the_core() {
        let mut s = state_with_history(&[6.0, 8.0, 10.0]);
        s.fatigue_muscle.insert("quads".into(), 5.0);
        s.fatigue_systemic = 3.0;
        let c = checkin(5.0, &[("quads", 3.0)]);
        let ms = muscles(&["quads"]);
        let a = predict_readiness(&s, &c, Some(&ms), T0).unwrap();
        let b = predict_readiness_core(&s, &c, &ms, T0).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn bad_dates_are_errors() {
        let mut s = initial_state();
        let c = checkin(8.0, &[]);
        assert!(predict_readiness(&s, &c, None, "oops").is_err());
        assert!(predict_readiness_core(&s, &c, &[], "oops").is_err());
        s.updated = "oops".into();
        assert!(predict_readiness(&s, &c, None, T0).is_err());
    }

    #[test]
    fn fatigue_local_clamps() {
        assert_eq!(fatigue_local(-3.0), 0.0);
        assert_eq!(fatigue_local(0.0), 0.0);
        assert_eq!(fatigue_local(4.0), 0.5);
        assert_eq!(fatigue_local(8.0), 1.0);
        assert_eq!(fatigue_local(80.0), 1.0);
    }
}
