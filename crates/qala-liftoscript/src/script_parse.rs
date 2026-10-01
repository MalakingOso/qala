//! Hand-written lexer and parser for the liftoscript script language.
//!
//! The output is a generic tree that mirrors the Lezer tree produced by
//! `packages/liftoscript/liftoscript.grammar`, so the evaluator can be ported
//! mechanically on top of it. Offsets are UTF-16 code units, matching JS string
//! indices. Most scripts are ASCII, where they equal byte offsets.
//!
//! Tree shape notes (all verified against the Lezer parser):
//! - Anonymous tokens (`(`, `)`, `{`, `}`, `[`, `]`, `:`, `?`, `,`, `.`, `=`, `in`,
//!   `if`, `else`, `for`, `;`, `{~`, `~}`) never appear as nodes, only widen their parent.
//! - `LineComment` is the only skipped token that appears. It is placed in the
//!   innermost node whose range contains it; comments after a node's last token
//!   fall outside it.
//! - Tokenization follows Lezer's precedence rule: `state`, `var.<name>`, `lb` and
//!   `kg` win over a longer Keyword match, so `statement` lexes as `state` + `ment`
//!   and `lbs` as `lb` + `s`.
//! - Error recovery is best effort. Valid input is exact; invalid input produces
//!   `Error` nodes whose shape may differ from Lezer's.

/// Tree node kinds. One per Lezer node name the grammar can emit, plus `Error`
/// for Lezer's error node (name `⚠`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NodeKind {
    Program,
    BinaryExpression,
    NumberExpression,
    WeightExpression,
    Percentage,
    ParenthesisExpression,
    BlockExpression,
    Ternary,
    IfExpression,
    ForExpression,
    ForInExpression,
    AssignmentExpression,
    IncAssignmentExpression,
    BuiltinFunctionExpression,
    VariableExpression,
    StateVariable,
    Variable,
    UnaryExpression,
    VariableIndex,
    StateVariableIndex,
    Wildcard,
    Keyword,
    StateKeyword,
    Unit,
    Number,
    Plus,
    Times,
    Cmp,
    AndOr,
    Not,
    IncAssignment,
    LineComment,
    Error,
}

impl NodeKind {
    /// The Lezer node name, as the TS `NodeName` enum spells it.
    pub fn name(self) -> &'static str {
        match self {
            NodeKind::Program => "Program",
            NodeKind::BinaryExpression => "BinaryExpression",
            NodeKind::NumberExpression => "NumberExpression",
            NodeKind::WeightExpression => "WeightExpression",
            NodeKind::Percentage => "Percentage",
            NodeKind::ParenthesisExpression => "ParenthesisExpression",
            NodeKind::BlockExpression => "BlockExpression",
            NodeKind::Ternary => "Ternary",
            NodeKind::IfExpression => "IfExpression",
            NodeKind::ForExpression => "ForExpression",
            NodeKind::ForInExpression => "ForInExpression",
            NodeKind::AssignmentExpression => "AssignmentExpression",
            NodeKind::IncAssignmentExpression => "IncAssignmentExpression",
            NodeKind::BuiltinFunctionExpression => "BuiltinFunctionExpression",
            NodeKind::VariableExpression => "VariableExpression",
            NodeKind::StateVariable => "StateVariable",
            NodeKind::Variable => "Variable",
            NodeKind::UnaryExpression => "UnaryExpression",
            NodeKind::VariableIndex => "VariableIndex",
            NodeKind::StateVariableIndex => "StateVariableIndex",
            NodeKind::Wildcard => "Wildcard",
            NodeKind::Keyword => "Keyword",
            NodeKind::StateKeyword => "StateKeyword",
            NodeKind::Unit => "Unit",
            NodeKind::Number => "Number",
            NodeKind::Plus => "Plus",
            NodeKind::Times => "Times",
            NodeKind::Cmp => "Cmp",
            NodeKind::AndOr => "AndOr",
            NodeKind::Not => "Not",
            NodeKind::IncAssignment => "IncAssignment",
            NodeKind::LineComment => "LineComment",
            NodeKind::Error => "⚠",
        }
    }

    /// Inverse of `name`. Returns `None` for names this grammar never emits.
    pub fn from_name(name: &str) -> Option<NodeKind> {
        ALL_KINDS.iter().copied().find(|k| k.name() == name)
    }
}

