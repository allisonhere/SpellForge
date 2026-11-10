//! Lexical Lua analysis. The symbol and reference index is *lexical* (token based), not semantic: it is fast and
//! tolerant of broken files, and its limits are documented. Syntax errors come from a real parser (full_moon, Lua 5.1).
use crate::diag::{Confidence, Diagnostic, Severity};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokKind {
    Name,
    Str,
    Num,
    Punct,
}

#[derive(Debug, Clone)]
pub struct Tok {
    pub kind: TokKind,
    pub text: String,
    pub line: u32,
    pub col: u32,
}

pub fn tokenize(src: &str) -> Vec<Tok> {
    let b: Vec<char> = src.chars().collect();
    let mut toks = vec![];
    let (mut i, mut line, mut col) = (0usize, 1u32, 1u32);
    macro_rules! adv {
        () => {{
            if b[i] == '\n' {
                line += 1;
                col = 1;
            } else {
                col += 1;
            }
            i += 1;
        }};
    }
    // long bracket opener at b[i] == '[': returns level if `[=*[`
    let long_level = |b: &Vec<char>, i: usize| -> Option<usize> {
        if b.get(i) != Some(&'[') {
            return None;
        }
        let mut j = i + 1;
        let mut n = 0;
        while b.get(j) == Some(&'=') {
            n += 1;
            j += 1;
        }
        if b.get(j) == Some(&'[') { Some(n) } else { None }
    };
    while i < b.len() {
        let c = b[i];
        if c.is_whitespace() {
            adv!();
            continue;
        }
        let (sl, sc) = (line, col);
        if c == '-' && b.get(i + 1) == Some(&'-') {
            adv!();
            adv!();
            if let Some(n) = long_level(&b, i) {
                for _ in 0..(n + 2) {
                    adv!();
                }
                while i < b.len() {
                    if b[i] == ']' && (0..n).all(|k| b.get(i + 1 + k) == Some(&'=')) && b.get(i + 1 + n) == Some(&']') {
                        for _ in 0..(n + 2) {
                            adv!();
                        }
                        break;
                    }
                    adv!();
                }
            } else {
                while i < b.len() && b[i] != '\n' {
                    adv!();
                }
            }
            continue;
        }
        if c == '"' || c == '\'' {
            let q = c;
            let mut s = String::new();
            adv!();
            while i < b.len() && b[i] != q && b[i] != '\n' {
                if b[i] == '\\' && i + 1 < b.len() {
                    adv!();
                    s.push(b[i]);
                    adv!();
                    continue;
                }
                s.push(b[i]);
                adv!();
            }
            if i < b.len() && b[i] == q {
                adv!();
            }
            toks.push(Tok { kind: TokKind::Str, text: s, line: sl, col: sc });
            continue;
        }
        if let Some(n) = long_level(&b, i) {
            for _ in 0..(n + 2) {
                adv!();
            }
            let mut s = String::new();
            while i < b.len() {
                if b[i] == ']' && (0..n).all(|k| b.get(i + 1 + k) == Some(&'=')) && b.get(i + 1 + n) == Some(&']') {
                    for _ in 0..(n + 2) {
                        adv!();
                    }
                    break;
                }
                s.push(b[i]);
                adv!();
            }
            toks.push(Tok { kind: TokKind::Str, text: s, line: sl, col: sc });
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut s = String::new();
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == '_') {
                s.push(b[i]);
                adv!();
            }
            toks.push(Tok { kind: TokKind::Name, text: s, line: sl, col: sc });
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && b.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            let mut s = String::new();
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == '.') {
                s.push(b[i]);
                adv!();
            }
            toks.push(Tok { kind: TokKind::Num, text: s, line: sl, col: sc });
            continue;
        }
        let three = b.get(i..i + 3).map(|s| s.iter().collect::<String>());
        let two = b.get(i..i + 2).map(|s| s.iter().collect::<String>());
        let text = match (&three, &two) {
            (Some(t), _) if t == "..." => t.clone(),
            (_, Some(t)) if matches!(t.as_str(), "==" | "~=" | "<=" | ">=" | "..") => t.clone(),
            _ => c.to_string(),
        };
        for _ in 0..text.chars().count() {
            adv!();
        }
        toks.push(Tok { kind: TokKind::Punct, text, line: sl, col: sc });
    }
    toks
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub name: String,
    /// "function" | "method" | "table" | "variable"
    pub kind: String,
    pub scope: String,
    pub file: String,
    pub line: u32,
    pub col: u32,
}

