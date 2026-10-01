//! Hand-written lexer and recursive descent parser for the planner exercise language
//! (packages/liftoscript/src/pages/planner/plannerExercise.grammar).
//!
//! The output is a generic tree shaped like the Lezer tree for valid input: only named
//! grammar nodes appear (anonymous literals such as "/" or "[" are not nodes), and offsets
//! are UTF-16 code units so they match JS string indices.
//!
//! Lezer picks tokens per parse state: only tokens valid in the current state compete, the
//! longest match wins, and ties go to the declared precedence. The parser reproduces that by
//! asking the lexer for the longest match among an explicit list of allowed tokens at each
//! point (earlier entries win ties). Invalid input never panics; it yields best effort
//! `Error` nodes whose shape differs from Lezer's recovery.

/// One variant per named node or token in the grammar, plus `Error`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum NodeKind {
    Program,
    LineComment,
    TripleLineComment,
    Week,
    Day,
    ExerciseExpression,
    ExerciseVariations,
    ExerciseVariation,
    CurrentVariation,
    ExerciseName,
    NonSeparator,
    Repeat,
    Rep,
    Int,
    RepRange,
    SectionSeparator,
    ExerciseSection,
    ExerciseProperty,
    ExercisePropertyName,
    Keyword,
    FunctionExpression,
    FunctionName,
    FunctionArgument,
    Number,
    Plus,
    PosNumber,
    Float,
    Weight,
    Percentage,
    Rpe,
    KeyValue,
    Liftoscript,
    ReuseLiftoscript,
    ReuseSection,
    WarmupExerciseSets,
    WarmupExerciseSet,
    WarmupSetPart,
    None,
    ExerciseSets,
    ExerciseSet,
    SetTimer,
    Timer,
    Auto,
    SetPart,
    WeightWithPlus,
    PercentageWithPlus,
    SetLabel,
    AskWeight,
    ReuseSectionWithWeekDay,
    WeekDay,
    WeekOrDay,
    Current,
    Superset,
    SupersetKeyword,
    EmptyExpression,
    Error,
}

const KIND_NAMES: &[(NodeKind, &str)] = &[
    (NodeKind::Program, "Program"),
    (NodeKind::LineComment, "LineComment"),
    (NodeKind::TripleLineComment, "TripleLineComment"),
    (NodeKind::Week, "Week"),
    (NodeKind::Day, "Day"),
    (NodeKind::ExerciseExpression, "ExerciseExpression"),
    (NodeKind::ExerciseVariations, "ExerciseVariations"),
    (NodeKind::ExerciseVariation, "ExerciseVariation"),
    (NodeKind::CurrentVariation, "CurrentVariation"),
    (NodeKind::ExerciseName, "ExerciseName"),
    (NodeKind::NonSeparator, "NonSeparator"),
    (NodeKind::Repeat, "Repeat"),
    (NodeKind::Rep, "Rep"),
    (NodeKind::Int, "Int"),
    (NodeKind::RepRange, "RepRange"),
    (NodeKind::SectionSeparator, "SectionSeparator"),
    (NodeKind::ExerciseSection, "ExerciseSection"),
    (NodeKind::ExerciseProperty, "ExerciseProperty"),
    (NodeKind::ExercisePropertyName, "ExercisePropertyName"),
    (NodeKind::Keyword, "Keyword"),
    (NodeKind::FunctionExpression, "FunctionExpression"),
    (NodeKind::FunctionName, "FunctionName"),
    (NodeKind::FunctionArgument, "FunctionArgument"),
    (NodeKind::Number, "Number"),
    (NodeKind::Plus, "Plus"),
    (NodeKind::PosNumber, "PosNumber"),
    (NodeKind::Float, "Float"),
    (NodeKind::Weight, "Weight"),
    (NodeKind::Percentage, "Percentage"),
    (NodeKind::Rpe, "Rpe"),
    (NodeKind::KeyValue, "KeyValue"),
    (NodeKind::Liftoscript, "Liftoscript"),
    (NodeKind::ReuseLiftoscript, "ReuseLiftoscript"),
    (NodeKind::ReuseSection, "ReuseSection"),
    (NodeKind::WarmupExerciseSets, "WarmupExerciseSets"),
    (NodeKind::WarmupExerciseSet, "WarmupExerciseSet"),
    (NodeKind::WarmupSetPart, "WarmupSetPart"),
    (NodeKind::None, "None"),
    (NodeKind::ExerciseSets, "ExerciseSets"),
    (NodeKind::ExerciseSet, "ExerciseSet"),
    (NodeKind::SetTimer, "SetTimer"),
    (NodeKind::Timer, "Timer"),
    (NodeKind::Auto, "Auto"),
    (NodeKind::SetPart, "SetPart"),
    (NodeKind::WeightWithPlus, "WeightWithPlus"),
    (NodeKind::PercentageWithPlus, "PercentageWithPlus"),
    (NodeKind::SetLabel, "SetLabel"),
    (NodeKind::AskWeight, "AskWeight"),
    (NodeKind::ReuseSectionWithWeekDay, "ReuseSectionWithWeekDay"),
    (NodeKind::WeekDay, "WeekDay"),
    (NodeKind::WeekOrDay, "WeekOrDay"),
    (NodeKind::Current, "Current"),
    (NodeKind::Superset, "Superset"),
    (NodeKind::SupersetKeyword, "SupersetKeyword"),
    (NodeKind::EmptyExpression, "EmptyExpression"),
    (NodeKind::Error, "⚠"),
];

impl NodeKind {
    /// The Lezer node name ("⚠" for `Error`).
    pub fn name(self) -> &'static str {
        KIND_NAMES
            .iter()
            .find(|(k, _)| *k == self)
            .map(|(_, n)| *n)
            .unwrap_or("⚠")
    }

    /// Inverse of `name`.
    pub fn from_name(name: &str) -> Option<NodeKind> {
        KIND_NAMES.iter().find(|(_, n)| *n == name).map(|(k, _)| *k)
    }
}

