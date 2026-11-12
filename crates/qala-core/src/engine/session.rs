//! `logSession` and `calibrate`: the deleted TS `engine/mod.ts` lines 72-301 and 475-482.
//!
//! The order of operations and of floating point sums follows the TS line by line, so the
//! doubles match. Dates must parse: where `Date.parse` would give NaN and the TS code would
//! carry on silently, these functions return a [`TimeError`] and leave the input state alone.
//!
//! Differences from TS, all unobservable for valid input:
//! - `clone` is a Rust `clone`, not `JSON.parse(JSON.stringify(s))`. The JSON round trip would
//!   turn a NaN or infinite field into `null`, which TS then reads as 0.
//! - `liftInput` in `applyLift` is written but never read in TS, so it is not computed here.
//! - `calibrate` parses every date up front (an invalid one is an error) and sorts on the
//!   parsed milliseconds with a stable sort, which is what the TS comparator does for valid dates.

use super::decay::{days_between, decay_all};
use super::e1rm::best_observation;
use super::kalman::{init_kalman, kalman_update};
use super::running::{
    critical_speed, descent_damage, intensity_factor, mean_gap_factor, rbe_factor, rtss,
    run_set_equivalents, run_zone, srpe_load_ratio, vdot_from_effort, RunZone, ZONE_STEADY,
};
use super::state::{
    initial_state, is_lower_body_lift, BestEffort, Checkin, DailyLoad, DatedValue, EngineState,
    JointPainEntry, LastCheckin, LastRun, LiftSessionLog, LiftWorkout, ReferenceRm, RunLog,
    RunWorkout, SrpeRtssPair, Workout,
};
use crate::js::{js_max, js_min, js_truthy};
use crate::time::{parse_iso, TimeError};
use std::collections::BTreeMap;

/// Fatigue weight of one working set: `1 + 0.1 * (rpe - 8)` clamped to 0.5..=1.5, with RPE
/// falling back to the target RPE and then to 8.
pub fn set_factor(rpe: Option<f64>, target_rpe: Option<f64>) -> f64 {
    let r = rpe.or(target_rpe).unwrap_or(8.0);
    js_min(1.5, js_max(0.5, 1.0 + 0.1 * (r - 8.0)))
}

/// `rec[key] = (rec[key] ?? 0) + v`.
fn add_to(rec: &mut BTreeMap<String, f64>, key: &str, v: f64) {
    *rec.entry(key.to_string()).or_insert(0.0) += v;
}

/// `Date.parse` as a double: NaN when the text does not parse, so comparisons come out false.
fn ms_or_nan(iso: &str) -> f64 {
    parse_iso(iso).map_or(f64::NAN, |ms| ms as f64)
}

/// The check-in bookkeeping of `applyLift`: PRS history, the two soreness snapshots and
/// `lastCheckin`. The adapter uses it for standalone check-ins on rest days.
pub fn apply_checkin(s: &mut EngineState, date: &str, checkin: &Checkin) {
    s.prs_history.push(DatedValue {
        date: date.to_string(),
        value: checkin.prs,
    });
    s.soreness_prev_prev = s.soreness_prev.take();
    s.soreness_prev = Some(checkin.soreness.clone());
    s.last_checkin = Some(LastCheckin {
        prs: checkin.prs,
        soreness: checkin.soreness.clone(),
        date: date.to_string(),
    });
}

