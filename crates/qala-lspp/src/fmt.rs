//! Canonical text form for LS++ planner programs (DECISIONS S21).
//!
//! `format_planner` is a whitespace normalizer driven by the parse tree. It never rewrites
//! tokens, so it cannot change what a program means:
//!
//! - `{~ ... ~}` script bodies, `//` comments, exercise names, set labels and week and day
//!   headers are copied verbatim (apart from trailing whitespace at the end of a line).
//! - Elsewhere, runs of spaces and tabs become one space, `/` separators get one space on
//!   each side, set and argument lists use `, `, trailing whitespace goes, statements start
//!   at column 0, continuation lines are indented two spaces, whitespace-only lines become
//!   empty and the text ends with a newline. Blank lines are never added, removed or merged:
//!   the evaluator reads them (they end a description paragraph and show up as empty lines).
//! - Text with a syntax error is refused (the diagnostics come back), because formatting
//!   needs a trustworthy tree.
//! - After formatting, the result is parsed again and its tree shape and leaf values must
//!   match the input's. If they do not, the call fails with `FormatError::Unsafe` instead of
//!   returning text that might mean something else.
//!
//! Idempotent by construction and by test: `format(format(x)) == format(x)`.

use crate::diagnostics::{planner_diagnostics, Diagnostic};
use crate::planner_parse::{self, Node, NodeKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatError {
    /// The input does not parse; nothing was changed.
    Syntax(Vec<Diagnostic>),
    /// The formatted text parsed differently from the input. This is a bug in `fmt`; the
    /// input is left alone.
    Unsafe(String),
}

impl std::fmt::Display for FormatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FormatError::Syntax(d) => write!(f, "cannot format text with {} syntax error(s)", d.len()),
            FormatError::Unsafe(m) => write!(f, "formatting would change the program: {m}"),
        }
    }
}

impl std::error::Error for FormatError {}

const SP: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const NL: u16 = b'\n' as u16;
const CR: u16 = b'\r' as u16;
const COMMA: u16 = b',' as u16;
const BACKSLASH: u16 = b'\\' as u16;

fn is_ws(u: u16) -> bool {
    u == SP || u == TAB
}

struct Plan {
    /// Sorted, non-overlapping ranges copied verbatim. The flag says whether whitespace at
    /// the end of the range may be dropped when the range ends its line (everything except
    /// script bodies, whose text is kept exactly).
    protected: Vec<(usize, usize, bool)>,
    /// Offsets where a statement (exercise, comment, header) starts.
    stmt_starts: std::collections::HashSet<usize>,
    /// Gaps replaced by ", ".
    comma_gaps: std::collections::HashMap<usize, usize>,
    /// `/` separator ranges.
    separators: Vec<(usize, usize)>,
}

fn plan_walk(n: &Node, units: &[u16], plan: &mut Plan) {
    match n.kind {
        NodeKind::Liftoscript
        | NodeKind::LineComment
        | NodeKind::TripleLineComment
        | NodeKind::ExerciseName
        | NodeKind::SetLabel
        | NodeKind::Week
        | NodeKind::Day => {
            if matches!(n.kind, NodeKind::LineComment | NodeKind::TripleLineComment | NodeKind::Week | NodeKind::Day) {
                plan.stmt_starts.insert(n.from);
            }
            plan.protected.push((n.from, n.to, n.kind != NodeKind::Liftoscript));
            return;
        }
        NodeKind::ExerciseExpression => {
            plan.stmt_starts.insert(n.from);
        }
        NodeKind::SectionSeparator => {
            plan.separators.push((n.from, n.to));
            return;
        }
        NodeKind::ExerciseSets | NodeKind::WarmupExerciseSets | NodeKind::FunctionExpression => {
            let kids: Vec<&Node> = if n.kind == NodeKind::FunctionExpression {
                n.children.iter().filter(|c| c.kind == NodeKind::FunctionArgument).collect()
            } else {
                n.children.iter().collect()
            };
            for w in kids.windows(2) {
                let (a, b) = (w[0], w[1]);
                if a.to <= b.from && b.from <= units.len() {
                    let gap = &units[a.to..b.from];
                    let non_ws: Vec<u16> = gap.iter().copied().filter(|&u| !is_ws(u)).collect();
                    if non_ws == [COMMA] {
                        plan.comma_gaps.insert(a.to, b.from);
                    }
                }
            }
        }
        _ => {}
    }
    for c in &n.children {
        plan_walk(c, units, plan);
    }
}