/// A node of the generic syntax tree. Offsets are UTF-16 code units.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    pub kind: NodeKind,
    pub from: usize,
    pub to: usize,
    pub children: Vec<Node>,
}

impl Node {
    pub fn name(&self) -> &'static str {
        self.kind.name()
    }

    pub fn is_error(&self) -> bool {
        self.kind == NodeKind::Error
    }

    pub fn children(&self) -> &[Node] {
        &self.children
    }

    pub fn first_child(&self) -> Option<&Node> {
        self.children.first()
    }

    pub fn last_child(&self) -> Option<&Node> {
        self.children.last()
    }

    /// First child of the given kind (Lezer `getChild`).
    pub fn get_child(&self, kind: NodeKind) -> Option<&Node> {
        self.children.iter().find(|c| c.kind == kind)
    }

    /// All children of the given kind (Lezer `getChildren`).
    pub fn get_children(&self, kind: NodeKind) -> Vec<&Node> {
        self.children.iter().filter(|c| c.kind == kind).collect()
    }

    /// The sibling after `self` inside `parent` (Lezer `nextSibling`). Matching is by
    /// identity, so `self` must be a node borrowed from `parent`.
    pub fn next_sibling<'a>(&self, parent: &'a Node) -> Option<&'a Node> {
        let idx = parent.children.iter().position(|c| std::ptr::eq(c, self))?;
        parent.children.get(idx + 1)
    }

    /// The sibling before `self` inside `parent`.
    pub fn prev_sibling<'a>(&self, parent: &'a Node) -> Option<&'a Node> {
        let idx = parent.children.iter().position(|c| std::ptr::eq(c, self))?;
        idx.checked_sub(1).and_then(|i| parent.children.get(i))
    }

    /// The source text covered by this node.
    pub fn value(&self, text: &str) -> String {
        slice16(text, self.from, self.to)
    }

    /// Whether any node in this subtree is an error node.
    pub fn has_error(&self) -> bool {
        self.is_error() || self.children.iter().any(|c| c.has_error())
    }

    /// Lezer-dump JSON shape: {name, from, to, children}.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "name": self.name(),
            "from": self.from,
            "to": self.to,
            "children": self.children.iter().map(|c| c.to_json()).collect::<Vec<_>>(),
        })
    }

    /// Parses the Lezer-dump JSON shape back into a node. Unknown names yield `None`.
    pub fn from_json(v: &serde_json::Value) -> Option<Node> {
        let kind = NodeKind::from_name(v.get("name")?.as_str()?)?;
        let from = v.get("from")?.as_u64()? as usize;
        let to = v.get("to")?.as_u64()? as usize;
        let mut children = Vec::new();
        for c in v.get("children")?.as_array()? {
            children.push(Node::from_json(c)?);
        }
        Some(Node {
            kind,
            from,
            to,
            children,
        })
    }
}

/// Slice `text` by UTF-16 code unit offsets, as JS `text.slice(from, to)` would.
pub fn slice16(text: &str, from: usize, to: usize) -> String {
    if text.is_ascii() {
        let to = to.min(text.len());
        let from = from.min(to);
        return text[from..to].to_string();
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let to = to.min(units.len());
    let from = from.min(to);
    String::from_utf16_lossy(&units[from..to])
}

/// The text of a node (Lezer `getValue`).
pub fn get_value(text: &str, node: &Node) -> String {
    slice16(text, node.from, node.to)
}

/// Parse a whole planner program (or a single line). Never fails.
pub fn parse(text: &str) -> Node {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut p = Parser { u: &units, pos: 0 };
    p.program()
}

// ---------------------------------------------------------------------------------------
// Lexer

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum T {
    LineComment,
    TripleLineComment,
    Week,
    Day,
    Linebreak,
    Eof,
    Bang,
    Pipe,
    Comma,
    LParen,
    RParen,
    LBrack,
    RBrack,
    Colon,
    Dash,
    Dots,
    At,
    LetterS,
    LetterX,
    LBrace,
    RBrace,
    Backslash,
    NonSep,
    Keyword,
    KwNone,
    KwAuto,
    SupersetKw,
    Int,
    Float,
    Weight,
    Percentage,
    SetTimer,
    Plus,
    AskWeight,
    Current,
    Slash,
    Liftoscript,
}

#[derive(Clone, Copy, Debug)]
struct Tok {
    t: T,
    from: usize,
    to: usize,
}

/// Tokens that can start an ExerciseSet item (the keyword only counts when it is "auto").
const ITEM: &[T] = &[
    T::AskWeight,
    T::Weight,
    T::Percentage,
    T::SetTimer,
    T::Int,
    T::At,
    T::LParen,
    T::KwAuto,
];

/// Tokens that can start an ExerciseSection.
const SEC_START: &[T] = &[
    T::Bang,
    T::SupersetKw,
    T::Keyword,
    T::KwAuto,
    T::Dots,
    T::AskWeight,
    T::Weight,
    T::Percentage,
    T::SetTimer,
    T::Int,
    T::At,
    T::LParen,
];

/// Tokens that can start a FunctionArgument or the value of a KeyValue.
const ARG_START: &[T] = &[
    T::Weight,
    T::Percentage,
    T::Float,
    T::Int,
    T::Plus,
    T::Dash,
    T::At,
    T::Keyword,
];

const KV_VALUE: &[T] = &[T::Weight, T::Percentage, T::Float, T::Int, T::Plus, T::Dash];

fn is_digit(c: u16) -> bool {
    (0x30..=0x39).contains(&c)
}

fn is_nonsep(c: u16) -> bool {
    !matches!(
        c,
        0x2f | 0x7b
            | 0x7d
            | 0x28
            | 0x29
            | 0x20
            | 0x09
            | 0x0a
            | 0x0d
            | 0x23
            | 0x5b
            | 0x5d
            | 0x7c
            | 0x21
    )
}

fn is_kw_start(c: u16) -> bool {
    (0x41..=0x5a).contains(&c) || (0x61..=0x7a).contains(&c) || c == 0x5f
}

fn ch(c: char) -> u16 {
    c as u16
}

struct Parser<'a> {
    u: &'a [u16],
    /// End of the last consumed token.
    pos: usize,
}

