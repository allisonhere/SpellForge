//! Blizzard interface (FrameXML) importer: XML parser, template registry and inheritance resolver.
//!
//! The input is a *user-supplied local folder* containing `Interface/AddOns/...` (for example a local checkout of Blizzard's
//! published UI source, or a user's own extraction). Nothing here is bundled or redistributed.
//!
//! Merge rules for `inherits` (see `merge`) follow how the client applies a template and then the deriving element on top:
//! attributes override, `Size` merges per attribute, `Anchors` merge per `point` (SetPoint semantics), keyed children
//! (`parentKey` / `name`) override in place, everything else is appended. Rules marked INFERRED are not verified against the
//! client and are listed in the compatibility report.
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct XNode {
    pub tag: String,
    pub attrs: BTreeMap<String, String>,
    pub children: Vec<XNode>,
    pub text: String,
    pub line: u32,
}

impl XNode {
    pub fn attr(&self, k: &str) -> Option<&str> {
        self.attrs.get(k).map(String::as_str)
    }
    pub fn child(&self, tag: &str) -> Option<&XNode> {
        self.children.iter().find(|c| c.tag == tag)
    }
    pub fn flag(&self, k: &str) -> bool {
        self.attr(k).is_some_and(|v| v.eq_ignore_ascii_case("true"))
    }
}

fn line_of(offsets: &[usize], pos: usize) -> u32 {
    (offsets.partition_point(|&o| o <= pos) + 1) as u32
}

/// Parse an XML document into a generic tree. The returned node is a synthetic root whose children are the top-level elements.
pub fn parse_xml(src: &str) -> Result<XNode, String> {
    let src = src.strip_prefix('\u{feff}').unwrap_or(src);
    let offsets: Vec<usize> = src.bytes().enumerate().filter(|(_, b)| *b == b'\n').map(|(i, _)| i).collect();
    let mut rd = Reader::from_str(src);
    rd.config_mut().trim_text(true);
    rd.config_mut().check_end_names = false; // Blizzard files are occasionally sloppy; mismatches are tolerated, truncation is not
    let mut stack: Vec<XNode> = vec![XNode { tag: "#root".into(), ..Default::default() }];
    let make = |e: &quick_xml::events::BytesStart, line: u32| -> XNode {
        let mut n = XNode { tag: String::from_utf8_lossy(e.name().as_ref()).into_owned(), line, ..Default::default() };
        for a in e.attributes().with_checks(false).flatten() {
            let k = String::from_utf8_lossy(a.key.as_ref()).into_owned();
            let v = a.unescape_value().map(|c| c.into_owned()).unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned());
            n.attrs.insert(k, v);
        }
        n
    };
    loop {
        let pos = rd.buffer_position() as usize;
        match rd.read_event() {
            Ok(Event::Start(e)) => stack.push(make(&e, line_of(&offsets, pos))),
            Ok(Event::Empty(e)) => {
                let n = make(&e, line_of(&offsets, pos));
                stack.last_mut().unwrap().children.push(n);
            }
            Ok(Event::End(_)) => {
                if stack.len() < 2 {
                    return Err(format!("unbalanced end tag at line {}", line_of(&offsets, pos)));
                }
                let n = stack.pop().unwrap();
                stack.last_mut().unwrap().children.push(n);
            }
            Ok(Event::Text(t)) => {
                if let Ok(s) = t.unescape() {
                    stack.last_mut().unwrap().text.push_str(&s);
                }
            }
            Ok(Event::CData(t)) => stack.last_mut().unwrap().text.push_str(&String::from_utf8_lossy(&t)),
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("line {}: {e}", line_of(&offsets, pos))),
        }
    }
    if stack.len() != 1 {
        return Err(format!("document ended with {} unclosed element(s) (<{}>)", stack.len() - 1, stack.last().unwrap().tag));
    }
    Ok(stack.pop().unwrap())
}

// ---------------- registry ----------------

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub name: String,
    pub tag: String,
    pub is_virtual: bool,
    pub file: String,
    pub line: u32,
    pub node: XNode,
}

#[derive(Debug, Default, Serialize)]
pub struct IndexStats {
    pub xml_files: usize,
    pub parse_errors: Vec<(String, String)>,
    pub elements: usize,
    pub templates: usize,
    pub virtual_templates: usize,
    pub duplicate_names: usize,
    pub tag_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Default)]
pub struct Registry {
    /// key = lower-cased name
    pub templates: BTreeMap<String, Template>,
    pub stats: IndexStats,
}