/// `applyLift`: adds a lift session's fatigue, fitness, Kalman observations and logs to `s`.
/// `s` is assumed to be already decayed to the workout's date.
pub fn apply_lift(s: &mut EngineState, w: &LiftWorkout) {
    let mut quad_set_eq = 0.0;
    let mut heavy_lower = false;
    for e in &w.entries {
        let main = e
            .is_main
            .unwrap_or_else(|| s.main_lifts.iter().any(|m| m == &e.exercise_id));
        // Snapshot the e1RM observation's inputs before this entry's own sets add to
        // fitness and fatigue below: the Kalman filter must be fit against the state the lifter
        // carried into the set, not state already inflated by the sets that produced it.
        let prev_fitness = s.fitness.get(&e.exercise_id).copied().unwrap_or(0.0);
        let prev_gw = if main {
            let targets = e.targets.iter().fold(0.0, |a, t| {
                a + s.fatigue_muscle.get(t).copied().unwrap_or(0.0)
            });
            let synergists = e.synergists.iter().fold(0.0, |a, m| {
                a + 0.5 * s.fatigue_muscle.get(m).copied().unwrap_or(0.0)
            });
            targets + synergists
        } else {
            0.0
        };
        let mut vol_load = 0.0;
        for set in &e.sets {
            if !set.completed || set.warmup {
                continue;
            }
            let f = set_factor(set.rpe, set.target_rpe);
            for t in &e.targets {
                add_to(&mut s.fatigue_muscle, t, f);
            }
            for sy in &e.synergists {
                add_to(&mut s.fatigue_muscle, sy, 0.5 * f);
            }
            vol_load += set.w * set.r;
            if e.targets.iter().any(|t| t.to_lowercase().contains("quad")) {
                quad_set_eq += f;
            }
            if set.joint_pain {
                s.joint_pain_log.push(JointPainEntry {
                    date: w.date.clone(),
                    exercise_id: e.exercise_id.clone(),
                });
            }
        }
        if main {
            // The reference 1RM updates only on a new tested 1RM; the engine has no block
            // boundary concept yet (docs/CONTEXT.md).
            let est = s
                .reference_rm
                .get(&e.exercise_id)
                .map_or(100.0, |r| r.weight);
            s.fitness.insert(
                e.exercise_id.clone(),
                prev_fitness + vol_load / js_max(1.0, est),
            );
            if let Some(obs) = best_observation(&e.sets) {
                // The seed value of p0 is inert: the first observation exact-fits p0 to y.
                let k = s
                    .kalman
                    .entry(e.exercise_id.clone())
                    .or_insert_with(|| init_kalman(est, 0.5, 4.0, 4.0))
                    .clone();
                let noise = if obs.tested { 0.25 } else { 1.0 };
                // `lastRun.date` is the run's start; the gap to the lift is measured from when
                // the run actually ended.
                let run_before_lift = match &s.last_run {
                    Some(lr) => {
                        let last_run_end_ms = ms_or_nan(&lr.date) + lr.minutes * 60_000.0;
                        (ms_or_nan(&w.date) - last_run_end_ms) / 3_600_000.0 < 8.0
                            && lr.minutes >= 30.0
                            && is_lower_body_lift(&e.exercise_id)
                    }
                    None => false,
                };
                let updated = kalman_update(
                    &k,
                    prev_fitness,
                    prev_gw + s.fatigue_systemic,
                    obs.e1rm,
                    if run_before_lift { noise * 2.0 } else { noise },
                );
                s.kalman.insert(e.exercise_id.clone(), updated);
                s.e1rm_obs
                    .entry(e.exercise_id.clone())
                    .or_default()
                    .push(DatedValue {
                        date: w.date.clone(),
                        value: obs.e1rm,
                    });
                if obs.tested {
                    s.reference_rm.insert(
                        e.exercise_id.clone(),
                        ReferenceRm {
                            weight: obs.e1rm,
                            date: w.date.clone(),
                            source: "tested".to_string(),
                        },
                    );
                }
            }
        }
        if is_lower_body_lift(&e.exercise_id) && vol_load > 0.0 {
            heavy_lower = true;
        }
    }
    // `w.srpe !== undefined && w.minutes` is a truthiness test on minutes: 0 skips it.
    let srpe_load = match (w.srpe, w.minutes) {
        (Some(srpe), Some(minutes)) if js_truthy(minutes) => Some((srpe * minutes) / 100.0),
        _ => None,
    };
    if let Some(load) = srpe_load {
        s.fatigue_systemic += load;
    }
    s.lift_sessions.push(LiftSessionLog {
        date: w.date.clone(),
        quad_set_eq,
        heavy_lower,
        srpe: w.srpe,
    });
    if let Some(c) = &w.checkin {
        apply_checkin(s, &w.date, c);
    }
    if let Some(load) = srpe_load {
        s.daily_load.push(DailyLoad {
            date: w.date.clone(),
            load,
        });
    }
}