fn in_protected(ranges: &[(usize, usize, bool)], i: usize) -> Option<(usize, usize, bool)> {
    // ranges are few per line but many per file; binary search on `from`.
    let idx = ranges.partition_point(|r| r.0 <= i);
    if idx == 0 {
        return None;
    }
    let r = ranges[idx - 1];
    if i < r.1 {
        Some(r)
    } else {
        None
    }
}

/// Rewrites `text` into canonical form. See the module docs for the rules.
pub fn format_planner(text: &str) -> Result<String, FormatError> {
    let root = planner_parse::parse(text);
    if root.has_error() {
        return Err(FormatError::Syntax(planner_diagnostics(text)));
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut plan = Plan {
        protected: vec![],
        stmt_starts: Default::default(),
        comma_gaps: Default::default(),
        separators: vec![],
    };
    plan_walk(&root, &units, &mut plan);
    plan.protected.sort();
    plan.separators.sort();
    let sep_from: std::collections::HashSet<usize> = plan.separators.iter().map(|s| s.0).collect();
    let sep_to: std::collections::HashSet<usize> = plan.separators.iter().map(|s| s.1).collect();

    let n = units.len();
    let mut out: Vec<u16> = Vec::with_capacity(n);
    let mut i = 0;
    while i < n {
        // verbatim ranges
        if let Some((_, to, trim)) = in_protected(&plan.protected, i) {
            let to = to.min(n);
            let mut keep = to;
            // Header and comment nodes swallow the newline that ends their line.
            let had_nl = keep > i && units[keep - 1] == NL;
            let ends_line = had_nl || to >= n || units[to] == NL || units[to] == CR;
            if trim && ends_line {
                if had_nl {
                    keep -= 1;
                }
                while keep > i && (is_ws(units[keep - 1]) || units[keep - 1] == CR) {
                    keep -= 1;
                }
            }
            out.extend_from_slice(&units[i..keep]);
            if trim && had_nl {
                out.push(NL);
            }
            i = to;
            continue;
        }
        if let Some(&to) = plan.comma_gaps.get(&i) {
            out.extend_from_slice(&[COMMA, SP]);
            i = to;
            continue;
        }
        let u = units[i];
        if sep_from.contains(&i) {
            if let Some(&last) = out.last() {
                if last != SP && last != NL {
                    out.push(SP);
                }
            }
        }
        if u == CR && units.get(i + 1) == Some(&NL) {
            i += 1;
            continue;
        }
        if u == NL {
            out.push(NL);
            i += 1;
            continue;
        }
        if is_ws(u) {
            let mut j = i;
            while j < n && is_ws(units[j]) {
                j += 1;
            }
            let at_line_start = out.is_empty() || out.last() == Some(&NL);
            let at_line_end = j >= n || units[j] == NL || (units[j] == CR && units.get(j + 1) == Some(&NL));
            if at_line_end {
                // trailing whitespace or a whitespace-only line
            } else if at_line_start {
                if !plan.stmt_starts.contains(&j) {
                    out.extend_from_slice(&[SP, SP]);
                }
            } else {
                out.push(SP);
            }
            i = j;
            continue;
        }
        out.push(u);
        i += 1;
        if sep_to.contains(&i) {
            if let Some(&next) = units.get(i) {
                if !is_ws(next) && next != NL && next != CR && next != BACKSLASH {
                    out.push(SP);
                }
            }
        }
    }
    if !out.is_empty() && out.last() != Some(&NL) {
        out.push(NL);
    }
    let formatted = String::from_utf16(&out).map_err(|e| FormatError::Unsafe(format!("invalid utf-16: {e}")))?;

    // Safety net: the formatted text must parse to the same tree.
    let after = planner_parse::parse(&formatted);
    if after.has_error() {
        return Err(FormatError::Unsafe("formatted text has a syntax error".into()));
    }
    let (a, b) = (signature(&root, text), signature(&after, &formatted));
    if a != b {
        let at = a.iter().zip(b.iter()).position(|(x, y)| x != y).unwrap_or(a.len().min(b.len()));
        return Err(FormatError::Unsafe(format!(
            "tree differs at node {at} (before {:?}, after {:?})",
            a.get(at),
            b.get(at)
        )));
    }
    Ok(formatted)
}

/// Node kinds in document order, with the trimmed text of every leaf.
fn signature(root: &Node, text: &str) -> Vec<(&'static str, String)> {
    fn go(n: &Node, text: &str, out: &mut Vec<(&'static str, String)>) {
        let value = if n.children.is_empty() { n.value(text).trim().to_string() } else { String::new() };
        out.push((n.name(), value));
        for c in &n.children {
            go(c, text, out);
        }
    }
    let mut out = Vec::new();
    go(root, text, &mut out);
    out
}

#[cfg(test)]
mod tests;
