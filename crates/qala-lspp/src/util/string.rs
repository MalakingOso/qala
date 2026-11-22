//! `utils/string.ts`. Lengths and slices are in UTF-16 code units like JS.

use crate::js::{is_js_whitespace, js_slice, js_trim, js_trim_end};

/// Uppercases the first character. The TS throws on an empty string; this returns "".
pub fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `replace(/(?:^\w|[A-Z]|\b\w)/g, ...)` then strip whitespace.
pub fn camel_case(s: &str) -> String {
    let c: Vec<char> = s.chars().collect();
    let mut out = String::new();
    for (i, ch) in c.iter().enumerate() {
        let prev_word = i > 0 && is_word(c[i - 1]);
        let matched = (i == 0 && is_word(*ch)) || ch.is_ascii_uppercase() || (is_word(*ch) && !prev_word);
        if matched {
            if i == 0 {
                out.extend(ch.to_lowercase());
            } else {
                out.extend(ch.to_uppercase());
            }
        } else {
            out.push(*ch);
        }
    }
    out.chars().filter(|c| !is_js_whitespace(*c)).collect()
}

fn leading_ws_len(line: &str) -> Option<usize> {
    let ws = line.chars().take_while(|c| is_js_whitespace(*c)).count();
    // needs a following non-whitespace char
    if line.chars().nth(ws).is_some() {
        Some(ws)
    } else {
        None
    }
}

pub fn unindent(s: &str) -> String {
    let indent = s.split('\n').filter_map(leading_ws_len).min();
    match indent {
        Some(n) => s
            .split('\n')
            .map(|l| {
                if js_trim(l).is_empty() {
                    String::new()
                } else {
                    js_trim_end(&js_slice(l, n as i64, None)).to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        None => s.to_string(),
    }
}
