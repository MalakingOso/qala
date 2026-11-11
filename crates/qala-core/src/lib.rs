//! Pure Qala logic (docs/archive/completed.md, M1 as built). No I/O, no clock, no threads.
//! Every JSON entry point lives in `api`; the other modules are plain Rust.

pub mod adapter;
pub mod api;
pub mod availability;
pub mod derived;
pub mod derived_api;
pub mod engine;
pub mod hlc;
pub mod js;
pub mod muscles;
pub mod plates;
pub mod records;
pub mod run;
pub mod time;