#[derive(Debug, Clone)]
pub struct ApiRef {
    pub chain: String,
    pub line: u32,
    pub col: u32,
    pub is_call: bool,
    /// Whether the chain was preceded by `:` or `.` (a member of something unknown) — never resolved.
    pub is_member: bool,
}

pub struct EventReg {
    pub event: String,
    pub line: u32,
    pub col: u32,
}

#[derive(Default)]
pub struct Analysis {
    pub symbols: Vec<Symbol>,
    pub refs: Vec<ApiRef>,
    pub events: Vec<EventReg>,
    pub declared: BTreeSet<String>,
    pub strings: Vec<(String, u32, u32)>,
    /// Names assigned as globals in this file (`Foo = ...`, `function Foo()`), used to avoid false API warnings.
    pub globals_defined: BTreeSet<String>,
}

fn is_kw(s: &str) -> bool {
    matches!(
        s,
        "and" | "break" | "do" | "else" | "elseif" | "end" | "false" | "for" | "function" | "if" | "in" | "local" | "nil" | "not" | "or" | "repeat" | "return" | "then" | "true" | "until" | "while"
    )
}

pub fn analyze(file: &str, toks: &[Tok]) -> Analysis {
    let mut a = Analysis::default();
    let n = toks.len();
    let p = |i: usize, s: &str| toks.get(i).is_some_and(|t| t.kind == TokKind::Punct && t.text == s);
    let nm = |i: usize| toks.get(i).filter(|t| t.kind == TokKind::Name && !is_kw(&t.text));
    let kw = |i: usize, s: &str| toks.get(i).is_some_and(|t| t.kind == TokKind::Name && t.text == s);
    let mut depth_fn = 0i32; // crude: >0 inside a function body is not tracked; top-level = col 1 heuristic instead.
    let _ = &mut depth_fn;
    let mut i = 0;
    while i < n {
        let t = &toks[i];
        if t.kind == TokKind::Str {
            a.strings.push((t.text.clone(), t.line, t.col));
        }
        // declarations of locals / params / loop vars (to avoid flagging them as unknown globals)
        if kw(i, "local") {
            if kw(i + 1, "function") {
                if let Some(nt) = nm(i + 2) {
                    a.declared.insert(nt.text.clone());
                    a.symbols.push(Symbol { name: nt.text.clone(), kind: "function".into(), scope: "local".into(), file: file.into(), line: nt.line, col: nt.col });
                }
            } else {
                let mut j = i + 1;
                while let Some(nt) = nm(j) {
                    a.declared.insert(nt.text.clone());
                    if j == i + 1 && t.col == 1 {
                        let kind = if p(j + 1, "=") && p(j + 2, "{") { "table" } else if p(j + 1, "=") && kw(j + 2, "function") { "function" } else { "variable" };
                        a.symbols.push(Symbol { name: nt.text.clone(), kind: kind.into(), scope: "local".into(), file: file.into(), line: nt.line, col: nt.col });
                    }
                    j += 1;
                    if p(j, ",") { j += 1; } else { break; }
                }
            }
        } else if kw(i, "function") {
            let mut j = i + 1;
            let mut full = String::new();
            let mut method = false;
            let (l, c) = (toks.get(j).map_or(t.line, |x| x.line), toks.get(j).map_or(t.col, |x| x.col));
            while let Some(nt) = nm(j) {
                full.push_str(&nt.text);
                j += 1;
                if p(j, ".") { full.push('.'); j += 1; }
                else if p(j, ":") { full.push(':'); method = true; j += 1; }
                else { break; }
            }
            if !full.is_empty() {
                if !full.contains('.') && !full.contains(':') {
                    a.globals_defined.insert(full.clone());
                    a.declared.insert(full.clone());
                }
                let prior_local = i > 0 && kw(i - 1, "local");
                if !prior_local {
                    a.symbols.push(Symbol { name: full, kind: if method { "method" } else { "function" }.into(), scope: "global".into(), file: file.into(), line: l, col: c });
                }
            }
            // parameters
            if p(j, "(") {
                let mut k = j + 1;
                while k < n && !p(k, ")") {
                    if let Some(pt) = nm(k) { a.declared.insert(pt.text.clone()); }
                    k += 1;
                }
            }
            if method { a.declared.insert("self".into()); }
        } else if kw(i, "for") {
            let mut j = i + 1;
            while j < n && !kw(j, "in") && !p(j, "=") {
                if let Some(nt) = nm(j) { a.declared.insert(nt.text.clone()); }
                j += 1;
            }
        }
        // anonymous function params: `function(a, b)` (not preceded by name)
        if kw(i, "function") && p(i + 1, "(") {
            let mut k = i + 2;
            while k < n && !p(k, ")") {
                if let Some(pt) = nm(k) { a.declared.insert(pt.text.clone()); }
                k += 1;
            }
        }
        // chains: Name(.Name)* with context
        if t.kind == TokKind::Name && !is_kw(&t.text) {
            let prev_member = i > 0 && (p(i - 1, ".") || p(i - 1, ":"));
            let after_function_kw = i > 0 && kw(i - 1, "function");
            if !prev_member && !after_function_kw {
                let mut j = i;
                let mut chain = t.text.clone();
                while p(j + 1, ".") && nm(j + 2).is_some() {
                    chain.push('.');
                    chain.push_str(&nm(j + 2).unwrap().text);
                    j += 2;
                }
                let is_call = p(j + 1, "(") || toks.get(j + 1).is_some_and(|x| x.kind == TokKind::Str) && false;
                // global assignment `Foo = ...` / `Foo.bar = ...` at statement level
                if p(j + 1, "=") && !chain.contains('.') && !(i > 0 && (kw(i - 1, "local") || p(i - 1, ","))) {
                    a.globals_defined.insert(chain.clone());
                }
                if chain.contains('.') && p(j + 1, "=") && kw(j + 3, "function") {
                    a.symbols.push(Symbol { name: chain.clone(), kind: "function".into(), scope: "global".into(), file: file.into(), line: t.line, col: t.col });
                }
                a.refs.push(ApiRef { chain, line: t.line, col: t.col, is_call, is_member: false });
                // RegisterEvent("X") on method form handled below
            } else if prev_member && (t.text == "RegisterEvent" || t.text == "RegisterUnitEvent") && p(i + 1, "(") {
                if let Some(s) = toks.get(i + 2).filter(|x| x.kind == TokKind::Str) {
                    a.events.push(EventReg { event: s.text.clone(), line: s.line, col: s.col });
                }
            }
        }
        i += 1;
    }
    a
}

