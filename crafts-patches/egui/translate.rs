//! OfficeStudio: interface text translated where it is laid out.
//!
//! DeckCraft has no interface catalogs of its own yet, so its OfficeStudio build translates
//! every piece of text egui lays out whose whole content is a known interface string (`ru.tsv`:
//! `English<TAB>Russian`, built from the ArtCraft Russian catalogs plus OfficeStudio's own rows).
//! Text the user types (text edits) and the user's own content are laid out inside [`without`],
//! so they are never changed. Slides themselves are drawn as images by DeckCraft's renderer.

use std::cell::Cell;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::{ByteIndex, LayoutJob};

thread_local! {
    static OFF: Cell<u32> = const { Cell::new(0) };
}

/// Run `f` with translation off: everything it lays out keeps its exact text.
pub fn without<R>(f: impl FnOnce() -> R) -> R {
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            OFF.with(|c| c.set(c.get().saturating_sub(1)));
        }
    }
    OFF.with(|c| c.set(c.get().saturating_add(1)));
    let _guard = Guard;
    f()
}

const TSV: &str = include_str!("ru.tsv");

#[derive(Debug)]
enum Tok {
    Lit(&'static str),
    /// `{}`, `{n}`, `{:+}`…: the text between the braces
    Hole(&'static str),
}

struct Pattern {
    en: Vec<Tok>,
    ru: Vec<Tok>,
}

struct Dict {
    exact: HashMap<&'static str, &'static str>,
    patterns: Vec<Pattern>,
}

fn tokens(s: &'static str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(open) = rest.find('{') {
        let Some(close) = rest[open..].find('}') else { break };
        if open > 0 {
            out.push(Tok::Lit(&rest[..open]));
        }
        out.push(Tok::Hole(&rest[open + 1..open + close]));
        rest = &rest[open + close + 1..];
    }
    if !rest.is_empty() {
        out.push(Tok::Lit(rest));
    }
    out
}

fn dict() -> &'static Dict {
    static DICT: OnceLock<Dict> = OnceLock::new();
    DICT.get_or_init(|| {
        let mut exact = HashMap::new();
        let mut patterns = Vec::new();
        for line in TSV.lines() {
            let Some((en, ru)) = line.split_once('\t') else { continue };
            if en.is_empty() || ru.is_empty() {
                continue;
            }
            if en.contains('{') && en.contains('}') {
                let (e, r) = (tokens(en), tokens(ru));
                let holes = |v: &[Tok]| v.iter().filter(|t| matches!(t, Tok::Hole(_))).count();
                if holes(&e) > 0 && holes(&e) == holes(&r) {
                    patterns.push(Pattern { en: e, ru: r });
                }
            }
            exact.entry(en).or_insert(ru);
        }
        // longer patterns first: the most specific one wins
        patterns.sort_by_key(|p| std::cmp::Reverse(p.en.iter().map(|t| if let Tok::Lit(l) = t { l.len() } else { 0 }).sum::<usize>()));
        Dict { exact, patterns }
    })
}

/// The values of a pattern's holes in `text`, or `None` when it doesn't match.
fn capture<'a>(toks: &[Tok], text: &'a str) -> Option<Vec<&'a str>> {
    let mut vals = Vec::new();
    let mut pos = 0;
    let mut i = 0;
    while i < toks.len() {
        match toks.get(i)? {
            Tok::Lit(l) => {
                if !text.get(pos..)?.starts_with(l) {
                    return None;
                }
                pos += l.len();
            }
            Tok::Hole(_) => {
                let end = match toks.get(i + 1) {
                    Some(Tok::Lit(next)) => pos + text.get(pos..)?.find(next)?,
                    Some(Tok::Hole(_)) => return None, // two holes in a row: ambiguous
                    None => text.len(),
                };
                if end <= pos {
                    return None;
                }
                vals.push(text.get(pos..end)?);
                pos = end;
            }
        }
        i += 1;
    }
    (pos == text.len()).then_some(vals)
}

fn fill(p: &Pattern, vals: &[&str]) -> Option<String> {
    let names: Vec<&str> = p.en.iter().filter_map(|t| if let Tok::Hole(h) = t { Some(*h) } else { None }).collect();
    // unnamed holes (`{}`, `{:+}`) are filled in order; named ones by name
    let unnamed: Vec<usize> = names.iter().enumerate().filter(|(_, h)| h.is_empty() || h.starts_with(':')).map(|(i, _)| i).collect();
    let mut next = 0;
    let mut out = String::new();
    for t in &p.ru {
        match t {
            Tok::Lit(l) => out.push_str(l),
            Tok::Hole(h) => {
                let idx = if h.is_empty() || h.starts_with(':') {
                    let k = *unnamed.get(next)?;
                    next += 1;
                    k
                } else {
                    names.iter().position(|n| n == h)?
                };
                out.push_str(vals.get(idx)?);
            }
        }
    }
    Some(out)
}

fn lookup(text: &str) -> Option<String> {
    let d = dict();
    if let Some(t) = d.exact.get(text) {
        return Some((*t).to_owned());
    }
    // surrounding spaces, a trailing ellipsis or colon
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.len() != text.len() {
        let start = text.find(trimmed)?;
        let t = lookup(trimmed)?;
        return Some(format!("{}{}{}", &text[..start], t, &text[start + trimmed.len()..]));
    }
    for suffix in ["…", "...", ":"] {
        if let Some(base) = text.strip_suffix(suffix)
            && let Some(t) = d.exact.get(base.trim_end())
        {
            return Some(format!("{t}{suffix}"));
        }
    }
    for p in &d.patterns {
        if let Some(vals) = capture(&p.en, text) {
            // a hole holding plain English words is most likely an untranslated label: leave it
            if vals.iter().all(|v| v.chars().all(|c| c.is_ascii_alphabetic() || c == ' ') && v.chars().any(|c| c.is_ascii_alphabetic()))
                && !text.chars().any(|c| c.is_ascii_digit())
                && p.en.iter().all(|t| matches!(t, Tok::Lit(_)) || matches!(t, Tok::Hole(h) if h.is_empty()))
            {
                continue;
            }
            if let Some(s) = fill(p, &vals) {
                return Some(s);
            }
        }
    }
    None
}

/// Translate `job` in place when its whole text is one known interface string.
pub fn apply(job: &mut LayoutJob) {
    if OFF.with(Cell::get) > 0 || job.sections.len() != 1 || job.text.len() > 600 || job.text.is_empty() {
        return;
    }
    let Some(section) = job.sections.first() else { return };
    if section.byte_range.start.0 != 0 || section.byte_range.end.0 != job.text.len() {
        return;
    }
    if !job.text.bytes().any(|b| b.is_ascii_alphabetic()) {
        return;
    }
    if let Some(t) = lookup(&job.text) {
        let len = t.len();
        job.text = t;
        if let Some(s) = job.sections.first_mut() {
            s.byte_range = ByteIndex(0)..ByteIndex(len);
        }
    }
}

/// The translation of an interface string (for labels a widget splits into lines before laying
/// them out), or `None`.
pub fn label(text: &str) -> Option<String> {
    if OFF.with(Cell::get) > 0 {
        return None;
    }
    lookup(text)
}
