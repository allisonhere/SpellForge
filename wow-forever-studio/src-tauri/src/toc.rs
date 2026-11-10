//! TOC parser. Faithful to how the WoW client reads TOCs: `## Key: Value` metadata, `#` comments, one file per line,
//! backslash path separators, optional trailing `[Directive ...]` conditions.
use crate::diag::{Confidence, Diagnostic, Severity};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    pub line: u32,
    /// Path exactly as written.
    pub raw: String,
    /// Normalised to forward slashes.
    pub path: String,
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Toc {
    pub file: String,
    pub interface: Vec<u32>,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub saved_variables: Vec<String>,
    pub saved_variables_per_character: Vec<String>,
    pub dependencies: Vec<String>,
    pub optional_deps: Vec<String>,
    pub load_on_demand: bool,
    pub icon: Option<String>,
    pub fields: BTreeMap<String, String>,
    pub entries: Vec<TocEntry>,
    #[serde(skip)]
    pub diagnostics: Vec<Diagnostic>,
}

fn csv(v: &str) -> Vec<String> {
    v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

pub fn parse_toc(file: &str, text: &str) -> Toc {
    let mut toc = Toc { file: file.to_string(), ..Default::default() };
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut seen: BTreeMap<String, u32> = BTreeMap::new();
    for (i, raw_line) in text.split('\n').enumerate() {
        let ln = i as u32 + 1;
        let line = raw_line.trim_end_matches('\r').trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("##") {
            let rest = rest.trim();
            match rest.split_once(':') {
                Some((k, v)) => {
                    let (k, v) = (k.trim().to_string(), v.trim().to_string());
                    if let Some(prev) = toc.fields.get(&k) {
                        if prev != &v {
                            toc.diagnostics.push(
                                Diagnostic::new(Severity::Warning, "toc.duplicate-field", format!("'## {k}' declared more than once; the later value is used"), "toc", Confidence::Certain)
                                    .at(file, ln, 1),
                            );
                        }
                    }
                    seen.insert(k.clone(), ln);
                    toc.fields.insert(k, v);
                }
                None => toc.diagnostics.push(
                    Diagnostic::new(Severity::Info, "toc.bad-metadata", "metadata line without ':' is ignored by the client", "toc", Confidence::Certain).at(file, ln, 1),
                ),
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        let (path_part, condition) = match line.find(" [") {
            Some(p) if line.ends_with(']') => (line[..p].trim(), Some(line[p + 1..].to_string())),
            _ => (line, None),
        };
        toc.entries.push(TocEntry {
            line: ln,
            raw: path_part.to_string(),
            path: path_part.replace('\\', "/"),
            condition,
        });
    }
    let get = |k: &str| toc.fields.iter().find(|(key, _)| key.eq_ignore_ascii_case(k)).map(|(_, v)| v.clone());
    if let Some(v) = get("Interface") {
        let mut bad = vec![];
        for p in csv(&v) {
            match p.parse::<u32>() {
                Ok(n) => toc.interface.push(n),
                Err(_) => bad.push(p),
            }
        }
        for b in bad {
            toc.diagnostics.push(Diagnostic::new(Severity::Error, "toc.bad-interface", format!("Interface value '{b}' is not a number"), "toc", Confidence::Certain).at(file, *seen.get("Interface").unwrap_or(&1), 1));
        }
    }
    toc.title = get("Title");
    toc.notes = get("Notes");
    toc.author = get("Author");
    toc.version = get("Version");
    toc.icon = get("IconTexture").or_else(|| get("IconAtlas"));
    toc.saved_variables = get("SavedVariables").map(|v| csv(&v)).unwrap_or_default();
    toc.saved_variables_per_character = get("SavedVariablesPerCharacter").map(|v| csv(&v)).unwrap_or_default();
    toc.dependencies = get("Dependencies").or_else(|| get("RequiredDeps")).map(|v| csv(&v)).unwrap_or_default();
    toc.optional_deps = get("OptionalDeps").map(|v| csv(&v)).unwrap_or_default();
    toc.load_on_demand = get("LoadOnDemand").map(|v| v.trim() == "1").unwrap_or(false);
    toc
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEMPUS_HEAD: &str = "\u{feff}## Interface: 16001, 11508\r\n## Title: |cff3fc1ffTempus|r UI\r\n## SavedVariables: TempusDB\r\n## OptionalDeps: SpellPower, Auctionator\r\n\r\nCore\\Core.lua\r\nModules\\Buffs\\Auras.lua [AllowLoadGameType standard]\r\n# comment\r\n";

    #[test]
    fn parses_tempus_style_toc() {
        let t = parse_toc("Tempus.toc", TEMPUS_HEAD);
        assert_eq!(t.interface, vec![16001, 11508]);
        assert_eq!(t.saved_variables, vec!["TempusDB"]);
        assert_eq!(t.optional_deps, vec!["SpellPower", "Auctionator"]);
        assert_eq!(t.entries.len(), 2);
        assert_eq!(t.entries[0].path, "Core/Core.lua");
        assert_eq!(t.entries[0].raw, "Core\\Core.lua");
        assert_eq!(t.entries[1].condition.as_deref(), Some("[AllowLoadGameType standard]"));
        assert_eq!(t.entries[1].line, 7);
    }

    #[test]
    fn flags_bad_interface_and_duplicates() {
        let t = parse_toc("a.toc", "## Interface: 16001, abc\n## Title: A\n## Title: B\nx.lua\n");
        assert_eq!(t.interface, vec![16001]);
        let codes: Vec<_> = t.diagnostics.iter().map(|d| d.code.as_str()).collect();
        assert!(codes.contains(&"toc.bad-interface"));
        assert!(codes.contains(&"toc.duplicate-field"));
    }
}
