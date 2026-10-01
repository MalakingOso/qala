//! Parser diagnostics for LS++ (DECISIONS S21): every syntax error gets a UTF-16 range, a
//! 1-based line and column, a one-line message and a fix suggestion.
//!
//! This is a read-only layer over the parse trees. It does not touch parser recovery, so the
//! trees (and the goldens built on them) are unchanged. `from`, `to` and `message` keep the
//! shape the desktop editor already consumes; `line`, `col`, `end_line`, `end_col` and
//! `suggestion` are additive.
//!
//! Positions: `from`/`to` are UTF-16 offsets into the text. `line` and `col` are 1-based
//! (`col` counts UTF-16 units from the start of the line), which is what an editor or a
//! model repair prompt wants. The evaluator's own errors keep their 1-based line and
//! 0-based offset convention; that is a different field set and is not changed here.

use serde::Serialize;

use crate::{planner_parse, script_parse};

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub from: usize,
    pub to: usize,
    pub message: String,
    pub line: usize,
    pub col: usize,
    pub end_line: usize,
    pub end_col: usize,
    /// One line telling the author how to fix it, `None` when nothing useful can be said.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// 1-based `(line, col)` of a UTF-16 offset. An offset past the end maps to the end.
pub fn line_col(units: &[u16], pos: usize) -> (usize, usize) {
    let pos = pos.min(units.len());
    let mut line = 1;
    let mut start = 0;
    for (i, &u) in units[..pos].iter().enumerate() {
        if u == 10 {
            line += 1;
            start = i + 1;
        }
    }
    (line, pos - start + 1)
}

/// Widens a zero-width error to one character so an editor can underline it, and
/// keeps the range inside the document.
fn visible_range(from: usize, to: usize, len: usize) -> (usize, usize) {
    let (mut from, mut to) = (from.min(len), to.min(len));
    if from >= to {
        if to < len {
            to += 1;
        } else {
            from = to.saturating_sub(1);
        }
    }
    (from, to)
}

fn make(units: &[u16], from: usize, to: usize, message: String, suggestion: Option<String>) -> Diagnostic {
    let (line, col) = line_col(units, from);
    let (end_line, end_col) = line_col(units, to);
    Diagnostic { from, to, message, line, col, end_line, end_col, suggestion }
}

// ---------------------------------------------------------------------------
// small text helpers (all on UTF-16 units; the characters we look for are ASCII)

fn ch(units: &[u16], i: usize) -> Option<char> {
    units.get(i).and_then(|&u| char::from_u32(u as u32))
}

fn line_start(units: &[u16], pos: usize) -> usize {
    let pos = pos.min(units.len());
    units[..pos].iter().rposition(|&u| u == 10).map(|i| i + 1).unwrap_or(0)
}

fn line_end(units: &[u16], pos: usize) -> usize {
    let pos = pos.min(units.len());
    units[pos..].iter().position(|&u| u == 10).map(|i| pos + i).unwrap_or(units.len())
}

/// The nearest non-space character strictly before `pos` on the same line, with its index.
fn prev_nonspace(units: &[u16], pos: usize) -> Option<(usize, char)> {
    let start = line_start(units, pos);
    let mut i = pos.min(units.len());
    while i > start {
        i -= 1;
        let c = ch(units, i)?;
        if c != ' ' && c != '\t' {
            return Some((i, c));
        }
    }
    None
}

/// The nearest non-space character at or after `pos` on the same line.
fn next_nonspace(units: &[u16], pos: usize) -> Option<(usize, char)> {
    let end = line_end(units, pos);
    let mut i = pos;
    while i < end {
        let c = ch(units, i)?;
        if c != ' ' && c != '\t' && c != '\r' {
            return Some((i, c));
        }
        i += 1;
    }
    None
}

/// The run of ASCII letters, digits and `.` that touches `pos` (before or at it).
fn word_around(units: &[u16], pos: usize) -> String {
    let is_w = |i: usize| ch(units, i).map(|c| c.is_ascii_alphanumeric() || c == '.').unwrap_or(false);
    let mut s = pos.min(units.len());
    while s > 0 && is_w(s - 1) {
        s -= 1;
    }
    let mut e = pos.min(units.len());
    while e < units.len() && is_w(e) {
        e += 1;
    }
    units[s..e].iter().filter_map(|&u| char::from_u32(u as u32)).collect()
}

