// The AI never edits the scene directly. It emits these typed actions; `applyActions` validates and applies them to a *copy*
// of the scene, all-or-nothing, so an invalid batch changes nothing and the errors can be fed back to the model for repair.
import { addNode, childrenOf, deleteNode, descendants, instantiate, isContainer, KINDS, LAYERS, POINTS, STRATA, type Anchor, type Binding, type Kind, type Rgba, type Scene, type SceneNode, type Template, validateScene } from "../scene";
import { setRect, solve } from "../layout";
import { SUPPORT } from "../sim/bind";
import { mergeScenarios } from "../sim/scenarios";
import type { Scenario } from "../sim/types";

export interface ActionError { index: number; op: string; message: string }
export interface ApplyResult { scene: Scene; created: string[]; changed: string[]; removed: string[]; scenarioId?: string; errors: ActionError[] }

const MAX_ACTIONS = 200, MAX_NODES = 600, MAX_TEXT = 200;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, what: string): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} must be a number`); if (v < lo || v > hi) throw new Error(`${what} must be between ${lo} and ${hi}`); return v; };
const str = (v: unknown, what: string, max = MAX_TEXT): string => { if (typeof v !== "string") throw new Error(`${what} must be a string`); if (v.length > max) throw new Error(`${what} is longer than ${max} characters`); if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error(`${what} contains control characters`); return v; };
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T => { if (typeof v !== "string" || !list.includes(v as T)) throw new Error(`${what} must be one of ${list.join(", ")}`); return v as T; };
const color = (v: unknown, what: string): Rgba => { if (!Array.isArray(v) || v.length !== 4) throw new Error(`${what} must be [r,g,b,a] with values 0..1`); return v.map((x, i) => num(x, 0, 1, `${what}[${i}]`)) as Rgba; };

/** Resolve a node by its (unique) name. Names the batch created are mapped to the actual unique names. */
class Ctx {
  alias = new Map<string, string>();
  constructor(public scene: Scene, public templates: Template[]) {}
  find(name: unknown, what: string): SceneNode {
    const n = str(name, what, 80);
    const real = this.alias.get(n) ?? n;
    const hit = Object.values(this.scene.nodes).find((x) => x.name === real);
    if (!hit) throw new Error(`${what} "${n}" does not exist (names are case-sensitive; create it first)`);
    return hit;
  }
}

const PROP_VALIDATORS: Record<string, (n: SceneNode, v: unknown) => void> = {
  width: (n, v) => { n.width = num(v, 0, 4096, "width"); },
  height: (n, v) => { n.height = num(v, 0, 4096, "height"); },
  strata: (n, v) => { n.strata = oneOf(v, STRATA, "strata"); },
  level: (n, v) => { n.level = Math.round(num(v, -50, 50, "level")); },
  layer: (n, v) => { n.layer = oneOf(v, LAYERS, "layer"); },
  alpha: (n, v) => { n.alpha = num(v, 0, 1, "alpha"); },
  hidden: (n, v) => { if (typeof v !== "boolean") throw new Error("hidden must be true or false"); n.hidden = v; },
  global: (n, v) => { if (typeof v !== "boolean") throw new Error("global must be true or false"); n.global = v; },
  color: (n, v) => { n.color = color(v, "color"); },
  barColor: (n, v) => { n.barColor = color(v, "barColor"); },
  text: (n, v) => { n.text = str(v, "text"); },
  font: (n, v) => { n.font = str(v, "font", 260); },
  fontSize: (n, v) => { n.fontSize = num(v, 4, 96, "fontSize"); },
  outline: (n, v) => { n.outline = oneOf(v, ["", "OUTLINE", "THICKOUTLINE"] as const, "outline"); },
  justify: (n, v) => { n.justify = oneOf(v, ["LEFT", "CENTER", "RIGHT"] as const, "justify"); },
  texture: (n, v) => { n.texture = str(v, "texture", 260); },
  min: (n, v) => { n.min = num(v, -1e9, 1e9, "min"); },
  max: (n, v) => { n.max = num(v, -1e9, 1e9, "max"); },
  value: (n, v) => { n.value = num(v, -1e9, 1e9, "value"); },
  blend: (n, v) => { n.blend = oneOf(v, ["BLEND", "ADD"] as const, "blend"); },
  border: (n, v) => { if (v === null) { delete n.border; return; } if (!isObj(v)) throw new Error("border must be {size,color} or null"); n.border = { size: num(v.size, 1, 16, "border.size"), color: color(v.color ?? [0, 0, 0, 1], "border.color") }; },
  shadow: (n, v) => { if (v === null) { delete n.shadow; return; } if (!isObj(v)) throw new Error("shadow must be {size,alpha} or null"); n.shadow = { size: num(v.size, 1, 32, "shadow.size"), alpha: num(v.alpha ?? 0.45, 0, 1, "shadow.alpha") }; },
  pulse: (n, v) => { if (v === null) { delete n.pulse; return; } if (!isObj(v)) throw new Error("pulse must be {high,low,period} or null"); n.pulse = { high: num(v.high ?? 1, 0, 1, "pulse.high"), low: num(v.low ?? 0.3, 0, 1, "pulse.low"), period: num(v.period ?? 1.1, 0.1, 30, "pulse.period") }; },
};

function setProps(n: SceneNode, props: unknown) {
  if (!isObj(props)) throw new Error("props must be an object");
  for (const [k, v] of Object.entries(props)) {
    const f = own(PROP_VALIDATORS, k) ? PROP_VALIDATORS[k] : undefined;
    if (!f) throw new Error(`unknown property "${k}" (allowed: ${Object.keys(PROP_VALIDATORS).join(", ")})`);
    f(n, v);
  }
}

function anchorsFrom(ctx: Ctx, self: SceneNode, v: unknown): Anchor[] {
  if (!Array.isArray(v) || v.length > 4) throw new Error("anchors must be an array of 0 to 4 anchors");
  return v.map((a, i) => {
    if (!isObj(a)) throw new Error(`anchors[${i}] must be an object`);
    let relTo: string | null = null;
    if (a.relTo !== undefined && a.relTo !== null && a.relTo !== "") {
      const t = ctx.find(a.relTo, `anchors[${i}].relTo`);
      if (t.id === self.id) throw new Error(`anchors[${i}].relTo cannot be the element itself`);
      relTo = t.id;
    }
    const point = oneOf(a.point, POINTS, `anchors[${i}].point`);
    return { point, relTo, relPoint: oneOf(a.relPoint ?? point, POINTS, `anchors[${i}].relPoint`), x: Math.round(num(a.x ?? 0, -8192, 8192, `anchors[${i}].x`)), y: Math.round(num(a.y ?? 0, -8192, 8192, `anchors[${i}].y`)) };
  });
}

function bindingFrom(v: unknown, n: SceneNode): Binding | undefined {
  if (v === null) return undefined;
  if (!isObj(v)) throw new Error("bind must be an object or null");
  const stat = str(v.stat, "bind.stat", 40);
  const sup = own(SUPPORT, stat) ? SUPPORT[stat] : undefined;
  if (!sup) throw new Error(`bind.stat "${stat}" is not supported. Supported: ${Object.keys(SUPPORT).join(", ")}`);
  if (!sup.kinds.includes(n.kind)) throw new Error(`bind.stat "${stat}" can only drive ${sup.kinds.join("/")} elements, not ${n.kind}`);
  const unit = str(v.unit ?? "$unit", "bind.unit", 20);
  if (!/^(\$unit|player|target|focus|pet|party[1-4]|raid([1-9]|[1-3][0-9]|40))$/.test(unit)) throw new Error(`bind.unit "${unit}" is not a supported unit (player, target, party1-4, raid1-40, $unit)`);
  const b: Binding = { unit, stat };
  if (v.slot !== undefined) b.slot = Math.round(num(v.slot, 0, 39, "bind.slot"));
  if (v.aura !== undefined) b.aura = oneOf(v.aura, ["buff", "debuff"] as const, "bind.aura");
  if (v.threshold !== undefined) b.threshold = num(v.threshold, 0, 100, "bind.threshold");
  if (v.colorBy !== undefined) b.colorBy = oneOf(v.colorBy, ["class", "classBar", "threshold", "none"] as const, "bind.colorBy");
  if (v.fixedColor !== undefined) b.fixedColor = color(v.fixedColor, "bind.fixedColor");
  return b;
}

type Handler = (ctx: Ctx, a: Record<string, unknown>, out: ApplyResult) => void;
const touch = (out: ApplyResult, n: SceneNode) => { if (!out.created.includes(n.name) && !out.changed.includes(n.name)) out.changed.push(n.name); };

const HANDLERS: Record<string, Handler> = {
  addNode(ctx, a, out) {
    const kind = oneOf(a.kind, KINDS, "kind") as Kind;
    if (Object.keys(ctx.scene.nodes).length >= MAX_NODES) throw new Error(`scene is limited to ${MAX_NODES} elements`);
    let parent: SceneNode | null = null;
    if (a.parent !== undefined && a.parent !== null && a.parent !== "") {
      parent = ctx.find(a.parent, "parent");
      if (!isContainer(parent.kind)) throw new Error(`parent "${parent.name}" is a ${parent.kind}; only frame, button and statusbar can contain elements`);
    }
    if (!parent && !isContainer(kind)) throw new Error(`a ${kind} must be inside a frame; give it a parent`);
    const wanted = a.name === undefined ? undefined : str(a.name, "name", 60);
    const n = addNode(ctx.scene, kind, parent?.id ?? null, wanted ? { name: wanted } : {});
    if (wanted) ctx.alias.set(wanted, n.name);
    if (a.props !== undefined) setProps(n, a.props);
    if (a.anchors !== undefined) n.anchors = anchorsFrom(ctx, n, a.anchors);
    if (a.bind !== undefined) { const b = bindingFrom(a.bind, n); if (b) n.bind = b; }
    if (a.repeat !== undefined && a.repeat !== null) {
      if (!isObj(a.repeat) || !isContainer(n.kind)) throw new Error("repeat must be an object and the element must be a frame");
      n.repeat = { kind: oneOf(a.repeat.kind, ["party", "raid"] as const, "repeat.kind"), count: Math.round(num(a.repeat.count ?? 0, 0, 40, "repeat.count")), columns: Math.round(num(a.repeat.columns ?? 1, 1, 40, "repeat.columns")), gapX: num(a.repeat.gapX ?? 4, -200, 200, "repeat.gapX"), gapY: num(a.repeat.gapY ?? 4, -200, 200, "repeat.gapY") };
    }
    out.created.push(n.name);
  },
  setProps(ctx, a, out) { const n = ctx.find(a.target, "target"); setProps(n, a.props); touch(out, n); },
  setAnchors(ctx, a, out) { const n = ctx.find(a.target, "target"); n.anchors = anchorsFrom(ctx, n, a.anchors); touch(out, n); },
  setBinding(ctx, a, out) { const n = ctx.find(a.target, "target"); const b = bindingFrom(a.bind, n); if (b) n.bind = b; else delete n.bind; touch(out, n); },
  setRepeat(ctx, a, out) {
    const n = ctx.find(a.target, "target");
    if (a.repeat === null) { delete n.repeat; touch(out, n); return; }
    if (!isObj(a.repeat) || !isContainer(n.kind)) throw new Error("repeat must be an object and the element must be a frame");
    n.repeat = { kind: oneOf(a.repeat.kind, ["party", "raid"] as const, "repeat.kind"), count: Math.round(num(a.repeat.count ?? 0, 0, 40, "repeat.count")), columns: Math.round(num(a.repeat.columns ?? 1, 1, 40, "repeat.columns")), gapX: num(a.repeat.gapX ?? 4, -200, 200, "repeat.gapX"), gapY: num(a.repeat.gapY ?? 4, -200, 200, "repeat.gapY") };
    touch(out, n);
  },
  addTemplate(ctx, a, out) {
    const want = str(a.template, "template", 80).toLowerCase();
    const t = ctx.templates.find((x) => x.id.toLowerCase() === want || x.name.toLowerCase() === want);
    if (!t) throw new Error(`template "${a.template}" does not exist. Available: ${ctx.templates.map((x) => x.name).join(", ")}`);
    let parent: SceneNode | null = null;
    if (a.parent !== undefined && a.parent !== null && a.parent !== "") { parent = ctx.find(a.parent, "parent"); if (!isContainer(parent.kind)) throw new Error(`parent "${parent.name}" cannot contain elements`); }
    if (Object.keys(ctx.scene.nodes).length + t.nodes.length > MAX_NODES) throw new Error(`scene is limited to ${MAX_NODES} elements`);
    const before = new Set(Object.keys(ctx.scene.nodes));
    const rootId = instantiate(ctx.scene, structuredClone(t), parent?.id ?? null);
    const root = ctx.scene.nodes[rootId]!;
    if (a.name !== undefined) { const wanted = str(a.name, "name", 60); const taken = Object.values(ctx.scene.nodes).some((x) => x.id !== root.id && x.name === wanted); if (taken) throw new Error(`name "${wanted}" is already used`); ctx.alias.set(wanted, root.name); root.name = wanted; }
    if (a.at !== undefined) {
      if (!isObj(a.at)) throw new Error("at must be {x,y} (offset from the parent's or screen's bottom-left)");
      const x = Math.round(num(a.at.x, -8192, 8192, "at.x")), y = Math.round(num(a.at.y, -8192, 8192, "at.y"));
      root.anchors = [{ point: "BOTTOMLEFT", relTo: null, relPoint: "BOTTOMLEFT", x, y }];
    }
    for (const id of Object.keys(ctx.scene.nodes)) if (!before.has(id)) { const n = ctx.scene.nodes[id]!; if (id === rootId) out.created.push(n.name); }
  },
  deleteNode(ctx, a, out) { const n = ctx.find(a.target, "target"); const names = [n, ...descendants(ctx.scene, n.id).map((i) => ctx.scene.nodes[i]!)].map((x) => x.name); deleteNode(ctx.scene, n.id); out.removed.push(...names); },
  reparent(ctx, a, out) {
    const n = ctx.find(a.target, "target");
    const np = a.parent === null || a.parent === "" ? null : ctx.find(a.parent, "parent");
    if (np && (!isContainer(np.kind) || np.id === n.id || descendants(ctx.scene, n.id).includes(np.id))) throw new Error(`"${n.name}" cannot be moved under "${np.name}"`);
    if (!np && !isContainer(n.kind)) throw new Error(`a ${n.kind} must stay inside a frame`);
    const solved = solve(ctx.scene), rect = solved.rects.get(n.id);
    n.parent = np?.id ?? null;
    n.anchors = [{ point: "BOTTOMLEFT", relTo: null, relPoint: "BOTTOMLEFT", x: 0, y: 0 }];
    if (rect) setRect(ctx.scene, n.id, rect, solved);
    ctx.scene.order = ctx.scene.order.filter((i) => i !== n.id).concat(n.id);
    touch(out, n);
  },
  setScenario(ctx, a, out) {
    const list = mergeScenarios(ctx.scene.scenarios);
    const id = str(a.id, "id", 60);
    const base = list.find((s) => s.id === id);
    if (!base) throw new Error(`scenario "${id}" does not exist. Available: ${list.map((s) => s.id).join(", ")}`);
    out.scenarioId = id;
    if (a.params !== undefined) {
      if (!isObj(a.params)) throw new Error("params must be an object");
      const o: Scenario = structuredClone(base);
      for (const [k, v] of Object.entries(a.params)) {
        if (!own(base, k) || k === "id" || k === "name" || k === "description") throw new Error(`unknown scenario parameter "${k}"`);
        const cur = (base as unknown as Record<string, unknown>)[k];
        if (typeof cur === "number") (o as unknown as Record<string, unknown>)[k] = num(v, -1e9, 1e9, k);
        else if (typeof cur === "boolean") { if (typeof v !== "boolean") throw new Error(`${k} must be true or false`); (o as unknown as Record<string, unknown>)[k] = v; }
        else (o as unknown as Record<string, unknown>)[k] = str(v, k, 80);
      }
      if (o.group === "party" && !(o.groupSize >= 1 && o.groupSize <= 5)) throw new Error("a party has 1 to 5 members");
      if (o.group === "raid" && !(o.groupSize >= 1 && o.groupSize <= 40)) throw new Error("a raid has 1 to 40 members");
      ctx.scene.scenarios = [...(ctx.scene.scenarios ?? []).filter((s) => s.id !== id), o];
    }
  },
  setResolution(ctx, a) {
    ctx.scene.resolution = { w: Math.round(num(a.w, 640, 7680, "w")), h: Math.round(num(a.h, 360, 4320, "h")) };
    if (a.uiScale !== undefined) ctx.scene.uiScale = num(a.uiScale, 0.4, 2, "uiScale");
  },
};
export const ACTION_OPS = Object.keys(HANDLERS);

/** Validate and apply a batch to a copy of `scene`. If any action fails, `errors` is non-empty and `scene` is the unchanged input copy. */
export function applyActions(scene: Scene, raw: unknown, templates: Template[]): ApplyResult {
  const original = structuredClone(scene);
  const out: ApplyResult = { scene: original, created: [], changed: [], removed: [], errors: [] };
  if (!Array.isArray(raw)) { out.errors.push({ index: -1, op: "", message: "actions must be an array" }); return out; }
  if (raw.length > MAX_ACTIONS) { out.errors.push({ index: -1, op: "", message: `at most ${MAX_ACTIONS} actions per turn` }); return out; }
  const work = structuredClone(scene);
  const ctx = new Ctx(work, templates);
  const draft: ApplyResult = { scene: work, created: [], changed: [], removed: [], errors: [] };
  raw.forEach((a, index) => {
    const op = isObj(a) && typeof a.op === "string" ? a.op : "";
    try {
      if (!isObj(a)) throw new Error("each action must be an object");
      const h = Object.prototype.hasOwnProperty.call(HANDLERS, op) ? HANDLERS[op] : undefined;
      if (!h) throw new Error(`unknown op "${op}". Allowed: ${ACTION_OPS.join(", ")}`);
      h(ctx, a, draft);
    } catch (e) { draft.errors.push({ index, op, message: e instanceof Error ? e.message : String(e) }); }
  });
  if (draft.errors.length) { out.errors = draft.errors; return out; }
  try { validateScene(JSON.parse(JSON.stringify(work))); } catch (e) { out.errors.push({ index: -1, op: "", message: `resulting scene is invalid: ${e instanceof Error ? e.message : e}` }); return out; }
  const unsolved = solve(work).errors;
  if (unsolved.size) { for (const [id, m] of unsolved) if (m.includes("cycle")) { out.errors.push({ index: -1, op: "", message: `anchor cycle at "${work.nodes[id]?.name}"` }); } if (out.errors.length) return out; }
  draft.created = draft.created.filter((n) => Object.values(work.nodes).some((x) => x.name === n));
  return draft;
}

/** Pull the first JSON object out of a model reply (fenced or raw). Returns null if there is none. */
export function extractJson(text: string): unknown | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fenced ? [fenced[1]!] : [];
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i]!;
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { candidates.push(text.slice(start, i + 1)); break; } }
    }
  }
  for (const c of candidates) { try { return JSON.parse(c); } catch { /* try the next candidate */ } }
  return null;
}

export const _childrenOf = childrenOf; // re-export for tests that inspect hierarchy
