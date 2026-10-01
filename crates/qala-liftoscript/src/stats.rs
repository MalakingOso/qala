//! Port of `models/stats.ts`.

use crate::js::js_trunc_len;
use crate::types::{IPercentage, ISettings, IStats, IWeight};
use crate::util::collection::sort_by;
use crate::weight::{add, build, divide};

/// `Stats_name`. `None` for a key outside the stats definitions.
pub fn name(key: &str) -> Option<&'static str> {
    Some(match key {
        "bicepLeft" => "Left Bicep",
        "bicepRight" => "Right Bicep",
        "calfLeft" => "Left Calf",
        "calfRight" => "Right Calf",
        "chest" => "Chest",
        "forearmLeft" => "Left Forearm",
        "forearmRight" => "Right Forearm",
        "hips" => "Hips",
        "neck" => "Neck",
        "shoulders" => "Shoulders",
        "thighLeft" => "Left Thigh",
        "thighRight" => "Right Thigh",
        "waist" => "Waist",
        "weight" => "Bodyweight",
        "bodyfat" => "Bodyfat",
        "sleep" => "Sleep",
        "calories" => "Calories",
        "protein" => "Protein",
        _ => return None,
    })
}

/// `Stats_getCurrentBodyweight`: the most recent bodyweight entry.
pub fn get_current_bodyweight(stats: &IStats) -> Option<IWeight> {
    let all = stats.weight.weight.as_deref().unwrap_or(&[]);
    sort_by(all, |w| w.timestamp as f64, true).first().map(|w| w.value)
}

/// `Stats_getCurrentMovingAverageBodyweight`: average of the latest
/// `movingAverageWindowSize` entries (setting on `graphOptions.weight`), or
/// the latest entry when the window is unset or there are too few entries.
pub fn get_current_moving_average_bodyweight(stats: &IStats, settings: &ISettings) -> Option<IWeight> {
    let window = settings
        .graph_options
        .get("weight")
        .and_then(|g| g.moving_average_window_size)
        .filter(|w| *w != 0.0 && !w.is_nan());
    let window = match window {
        None => return get_current_bodyweight(stats),
        Some(w) => w,
    };
    let all = stats.weight.weight.as_deref().unwrap_or(&[]);
    let weights = sort_by(all, |w| w.timestamp as f64, true);
    if (weights.len() as f64) < window {
        return get_current_bodyweight(stats);
    }
    let take = js_trunc_len(window, weights.len());
    let recent = &weights[..take];
    let total = recent.iter().fold(build(0.0, settings.units), |sum, item| add(sum, item.value));
    Some(divide(total, recent.len() as f64))
}

/// `Stats_getCurrentBodyfat`
pub fn get_current_bodyfat(stats: &IStats) -> Option<IPercentage> {
    let all = stats.percentage.bodyfat.as_deref().unwrap_or(&[]);
    sort_by(all, |w| w.timestamp as f64, true).first().map(|w| w.value)
}

/// `Stats_getEmpty`
pub fn get_empty() -> IStats {
    IStats::default()
}

/// `Stats_isEmpty`: no stat key holds any entries.
pub fn is_empty(stats: &IStats) -> bool {
    stats.weight.weight.as_ref().is_none_or(|v| v.is_empty())
        && stats.percentage.bodyfat.as_ref().is_none_or(|v| v.is_empty())
        && stats.length.values().all(|v| v.is_empty())
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::tests::{arg, check, parse_cases, settings_named};
    use serde_json::Value;

    // Expected values come from the TS oracle (testdata/unit/gen_unit_cases.ts
    // over models/stats.ts, results in cases_stats.json).

    fn j<T: serde::Serialize>(x: T) -> Result<Value, String> {
        serde_json::to_value(x).map_err(|e| e.to_string())
    }

    #[test]
    fn matches_oracle() {
        let cases = parse_cases(include_str!("../testdata/unit/cases_stats.json"));
        let mut errors = Vec::new();
        for c in &cases {
            let a = &c.args;
            let r = match c.f.as_str() {
                "getCurrentBodyweight" => j(get_current_bodyweight(&arg::<IStats>(&a[0]))),
                "getCurrentBodyfat" => j(get_current_bodyfat(&arg::<IStats>(&a[0]))),
                "isEmpty" => j(is_empty(&arg::<IStats>(&a[0]))),
                "getEmpty" => j(get_empty()),
                "name" => j(name(a[0].as_str().unwrap_or(""))),
                "getCurrentMovingAverageBodyweight" => {
                    let mut s = settings_named("lb");
                    s.units = arg(&a[2]);
                    s.graph_options.clear();
                    if let Some(w) = a[1].as_f64() {
                        s.graph_options.insert(
                            "weight".to_string(),
                            crate::types::IGraphOptions { moving_average_window_size: Some(w) },
                        );
                    }
                    j(get_current_moving_average_bodyweight(&arg::<IStats>(&a[0]), &s))
                }
                other => panic!("unhandled {other}"),
            };
            check(c, &Value::Array(c.args.clone()).to_string(), r, false, &mut errors);
        }
        assert!(errors.is_empty(), "{} of {} cases differ, first:\n{}", errors.len(), cases.len(), errors.join("\n"));
    }
}
