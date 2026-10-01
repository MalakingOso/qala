//! fmt acceptance (DECISIONS S21): over the 60 built-in programs (and their kg variants),
//! `fmt` is idempotent and the evaluated program is identical before and after. A second
//! pass runs the same checks on a deliberately mangled copy of each program, so the test
//! exercises real rewriting and not just already-canonical text.
//!
//! "Identical evaluation" compares `force_evaluate_text` output as JSON, each side with a
//! fresh `SequentialUid`, after dropping the fields listed in `STRIPPED`: they hold source
//! text or source positions, which formatting is allowed to move.

mod common;

use common::programs;
use qala_lspp::fmt::format_planner;
use qala_lspp::runtime;
use qala_lspp::types::ISettings;
use qala_lspp::util::generator::SequentialUid;
use serde_json::Value;

/// JSON object keys removed before every comparison. `exerciseText` and `text` hold the raw
/// program text (per day and per exercise), which fmt exists to change. `line`, `offset`,
/// `from` and `to` are source positions, which move when fmt collapses whitespace on a line
/// (the evaluation of gzcl-general-gainz-burrito-but-big differs by one column). Everything
/// else, including names, sets, weights, progress and update scripts, is compared.
const STRIPPED: &[&str] = &["exerciseText", "text", "line", "offset", "from", "to"];

fn strip(v: &mut Value) {
    match v {
        Value::Object(m) => {
            for k in STRIPPED {
                m.remove(*k);
            }
            for (_, x) in m.iter_mut() {
                strip(x);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(strip),
        _ => {}
    }
}

/// First path where two JSON values differ, for readable failures.
fn first_diff(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    None => return Some(format!("{path}.{k} missing after")),
                    Some(w) => {
                        if let Some(d) = first_diff(v, w, &format!("{path}.{k}")) {
                            return Some(d);
                        }
                    }
                }
            }
            y.keys().find(|k| !x.contains_key(*k)).map(|k| format!("{path}.{k} only after"))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path} length {} vs {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (v, w))| first_diff(v, w, &format!("{path}[{i}]")))
        }
        _ if a == b => None,
        _ => Some(format!("{path}: {} vs {}", a.to_string().chars().take(200).collect::<String>(), b.to_string().chars().take(200).collect::<String>())),
    }
}

fn assert_same(file: &str, what: &str, got: &Value, want: &Value) {
    if let Some(d) = first_diff(want, got, "$") {
        panic!("{file}: {what}: {d}");
    }
}

fn eval_json(text: &str, name: &str, settings: &ISettings) -> Value {
    let mut uid = SequentialUid::new();
    let p = runtime::force_evaluate_text(text, name, settings, &mut uid);
    let mut v = serde_json::to_value(&p).unwrap();
    strip(&mut v);
    v
}

/// Turns ", " into " ," after a number, `+`, `%` or a unit. A comma after letters can be part of
/// an exercise name ("Incline Bench Press, Dumbbell"), where spacing is meaningful.
fn loosen_commas(line: &str) -> String {
    let cs: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < cs.len() {
        let after_value = i > 0 && (cs[i - 1].is_ascii_digit() || "+%".contains(cs[i - 1]) || line[..line.char_indices().nth(i).map(|x| x.0).unwrap()].ends_with("lb") || line[..line.char_indices().nth(i).map(|x| x.0).unwrap()].ends_with("kg"));
        if cs[i] == ',' && cs.get(i + 1) == Some(&' ') && after_value {
            out.push_str(" ,");
            i += 2;
        } else {
            out.push(cs[i]);
            i += 1;
        }
    }
    out
}

/// Makes a program uglier without changing its meaning: odd spacing around separators and
/// commas, trailing whitespace and CRLF on plain exercise lines. Blank lines are meaningful to
/// the evaluator, so the mangler keeps their count. Script
/// bodies, comments and headers are left alone.
fn mangle(text: &str) -> String {
    let mut out = String::new();
    let mut in_script = false;
    let pieces: Vec<&str> = text.split('\n').collect();
    for (idx, line) in pieces.iter().enumerate() {
        let last = idx + 1 == pieces.len();
        let opens = line.matches("{~").count();
        let closes = line.matches("~}").count();
        let plain = !in_script && !line.starts_with("//") && !line.starts_with('#') && opens == 0 && closes == 0;
        if plain && !line.trim().is_empty() {
            let mut l = line.replace(" / ", " \t/   ");
            l = loosen_commas(&l);
            if !l.starts_with(' ') && !l.starts_with('\t') {
                l = format!("  {l}");
            }
            out.push_str(&l);
            out.push_str("  \t");
            if !last {
                out.push_str("\r\n");
            }
        } else {
            out.push_str(line);
            if !last {
                out.push('\n');
            }
        }
        if opens > closes {
            in_script = true;
        } else if closes > opens {
            in_script = false;
        }
    }
    out
}

#[test]
fn fmt_is_idempotent_and_preserves_evaluation_on_builtins() {
    let progs = programs();
    assert!(progs.len() >= 60, "found {} programs", progs.len());
    let mut changed_by_mangle = 0;
    for p in &progs {
        let (file, text, name, settings) = (&p.file, &p.text, &p.name, &p.settings);
        let base = eval_json(text, name, settings);

        let f1 = format_planner(text).unwrap_or_else(|e| panic!("{file}: {e}"));
        let f2 = format_planner(&f1).unwrap_or_else(|e| panic!("{file}: second pass: {e}"));
        assert_eq!(f1, f2, "{file}: fmt is not idempotent");
        assert_same(file, "evaluation changed after fmt", &eval_json(&f1, name, settings), &base);

        let ugly = mangle(text);
        if ugly != *text {
            changed_by_mangle += 1;
        }
        let g1 = format_planner(&ugly).unwrap_or_else(|e| panic!("{file}: mangled: {e}"));
        assert_eq!(format_planner(&g1).unwrap(), g1, "{file}: not idempotent on mangled input");
        assert_same(file, "mangle itself changed the evaluation", &eval_json(&ugly, name, settings), &eval_json(text, name, settings));
        assert_same(file, "evaluation changed after fmt of mangled text", &eval_json(&g1, name, settings), &base);
        // Canonical form does not depend on how the text was spaced.
        assert_eq!(g1, f1, "{file}: fmt(mangle(x)) != fmt(x)");
    }
    assert!(changed_by_mangle >= 60);
}
