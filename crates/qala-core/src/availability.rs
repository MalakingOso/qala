//! Availability: skipped days and training status. Port of `packages/engine/availability.ts`.
//!
//! Pure date-key logic. A day is a local `YYYY-MM-DD` key, spans are inclusive, and keys are
//! compared as strings (which sorts like dates for four-digit years). Skipped days log no
//! session, so fatigue decay and the no-guilt rule (a skip is never a miss) need nothing here.
//!
//! The TS `todayKey(now)` reads the clock and is not ported. [`today_key`] takes the instant and
//! the UTC offset from the caller instead.
//!
//! JS truthiness is kept where the TS relies on it: an empty `since`, `until` or `muscle` string
//! counts as absent, exactly like `""` does in `!a.since` and `a.until &&`.

use crate::time::local_date_key;
use serde::{Deserialize, Serialize};

/// Add calendar days to a `YYYY-MM-DD` key (UTC math, DST-safe): `addDaysKey` in TS. A malformed
/// key comes back unchanged; use [`try_add_days_key`] to see the error.
pub use crate::time::{add_days_key, try_add_days_key};

/// The engine's check-in (`prs` 0 to 10, soreness 1 to 4 per muscle id), the type
/// [`apply_injury_to_checkin`] reads and returns.
pub use crate::engine::state::Checkin;

/// Why a training day is off. Vacation and sick shift the plan out; a break or a scheduling
/// conflict rests in place; an injured day guards one muscle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkipReason {
    Break,
    Vacation,
    Sick,
    Injured,
    Scheduling,
}

/// One skipped calendar day (`date` is `YYYY-MM-DD` in the user's timezone).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaySkip {
    pub date: String,
    pub reason: SkipReason,
    /// Injured target: a lowercase engine muscle id (quads, calves, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muscle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// `"active"` or a [`SkipReason`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AvailabilityStatus {
    #[default]
    Active,
    Break,
    Vacation,
    Sick,
    Injured,
    Scheduling,
}

impl AvailabilityStatus {
    /// The matching skip reason, `None` for `Active`.
    pub fn skip_reason(self) -> Option<SkipReason> {
        match self {
            AvailabilityStatus::Active => None,
            AvailabilityStatus::Break => Some(SkipReason::Break),
            AvailabilityStatus::Vacation => Some(SkipReason::Vacation),
            AvailabilityStatus::Sick => Some(SkipReason::Sick),
            AvailabilityStatus::Injured => Some(SkipReason::Injured),
            AvailabilityStatus::Scheduling => Some(SkipReason::Scheduling),
        }
    }
}

impl From<SkipReason> for AvailabilityStatus {
    fn from(reason: SkipReason) -> Self {
        match reason {
            SkipReason::Break => AvailabilityStatus::Break,
            SkipReason::Vacation => AvailabilityStatus::Vacation,
            SkipReason::Sick => AvailabilityStatus::Sick,
            SkipReason::Injured => AvailabilityStatus::Injured,
            SkipReason::Scheduling => AvailabilityStatus::Scheduling,
        }
    }
}

/// Persistent training status. Active is the default; the rest cover every day from `since`
/// through `until` (inclusive, open when absent).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Availability {
    pub status: AvailabilityStatus,
    /// `YYYY-MM-DD`, set whenever the status is not active.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    /// `YYYY-MM-DD` inclusive; absent means until cleared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    /// Injured target: a lowercase engine muscle id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muscle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// How the plan treats a day: training as usual, a rest day in place, or a day the scheduler
/// pushes out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DayClass {
    Train,
    Rest,
    Shift,
}

/// What the injured-muscle guard does with one exercise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuardVerdict {
    Train,
    Halve,
    Skip,
}

/// `Some(s)` only for a non-empty string, like JS truthiness on `string | undefined`.
fn present(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|v| !v.is_empty())
}

/// Vacation and sick push the plan out; a break or a scheduling conflict rests in place and an
/// injured day trains around the hurt muscle.
pub fn shifts_plan(reason: SkipReason) -> bool {
    matches!(reason, SkipReason::Vacation | SkipReason::Sick)
}

/// Whether a persistent status covers a `YYYY-MM-DD` day.
pub fn covers_day(a: &Availability, date_key: &str) -> bool {
    if a.status == AvailabilityStatus::Active {
        return false;
    }
    let Some(since) = present(&a.since) else {
        return false;
    };
    if date_key < since {
        return false;
    }
    if let Some(until) = present(&a.until) {
        if date_key > until {
            return false;
        }
    }
    true
}

