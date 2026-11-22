//! Port of `models/stats.ts`.

use crate::js::js_trunc_len;
use crate::types::{ISettings, IStats, IWeight};
use crate::util::collection::sort_by;
use crate::weight::{add, build, divide};


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


