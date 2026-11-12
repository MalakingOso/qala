//! e1RM observation rules: the deleted TS `engine/e1rm.ts` and `rtsTable.ts`.
//!
//! Epley tracks the RTS RPE table within 2% from 2 to 10 reps; Brzycki runs away above 10.
//! The RTS table is an unverified third-party reproduction (see the TS header); no cell is
//! flagged for the rule-3 fallback yet.

use super::state::SetLog;
use crate::js::js_is_integer;

/// `RTS_VERIFICATION_STATUS` in rtsTable.ts.
pub const RTS_VERIFICATION_STATUS: &str = "unverified-third-party-reproduction";

/// Cells that failed the 1 point spot-check and must use rule 3, as `"rpe:reps"` keys. Empty
/// until the pre-ship check is done.
const RTS_FLAGGED_CELLS: [&str; 0] = [];

/// Rows: RPE 10 down to 6 in 0.5 steps; columns: reps 1..=6.
const ROWS: [(f64, [f64; 6]); 9] = [
    (10.0, [100.0, 95.5, 92.2, 89.2, 86.3, 83.7]),
    (9.5, [97.8, 93.9, 90.7, 87.8, 85.0, 82.4]),
    (9.0, [95.5, 92.2, 89.2, 86.3, 83.7, 81.1]),
    (8.5, [93.9, 90.7, 87.8, 85.0, 82.4, 79.9]),
    (8.0, [92.2, 89.2, 86.3, 83.7, 81.1, 78.6]),
    (7.5, [90.7, 87.8, 85.0, 82.4, 79.9, 77.4]),
    (7.0, [89.2, 86.3, 83.7, 81.1, 78.6, 76.2]),
    (6.5, [87.8, 85.0, 82.4, 79.9, 77.4, 75.1]),
    (6.0, [86.3, 83.7, 81.1, 78.6, 76.2, 73.9]),
];

/// `isRtsCellFlagged`: whether `(rpe, reps)` is on the flagged list.
pub fn is_rts_cell_flagged(rpe: f64, reps: f64) -> bool {
    let key = format!("{rpe}:{reps}");
    RTS_FLAGGED_CELLS.contains(&key.as_str())
}

/// Result of an RTS table lookup.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RtsLookup {
    /// %1RM value, or `None` when reps or RPE are outside the table.
    pub pct: Option<f64>,
    /// False for every cell until the pre-ship second-source check passes.
    pub verified: bool,
    /// True when the caller must use rule 3 (Epley) instead of this cell.
    pub use_rule3_fallback: bool,
}

/// `rtsLookup`: %1RM for whole reps 1..=6 and an RPE on the table (6 to 10 in halves).
pub fn rts_lookup(reps: f64, rpe: f64) -> RtsLookup {
    let off_table = RtsLookup {
        pct: None,
        verified: false,
        use_rule3_fallback: true,
    };
    if !js_is_integer(reps) || !(1.0..=6.0).contains(&reps) {
        return off_table;
    }
    let Some((_, pcts)) = ROWS.iter().find(|(r, _)| (r - rpe).abs() < 1e-9) else {
        return off_table;
    };
    let pct = pcts[reps as usize - 1];
    RtsLookup {
        pct: Some(pct),
        verified: false,
        use_rule3_fallback: is_rts_cell_flagged(rpe, reps),
    }
}

/// An e1RM taken from one set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct E1rmObservation {
    pub e1rm: f64,
    /// Tested 1RM: observation noise is one quarter of an e1RM's.
    pub tested: bool,
}

fn rir_of(rpe: f64) -> f64 {
    10.0 - rpe
}

