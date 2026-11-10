//! Offline API snapshot: bundled at build time, optionally replaced by a user-imported local snapshot.
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const BUNDLED_INDEX: &str = include_str!("../../data/forever-api-index.json");
pub const BUNDLED_NOTES: &str = include_str!("../../data/compat-notes.json");

pub struct ApiIndex {
    pub raw: String,
    pub globals: HashSet<String>,
    pub namespaces: HashMap<String, HashSet<String>>,
    pub events: HashSet<String>,
    pub build: String,
    pub origin: String,
}

pub struct Notes {
    pub removed: HashSet<String>,
    pub replacements: HashMap<String, String>,
    pub removed_source: String,
    pub by_name: HashMap<String, Vec<(String, String, String)>>, // name -> (category, level, text)
}

impl ApiIndex {
    pub fn from_raw(raw: String, origin: &str) -> Result<Self, String> {
        let v: Value = serde_json::from_str(&raw).map_err(|e| format!("invalid API snapshot JSON: {e}"))?;
        if v.get("schema").and_then(Value::as_u64) != Some(1) {
            return Err("unsupported API snapshot schema (expected schema 1)".into());
        }
        let funcs = v.get("functions").and_then(Value::as_array).ok_or("snapshot has no 'functions' array")?;
        let mut globals = HashSet::new();
        let mut namespaces: HashMap<String, HashSet<String>> = HashMap::new();
        for f in funcs {
            let name = f.get("name").and_then(Value::as_str).unwrap_or_default();
            match f.get("ns").and_then(Value::as_str) {
                Some(ns) => {
                    let short = name.strip_prefix(&format!("{ns}.")).unwrap_or(name);
                    namespaces.entry(ns.to_string()).or_default().insert(short.to_string());
                }
                None => {
                    globals.insert(name.to_string());
                }
            }
        }
        let events = v
            .get("events")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|e| e.get("name").and_then(Value::as_str).map(String::from)).collect())
            .unwrap_or_default();
        let meta = v.get("meta");
        let build = meta.and_then(|m| m.get("build")).and_then(Value::as_str).unwrap_or("?").to_string();
        Ok(Self { raw, globals, namespaces, events, build, origin: origin.to_string() })
    }
    pub fn bundled() -> Self {
        Self::from_raw(BUNDLED_INDEX.to_string(), "bundled").expect("bundled API index must be valid")
    }
}

impl Notes {
    pub fn bundled() -> Self {
        let v: Value = serde_json::from_str(BUNDLED_NOTES).expect("bundled compat notes must be valid JSON");
        let rg = &v["removedGlobals"];
        let removed = rg["names"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let replacements = rg["replacements"].as_object().map(|o| o.iter().filter_map(|(k, x)| x.as_str().map(|s| (k.clone(), s.to_string()))).collect()).unwrap_or_default();
        let mut by_name: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
        for n in v["notes"].as_array().into_iter().flatten() {
            let (c, l, t) = (n["category"].as_str().unwrap_or(""), n["level"].as_str().unwrap_or(""), n["text"].as_str().unwrap_or(""));
            for name in n["names"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                by_name.entry(name.to_string()).or_default().push((c.into(), l.into(), t.into()));
            }
        }
        Self { removed, replacements, removed_source: rg["source"].as_str().unwrap_or("").to_string(), by_name }
    }
}

/// Lua 5.1 + WoW-embedded standard library names that are not in any API dump.
pub fn is_lua_builtin(first: &str) -> bool {
    matches!(
        first,
        "_G" | "_VERSION" | "assert" | "collectgarbage" | "error" | "getfenv" | "getmetatable" | "ipairs" | "loadstring" | "next" | "pairs" | "pcall" | "print" | "rawequal" | "rawget" | "rawset" | "select" | "setfenv" | "setmetatable" | "tonumber" | "tostring" | "type" | "unpack" | "xpcall" | "string" | "table" | "math" | "bit" | "os" | "coroutine" | "debug" | "io" | "package" | "require" | "newproxy" | "gcinfo" | "self" | "arg" | "unpack_" | "format" | "strsplit" | "strjoin" | "tinsert" | "tremove" | "wipe" | "strtrim" | "strupper" | "strlower" | "strfind" | "strsub" | "strlen" | "strrep" | "strbyte" | "strchar" | "strmatch" | "gsub" | "gmatch" | "sort" | "floor" | "ceil" | "abs" | "min" | "max" | "random" | "date" | "time" | "tconcat"
    )
}

pub fn search_stats(idx: &ApiIndex) -> (usize, usize, usize) {
    (idx.globals.len() + idx.namespaces.values().map(|s| s.len()).sum::<usize>(), idx.namespaces.len(), idx.events.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_loads() {
        let i = ApiIndex::bundled();
        assert!(i.namespaces.contains_key("C_Spell"));
        assert!(i.events.contains("PLAYER_LOGIN"));
        assert!(i.globals.contains("CreateFrame"));
        assert!(Notes::bundled().removed.contains("GetItemInfo"));
        // the kit says these are absent on Forever; our snapshot must agree for them to count as "confirmed"
        assert!(!i.globals.contains("GetItemInfo"));
    }
}
