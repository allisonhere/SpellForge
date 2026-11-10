import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { store } from "./store.svelte";
import { lookupFunction, notesFor, provenance, namespaceFunctions } from "./apiSearch";
import { ipc } from "./ipc";
import type { Diagnostic } from "./types";

(self as unknown as { MonacoEnvironment: object }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.editor.defineTheme("forever", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "5f6678", fontStyle: "italic" },
    { token: "keyword", foreground: "b39dff" },
    { token: "string", foreground: "7ee0c3" },
    { token: "number", foreground: "f0b36a" },
    { token: "identifier", foreground: "d7d9e0" },
    { token: "delimiter", foreground: "8a90a2" },
    { token: "tag", foreground: "67d4ea" },
    { token: "attribute.name", foreground: "b39dff" },
    { token: "attribute.value", foreground: "7ee0c3" },
  ],
  colors: {
    "editor.background": "#0f1117",
    "editor.foreground": "#d7d9e0",
    "editorLineNumber.foreground": "#3e4354",
    "editorLineNumber.activeForeground": "#8a90a2",
    "editor.lineHighlightBackground": "#161922",
    "editor.selectionBackground": "#3b2f7a88",
    "editorCursor.foreground": "#22d3ee",
    "editorIndentGuide.background1": "#1c1f2a",
    "editorWidget.background": "#14161d",
    "editorSuggestWidget.background": "#14161d",
    "editorSuggestWidget.border": "#262a36",
    "editorHoverWidget.background": "#14161d",
    "editorHoverWidget.border": "#262a36",
  },
});

const SEV: Record<string, monaco.MarkerSeverity> = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info, hint: monaco.MarkerSeverity.Hint };

export function toMarkers(ds: Diagnostic[]): monaco.editor.IMarkerData[] {
  return ds.map((d) => ({
    severity: SEV[d.severity] ?? monaco.MarkerSeverity.Info,
    message: `${d.message}${d.evidence === "needs-game-test" ? "\n(needs game test)" : ""}`,
    code: d.code,
    source: d.source,
    startLineNumber: d.line || 1, startColumn: d.col || 1, endLineNumber: d.line || 1, endColumn: (d.col || 1) + 1,
  }));
}

/** Expand the marker to the whole word at its start so squiggles are visible. */
export function fitMarkers(model: monaco.editor.ITextModel, ms: monaco.editor.IMarkerData[]) {
  for (const m of ms) {
    const w = model.getWordAtPosition({ lineNumber: m.startLineNumber, column: m.startColumn });
    if (w) { m.startColumn = w.startColumn; m.endColumn = w.endColumn; }
    else m.endColumn = model.getLineMaxColumn(m.startLineNumber);
  }
  return ms;
}

const KEYWORDS = ["local", "function", "if", "then", "else", "elseif", "end", "for", "in", "do", "while", "repeat", "until", "return", "break", "nil", "true", "false", "and", "or", "not"];

function chainBefore(model: monaco.editor.ITextModel, pos: monaco.Position): string | null {
  const text = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
  const m = /([A-Za-z_][\w]*)\.[\w]*$/.exec(text);
  return m ? (m[1] ?? null) : null;
}

monaco.languages.registerCompletionItemProvider("lua", {
  triggerCharacters: ["."],
  provideCompletionItems(model, pos) {
    const api = store.api;
    if (!api) return { suggestions: [] };
    const word = model.getWordUntilPosition(pos);
    const range = new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn);
    const ns = chainBefore(model, pos);
    const K = monaco.languages.CompletionItemKind;
    if (ns && api.namespaces.includes(ns)) {
      return {
        suggestions: namespaceFunctions(api, ns).map((f) => ({
          label: f.name.slice(ns.length + 1), kind: K.Function, range, insertText: f.name.slice(ns.length + 1),
          detail: f.sig ?? "(signature not documented)", documentation: { value: f.doc ?? provenance(f.src) },
        })),
      };
    }
    if (ns) return { suggestions: [] };
    const out: monaco.languages.CompletionItem[] = [];
    for (const k of KEYWORDS) out.push({ label: k, kind: K.Keyword, range, insertText: k });
    for (const n of api.namespaces) out.push({ label: n, kind: K.Module, range, insertText: n, detail: "namespace" });
    for (const f of api.functions) if (!f.ns) out.push({ label: f.name, kind: K.Function, range, insertText: f.name, detail: f.sig ?? "(signature not documented)", documentation: { value: f.doc ?? provenance(f.src) } });
    const seen = new Set<string>();
    for (const s of store.symbols) if (!s.name.includes(":") && !seen.has(s.name)) { seen.add(s.name); out.push({ label: s.name, kind: s.kind === "table" ? K.Module : K.Function, range, insertText: s.name, detail: `project · ${s.file}` }); }
    return { suggestions: out };
  },
});