/// Counts `open` and `close` characters in `units[..upto]`.
fn balance(units: &[u16], upto: usize, open: char, close: char) -> i64 {
    let mut n = 0i64;
    for i in 0..upto.min(units.len()) {
        match ch(units, i) {
            Some(c) if c == open => n += 1,
            Some(c) if c == close => n -= 1,
            _ => {}
        }
    }
    n
}

fn contains_at(units: &[u16], i: usize, pat: &str) -> bool {
    let p: Vec<u16> = pat.encode_utf16().collect();
    units.len() >= i + p.len() && units[i..i + p.len()] == p[..]
}

/// Net count of `{~` openers over `~}` closers in the whole text.
fn script_block_balance(units: &[u16]) -> i64 {
    let mut n = 0;
    let mut i = 0;
    while i < units.len() {
        if contains_at(units, i, "{~") {
            n += 1;
            i += 2;
        } else if contains_at(units, i, "~}") {
            n -= 1;
            i += 2;
        } else {
            i += 1;
        }
    }
    n
}

fn is_unit_suffix_error(word: &str) -> Option<String> {
    // digits (with an optional fraction) followed by letters that are not a weight unit
    let split = word.find(|c: char| c.is_ascii_alphabetic())?;
    let (num, unit) = word.split_at(split);
    if num.is_empty() || !num.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    let u = unit.to_ascii_lowercase();
    if u == "lb" || u == "kg" || u == "x" || u == "s" || u == "rpe" || u == "rm" {
        return None;
    }
    Some(num.to_string())
}

// ---------------------------------------------------------------------------
// planner text

fn planner_suggestion(units: &[u16], from: usize, to: usize, parent: Option<&str>) -> Option<String> {
    let at = from.min(units.len());
    let before = prev_nonspace(units, at);
    let after = next_nonspace(units, at);

    // `3x` with nothing usable after the x
    if let Some((i, 'x')) = before {
        if i > 0 && ch(units, i - 1).map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return Some(match after {
                Some((_, 'x')) => "remove the extra x: write sets as COUNTxREPS, for example 3x5".to_string(),
                _ => "put a rep count after the x, for example 3x5".to_string(),
            });
        }
    }

    // a number glued to an unknown unit, such as 100kgs or 135pounds
    let w = word_around(units, at.max(to.saturating_sub(1)).min(units.len()));
    if let Some(num) = is_unit_suffix_error(&w) {
        return Some(format!("weights end in lb or kg, for example {num}lb or {num}kg"));
    }

    // an unclosed `{~` script
    if script_block_balance(units) > 0 {
        return Some("close the script with ~} on its own line".to_string());
    }

    // unclosed brackets on this line
    let ls = line_start(units, at);
    let upto = line_end(units, at);
    let line_units = &units[ls..upto];
    if balance(line_units, line_units.len(), '(', ')') > 0 {
        return Some("add the missing closing )".to_string());
    }
    if balance(line_units, line_units.len(), '[', ']') > 0 {
        return Some("add the missing closing ]".to_string());
    }
    if balance(line_units, line_units.len(), '{', '}') > 0 {
        return Some("add the missing closing }".to_string());
    }

    // a dangling section separator
    if let Some((i, '/')) = before {
        if after.is_none() && i + 1 >= at.saturating_sub(1) {
            return Some("remove the trailing / or add a section after it, such as a set list like 3x5".to_string());
        }
    }

    match parent {
        Some("FunctionExpression") => Some("write function calls as name(key: value, ...) with matched parentheses".to_string()),
        Some("ExerciseVariations") | Some("ExerciseVariation") => {
            Some("write the exercise name first, then sections separated by ' / '".to_string())
        }
        Some("ExerciseSection") | Some("ExerciseSets") | Some("ExerciseSet") | Some("ExerciseExpression") => {
            Some("separate sections with ' / ', for example: Squat / 3x5 100lb".to_string())
        }
        _ => None,
    }
}