/// `observeSet`: the e1RM implied by one set, or `None` when the set carries no usable signal.
pub fn observe_set(s: &SetLog) -> Option<E1rmObservation> {
    if !s.completed {
        return None;
    }
    // Rule 1: singles at RPE >= 9.5, or a flagged test or meet attempt.
    if s.tested1rm || (s.r == 1.0 && s.rpe.is_some_and(|rpe| rpe >= 9.5)) {
        return Some(E1rmObservation {
            e1rm: s.w,
            tested: true,
        });
    }
    // Rule 2: RPE logged and reps + RIR <= 10.
    if let Some(rpe) = s.rpe {
        let total = s.r + rir_of(rpe);
        if total <= 10.0 {
            let look = rts_lookup(s.r, rpe);
            if let Some(pct) = look.pct {
                if !look.use_rule3_fallback {
                    return Some(E1rmObservation {
                        e1rm: (s.w / pct) * 100.0,
                        tested: false,
                    });
                }
            }
            // Flagged cell or off-table RPE: fall through to rule 3 (PLAN 6.2).
        } else {
            // reps + RIR > 10 with an RPE: no observation (rule 4 logic). Written as an else
            // branch so a NaN total lands here, as in TS.
            return None;
        }
        if s.r > 10.0 {
            return None;
        }
        let rir_est = rir_of(rpe);
        if s.r + rir_est == 1.0 {
            return Some(E1rmObservation {
                e1rm: s.w,
                tested: false,
            });
        }
        return Some(E1rmObservation {
            e1rm: s.w * (1.0 + (s.r + rir_est) / 30.0),
            tested: false,
        });
    }
    // Rule 3: no RPE, reps <= 10.
    if s.r <= 10.0 {
        let rir_est = match s.target_rpe {
            Some(t) => 10.0 - t,
            None => 0.0,
        };
        if s.r + rir_est == 1.0 {
            return Some(E1rmObservation {
                e1rm: s.w,
                tested: false,
            });
        }
        return Some(E1rmObservation {
            e1rm: s.w * (1.0 + (s.r + rir_est) / 30.0),
            tested: false,
        });
    }
    // Rule 4: reps > 10 gives no observation (rep-range PRs only).
    None
}