fn count(n: &XNode, st: &mut IndexStats) {
    st.elements += 1;
    *st.tag_counts.entry(n.tag.clone()).or_default() += 1;
    for c in &n.children {
        count(c, st);
    }
}

impl Registry {
    /// Register a parsed document. Named virtual elements anywhere are templates; named top-level elements are registered too.
    pub fn add_document(&mut self, file: &str, root: &XNode) {
        count(root, &mut self.stats);
        fn walk(reg: &mut Registry, file: &str, n: &XNode, top: bool) {
            if let Some(name) = n.attr("name") {
                let virt = n.flag("virtual");
                if virt || top {
                    let key = name.to_ascii_lowercase();
                    if reg.templates.contains_key(&key) {
                        reg.stats.duplicate_names += 1;
                    }
                    reg.templates.insert(key, Template { name: name.to_string(), tag: n.tag.clone(), is_virtual: virt, file: file.to_string(), line: n.line, node: n.clone() });
                    if virt {
                        reg.stats.virtual_templates += 1;
                    }
                }
            }
            for c in &n.children {
                walk(reg, file, c, false);
            }
        }
        // top-level elements live inside <Ui>
        for ui in root.children.iter().filter(|c| c.tag == "Ui") {
            for c in &ui.children {
                walk(self, file, c, true);
            }
        }
        self.stats.templates = self.templates.len();
    }

    pub fn get(&self, name: &str) -> Option<&Template> {
        self.templates.get(&name.to_ascii_lowercase())
    }
}

/// Index every `.xml` under `root` (typically `<ui-source>/Interface`). Read-only.
pub fn index_dir(root: &Path) -> Registry {
    let mut reg = Registry::default();
    let mut files: Vec<_> = WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("xml"))).map(|e| e.into_path()).collect();
    files.sort();
    for p in files {
        reg.stats.xml_files += 1;
        let rel = crate::fsguard::to_rel_string(root, &p);
        let Ok(bytes) = std::fs::read(&p) else {
            reg.stats.parse_errors.push((rel, "unreadable".into()));
            continue;
        };
        match parse_xml(&String::from_utf8_lossy(&bytes)) {
            Ok(doc) => reg.add_document(&rel, &doc),
            Err(e) => reg.stats.parse_errors.push((rel, e)),
        }
    }
    reg
}

// ---------------- inheritance ----------------

/// Merge `derived` on top of `base`. INFERRED rules (not verified in the client): same-`point` anchor replacement, `Scripts`
/// replace (ignoring inherit="prepend|append"), unkeyed region/frames append.
pub fn merge(base: &XNode, derived: &XNode) -> XNode {
    let mut out = base.clone();
    out.line = derived.line;
    for (k, v) in &derived.attrs {
        match k.as_str() {
            "mixin" => {
                let cur = out.attrs.entry("mixin".into()).or_default();
                if !cur.is_empty() {
                    cur.push(',');
                }
                cur.push_str(v);
            }
            _ => {
                out.attrs.insert(k.clone(), v.clone());
            }
        }
    }
    for c in &derived.children {
        merge_child(&mut out.children, c);
    }
    out
}

fn child_key(n: &XNode) -> Option<String> {
    match n.tag.as_str() {
        "Anchor" => n.attr("point").map(|p| format!("point:{p}")),
        "KeyValue" => n.attr("key").map(|k| format!("key:{k}")),
        "Layer" => Some(format!("level:{}:{}", n.attr("level").unwrap_or("ARTWORK"), n.attr("textureSubLevel").unwrap_or("0"))),
        // keyed elements: frames/regions with a parentKey or a name
        _ => n.attr("parentKey").map(|k| format!("{}:pk:{k}", n.tag)).or_else(|| n.attr("name").map(|k| format!("{}:name:{}", n.tag, k.to_ascii_lowercase()))),
    }
}

const SINGLETONS: &[&str] = &["Size", "Anchors", "Layers", "Frames", "KeyValues", "Scripts", "Animations", "Attributes", "HitRectInsets", "TitleRegion", "ButtonText", "NormalTexture", "PushedTexture", "DisabledTexture", "HighlightTexture", "CheckedTexture", "DisabledCheckedTexture", "BarTexture", "BarColor", "ThumbTexture", "NormalFont", "HighlightFont", "DisabledFont", "PushedTextOffset", "TextInsets", "ScrollChild", "Mixins"];

