//! Liftoscript evaluation path (DECISIONS S12). The TS package `packages/liftoscript`
//! is the oracle; golden vectors live in `testdata/golden/liftoscript/`.
//! No I/O, no clock, no threads. Time and randomness enter as arguments.

pub mod js;
pub mod util;
pub mod types;
pub mod weight;
pub mod equipment;
pub mod set;
pub mod stats;
pub mod exercise;
pub mod script_parse;
pub mod planner_parse;
pub mod pp;
pub mod muscle;
pub mod script_eval;
pub mod script_fns;
pub mod script_runner;
pub mod progress;
pub mod planner_exercise_eval;
pub mod planner_state_vars;
pub mod planner_eval;
pub mod planner_program;
pub mod planner_program_exercise;
pub mod program;
pub mod program_set;
pub mod program_exercise;
pub mod runtime;
pub mod program_to_planner;
pub mod diagnostics;
pub mod fmt;
pub mod lint;
pub mod dry_run;