impl<'a> Parser<'a> {
    fn at(&self, i: usize) -> Option<u16> {
        self.u.get(i).copied()
    }

    fn skip_ws(&self, mut i: usize) -> usize {
        while matches!(self.at(i), Some(0x20) | Some(0x09)) {
            i += 1;
        }
        i
    }

    fn digits(&self, mut i: usize) -> usize {
        while self.at(i).is_some_and(is_digit) {
            i += 1;
        }
        i
    }

    fn starts_with(&self, i: usize, s: &str) -> bool {
        s.encode_utf16()
            .enumerate()
            .all(|(k, c)| self.at(i + k) == Some(c))
    }

    /// End of the line comment style token starting at `i`: through the next "\n" or EOF.
    fn line_end_incl(&self, mut i: usize) -> usize {
        while let Some(c) = self.at(i) {
            i += 1;
            if c == 0x0a {
                break;
            }
        }
        i
    }

    fn keyword_end(&self, s: usize) -> Option<usize> {
        if !self.at(s).is_some_and(is_kw_start) {
            return None;
        }
        let mut e = s + 1;
        while self.at(e).is_some_and(|x| is_kw_start(x) || is_digit(x)) {
            e += 1;
        }
        Some(e)
    }

    fn matches_word(&self, s: usize, e: usize, w: &str) -> bool {
        e - s == w.len() && self.starts_with(s, w)
    }

    /// Float: digit* "." digit+
    fn float_end(&self, i: usize) -> Option<usize> {
        let d = self.digits(i);
        if self.at(d) == Some(ch('.')) {
            let e = self.digits(d + 1);
            if e > d + 1 {
                return Some(e);
            }
        }
        None
    }

    fn int_end(&self, i: usize) -> Option<usize> {
        let e = self.digits(i);
        if e > i {
            Some(e)
        } else {
            None
        }
    }

    /// Longest of the Float or Int alternatives followed by one of `suffixes`.
    fn number_suffix(&self, i: usize, suffixes: &[&str]) -> Option<usize> {
        let mut best: Option<usize> = None;
        for end in [self.float_end(i), self.int_end(i)].into_iter().flatten() {
            for s in suffixes {
                if self.starts_with(end, s) {
                    let e = end + s.encode_utf16().count();
                    if best.is_none_or(|b| e > b) {
                        best = Some(e);
                    }
                }
            }
        }
        best
    }

    fn signed_number_suffix(&self, i: usize, suffixes: &[&str]) -> Option<usize> {
        let start = if matches!(self.at(i), Some(0x2b) | Some(0x2d)) {
            i + 1
        } else {
            i
        };
        self.number_suffix(start, suffixes)
    }

    fn match_tok(&self, t: T, s: usize) -> Option<usize> {
        let c = self.at(s);
        match t {
            T::Eof => (s >= self.u.len()).then_some(s),
            T::Linebreak => match c {
                Some(0x0d) => Some(if self.at(s + 1) == Some(0x0a) {
                    s + 2
                } else {
                    s + 1
                }),
                Some(0x0a) => Some(s + 1),
                _ => None,
            },
            T::Day => self.starts_with(s, "##").then(|| self.line_end_incl(s + 2)),
            T::Week => (c == Some(0x23)).then(|| self.line_end_incl(s + 1)),
            T::TripleLineComment => self
                .starts_with(s, "///")
                .then(|| self.line_end_incl(s + 3)),
            T::LineComment => self.starts_with(s, "//").then(|| self.line_end_incl(s + 2)),
            T::Bang => (c == Some(ch('!'))).then_some(s + 1),
            T::Pipe => (c == Some(ch('|'))).then_some(s + 1),
            T::Comma => (c == Some(ch(','))).then_some(s + 1),
            T::LParen => (c == Some(ch('('))).then_some(s + 1),
            T::RParen => (c == Some(ch(')'))).then_some(s + 1),
            T::LBrack => (c == Some(ch('['))).then_some(s + 1),
            T::RBrack => (c == Some(ch(']'))).then_some(s + 1),
            T::Colon => (c == Some(ch(':'))).then_some(s + 1),
            T::Dash => (c == Some(ch('-'))).then_some(s + 1),
            T::Dots => self.starts_with(s, "...").then_some(s + 3),
            T::At => (c == Some(ch('@'))).then_some(s + 1),
            T::LetterS => (c == Some(ch('s'))).then_some(s + 1),
            T::LetterX => (c == Some(ch('x'))).then_some(s + 1),
            T::LBrace => (c == Some(ch('{'))).then_some(s + 1),
            T::RBrace => (c == Some(ch('}'))).then_some(s + 1),
            T::Backslash => (c == Some(ch('\\'))).then_some(s + 1),
            T::Plus => (c == Some(ch('+'))).then_some(s + 1),
            T::Current => (c == Some(ch('_'))).then_some(s + 1),
            T::Slash => (c == Some(ch('/'))).then_some(s + 1),
            T::AskWeight => self.starts_with(s, "?+").then_some(s + 2),
            T::NonSep => {
                let mut e = s;
                while self.at(e).is_some_and(is_nonsep) {
                    e += 1;
                }
                (e > s).then_some(e)
            }
            T::Keyword => {
                let e = self.keyword_end(s)?;
                // "none" and "auto" are specialized away from plain keywords.
                (!self.matches_word(s, e, "none") && !self.matches_word(s, e, "auto")).then_some(e)
            }
            T::KwNone => self
                .keyword_end(s)
                .filter(|&e| self.matches_word(s, e, "none")),
            T::KwAuto => self
                .keyword_end(s)
                .filter(|&e| self.matches_word(s, e, "auto")),
            T::SupersetKw => self.starts_with(s, "superset").then_some(s + 8),
            T::Int => self.int_end(s),
            T::Float => self.float_end(s),
            T::Weight => self.signed_number_suffix(s, &["lb", "kg"]),
            T::Percentage => self.signed_number_suffix(s, &["%"]),
            T::SetTimer => {
                let d = self.int_end(s)?;
                if self.at(d) != Some(ch('s')) {
                    return None;
                }
                let mut i = d + 1;
                if self.at(i) == Some(ch('+')) {
                    i += 1;
                }
                if self.at(i) != Some(ch('|')) {
                    return None;
                }
                i += 1;
                if self.at(i) == Some(ch('?')) {
                    return Some(i + 1);
                }
                let d2 = self.int_end(i)?;
                (self.at(d2) == Some(ch('s'))).then_some(d2 + 1)
            }
            T::Liftoscript => {
                if !self.starts_with(s, "{~") {
                    return None;
                }
                let mut i = s + 2;
                while let Some(x) = self.at(i) {
                    if x == ch('~') {
                        break;
                    }
                    i += 1;
                }
                (self.at(i) == Some(ch('~')) && self.at(i + 1) == Some(ch('}'))).then_some(i + 2)
            }
        }
    }