const ALL_KINDS: [NodeKind; 33] = [
    NodeKind::Program,
    NodeKind::BinaryExpression,
    NodeKind::NumberExpression,
    NodeKind::WeightExpression,
    NodeKind::Percentage,
    NodeKind::ParenthesisExpression,
    NodeKind::BlockExpression,
    NodeKind::Ternary,
    NodeKind::IfExpression,
    NodeKind::ForExpression,
    NodeKind::ForInExpression,
    NodeKind::AssignmentExpression,
    NodeKind::IncAssignmentExpression,
    NodeKind::BuiltinFunctionExpression,
    NodeKind::VariableExpression,
    NodeKind::StateVariable,
    NodeKind::Variable,
    NodeKind::UnaryExpression,
    NodeKind::VariableIndex,
    NodeKind::StateVariableIndex,
    NodeKind::Wildcard,
    NodeKind::Keyword,
    NodeKind::StateKeyword,
    NodeKind::Unit,
    NodeKind::Number,
    NodeKind::Plus,
    NodeKind::Times,
    NodeKind::Cmp,
    NodeKind::AndOr,
    NodeKind::Not,
    NodeKind::IncAssignment,
    NodeKind::LineComment,
    NodeKind::Error,
];

/// A syntax tree node. `from` and `to` are UTF-16 code unit offsets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub kind: NodeKind,
    pub from: usize,
    pub to: usize,
    pub children: Vec<Node>,
}

impl Node {
    fn leaf(kind: NodeKind, from: usize, to: usize) -> Node {
        Node {
            kind,
            from,
            to,
            children: Vec::new(),
        }
    }

    /// Build a node spanning its first to last child, widened by `from`/`to` bounds.
    fn branch(kind: NodeKind, from: usize, to: usize, children: Vec<Node>) -> Node {
        Node {
            kind,
            from,
            to,
            children,
        }
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
    pub fn child(&self, kind: NodeKind) -> Option<&Node> {
        self.children.iter().find(|c| c.kind == kind)
    }

    /// All children of the given kind (Lezer `getChildren`).
    pub fn children_of(&self, kind: NodeKind) -> Vec<&Node> {
        self.children.iter().filter(|c| c.kind == kind).collect()
    }

    /// The sibling after `self` within `parent`, found by identity.
    pub fn next_sibling<'a>(&self, parent: &'a Node) -> Option<&'a Node> {
        let idx = parent.children.iter().position(|c| std::ptr::eq(c, self))?;
        parent.children.get(idx + 1)
    }

    /// The sibling before `self` within `parent`, found by identity.
    pub fn prev_sibling<'a>(&self, parent: &'a Node) -> Option<&'a Node> {
        let idx = parent.children.iter().position(|c| std::ptr::eq(c, self))?;
        idx.checked_sub(1).and_then(|i| parent.children.get(i))
    }

    /// Pre-order traversal including `self`, the order a Lezer cursor visits
    /// with repeated `cursor.next()`.
    pub fn descendants(&self) -> Vec<&Node> {
        let mut out = Vec::new();
        self.collect(&mut out);
        out
    }

    fn collect<'a>(&'a self, out: &mut Vec<&'a Node>) {
        out.push(self);
        for c in &self.children {
            c.collect(out);
        }
    }

    /// Pre-order traversal yielding each node with its parent (`None` for `self`).
    pub fn descendants_with_parent(&self) -> Vec<(&Node, Option<&Node>)> {
        let mut out = Vec::new();
        self.collect_parent(None, &mut out);
        out
    }

    fn collect_parent<'a>(
        &'a self,
        parent: Option<&'a Node>,
        out: &mut Vec<(&'a Node, Option<&'a Node>)>,
    ) {
        out.push((self, parent));
        for c in &self.children {
            c.collect_parent(Some(self), out);
        }
    }

    /// The source text covered by this node (the TS `script.slice(from, to)`).
    pub fn get_value(&self, script: &str) -> String {
        slice_utf16(script, self.from, self.to)
    }
}

/// Free-function form of `Node::get_value`.
pub fn get_value(script: &str, node: &Node) -> String {
    node.get_value(script)
}