fn describe_planner(parent: Option<&str>, zero_width: bool) -> String {
    let what = match parent {
        Some("ExerciseExpression") | Some("ExerciseSection") | Some("ExerciseProperty") => Some("exercise line"),
        Some("FunctionExpression") => Some("function call"),
        Some("ExerciseVariations") | Some("ExerciseVariation") => Some("exercise variations"),
        _ => None,
    };
    let base = if zero_width { "Syntax error, something is missing here" } else { "Syntax error" };
    match what {
        Some(w) => format!("{base} in {w}"),
        None => base.to_string(),
    }
}

/// Diagnostics for planner text: one per outermost error node.
pub fn planner_diagnostics(text: &str) -> Vec<Diagnostic> {
    fn walk(n: &planner_parse::Node, parent: Option<&str>, units: &[u16], out: &mut Vec<Diagnostic>) {
        if n.is_error() {
            let (from, to) = visible_range(n.from, n.to, units.len());
            let sugg = planner_suggestion(units, n.from, n.to, parent);
            out.push(make(units, from, to, describe_planner(parent, n.from == n.to), sugg));
            return;
        }
        for c in &n.children {
            walk(c, Some(n.name()), units, out);
        }
    }
    let units = utf16(text);
    let root = planner_parse::parse(text);
    let mut out = Vec::new();
    walk(&root, None, &units, &mut out);
    out
}

// ---------------------------------------------------------------------------
// liftoscript source

const OPERATOR_CHARS: &str = "+-*/=<>!&|%?:";

fn script_suggestion(units: &[u16], from: usize, parent: Option<&str>) -> Option<String> {
    let at = from.min(units.len());
    let before = prev_nonspace(units, at);
    let after = next_nonspace(units, at);

    // an operator with nothing on its right
    if let Some((_, c)) = before {
        if OPERATOR_CHARS.contains(c) {
            return Some("the operator needs a value on its right, for example weights += 5lb".to_string());
        }
        if c == '(' || c == ',' {
            return Some("an expression is missing here".to_string());
        }
    }
    let _ = after;

    if balance(units, units.len(), '{', '}') > 0 {
        return Some("add the missing closing }".to_string());
    }
    if balance(units, units.len(), '(', ')') > 0 {
        return Some("add the missing closing )".to_string());
    }
    if balance(units, units.len(), '[', ']') > 0 {
        return Some("add the missing closing ]".to_string());
    }

    match parent {
        Some("IfExpression") => Some("write conditions as if (condition) { ... }".to_string()),
        Some("ForExpression") | Some("ForInExpression") => Some("write loops as for (var.i in completedReps) { ... }".to_string()),
        Some("BuiltinFunctionExpression") => Some("check the function name and its argument list".to_string()),
        Some("AssignmentExpression") | Some("IncAssignmentExpression") => {
            Some("assignments look like weights = 100lb or weights += 5lb".to_string())
        }
        _ => None,
    }
}

fn describe_script(parent: Option<&str>, zero_width: bool) -> String {
    let what = match parent {
        Some("IfExpression") => Some("if expression"),
        Some("ForExpression") | Some("ForInExpression") => Some("for loop"),
        Some("BuiltinFunctionExpression") => Some("function call"),
        Some("BinaryExpression") => Some("expression"),
        Some("Ternary") => Some("ternary"),
        Some("BlockExpression") => Some("block"),
        Some("AssignmentExpression") | Some("IncAssignmentExpression") => Some("assignment"),
        _ => None,
    };
    let base = if zero_width { "Syntax error, something is missing here" } else { "Syntax error" };
    match what {
        Some(w) => format!("{base} in {w}"),
        None => base.to_string(),
    }
}

/// Diagnostics for liftoscript source: one per outermost error node.
pub fn script_diagnostics(text: &str) -> Vec<Diagnostic> {
    fn walk(n: &script_parse::Node, parent: Option<&str>, units: &[u16], out: &mut Vec<Diagnostic>) {
        if n.is_error() {
            let (from, to) = visible_range(n.from, n.to, units.len());
            let sugg = script_suggestion(units, n.from, parent);
            out.push(make(units, from, to, describe_script(parent, n.from == n.to), sugg));
            return;
        }
        let name = format!("{:?}", n.kind);
        for c in &n.children {
            walk(c, Some(&name), units, out);
        }
    }
    let units = utf16(text);
    let root = script_parse::parse(text);
    let mut out = Vec::new();
    walk(&root, None, &units, &mut out);
    out
}

#[cfg(test)]
mod tests;
