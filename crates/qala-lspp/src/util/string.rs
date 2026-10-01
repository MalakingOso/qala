//! `utils/string.ts`. Lengths and slices are in UTF-16 code units like JS.

use crate::js::{is_js_whitespace, js_number_to_string, js_parse_int, js_slice, js_str_len, js_trim, js_trim_end};

fn replace_ws_runs(s: &str, with: &str) -> String {
    let mut out = String::new();
    let mut in_run = false;
    for c in s.chars() {
        if is_js_whitespace(c) {
            if !in_run {
                out.push_str(with);
                in_run = true;
            }
        } else {
            in_run = false;
            out.push(c);
        }
    }
    out
}

pub fn pad(s: &str, width: usize, fill: &str) -> String {
    let len = js_str_len(s);
    if len >= width {
        s.to_string()
    } else {
        format!("{}{}", fill.repeat(width - len), s)
    }
}

/// Uppercases the first character. The TS throws on an empty string; this returns "".
pub fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

pub fn pluralize(s: &str, count: f64) -> String {
    format!("{}{}", s, if count != 1.0 { "s" } else { "" })
}

pub fn dashcase(s: &str) -> String {
    let t: String = s.chars().filter(|c| *c != ':' && *c != ',').collect();
    replace_ws_runs(&t, "-").to_lowercase()
}

pub fn undashcase(s: &str) -> String {
    s.replace('-', " ")
}