/// Why a day is off, or `None` when it trains. A one-day skip wins over the persistent status
/// (the first skip for that date, like `Array.find`).
pub fn reason_on(
    date_key: &str,
    availability: &Availability,
    skips: &[DaySkip],
) -> Option<SkipReason> {
    if let Some(skip) = skips.iter().find(|s| s.date == date_key) {
        return Some(skip.reason);
    }
    if covers_day(availability, date_key) {
        return availability.status.skip_reason();
    }
    None
}

/// How the plan treats a day.
pub fn classify_day(date_key: &str, availability: &Availability, skips: &[DaySkip]) -> DayClass {
    match reason_on(date_key, availability, skips) {
        None => DayClass::Train,
        Some(reason) if shifts_plan(reason) => DayClass::Shift,
        Some(_) => DayClass::Rest,
    }
}

/// Muscles under the injured guard on a day (at most one: the skip's target wins, else the
/// status target). A skip for the date ends the lookup even when it names no muscle.
pub fn injured_on(date_key: &str, availability: &Availability, skips: &[DaySkip]) -> Vec<String> {
    if let Some(skip) = skips.iter().find(|s| s.date == date_key) {
        return match (skip.reason, present(&skip.muscle)) {
            (SkipReason::Injured, Some(muscle)) => vec![muscle.to_string()],
            _ => Vec::new(),
        };
    }
    if availability.status == AvailabilityStatus::Injured && covers_day(availability, date_key) {
        if let Some(muscle) = present(&availability.muscle) {
            return vec![muscle.to_string()];
        }
    }
    Vec::new()
}

/// JS `\s`: the characters `String.prototype.trim` strips. Not `char::is_whitespace`, which
/// includes U+0085 and leaves out U+FEFF.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}'
            | '\u{a}'
            | '\u{b}'
            | '\u{c}'
            | '\u{d}'
            | '\u{20}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    ) || ('\u{2000}'..='\u{200a}').contains(&c)
}

/// Canonical muscle compare form: lowercase, no whitespace, underscores or hyphens, known
/// aliases (`quadriceps` is the body-map id for the engine's `quads`).
pub fn norm_muscle(muscle: &str) -> String {
    let norm: String = muscle
        .to_lowercase()
        .chars()
        .filter(|&c| !(is_js_whitespace(c) || c == '_' || c == '-'))
        .collect();
    if norm == "quadriceps" {
        return "quads".to_string();
    }
    norm
}

/// Injured-muscle guard for one exercise: an injured direct target takes the exercise out, an
/// injured synergist halves its sets, anything else trains. `synergists` is `None` where TS has
/// `undefined`; it behaves like an empty list.
pub fn guard_exercise(
    targets: &[String],
    synergists: Option<&[String]>,
    injured: &[String],
) -> GuardVerdict {
    if injured.is_empty() {
        return GuardVerdict::Train;
    }
    let hurt: Vec<String> = injured.iter().map(|m| norm_muscle(m)).collect();
    let is_hurt = |m: &String| hurt.contains(&norm_muscle(m));
    if targets.iter().any(is_hurt) {
        return GuardVerdict::Skip;
    }
    if synergists.unwrap_or(&[]).iter().any(is_hurt) {
        return GuardVerdict::Halve;
    }
    GuardVerdict::Train
}

/// Injured muscles check in at soreness 4 (still sore now), so readiness blocks them and the
/// warm-up treats them as sore. Keys are written in [`norm_muscle`] form. Never lowers a rating.
pub fn apply_injury_to_checkin(checkin: &Checkin, injured: &[String]) -> Checkin {
    let mut out = checkin.clone();
    for muscle in injured {
        out.soreness.insert(norm_muscle(muscle), 4.0);
    }
    out
}

// ---------------------------------------------------------------------------------------
// Date keys. The calendar math lives in `time.rs`.
// ---------------------------------------------------------------------------------------

/// `YYYY-MM-DD` from a year, month and day. Zero padded; the values are not validated.
pub fn date_key_from_ymd(year: i32, month: u32, day: u32) -> String {
    format!("{year:04}-{month:02}-{day:02}")
}