/// `applyRun`: adds a run's load, fatigue, fitness and logs to `s`, which is assumed to be
/// already decayed to the run's date.
///
/// Errors only when `w.date` does not parse, before `s` is touched.
pub fn apply_run(s: &mut EngineState, w: &RunWorkout) -> Result<(), TimeError> {
    // Snapshot for the Kalman VDOT observation below, before this run's own load contributes
    // to fitnessRun and fatigueSystemic (same reasoning as the lift-side snapshot).
    let prev_fatigue_systemic = s.fatigue_systemic;
    let prev_fitness_run = s.fitness_run;
    let speed = if w.moving_sec > 0.0 {
        w.distance_m / w.moving_sec
    } else {
        0.0
    };
    let gap = mean_gap_factor(w.grade_profile.as_deref());
    let ngp_speed = speed * gap;
    let cs = critical_speed(&s.best_efforts, &w.date)?;
    // `cs ? ... : 1.0` is a truthiness test (0 falls to 1.0) while `cs ?? ...` below is
    // nullish (0 stays 0).
    let z: RunZone = match cs {
        Some(c) if js_truthy(c) => run_zone(ngp_speed, c),
        _ => ZONE_STEADY,
    };
    let threshold = cs.unwrap_or(if speed > 0.0 { speed } else { 1.0 });
    let intensity = intensity_factor(ngp_speed, threshold);
    let hours = w.moving_sec / 3600.0;
    let r_tss = rtss(hours, intensity);
    // Systemic load: same formula as lifting; fall back to the fitted ratio or the prior.
    let minutes = w.minutes.unwrap_or(w.moving_sec / 60.0);
    let sys_load = if let Some(srpe) = w.srpe {
        let load = (srpe * minutes) / 100.0;
        s.srpe_rtss_pairs.push(SrpeRtssPair {
            srpe_load: load,
            r_tss,
        });
        load
    } else {
        (r_tss / 100.0) * srpe_load_ratio(&s.srpe_rtss_pairs)
    };
    s.fatigue_systemic += sys_load;
    s.daily_load.push(DailyLoad {
        date: w.date.clone(),
        load: sys_load,
    });
    // Per-muscle set-equivalents; km after minute 120 go to D_m.
    let km = w.distance_m / 1000.0;
    let frac_damage = if minutes > 120.0 {
        js_min(1.0, (minutes - 120.0) / minutes)
    } else {
        0.0
    };
    let eq = run_set_equivalents(km, z);
    let gm_part = 1.0 - frac_damage;
    let parts = [
        ("quads", eq.quads),
        ("calves", eq.calves),
        ("glutes", eq.glutes),
        ("hamstrings", eq.hamstrings),
    ];
    for (m, v) in parts {
        add_to(&mut s.fatigue_muscle, m, v * gm_part);
        add_to(&mut s.fatigue_damage, m, v * frac_damage);
        add_to(&mut s.run_fatigue_muscle, m, v * gm_part);
        add_to(&mut s.run_fatigue_damage, m, v * frac_damage);
    }
    // Eccentric damage into D_m with the repeated bout effect. The 42 d filter has no lower
    // bound in TS, so a run dated after this one counts too.
    let w_ms = ms_or_nan(&w.date);
    let n = s
        .runs
        .iter()
        .filter(|r| w_ms - ms_or_nan(&r.date) <= 42.0 * 86_400_000.0 && r.descent_m >= 200.0)
        .count();
    let dd = descent_damage(w.descent_m.unwrap_or(0.0), rbe_factor(n as f64));
    add_to(&mut s.fatigue_damage, "quads", dd.quads);
    add_to(&mut s.fatigue_damage, "calves", dd.calves);
    add_to(&mut s.run_fatigue_damage, "quads", dd.quads);
    add_to(&mut s.run_fatigue_damage, "calves", dd.calves);
    // Fitness plus the Kalman VDOT observation (3.5 to 230 min, sRPE >= 8).
    s.fitness_run += r_tss / 100.0;
    let mins = w.moving_sec / 60.0;
    if (3.5..=230.0).contains(&mins) && w.srpe.unwrap_or(0.0) >= 8.0 && w.distance_m > 0.0 {
        let vdot = vdot_from_effort(w.distance_m, w.moving_sec);
        s.kalman_run = kalman_update(
            &s.kalman_run,
            prev_fitness_run,
            prev_fatigue_systemic,
            vdot,
            1.0,
        );
    }
    if w.distance_m > 0.0 {
        s.best_efforts.push(BestEffort {
            distance_m: w.distance_m,
            seconds: w.moving_sec,
            date: w.date.clone(),
        });
    }
    s.runs.push(RunLog {
        date: w.date.clone(),
        distance_m: w.distance_m,
        moving_sec: w.moving_sec,
        descent_m: w.descent_m.unwrap_or(0.0),
        z,
    });
    s.last_run = Some(LastRun {
        date: w.date.clone(),
        minutes,
        distance_m: w.distance_m,
        z,
    });
    Ok(())
}

