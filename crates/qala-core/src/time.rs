//! Calendar and instant arithmetic by hand (no chrono, no clock).
//!
//! Instants are ISO 8601 strings with an explicit offset and become epoch milliseconds here.
//! Local calendar days are `YYYY-MM-DD` keys. Everything is pure integer math on the proleptic
//! Gregorian calendar (Howard Hinnant's civil-from-days), so DST never enters: a DST day is a
//! 23 or 25 hour span between two instants that each carry their own offset.
//!
//! TS reference: `Date.parse` and `daysBetween` in `packages/engine/decay.ts`, `addDaysKey` in
//! `packages/engine/availability.ts`. Where `Date.parse` yields NaN the TS code silently carries
//! NaN along; the Rust port returns a [`TimeError`] instead.

use std::fmt;

/// An unparseable instant or date key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeError {
    /// The text that failed to parse.
    pub input: String,
    /// What was wrong with it.
    pub reason: &'static str,
}

impl TimeError {
    fn new(input: &str, reason: &'static str) -> Self {
        TimeError {
            input: input.to_string(),
            reason,
        }
    }
}

impl fmt::Display for TimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid date {:?}: {}", self.input, self.reason)
    }
}

impl std::error::Error for TimeError {}

/// Milliseconds in a day.
pub const MS_PER_DAY: i64 = 86_400_000;

/// Day counts are clamped to this magnitude (about 2.7e8 years) before calendar math.
const MAX_DAYS: i64 = 100_000_000_000_000;

/// Days since 1970-01-01 for a civil date. `month` is 1..=12 and `day` is 1..=31; the caller
/// validates.
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Civil `(year, month, day)` for days since 1970-01-01.
pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
    // Far beyond any real date; the clamp only keeps the arithmetic below from overflowing.
    let z = days.clamp(-MAX_DAYS, MAX_DAYS) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Gregorian leap year rule.
pub fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Days in a month (1..=12); 0 for anything else.
pub fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Reads exactly `n` ASCII digits starting at `*pos`, advancing `*pos`.
fn digits(b: &[u8], pos: &mut usize, n: usize) -> Option<i64> {
    let end = pos.checked_add(n)?;
    let slice = b.get(*pos..end)?;
    let mut v: i64 = 0;
    for &c in slice {
        if !c.is_ascii_digit() {
            return None;
        }
        v = v * 10 + i64::from(c - b'0');
    }
    *pos = end;
    Some(v)
}

fn expect(b: &[u8], pos: &mut usize, c: u8) -> bool {
    if b.get(*pos) == Some(&c) {
        *pos += 1;
        true
    } else {
        false
    }
}

/// Parses `YYYY-MM-DD` into `(year, month, day)` with range checks, consuming all of `b`.
fn parse_ymd(b: &[u8], pos: &mut usize) -> Option<(i64, i64, i64)> {
    let y = digits(b, pos, 4)?;
    if !expect(b, pos, b'-') {
        return None;
    }
    let m = digits(b, pos, 2)?;
    if !expect(b, pos, b'-') {
        return None;
    }
    let d = digits(b, pos, 2)?;
    if !(1..=12).contains(&m) || d < 1 || d > days_in_month(y, m) {
        return None;
    }
    Some((y, m, d))
}

/// Days since the epoch for a `YYYY-MM-DD` key. Errors on a malformed key or a day that does
/// not exist (`2026-02-30`).
pub fn days_from_date_key(key: &str) -> Result<i64, TimeError> {
    let b = key.as_bytes();
    let mut pos = 0;
    match parse_ymd(b, &mut pos) {
        Some((y, m, d)) if pos == b.len() => Ok(days_from_civil(y, m, d)),
        Some(_) => Err(TimeError::new(key, "trailing characters after the date")),
        None => Err(TimeError::new(key, "expected a valid YYYY-MM-DD date")),
    }
}

/// `YYYY-MM-DD` for days since the epoch. Years outside 0..=9999 use the signed six digit form
/// `Date.prototype.toISOString` uses.
pub fn date_key_from_days(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    if (0..=9999).contains(&y) {
        format!("{y:04}-{m:02}-{d:02}")
    } else {
        let sign = if y < 0 { '-' } else { '+' };
        format!("{sign}{:06}-{m:02}-{d:02}", y.abs())
    }
}

/// Day of week for days since the epoch, 0 = Sunday (same as `Date.getUTCDay`).
pub fn weekday_of_days(days: i64) -> u8 {
    // 1970-01-01 was a Thursday (4).
    ((days.rem_euclid(7) + 4) % 7) as u8
}