// Event-name completion inside RegisterEvent("…")
monaco.languages.registerCompletionItemProvider("lua", {
  triggerCharacters: ['"', "'"],
  provideCompletionItems(model, pos) {
    const api = store.api;
    const before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
    if (!api || !/Register(Unit)?Event\(\s*["'][A-Z_0-9]*$/.test(before)) return { suggestions: [] };
    const word = model.getWordUntilPosition(pos);
    const range = new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn);
    return { suggestions: api.events.map((e) => ({ label: e.name, kind: monaco.languages.CompletionItemKind.Event, range, insertText: e.name, detail: e.system, documentation: { value: e.doc ?? "" } })) };
  },
});

function hoverFor(name: string): monaco.IMarkdownString[] | null {
  const api = store.api;
  if (!api) return null;
  const parts: monaco.IMarkdownString[] = [];
  const fn = lookupFunction(api, name);
  if (fn) {
    parts.push({ value: "```lua\n" + (fn.sig ?? fn.name + "(…)  -- signature not documented") + "\n```" });
    if (fn.doc) parts.push({ value: fn.doc });
    parts.push({ value: `*${provenance(fn.src)} · build ${api.meta.build}*${fn.sig ? "" : "\n\nNo signature in the snapshot: this is missing documentation, not evidence the function is unsupported."}` });
  } else {
    const ev = api.events.find((e) => e.name === name);
    if (ev) {
      parts.push({ value: "```\n" + `${ev.name}(${ev.payload.map((p) => `${p.n}: ${p.t}`).join(", ")})` + "\n```" });
      parts.push({ value: `Event · ${ev.system} · build ${api.meta.build}` });
    }
  }
  for (const n of notesFor(store.notes, name)) parts.push({ value: `**${n.category}** (${n.level}): ${n.text}\n\n*Source: ${n.source}*` });
  return parts.length ? parts : null;
}

monaco.languages.registerHoverProvider("lua", {
  provideHover(model, pos) {
    const w = model.getWordAtPosition(pos);
    if (!w) return null;
    const line = model.getLineContent(pos.lineNumber);
    // widen to a dotted chain around the word
    let s = w.startColumn - 1, e = w.endColumn - 1;
    while (s > 0 && /[\w.]/.test(line[s - 1] ?? "")) s--;
    while (e < line.length && /[\w]/.test(line[e] ?? "")) e++;
    const chain = line.slice(s, e).replace(/^\.+/, "");
    const cut = chain.slice(0, chain.indexOf(w.word) + w.word.length);
    const contents = hoverFor(cut) ?? hoverFor(w.word) ?? (/^[A-Z][A-Z_0-9]+$/.test(w.word) ? hoverFor(w.word) : null);
    if (!contents) return null;
    return { range: new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), contents };
  },
});

// ---- models & live diagnostics ----
export interface Doc { model: monaco.editor.ITextModel; saved: string }
export const docs = new Map<string, Doc>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function languageFor(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".lua")) return "lua";
  if (p.endsWith(".xml")) return "xml";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".toc")) return "toc";
  return "plaintext";
}
monaco.languages.register({ id: "toc" });
monaco.languages.setMonarchTokensProvider("toc", {
  tokenizer: { root: [[/^##\s*[\w-]+(?=:)/, "keyword"], [/^#.*$/, "comment"], [/\[[^\]]*\]/, "attribute.value"], [/[\w\\/.\- ]+\.(lua|xml)/, "string"]] },
});

export async function openDoc(path: string): Promise<Doc> {
  const existing = docs.get(path);
  if (existing) return existing;
  const f = await ipc.readFile(path);
  const uri = monaco.Uri.from({ scheme: "wfs", path: "/" + path });
  const model = monaco.editor.createModel(f.content, languageFor(path), uri);
  const doc: Doc = { model, saved: f.content };
  docs.set(path, doc);
  model.onDidChangeContent(() => {
    const t = store.tabs.find((x) => x.path === path);
    if (t) t.dirty = model.getValue() !== doc.saved;
    if (path.toLowerCase().endsWith(".lua")) scheduleCheck(path);
  });
  if (path.toLowerCase().endsWith(".lua")) scheduleCheck(path, 0);
  return doc;
}

export function scheduleCheck(path: string, delay = 450) {
  clearTimeout(timers.get(path));
  timers.set(path, setTimeout(async () => {
    const d = docs.get(path);
    if (!d) return;
    try {
      const r = await ipc.checkBuffer(path, d.model.getValue());
      store.bufferDiags[path] = r.diagnostics;
      monaco.editor.setModelMarkers(d.model, "wfs", fitMarkers(d.model, toMarkers(r.diagnostics)));
    } catch { /* keep previous markers */ }
  }, delay));
}

export async function saveDoc(path: string): Promise<boolean> {
  const d = docs.get(path);
  if (!d) return false;
  const content = d.model.getValue();
  try {
    await ipc.writeFile(path, content);
    d.saved = content;
    const t = store.tabs.find((x) => x.path === path);
    if (t) t.dirty = false;
    store.say("ok", `Saved ${path}`);
    return true;
  } catch (e) { store.fail(e); return false; }
}

export function closeDoc(path: string) {
  const d = docs.get(path);
  if (d) { d.model.dispose(); docs.delete(path); }
  delete store.bufferDiags[path];
}
export function disposeAll() { for (const p of [...docs.keys()]) closeDoc(p); }
export { monaco };