/// `logSession` on a state in place: decay to the workout's date (never backwards), apply the
/// workout, stamp `updated`. Errors, with `s` untouched, when `s.updated` or the workout date
/// does not parse.
pub fn log_session_mut(s: &mut EngineState, workout: &Workout) -> Result<(), TimeError> {
    let dt = days_between(&s.updated, workout.date())?;
    decay_all(s, js_max(0.0, dt));
    match workout {
        Workout::Lift(w) => apply_lift(s, w),
        // The only error is an unparseable date, which `days_between` already ruled out.
        Workout::Run(w) => apply_run(s, w)?,
    }
    s.updated = workout.date().to_string();
    Ok(())
}

/// `logSession(state, workout)`: a pure update. Clones `state`, decays it to the workout date,
/// applies the workout and sets `updated` to the workout date (kept verbatim).
pub fn log_session(state: &EngineState, workout: &Workout) -> Result<EngineState, TimeError> {
    let mut s = state.clone();
    log_session_mut(&mut s, workout)?;
    Ok(s)
}

/// `calibrate(history)`: replays a history in chronological order from the initial state. The
/// sort is stable, so workouts at the same instant keep their input order.
pub fn calibrate(history: &[Workout]) -> Result<EngineState, TimeError> {
    let mut ordered: Vec<(i64, &Workout)> = Vec::with_capacity(history.len());
    for w in history {
        ordered.push((parse_iso(w.date())?, w));
    }
    ordered.sort_by_key(|(ms, _)| *ms);
    let mut s = initial_state();
    for (_, w) in ordered {
        log_session_mut(&mut s, w)?;
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::state::{LiftEntry, SetLog};

    fn lift_set(w: f64, r: f64, rpe: Option<f64>) -> SetLog {
        SetLog {
            w,
            r,
            rpe,
            completed: true,
            ..SetLog::default()
        }
    }

    fn squat_session(date: &str, sets: Vec<SetLog>) -> Workout {
        Workout::Lift(LiftWorkout {
            id: format!("lift-{date}"),
            date: date.to_string(),
            entries: vec![LiftEntry {
                exercise_id: "squat".into(),
                targets: vec!["quads".into()],
                synergists: vec!["glutes".into()],
                sets,
                is_main: None,
            }],
            ..LiftWorkout::default()
        })
    }

    fn run(date: &str, distance_m: f64, moving_sec: f64) -> RunWorkout {
        RunWorkout {
            id: format!("run-{date}"),
            date: date.to_string(),
            distance_m,
            moving_sec,
            elapsed_sec: moving_sec,
            ..RunWorkout::default()
        }
    }

    #[test]
    fn set_factor_values() {
        assert_eq!(set_factor(Some(8.0), None), 1.0);
        assert_eq!(set_factor(None, None), 1.0);
        assert_eq!(set_factor(None, Some(9.0)), 1.0 + 0.1 * (9.0 - 8.0));
        assert_eq!(set_factor(Some(10.0), Some(6.0)), 1.0 + 0.1 * 2.0);
        assert_eq!(set_factor(Some(1.0), None), 0.5);
        assert_eq!(set_factor(Some(20.0), None), 1.5);
        assert_eq!(set_factor(Some(7.5), None), 1.0 + 0.1 * (7.5 - 8.0));
    }

    #[test]
    fn one_squat_session() {
        let mut w = match squat_session(
            "2026-01-05T10:00:00Z",
            vec![lift_set(100.0, 5.0, Some(8.0))],
        ) {
            Workout::Lift(w) => w,
            Workout::Run(_) => unreachable!(),
        };
        w.srpe = Some(7.0);
        w.minutes = Some(60.0);
        let s = log_session(&initial_state(), &Workout::Lift(w)).unwrap();
        assert_eq!(s.updated, "2026-01-05T10:00:00Z");
        assert_eq!(s.fatigue_muscle["quads"], 1.0);
        assert_eq!(s.fatigue_muscle["glutes"], 0.5);
        assert_eq!(s.fitness["squat"], 500.0 / 100.0);
        assert_eq!(s.fatigue_systemic, 7.0 * 60.0 / 100.0);
        assert_eq!(s.daily_load.len(), 1);
        assert_eq!(s.lift_sessions.len(), 1);
        assert_eq!(s.lift_sessions[0].quad_set_eq, 1.0);
        assert!(s.lift_sessions[0].heavy_lower);
        assert_eq!(s.lift_sessions[0].srpe, Some(7.0));
        let y = (100.0 / 81.1) * 100.0;
        assert_eq!(s.e1rm_obs["squat"][0].value, y);
        // First observation: p0 anchors to y (fitness and fatigue were zero).
        assert_eq!(s.kalman["squat"].p0, y);
        assert_eq!(s.kalman["squat"].obs, 1.0);
        assert!(s.reference_rm.is_empty());
    }

    #[test]
    fn log_session_is_pure() {
        let base = initial_state();
        let before = base.clone();
        let w = squat_session("2026-01-05T10:00:00Z", vec![lift_set(100.0, 5.0, None)]);
        let a = log_session(&base, &w).unwrap();
        let b = log_session(&base, &w).unwrap();
        assert_eq!(base, before);
        assert_eq!(a, b);
    }

    #[test]
    fn fatigue_decays_between_sessions_and_never_backwards() {
        let w1 = squat_session(
            "2026-01-05T10:00:00Z",
            vec![lift_set(100.0, 5.0, Some(8.0))],
        );
        let w2 = squat_session("2026-01-08T10:00:00Z", vec![]);
        let s1 = log_session(&initial_state(), &w1).unwrap();
        let s2 = log_session(&s1, &w2).unwrap();
        assert_eq!(s2.fatigue_muscle["quads"], 1.0 * (-3.0f64 / 2.5).exp());
        assert_eq!(s2.fitness["squat"], 5.0 * (-3.0f64 / 45.0).exp() + 0.0);
        // An earlier date applies the workout without decay and moves `updated` back.
        let w0 = squat_session(
            "2026-01-01T10:00:00Z",
            vec![lift_set(100.0, 5.0, Some(8.0))],
        );
        let s3 = log_session(&s1, &w0).unwrap();
        assert_eq!(s3.fatigue_muscle["quads"], 2.0);
        assert_eq!(s3.updated, "2026-01-01T10:00:00Z");
    }

    #[test]
    fn invalid_dates_are_errors_and_leave_the_state_alone() {
        let s = initial_state();
        let bad = squat_session("not a date", vec![]);
        assert!(log_session(&s, &bad).is_err());
        let mut broken = s.clone();
        broken.updated = "nope".into();
        assert!(log_session(&broken, &squat_session("2026-01-05T10:00:00Z", vec![])).is_err());
        let r = Workout::Run(run("2026-13-01T00:00:00Z", 5000.0, 1500.0));
        assert!(log_session(&s, &r).is_err());
        let mut m = s.clone();
        assert!(log_session_mut(&mut m, &bad).is_err());
        assert_eq!(m, s);
        assert!(calibrate(&[squat_session("2026-01-05T10:00:00Z", vec![]), bad]).is_err());
    }

    #[test]
    fn warmups_incomplete_and_non_main_entries() {
        let mut warm = lift_set(60.0, 5.0, Some(6.0));
        warm.warmup = true;
        let mut undone = lift_set(100.0, 5.0, Some(9.0));
        undone.completed = false;
        let mut pain = lift_set(100.0, 5.0, Some(8.0));
        pain.joint_pain = true;
        let w = Workout::Lift(LiftWorkout {
            date: "2026-01-05T10:00:00Z".into(),
            entries: vec![
                LiftEntry {
                    exercise_id: "squat".into(),
                    targets: vec!["quads".into()],
                    sets: vec![warm, undone, pain],
                    ..LiftEntry::default()
                },
                LiftEntry {
                    exercise_id: "curl".into(),
                    targets: vec!["biceps".into()],
                    sets: vec![lift_set(20.0, 10.0, None)],
                    ..LiftEntry::default()
                },
            ],
            ..LiftWorkout::default()
        });
        let s = log_session(&initial_state(), &w).unwrap();
        assert_eq!(s.fatigue_muscle["quads"], 1.0);
        assert_eq!(s.fatigue_muscle["biceps"], 1.0);
        assert_eq!(s.joint_pain_log.len(), 1);
        assert_eq!(s.joint_pain_log[0].exercise_id, "squat");
        // The curl is not a main lift: no fitness entry, no Kalman state.
        assert!(!s.fitness.contains_key("curl"));
        assert!(!s.kalman.contains_key("curl"));
        assert_eq!(s.fitness["squat"], 500.0 / 100.0);
        // No sRPE and minutes: no systemic load, no daily load.
        assert_eq!(s.fatigue_systemic, 0.0);
        assert!(s.daily_load.is_empty());
        assert!(s.lift_sessions[0].heavy_lower);
    }

    #[test]
    fn is_main_overrides_membership() {
        let mk = |id: &str, is_main: Option<bool>| {
            Workout::Lift(LiftWorkout {
                date: "2026-01-05T10:00:00Z".into(),
                entries: vec![LiftEntry {
                    exercise_id: id.into(),
                    targets: vec!["chest".into()],
                    sets: vec![lift_set(100.0, 5.0, Some(8.0))],
                    is_main,
                    ..LiftEntry::default()
                }],
                ..LiftWorkout::default()
            })
        };
        let s = log_session(&initial_state(), &mk("bench", Some(false))).unwrap();
        assert!(s.fitness.is_empty());
        let s = log_session(&initial_state(), &mk("fly", Some(true))).unwrap();
        assert!(s.fitness.contains_key("fly"));
        let s = log_session(&initial_state(), &mk("bench", None)).unwrap();
        assert!(s.fitness.contains_key("bench"));
    }

    #[test]
    fn tested_one_rm_sets_the_reference_and_quarter_noise() {
        let mut single = lift_set(180.0, 1.0, Some(10.0));
        single.tested1rm = true;
        let w = squat_session("2026-01-05T10:00:00Z", vec![single]);
        let s = log_session(&initial_state(), &w).unwrap();
        let rm = &s.reference_rm["squat"];
        assert_eq!((rm.weight, rm.source.as_str()), (180.0, "tested"));
        assert_eq!(rm.date, "2026-01-05T10:00:00Z");
        // The next session divides volume by the tested reference instead of 100.
        let w2 = squat_session(
            "2026-01-06T10:00:00Z",
            vec![lift_set(100.0, 5.0, Some(8.0))],
        );
        let s2 = log_session(&s, &w2).unwrap();
        let expected = s2.fitness["squat"];
        let decayed = s.fitness["squat"] * (-1.0f64 / 45.0).exp();
        assert_eq!(expected, decayed + 500.0 / 180.0);
    }

    #[test]
    fn checkin_bookkeeping() {
        let mut s = initial_state();
        let c1 = Checkin {
            prs: 7.0,
            soreness: BTreeMap::from([("quads".to_string(), 2.0)]),
        };
        apply_checkin(&mut s, "2026-01-05T10:00:00Z", &c1);
        assert_eq!(s.prs_history.len(), 1);
        assert_eq!(s.soreness_prev.as_ref().unwrap()["quads"], 2.0);
        assert!(s.soreness_prev_prev.is_none());
        let c2 = Checkin {
            prs: 5.0,
            soreness: BTreeMap::from([("quads".to_string(), 4.0)]),
        };
        apply_checkin(&mut s, "2026-01-06T10:00:00Z", &c2);
        assert_eq!(s.soreness_prev.as_ref().unwrap()["quads"], 4.0);
        assert_eq!(s.soreness_prev_prev.as_ref().unwrap()["quads"], 2.0);
        let last = s.last_checkin.unwrap();
        assert_eq!(
            (last.prs, last.date.as_str()),
            (5.0, "2026-01-06T10:00:00Z")
        );
        assert_eq!(last.soreness["quads"], 4.0);
        assert_eq!(s.prs_history.len(), 2);
    }

    #[test]
    fn plain_run_without_history_is_steady() {
        let w = Workout::Run(run("2026-01-05T10:00:00Z", 10_000.0, 3000.0));
        let s = log_session(&initial_state(), &w).unwrap();
        let lr = s.last_run.as_ref().unwrap();
        assert_eq!((lr.minutes, lr.z, lr.distance_m), (50.0, 1.0, 10_000.0));
        // IF is exactly 1 (speed over itself), so rTSS = hours * 100.
        let r_tss = (3000.0 / 3600.0) * 100.0;
        assert_eq!(s.fitness_run, r_tss / 100.0);
        assert_eq!(s.fatigue_systemic, (r_tss / 100.0) * 3.6);
        assert_eq!(s.daily_load[0].load, s.fatigue_systemic);
        assert!((s.fatigue_muscle["quads"] - 1.8).abs() < 1e-12);
        assert!((s.fatigue_muscle["calves"] - 1.44).abs() < 1e-12);
        assert_eq!(s.fatigue_damage["quads"], 0.0);
        assert_eq!(s.run_fatigue_muscle, s.fatigue_muscle);
        assert_eq!(s.best_efforts.len(), 1);
        assert_eq!(s.runs.len(), 1);
        assert_eq!(s.kalman_run.obs, 0.0);
    }

    #[test]
    fn hard_srpe_run_feeds_the_vdot_filter_and_the_pairs() {
        let mut r = run("2026-01-05T10:00:00Z", 5000.0, 1200.0);
        r.srpe = Some(9.0);
        let s = log_session(&initial_state(), &Workout::Run(r)).unwrap();
        assert_eq!(s.kalman_run.obs, 1.0);
        assert_eq!(s.srpe_rtss_pairs.len(), 1);
        assert_eq!(s.srpe_rtss_pairs[0].srpe_load, 9.0 * 20.0 / 100.0);
        assert_eq!(s.fatigue_systemic, 9.0 * 20.0 / 100.0);
        // Too short for the filter, or a low sRPE: no observation.
        let mut short = run("2026-01-05T10:00:00Z", 500.0, 120.0);
        short.srpe = Some(9.0);
        let s = log_session(&initial_state(), &Workout::Run(short)).unwrap();
        assert_eq!(s.kalman_run.obs, 0.0);
        let mut easy = run("2026-01-05T10:00:00Z", 5000.0, 1200.0);
        easy.srpe = Some(7.0);
        let s = log_session(&initial_state(), &Workout::Run(easy)).unwrap();
        assert_eq!(s.kalman_run.obs, 0.0);
    }

    #[test]
    fn long_runs_push_fatigue_into_damage() {
        // 3 h run: minutes 180, so a third of the set-equivalents go to D_m.
        let r = run("2026-01-05T10:00:00Z", 30_000.0, 10_800.0);
        let s = log_session(&initial_state(), &Workout::Run(r)).unwrap();
        let frac = (180.0 - 120.0) / 180.0;
        let q = 0.18 * 1.0 * 30.0;
        assert_eq!(s.fatigue_damage["quads"], q * frac);
        assert_eq!(s.fatigue_muscle["quads"], q * (1.0 - frac));
        assert_eq!(s.run_fatigue_damage["quads"], q * frac);
    }

    #[test]
    fn descent_damage_and_repeated_bouts() {
        let mut r1 = run("2026-01-05T10:00:00Z", 10_000.0, 3000.0);
        r1.descent_m = Some(300.0);
        let s1 = log_session(&initial_state(), &Workout::Run(r1)).unwrap();
        assert_eq!(s1.fatigue_damage["quads"], 0.4 * 3.0 * 1.0);
        let mut r2 = run("2026-01-12T10:00:00Z", 10_000.0, 3000.0);
        r2.descent_m = Some(300.0);
        let s2 = log_session(&s1, &Workout::Run(r2)).unwrap();
        // One earlier run with 200 m+ of descent in the last 42 days: RBE 1 - 0.035.
        let decayed = s1.fatigue_damage["quads"] * (-7.0f64 / 5.0).exp();
        assert_eq!(
            s2.fatigue_damage["quads"],
            decayed + 0.4 * 3.0 * (1.0 - 0.035)
        );
    }

    #[test]
    fn run_before_lift_doubles_the_noise() {
        let sets = || vec![lift_set(100.0, 5.0, Some(8.0))];
        // One earlier session gives the squat filter its first observation.
        let base = log_session(
            &initial_state(),
            &squat_session("2026-01-01T10:00:00Z", sets()),
        )
        .unwrap();
        let with_run = |start: &str, minutes: f64| {
            let mut s = base.clone();
            s.last_run = Some(LastRun {
                date: start.into(),
                minutes,
                distance_m: 8000.0,
                z: 1.0,
            });
            s
        };
        let kalman_after = |s: &EngineState, date: &str, id: &str| {
            let w = Workout::Lift(LiftWorkout {
                date: date.into(),
                entries: vec![LiftEntry {
                    exercise_id: id.into(),
                    targets: vec!["quads".into()],
                    sets: sets(),
                    ..LiftEntry::default()
                }],
                ..LiftWorkout::default()
            });
            let mut out = log_session(s, &w).unwrap();
            out.kalman.remove(id).unwrap()
        };
        let plain = kalman_after(&base, "2026-01-05T14:00:00Z", "squat");
        // A 40 min run from 08:00Z ended 08:40Z; the lift is 5.3 h later, so R doubles.
        let run = with_run("2026-01-05T08:00:00Z", 40.0);
        assert_ne!(kalman_after(&run, "2026-01-05T14:00:00Z", "squat"), plain);
        // 8.3 h after the end of the run: no effect.
        assert_eq!(
            kalman_after(&run, "2026-01-05T17:00:00Z", "squat"),
            kalman_after(&base, "2026-01-05T17:00:00Z", "squat")
        );
        // A run under 30 minutes does not count.
        let short = with_run("2026-01-05T08:00:00Z", 29.0);
        assert_eq!(kalman_after(&short, "2026-01-05T14:00:00Z", "squat"), plain);
        // The run is measured from its end, not its start: this lift is 8 h after the start
        // but 7 h after the end, so it still counts.
        let long = with_run("2026-01-05T06:00:00Z", 60.0);
        assert_ne!(kalman_after(&long, "2026-01-05T14:00:00Z", "squat"), plain);
    }

    #[test]
    fn calibrate_orders_by_instant_and_is_stable() {
        let a = squat_session(
            "2026-01-05T10:00:00-05:00",
            vec![lift_set(100.0, 5.0, Some(8.0))],
        );
        let b = squat_session(
            "2026-01-05T14:00:00Z",
            vec![lift_set(110.0, 5.0, Some(8.0))],
        );
        let c = squat_session(
            "2026-01-06T10:00:00Z",
            vec![lift_set(120.0, 5.0, Some(8.0))],
        );
        // 10:00-05:00 is 15:00Z, so b (14:00Z) comes first even though it is listed second.
        let s = calibrate(&[c.clone(), a.clone(), b.clone()]).unwrap();
        let dates: Vec<_> = s.lift_sessions.iter().map(|l| l.date.as_str()).collect();
        assert_eq!(
            dates,
            [
                "2026-01-05T14:00:00Z",
                "2026-01-05T10:00:00-05:00",
                "2026-01-06T10:00:00Z"
            ]
        );
        assert_eq!(s.updated, "2026-01-06T10:00:00Z");
        // Equal instants keep their input order.
        let t1 = squat_session(
            "2026-01-05T15:00:00Z",
            vec![lift_set(100.0, 5.0, Some(8.0))],
        );
        let t2 = squat_session(
            "2026-01-05T10:00:00-05:00",
            vec![lift_set(105.0, 5.0, Some(8.0))],
        );
        let s = calibrate(&[t1, t2]).unwrap();
        assert_eq!(s.lift_sessions[0].date, "2026-01-05T15:00:00Z");
        assert_eq!(s.lift_sessions[1].date, "2026-01-05T10:00:00-05:00");
        assert_eq!(calibrate(&[]).unwrap(), initial_state());
    }

    #[test]
    fn calibrate_equals_folding_log_session() {
        let ws = vec![
            squat_session(
                "2026-01-05T10:00:00Z",
                vec![lift_set(100.0, 5.0, Some(8.0))],
            ),
            Workout::Run(run("2026-01-06T10:00:00Z", 8000.0, 2400.0)),
            squat_session(
                "2026-01-08T10:00:00Z",
                vec![lift_set(105.0, 5.0, Some(8.5))],
            ),
        ];
        let mut s = initial_state();
        for w in &ws {
            s = log_session(&s, w).unwrap();
        }
        assert_eq!(calibrate(&ws).unwrap(), s);
    }
}
