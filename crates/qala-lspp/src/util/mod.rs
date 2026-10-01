//! Ports of `utils/*.ts`. `memoize.ts` is not ported: it is a perf cache for
//! pure functions and has no observable behavior.

pub mod collection;
pub mod generator;
pub mod math;
pub mod object;
pub mod set_utils;
pub mod string;