    /// Declared token precedence, higher first. A higher token that matches at the current
    /// position beats the lower one even when it is shorter, and even when it is not valid in
    /// the current state (the parse then fails, as in Lezer).
    fn overrides(low: T) -> &'static [T] {
        match low {
            T::NonSep => &[T::AskWeight, T::Backslash],
            T::Keyword => &[T::SupersetKw],
            T::Percentage => &[T::Weight],
            T::SetTimer => &[T::Weight, T::Percentage],
            T::Float => &[T::Weight, T::Percentage, T::SetTimer],
            T::Int => &[T::Weight, T::Percentage, T::SetTimer, T::Float],
            T::Week => &[T::Day],
            T::LineComment => &[T::TripleLineComment],
            _ => &[],
        }
    }

    /// Token choice after skipping whitespace: declared precedence first, then the longest
    /// match among `allowed`, with earlier entries winning ties.
    fn lex(&self, allowed: &[T]) -> Option<Tok> {
        let s = self.skip_ws(self.pos);
        for &low in allowed {
            for &high in Self::overrides(low) {
                if let Some(e) = self.match_tok(high, s) {
                    return allowed.contains(&high).then_some(Tok {
                        t: high,
                        from: s,
                        to: e,
                    });
                }
            }
        }
        let mut best: Option<Tok> = None;
        for &t in allowed {
            if let Some(e) = self.match_tok(t, s) {
                if best.is_none_or(|b| e > b.to) {
                    best = Some(Tok { t, from: s, to: e });
                }
            }
        }
        best
    }

    fn lex2(&self, extra: &[T], base: &[T]) -> Option<Tok> {
        let mut v = extra.to_vec();
        v.extend_from_slice(base);
        self.lex(&v)
    }

    fn take(&mut self, tok: Tok) {
        if tok.t != T::Eof {
            self.pos = tok.to;
        }
    }

    fn next_start(&self) -> usize {
        self.skip_ws(self.pos)
    }

    fn leaf(&mut self, kind: NodeKind, tok: Tok) -> Node {
        self.take(tok);
        Node {
            kind,
            from: tok.from,
            to: tok.to,
            children: Vec::new(),
        }
    }

    fn mk(&self, kind: NodeKind, start: usize, children: Vec<Node>) -> Node {
        let to = children
            .last()
            .map_or(start, |c| c.to)
            .max(self.pos)
            .max(start);
        Node {
            kind,
            from: start,
            to,
            children,
        }
    }

    /// Zero-width error at the end of the last consumed token (a missing token).
    fn err(&self) -> Node {
        let s = self.pos;
        Node {
            kind: NodeKind::Error,
            from: s,
            to: s,
            children: Vec::new(),
        }
    }

    /// Zero-width error at the start of the next token (an unexpected token).
    fn err_next(&self) -> Node {
        let s = self.next_start();
        Node {
            kind: NodeKind::Error,
            from: s,
            to: s,
            children: Vec::new(),
        }
    }

    /// Wrap tokens up to the next "/" or line break in an error node. Always consumes.
    fn skip_error(&mut self) -> Node {
        let s = self.next_start();
        let mut e = s + 1;
        while let Some(c) = self.at(e) {
            if c == 0x2f || c == 0x0a || c == 0x0d {
                break;
            }
            e += 1;
        }
        let e = e.min(self.u.len());
        self.pos = e;
        Node {
            kind: NodeKind::Error,
            from: s,
            to: e,
            children: Vec::new(),
        }
    }

    // -----------------------------------------------------------------------------------
    // Program and lines

    fn program(&mut self) -> Node {
        let mut kids = Vec::new();
        loop {
            let s = self.next_start();
            let Some(c) = self.at(s) else { break };
            if c == 0x23 {
                let tok = self.lex(&[T::Day, T::Week]);
                if let Some(tok) = tok {
                    let kind = if tok.t == T::Day {
                        NodeKind::Day
                    } else {
                        NodeKind::Week
                    };
                    kids.push(self.leaf(kind, tok));
                    continue;
                }
            } else if c == 0x2f && self.at(s + 1) == Some(0x2f) {
                if let Some(tok) = self.lex(&[T::TripleLineComment, T::LineComment]) {
                    let kind = if tok.t == T::TripleLineComment {
                        NodeKind::TripleLineComment
                    } else {
                        NodeKind::LineComment
                    };
                    kids.push(self.leaf(kind, tok));
                    continue;
                }
            } else if c == 0x0a || c == 0x0d {
                if let Some(tok) = self.lex(&[T::Linebreak]) {
                    kids.push(self.leaf(NodeKind::EmptyExpression, tok));
                    continue;
                }
            } else if c == 0x21 || is_nonsep(c) {
                let before = self.pos;
                let node = self.expression();
                // A lone backslash passes is_nonsep but the lexer gives it precedence over
                // a name character, so the expression can consume nothing. Without this
                // check the loop never advances and pushes empty nodes until memory runs out.
                if self.pos > before {
                    kids.push(node);
                    continue;
                }
                self.pos = before;
            }
            kids.push(self.skip_error());
        }
        Node {
            kind: NodeKind::Program,
            from: 0,
            to: self.u.len(),
            children: kids,
        }
    }

    fn expression(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = vec![self.variations()];
        if self.lex(&[T::LBrack]).is_some() {
            kids.push(self.repeat());
        }
        loop {
            let Some(tok) = self.lex(&[T::Slash, T::Linebreak, T::Eof]) else {
                // Lezer closes the expression with a zero-width error at the unexpected
                // token; the rest of the line parses as a new expression.
                kids.push(self.err_next());
                break;
            };
            match tok.t {
                T::Slash => {
                    kids.push(self.leaf(NodeKind::SectionSeparator, tok));
                    if self.lex(SEC_START).is_some() {
                        kids.push(self.section());
                    }
                }
                T::Linebreak => {
                    self.take(tok);
                    break;
                }
                _ => break,
            }
        }
        self.mk(NodeKind::ExerciseExpression, start, kids)
    }

    fn variations(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = vec![self.variation()];
        while let Some(tok) = self.lex(&[T::Pipe]) {
            self.take(tok);
            kids.push(self.variation());
        }
        self.mk(NodeKind::ExerciseVariations, start, kids)
    }

    fn variation(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(tok) = self.lex(&[T::Bang]) {
            kids.push(self.leaf(NodeKind::CurrentVariation, tok));
        }
        kids.push(self.name(false));
        self.mk(NodeKind::ExerciseVariation, start, kids)
    }

    /// ExerciseName { NonSeparator+ }. With `bs` a lone backslash ends the name.
    fn name(&mut self, bs: bool) -> Node {
        let start = self.next_start();
        let allowed: &[T] = if bs {
            &[T::Backslash, T::NonSep]
        } else {
            &[T::NonSep]
        };
        let mut kids = Vec::new();
        while let Some(tok) = self.lex(allowed) {
            if tok.t != T::NonSep {
                break;
            }
            kids.push(self.leaf(NodeKind::NonSeparator, tok));
        }
        if kids.is_empty() {
            return self.err();
        }
        self.mk(NodeKind::ExerciseName, start, kids)
    }

    fn rep(&mut self) -> Option<Node> {
        let tok = self.lex(&[T::Int])?;
        let start = tok.from;
        let int = self.leaf(NodeKind::Int, tok);
        Some(self.mk(NodeKind::Rep, start, vec![int]))
    }

    fn rep_or_err(&mut self) -> Node {
        self.rep().unwrap_or_else(|| self.err())
    }

    fn repeat(&mut self) -> Node {
        let start = self.next_start();
        if let Some(tok) = self.lex(&[T::LBrack]) {
            self.take(tok);
        }
        let mut kids = Vec::new();
        loop {
            let item_start = self.next_start();
            match self.rep() {
                Some(r) => {
                    if let Some(d) = self.lex(&[T::Dash]) {
                        self.take(d);
                        let r2 = self.rep_or_err();
                        kids.push(self.mk(NodeKind::RepRange, item_start, vec![r, r2]));
                    } else {
                        kids.push(r);
                    }
                }
                None => kids.push(self.err()),
            }
            match self.lex(&[T::Comma, T::RBrack]) {
                Some(t) if t.t == T::Comma => self.take(t),
                Some(t) => {
                    self.take(t);
                    break;
                }
                None => {
                    kids.push(self.err());
                    break;
                }
            }
        }
        self.mk(NodeKind::Repeat, start, kids)
    }

    // -----------------------------------------------------------------------------------
    // Sections

    fn section(&mut self) -> Node {
        let start = self.next_start();
        let tok = self.lex(SEC_START);
        let body = match tok {
            Some(t) if t.t == T::KwAuto => self.sets(),
            Some(t) if t.t == T::Keyword => self.property(),
            Some(t) if t.t == T::SupersetKw => self.superset(),
            Some(t) if t.t == T::Dots => self.reuse_with_weekday(),
            _ => self.sets(),
        };
        let mut kids = vec![body];
        if let Some(b) = self.lex(&[T::Backslash]) {
            self.take(b);
            match self.lex(&[T::Linebreak]) {
                Some(lb) => self.take(lb),
                None => kids.push(self.err()),
            }
        }
        self.mk(NodeKind::ExerciseSection, start, kids)
    }

    fn superset(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(tok) = self.lex(&[T::SupersetKw]) {
            kids.push(self.leaf(NodeKind::SupersetKeyword, tok));
        }
        match self.lex(&[T::Colon]) {
            Some(c) => self.take(c),
            None => kids.push(self.err()),
        }
        kids.push(self.name(true));
        self.mk(NodeKind::Superset, start, kids)
    }

    fn reuse_section(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(d) = self.lex(&[T::Dots]) {
            self.take(d);
        }
        kids.push(self.name(true));
        self.mk(NodeKind::ReuseSection, start, kids)
    }

    fn reuse_with_weekday(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = vec![self.reuse_section()];
        if self.lex(&[T::LBrack]).is_some() {
            kids.push(self.weekday());
        }
        self.mk(NodeKind::ReuseSectionWithWeekDay, start, kids)
    }

    fn week_or_day(&mut self) -> Node {
        let start = self.next_start();
        let inner = match self.lex(&[T::Int, T::Current]) {
            Some(t) if t.t == T::Int => self.leaf(NodeKind::Int, t),
            Some(t) => self.leaf(NodeKind::Current, t),
            None => self.err(),
        };
        self.mk(NodeKind::WeekOrDay, start, vec![inner])
    }

    fn weekday(&mut self) -> Node {
        let start = self.next_start();
        if let Some(t) = self.lex(&[T::LBrack]) {
            self.take(t);
        }
        let mut kids = vec![self.week_or_day()];
        match self.lex(&[T::Colon, T::RBrack]) {
            Some(t) if t.t == T::Colon => {
                self.take(t);
                kids.push(self.week_or_day());
                match self.lex(&[T::RBrack]) {
                    Some(t) => self.take(t),
                    None => kids.push(self.err()),
                }
            }
            Some(t) => self.take(t),
            None => kids.push(self.err()),
        }
        self.mk(NodeKind::WeekDay, start, kids)
    }

    // -----------------------------------------------------------------------------------
    // Properties and functions

    fn property(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(tok) = self.lex(&[T::Keyword]) {
            let ns = tok.from;
            let kw = self.leaf(NodeKind::Keyword, tok);
            kids.push(self.mk(NodeKind::ExercisePropertyName, ns, vec![kw]));
        }
        match self.lex(&[T::Colon]) {
            Some(c) => self.take(c),
            None => {
                kids.push(self.err());
                return self.mk(NodeKind::ExerciseProperty, start, kids);
            }
        }
        match self.lex(&[T::KwNone, T::Keyword, T::Int, T::Weight, T::Percentage]) {
            Some(t) if t.t == T::KwNone => kids.push(self.leaf(NodeKind::None, t)),
            Some(t) if t.t == T::Keyword => kids.push(self.function_expression()),
            Some(_) => kids.push(self.warmup_sets()),
            None => kids.push(self.err()),
        }
        self.mk(NodeKind::ExerciseProperty, start, kids)
    }

    fn function_expression(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(tok) = self.lex(&[T::Keyword]) {
            let ns = tok.from;
            let kw = self.leaf(NodeKind::Keyword, tok);
            kids.push(self.mk(NodeKind::FunctionName, ns, vec![kw]));
        }
        if let Some(tok) = self.lex(&[T::LParen, T::Liftoscript, T::LBrace]) {
            if tok.t == T::LParen {
                self.take(tok);
                if self.lex(ARG_START).is_some() {
                    kids.push(self.argument());
                }
                loop {
                    match self.lex(&[T::Comma, T::RParen]) {
                        Some(t) if t.t == T::Comma => {
                            self.take(t);
                            if self.lex(ARG_START).is_some() {
                                kids.push(self.argument());
                            } else {
                                kids.push(self.err());
                            }
                        }
                        Some(t) => {
                            self.take(t);
                            break;
                        }
                        None => {
                            kids.push(self.err());
                            break;
                        }
                    }
                }
            }
        }
        match self.lex(&[T::Liftoscript, T::LBrace]) {
            Some(t) if t.t == T::Liftoscript => kids.push(self.leaf(NodeKind::Liftoscript, t)),
            Some(_) => kids.push(self.reuse_liftoscript()),
            None => {}
        }
        self.mk(NodeKind::FunctionExpression, start, kids)
    }

    fn reuse_liftoscript(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(t) = self.lex(&[T::LBrace]) {
            self.take(t);
        }
        if self.lex(&[T::Dots]).is_some() {
            kids.push(self.reuse_section());
        } else {
            kids.push(self.err());
        }
        match self.lex(&[T::RBrace]) {
            Some(t) => self.take(t),
            None => kids.push(self.err()),
        }
        self.mk(NodeKind::ReuseLiftoscript, start, kids)
    }

    fn argument(&mut self) -> Node {
        let start = self.next_start();
        let inner = match self.lex(ARG_START) {
            Some(t) => match t.t {
                T::Weight => self.leaf(NodeKind::Weight, t),
                T::Percentage => self.leaf(NodeKind::Percentage, t),
                T::At => self.rpe(false),
                T::Int => {
                    let r = self.rep_or_err();
                    if let Some(d) = self.lex(&[T::Dash]) {
                        self.take(d);
                        let r2 = self.rep_or_err();
                        self.mk(NodeKind::RepRange, start, vec![r, r2])
                    } else {
                        let int = r.children.first().cloned();
                        let pn = int.map(|i| self.mk(NodeKind::PosNumber, start, vec![i]));
                        self.mk(NodeKind::Number, start, pn.into_iter().collect())
                    }
                }
                T::Keyword => self.key_value(),
                _ => self.number(),
            },
            None => self.err(),
        };
        self.mk(NodeKind::FunctionArgument, start, vec![inner])
    }

    fn number(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(t) = self.lex(&[T::Plus, T::Dash]) {
            if t.t == T::Plus {
                kids.push(self.leaf(NodeKind::Plus, t));
            } else {
                self.take(t);
            }
        }
        match self.lex(&[T::Float, T::Int]) {
            Some(t) => {
                let k = if t.t == T::Float {
                    NodeKind::Float
                } else {
                    NodeKind::Int
                };
                let ps = t.from;
                let l = self.leaf(k, t);
                kids.push(self.mk(NodeKind::PosNumber, ps, vec![l]));
            }
            None => kids.push(self.err()),
        }
        self.mk(NodeKind::Number, start, kids)
    }

    fn key_value(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(t) = self.lex(&[T::Keyword]) {
            kids.push(self.leaf(NodeKind::Keyword, t));
        }
        if let Some(t) = self.lex(&[T::Plus]) {
            kids.push(self.leaf(NodeKind::Plus, t));
        }
        match self.lex(&[T::Colon]) {
            Some(c) => self.take(c),
            None => {
                kids.push(self.err());
                return self.mk(NodeKind::KeyValue, start, kids);
            }
        }
        match self.lex(KV_VALUE) {
            Some(t) if t.t == T::Weight => kids.push(self.leaf(NodeKind::Weight, t)),
            Some(t) if t.t == T::Percentage => kids.push(self.leaf(NodeKind::Percentage, t)),
            Some(_) => kids.push(self.number()),
            None => kids.push(self.err()),
        }
        self.mk(NodeKind::KeyValue, start, kids)
    }

    /// Rpe { "@" (PosNumber | Plus | PosNumber Plus?) }
    fn rpe(&mut self, in_set: bool) -> Node {
        let start = self.next_start();
        if let Some(t) = self.lex(&[T::At]) {
            self.take(t);
        }
        let mut kids = Vec::new();
        match self.lex(&[T::Float, T::Int, T::Plus]) {
            Some(t) if t.t == T::Plus => kids.push(self.leaf(NodeKind::Plus, t)),
            Some(t) => {
                let k = if t.t == T::Float {
                    NodeKind::Float
                } else {
                    NodeKind::Int
                };
                let ps = t.from;
                let l = self.leaf(k, t);
                kids.push(self.mk(NodeKind::PosNumber, ps, vec![l]));
                if let Some(p) = self.plus_next(in_set) {
                    kids.push(p);
                }
            }
            None => kids.push(self.err()),
        }
        self.mk(NodeKind::Rpe, start, kids)
    }

    /// An optional Plus. Inside a set a following "+5lb" is a Weight, not a Plus.
    fn plus_next(&mut self, in_set: bool) -> Option<Node> {
        let tok = if in_set {
            self.lex2(&[T::Plus], ITEM)
        } else {
            self.lex(&[T::Plus])
        }?;
        if tok.t == T::Plus {
            Some(self.leaf(NodeKind::Plus, tok))
        } else {
            None
        }
    }

    // -----------------------------------------------------------------------------------
    // Sets

    fn sets(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        if let Some(t) = self.lex(&[T::Bang]) {
            kids.push(self.leaf(NodeKind::CurrentVariation, t));
        }
        kids.push(self.set());
        while let Some(t) = self.lex(&[T::Comma]) {
            self.take(t);
            kids.push(self.set());
        }
        self.mk(NodeKind::ExerciseSets, start, kids)
    }

    fn set(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        while let Some(tok) = self.lex(ITEM) {
            match tok.t {
                T::KwAuto => kids.push(self.leaf(NodeKind::Auto, tok)),
                T::At => kids.push(self.rpe(true)),
                T::SetTimer => kids.push(self.leaf(NodeKind::SetTimer, tok)),
                T::AskWeight => kids.push(self.leaf(NodeKind::AskWeight, tok)),
                T::LParen => kids.push(self.label()),
                T::Weight => {
                    let l = self.leaf(NodeKind::Weight, tok);
                    let mut c = vec![l];
                    c.extend(self.plus_next(true));
                    kids.push(self.mk(NodeKind::WeightWithPlus, start_of(&c), c));
                }
                T::Percentage => {
                    let l = self.leaf(NodeKind::Percentage, tok);
                    let mut c = vec![l];
                    c.extend(self.plus_next(true));
                    kids.push(self.mk(NodeKind::PercentageWithPlus, start_of(&c), c));
                }
                _ => kids.push(self.int_item()),
            }
        }
        if kids.is_empty() {
            return self.err();
        }
        self.mk(NodeKind::ExerciseSet, start, kids)
    }

    fn label(&mut self) -> Node {
        let start = self.next_start();
        if let Some(t) = self.lex(&[T::LParen]) {
            self.take(t);
        }
        let mut kids = Vec::new();
        loop {
            match self.lex(&[T::NonSep, T::RParen]) {
                Some(t) if t.t == T::NonSep => kids.push(self.leaf(NodeKind::NonSeparator, t)),
                Some(t) => {
                    if kids.is_empty() {
                        kids.push(self.err());
                    }
                    self.take(t);
                    break;
                }
                None => {
                    kids.push(self.err());
                    break;
                }
            }
        }
        self.mk(NodeKind::SetLabel, start, kids)
    }

    /// An item starting with an Int: Timer or SetPart.
    fn int_item(&mut self) -> Node {
        let start = self.next_start();
        let rep = self.rep_or_err();
        let tok = self.lex(&[T::LetterX, T::LetterS, T::Plus]);
        let Some(tok) = tok else {
            let e = self.err();
            return self.mk(NodeKind::SetPart, start, vec![rep, e]);
        };
        if tok.t == T::LetterS {
            self.take(tok);
            let int = rep.children.into_iter().next();
            return self.mk(NodeKind::Timer, start, int.into_iter().collect());
        }
        let mut kids = vec![rep];
        if tok.t == T::Plus {
            kids.push(self.leaf(NodeKind::Plus, tok));
        }
        match self.lex(&[T::LetterX]) {
            Some(x) => self.take(x),
            None => {
                kids.push(self.err());
                return self.mk(NodeKind::SetPart, start, kids);
            }
        }
        let rs = self.next_start();
        match self.rep() {
            Some(r) => {
                if let Some(d) = self.lex2(&[T::Dash], ITEM) {
                    if d.t == T::Dash {
                        self.take(d);
                        let r2 = self.rep_or_err();
                        kids.push(self.mk(NodeKind::RepRange, rs, vec![r, r2]));
                    } else {
                        kids.push(r);
                    }
                } else {
                    kids.push(r);
                }
            }
            None => kids.push(self.err()),
        }
        kids.extend(self.plus_next(true));
        self.mk(NodeKind::SetPart, start, kids)
    }

    fn warmup_sets(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = vec![self.warmup_set()];
        while let Some(t) = self.lex(&[T::Comma]) {
            self.take(t);
            kids.push(self.warmup_set());
        }
        self.mk(NodeKind::WarmupExerciseSets, start, kids)
    }

    fn warmup_set(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = Vec::new();
        while let Some(tok) = self.lex(&[T::Weight, T::Percentage, T::Int]) {
            match tok.t {
                T::Weight => kids.push(self.leaf(NodeKind::Weight, tok)),
                T::Percentage => kids.push(self.leaf(NodeKind::Percentage, tok)),
                _ => kids.push(self.warmup_part()),
            }
        }
        if kids.is_empty() {
            return self.err();
        }
        self.mk(NodeKind::WarmupExerciseSet, start, kids)
    }

    fn warmup_part(&mut self) -> Node {
        let start = self.next_start();
        let mut kids = vec![self.rep_or_err()];
        if let Some(x) = self.lex(&[T::LetterX]) {
            self.take(x);
            kids.push(self.rep_or_err());
        }
        self.mk(NodeKind::WarmupSetPart, start, kids)
    }
}

