//! Hybrid logical clock for record sync (docs/rust-core.md section 4, DECISIONS S11).
//!
//! Every field of a synced record carries the clock value of the write that set it, and for two
//! writes to the same field the higher clock wins. The clock is the one from Kulkarni et al.,
//! "Logical Physical Clocks" (2014): wall time in milliseconds plus a counter that breaks ties
//! when the wall time does not advance, plus the writing device's node id so that no two devices
//! ever produce the same value.
//!
//! Nothing here reads a clock. Callers pass `now_ms`, and the sync layer on each platform
//! (Room, IndexedDB, the server) implements the same rules and replays the vectors in
//! `testdata/golden/hlc/` to prove it.
//!
//! # Canonical range
//!
//! The string form `{wall_ms:013}-{counter:05}-{node_id}` sorts as text in the same order as the
//! struct sorts, but only inside this range, which [`Hlc::validate`] enforces and [`tick`] and
//! [`receive`] keep results in:
//!
//! - `wall_ms` in `0..=9_999_999_999_999` (13 digits, up to the year 2286),
//! - `counter` in `0..=99_999` (5 digits),
//! - `node_id` non-empty ASCII graphic characters (no spaces or control characters). Restricting
//!   to ASCII keeps byte order, UTF-16 order and code point order identical on every platform.
//!
//! [`tick`]: Hlc::tick
//! [`receive`]: Hlc::receive

use serde::{Deserialize, Serialize};
use std::cmp::max;
use std::fmt;
use std::str::FromStr;

/// Largest wall time that fits the 13-digit string form.
pub const MAX_WALL_MS: i64 = 9_999_999_999_999;
/// Largest counter that fits the 5-digit string form. One more is a [`HlcError::CounterOverflow`].
pub const MAX_COUNTER: u32 = 99_999;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hlc {
    // Field order is the sort order: derived `Ord` compares wall time, then counter, then node.
    pub wall_ms: i64,
    pub counter: u32,
    pub node_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HlcError {
    /// A string that is not `{13 digits}-{5 digits}-{node id}`.
    InvalidFormat(&'static str),
    /// The node id is empty or has characters outside ASCII graphic.
    InvalidNodeId,
    /// The wall time is outside `0..=MAX_WALL_MS`.
    WallOutOfRange,
    /// The counter would pass [`MAX_COUNTER`].
    CounterOverflow,
    /// The remote wall time is more than the allowed drift ahead of `now_ms`.
    ClockDrift { ahead_ms: i64, max_drift_ms: i64 },
}

impl HlcError {
    /// Stable machine name, used by the golden vectors and the JSON API.
    pub fn kind(&self) -> &'static str {
        match self {
            HlcError::InvalidFormat(_) => "invalid_format",
            HlcError::InvalidNodeId => "invalid_node_id",
            HlcError::WallOutOfRange => "wall_out_of_range",
            HlcError::CounterOverflow => "counter_overflow",
            HlcError::ClockDrift { .. } => "clock_drift",
        }
    }
}

impl fmt::Display for HlcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HlcError::InvalidFormat(why) => write!(f, "invalid clock string: {why}"),
            HlcError::InvalidNodeId => f.write_str("node id must be non-empty ASCII graphic"),
            HlcError::WallOutOfRange => write!(f, "wall time outside 0..={MAX_WALL_MS}"),
            HlcError::CounterOverflow => write!(f, "counter would pass {MAX_COUNTER}"),
            HlcError::ClockDrift {
                ahead_ms,
                max_drift_ms,
            } => {
                write!(
                    f,
                    "remote clock is {ahead_ms} ms ahead, more than the allowed {max_drift_ms} ms"
                )
            }
        }
    }
}

impl std::error::Error for HlcError {}

impl Hlc {
    /// The clock a node starts from: wall 0, counter 0. Any real `now_ms` ticks past it.
    pub fn zero(node_id: &str) -> Hlc {
        Hlc {
            wall_ms: 0,
            counter: 0,
            node_id: node_id.to_string(),
        }
    }