fn merge_child(into: &mut Vec<XNode>, c: &XNode) {
    let key = child_key(c);
    let singleton = SINGLETONS.contains(&c.tag.as_str());
    let slot = into.iter().position(|e| {
        if let Some(k) = &key {
            child_key(e).as_ref() == Some(k) && e.tag == c.tag
        } else {
            singleton && e.tag == c.tag
        }
    });
    match slot {
        Some(i) => {
            let old = into[i].clone();
            into[i] = if c.tag == "Scripts" { merge_scripts(&old, c) } else { merge(&old, c) };
        }
        None => into.push(c.clone()),
    }
}

fn merge_scripts(base: &XNode, derived: &XNode) -> XNode {
    let mut out = base.clone();
    for h in &derived.children {
        match out.children.iter().position(|e| e.tag == h.tag) {
            Some(i) => out.children[i] = h.clone(),
            None => out.children.push(h.clone()),
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct Resolved {
    pub node: XNode,
    /// base-most first, ending with the requested template
    pub chain: Vec<String>,
    /// `inherits` names that are not defined in the loaded source
    pub missing: Vec<String>,
}

/// Resolve a template's own inheritance chain (children that themselves `inherits` are resolved by `resolve_deep`).
pub fn resolve(reg: &Registry, name: &str) -> Option<Resolved> {
    let mut missing = vec![];
    let mut seen = BTreeSet::new();
    fn go(reg: &Registry, node: &XNode, own: &str, seen: &mut BTreeSet<String>, missing: &mut Vec<String>, chain: &mut Vec<String>) -> XNode {
        let mut acc = XNode { tag: node.tag.clone(), ..Default::default() };
        // inherits is a comma/space separated list; earlier entries are applied first
        for base_name in node.attr("inherits").unwrap_or("").split([',', ' ']).map(str::trim).filter(|s| !s.is_empty()) {
            let key = base_name.to_ascii_lowercase();
            if !seen.insert(key.clone()) {
                continue; // cycle or diamond: apply once
            }
            match reg.get(base_name) {
                Some(t) => {
                    let resolved_base = go(reg, &t.node, &t.name, seen, missing, chain);
                    acc = if acc.attrs.is_empty() && acc.children.is_empty() { resolved_base } else { merge(&acc, &resolved_base) };
                }
                None => missing.push(base_name.to_string()),
            }
        }
        chain.push(own.to_string());
        let mut own_node = node.clone();
        own_node.attrs.remove("inherits");
        if acc.attrs.is_empty() && acc.children.is_empty() { own_node } else { merge(&acc, &own_node) }
    }
    let t = reg.get(name)?;
    seen.insert(name.to_ascii_lowercase());
    let mut chain = vec![];
    let node = go(reg, &t.node, &t.name, &mut seen, &mut missing, &mut chain);
    missing.sort();
    missing.dedup();
    Some(Resolved { node, chain, missing })
}

/// Resolve the template and, recursively, every descendant element that has its own `inherits` (depth-limited).
pub fn resolve_deep(reg: &Registry, name: &str, max_depth: usize) -> Option<Resolved> {
    let mut r = resolve(reg, name)?;
    fn descend(reg: &Registry, n: &mut XNode, depth: usize, max: usize, missing: &mut Vec<String>) {
        if depth >= max {
            return;
        }
        for c in &mut n.children {
            if let Some(inh) = c.attr("inherits").map(String::from) {
                // synthesise a one-off template for this child so the same chain logic applies
                let mut tmp = Registry { templates: reg.templates.clone(), ..Default::default() };
                let key = "#child".to_string();
                tmp.templates.insert(key.clone(), Template { name: "#child".into(), tag: c.tag.clone(), is_virtual: true, file: String::new(), line: c.line, node: { let mut x = c.clone(); x.attrs.insert("inherits".into(), inh); x } });
                if let Some(res) = resolve(&tmp, "#child") {
                    *c = res.node;
                    missing.extend(res.missing);
                }
            }
            descend(reg, c, depth + 1, max, missing);
        }
    }
    let mut missing = std::mem::take(&mut r.missing);
    descend(reg, &mut r.node, 0, max_depth, &mut missing);
    missing.sort();
    missing.dedup();
    r.missing = missing;
    Some(r)
}

// ---------------- typed accessors (normalise legacy shapes) ----------------

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UiAnchor {
    pub point: String,
    pub relative_to: Option<String>,
    pub relative_point: Option<String>,
    pub x: f32,
    pub y: f32,
}

fn f(v: Option<&str>) -> Option<f32> {
    v.and_then(|s| s.trim().parse().ok())
}

/// `<Size x= y=/>` or legacy `<Size><AbsDimension x= y=/></Size>`.
pub fn size_of(n: &XNode) -> (Option<f32>, Option<f32>) {
    let Some(s) = n.child("Size") else { return (None, None) };
    let src = s.child("AbsDimension").unwrap_or(s);
    (f(src.attr("x")), f(src.attr("y")))
}

/// `<Anchor point= relativeTo= relativePoint=><Offset x= y=/></Anchor>` or the legacy `<Offset><AbsDimension/></Offset>`.
pub fn anchors_of(n: &XNode) -> Vec<UiAnchor> {
    let Some(a) = n.child("Anchors") else { return vec![] };
    a.children.iter().filter(|c| c.tag == "Anchor").map(|c| {
        let off = c.child("Offset");
        let src = off.map(|o| o.child("AbsDimension").unwrap_or(o));
        UiAnchor {
            point: c.attr("point").unwrap_or("TOPLEFT").to_string(),
            relative_to: c.attr("relativeTo").map(String::from),
            relative_point: c.attr("relativePoint").map(String::from),
            x: f(src.and_then(|s| s.attr("x"))).or_else(|| f(c.attr("x"))).unwrap_or(0.0),
            y: f(src.and_then(|s| s.attr("y"))).or_else(|| f(c.attr("y"))).unwrap_or(0.0),
        }
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"<?xml version="1.0"?>
<Ui>
  <Button name="BaseButton" virtual="true" mixin="BaseMixin">
    <Size x="100" y="24"/>
    <Anchors><Anchor point="CENTER"/><Anchor point="TOP" x="0" y="-4"/></Anchors>
    <KeyValues><KeyValue key="a" value="1" type="number"/><KeyValue key="b" value="x"/></KeyValues>
    <Layers><Layer level="BACKGROUND"><Texture parentKey="Bg" atlas="bg-atlas"/></Layer></Layers>
    <Scripts><OnClick method="Base"/></Scripts>
  </Button>
  <Button name="FancyButton" inherits="BaseButton" mixin="FancyMixin" virtual="true">
    <Size y="30"/>
    <Anchors><Anchor point="TOP"><Offset x="2" y="-9"/></Anchor></Anchors>
    <KeyValues><KeyValue key="b" value="y"/></KeyValues>
    <Layers><Layer level="BACKGROUND"><Texture parentKey="Bg" atlas="fancy-atlas"/><Texture parentKey="Extra"/></Layer></Layers>
    <Scripts><OnClick method="Fancy"/><OnEnter method="E"/></Scripts>
  </Button>
  <Frame name="Holder"><Frames><Button parentKey="B" inherits="FancyButton"/></Frames></Frame>
  <Frame name="Broken" inherits="NoSuchTemplate" virtual="true"/>
</Ui>"#;

    fn reg() -> Registry {
        let mut r = Registry::default();
        r.add_document("t.xml", &parse_xml(XML).unwrap());
        r
    }

    #[test]
    fn parses_and_registers() {
        let r = reg();
        assert_eq!(r.stats.virtual_templates, 3);
        assert!(r.get("fancybutton").is_some() && r.get("Holder").is_some()); // case-insensitive, top-level non-virtual registered
        assert_eq!(r.get("BaseButton").unwrap().line, 3);
    }

    #[test]
    fn inheritance_merges_like_the_client_applies_templates() {
        let res = resolve(&reg(), "FancyButton").unwrap();
        assert_eq!(res.chain, vec!["BaseButton", "FancyButton"]);
        assert_eq!(size_of(&res.node), (Some(100.0), Some(30.0)), "Size merges per attribute");
        let a = anchors_of(&res.node);
        assert_eq!(a.len(), 2, "CENTER kept, TOP replaced (same point)");
        assert_eq!((a[1].point.as_str(), a[1].x, a[1].y), ("TOP", 2.0, -9.0));
        assert_eq!(res.node.attr("mixin"), Some("BaseMixin,FancyMixin"));
        let kv: Vec<_> = res.node.child("KeyValues").unwrap().children.iter().map(|k| (k.attr("key").unwrap(), k.attr("value").unwrap())).collect();
        assert_eq!(kv, vec![("a", "1"), ("b", "y")]);
        let layer = &res.node.child("Layers").unwrap().children[0];
        assert_eq!(layer.children.len(), 2);
        assert_eq!(layer.children[0].attr("atlas"), Some("fancy-atlas"), "keyed texture overridden in place");
        let scripts: Vec<_> = res.node.child("Scripts").unwrap().children.iter().map(|s| (s.tag.as_str(), s.attr("method").unwrap())).collect();
        assert_eq!(scripts, vec![("OnClick", "Fancy"), ("OnEnter", "E")]);
    }

    #[test]
    fn reports_missing_bases_and_resolves_children_deeply() {
        let r = reg();
        assert_eq!(resolve(&r, "Broken").unwrap().missing, vec!["NoSuchTemplate"]);
        let d = resolve_deep(&r, "Holder", 4).unwrap();
        let b = &d.node.child("Frames").unwrap().children[0];
        assert_eq!(size_of(b), (Some(100.0), Some(30.0)), "child inherits FancyButton -> BaseButton");
    }

    #[test]
    fn legacy_shapes_are_normalised() {
        let doc = parse_xml(r#"<Ui><Frame name="L"><Size><AbsDimension x="10" y="20"/></Size><Anchors><Anchor point="TOPLEFT" relativeTo="$parent" relativePoint="BOTTOMLEFT"><Offset><AbsDimension x="3" y="-4"/></Offset></Anchor></Anchors></Frame></Ui>"#).unwrap();
        let n = &doc.children[0].children[0];
        assert_eq!(size_of(n), (Some(10.0), Some(20.0)));
        let a = anchors_of(n);
        assert_eq!((a[0].relative_to.as_deref(), a[0].relative_point.as_deref(), a[0].x, a[0].y), (Some("$parent"), Some("BOTTOMLEFT"), 3.0, -4.0));
    }

    #[test]
    fn truncated_xml_is_an_error_not_silent() {
        assert!(parse_xml("<Ui><Frame name=\"x\">").is_err());
    }

    #[test]
    fn cycles_terminate() {
        let mut r = Registry::default();
        r.add_document("c.xml", &parse_xml(r#"<Ui><Frame name="A" inherits="B" virtual="true"/><Frame name="B" inherits="A" virtual="true"/></Ui>"#).unwrap());
        assert!(resolve(&r, "A").is_some());
    }
}

// ---------------- TOC-driven load set ----------------
//
// Blizzard's TOCs choose files per game type and use path variables. Loading every file in the tree would mix game flavours and
// silently pick the wrong template, so the importer follows the TOCs the way the client does. For WoW: Forever the game type is
// `camelot` (the codename used in the TOCs); the `[Family]` folder is a configurable assumption verified against the files on disk.
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct LoadContext {
    /// Game types this client satisfies. Forever is `camelot`; whether it also satisfies `mainline` is decided by evidence (see tests).
    pub game_types: Vec<String>,
    /// Lower-cased text locale used for `AllowLoadTextLocale`.
    pub text_locale: String,
    /// Value substituted for `[Family]\` in TOC paths.
    pub family: String,
    /// Value substituted for `[Game]\` in TOC paths.
    pub game: String,
}

impl LoadContext {
    pub fn forever() -> Self {
        Self { game_types: vec!["camelot".into(), "mainline".into()], text_locale: "enus".into(), family: "Mainline".into(), game: "Camelot".into() }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct AddonLoad {
    pub name: String,
    pub toc: String,
    pub deps: Vec<String>,
    pub load_on_demand: bool,
    /// Files (relative to the addon folder, forward slashes, on-disk casing) that load for this context, in TOC order.
    pub files: Vec<String>,
    /// TOC entries whose file does not exist in the supplied source.
    pub missing: Vec<String>,
    pub unknown_directives: Vec<String>,
}

/// Lower-cased relative path (under `Interface/AddOns`) -> real path. Blizzard paths are case-insensitive; Linux is not.
pub struct FileMap {
    pub map: HashMap<String, PathBuf>,
    pub addons_root: PathBuf,
}

impl FileMap {
    pub fn build(addons_root: &Path) -> Self {
        let mut map = HashMap::new();
        for e in WalkDir::new(addons_root).follow_links(false).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
            let rel = crate::fsguard::to_rel_string(addons_root, e.path());
            map.insert(rel.to_ascii_lowercase(), e.into_path());
        }
        Self { map, addons_root: addons_root.to_path_buf() }
    }
    pub fn get(&self, addon: &str, rel: &str) -> Option<&PathBuf> {
        self.map.get(&format!("{}/{}", addon, rel.replace('\\', "/")).to_ascii_lowercase())
    }
    pub fn get_global(&self, rel: &str) -> Option<&PathBuf> {
        self.map.get(&rel.replace('\\', "/").to_ascii_lowercase())
    }
}

/// Split a TOC line into its text and bracketed directives. Directives may trail (`file [A x] [B y]`, tab or space separated)
/// or lead (`[AllowLoadTextLocale: zhCN] file`); `[Family]\\` / `[Game]\\` at the start of a path are path variables, not directives.
pub fn split_directives(line: &str) -> (String, Vec<(String, Vec<String>)>) {
    fn parse_group(inner: &str) -> (String, Vec<String>) {
        let mut parts = inner.splitn(2, |c: char| c.is_whitespace() || c == ':');
        let name = parts.next().unwrap_or("").trim().to_string();
        let args = parts.next().unwrap_or("").trim_start_matches([':', ' ', '\t']).split(',').map(|s| s.trim().to_ascii_lowercase()).filter(|s| !s.is_empty()).collect();
        (name, args)
    }
    let mut base = line.trim();
    let mut dirs = vec![];
    // trailing groups
    while base.ends_with(']') {
        let Some(open) = base.rfind('[') else { break };
        if open == 0 {
            break;
        }
        let (name, args) = parse_group(&base[open + 1..base.len() - 1]);
        if name.is_empty() {
            break;
        }
        dirs.push((name, args));
        base = base[..open].trim_end();
    }
    dirs.reverse();
    // leading groups (not path variables: those are followed by a path separator)
    let mut lead = vec![];
    while base.starts_with('[') {
        let Some(close) = base.find(']') else { break };
        let after = &base[close + 1..];
        if after.starts_with('\\') || after.starts_with('/') {
            break;
        }
        let (name, args) = parse_group(&base[1..close]);
        if name.is_empty() {
            break;
        }
        lead.push((name, args));
        base = after.trim_start();
    }
    lead.extend(dirs);
    (base.to_string(), lead)
}

/// Whether directives permit loading in the game environment for this context. Unknown directives are returned, not ignored.
pub fn directives_allow(dirs: &[(String, Vec<String>)], ctx: &LoadContext, unknown: &mut Vec<String>) -> bool {
    let mut ok = true;
    for (name, args) in dirs {
        match name.as_str() {
            "AllowLoadGameType" => ok &= args.iter().any(|a| ctx.game_types.contains(a)),
            "ExcludeLoadGameType" => ok &= !args.iter().any(|a| ctx.game_types.contains(a)),
            "AllowLoadTextLocale" => ok &= args.iter().any(|a| a == &ctx.text_locale),
            "AllowLoadEnvironment" => ok &= args.iter().any(|a| a == "global"),
            "AllowLoad" => ok &= !args.iter().any(|a| a == "glue") || args.iter().any(|a| a == "game" || a == "both"),
            other => unknown.push(other.to_string()),
        }
    }
    ok
}

fn csv_names(v: &str) -> Vec<String> {
    v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

/// Compute which files each Blizzard addon loads for `ctx`. Addons that do not load in the game environment are omitted.
pub fn load_addons(addons_root: &Path, fm: &FileMap, ctx: &LoadContext) -> Vec<AddonLoad> {
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(addons_root) else { return out };
    let mut dirs: Vec<_> = rd.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    dirs.sort();
    for addon in dirs {
        // TOC preference: <Addon>_<Game>.toc, <Addon>_<Family>.toc, <Addon>.toc
        let cands = [format!("{addon}_{}.toc", ctx.game), format!("{addon}_{}.toc", ctx.family), format!("{addon}.toc")];
        let Some(toc_path) = cands.iter().find_map(|c| fm.get(&addon, c)) else { continue };
        let text = String::from_utf8_lossy(&std::fs::read(toc_path).unwrap_or_default()).into_owned();
        let mut a = AddonLoad { name: addon.clone(), toc: toc_path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), ..Default::default() };
        let mut addon_ok = true;
        for raw in text.strip_prefix('\u{feff}').unwrap_or(&text).lines() {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(meta) = line.strip_prefix("##") {
                let (body, dirs) = split_directives(meta.trim());
                let Some((k, v)) = body.split_once(':') else { continue };
                let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
                let mut unk = vec![];
                let allowed = directives_allow(&dirs, ctx, &mut unk);
                a.unknown_directives.extend(unk);
                match k.as_str() {
                    "dependencies" | "dep" | "requireddep" | "requireddeps" => a.deps.extend(csv_names(v)),
                    "loadondemand" => a.load_on_demand = v == "1",
                    "allowload" => {
                        if !allowed || v.eq_ignore_ascii_case("glue") {
                            addon_ok = false;
                        }
                    }
                    "allowloadgametype" => addon_ok &= csv_names(v).iter().any(|g| ctx.game_types.contains(&g.to_ascii_lowercase())),
                    _ => {}
                }
                continue;
            }
            if line.starts_with('#') {
                continue;
            }
            let (path, dirs) = split_directives(line);
            let mut unk = vec![];
            if !directives_allow(&dirs, ctx, &mut unk) {
                continue;
            }
            a.unknown_directives.extend(unk);
            let sub = path.replace("[Family]", &ctx.family).replace("[Game]", &ctx.game);
            match fm.get(&addon, &sub) {
                Some(p) => a.files.push(crate::fsguard::to_rel_string(&addons_root.join(&addon), p)),
                None => a.missing.push(sub.replace('\\', "/")),
            }
        }
        if addon_ok {
            a.deps.sort();
            a.deps.dedup();
            a.unknown_directives.sort();
            a.unknown_directives.dedup();
            out.push(a);
        }
    }
    out
}

/// Order addons so dependencies come first (stable alphabetical otherwise). Cycles are broken, not fatal.
pub fn dependency_order(addons: &[AddonLoad]) -> Vec<usize> {
    let idx: HashMap<String, usize> = addons.iter().enumerate().map(|(i, a)| (a.name.to_ascii_lowercase(), i)).collect();
    let mut order = vec![];
    let mut state = vec![0u8; addons.len()];
    fn visit(i: usize, addons: &[AddonLoad], idx: &HashMap<String, usize>, state: &mut Vec<u8>, order: &mut Vec<usize>) {
        if state[i] != 0 {
            return;
        }
        state[i] = 1;
        for d in &addons[i].deps {
            if let Some(&j) = idx.get(&d.to_ascii_lowercase()) {
                visit(j, addons, idx, state, order);
            }
        }
        state[i] = 2;
        order.push(i);
    }
    for i in 0..addons.len() {
        visit(i, addons, &idx, &mut state, &mut order);
    }
    order
}

#[derive(Debug, Default, Serialize)]
pub struct LoadStats {
    pub addons_loaded: usize,
    pub files_in_toc: usize,
    pub xml_loaded: usize,
    pub includes_followed: usize,
    pub missing_toc_files: usize,
    pub missing_includes: usize,
    pub unknown_directives: BTreeSet<String>,
}

/// Build a registry from only the files the client would load for `ctx`, following `<Include>` and `<Script>` from XML.
pub fn index_load_set(addons_root: &Path, ctx: &LoadContext) -> (Registry, LoadStats, Vec<AddonLoad>) {
    let fm = FileMap::build(addons_root);
    let addons = load_addons(addons_root, &fm, ctx);
    let mut ld = Loader { reg: Registry::default(), st: LoadStats { addons_loaded: addons.len(), ..Default::default() }, fm: &fm, seen: BTreeSet::new() };
    for i in dependency_order(&addons) {
        let a = &addons[i];
        ld.st.files_in_toc += a.files.len();
        ld.st.missing_toc_files += a.missing.len();
        ld.st.unknown_directives.extend(a.unknown_directives.iter().cloned());
        for f in a.files.iter().filter(|f| f.to_ascii_lowercase().ends_with(".xml")) {
            if let Some(p) = fm.get(&a.name, f) {
                ld.load_xml(&a.name, f, &p.clone(), 0);
            }
        }
    }
    (ld.reg, ld.st, addons)
}

struct Loader<'a> {
    reg: Registry,
    st: LoadStats,
    fm: &'a FileMap,
    seen: BTreeSet<String>,
}

impl Loader<'_> {
    fn load_xml(&mut self, addon: &str, rel: &str, path: &Path, depth: usize) {
        if !self.seen.insert(path.to_string_lossy().to_ascii_lowercase()) {
            return;
        }
        self.reg.stats.xml_files += 1;
        self.st.xml_loaded += 1;
        let Ok(bytes) = std::fs::read(path) else { return };
        let doc = match parse_xml(&String::from_utf8_lossy(&bytes)) {
            Ok(d) => d,
            Err(e) => {
                self.reg.stats.parse_errors.push((format!("{addon}/{rel}"), e));
                return;
            }
        };
        self.reg.add_document(&format!("{addon}/{rel}"), &doc);
        if depth > 12 {
            return;
        }
        // <Include file="x.xml"/> is relative to this file's folder; <Script file=...> is Lua and is not indexed here
        let dir = Path::new(rel).parent().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        fn includes(n: &XNode, out: &mut Vec<String>) {
            if n.tag == "Include" {
                if let Some(f) = n.attr("file") {
                    out.push(f.to_string());
                }
            }
            for c in &n.children {
                includes(c, out);
            }
        }
        let mut inc = vec![];
        includes(&doc, &mut inc);
        for f in inc {
            let f = f.replace('\\', "/");
            let full = if f.to_ascii_lowercase().starts_with("interface/addons/") { f["interface/addons/".len()..].to_string() } else if dir.is_empty() { format!("{addon}/{f}") } else { format!("{addon}/{dir}/{f}") };
            let norm = normalise(&full);
            match self.fm.get_global(&norm) {
                Some(p) if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("xml")) => {
                    self.st.includes_followed += 1;
                    let (a2, r2) = norm.split_once('/').map(|(a, r)| (a.to_string(), r.to_string())).unwrap_or((norm.clone(), String::new()));
                    let p = p.clone();
                    self.load_xml(&a2, &r2, &p, depth + 1);
                }
                Some(_) => {}
                None => self.st.missing_includes += 1,
            }
        }
    }
}

fn normalise(p: &str) -> String {
    let mut out: Vec<&str> = vec![];
    for part in p.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            x => out.push(x),
        }
    }
    out.join("/")
}

#[cfg(test)]
mod toc_tests {
    use super::*;

    #[test]
    fn splits_trailing_directives_but_not_path_tokens() {
        let (p, d) = split_directives(r"[Family]\Foo.lua [AllowLoadGameType mainline, tbc] [ExcludeLoadGameType camelot]");
        assert_eq!(p, r"[Family]\Foo.lua");
        assert_eq!(d, vec![("AllowLoadGameType".to_string(), vec!["mainline".to_string(), "tbc".to_string()]), ("ExcludeLoadGameType".to_string(), vec!["camelot".to_string()])]);
        let (p2, d2) = split_directives(r"[Game]\Bar.xml");
        assert_eq!((p2.as_str(), d2.len()), (r"[Game]\Bar.xml", 0));
        let (p3, d3) = split_directives("[AllowLoadTextLocale: zhCN] Spinner.lua");
        assert_eq!((p3.as_str(), d3), ("Spinner.lua", vec![("AllowLoadTextLocale".to_string(), vec!["zhcn".to_string()])]));
        let (p4, d4) = split_directives("[Family]\\X.lua\t[AllowLoadTextLocale ruRU] [AllowLoad glue]");
        assert_eq!((p4.as_str(), d4.len()), ("[Family]\\X.lua", 2));
    }

    #[test]
    fn directives_filter_by_game_type() {
        let ctx = LoadContext::forever();
        let mut u = vec![];
        assert!(directives_allow(&[("AllowLoadGameType".into(), vec!["camelot".into()])], &ctx, &mut u));
        assert!(directives_allow(&[("AllowLoadGameType".into(), vec!["mainline".into(), "tbc".into()])], &ctx, &mut u), "forever also satisfies mainline (evidence-based, see real-data test)");
        assert!(!directives_allow(&[("AllowLoadGameType".into(), vec!["classic".into(), "tbc".into()])], &ctx, &mut u));
        assert!(!directives_allow(&[("ExcludeLoadGameType".into(), vec!["camelot".into()])], &ctx, &mut u));
        assert!(!directives_allow(&[("AllowLoadTextLocale".into(), vec!["zhcn".into()])], &ctx, &mut u));
        assert!(!directives_allow(&[("AllowLoad".into(), vec!["glue".into()])], &ctx, &mut u));
        assert!(u.is_empty());
        directives_allow(&[("Mystery".into(), vec![])], &ctx, &mut u);
        assert_eq!(u, vec!["Mystery"], "unknown directives are reported, not silently accepted");
    }

    #[test]
    fn dependency_order_puts_dependencies_first_and_survives_cycles() {
        let mk = |n: &str, d: &[&str]| AddonLoad { name: n.into(), deps: d.iter().map(|s| s.to_string()).collect(), ..Default::default() };
        let a = vec![mk("B", &["A"]), mk("A", &[]), mk("C", &["B", "Missing"])];
        let o: Vec<_> = dependency_order(&a).into_iter().map(|i| a[i].name.as_str()).collect();
        assert_eq!(o, vec!["A", "B", "C"]);
        let cyc = vec![mk("X", &["Y"]), mk("Y", &["X"])];
        assert_eq!(dependency_order(&cyc).len(), 2);
    }
}