/// Slice `script` by UTF-16 code unit offsets like JS `String.prototype.slice`
/// for non-negative in-range arguments. Offsets are clamped. A cut inside a
/// surrogate pair yields U+FFFD for the lone half, which JS would keep as a lone
/// surrogate (not representable in a Rust `String`).
pub fn slice_utf16(script: &str, from: usize, to: usize) -> String {
    if script.is_ascii() {
        let to = to.min(script.len());
        let from = from.min(to);
        return script[from..to].to_string();
    }
    let units: Vec<u16> = script.encode_utf16().collect();
    let to = to.min(units.len());
    let from = from.min(to);
    String::from_utf16_lossy(&units[from..to])
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tk {
    Keyword,
    StateKeyword,
    Variable,
    Unit,
    Number,
    Percentage,
    Plus,
    Times,
    Cmp,
    AndOr,
    Not,
    IncAssign,
    Assign,
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBrack,
    RBrack,
    Colon,
    Question,
    Comma,
    Dot,
    If,
    Else,
    For,
    Unknown,
    Eof,
}

#[derive(Debug, Clone, Copy)]
struct Tok {
    kind: Tk,
    from: usize,
    to: usize,
}

fn is_ws(u: u16) -> bool {
    matches!(
        u,
        0x09..=0x0d
            | 0x20
            | 0xa0
            | 0x1680
            | 0x2000..=0x200a
            | 0x2028
            | 0x2029
            | 0x202f
            | 0x205f
            | 0x3000
            | 0xfeff
    )
}

fn is_letter(u: u16) -> bool {
    matches!(u, 0x41..=0x5a | 0x61..=0x7a)
}

fn is_digit(u: u16) -> bool {
    matches!(u, 0x30..=0x39)
}

fn is_word(u: u16) -> bool {
    is_letter(u) || is_digit(u) || u == b'_' as u16
}

fn starts_with(src: &[u16], at: usize, lit: &str) -> bool {
    let b = lit.as_bytes();
    at + b.len() <= src.len() && b.iter().enumerate().all(|(i, &c)| src[at + i] == c as u16)
}

/// Lex the whole input. Returns the non-skipped tokens plus the comments.
fn lex(src: &[u16]) -> (Vec<Tok>, Vec<Node>) {
    let mut toks = Vec::new();
    let mut comments = Vec::new();
    let n = src.len();
    let mut i = 0;
    let at = |i: usize| -> u16 {
        if i < n {
            src[i]
        } else {
            0
        }
    };
    while i < n {
        let c = src[i];
        if is_ws(c) || c == b';' as u16 {
            i += 1;
            continue;
        }
        if starts_with(src, i, "{~") || starts_with(src, i, "~}") {
            i += 2;
            continue;
        }
        if starts_with(src, i, "//") {
            let start = i;
            while i < n && src[i] != b'\n' as u16 {
                i += 1;
            }
            comments.push(Node::leaf(NodeKind::LineComment, start, i));
            continue;
        }
        let start = i;
        if is_letter(c) {
            let mut j = i;
            while j < n && is_word(src[j]) {
                j += 1;
            }
            let word_end = j;
            let (kind, end) = if starts_with(src, i, "state") {
                (Tk::StateKeyword, i + 5)
            } else if word_end == i + 3
                && starts_with(src, i, "var")
                && at(word_end) == b'.' as u16
                && is_letter(at(word_end + 1))
            {
                let mut k = word_end + 1;
                while k < n && is_word(src[k]) {
                    k += 1;
                }
                (Tk::Variable, k)
            } else if starts_with(src, i, "lb") || starts_with(src, i, "kg") {
                (Tk::Unit, i + 2)
            } else {
                let kind = if starts_with(src, i, "if") && word_end == i + 2 {
                    Tk::If
                } else if starts_with(src, i, "else") && word_end == i + 4 {
                    Tk::Else
                } else if starts_with(src, i, "for") && word_end == i + 3 {
                    Tk::For
                } else {
                    Tk::Keyword
                };
                (kind, word_end)
            };
            toks.push(Tok {
                kind,
                from: start,
                to: end,
            });
            i = end;
            continue;
        }
        if is_digit(c) || (c == b'.' as u16 && is_digit(at(i + 1))) {
            let mut j = i;
            if is_digit(c) {
                while j < n && is_digit(src[j]) {
                    j += 1;
                }
                if at(j) == b'.' as u16 && !is_digit(at(j + 1)) {
                    // trailing dot form `5.`
                    j += 1;
                }
            }
            while at(j) == b'.' as u16 && is_digit(at(j + 1)) {
                j += 1;
                while j < n && is_digit(src[j]) {
                    j += 1;
                }
            }
            if at(j) == b'%' as u16 {
                toks.push(Tok {
                    kind: Tk::Percentage,
                    from: start,
                    to: j + 1,
                });
                i = j + 1;
            } else {
                toks.push(Tok {
                    kind: Tk::Number,
                    from: start,
                    to: j,
                });
                i = j;
            }
            continue;
        }
        let two = |a: u8, b: u8| c == a as u16 && at(i + 1) == b as u16;
        let (kind, len) =
            if two(b'+', b'=') || two(b'-', b'=') || two(b'*', b'=') || two(b'/', b'=') {
                (Tk::IncAssign, 2)
            } else if two(b'=', b'=') || two(b'!', b'=') || two(b'>', b'=') || two(b'<', b'=') {
                (Tk::Cmp, 2)
            } else if two(b'&', b'&') || two(b'|', b'|') {
                (Tk::AndOr, 2)
            } else {
                match u8::try_from(c).ok() {
                    Some(b'+') | Some(b'-') => (Tk::Plus, 1),
                    Some(b'*') | Some(b'/') | Some(b'%') => (Tk::Times, 1),
                    Some(b'>') | Some(b'<') => (Tk::Cmp, 1),
                    Some(b'!') => (Tk::Not, 1),
                    Some(b'=') => (Tk::Assign, 1),
                    Some(b'(') => (Tk::LParen, 1),
                    Some(b')') => (Tk::RParen, 1),
                    Some(b'{') => (Tk::LBrace, 1),
                    Some(b'}') => (Tk::RBrace, 1),
                    Some(b'[') => (Tk::LBrack, 1),
                    Some(b']') => (Tk::RBrack, 1),
                    Some(b':') => (Tk::Colon, 1),
                    Some(b'?') => (Tk::Question, 1),
                    Some(b',') => (Tk::Comma, 1),
                    Some(b'.') => (Tk::Dot, 1),
                    _ => {
                        let astral =
                            (0xd800..0xdc00).contains(&c) && (0xdc00..0xe000).contains(&at(i + 1));
                        (Tk::Unknown, if astral { 2 } else { 1 })
                    }
                }
            };
        match toks.last_mut() {
            Some(prev) if kind == Tk::Unknown && prev.kind == Tk::Unknown && prev.to == start => {
                prev.to = start + len
            }
            _ => toks.push(Tok {
                kind,
                from: start,
                to: start + len,
            }),
        }
        i += len;
    }
    toks.push(Tok {
        kind: Tk::Eof,
        from: n,
        to: n,
    });
    (toks, comments)
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

struct Parser<'a> {
    src: &'a [u16],
    toks: Vec<Tok>,
    p: usize,
    depth: usize,
}

/// Nesting limit so hostile input cannot overflow the stack.
const MAX_DEPTH: usize = 200;

const PREC_TERNARY: u8 = 1;

fn binary_prec(t: Tk) -> Option<u8> {
    match t {
        Tk::AndOr => Some(2),
        Tk::Cmp => Some(3),
        Tk::Plus => Some(4),
        Tk::Times => Some(5),
        _ => None,
    }
}

fn binary_kind(t: Tk) -> NodeKind {
    match t {
        Tk::AndOr => NodeKind::AndOr,
        Tk::Cmp => NodeKind::Cmp,
        Tk::Plus => NodeKind::Plus,
        _ => NodeKind::Times,
    }
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Tok {
        self.toks[self.p.min(self.toks.len() - 1)]
    }

    fn peek_at(&self, off: usize) -> Tok {
        self.toks[(self.p + off).min(self.toks.len() - 1)]
    }

    fn bump(&mut self) -> Tok {
        let t = self.peek();
        if t.kind != Tk::Eof {
            self.p += 1;
        }
        t
    }

    fn eat(&mut self, k: Tk) -> Option<Tok> {
        if self.peek().kind == k {
            Some(self.bump())
        } else {
            None
        }
    }

    fn text_is(&self, t: Tok, lit: &str) -> bool {
        t.to - t.from == lit.len() && starts_with(self.src, t.from, lit)
    }

    /// A zero-width error node at the end of the last consumed token, which is
    /// where Lezer places the error for a missing piece.
    fn missing(&self) -> Node {
        let at = if self.p == 0 {
            0
        } else {
            self.toks[(self.p - 1).min(self.toks.len() - 1)].to
        };
        Node::leaf(NodeKind::Error, at, at)
    }

    fn err_leaf(t: Tok) -> Node {
        Node::leaf(NodeKind::Error, t.from, t.to)
    }

    fn is_closer(k: Tk) -> bool {
        matches!(
            k,
            Tk::RParen | Tk::RBrace | Tk::RBrack | Tk::Comma | Tk::Colon | Tk::Eof
        )
    }

    /// Wrap children into a node, spanning `start` to the end of the last
    /// consumed token or child, whichever is further. A node closed by error
    /// recovery (a zero-width error child) extends to the start of the next
    /// token, as Lezer's does.
    fn finish(&self, kind: NodeKind, start: usize, end: usize, children: Vec<Node>) -> Node {
        let mut end = children.iter().map(|c| c.to).fold(end, usize::max);
        if children
            .iter()
            .any(|c| c.kind == NodeKind::Error && c.from == c.to)
        {
            end = end.max(self.peek().from);
        }
        Node::branch(kind, start, end, children)
    }

    fn parse_expr(&mut self, min: u8) -> Node {
        if self.depth >= MAX_DEPTH {
            // Consume a token as an error so callers still make progress.
            if Self::is_closer(self.peek().kind) {
                return self.missing();
            }
            let t = self.bump();
            return Self::err_leaf(t);
        }
        self.depth += 1;
        let node = self.parse_expr_inner(min);
        self.depth -= 1;
        node
    }

    fn parse_expr_inner(&mut self, min: u8) -> Node {
        let mut left = self.parse_primary();
        loop {
            let t = self.peek();
            if let Some(prec) = binary_prec(t.kind) {
                if prec < min {
                    break;
                }
                self.bump();
                let op = Node::leaf(binary_kind(t.kind), t.from, t.to);
                let rhs = self.parse_expr(prec + 1);
                let from = left.from;
                left = self.finish(NodeKind::BinaryExpression, from, 0, vec![left, op, rhs]);
            } else if t.kind == Tk::Question && min <= PREC_TERNARY {
                self.bump();
                let mid = self.parse_expr(0);
                if self.eat(Tk::Colon).is_none() {
                    let m = self.missing();
                    let from = left.from;
                    left = self.finish(NodeKind::Ternary, from, 0, vec![left, mid, m]);
                    continue;
                }
                let els = self.parse_expr(PREC_TERNARY);
                let from = left.from;
                left = self.finish(NodeKind::Ternary, from, 0, vec![left, mid, els]);
            } else {
                break;
            }
        }
        left
    }

    fn parse_primary(&mut self) -> Node {
        let t = self.peek();
        match t.kind {
            Tk::Plus => {
                self.bump();
                let mut kids = vec![Node::leaf(NodeKind::Plus, t.from, t.to)];
                let n = self.peek();
                if n.kind == Tk::Number {
                    self.bump();
                    kids.push(Node::leaf(NodeKind::Number, n.from, n.to));
                } else {
                    kids.push(self.missing());
                }
                let num = self.finish(NodeKind::NumberExpression, t.from, t.to, kids);
                self.maybe_weight(num)
            }
            Tk::Number => {
                self.bump();
                let num = Node::branch(
                    NodeKind::NumberExpression,
                    t.from,
                    t.to,
                    vec![Node::leaf(NodeKind::Number, t.from, t.to)],
                );
                self.maybe_weight(num)
            }
            Tk::Percentage => {
                self.bump();
                Node::leaf(NodeKind::Percentage, t.from, t.to)
            }
            Tk::LParen => self.parse_paren(),
            Tk::LBrace => self.parse_block(),
            Tk::If => self.parse_if(),
            Tk::For => self.parse_for(),
            Tk::Not => {
                self.bump();
                if self.depth >= MAX_DEPTH {
                    return Self::err_leaf(t);
                }
                self.depth += 1;
                let operand = self.parse_primary();
                self.depth -= 1;
                self.finish(
                    NodeKind::UnaryExpression,
                    t.from,
                    t.to,
                    vec![Node::leaf(NodeKind::Not, t.from, t.to), operand],
                )
            }
            Tk::Keyword => {
                if self.peek_at(1).kind == Tk::LParen {
                    self.parse_call()
                } else {
                    let v = self.parse_variable_expression();
                    self.maybe_assign(v)
                }
            }
            Tk::Variable => {
                self.bump();
                let v = Node::leaf(NodeKind::Variable, t.from, t.to);
                self.maybe_assign(v)
            }
            Tk::StateKeyword => {
                let s = self.parse_state_variable();
                self.maybe_assign(s)
            }
            Tk::Eof => self.missing(),
            _ => {
                // Stray closers and operators become error leaves.
                self.bump();
                Self::err_leaf(t)
            }
        }
    }

    fn maybe_weight(&mut self, num: Node) -> Node {
        let u = self.peek();
        if u.kind == Tk::Unit {
            self.bump();
            let from = num.from;
            Node::branch(
                NodeKind::WeightExpression,
                from,
                u.to,
                vec![num, Node::leaf(NodeKind::Unit, u.from, u.to)],
            )
        } else {
            num
        }
    }

    fn maybe_assign(&mut self, lhs: Node) -> Node {
        let t = self.peek();
        match t.kind {
            Tk::Assign => {
                self.bump();
                let rhs = self.parse_expr(0);
                let from = lhs.from;
                self.finish(NodeKind::AssignmentExpression, from, t.to, vec![lhs, rhs])
            }
            Tk::IncAssign => {
                self.bump();
                let rhs = self.parse_expr(0);
                let from = lhs.from;
                self.finish(
                    NodeKind::IncAssignmentExpression,
                    from,
                    t.to,
                    vec![lhs, Node::leaf(NodeKind::IncAssignment, t.from, t.to), rhs],
                )
            }
            _ => lhs,
        }
    }

    fn parse_variable_expression(&mut self) -> Node {
        let k = self.bump();
        let mut kids = vec![Node::leaf(NodeKind::Keyword, k.from, k.to)];
        let mut end = k.to;
        if self.peek().kind == Tk::LBrack {
            self.bump();
            kids.push(self.parse_variable_index());
            while self.eat(Tk::Colon).is_some() {
                kids.push(self.parse_variable_index());
            }
            match self.eat(Tk::RBrack) {
                Some(r) => end = r.to,
                None => kids.push(self.missing()),
            }
        }
        // Lezer deletes a stray dot or unknown token inside the expression.
        while matches!(self.peek().kind, Tk::Dot | Tk::Unknown) {
            let t = self.bump();
            end = t.to;
            kids.push(Self::err_leaf(t));
        }
        self.finish(NodeKind::VariableExpression, k.from, end, kids)
    }

    fn parse_variable_index(&mut self) -> Node {
        let t = self.peek();
        if t.kind == Tk::Times && self.text_is(t, "*") {
            self.bump();
            return Node::branch(
                NodeKind::VariableIndex,
                t.from,
                t.to,
                vec![Node::leaf(NodeKind::Wildcard, t.from, t.to)],
            );
        }
        let e = self.parse_expr(0);
        Node::branch(NodeKind::VariableIndex, e.from, e.to, vec![e])
    }

    fn parse_state_variable(&mut self) -> Node {
        let s = self.bump();
        let mut kids = vec![Node::leaf(NodeKind::StateKeyword, s.from, s.to)];
        let mut end = s.to;
        if self.peek().kind == Tk::LBrack {
            self.bump();
            let e = self.parse_expr(0);
            kids.push(Node::branch(
                NodeKind::StateVariableIndex,
                e.from,
                e.to,
                vec![e],
            ));
            match self.eat(Tk::RBrack) {
                Some(r) => end = r.to,
                None => kids.push(self.missing()),
            }
        }
        if let Some(d) = self.eat(Tk::Dot) {
            end = d.to;
        } else {
            kids.push(self.missing());
        }
        match self.eat(Tk::Keyword) {
            Some(k) => {
                end = k.to;
                kids.push(Node::leaf(NodeKind::Keyword, k.from, k.to));
            }
            None => kids.push(self.missing()),
        }
        self.finish(NodeKind::StateVariable, s.from, end, kids)
    }

    fn parse_call(&mut self) -> Node {
        let k = self.bump();
        let mut kids = vec![Node::leaf(NodeKind::Keyword, k.from, k.to)];
        let lp = self.bump();
        let mut end = lp.to;
        if !matches!(self.peek().kind, Tk::RParen | Tk::Comma | Tk::Eof) {
            kids.push(self.parse_expr(0));
        }
        loop {
            let t = self.peek();
            match t.kind {
                Tk::RParen => {
                    self.bump();
                    end = t.to;
                    break;
                }
                Tk::Eof => {
                    kids.push(self.missing());
                    break;
                }
                Tk::Comma => {
                    self.bump();
                    if matches!(self.peek().kind, Tk::RParen | Tk::Comma | Tk::Eof) {
                        kids.push(self.missing());
                    } else {
                        kids.push(self.parse_expr(0));
                    }
                }
                _ => {
                    // Stray token between arguments.
                    self.bump();
                    kids.push(Self::err_leaf(t));
                }
            }
        }
        self.finish(NodeKind::BuiltinFunctionExpression, k.from, end, kids)
    }

    fn parse_paren(&mut self) -> Node {
        let lp = self.bump();
        let mut kids = Vec::new();
        let mut end = lp.to;
        if matches!(self.peek().kind, Tk::RParen | Tk::Eof) {
            kids.push(self.missing());
        } else {
            kids.push(self.parse_expr(0));
        }
        loop {
            let t = self.peek();
            match t.kind {
                Tk::RParen => {
                    self.bump();
                    end = t.to;
                    break;
                }
                Tk::Eof => {
                    kids.push(self.missing());
                    break;
                }
                _ => {
                    self.bump();
                    kids.push(Self::err_leaf(t));
                }
            }
        }
        self.finish(NodeKind::ParenthesisExpression, lp.from, end, kids)
    }

    fn parse_block(&mut self) -> Node {
        let lb = self.bump();
        let mut kids = Vec::new();
        let mut end = lb.to;
        loop {
            let t = self.peek();
            match t.kind {
                Tk::RBrace => {
                    self.bump();
                    end = t.to;
                    break;
                }
                Tk::Eof => {
                    kids.push(self.missing());
                    break;
                }
                k if Self::is_closer(k) => {
                    self.bump();
                    kids.push(Self::err_leaf(t));
                }
                _ => kids.push(self.parse_expr(0)),
            }
        }
        self.finish(NodeKind::BlockExpression, lb.from, end, kids)
    }

    fn expect_paren(&mut self) -> Node {
        if self.peek().kind == Tk::LParen {
            self.parse_paren()
        } else {
            self.missing()
        }
    }

    fn expect_block(&mut self) -> Node {
        if self.peek().kind == Tk::LBrace {
            self.parse_block()
        } else {
            self.missing()
        }
    }

    fn parse_if(&mut self) -> Node {
        let kw = self.bump();
        let mut kids = vec![self.expect_paren(), self.expect_block()];
        while self.peek().kind == Tk::Else {
            if self.peek_at(1).kind == Tk::If {
                self.bump();
                self.bump();
                kids.push(self.expect_paren());
                kids.push(self.expect_block());
            } else {
                self.bump();
                kids.push(self.expect_block());
                break;
            }
        }
        self.finish(NodeKind::IfExpression, kw.from, kw.to, kids)
    }

    fn parse_for(&mut self) -> Node {
        let kw = self.bump();
        let mut kids = Vec::new();
        if self.peek().kind == Tk::LParen {
            self.bump();
        }
        let v = self.peek();
        if v.kind == Tk::Variable {
            self.bump();
            kids.push(Node::leaf(NodeKind::Variable, v.from, v.to));
        } else {
            kids.push(self.missing());
        }
        let inn = self.peek();
        if inn.kind == Tk::Keyword && self.text_is(inn, "in") {
            self.bump();
        }
        if Self::is_closer(self.peek().kind) {
            let m = self.missing();
            kids.push(Node::branch(
                NodeKind::ForInExpression,
                m.from,
                m.to,
                vec![m],
            ));
        } else {
            let e = self.parse_expr(0);
            kids.push(Node::branch(
                NodeKind::ForInExpression,
                e.from,
                e.to,
                vec![e],
            ));
        }
        self.eat(Tk::RParen);
        kids.push(self.expect_block());
        self.finish(NodeKind::ForExpression, kw.from, kw.to, kids)
    }

    fn parse_program(&mut self) -> Vec<Node> {
        let mut kids = Vec::new();
        loop {
            let t = self.peek();
            match t.kind {
                Tk::Eof => break,
                k if Self::is_closer(k) => {
                    self.bump();
                    kids.push(Self::err_leaf(t));
                }
                _ => kids.push(self.parse_expr(0)),
            }
        }
        kids
    }
}

/// Place a comment into the innermost node whose range contains it, keeping
/// children ordered by position.
fn insert_comment(node: &mut Node, c: Node) {
    if let Some(idx) = node
        .children
        .iter()
        .position(|ch| ch.from <= c.from && c.to <= ch.to && ch.to > ch.from)
    {
        insert_comment(&mut node.children[idx], c);
        return;
    }
    let pos = node
        .children
        .iter()
        .position(|ch| ch.from >= c.to)
        .unwrap_or(node.children.len());
    node.children.insert(pos, c);
}

/// Parse a liftoscript program. Never fails; bad input yields `Error` nodes.
/// The root is a `Program` node spanning the whole input.
pub fn parse(script: &str) -> Node {
    let src: Vec<u16> = script.encode_utf16().collect();
    let (toks, comments) = lex(&src);
    let mut parser = Parser {
        src: &src,
        toks,
        p: 0,
        depth: 0,
    };
    let children = parser.parse_program();
    let mut root = Node::branch(NodeKind::Program, 0, src.len(), children);
    for c in comments {
        insert_comment(&mut root, c);
    }
    root
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::PathBuf;

    fn golden_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../testdata/golden/liftoscript/lezer_trees")
    }

    fn dump(n: &Node) -> String {
        let mut s = format!("{}[{}-{}]", n.kind.name(), n.from, n.to);
        if !n.children.is_empty() {
            s.push('(');
            for (i, c) in n.children.iter().enumerate() {
                if i > 0 {
                    s.push(' ');
                }
                s.push_str(&dump(c));
            }
            s.push(')');
        }
        s
    }

    fn json_dump(v: &Value) -> Result<String, String> {
        let name = v.get("name").and_then(Value::as_str).ok_or("name")?;
        let from = v.get("from").and_then(Value::as_u64).ok_or("from")?;
        let to = v.get("to").and_then(Value::as_u64).ok_or("to")?;
        let mut s = format!("{name}[{from}-{to}]");
        let kids = v.get("children").and_then(Value::as_array);
        if let Some(kids) = kids {
            if !kids.is_empty() {
                s.push('(');
                for (i, c) in kids.iter().enumerate() {
                    if i > 0 {
                        s.push(' ');
                    }
                    s.push_str(&json_dump(c)?);
                }
                s.push(')');
            }
        }
        Ok(s)
    }

    /// Returns (checked, failures) for one golden file. Missing file is None.
    fn check_file(name: &str) -> Option<(usize, Vec<String>)> {
        let path = golden_dir().join(name);
        let text = std::fs::read_to_string(&path).ok()?;
        let v: Value = serde_json::from_str(&text).expect("golden json");
        let entries = v.as_array().expect("golden array");
        let mut fails = Vec::new();
        for e in entries {
            let input = e.get("input").and_then(Value::as_str).expect("input");
            let want = json_dump(e.get("tree").expect("tree")).expect("tree shape");
            let got = dump(&parse(input));
            if got != want {
                // Show the divergence point with context, not the whole tree.
                let at = want
                    .bytes()
                    .zip(got.bytes())
                    .take_while(|(a, b)| a == b)
                    .count();
                let lo = want.floor_char_boundary(at.saturating_sub(120));
                let lo_g = got.floor_char_boundary(at.saturating_sub(120));
                let hi = want.floor_char_boundary((at + 120).min(want.len()));
                let hi_g = got.floor_char_boundary((at + 120).min(got.len()));
                fails.push(format!(
                    "input: {input:?}\n want: ...{}\n  got: ...{}",
                    &want[lo..hi],
                    &got[lo_g..hi_g]
                ));
            }
        }
        Some((entries.len(), fails))
    }

    fn run_golden(name: &str, required: bool) {
        match check_file(name) {
            None => assert!(!required, "missing golden file {name}"),
            Some((n, fails)) => {
                assert!(
                    fails.is_empty(),
                    "{} of {n} failed in {name}; first:\n{}",
                    fails.len(),
                    fails.iter().take(3).cloned().collect::<Vec<_>>().join("\n")
                );
            }
        }
    }

    #[test]
    fn golden_scripts() {
        run_golden("scripts.json", true);
    }

    #[test]
    fn golden_scripts_extra() {
        run_golden("scripts_extra.json", true);
    }

    #[test]
    fn golden_scripts_fuzz() {
        run_golden("scripts_fuzz.json", true);
    }

    #[test]
    fn precedence_and_shape() {
        let t = parse("a + b * c ? d : e");
        assert_eq!(
            dump(&t),
            "Program[0-17](Ternary[0-17](BinaryExpression[0-9](VariableExpression[0-1](Keyword[0-1]) Plus[2-3] BinaryExpression[4-9](VariableExpression[4-5](Keyword[4-5]) Times[6-7] VariableExpression[8-9](Keyword[8-9]))) VariableExpression[12-13](Keyword[12-13]) VariableExpression[16-17](Keyword[16-17])))"
        );
    }

    #[test]
    fn utf16_offsets() {
        let s = "x = 1 // \u{1F600}é";
        let t = parse(s);
        assert_eq!(t.to, s.encode_utf16().count());
        let c = t.children.last().expect("comment");
        assert_eq!(c.kind, NodeKind::LineComment);
        assert_eq!(c.get_value(s), "// \u{1F600}é");
    }

    #[test]
    fn garbage_never_panics() {
        for s in [
            "",
            "(((",
            ")))",
            "if",
            "for (",
            "x[",
            "state[",
            "f(",
            "!",
            "x ? y",
            "{~",
            "\u{1F600}",
            "1 +",
            "}{",
            "x = ",
            "else",
        ] {
            let t = parse(s);
            assert_eq!(t.kind, NodeKind::Program);
        }
        let deep = "(".repeat(5000);
        let _ = parse(&deep);
        let deep = "!".repeat(5000);
        let _ = parse(&deep);
    }
}