/// Day of week of a `YYYY-MM-DD` key, 0 = Sunday.
pub fn weekday_of_key(key: &str) -> Result<u8, TimeError> {
    Ok(weekday_of_days(days_from_date_key(key)?))
}

/// Parses an ISO 8601 instant to epoch milliseconds.
///
/// Accepts `YYYY-MM-DDTHH:MM[:SS[.f+]]` followed by `Z`, `+HH:MM` or `-HH:MM`, and a bare
/// `YYYY-MM-DD` (UTC midnight, as `Date.parse` reads it). Fractions longer than three digits are
/// truncated to milliseconds. A date-time without an offset is an error: `Date.parse` would
/// read it in the host's local zone, and the core has no zone. `24:00:00` is accepted as the
/// end of the day, as in JS. The epoch string `1970-01-01T00:00:00.000Z` parses to 0.
pub fn parse_iso(s: &str) -> Result<i64, TimeError> {
    let b = s.as_bytes();
    let mut pos = 0;
    let (y, mo, d) =
        parse_ymd(b, &mut pos).ok_or_else(|| TimeError::new(s, "bad calendar date"))?;
    let day_ms = days_from_civil(y, mo, d) * MS_PER_DAY;
    if pos == b.len() {
        return Ok(day_ms);
    }
    if !expect(b, &mut pos, b'T') {
        return Err(TimeError::new(s, "expected T after the date"));
    }
    let hh = digits(b, &mut pos, 2).ok_or_else(|| TimeError::new(s, "bad hour"))?;
    if !expect(b, &mut pos, b':') {
        return Err(TimeError::new(s, "expected : after the hour"));
    }
    let mm = digits(b, &mut pos, 2).ok_or_else(|| TimeError::new(s, "bad minute"))?;
    let mut ss = 0;
    let mut frac_ms = 0;
    if expect(b, &mut pos, b':') {
        ss = digits(b, &mut pos, 2).ok_or_else(|| TimeError::new(s, "bad second"))?;
        if expect(b, &mut pos, b'.') {
            let start = pos;
            let mut scale = 100;
            while let Some(&c) = b.get(pos) {
                if !c.is_ascii_digit() {
                    break;
                }
                frac_ms += i64::from(c - b'0') * scale;
                scale /= 10;
                pos += 1;
            }
            if pos == start {
                return Err(TimeError::new(s, "empty fraction"));
            }
        }
    }
    if mm > 59 || ss > 59 || hh > 24 || (hh == 24 && (mm != 0 || ss != 0 || frac_ms != 0)) {
        return Err(TimeError::new(s, "time of day out of range"));
    }
    // Digits past the third decimal made `scale` hit 0; they contribute nothing.
    let offset_min = match b.get(pos) {
        Some(b'Z') => {
            pos += 1;
            0
        }
        Some(&sign @ (b'+' | b'-')) => {
            pos += 1;
            let oh = digits(b, &mut pos, 2).ok_or_else(|| TimeError::new(s, "bad offset"))?;
            if !expect(b, &mut pos, b':') {
                return Err(TimeError::new(s, "expected HH:MM offset"));
            }
            let om = digits(b, &mut pos, 2).ok_or_else(|| TimeError::new(s, "bad offset"))?;
            if oh > 23 || om > 59 {
                return Err(TimeError::new(s, "offset out of range"));
            }
            let total = oh * 60 + om;
            if sign == b'-' {
                -total
            } else {
                total
            }
        }
        _ => return Err(TimeError::new(s, "missing UTC offset")),
    };
    if pos != b.len() {
        return Err(TimeError::new(s, "trailing characters"));
    }
    let local_ms = day_ms + ((hh * 60 + mm) * 60 + ss) * 1000 + frac_ms;
    Ok(local_ms - offset_min * 60_000)
}

/// `(b - a)` in days, from two ISO instants: `daysBetween` in decay.ts. The subtraction is done
/// on integer milliseconds, which is exact where TS subtracts doubles of the same value.
pub fn days_between(a_iso: &str, b_iso: &str) -> Result<f64, TimeError> {
    let a = parse_iso(a_iso)?;
    let b = parse_iso(b_iso)?;
    Ok((b - a) as f64 / 86_400_000.0)
}

/// The local `YYYY-MM-DD` key of an instant for a UTC offset in minutes (`-240` for EDT).
pub fn local_date_key(epoch_ms: i64, offset_min: impl Into<i64>) -> String {
    let local = epoch_ms.saturating_add(offset_min.into().saturating_mul(60_000));
    date_key_from_days(local.div_euclid(MS_PER_DAY))
}