    /// Check the canonical range (see the module docs).
    pub fn validate(&self) -> Result<(), HlcError> {
        if self.node_id.is_empty() || !self.node_id.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(HlcError::InvalidNodeId);
        }
        if !(0..=MAX_WALL_MS).contains(&self.wall_ms) {
            return Err(HlcError::WallOutOfRange);
        }
        if self.counter > MAX_COUNTER {
            return Err(HlcError::CounterOverflow);
        }
        Ok(())
    }

    /// Parse the string form. Strict: exactly 13 digits, a hyphen, exactly 5 digits, a hyphen,
    /// then the node id (which may itself contain hyphens). Everything `parse` accepts prints
    /// back to the same string.
    pub fn parse(s: &str) -> Result<Hlc, HlcError> {
        let mut parts = s.splitn(3, '-');
        let (Some(wall), Some(counter), Some(node)) = (parts.next(), parts.next(), parts.next())
        else {
            return Err(HlcError::InvalidFormat("expected wall-counter-node"));
        };
        let digits =
            |text: &str, len: usize| text.len() == len && text.bytes().all(|b| b.is_ascii_digit());
        if !digits(wall, 13) {
            return Err(HlcError::InvalidFormat("wall time must be 13 digits"));
        }
        if !digits(counter, 5) {
            return Err(HlcError::InvalidFormat("counter must be 5 digits"));
        }
        let wall_ms: i64 = wall
            .parse()
            .map_err(|_| HlcError::InvalidFormat("wall time must be 13 digits"))?;
        let counter: u32 = counter
            .parse()
            .map_err(|_| HlcError::InvalidFormat("counter must be 5 digits"))?;
        let hlc = Hlc {
            wall_ms,
            counter,
            node_id: node.to_string(),
        };
        hlc.validate()?;
        Ok(hlc)
    }

    /// The clock value for a local event (a write, or a send) at physical time `now_ms`.
    ///
    /// The wall time is `max(self.wall_ms, now_ms)`. The counter increments when the wall time
    /// did not advance (including when the physical clock went backwards) and resets to 0 when
    /// it did. The result is always greater than `self`.
    pub fn tick(&self, now_ms: i64) -> Result<Hlc, HlcError> {
        self.validate()?;
        let wall = max(self.wall_ms, now_ms);
        let counter = if wall == self.wall_ms {
            bump(self.counter)?
        } else {
            0
        };
        self.next(wall, counter)
    }

    /// The clock value after receiving a write stamped `remote`, at physical time `now_ms`.
    ///
    /// The wall time is `max(self, remote, now)`. The counter follows the three tie cases of the
    /// paper: all of local, remote and now tie (counter is `max` of both plus 1), only local
    /// ties (local plus 1), only remote ties (remote plus 1), and neither (0). The result is
    /// greater than both `self` and `remote` and keeps the local node id.
    ///
    /// Fails with [`HlcError::ClockDrift`] when `remote.wall_ms - now_ms > max_drift_ms` (a
    /// remote exactly `max_drift_ms` ahead is accepted), so a device with a wrong clock cannot
    /// win every later conflict. Sync uses one day for `max_drift_ms`.
    pub fn receive(&self, remote: &Hlc, now_ms: i64, max_drift_ms: i64) -> Result<Hlc, HlcError> {
        self.validate()?;
        remote.validate()?;
        let ahead_ms = remote.wall_ms.saturating_sub(now_ms);
        if ahead_ms > max_drift_ms {
            return Err(HlcError::ClockDrift {
                ahead_ms,
                max_drift_ms,
            });
        }
        let wall = max(max(self.wall_ms, remote.wall_ms), now_ms);
        let counter = match (wall == self.wall_ms, wall == remote.wall_ms) {
            (true, true) => bump(max(self.counter, remote.counter))?,
            (true, false) => bump(self.counter)?,
            (false, true) => bump(remote.counter)?,
            (false, false) => 0,
        };
        self.next(wall, counter)
    }

    /// A result with this node id, after checking the wall time stayed in range.
    fn next(&self, wall_ms: i64, counter: u32) -> Result<Hlc, HlcError> {
        if !(0..=MAX_WALL_MS).contains(&wall_ms) {
            return Err(HlcError::WallOutOfRange);
        }
        Ok(Hlc {
            wall_ms,
            counter,
            node_id: self.node_id.clone(),
        })
    }
}

/// `counter + 1`, or an error rather than a wrap past [`MAX_COUNTER`].
fn bump(counter: u32) -> Result<u32, HlcError> {
    match counter.checked_add(1) {
        Some(next) if next <= MAX_COUNTER => Ok(next),
        _ => Err(HlcError::CounterOverflow),
    }
}

impl fmt::Display for Hlc {
    /// `{wall_ms:013}-{counter:05}-{node_id}`. Canonical (sortable, parseable) for values that
    /// pass [`Hlc::validate`].
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:013}-{:05}-{}",
            self.wall_ms, self.counter, self.node_id
        )
    }
}

impl FromStr for Hlc {
    type Err = HlcError;

    fn from_str(s: &str) -> Result<Hlc, HlcError> {
        Hlc::parse(s)
    }
}

/// One synced field: its value and the clock of the write that set it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Field<T> {
    pub value: T,
    pub hlc: Hlc,
}

impl<T> Field<T> {
    pub fn new(value: T, hlc: Hlc) -> Field<T> {
        Field { value, hlc }
    }
}