/// `replace(/([a-z])([A-Z])/g, "$1 $2")`, matches do not overlap.
pub fn uncamel_case(s: &str) -> String {
    let c: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        if i + 1 < c.len() && c[i].is_ascii_lowercase() && c[i + 1].is_ascii_uppercase() {
            out.push(c[i]);
            out.push(' ');
            out.push(c[i + 1]);
            i += 2;
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    out
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

pub fn snakecase(s: &str) -> String {
    let t: String = s.chars().filter(|c| *c != ':' && *c != ',').collect();
    replace_ws_runs(&t, "_").to_lowercase()
}

pub fn truncate(s: &str, length: usize) -> String {
    if js_str_len(s) > length {
        format!("{}...", js_slice(s, 0, Some(length as i64 - 3)))
    } else {
        s.to_string()
    }
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

pub fn indent(s: &str, spaces: usize) -> String {
    let pad = " ".repeat(spaces);
    s.split('\n')
        .map(|l| if js_trim(l).is_empty() { l.to_string() } else { format!("{}{}", pad, l) })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn fuzzy_search(needle: &str, haystack: &str) -> bool {
    let n: Vec<u16> = needle.encode_utf16().collect();
    let h: Vec<u16> = haystack.encode_utf16().collect();
    if n.len() > h.len() {
        return false;
    }
    if n == h {
        return true;
    }
    let mut j = 0;
    for ch in &n {
        loop {
            if j >= h.len() {
                return false;
            }
            let hit = h[j] == *ch;
            j += 1;
            if hit {
                break;
            }
        }
    }
    true
}

/// Increments a trailing number, or appends " 2".
pub fn next_name(name: &str) -> String {
    let digits = name.chars().rev().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 {
        let split = name.len() - digits;
        let num = js_parse_int(&name[split..], 10);
        format!("{}{}", &name[..split], js_number_to_string(num + 1.0))
    } else {
        format!("{} 2", name)
    }
}

pub fn hash_code(s: &str) -> i32 {
    let mut hash: i32 = 0;
    for u in s.encode_utf16() {
        hash = hash.wrapping_shl(5).wrapping_sub(hash).wrapping_add(u as i32);
    }
    hash
}

pub fn hash_string(s: &str) -> String {
    format!("{:x}", hash_code(s) as u32)
}

pub fn hash_code_0_to_1(s: &str) -> f64 {
    let hash = (hash_code(s) as i64).abs();
    (hash % 10000) as f64 / 10000.0
}

/// Extracts from the first "{" to the last "}"; otherwise the trimmed input.
pub fn clean_json(s: &str) -> String {
    let t = js_trim(s);
    match (t.find('{'), t.rfind('}')) {
        (Some(a), Some(b)) if b > a => t[a..=b].to_string(),
        _ => t.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values derived by running the real StringUtils_* functions in deno.

    #[test]
    fn basics() {
        assert_eq!(pad("5", 3, "0"), "005");
        assert_eq!(pad("abc", 2, "0"), "abc");
        assert_eq!(pad("5", 4, "ab"), "ababab5");
        assert_eq!(pad("x", 3, " "), "  x");
        assert_eq!(capitalize("hello"), "Hello");
        assert_eq!(capitalize("\u{e9}a"), "\u{c9}a");
        assert_eq!(capitalize("\u{df}a"), "SSa");
        assert_eq!(capitalize(""), "");
        assert_eq!(pluralize("set", 1.0), "set");
        assert_eq!(pluralize("set", 0.0), "sets");
        assert_eq!(pluralize("set", 2.5), "sets");
        assert_eq!(dashcase("Hello, World: Foo  Bar"), "hello-world-foo-bar");
        assert_eq!(dashcase(" a\tb "), "-a-b-");
        assert_eq!(undashcase("a-b-c"), "a b c");
        assert_eq!(snakecase("Hello, World:  Foo"), "hello_world_foo");
    }

    #[test]
    fn cases() {
        let u: Vec<String> = ["aBC", "aBcD", "helloWorldFoo", "ABC", "a1B"].iter().map(|s| uncamel_case(s)).collect();
        assert_eq!(u, vec!["a BC", "a Bc D", "hello World Foo", "ABC", "a1B"]);
        let c: Vec<String> = ["Hello World", "hello world foo", "FooBar", "foo_bar baz", "  lead", "hello-world", "XMLHttp", "1st place", "\u{dc}ber Cool"]
            .iter()
            .map(|s| camel_case(s))
            .collect();
        assert_eq!(
            c,
            vec!["helloWorld", "helloWorldFoo", "fooBar", "foo_barBaz", "Lead", "hello-World", "xMLHttp", "1stPlace", "\u{dc}BerCool"]
        );
    }

    #[test]
    fn truncating() {
        assert_eq!(truncate("hello world", 8), "hello...");
        assert_eq!(truncate("hi", 8), "hi");
        assert_eq!(truncate("hello", 5), "hello");
        assert_eq!(truncate("hello world", 2), "hello worl...");
        assert_eq!(truncate("hello world", 0), "hello wo...");
    }

    #[test]
    fn indentation() {
        assert_eq!(unindent("    a\n      b\n\n    c  "), "a\n  b\n\nc");
        assert_eq!(unindent("\n\t\tx\n\t\t\ty"), "\nx\n\ty");
        assert_eq!(unindent("   \n  "), "   \n  ");
        assert_eq!(unindent("abc"), "abc");
        assert_eq!(unindent("  a\n b"), " a\nb");
        assert_eq!(indent("a\n\nb  ", 2), "  a\n\n  b  ");
        assert_eq!(indent("a", 0), "a");
    }

    #[test]
    fn fuzzy_and_names() {
        assert!(fuzzy_search("bp", "bench press"));
        assert!(!fuzzy_search("xyz", "bench"));
        assert!(fuzzy_search("", "a"));
        assert!(fuzzy_search("abc", "abc"));
        assert!(!fuzzy_search("abcd", "abc"));
        assert!(!fuzzy_search("pb", "bench press"));
        assert!(!fuzzy_search("ee", "bench"));
        let n: Vec<String> = ["Day 1", "Day 9", "Day", "x007", "a99999999999999999999999", "1"].iter().map(|s| next_name(s)).collect();
        assert_eq!(n, vec!["Day 2", "Day 10", "Day 2", "x8", "a1e+23", "2"]);
    }

    #[test]
    fn hashing() {
        let h: Vec<i32> = ["", "a", "hello", "Bench Press", "h\u{e9}llo\u{1F600}", "The quick brown fox jumps over the lazy dog"]
            .iter()
            .map(|s| hash_code(s))
            .collect();
        assert_eq!(h, vec![0, 97, 99162322, 1579916819, 291564465, -609428141]);
        let hs: Vec<String> = ["", "a", "hello", "Bench Press", "The quick brown fox jumps over the lazy dog"].iter().map(|s| hash_string(s)).collect();
        assert_eq!(hs, vec!["0", "61", "5e918d2", "5e2b9e13", "dbacdd53"]);
        let h01: Vec<f64> = ["", "a", "hello", "Bench Press"].iter().map(|s| hash_code_0_to_1(s)).collect();
        assert_eq!(h01, vec![0.0, 0.0097, 0.2322, 0.6819]);
    }

    #[test]
    fn json_cleaning() {
        let c: Vec<String> = ["  pre {\"a\":{\"b\":1}} post ", "no json", "} {", "text {a} more } end", "{", "  {x}  "].iter().map(|s| clean_json(s)).collect();
        assert_eq!(c, vec!["{\"a\":{\"b\":1}}", "no json", "} {", "{a} more }", "{", "{x}"]);
    }
}