/// Adds calendar days to a `YYYY-MM-DD` key using UTC math, so DST cannot move the result.
/// Errors on a malformed key. Day counts that overflow saturate.
pub fn try_add_days_key(key: &str, days: i64) -> Result<String, TimeError> {
    let base = days_from_date_key(key)?;
    Ok(date_key_from_days(base.saturating_add(days)))
}

/// `addDaysKey` in availability.ts. TS throws a RangeError on a malformed key
/// (`toISOString` of an invalid Date); this returns the key unchanged instead, so it cannot
/// panic. Use [`try_add_days_key`] to see the error.
pub fn add_days_key(key: &str, days: i64) -> String {
    try_add_days_key(key, days).unwrap_or_else(|_| key.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_zero_string() {
        assert_eq!(parse_iso("1970-01-01T00:00:00.000Z"), Ok(0));
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Ok(0));
        assert_eq!(parse_iso("1970-01-01"), Ok(0));
    }

    #[test]
    fn known_instants() {
        assert_eq!(
            parse_iso("2026-10-02T17:30:00-04:00"),
            Ok(1_790_976_600_000)
        );
        assert_eq!(parse_iso("2026-10-02T21:30:00Z"), Ok(1_790_976_600_000));
        assert_eq!(
            parse_iso("2026-10-02T08:00:00-04:00"),
            Ok(1_790_942_400_000)
        );
        assert_eq!(parse_iso("2026-03-08T00:00:00Z"), Ok(1_772_928_000_000));
        assert_eq!(parse_iso("2024-02-29T12:00:00Z"), Ok(1_709_208_000_000));
        assert_eq!(parse_iso("2000-01-01T00:00:00+05:30"), Ok(946_665_000_000));
        assert_eq!(parse_iso("1969-12-31T23:59:59Z"), Ok(-1000));
        assert_eq!(parse_iso("9999-12-31T23:59:59Z"), Ok(253_402_300_799_000));
        assert_eq!(parse_iso("0000-01-01T00:00:00Z"), Ok(-62_167_219_200_000));
    }

    #[test]
    fn offsets_move_the_instant_the_right_way() {
        let z = parse_iso("2026-06-01T12:00:00Z").unwrap();
        assert_eq!(
            parse_iso("2026-06-01T12:00:00+02:00").unwrap(),
            z - 2 * 3_600_000
        );
        assert_eq!(
            parse_iso("2026-06-01T12:00:00-02:00").unwrap(),
            z + 2 * 3_600_000
        );
        assert_eq!(
            parse_iso("2026-06-01T12:00:00+05:45").unwrap(),
            z - (5 * 60 + 45) * 60_000
        );
        assert_eq!(parse_iso("2026-06-01T12:00:00-00:00").unwrap(), z);
    }

    #[test]
    fn fractions_and_optional_seconds() {
        let base = parse_iso("2026-06-01T12:00:00Z").unwrap();
        assert_eq!(parse_iso("2026-06-01T12:00:00.5Z").unwrap(), base + 500);
        assert_eq!(parse_iso("2026-06-01T12:00:00.05Z").unwrap(), base + 50);
        assert_eq!(parse_iso("2026-06-01T12:00:00.123Z").unwrap(), base + 123);
        assert_eq!(
            parse_iso("2026-06-01T12:00:00.123999Z").unwrap(),
            base + 123
        );
        assert_eq!(
            parse_iso("2026-06-01T12:00:00.123456789Z").unwrap(),
            base + 123
        );
        assert_eq!(parse_iso("2026-06-01T12:00Z").unwrap(), base);
        assert_eq!(parse_iso("2026-06-01T12:30Z").unwrap(), base + 30 * 60_000);
        assert_eq!(
            parse_iso("2026-06-01T24:00:00Z").unwrap(),
            parse_iso("2026-06-02T00:00:00Z").unwrap()
        );
    }

    #[test]
    fn rejects_invalid_input_without_panicking() {
        for bad in [
            "",
            "x",
            "2026",
            "2026-06",
            "2026-6-1",
            "2026-13-01T00:00:00Z",
            "2026-00-10T00:00:00Z",
            "2026-02-30T00:00:00Z",
            "2023-02-29T00:00:00Z",
            "1900-02-29T00:00:00Z",
            "2100-02-29T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2026-06-00T00:00:00Z",
            "2026-06-01T25:00:00Z",
            "2026-06-01T24:00:01Z",
            "2026-06-01T24:30:00Z",
            "2026-06-01T12:60:00Z",
            "2026-06-01T12:00:60Z",
            "2026-06-01T12:00:00",
            "2026-06-01T12:00:00.Z",
            "2026-06-01T12:00:00+0100",
            "2026-06-01T12:00:00+24:00",
            "2026-06-01T12:00:00+01:60",
            "2026-06-01T12:00:00+01",
            "2026-06-01T12:00:00Zjunk",
            "2026-06-01 12:00:00Z",
            "2026-06-01T12:00:00z",
            "2026-06-01T1:00:00Z",
            "2026-06-01T12:0a:00Z",
            "2026-06-01T",
            "+2026-06-01T00:00:00Z",
            "NaN",
            "2026-06-01Té",
            "é026-06-01",
        ] {
            assert!(parse_iso(bad).is_err(), "{bad:?} should not parse");
        }
    }

    #[test]
    fn leap_years() {
        assert!(is_leap_year(2024));
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(1900));
        assert!(!is_leap_year(2100));
        assert!(!is_leap_year(2026));
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2026, 2), 28);
        assert_eq!(days_in_month(2026, 13), 0);
        assert!(parse_iso("2024-02-29T00:00:00Z").is_ok());
        assert!(parse_iso("2000-02-29T00:00:00Z").is_ok());
        let feb28 = parse_iso("2024-02-28T00:00:00Z").unwrap();
        assert_eq!(
            parse_iso("2024-03-01T00:00:00Z").unwrap() - feb28,
            2 * MS_PER_DAY
        );
        let feb28 = parse_iso("2026-02-28T00:00:00Z").unwrap();
        assert_eq!(
            parse_iso("2026-03-01T00:00:00Z").unwrap() - feb28,
            MS_PER_DAY
        );
    }

    #[test]
    fn civil_round_trip_over_a_wide_range() {
        let mut prev = civil_from_days(-800_000);
        assert_eq!(days_from_civil(prev.0, prev.1, prev.2), -800_000);
        for z in -799_999..800_000 {
            let c = civil_from_days(z);
            assert_eq!(days_from_civil(c.0, c.1, c.2), z);
            // Consecutive days either advance the day or roll the month.
            assert!(c > prev);
            prev = c;
        }
    }

    #[test]
    fn days_between_across_dst() {
        // 2026-03-08: US clocks spring forward, so local noon to local noon is 23 hours.
        let d = days_between("2026-03-07T12:00:00-05:00", "2026-03-08T12:00:00-04:00").unwrap();
        assert_eq!(d, 23.0 / 24.0);
        // 2026-11-01: clocks fall back, 25 hours.
        let d = days_between("2026-10-31T12:00:00-04:00", "2026-11-01T12:00:00-05:00").unwrap();
        assert_eq!(d, 25.0 / 24.0);
        // Same wall clock, same offset: exactly one day.
        assert_eq!(
            days_between("2026-03-07T12:00:00Z", "2026-03-08T12:00:00Z").unwrap(),
            1.0
        );
        // Order matters.
        assert_eq!(
            days_between("2026-03-08T12:00:00Z", "2026-03-07T12:00:00Z").unwrap(),
            -1.0
        );
        assert_eq!(
            days_between("1970-01-01T00:00:00.000Z", "1970-01-02T12:00:00Z").unwrap(),
            1.5
        );
        assert!(days_between("nope", "2026-03-07T12:00:00Z").is_err());
        assert!(days_between("2026-03-07T12:00:00Z", "nope").is_err());
    }

    #[test]
    fn local_date_key_around_local_midnight() {
        // 2026-03-08: US clocks jump at 07:00Z (02:00 EST to 03:00 EDT), so that local day is
        // 23 hours long.
        let est_midnight = parse_iso("2026-03-08T00:00:00-05:00").unwrap();
        assert_eq!(local_date_key(est_midnight - 1, -300), "2026-03-07");
        assert_eq!(local_date_key(est_midnight, -300), "2026-03-08");
        // Midnight EDT the next day is 04:00Z, one hour earlier than a naive 24 h step.
        let edt_midnight = parse_iso("2026-03-09T00:00:00-04:00").unwrap();
        assert_eq!(edt_midnight - est_midnight, 23 * 3_600_000);
        assert_eq!(local_date_key(edt_midnight - 1, -240), "2026-03-08");
        assert_eq!(local_date_key(edt_midnight, -240), "2026-03-09");
        // 2026-11-01: midnight EDT, then the long day ends at midnight EST.
        let edt_midnight = parse_iso("2026-11-01T00:00:00-04:00").unwrap();
        assert_eq!(local_date_key(edt_midnight - 1, -240), "2026-10-31");
        assert_eq!(local_date_key(edt_midnight, -240), "2026-11-01");
        let est_midnight = parse_iso("2026-11-02T00:00:00-05:00").unwrap();
        assert_eq!(est_midnight - edt_midnight, 25 * 3_600_000);
        assert_eq!(local_date_key(est_midnight - 1, -300), "2026-11-01");
        assert_eq!(local_date_key(est_midnight, -300), "2026-11-02");
        // Positive offsets and offsets that are not whole hours.
        assert_eq!(local_date_key(0, 330), "1970-01-01");
        assert_eq!(local_date_key(0, -1), "1969-12-31");
        assert_eq!(
            local_date_key(parse_iso("2026-01-31T19:00:00Z").unwrap(), 330),
            "2026-02-01"
        );
    }

    #[test]
    fn local_date_key_handles_negative_epochs() {
        assert_eq!(local_date_key(-1, 0), "1969-12-31");
        assert_eq!(local_date_key(-MS_PER_DAY, 0), "1969-12-31");
        assert_eq!(local_date_key(-MS_PER_DAY - 1, 0), "1969-12-30");
        assert_eq!(
            local_date_key(i64::MIN, i32::MIN),
            date_key_from_days(i64::MIN.div_euclid(MS_PER_DAY))
        );
        assert!(!local_date_key(i64::MAX, 0).is_empty());
    }

    #[test]
    fn add_days_key_matches_ts() {
        assert_eq!(add_days_key("2026-10-02", 1), "2026-10-03");
        assert_eq!(add_days_key("2026-10-02", 0), "2026-10-02");
        assert_eq!(add_days_key("2026-10-31", 1), "2026-11-01");
        assert_eq!(add_days_key("2026-12-31", 1), "2027-01-01");
        assert_eq!(add_days_key("2027-01-01", -1), "2026-12-31");
        assert_eq!(add_days_key("2024-02-28", 1), "2024-02-29");
        assert_eq!(add_days_key("2024-02-28", 2), "2024-03-01");
        assert_eq!(add_days_key("2026-02-28", 1), "2026-03-01");
        // DST days are 23 and 25 hours long but the key arithmetic is plain calendar days.
        assert_eq!(add_days_key("2026-03-07", 1), "2026-03-08");
        assert_eq!(add_days_key("2026-03-08", 1), "2026-03-09");
        assert_eq!(add_days_key("2026-10-31", 2), "2026-11-02");
        assert_eq!(add_days_key("2026-01-01", 365), "2027-01-01");
        assert_eq!(add_days_key("2026-01-01", -365), "2025-01-01");
        assert_eq!(add_days_key("2024-01-01", 366), "2025-01-01");
        // A malformed key comes back unchanged (TS throws).
        assert_eq!(add_days_key("garbage", 3), "garbage");
        assert_eq!(add_days_key("2026-02-30", 3), "2026-02-30");
        assert!(try_add_days_key("garbage", 3).is_err());
        // Overflow saturates instead of panicking.
        let _ = add_days_key("2026-10-02", i64::MAX);
        let _ = add_days_key("2026-10-02", i64::MIN);
    }

    #[test]
    fn date_keys_round_trip_and_reject_bad_ones() {
        for key in [
            "1970-01-01",
            "2024-02-29",
            "2026-03-08",
            "2026-11-01",
            "0000-01-01",
            "9999-12-31",
        ] {
            assert_eq!(date_key_from_days(days_from_date_key(key).unwrap()), key);
        }
        assert!(days_from_date_key("2026-03-08T00:00:00Z").is_err());
        assert!(days_from_date_key("2026-3-8").is_err());
        assert!(days_from_date_key("2026-02-29").is_err());
        assert!(days_from_date_key("").is_err());
    }

    #[test]
    fn years_outside_four_digits_use_signed_form() {
        assert_eq!(
            date_key_from_days(days_from_civil(10_000, 1, 1)),
            "+010000-01-01"
        );
        assert_eq!(
            date_key_from_days(days_from_civil(-1, 12, 31)),
            "-000001-12-31"
        );
    }

    #[test]
    fn weekdays() {
        assert_eq!(weekday_of_key("1970-01-01"), Ok(4));
        assert_eq!(weekday_of_key("2026-10-02"), Ok(5));
        assert_eq!(weekday_of_key("2026-10-04"), Ok(0));
        assert_eq!(weekday_of_key("2026-03-08"), Ok(0));
        assert_eq!(weekday_of_key("1969-12-31"), Ok(3));
        assert!(weekday_of_key("bad").is_err());
    }
}