/// `bestObservation`: the highest e1RM over the working sets (warmups skipped), ties keep the
/// first. `tested` is that set's flag.
pub fn best_observation(sets: &[SetLog]) -> Option<E1rmObservation> {
    let mut best: Option<E1rmObservation> = None;
    for s in sets {
        if s.warmup {
            continue;
        }
        if let Some(o) = observe_set(s) {
            if best.is_none_or(|b| o.e1rm > b.e1rm) {
                best = Some(o);
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(w: f64, r: f64) -> SetLog {
        SetLog {
            w,
            r,
            completed: true,
            ..SetLog::default()
        }
    }

    fn with_rpe(w: f64, r: f64, rpe: f64) -> SetLog {
        SetLog {
            rpe: Some(rpe),
            ..set(w, r)
        }
    }

    #[test]
    fn lookup_hits_and_misses() {
        assert_eq!(rts_lookup(1.0, 10.0).pct, Some(100.0));
        assert_eq!(rts_lookup(6.0, 10.0).pct, Some(83.7));
        assert_eq!(rts_lookup(3.0, 8.5).pct, Some(87.8));
        assert_eq!(rts_lookup(6.0, 6.0).pct, Some(73.9));
        for (reps, rpe) in [
            (0.0, 8.0),
            (7.0, 8.0),
            (2.5, 8.0),
            (3.0, 8.25),
            (3.0, 5.5),
            (3.0, 10.5),
            (f64::NAN, 8.0),
            (3.0, f64::NAN),
        ] {
            let l = rts_lookup(reps, rpe);
            assert_eq!(l.pct, None, "{reps} {rpe}");
            assert!(l.use_rule3_fallback);
            assert!(!l.verified);
        }
        let hit = rts_lookup(5.0, 9.0);
        assert!(!hit.use_rule3_fallback);
        assert!(!hit.verified);
        // The RPE match tolerates float noise.
        assert_eq!(rts_lookup(5.0, 9.0 + 1e-12).pct, Some(83.7));
    }

    #[test]
    fn every_table_row_is_monotone() {
        for (_, pcts) in ROWS {
            for w in pcts.windows(2) {
                assert!(w[0] > w[1]);
            }
        }
        // 6 reps at RPE 10 is the Helms 83.7% anchor.
        assert_eq!(ROWS[0].1[5], 83.7);
        assert!(!is_rts_cell_flagged(8.0, 5.0));
    }

    #[test]
    fn incomplete_sets_never_observe() {
        let mut s = set(100.0, 5.0);
        s.completed = false;
        assert_eq!(observe_set(&s), None);
        s.tested1rm = true;
        assert_eq!(observe_set(&s), None);
    }

    #[test]
    fn rule1_tested_and_heavy_singles() {
        let mut s = set(200.0, 3.0);
        s.tested1rm = true;
        assert_eq!(
            observe_set(&s),
            Some(E1rmObservation {
                e1rm: 200.0,
                tested: true
            })
        );
        assert_eq!(
            observe_set(&with_rpe(180.0, 1.0, 9.5)),
            Some(E1rmObservation {
                e1rm: 180.0,
                tested: true
            })
        );
        assert_eq!(
            observe_set(&with_rpe(180.0, 1.0, 10.0)),
            Some(E1rmObservation {
                e1rm: 180.0,
                tested: true
            })
        );
        // A single at RPE 9 takes the table: 95.5%.
        let o = observe_set(&with_rpe(180.0, 1.0, 9.0)).unwrap();
        assert!(!o.tested);
        assert_eq!(o.e1rm, (180.0 / 95.5) * 100.0);
    }

    #[test]
    fn rule2_table_lookup() {
        let o = observe_set(&with_rpe(100.0, 5.0, 8.0)).unwrap();
        assert_eq!(
            o,
            E1rmObservation {
                e1rm: (100.0 / 81.1) * 100.0,
                tested: false
            }
        );
    }

    #[test]
    fn rule2_off_table_falls_through_to_epley() {
        // 8 reps @ RPE 8: total 10, off the table (reps > 6), Epley with RIR 2.
        let o = observe_set(&with_rpe(100.0, 8.0, 8.0)).unwrap();
        assert_eq!(o.e1rm, 100.0 * (1.0 + (8.0 + 2.0) / 30.0));
        // Half reps are off the table too.
        let o = observe_set(&with_rpe(100.0, 5.5, 8.0)).unwrap();
        assert_eq!(o.e1rm, 100.0 * (1.0 + (5.5 + 2.0) / 30.0));
        // RPE 7.25 is not a table row.
        let o = observe_set(&with_rpe(100.0, 5.0, 7.25)).unwrap();
        assert_eq!(o.e1rm, 100.0 * (1.0 + (5.0 + 2.75) / 30.0));
    }

    #[test]
    fn rule2_too_many_total_reps_gives_nothing() {
        assert_eq!(observe_set(&with_rpe(100.0, 9.0, 8.0)), None);
        assert_eq!(observe_set(&with_rpe(100.0, 12.0, 10.0)), None);
        assert_eq!(observe_set(&with_rpe(100.0, 5.0, f64::NAN)), None);
    }

    #[test]
    fn rule2_single_total_returns_the_weight() {
        // 0.5 reps at RIR 0.5: total 1, off table, r + rirEst == 1.
        let o = observe_set(&with_rpe(100.0, 0.5, 9.5)).unwrap();
        assert_eq!(
            o,
            E1rmObservation {
                e1rm: 100.0,
                tested: false
            }
        );
    }

    #[test]
    fn rule3_no_rpe() {
        let o = observe_set(&set(100.0, 5.0)).unwrap();
        assert_eq!(o.e1rm, 100.0 * (1.0 + 5.0 / 30.0));
        let mut s = set(100.0, 5.0);
        s.target_rpe = Some(8.0);
        assert_eq!(observe_set(&s).unwrap().e1rm, 100.0 * (1.0 + 7.0 / 30.0));
        let mut s = set(100.0, 1.0);
        assert_eq!(
            observe_set(&s),
            Some(E1rmObservation {
                e1rm: 100.0,
                tested: false
            })
        );
        s.target_rpe = Some(10.0);
        assert_eq!(
            observe_set(&s),
            Some(E1rmObservation {
                e1rm: 100.0,
                tested: false
            })
        );
        // Rule 4: more than 10 reps gives nothing.
        assert_eq!(observe_set(&set(100.0, 11.0)), None);
        assert!(observe_set(&set(100.0, 10.0)).is_some());
    }

    #[test]
    fn best_observation_takes_the_max_skips_warmups_and_keeps_first_on_ties() {
        assert_eq!(best_observation(&[]), None);
        let mut warm = set(300.0, 1.0);
        warm.tested1rm = true;
        warm.warmup = true;
        let a = with_rpe(100.0, 5.0, 8.0);
        let b = with_rpe(110.0, 5.0, 8.0);
        let best = best_observation(&[warm.clone(), a.clone(), b.clone()]).unwrap();
        assert_eq!(best.e1rm, (110.0 / 81.1) * 100.0);
        assert_eq!(best_observation(&[warm]), None);
        // A tested single that ties an Epley estimate: first wins.
        let mut tested = set(120.0, 1.0);
        tested.tested1rm = true;
        let tie = SetLog {
            w: 120.0,
            r: 1.0,
            target_rpe: Some(10.0),
            completed: true,
            ..SetLog::default()
        };
        assert!(
            best_observation(&[tested.clone(), tie.clone()])
                .unwrap()
                .tested
        );
        assert!(!best_observation(&[tie, tested]).unwrap().tested);
    }
}
