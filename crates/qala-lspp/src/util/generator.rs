//! `utils/generator.ts`. The TS `UidFactory_generateUid` calls `Math.random`.
//! The crate never touches a clock or RNG, so callers pass an id source.

/// Source of short lowercase ids. Pass a deterministic one in tests and golden runs.
pub trait UidSource {
    fn generate_uid(&mut self, length: usize) -> String;
}

impl<F: FnMut(usize) -> String> UidSource for F {
    fn generate_uid(&mut self, length: usize) -> String {
        self(length)
    }
}

/// Deterministic ids: a counter written in base 26 with letters a-z, padded to
/// the requested length (the low digits are kept when the counter is wider).
#[derive(Debug, Clone, Default)]
pub struct SequentialUid {
    counter: u64,
}

impl SequentialUid {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn starting_at(counter: u64) -> Self {
        SequentialUid { counter }
    }
}

impl UidSource for SequentialUid {
    fn generate_uid(&mut self, length: usize) -> String {
        let mut n = self.counter;
        self.counter = self.counter.wrapping_add(1);
        let mut out = vec![b'a'; length];
        for slot in out.iter_mut().rev() {
            *slot = b'a' + (n % 26) as u8;
            n /= 26;
        }
        String::from_utf8(out).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequential_is_deterministic() {
        let mut a = SequentialUid::new();
        assert_eq!(a.generate_uid(6), "aaaaaa");
        assert_eq!(a.generate_uid(6), "aaaaab");
        let mut b = SequentialUid::starting_at(26);
        assert_eq!(b.generate_uid(3), "aba");
        assert_eq!(b.generate_uid(0), "");
        let mut c = SequentialUid::starting_at(27);
        assert_eq!(c.generate_uid(1), "b");
    }

    #[test]
    fn closure_source() {
        let mut n = 0;
        let mut f = move |len: usize| {
            n += 1;
            format!("{}{}", "x".repeat(len), n)
        };
        assert_eq!(UidSource::generate_uid(&mut f, 2), "xx1");
        assert_eq!(UidSource::generate_uid(&mut f, 2), "xx2");
    }
}