/// Real parser check. Returns diagnostics for syntax errors (relative `file` used for display).
pub fn syntax_check(file: &str, src: &str) -> Vec<Diagnostic> {
    match full_moon::parse(src) {
        Ok(_) => vec![],
        Err(errs) => errs
            .into_iter()
            .take(1) // later errors are usually cascades of the first
            .map(|e| {
                let (line, col) = match &e {
                    full_moon::Error::AstError(a) => {
                        let pos = a.token().start_position();
                        (pos.line() as u32, pos.character() as u32)
                    }
                    full_moon::Error::TokenizerError(t) => {
                        let pos = t.position();
                        (pos.line() as u32, pos.character() as u32)
                    }
                };
                Diagnostic::new(Severity::Error, "lua.syntax", e.to_string(), "lua", Confidence::Certain).at(file, line.max(1), col.max(1))
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_skips_comments_and_strings() {
        let src = "-- hi C_Foo.Bar()\nlocal s = \"C_Evil.Call()\" --[[ C_Block.X() ]] C_Real.Y(1)\n";
        let toks = tokenize(src);
        let a = analyze("t.lua", &toks);
        let chains: Vec<_> = a.refs.iter().map(|r| r.chain.as_str()).collect();
        assert!(chains.contains(&"C_Real.Y"));
        assert!(!chains.iter().any(|c| c.contains("Evil") || c.contains("Block") || c.contains("Foo")));
    }

    #[test]
    fn finds_symbols_and_events() {
        let src = "local M = {}\nfunction M:Update(x) end\nfunction Tempus_Global() end\nf:RegisterEvent(\"PLAYER_LOGIN\")\nTempusDB = {}\n";
        let a = analyze("a.lua", &tokenize(src));
        let names: Vec<_> = a.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"M") && names.contains(&"M:Update") && names.contains(&"Tempus_Global"));
        assert_eq!(a.events[0].event, "PLAYER_LOGIN");
        assert!(a.globals_defined.contains("TempusDB"));
        assert!(a.declared.contains("x"));
    }

    #[test]
    fn syntax_errors_are_located() {
        let d = syntax_check("bad.lua", "local x = \nfunction(\n");
        assert!(!d.is_empty() && d[0].line >= 1);
        assert!(syntax_check("ok.lua", "local t = {1,2}\nreturn t\n").is_empty());
    }
}