/// The user's calendar day as `YYYY-MM-DD` for an instant (epoch ms) and a UTC offset in minutes
/// (`-240` for EDT). The caller supplies both; nothing here reads a clock.
pub fn today_key(epoch_ms: i64, offset_min: i32) -> String {
    local_date_key(epoch_ms, offset_min)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active() -> Availability {
        Availability::default()
    }

    fn avail(status: AvailabilityStatus, since: Option<&str>, until: Option<&str>) -> Availability {
        Availability {
            status,
            since: since.map(str::to_string),
            until: until.map(str::to_string),
            muscle: None,
            note: None,
        }
    }

    fn skip(date: &str, reason: SkipReason) -> DaySkip {
        DaySkip {
            date: date.to_string(),
            reason,
            muscle: None,
            note: None,
        }
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_clear_day_trains() {
        assert_eq!(reason_on("2026-09-13", &active(), &[]), None);
        assert_eq!(classify_day("2026-09-13", &active(), &[]), DayClass::Train);
    }

    #[test]
    fn a_one_day_skip_wins_over_the_persistent_status() {
        let a = avail(AvailabilityStatus::Sick, Some("2026-09-10"), None);
        assert_eq!(
            reason_on("2026-09-13", &a, &[skip("2026-09-13", SkipReason::Break)]),
            Some(SkipReason::Break)
        );
        assert_eq!(
            reason_on("2026-09-13", &a, &[skip("2026-09-12", SkipReason::Break)]),
            Some(SkipReason::Sick),
            "other-day skip ignored"
        );
    }

    #[test]
    fn first_skip_for_a_date_wins() {
        let skips = [
            skip("2026-09-13", SkipReason::Scheduling),
            skip("2026-09-13", SkipReason::Sick),
        ];
        assert_eq!(
            reason_on("2026-09-13", &active(), &skips),
            Some(SkipReason::Scheduling)
        );
    }

    #[test]
    fn status_spans_cover_since_through_until_inclusive() {
        let a = avail(
            AvailabilityStatus::Vacation,
            Some("2026-09-10"),
            Some("2026-09-12"),
        );
        assert!(!covers_day(&a, "2026-09-09"), "before since");
        assert!(covers_day(&a, "2026-09-10"), "since");
        assert!(covers_day(&a, "2026-09-12"), "until");
        assert!(!covers_day(&a, "2026-09-13"), "after until");
        assert!(!covers_day(&active(), "2026-09-11"), "active never");
        assert!(
            covers_day(
                &avail(AvailabilityStatus::Sick, Some("2026-09-10"), None),
                "2027-01-01"
            ),
            "no until stays on"
        );
    }

    #[test]
    fn a_status_without_since_covers_nothing() {
        assert!(!covers_day(
            &avail(AvailabilityStatus::Sick, None, None),
            "2026-09-11"
        ));
        assert_eq!(
            reason_on(
                "2026-09-11",
                &avail(AvailabilityStatus::Sick, None, None),
                &[]
            ),
            None
        );
    }

    #[test]
    fn empty_strings_behave_like_absent_fields() {
        // TS: `!a.since` and `a.until &&` are false for "".
        assert!(!covers_day(
            &avail(AvailabilityStatus::Sick, Some(""), None),
            "2026-09-11"
        ));
        let open = avail(AvailabilityStatus::Sick, Some("2026-09-10"), Some(""));
        assert!(covers_day(&open, "2030-01-01"), "empty until is open");
        let mut hurt = avail(AvailabilityStatus::Injured, Some("2026-09-10"), None);
        hurt.muscle = Some(String::new());
        assert!(
            injured_on("2026-09-11", &hurt, &[]).is_empty(),
            "empty muscle is no muscle"
        );
        let blank = DaySkip {
            muscle: Some(String::new()),
            ..skip("2026-09-11", SkipReason::Injured)
        };
        assert!(injured_on("2026-09-11", &active(), &[blank]).is_empty());
    }

    #[test]
    fn vacation_and_sick_shift_the_plan_the_rest_rest_in_place() {
        assert!(shifts_plan(SkipReason::Vacation) && shifts_plan(SkipReason::Sick));
        assert!(
            !shifts_plan(SkipReason::Break)
                && !shifts_plan(SkipReason::Injured)
                && !shifts_plan(SkipReason::Scheduling)
        );
        let class = |reason| classify_day("2026-09-13", &active(), &[skip("2026-09-13", reason)]);
        assert_eq!(class(SkipReason::Vacation), DayClass::Shift);
        assert_eq!(class(SkipReason::Sick), DayClass::Shift);
        assert_eq!(class(SkipReason::Break), DayClass::Rest);
        assert_eq!(class(SkipReason::Injured), DayClass::Rest);
        assert_eq!(class(SkipReason::Scheduling), DayClass::Rest);
    }

    #[test]
    fn a_persistent_status_classifies_every_covered_day() {
        let a = avail(
            AvailabilityStatus::Vacation,
            Some("2026-09-10"),
            Some("2026-09-12"),
        );
        assert_eq!(classify_day("2026-09-11", &a, &[]), DayClass::Shift);
        assert_eq!(classify_day("2026-09-13", &a, &[]), DayClass::Train);
        let brk = avail(AvailabilityStatus::Break, Some("2026-09-10"), None);
        assert_eq!(classify_day("2026-09-30", &brk, &[]), DayClass::Rest);
    }

    #[test]
    fn injured_muscle_resolves_from_skip_first_then_status() {
        let injured_skip = DaySkip {
            muscle: Some("quads".to_string()),
            ..skip("2026-09-13", SkipReason::Injured)
        };
        assert_eq!(
            injured_on("2026-09-13", &active(), std::slice::from_ref(&injured_skip)),
            v(&["quads"])
        );
        assert!(
            injured_on(
                "2026-09-13",
                &active(),
                &[skip("2026-09-13", SkipReason::Sick)]
            )
            .is_empty(),
            "non-injured skip"
        );
        let mut status = avail(AvailabilityStatus::Injured, Some("2026-09-10"), None);
        status.muscle = Some("calves".to_string());
        assert_eq!(
            injured_on("2026-09-13", &status, &[]),
            v(&["calves"]),
            "status muscle"
        );
        let mut lapsed = avail(
            AvailabilityStatus::Injured,
            Some("2026-09-10"),
            Some("2026-09-12"),
        );
        lapsed.muscle = Some("calves".to_string());
        assert!(
            injured_on("2026-09-13", &lapsed, &[]).is_empty(),
            "lapsed status"
        );
        // A skip for the day ends the lookup: the status muscle does not leak through.
        assert!(injured_on(
            "2026-09-13",
            &status,
            &[skip("2026-09-13", SkipReason::Sick)]
        )
        .is_empty());
        assert_eq!(
            injured_on("2026-09-13", &status, &[injured_skip]),
            v(&["quads"]),
            "skip wins"
        );
        // A non-injured status never guards, whatever muscle it carries.
        let mut sick = avail(AvailabilityStatus::Sick, Some("2026-09-10"), None);
        sick.muscle = Some("calves".to_string());
        assert!(injured_on("2026-09-13", &sick, &[]).is_empty());
    }

    #[test]
    fn guard_blocks_direct_targets_and_halves_synergists() {
        let g = |t: &[&str], s: Option<&[&str]>, i: &[&str]| {
            let s = s.map(v);
            guard_exercise(&v(t), s.as_deref(), &v(i))
        };
        assert_eq!(
            g(&["quads"], Some(&["glutes"]), &["quads"]),
            GuardVerdict::Skip,
            "direct"
        );
        assert_eq!(
            g(&["chest"], Some(&["triceps"]), &["triceps"]),
            GuardVerdict::Halve,
            "synergist"
        );
        assert_eq!(
            g(&["chest"], Some(&["triceps"]), &["quads"]),
            GuardVerdict::Train,
            "clear"
        );
        assert_eq!(
            g(&["chest"], None, &["triceps"]),
            GuardVerdict::Train,
            "no syn"
        );
        assert_eq!(
            g(&["chest"], Some(&["triceps"]), &[]),
            GuardVerdict::Train,
            "nobody hurt"
        );
        assert_eq!(
            g(&["quads"], Some(&[]), &["Quadriceps"]),
            GuardVerdict::Skip,
            "alias and case"
        );
        // A target beats a synergist when both are hurt.
        assert_eq!(
            g(&["chest"], Some(&["triceps"]), &["triceps", "chest"]),
            GuardVerdict::Skip
        );
        // Separators and case are ignored on both sides.
        assert_eq!(
            g(&["Front Delts"], None, &["front_delts"]),
            GuardVerdict::Skip
        );
        assert_eq!(g(&["rear-delts"], None, &["REARDELTS"]), GuardVerdict::Skip);
    }

    #[test]
    fn norm_muscle_strips_case_separators_and_aliases() {
        assert_eq!(norm_muscle("Quadriceps"), "quads");
        assert_eq!(norm_muscle("quads"), "quads");
        assert_eq!(norm_muscle(" Side_Delts "), "sidedelts");
        assert_eq!(norm_muscle("lower-back"), "lowerback");
        assert_eq!(
            norm_muscle("\u{feff}Lats\u{a0}"),
            "lats",
            "JS whitespace, U+FEFF and NBSP"
        );
        assert_eq!(
            norm_muscle("a\u{85}b"),
            "a\u{85}b",
            "U+0085 is not JS whitespace"
        );
        assert_eq!(norm_muscle(""), "");
        assert_eq!(
            norm_muscle("Quadriceps Femoris"),
            "quadricepsfemoris",
            "alias is exact"
        );
    }

    fn checkin(prs: f64, soreness: &[(&str, f64)]) -> Checkin {
        Checkin {
            prs,
            soreness: soreness.iter().map(|(m, v)| (m.to_string(), *v)).collect(),
        }
    }

    #[test]
    fn injured_muscles_check_in_at_soreness_4() {
        let c = checkin(7.0, &[("quads", 2.0), ("glutes", 3.0)]);
        let out = apply_injury_to_checkin(&c, &v(&["quads"]));
        assert_eq!(out, checkin(7.0, &[("quads", 4.0), ("glutes", 3.0)]));
        assert_eq!(out.prs, 7.0, "prs untouched");
        let single = checkin(7.0, &[("quads", 2.0)]);
        assert_eq!(
            apply_injury_to_checkin(&single, &[]),
            single,
            "no injuries, no change"
        );
        // The input is not modified, an unrated muscle is added, and the alias lands on `quads`.
        assert_eq!(c.soreness.get("quads"), Some(&2.0));
        let added = apply_injury_to_checkin(&c, &v(&["Quadriceps", "Calves"]));
        assert_eq!(added.soreness.get("quads"), Some(&4.0));
        assert_eq!(added.soreness.get("calves"), Some(&4.0));
        assert_eq!(added.soreness.len(), 3);
        // Already at 4 stays 4, and nothing is ever lowered.
        let worst = checkin(5.0, &[("quads", 4.0)]);
        assert_eq!(apply_injury_to_checkin(&worst, &v(&["quads"])), worst);
    }

    #[test]
    fn date_keys_add_across_month_boundaries() {
        assert_eq!(add_days_key("2026-09-13", 0), "2026-09-13", "plus zero");
        assert_eq!(add_days_key("2026-09-30", 1), "2026-10-01", "month roll");
        assert_eq!(add_days_key("2026-09-13", 7), "2026-09-20", "plus week");
    }

    #[test]
    fn date_keys_cross_years_leap_days_and_dst_dates() {
        let add = |key: &str, days: i64| add_days_key(key, days);
        assert_eq!(add("2026-12-31", 1), "2027-01-01");
        assert_eq!(add("2027-01-01", -1), "2026-12-31");
        assert_eq!(add("2028-02-28", 1), "2028-02-29", "leap year");
        assert_eq!(add("2028-02-29", 1), "2028-03-01");
        assert_eq!(add("2026-02-28", 1), "2026-03-01", "not a leap year");
        assert_eq!(add("2100-02-28", 1), "2100-03-01", "century");
        assert_eq!(add("2000-02-28", 1), "2000-02-29", "400 years");
        // The US DST changes in 2026: a calendar day is a calendar day.
        assert_eq!(add("2026-03-07", 1), "2026-03-08");
        assert_eq!(add("2026-03-08", 1), "2026-03-09");
        assert_eq!(add("2026-10-31", 1), "2026-11-01");
        assert_eq!(add("2026-11-01", 1), "2026-11-02");
        assert_eq!(add("2026-09-13", 365), "2027-09-13");
        assert_eq!(add("2026-09-13", -1000), "2023-12-18");
    }

    #[test]
    fn a_malformed_key_comes_back_unchanged_and_try_reports_it() {
        for bad in [
            "",
            "2026-9-13",
            "2026-13-01",
            "2026-02-29",
            "2026-09-13T00:00:00Z",
        ] {
            assert_eq!(add_days_key(bad, 1), bad);
            assert!(try_add_days_key(bad, 1).is_err(), "{bad}");
        }
        assert_eq!(
            try_add_days_key("2026-09-30", 1).as_deref(),
            Ok("2026-10-01")
        );
    }

    #[test]
    fn date_key_from_ymd_pads() {
        assert_eq!(date_key_from_ymd(2026, 9, 3), "2026-09-03");
        assert_eq!(date_key_from_ymd(2026, 12, 31), "2026-12-31");
        assert_eq!(date_key_from_ymd(7, 1, 1), "0007-01-01");
    }

    #[test]
    fn today_key_follows_the_offset() {
        // 2026-10-02T03:30:00Z.
        let ms = 1_790_911_800_000;
        assert_eq!(today_key(ms, 0), "2026-10-02");
        assert_eq!(
            today_key(ms, -240),
            "2026-10-01",
            "New York is still on the 1st"
        );
        assert_eq!(today_key(ms, 540), "2026-10-02", "Tokyo");
        assert_eq!(today_key(ms, 14 * 60), "2026-10-02");
        assert_eq!(today_key(ms, -12 * 60), "2026-10-01");
        // Local midnight edges (2026-10-02T00:00:00Z).
        let midnight = 1_790_899_200_000;
        assert_eq!(
            today_key(midnight - 1, 0),
            "2026-10-01",
            "one ms before UTC midnight"
        );
        assert_eq!(today_key(midnight, 0), "2026-10-02", "UTC midnight");
        assert_eq!(
            today_key(midnight - 1, 60),
            "2026-10-02",
            "one ms before, +01:00"
        );
        // Negative epochs floor correctly instead of truncating toward zero.
        assert_eq!(today_key(-1, 0), "1969-12-31");
        assert_eq!(today_key(0, 0), "1970-01-01");
        assert_eq!(today_key(0, -1), "1969-12-31");
        // DST days in the offset the caller supplies: 2026-03-08T06:30Z is 01:30 EST, and a day
        // later is 02:30 EDT on the 9th.
        assert_eq!(today_key(1_772_951_400_000, -300), "2026-03-08");
        assert_eq!(
            today_key(1_772_951_400_000 + 86_400_000, -240),
            "2026-03-09"
        );
    }

    #[test]
    fn today_key_does_not_panic_on_extreme_input() {
        for ms in [i64::MIN, i64::MAX, 0, i64::MAX / 2, i64::MIN / 2] {
            for off in [i32::MIN, -1440, 0, 1440, i32::MAX] {
                assert!(!today_key(ms, off).is_empty());
            }
        }
    }

    #[test]
    fn json_shape_matches_the_ts_schema() {
        let a: Availability = serde_json::from_str(
            r#"{"status":"injured","since":"2026-09-10","muscle":"calves","note":"strain","extra":1}"#,
        )
        .expect("availability parses");
        assert_eq!(a.status, AvailabilityStatus::Injured);
        assert_eq!(a.until, None);
        let back = serde_json::to_value(&a).expect("serializes");
        assert_eq!(
            back,
            serde_json::json!({"status":"injured","since":"2026-09-10","muscle":"calves","note":"strain"}),
            "unknown fields dropped, None omitted"
        );
        let plain: Availability = serde_json::from_str(r#"{"status":"active"}"#).expect("parses");
        assert_eq!(plain, Availability::default());
        assert_eq!(
            serde_json::to_string(&plain).expect("serializes"),
            r#"{"status":"active"}"#
        );
        let s: DaySkip =
            serde_json::from_str(r#"{"date":"2026-09-13","reason":"scheduling"}"#).expect("parses");
        assert_eq!(s.reason, SkipReason::Scheduling);
        assert_eq!(
            serde_json::to_string(&s).expect("serializes"),
            r#"{"date":"2026-09-13","reason":"scheduling"}"#
        );
        assert!(
            serde_json::from_str::<DaySkip>(r#"{"date":"2026-09-13","reason":"active"}"#).is_err()
        );
        assert!(
            serde_json::from_str::<Availability>(r#"{"status":"Sick"}"#).is_err(),
            "lowercase only"
        );
        assert_eq!(
            serde_json::to_string(&DayClass::Shift).expect("serializes"),
            r#""shift""#
        );
        assert_eq!(
            serde_json::to_string(&GuardVerdict::Halve).expect("serializes"),
            r#""halve""#
        );
        let c: Checkin =
            serde_json::from_str(r#"{"prs":7,"soreness":{"quads":2}}"#).expect("parses");
        assert_eq!(c.prs, 7.0);
        assert_eq!(c.soreness.get("quads"), Some(&2.0));
    }

    #[test]
    fn skip_reason_and_status_convert_both_ways() {
        for reason in [
            SkipReason::Break,
            SkipReason::Vacation,
            SkipReason::Sick,
            SkipReason::Injured,
            SkipReason::Scheduling,
        ] {
            assert_eq!(AvailabilityStatus::from(reason).skip_reason(), Some(reason));
        }
        assert_eq!(AvailabilityStatus::Active.skip_reason(), None);
    }
}
