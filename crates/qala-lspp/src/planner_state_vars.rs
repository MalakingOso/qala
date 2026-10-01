//! Port of `pages/planner/models/plannerStateVars.ts`.

use crate::js::{js_parse_float, js_trim};
use crate::types::{IProgramState, IProgramStateMetadata, IProgramStateMetadataValue, ScriptValue};
use crate::util::math::round_float;
use crate::weight;

/// `PlannerStateVars_fromArgs`.
///
/// `on_error(message, value)` is called for each malformed argument. When it
/// returns `Err` the whole call stops with that error (the TS callback
/// throws). When it returns `Ok` the loop carries on, so a collecting
/// callback sees one call per failure.
///
/// The TS `onError` parameter is optional. All callers pass one, so it is
/// required here; the optional form would let a TypeError escape.
pub fn from_args<E>(
    fn_args: &[String],
    on_error: &mut dyn FnMut(&str, &str) -> Result<(), E>,
) -> Result<(IProgramState, IProgramStateMetadata), E> {
    let mut state = IProgramState::new();
    let mut state_metadata = IProgramStateMetadata::new();
    for value in fn_args {
        let mut parts = value.split(':').map(|v| js_trim(v).to_string());
        let mut fn_arg_key = parts.next().unwrap_or_default();
        let fn_arg_val_str = parts.next();
        let val_is_empty = fn_arg_val_str.as_deref().is_none_or(str::is_empty);
        if fn_arg_key.is_empty() || val_is_empty {
            on_error(&format!("Invalid argument {}", value), value)?;
        }
        if fn_arg_key.ends_with('+') {
            fn_arg_key = fn_arg_key.replacen('+', "", 1);
            state_metadata.insert(
                fn_arg_key.clone(),
                IProgramStateMetadataValue {
                    user_prompted: Some(true),
                },
            );
        } else {
            state_metadata.insert(
                fn_arg_key.clone(),
                IProgramStateMetadataValue {
                    user_prompted: Some(false),
                },
            );
        }
        // A missing value makes the TS call `.match` on undefined, which throws
        // inside the try block and lands in the catch.
        let Some(val_str) = fn_arg_val_str else {
            on_error(&format!("Invalid argument {}", value), value)?;
            continue;
        };
        let val = if val_str.contains("lb") || val_str.contains("kg") {
            match weight::parse(&val_str) {
                Some(w) => ScriptValue::Weight(w),
                None => ScriptValue::Number(0.0),
            }
        } else if val_str.contains('%') {
            ScriptValue::Percentage(weight::build_pct(js_parse_float(&val_str)))
        } else {
            ScriptValue::Number(round_float(js_parse_float(&val_str), 2))
        };
        state.insert(fn_arg_key, val);
    }
    Ok((state, state_metadata))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::IUnit;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_values_and_metadata() {
        let mut never = |_: &str, _: &str| -> Result<(), String> { Err("unexpected".to_string()) };
        let (state, meta) = from_args(
            &args(&["increase: 5lb", "pct: 10%", "n+: 3.456", "w: abc"]),
            &mut never,
        )
        .unwrap_or_default();
        assert_eq!(
            state.get("increase"),
            Some(&ScriptValue::Weight(crate::types::IWeight {
                value: 5.0,
                unit: IUnit::Lb
            }))
        );
        assert_eq!(state.get("pct").map(|v| v.value()), Some(10.0));
        assert_eq!(state.get("n"), Some(&ScriptValue::Number(3.46)));
        assert!(state.get("w").is_some_and(|v| v.value() == 0.0));
        assert_eq!(meta.get("n").and_then(|m| m.user_prompted), Some(true));
        assert_eq!(
            meta.get("increase").and_then(|m| m.user_prompted),
            Some(false)
        );
    }

    #[test]
    fn missing_value_reports_twice_when_not_throwing() {
        let mut calls = Vec::new();
        let mut collect = |m: &str, v: &str| -> Result<(), ()> {
            calls.push((m.to_string(), v.to_string()));
            Ok(())
        };
        let _ = from_args(&args(&["bad"]), &mut collect);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, "Invalid argument bad");
    }

    #[test]
    fn throwing_callback_stops() {
        let mut stop = |m: &str, _: &str| -> Result<(), String> { Err(m.to_string()) };
        assert_eq!(
            from_args(&args(&["x:", "y: 1"]), &mut stop).err(),
            Some("Invalid argument x:".to_string())
        );
    }
}
