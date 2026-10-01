//! Lint warnings for LS++ planner text (DECISIONS S21): things that parse but are probably
//! wrong. Read-only, tree-driven, and silent on text with syntax errors (use
//! `diagnostics` for those).
//!
//! Every rule was run over the 60 built-in programs and the kg variants; a hit there is
//! treated as a false positive and the rule is changed. The one exception is two
//! `unused-state` hits in arnoldgoldensix, which are real (see `tests/lint_builtins.rs`).
//!
//! Rules:
//! - `empty-program`: the text has no exercise at all. Empty days and empty weeks are not
//!   flagged: 19 built-in programs use header-only days as rest days, and 5 have whole weeks
//!   of headers because an exercise like `Bench Press[1-3]` covers several weeks.
//! - `too-many-sets`: one set line asks for more than `MAX_SETS` sets, or an exercise's set
//!   lines add up to more. Scripts cannot create sets past `MAX_SETS`, and the runtime
//!   drops them.
//! - `mixed-units`: set weights written in both `lb` and `kg` in one program. The minority
//!   unit is flagged. Writing every weight in the unit that differs from the settings is
//!   fine (the kg variants of the built-ins do exactly that), so the settings are not
//!   consulted.
//! - `unused-state`: `custom(name: value)` declares a state variable that the exercise's own
//!   scripts never mention as `state.name`, neither read nor assigned (a script may keep
//!   its own memory in state, so assignment counts as use). Lines that reuse a script from
//!   another exercise (`{ ...main }`) are skipped, since the script lives elsewhere.
//!
//! Not warned on, on purpose: a missing weight (`?+` is a first-class "ask me" state, see
//! `partial`) and a state variable that is read but never assigned (that is how a
//! progression parameter normally works).

use serde::Serialize;

use crate::diagnostics::line_col;
use crate::planner_parse::{self, Node, NodeKind};
use crate::script_eval::MAX_SETS;

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Lint {
    /// Stable rule id, for filtering and tests.
    pub code: &'static str,
    pub from: usize,
    pub to: usize,
    pub message: String,
    pub line: usize,
    pub col: usize,
    pub end_line: usize,
    pub end_col: usize,
    pub suggestion: Option<String>,
}

struct Ctx<'a> {
    text: &'a str,
    units: Vec<u16>,
    out: Vec<Lint>,
}

impl Ctx<'_> {
    fn push(&mut self, code: &'static str, from: usize, to: usize, message: String, suggestion: Option<String>) {
        let (line, col) = line_col(&self.units, from);
        let (end_line, end_col) = line_col(&self.units, to);
        self.out.push(Lint { code, from, to, message, line, col, end_line, end_col, suggestion });
    }
}

fn int_value(n: &Node, text: &str) -> Option<f64> {
    n.value(text).trim().parse::<f64>().ok()
}

/// Lints planner text. Text with syntax errors yields no lints.
pub fn lint_planner(text: &str) -> Vec<Lint> {
    let root = planner_parse::parse(text);
    if root.has_error() {
        return vec![];
    }
    let mut cx = Ctx { text, units: text.encode_utf16().collect(), out: vec![] };
    empty_program(&root, &mut cx);
    walk(&root, &mut cx);
    mixed_units(&root, &mut cx);
    cx.out.sort_by_key(|l| (l.from, l.code));
    cx.out
}

fn has_exercise(n: &Node) -> bool {
    n.kind == NodeKind::ExerciseExpression || n.children.iter().any(has_exercise)
}

fn empty_program(root: &Node, cx: &mut Ctx) {
    let has_content = root.children.iter().any(|c| c.kind != NodeKind::EmptyExpression);
    if has_content && !has_exercise(root) {
        let end = cx.units.len();
        cx.push(
            "empty-program",
            0,
            end.min(1),
            "the program has no exercises".to_string(),
            Some("add an exercise line under a day, for example: Squat / 3x5 100lb".to_string()),
        );
    }
}

fn walk(n: &Node, cx: &mut Ctx) {
    if n.kind == NodeKind::ExerciseExpression {
        too_many_sets(n, cx);
        unused_state(n, cx);
    }
    for c in &n.children {
        walk(c, cx);
    }
}

/// Set weights (not progression arguments) of the program, flagged true when in kg.
fn collect_weights<'a>(n: &'a Node, text: &str, in_sets: bool, out: &mut Vec<(&'a Node, bool)>) {
    let in_sets = in_sets || matches!(n.kind, NodeKind::ExerciseSets | NodeKind::WarmupExerciseSets);
    if n.kind == NodeKind::Weight && in_sets {
        let v = n.value(text);
        let v = v.trim();
        if v.ends_with("kg") {
            out.push((n, true));
        } else if v.ends_with("lb") {
            out.push((n, false));
        }
    }
    for c in &n.children {
        collect_weights(c, text, in_sets, out);
    }
}

