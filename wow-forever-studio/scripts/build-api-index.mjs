// Builds data/forever-api-index.json from vendored source snapshots. Deterministic; no network.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "data", "sources");
const readJson = (f) => {
  const buf = readFileSync(join(srcDir, f));
  return { json: JSON.parse(buf.toString("utf8")), sha256: createHash("sha256").update(buf).digest("hex") };
};
const main = readJson("wow-addons-api.json");
const kit = readJson("forever-addon-kit-api.json");
const sourcesMeta = JSON.parse(readFileSync(join(srcDir, "SOURCES.json"), "utf8")).sources;

const param = (p) => {
  const o = { n: p.name, t: p.type };
  if (p.innerType) o.i = p.innerType;
  if (p.nilable) o.o = 1;
  if (p.documentation) o.d = p.documentation;
  return o;
};
const sigOf = (name, f) => {
  const a = f.arguments.map((x) => `${x.name}${x.nilable ? "?" : ""}: ${x.type}${x.innerType ? `<${x.innerType}>` : ""}`).join(", ");
  const r = f.returns.map((x) => `${x.type}${x.innerType ? `<${x.innerType}>` : ""}${x.nilable ? "?" : ""}`).join(", ");
  return `${name}(${a})${r ? " -> " + r : ""}`;
};

/** SRC bits: 1 = documented in APIDocumentation export, 2 = present in globals dump, 4 = present in kit capture */
const functions = new Map(); // fullName -> entry
const add = (full, patch) => {
  const cur = functions.get(full) ?? { name: full, src: 0 };
  Object.assign(cur, patch, { src: cur.src | (patch.src ?? 0) });
  functions.set(full, cur);
};

const events = [];
const types = [];
for (const s of main.json.systems) {
  const ns = s.namespace ?? null;
  for (const f of s.functions) {
    const full = ns ? `${ns}.${f.name}` : f.name;
    const e = { src: 1, ns, system: s.name, sig: sigOf(f.name, f), args: f.arguments.map(param), rets: f.returns.map(param) };
    if (f.documentation) e.doc = f.documentation;
    if (f.isRestricted || f.restricted) e.restricted = true;
    add(full, e);
  }
  for (const ev of s.events) {
    events.push({ name: ev.literalName, system: s.name, ns, payload: ev.payload.map(param), ...(ev.documentation ? { doc: ev.documentation } : {}) });
  }
  for (const t of s.tables) {
    const e = { name: t.name, kind: String(t.type).toLowerCase(), system: s.name, ns };
    if (t.type === "Enumeration") e.values = t.fields.map((f) => [f.name, f.enumValue]);
    else e.fields = (t.fields ?? []).map(param);
    types.push(e);
  }
}
let globalFunctionCount = 0;
for (const [name, v] of Object.entries(main.json.globals)) {
  if (v === "function") { add(name, { src: 2 }); globalFunctionCount++; }
  else if (Array.isArray(v)) for (const fn of v) add(`${name}.${fn}`, { src: 2, ns: name });
}
const kitNamespaces = kit.json.namespaces;
for (const n of kit.json.functions) add(n, { src: 4 });
for (const [ns, fns] of Object.entries(kitNamespaces)) for (const fn of fns) add(`${ns}.${fn}`, { src: 4, ns });

const fnList = [...functions.values()].sort((a, b) => a.name.localeCompare(b.name));
const namespaces = [...new Set(fnList.map((f) => f.ns).filter(Boolean))].sort();
events.sort((a, b) => a.name.localeCompare(b.name));
types.sort((a, b) => a.name.localeCompare(b.name));

const index = {
  schema: 1,
  meta: {
    ...main.json.meta,
    generatedBy: "scripts/build-api-index.mjs",
    sources: sourcesMeta.map((s) => ({ ...s, sha256: (s.file === "wow-addons-api.json" ? main : kit).sha256 })),
    kitClient: kit.json.client,
    counts: { functions: fnList.length, documentedFunctions: fnList.filter((f) => f.src & 1).length, events: events.length, types: types.length, namespaces: namespaces.length },
    notes: [
      "src bitmask: 1 = documented in the client APIDocumentation export (signature known), 2 = listed in the globals dump, 4 = captured by forever-addon-kit.",
      "A name with no signature is PRESENT in a capture but its parameters are undocumented, not unsupported.",
      "Presence in the capture does not mean callable from addons: protected, secret-value and combat-lockdown rules still apply. See compat notes.",
    ],
  },
  namespaces,
  functions: fnList,
  events,
  types,
};
const out = JSON.stringify(index);
writeFileSync(join(root, "data", "forever-api-index.json"), out);
console.log(`wrote data/forever-api-index.json  ${(out.length / 1e6).toFixed(2)} MB`, index.meta.counts);
