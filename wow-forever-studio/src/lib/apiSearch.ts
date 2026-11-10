import type { ApiIndex, ApiFunction, ApiEvent, ApiType, CompatNote } from "./types";

export type ApiKind = "function" | "event" | "type" | "namespace";
export interface ApiHit { kind: ApiKind; name: string; summary: string; fn?: ApiFunction; ev?: ApiEvent; ty?: ApiType; score: number }

/** Human label for how well a function is documented. Never "unsupported": absence of a signature is only missing documentation. */
export function provenance(src: number): string {
  const parts: string[] = [];
  if (src & 1) parts.push("documented in client APIDocumentation export");
  if (src & 2) parts.push("in globals dump");
  if (src & 4) parts.push("captured by forever-addon-kit");
  return parts.join(" · ") || "unknown";
}

function score(hay: string, q: string): number {
  const h = hay.toLowerCase();
  if (h === q) return 100;
  if (h.endsWith("." + q)) return 90;
  if (h.startsWith(q)) return 80;
  const i = h.indexOf(q);
  if (i >= 0) return 60 - Math.min(i, 30) / 2;
  return 0;
}

export function searchApi(index: ApiIndex, query: string, kinds: Set<ApiKind> = new Set(["function", "event", "type", "namespace"]), limit = 200): ApiHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: ApiHit[] = [];
  const terms = q.split(/\s+/);
  const match = (name: string, doc?: string): number => {
    let total = 0;
    for (const t of terms) {
      let s = score(name, t);
      if (!s && doc && doc.toLowerCase().includes(t)) s = 10;
      if (!s) return 0;
      total += s;
    }
    return total / terms.length;
  };
  if (kinds.has("function")) for (const fn of index.functions) { const s = match(fn.name, fn.doc); if (s) hits.push({ kind: "function", name: fn.name, summary: fn.sig ?? "(signature not documented)", fn, score: s }); }
  if (kinds.has("event")) for (const ev of index.events) { const s = match(ev.name, ev.doc); if (s) hits.push({ kind: "event", name: ev.name, summary: `${ev.system} event`, ev, score: s }); }
  if (kinds.has("type")) for (const ty of index.types) { const s = match(ty.name); if (s) hits.push({ kind: "type", name: ty.name, summary: ty.kind, ty, score: s }); }
  if (kinds.has("namespace")) for (const ns of index.namespaces) { const s = match(ns); if (s) hits.push({ kind: "namespace", name: ns, summary: "namespace", score: s }); }
  hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

export function lookupFunction(index: ApiIndex, name: string): ApiFunction | undefined {
  return fnMap(index).get(name);
}
const maps = new WeakMap<ApiIndex, Map<string, ApiFunction>>();
function fnMap(index: ApiIndex) {
  let m = maps.get(index);
  if (!m) { m = new Map(index.functions.map((f) => [f.name, f])); maps.set(index, m); }
  return m;
}

export function notesFor(notes: CompatNote[], name: string): CompatNote[] {
  const short = name.split(".")[0] ?? name;
  return notes.filter((n) => n.names?.includes(name) || n.names?.includes(short));
}

export function namespaceFunctions(index: ApiIndex, ns: string): ApiFunction[] {
  return index.functions.filter((f) => f.ns === ns);
}