fn mixed_units(root: &Node, cx: &mut Ctx) {
    let mut ws = vec![];
    collect_weights(root, cx.text, false, &mut ws);
    let kg = ws.iter().filter(|w| w.1).count();
    let lb = ws.len() - kg;
    if kg == 0 || lb == 0 {
        return;
    }
    // Flag the minority unit; on a tie, the unit that appears second in the text.
    let first_is_kg = ws[0].1;
    let flag_kg = if kg == lb { !first_is_kg } else { kg < lb };
    let (minor, major) = if flag_kg { ("kg", "lb") } else { ("lb", "kg") };
    for (n, is_kg) in ws {
        if is_kg == flag_kg {
            let v = n.value(cx.text);
            let v = v.trim();
            let num = v.trim_end_matches("kg").trim_end_matches("lb");
            cx.push(
                "mixed-units",
                n.from,
                n.to,
                format!("weight {v} is in {minor}, but most set weights in this program are in {major}"),
                Some(format!("write it in {major} (for example {num}{major}) so the program uses one unit")),
            );
        }
    }
}

fn too_many_sets(e: &Node, cx: &mut Ctx) {
    for section in e.get_children(NodeKind::ExerciseSection) {
        let Some(sets) = section.get_child(NodeKind::ExerciseSets) else { continue };
        let mut total = 0.0;
        let mut any_single = false;
        for set in sets.get_children(NodeKind::ExerciseSet) {
            let Some(part) = set.get_child(NodeKind::SetPart) else { continue };
            let Some(count) = part.get_child(NodeKind::Rep).and_then(|r| r.get_child(NodeKind::Int)) else { continue };
            let Some(v) = int_value(count, cx.text) else { continue };
            total += v;
            if v > MAX_SETS {
                any_single = true;
                cx.push(
                    "too-many-sets",
                    set.from,
                    set.to,
                    format!("{v} sets is over the limit of {MAX_SETS}"),
                    Some(format!("use at most {MAX_SETS} sets in a line, or split the work across exercises")),
                );
            }
        }
        if !any_single && total > MAX_SETS {
            cx.push(
                "too-many-sets",
                sets.from,
                sets.to,
                format!("these set lines add up to {total} sets, over the limit of {MAX_SETS}"),
                Some(format!("keep the total at {MAX_SETS} sets or fewer")),
            );
        }
    }
}

/// Flags `custom(name: value)` arguments whose `state.name` appears in none of the
/// expression's own scripts.
fn unused_state(e: &Node, cx: &mut Ctx) {
    let mut declared: Vec<(String, usize, usize)> = vec![];
    let mut scripts: Vec<String> = vec![];
    for section in e.get_children(NodeKind::ExerciseSection) {
        let Some(prop) = section.get_child(NodeKind::ExerciseProperty) else { continue };
        let Some(func) = prop.get_child(NodeKind::FunctionExpression) else { continue };
        let Some(script) = func.get_child(NodeKind::Liftoscript) else { continue };
        scripts.push(script.value(cx.text));
        for arg in func.get_children(NodeKind::FunctionArgument) {
            if let Some(kv) = arg.get_child(NodeKind::KeyValue) {
                if let Some(k) = kv.get_child(NodeKind::Keyword) {
                    declared.push((k.value(cx.text).trim().to_string(), k.from, k.to));
                }
            }
        }
    }
    for (key, from, to) in declared {
        if !scripts.iter().any(|s| mentions_state(s, &key)) {
            cx.push(
                "unused-state",
                from,
                to,
                format!("state variable \"{key}\" is declared but this exercise's scripts never mention state.{key}"),
                Some(format!("remove {key} from custom(...), or use state.{key} in a script")),
            );
        }
    }
}

/// Whether `script` contains `state.<key>` as a whole word, as a read or an assignment.
fn mentions_state(script: &str, key: &str) -> bool {
    let pat = format!("state.{key}");
    let mut from = 0;
    while let Some(i) = script[from..].find(&pat) {
        let end = from + i + pat.len();
        let next = script[end..].chars().next();
        let boundary = !matches!(next, Some(c) if c.is_ascii_alphanumeric() || c == '_');
        let prev_ok = script[..from + i]
            .chars()
            .next_back()
            .map(|c| !(c.is_ascii_alphanumeric() || c == '_' || c == '.'))
            .unwrap_or(true);
        if boundary && prev_ok {
            return true;
        }
        from = end;
    }
    false
}

#[cfg(test)]
mod tests;