fn start_of(children: &[Node]) -> usize {
    children.first().map_or(0, |c| c.from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn golden_dir() -> PathBuf {
        let root = std::env::var("QALA_GOLDEN_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
        root.join("testdata/golden/liftoscript/lezer_trees")
    }

    fn read_json(path: &std::path::Path) -> serde_json::Value {
        let text = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("bad json {}: {e}", path.display()))
    }

    fn json_files(dir: &std::path::Path) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("cannot list {}: {e}", dir.display()))
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect();
        files.sort();
        files
    }

    fn check(input: &str, want: &serde_json::Value, label: &str) {
        let want_node = Node::from_json(want).unwrap_or_else(|| panic!("{label}: bad tree json"));
        let got = parse(input);
        assert!(
            got == want_node,
            "{label}: tree mismatch for input {input:?}\n got {}\nwant {want}",
            got.to_json()
        );
    }

    #[test]
    fn golden_whole_programs() {
        let files = json_files(&golden_dir().join("planner"));
        assert_eq!(files.len(), 60, "expected 60 builtin program trees");
        for f in files {
            let v = read_json(&f);
            let input = v["input"].as_str().expect("input");
            check(input, &v["tree"], &f.display().to_string());
        }
    }

    #[test]
    fn golden_planner_calls() {
        let files = json_files(&golden_dir().join("planner_calls"));
        assert_eq!(files.len(), 60, "expected 60 planner_calls files");
        let mut n = 0;
        for f in files {
            let v = read_json(&f);
            for (i, e) in v.as_array().expect("array").iter().enumerate() {
                let input = e["input"].as_str().expect("input");
                check(input, &e["tree"], &format!("{}[{i}]", f.display()));
                n += 1;
            }
        }
        assert!(n > 100, "suspiciously few planner_calls entries: {n}");
    }

    #[test]
    fn golden_fuzz() {
        let v = read_json(&golden_dir().join("planner_fuzz.json"));
        let cases = v.as_array().expect("array");
        assert!(cases.len() >= 300, "expected a few hundred fuzz cases");
        for (i, e) in cases.iter().enumerate() {
            let input = e["input"].as_str().expect("input");
            check(input, &e["tree"], &format!("planner_fuzz[{i}]"));
        }
    }

    #[test]
    fn utf16_offsets_and_values() {
        let text = "Ångström 日本 😀 / 3x5\n";
        let tree = parse(text);
        let expr = tree.first_child().expect("expression");
        assert_eq!(expr.kind, NodeKind::ExerciseExpression);
        let sep = expr
            .get_child(NodeKind::SectionSeparator)
            .expect("separator");
        assert_eq!(get_value(text, sep), "/");
        // The emoji is two UTF-16 units, so offsets differ from char offsets.
        assert_eq!(
            sep.from,
            text.encode_utf16().position(|c| c == b'/' as u16).unwrap()
        );
        let names = expr
            .first_child()
            .and_then(|v| v.first_child())
            .and_then(|v| v.get_child(NodeKind::ExerciseName))
            .expect("name");
        assert_eq!(get_value(text, names), "Ångström 日本 😀");
        assert_eq!(slice16(text, 0, 2), "Ån");
    }

    #[test]
    fn navigation_helpers() {
        let text = "Squat / 3x5 / superset: Bench\n";
        let tree = parse(text);
        let expr = tree.first_child().expect("expression");
        let sections = expr.get_children(NodeKind::ExerciseSection);
        assert_eq!(sections.len(), 2);
        let first_sep = expr.get_child(NodeKind::SectionSeparator).expect("sep");
        assert_eq!(
            first_sep.next_sibling(expr).map(|n| n.kind),
            Some(NodeKind::ExerciseSection)
        );
        assert!(NodeKind::from_name("⚠") == Some(NodeKind::Error));
        assert_eq!(NodeKind::Superset.name(), "Superset");
    }

    #[test]
    fn bad_input_does_not_panic() {
        let inputs = [
            "",
            " ",
            "\n",
            "/",
            "//",
            "[",
            "]",
            "{~",
            "{~ x",
            "(((",
            "...",
            "!",
            "|",
            "\\",
            "\\\n",
            "Squat / (",
            "Squat / x:",
            "Squat / x: lp(",
            "Squat / x: lp(1,",
            "Squat / 3x",
            "Squat / @",
            "Squat / 3x5 / / /",
            "A[",
            "A[1",
            "A[1-",
            "A / ...B[",
            "A / ...B[1:",
            "A / x: lp {...",
            "A / 90s|",
            "\u{0}\u{1}",
            "😀",
            "A / 😀x5",
            "A / ?+?+",
            "x: none",
        ];
        for t in inputs {
            let tree = parse(t);
            assert_eq!(tree.kind, NodeKind::Program);
            assert_eq!(tree.to, t.encode_utf16().count());
        }
        assert!(parse("Squat / 3x").has_error());
        assert!(!parse("Squat / 3x5\n").has_error());
    }
}