/// Merge two copies of one field: the higher clock wins. Equal clocks keep `local`, which makes
/// merging idempotent.
///
/// Merging is also commutative and associative as long as equal clocks mean equal values. That
/// holds for real writes, because a clock includes the node id and a node never issues the same
/// clock twice. Two different values under one clock are a protocol violation, and this rule
/// only fixes which one a replica keeps.
pub fn merge_field<T: Clone>(local: &Field<T>, remote: &Field<T>) -> Field<T> {
    if remote.hlc > local.hlc {
        remote.clone()
    } else {
        local.clone()
    }
}

/// The clocked `deleted` flag of a record. Records are never removed: a delete is a write of
/// `true`, a restore is a later write of `false`, and the record stays so the delete can sync.
pub type Tombstone = Field<bool>;

/// [`merge_field`] for a tombstone, with one extra rule: equal clocks with different values
/// resolve to deleted. That makes the merge commutative even for a bad pair of equal clocks, so
/// a record that was deleted anywhere stays deleted until a strictly later write restores it.
pub fn merge_tombstone(local: &Tombstone, remote: &Tombstone) -> Tombstone {
    if remote.hlc == local.hlc {
        return Field {
            value: local.value || remote.value,
            hlc: local.hlc.clone(),
        };
    }
    merge_field(local, remote)
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: i64 = 1_790_911_800_000; // 2026-10-02T03:30:00Z
    const DAY: i64 = 86_400_000;

    fn h(wall_ms: i64, counter: u32, node: &str) -> Hlc {
        Hlc {
            wall_ms,
            counter,
            node_id: node.to_string(),
        }
    }

    fn f<T>(value: T, hlc: Hlc) -> Field<T> {
        Field { value, hlc }
    }

    // --- order and string form -------------------------------------------------------------

    #[test]
    fn order_is_wall_then_counter_then_node() {
        let mut all = vec![
            h(W, 3, "n2"),
            h(W + 1, 0, "n1"),
            h(W, 3, "n1"),
            h(W, 10, "n1"),
            h(W, 9, "n9"),
            h(W, 3, "n10"),
            h(W - 1, 99_999, "zz"),
        ];
        all.sort();
        let want = vec![
            h(W - 1, 99_999, "zz"),
            h(W, 3, "n1"),
            h(W, 3, "n10"),
            h(W, 3, "n2"),
            h(W, 9, "n9"),
            h(W, 10, "n1"),
            h(W + 1, 0, "n1"),
        ];
        assert_eq!(all, want);
        // Wall time beats counter, counter beats node.
        assert!(h(W + 1, 0, "a") > h(W, 99_999, "z"));
        assert!(h(W, 2, "a") > h(W, 1, "z"));
        assert!(h(W, 1, "b") > h(W, 1, "a"));
        assert_eq!(h(W, 1, "a").cmp(&h(W, 1, "a")), std::cmp::Ordering::Equal);
    }

    #[test]
    fn string_form_has_the_documented_shape() {
        assert_eq!(h(W, 7, "phone").to_string(), "1790911800000-00007-phone");
        assert_eq!(h(0, 0, "n1").to_string(), "0000000000000-00000-n1");
        assert_eq!(
            h(MAX_WALL_MS, MAX_COUNTER, "n1").to_string(),
            "9999999999999-99999-n1"
        );
        assert_eq!(h(42, 3, "a-b-c").to_string(), "0000000000042-00003-a-b-c");
    }

    #[test]
    fn string_form_round_trips() {
        for hlc in [
            h(W, 7, "phone"),
            h(0, 0, "n1"),
            h(MAX_WALL_MS, MAX_COUNTER, "z"),
            h(1, 99_999, "3f2b8c1e-5d4a-4b7e-9c0d-1a2b3c4d5e6f"),
            h(W, 0, "a-b-c"),
            h(W, 0, "--"),
            h(W, 0, "!~"),
        ] {
            let text = hlc.to_string();
            assert_eq!(Hlc::parse(&text), Ok(hlc.clone()), "{text}");
            assert_eq!(text.parse::<Hlc>(), Ok(hlc));
        }
    }

    #[test]
    fn string_order_equals_struct_order() {
        // Mixed digits, counters across the 9/10 and 99999 edges, nodes that are prefixes of each
        // other and nodes that differ only in case.
        let mut all = Vec::new();
        for wall in [0, 9, 10, W - 1, W, W + 1, MAX_WALL_MS] {
            for counter in [0, 1, 9, 10, 99, 100, 9_999, 10_000, 99_998, 99_999] {
                for node in ["n1", "n10", "n2", "N1", "a-b", "a", "~"] {
                    all.push(h(wall, counter, node));
                }
            }
        }
        let mut by_struct = all.clone();
        by_struct.sort();
        let mut by_text = all;
        by_text.sort_by_key(|x| x.to_string());
        assert_eq!(by_struct, by_text);
        // And pairwise, on a neighbourhood where every field varies.
        let sample = [
            h(W, 9, "a"),
            h(W, 10, "a"),
            h(W, 10, "b"),
            h(W + 1, 0, "a"),
            h(W, 99_999, "a"),
        ];
        for a in &sample {
            for b in &sample {
                assert_eq!(a.cmp(b), a.to_string().cmp(&b.to_string()), "{a} vs {b}");
            }
        }
    }

    #[test]
    fn parse_rejects_malformed_strings() {
        for bad in [
            "",
            "-",
            "--",
            "1790911800000",
            "1790911800000-00007",
            "1790911800000-00007-",
            "179091180000-00007-n1",
            "17909118000000-00007-n1",
            "1790911800000-0007-n1",
            "1790911800000-000007-n1",
            "1790911800000_00007_n1",
            "-790911800000-00007-n1",
            "+790911800000-00007-n1",
            "1790911800000-+0007-n1",
            "179091180000a-00007-n1",
            "1790911800000-0000a-n1",
            " 1790911800000-00007-n1",
            "1790911800000-00007-n 1",
            "1790911800000-00007-n1\n",
            "1790911800000-00007-nó",
            "１７９０９１１８００００００-00007-n1",
        ] {
            assert!(Hlc::parse(bad).is_err(), "{bad:?} should not parse");
        }
        assert_eq!(
            Hlc::parse("1790911800000-00007-").map_err(|e| e.kind()),
            Err("invalid_node_id")
        );
        assert_eq!(
            Hlc::parse("1790911800000-0007-n1").map_err(|e| e.kind()),
            Err("invalid_format")
        );
        assert_eq!(
            Hlc::parse("1790911800000-00007-n 1").map_err(|e| e.kind()),
            Err("invalid_node_id")
        );
    }

    #[test]
    fn validate_checks_the_canonical_range() {
        assert_eq!(h(0, 0, "a").validate(), Ok(()));
        assert_eq!(h(MAX_WALL_MS, MAX_COUNTER, "a~!").validate(), Ok(()));
        assert_eq!(h(-1, 0, "a").validate(), Err(HlcError::WallOutOfRange));
        assert_eq!(
            h(MAX_WALL_MS + 1, 0, "a").validate(),
            Err(HlcError::WallOutOfRange)
        );
        assert_eq!(
            h(i64::MIN, 0, "a").validate(),
            Err(HlcError::WallOutOfRange)
        );
        assert_eq!(
            h(0, MAX_COUNTER + 1, "a").validate(),
            Err(HlcError::CounterOverflow)
        );
        assert_eq!(
            h(0, u32::MAX, "a").validate(),
            Err(HlcError::CounterOverflow)
        );
        assert_eq!(h(0, 0, "").validate(), Err(HlcError::InvalidNodeId));
        assert_eq!(h(0, 0, "a b").validate(), Err(HlcError::InvalidNodeId));
        assert_eq!(h(0, 0, "a\u{e9}").validate(), Err(HlcError::InvalidNodeId));
        assert_eq!(h(0, 0, "a\t").validate(), Err(HlcError::InvalidNodeId));
    }

    #[test]
    fn json_shape_is_camel_case() {
        let hlc = h(W, 7, "phone");
        let v = serde_json::to_value(&hlc).expect("serializes");
        assert_eq!(
            v,
            serde_json::json!({ "wallMs": W, "counter": 7, "nodeId": "phone" })
        );
        let back: Hlc = serde_json::from_value(v).expect("parses");
        assert_eq!(back, hlc);
        let field = f("kg", h(W, 0, "n1"));
        let v = serde_json::to_value(&field).expect("serializes");
        assert_eq!(v["value"], "kg");
        assert_eq!(v["hlc"]["wallMs"], W);
    }

    // --- tick ------------------------------------------------------------------------------

    #[test]
    fn tick_when_physical_time_is_ahead_resets_the_counter() {
        assert_eq!(h(W, 5, "n1").tick(W + 10), Ok(h(W + 10, 0, "n1")));
    }

    #[test]
    fn tick_when_physical_time_is_equal_bumps_the_counter() {
        assert_eq!(h(W, 5, "n1").tick(W), Ok(h(W, 6, "n1")));
    }

    #[test]
    fn tick_when_the_clock_went_backwards_keeps_wall_and_bumps_the_counter() {
        assert_eq!(h(W, 5, "n1").tick(W - 3_000), Ok(h(W, 6, "n1")));
        assert_eq!(h(W, 0, "n1").tick(0), Ok(h(W, 1, "n1")));
        assert_eq!(h(W, 0, "n1").tick(-5), Ok(h(W, 1, "n1")));
    }

    #[test]
    fn tick_from_the_zero_clock() {
        assert_eq!(Hlc::zero("n1").tick(W), Ok(h(W, 0, "n1")));
        assert_eq!(Hlc::zero("n1").tick(0), Ok(h(0, 1, "n1")));
        assert_eq!(Hlc::zero("n1").tick(-5), Ok(h(0, 1, "n1")));
    }

    #[test]
    fn tick_counter_overflow_is_an_error_not_a_wrap() {
        assert_eq!(h(W, 99_998, "n1").tick(W), Ok(h(W, 99_999, "n1")));
        assert_eq!(h(W, 99_999, "n1").tick(W), Err(HlcError::CounterOverflow));
        assert_eq!(
            h(W, 99_999, "n1").tick(W - 1),
            Err(HlcError::CounterOverflow)
        );
        // Once the physical clock moves on there is room again.
        assert_eq!(h(W, 99_999, "n1").tick(W + 1), Ok(h(W + 1, 0, "n1")));
        // A counter already past the limit (hand-built or corrupted) is refused, never wrapped.
        assert_eq!(
            h(W, u32::MAX, "n1").tick(W + 1),
            Err(HlcError::CounterOverflow)
        );
    }

    #[test]
    fn tick_rejects_out_of_range_and_malformed_clocks() {
        assert_eq!(
            Hlc::zero("n1").tick(MAX_WALL_MS + 1),
            Err(HlcError::WallOutOfRange)
        );
        assert_eq!(
            Hlc::zero("n1").tick(i64::MAX),
            Err(HlcError::WallOutOfRange)
        );
        assert_eq!(
            Hlc::zero("n1").tick(MAX_WALL_MS),
            Ok(h(MAX_WALL_MS, 0, "n1"))
        );
        assert_eq!(Hlc::zero("").tick(W), Err(HlcError::InvalidNodeId));
        assert_eq!(h(-3, 0, "n1").tick(W), Err(HlcError::WallOutOfRange));
        assert_eq!(
            h(MAX_WALL_MS, 0, "n1").tick(i64::MIN),
            Ok(h(MAX_WALL_MS, 1, "n1"))
        );
    }

    #[test]
    fn tick_is_strictly_monotonic_over_a_run_of_events() {
        // Physical time stalls, jumps forward, and goes backwards.
        let nows = [
            W,
            W,
            W,
            W + 5,
            W + 5,
            W + 2,
            W - 10_000,
            W + 6,
            W + 6,
            W + 60_000,
            0,
            W + 60_000,
        ];
        let mut clock = Hlc::zero("n1");
        for now in nows {
            let next = clock.tick(now).expect("room in the counter");
            assert!(next > clock, "{next} should pass {clock}");
            assert!(next.wall_ms >= now.max(clock.wall_ms));
            assert_eq!(next.node_id, "n1");
            clock = next;
        }
    }

    // --- receive ---------------------------------------------------------------------------

    fn recv(local: &Hlc, remote: &Hlc, now: i64) -> Result<Hlc, HlcError> {
        local.receive(remote, now, DAY)
    }

    #[test]
    fn receive_when_local_remote_and_now_tie() {
        assert_eq!(recv(&h(W, 3, "n1"), &h(W, 7, "n2"), W), Ok(h(W, 8, "n1")));
        assert_eq!(recv(&h(W, 7, "n1"), &h(W, 3, "n2"), W), Ok(h(W, 8, "n1")));
        assert_eq!(recv(&h(W, 4, "n1"), &h(W, 4, "n2"), W), Ok(h(W, 5, "n1")));
    }

    #[test]
    fn receive_when_local_is_ahead() {
        assert_eq!(
            recv(&h(W + 5, 2, "n1"), &h(W + 1, 9, "n2"), W),
            Ok(h(W + 5, 3, "n1"))
        );
    }

    #[test]
    fn receive_when_remote_is_ahead() {
        assert_eq!(
            recv(&h(W, 2, "n1"), &h(W + 5_000, 9, "n2"), W + 1_000),
            Ok(h(W + 5_000, 10, "n1"))
        );
    }

    #[test]
    fn receive_when_physical_time_is_ahead_of_both() {
        assert_eq!(
            recv(&h(W, 2, "n1"), &h(W + 1, 9, "n2"), W + 100),
            Ok(h(W + 100, 0, "n1"))
        );
    }

    #[test]
    fn receive_when_now_ties_only_one_side() {
        // now == local wall, remote behind: local counter + 1.
        assert_eq!(
            recv(&h(W, 4, "n1"), &h(W - 10, 50, "n2"), W),
            Ok(h(W, 5, "n1"))
        );
        // now == remote wall, local behind: remote counter + 1.
        assert_eq!(
            recv(&h(W - 10, 4, "n1"), &h(W, 50, "n2"), W),
            Ok(h(W, 51, "n1"))
        );
    }

    #[test]
    fn receive_when_the_clock_went_backwards() {
        assert_eq!(
            recv(&h(W, 4, "n1"), &h(W - 1, 0, "n2"), W - 5_000),
            Ok(h(W, 5, "n1"))
        );
        assert_eq!(
            recv(&h(W, 4, "n1"), &h(W, 2, "n2"), W - 5_000),
            Ok(h(W, 5, "n1"))
        );
    }

    #[test]
    fn receive_echo_of_our_own_write_still_advances() {
        let own = h(W, 3, "n1");
        assert_eq!(recv(&own, &own, W), Ok(h(W, 4, "n1")));
    }

    #[test]
    fn receive_drift_limit_is_inclusive() {
        let local = h(W, 0, "n1");
        assert_eq!(
            recv(&local, &h(W + DAY, 0, "n2"), W),
            Ok(h(W + DAY, 1, "n1")),
            "exactly a day"
        );
        assert_eq!(
            recv(&local, &h(W + DAY + 1, 0, "n2"), W),
            Err(HlcError::ClockDrift {
                ahead_ms: DAY + 1,
                max_drift_ms: DAY
            })
        );
        // Drift is measured against now, not against the local clock.
        let ahead_local = h(W + 10 * DAY, 0, "n1");
        assert_eq!(
            recv(&ahead_local, &h(W + DAY + 1, 0, "n2"), W),
            Err(HlcError::ClockDrift {
                ahead_ms: DAY + 1,
                max_drift_ms: DAY
            })
        );
        // A remote in the past is never drift, however far.
        assert_eq!(recv(&local, &h(1, 0, "n2"), W), Ok(h(W, 1, "n1")));
        // The limit is a parameter: zero tolerance, and a negative one that rejects everything.
        assert_eq!(local.receive(&h(W, 0, "n2"), W, 0), Ok(h(W, 1, "n1")));
        assert!(local.receive(&h(W + 1, 0, "n2"), W, 0).is_err());
        assert!(local.receive(&h(W, 0, "n2"), W, -1).is_err());
        // Extreme inputs saturate instead of overflowing.
        assert!(local
            .receive(&h(MAX_WALL_MS, 0, "n2"), i64::MIN, DAY)
            .is_err());
    }

    #[test]
    fn receive_counter_overflow_is_an_error() {
        assert_eq!(
            recv(&h(W, 99_999, "n1"), &h(W, 0, "n2"), W),
            Err(HlcError::CounterOverflow)
        );
        assert_eq!(
            recv(&h(W, 0, "n1"), &h(W, 99_999, "n2"), W),
            Err(HlcError::CounterOverflow)
        );
        assert_eq!(
            recv(&h(W, 99_999, "n1"), &h(W - 1, 0, "n2"), W),
            Err(HlcError::CounterOverflow)
        );
        assert_eq!(
            recv(&h(W - 1, 0, "n1"), &h(W, 99_999, "n2"), W),
            Err(HlcError::CounterOverflow)
        );
        assert_eq!(
            recv(&h(W, 99_998, "n1"), &h(W, 0, "n2"), W),
            Ok(h(W, 99_999, "n1"))
        );
        // A bigger wall time starts the counter over, so a full counter on the loser is harmless.
        assert_eq!(
            recv(&h(W - 1, 99_999, "n1"), &h(W - 2, 99_999, "n2"), W),
            Ok(h(W, 0, "n1"))
        );
    }

    #[test]
    fn receive_rejects_malformed_clocks() {
        assert_eq!(
            recv(&h(W, 0, "n1"), &h(-1, 0, "n2"), W),
            Err(HlcError::WallOutOfRange)
        );
        assert_eq!(
            recv(&h(W, 0, "n1"), &h(W, 0, ""), W),
            Err(HlcError::InvalidNodeId)
        );
        assert_eq!(
            recv(&h(W, 0, ""), &h(W, 0, "n2"), W),
            Err(HlcError::InvalidNodeId)
        );
        assert_eq!(
            recv(&h(W, 0, "n1"), &h(W, 0, "n2"), MAX_WALL_MS + 1),
            Err(HlcError::WallOutOfRange)
        );
    }

    /// A small closed domain: every clock from two wall times, two counters, two nodes.
    fn domain() -> Vec<Hlc> {
        let mut all = Vec::new();
        for wall in [W, W + 1] {
            for counter in [0, 1] {
                for node in ["n1", "n2"] {
                    all.push(h(wall, counter, node));
                }
            }
        }
        all
    }

    #[test]
    fn receive_result_beats_both_inputs_over_the_whole_domain() {
        // Includes a physical clock behind both sides; every remote stays inside the drift limit.
        let nows = [W - 5_000, W - 1, W, W + 1, W + 2, W + 1_000];
        let mut checked = 0;
        for local in domain() {
            for remote in domain() {
                for now in nows {
                    let out = local
                        .receive(&remote, now, DAY)
                        .expect("small counters never overflow");
                    assert!(out > local, "{out} vs local {local}");
                    assert!(out > remote, "{out} vs remote {remote}");
                    assert_eq!(out.node_id, local.node_id);
                    assert_eq!(out.wall_ms, local.wall_ms.max(remote.wall_ms).max(now));
                    checked += 1;
                }
            }
        }
        assert_eq!(checked, 8 * 8 * nows.len());
    }

    #[test]
    fn tick_result_beats_the_input_over_the_whole_domain() {
        for local in domain() {
            for now in [-1, 0, W - 1, W, W + 1, W + 2] {
                let out = local.tick(now).expect("small counters never overflow");
                assert!(out > local, "{out} vs {local}");
                assert_eq!(out.wall_ms, local.wall_ms.max(now));
            }
        }
    }

    #[test]
    fn two_devices_exchanging_writes_never_issue_the_same_clock() {
        let mut phone = Hlc::zero("phone");
        let mut web = Hlc::zero("web");
        let (mut phone_log, mut web_log) = (vec![phone.clone()], vec![web.clone()]);
        let mut now = W;
        for step in 0..40 {
            // The web clock is 3 s behind, and time advances only every third step.
            if step % 3 == 0 {
                now += 1;
            }
            phone = phone.tick(now).expect("room");
            phone_log.push(phone.clone());
            let sent = phone.clone();
            web = web.receive(&sent, now - 3_000, DAY).expect("room");
            assert!(web > sent, "a receive is causally after the send");
            web = web.tick(now - 3_000).expect("room");
            web_log.push(web.clone());
            let reply = web.clone();
            phone = phone.receive(&reply, now, DAY).expect("room");
            assert!(phone > reply);
            phone_log.push(phone.clone());
        }
        for log in [&phone_log, &web_log] {
            assert!(
                log.windows(2).all(|w| w[0] < w[1]),
                "each node's clock only moves forward"
            );
        }
        let mut all: Vec<Hlc> = phone_log.into_iter().chain(web_log).collect();
        let issued = all.len();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), issued, "no clock is issued twice across devices");
    }

    // --- merge -----------------------------------------------------------------------------

    #[test]
    fn higher_clock_wins() {
        let a = f("a", h(W, 1, "n1"));
        let b = f("b", h(W, 2, "n1"));
        assert_eq!(merge_field(&a, &b), b);
        assert_eq!(merge_field(&b, &a), b);
        let c = f("c", h(W, 2, "n2"));
        assert_eq!(merge_field(&b, &c), c, "node id breaks the last tie");
        assert_eq!(merge_field(&c, &b), c);
        let d = f("d", h(W + 1, 0, "n1"));
        assert_eq!(merge_field(&c, &d), d, "wall time beats counter");
    }

    #[test]
    fn equal_clocks_keep_local() {
        let a = f("a", h(W, 1, "n1"));
        let same_clock_other_value = f("b", h(W, 1, "n1"));
        assert_eq!(merge_field(&a, &same_clock_other_value), a);
        assert_eq!(
            merge_field(&same_clock_other_value, &a),
            same_clock_other_value
        );
        assert_eq!(merge_field(&a, &a), a);
    }

    /// Triples with distinct clocks, so equal-clock ties never come up. Includes every ordering
    /// shape: wall, counter and node each deciding the winner.
    fn triples() -> Vec<[Field<&'static str>; 3]> {
        vec![
            [
                f("x", h(W, 0, "n1")),
                f("y", h(W + 1, 0, "n1")),
                f("z", h(W + 2, 0, "n1")),
            ],
            [
                f("x", h(W, 5, "n1")),
                f("y", h(W, 6, "n1")),
                f("z", h(W, 7, "n1")),
            ],
            [
                f("x", h(W, 5, "n1")),
                f("y", h(W, 5, "n2")),
                f("z", h(W, 5, "n3")),
            ],
            [
                f("x", h(W + 9, 0, "n1")),
                f("y", h(W, 99_999, "n9")),
                f("z", h(W + 9, 1, "a")),
            ],
            // x twice is one write seen by two replicas.
            [
                f("x", h(W, 1, "n1")),
                f("x", h(W, 1, "n1")),
                f("z", h(W - 1, 4, "n2")),
            ],
            [
                f("x", h(0, 0, "n1")),
                f("y", h(MAX_WALL_MS, MAX_COUNTER, "n1")),
                f("z", h(W, 0, "n2")),
            ],
            [
                f("old", h(W, 3, "phone")),
                f("new", h(W + 500, 0, "web")),
                f("mid", h(W + 250, 8, "phone")),
            ],
        ]
    }

    fn permutations(t: &[Field<&'static str>; 3]) -> Vec<[Field<&'static str>; 3]> {
        let [a, b, c] = t.clone();
        vec![
            [a.clone(), b.clone(), c.clone()],
            [a.clone(), c.clone(), b.clone()],
            [b.clone(), a.clone(), c.clone()],
            [b.clone(), c.clone(), a.clone()],
            [c.clone(), a.clone(), b.clone()],
            [c, b, a],
        ]
    }

    #[test]
    fn merge_is_commutative_associative_and_idempotent_on_fixed_triples() {
        for t in triples() {
            let top = t
                .iter()
                .max_by(|p, q| p.hlc.cmp(&q.hlc))
                .expect("three fields")
                .clone();
            for [a, b, c] in permutations(&t) {
                assert_eq!(merge_field(&a, &b), merge_field(&b, &a), "commutative");
                let left = merge_field(&merge_field(&a, &b), &c);
                let right = merge_field(&a, &merge_field(&b, &c));
                assert_eq!(left, right, "associative");
                assert_eq!(left, top, "every merge order lands on the highest clock");
                assert_eq!(merge_field(&a, &a), a, "idempotent");
                assert_eq!(
                    merge_field(&merge_field(&a, &b), &b),
                    merge_field(&a, &b),
                    "re-merge is a no-op"
                );
            }
        }
    }

    #[test]
    fn merge_laws_hold_over_the_whole_domain() {
        // The value is a function of the clock, as it is for real writes.
        let all: Vec<Field<String>> = domain().into_iter().map(|c| f(c.to_string(), c)).collect();
        for a in &all {
            assert_eq!(&merge_field(a, a), a);
            for b in &all {
                assert_eq!(merge_field(a, b), merge_field(b, a));
                for c in &all {
                    assert_eq!(
                        merge_field(&merge_field(a, b), c),
                        merge_field(a, &merge_field(b, c))
                    );
                }
            }
        }
    }

    #[test]
    fn merge_works_for_structured_values() {
        let a = f(serde_json::json!({ "unit": "lb" }), h(W, 0, "n1"));
        let b = f(serde_json::json!({ "unit": "kg" }), h(W, 1, "n1"));
        assert_eq!(merge_field(&a, &b), b);
        let n = f(serde_json::Value::Null, h(W + 1, 0, "n1"));
        assert_eq!(
            merge_field(&b, &n).value,
            serde_json::Value::Null,
            "a later null clears the field"
        );
    }

    // --- tombstones ------------------------------------------------------------------------

    #[test]
    fn a_later_delete_wins_and_a_later_restore_wins() {
        let live = f(false, h(W, 0, "n1"));
        let dead = f(true, h(W, 1, "n2"));
        assert_eq!(merge_tombstone(&live, &dead), dead);
        assert_eq!(merge_tombstone(&dead, &live), dead);
        let restored = f(false, h(W + 5, 0, "n1"));
        assert_eq!(
            merge_tombstone(&dead, &restored),
            restored,
            "restore after delete"
        );
        assert_eq!(merge_tombstone(&restored, &dead), restored);
        let stale_delete = f(true, h(W - 5, 0, "n2"));
        assert_eq!(
            merge_tombstone(&restored, &stale_delete),
            restored,
            "stale delete loses"
        );
    }

    #[test]
    fn equal_clocks_resolve_a_tombstone_to_deleted_in_either_order() {
        let live = f(false, h(W, 1, "n1"));
        let dead = f(true, h(W, 1, "n1"));
        assert_eq!(merge_tombstone(&live, &dead), dead);
        assert_eq!(merge_tombstone(&dead, &live), dead);
        assert_eq!(merge_tombstone(&live, &live), live);
        assert_eq!(merge_tombstone(&dead, &dead), dead);
    }

    #[test]
    fn tombstone_merge_laws_hold_over_the_whole_domain() {
        // Both values under every clock, including the equal-clock pairs.
        let mut all = Vec::new();
        for c in domain() {
            all.push(f(false, c.clone()));
            all.push(f(true, c));
        }
        for a in &all {
            assert_eq!(&merge_tombstone(a, a), a);
            for b in &all {
                assert_eq!(merge_tombstone(a, b), merge_tombstone(b, a), "{a:?} {b:?}");
                for c in &all {
                    assert_eq!(
                        merge_tombstone(&merge_tombstone(a, b), c),
                        merge_tombstone(a, &merge_tombstone(b, c))
                    );
                }
            }
        }
    }

    // --- errors ----------------------------------------------------------------------------

    #[test]
    fn error_kinds_are_stable_names() {
        assert_eq!(HlcError::InvalidFormat("x").kind(), "invalid_format");
        assert_eq!(HlcError::InvalidNodeId.kind(), "invalid_node_id");
        assert_eq!(HlcError::WallOutOfRange.kind(), "wall_out_of_range");
        assert_eq!(HlcError::CounterOverflow.kind(), "counter_overflow");
        assert_eq!(
            HlcError::ClockDrift {
                ahead_ms: 1,
                max_drift_ms: 0
            }
            .kind(),
            "clock_drift"
        );
        for e in [
            HlcError::InvalidFormat("why"),
            HlcError::InvalidNodeId,
            HlcError::WallOutOfRange,
            HlcError::CounterOverflow,
            HlcError::ClockDrift {
                ahead_ms: 5,
                max_drift_ms: 1,
            },
        ] {
            assert!(!e.to_string().is_empty());
        }
    }
}
