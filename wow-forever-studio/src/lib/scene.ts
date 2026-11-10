// Canonical scene model. The designer, the code generator and the preview all consume this and nothing else.
export const SCENE_VERSION = 1;

export const POINTS = ["TOPLEFT", "TOP", "TOPRIGHT", "LEFT", "CENTER", "RIGHT", "BOTTOMLEFT", "BOTTOM", "BOTTOMRIGHT"] as const;
export type Point = (typeof POINTS)[number];
export const KINDS = ["frame", "button", "texture", "fontstring", "statusbar"] as const;
export type Kind = (typeof KINDS)[number];
export const STRATA = ["BACKGROUND", "LOW", "MEDIUM", "HIGH", "DIALOG", "FULLSCREEN", "FULLSCREEN_DIALOG", "TOOLTIP"] as const;
export type Strata = (typeof STRATA)[number];
export const LAYERS = ["BACKGROUND", "BORDER", "ARTWORK", "OVERLAY", "HIGHLIGHT"] as const;
export type Layer = (typeof LAYERS)[number];
export type Rgba = [number, number, number, number];

export interface Anchor { point: Point; relTo: string | null; relPoint: Point; x: number; y: number }

export interface SceneNode {
  id: string;
  kind: Kind;
  /** Used as the Lua key and (when `global`) the frame's global name. Unique within the scene. */
  name: string;
  global: boolean;
  parent: string | null;
  anchors: Anchor[];
  width: number;
  height: number;
  strata: Strata;
  level: number;
  layer: Layer;
  alpha: number;
  hidden: boolean;
  color: Rgba;
  text: string;
  font: string;
  fontSize: number;
  outline: "" | "OUTLINE" | "THICKOUTLINE";
  justify: "LEFT" | "CENTER" | "RIGHT";
  texture: string;
  min: number;
  max: number;
  value: number;
  barColor: Rgba;
  bind?: Binding;
  repeat?: Repeat;
}

/** Preview-only data binding: drives a node from simulated unit state. Never emitted into generated game code. */
export interface Binding {
  /** `$unit` resolves to the unit of the enclosing repeat copy (or `player` outside one). */
  unit: string;
  stat: string;
  slot?: number;
  aura?: "buff" | "debuff";
  threshold?: number;
  colorBy?: "class" | "threshold" | "none";
}
/** Preview-only repeater for group/raid layouts: renders the node's subtree once per unit in a grid. */
export interface Repeat { kind: "party" | "raid"; count: number; columns: number; gapX: number; gapY: number }

export interface Template { id: string; name: string; builtIn?: boolean; nodes: SceneNode[]; rootId: string }

export interface Scene {
  version: number;
  name: string;
  resolution: { w: number; h: number };
  uiScale: number;
  /** Creation order. Within one parent, later nodes draw on top of earlier ones at equal strata/level/layer. */
  order: string[];
  nodes: Record<string, SceneNode>;
  templates: Template[];
  /** Per-scene scenario overrides/additions (editable in the Simulation tab). */
  scenarios?: import("./sim/types").Scenario[];
}

export const CONTAINERS: Kind[] = ["frame", "button", "statusbar"];
export const isContainer = (k: Kind) => CONTAINERS.includes(k);
export const DEFAULT_FONT = "Fonts\\FRIZQT__.TTF";
export const DEFAULT_BAR_TEXTURE = "Interface\\TargetingFrame\\UI-StatusBar";

export function newScene(name = "MainUI"): Scene {
  return { version: SCENE_VERSION, name, resolution: { w: 1920, h: 1080 }, uiScale: 1, order: [], nodes: {}, templates: [] };
}

let counter = 0;
export function newId(): string { counter++; return `n${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`; }

export function sanitizeName(s: string): string {
  let n = s.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(n)) n = "_" + n;
  return n || "Frame";
}

export function uniqueName(scene: Scene, base: string, ignoreId?: string): string {
  const taken = new Set(Object.values(scene.nodes).filter((n) => n.id !== ignoreId).map((n) => n.name));
  const b = sanitizeName(base);
  if (!taken.has(b)) return b;
  let i = 2;
  while (taken.has(`${b}${i}`)) i++;
  return `${b}${i}`;
}

const DEFAULTS: Record<Kind, Partial<SceneNode>> = {
  frame: { width: 200, height: 120, color: [0.08, 0.09, 0.12, 0.85] },
  button: { width: 120, height: 28, color: [0.36, 0.26, 0.8, 1], text: "Button", fontSize: 12 },
  texture: { width: 64, height: 64, color: [0.13, 0.83, 0.93, 1], layer: "ARTWORK" },
  fontstring: { width: 140, height: 16, text: "Label", color: [1, 0.82, 0, 1], fontSize: 14, layer: "OVERLAY" },
  statusbar: { width: 200, height: 18, color: [0.05, 0.05, 0.07, 0.9], barColor: [0.2, 0.8, 0.3, 1], value: 70, texture: DEFAULT_BAR_TEXTURE },
};

export function makeNode(scene: Scene, kind: Kind, parent: string | null, patch: Partial<SceneNode> = {}): SceneNode {
  const id = newId();
  const base: SceneNode = {
    id, kind, name: "", global: false, parent,
    anchors: [{ point: "CENTER", relTo: null, relPoint: "CENTER", x: 0, y: 0 }],
    width: 100, height: 100, strata: "MEDIUM", level: 0, layer: "ARTWORK", alpha: 1, hidden: false,
    color: [1, 1, 1, 1], text: "", font: DEFAULT_FONT, fontSize: 12, outline: "", justify: "CENTER",
    texture: "", min: 0, max: 100, value: 100, barColor: [0.2, 0.8, 0.3, 1],
  };
  const n: SceneNode = { ...base, ...DEFAULTS[kind], ...patch, id };
  n.name = uniqueName(scene, patch.name || kind[0]!.toUpperCase() + kind.slice(1));
  return n;
}

export function addNode(scene: Scene, kind: Kind, parent: string | null, patch: Partial<SceneNode> = {}): SceneNode {
  if (parent) {
    const p = scene.nodes[parent];
    if (!p || !isContainer(p.kind)) throw new Error("only frames, buttons and status bars can contain other elements");
  }
  const n = makeNode(scene, kind, parent, patch);
  if (!parent && kind === "frame") n.global = true;
  scene.nodes[n.id] = n;
  scene.order.push(n.id);
  return n;
}

export const childrenOf = (scene: Scene, id: string | null): SceneNode[] =>
  scene.order.map((i) => scene.nodes[i]!).filter((n) => n && n.parent === id);

export function descendants(scene: Scene, id: string): string[] {
  const out: string[] = [];
  const walk = (i: string) => { for (const c of childrenOf(scene, i)) { out.push(c.id); walk(c.id); } };
  walk(id);
  return out;
}

export function deleteNode(scene: Scene, id: string) {
  const doomed = new Set([id, ...descendants(scene, id)]);
  const parent = scene.nodes[id]?.parent ?? null;
  for (const d of doomed) delete scene.nodes[d];
  scene.order = scene.order.filter((i) => !doomed.has(i));
  // anchors that pointed at a deleted sibling fall back to the parent
  for (const n of Object.values(scene.nodes)) for (const a of n.anchors) if (a.relTo && doomed.has(a.relTo)) a.relTo = null;
  void parent;
}

export function setName(scene: Scene, id: string, name: string) {
  const n = scene.nodes[id];
  if (n) n.name = uniqueName(scene, name, id);
}

/** Move within siblings: positive = towards front. */
export function reorder(scene: Scene, id: string, delta: number) {
  const n = scene.nodes[id];
  if (!n) return;
  const sibs = childrenOf(scene, n.parent).map((s) => s.id);
  const i = sibs.indexOf(id);
  const j = Math.max(0, Math.min(sibs.length - 1, i + delta));
  if (i === j) return;
  const other = sibs[j]!;
  const a = scene.order.indexOf(id), b = scene.order.indexOf(other);
  scene.order.splice(a, 1);
  scene.order.splice(scene.order.indexOf(other) + (b > a ? 1 : 0), 0, id);
}

/** Deep-copy a subtree with fresh ids and unique names. Returns the new root id. */
export function cloneSubtree(scene: Scene, nodes: SceneNode[], rootId: string, newParent: string | null): string {
  const map = new Map<string, string>();
  for (const n of nodes) map.set(n.id, newId());
  const names = new Set(Object.values(scene.nodes).map((n) => n.name));
  for (const n of nodes) {
    const c: SceneNode = structuredClone(n);
    c.id = map.get(n.id)!;
    c.parent = n.id === rootId ? newParent : (n.parent ? map.get(n.parent) ?? newParent : newParent);
    let nm = sanitizeName(n.name), i = 2;
    const base = nm;
    while (names.has(nm)) nm = `${base}${i++}`;
    names.add(nm);
    c.name = nm;
    for (const a of c.anchors) a.relTo = a.relTo ? map.get(a.relTo) ?? null : null;
    scene.nodes[c.id] = c;
    scene.order.push(c.id);
  }
  return map.get(rootId)!;
}

export function subtreeNodes(scene: Scene, id: string): SceneNode[] {
  return [id, ...descendants(scene, id)].map((i) => scene.nodes[i]!).filter(Boolean);
}

export function duplicate(scene: Scene, id: string): string {
  const n = scene.nodes[id]!;
  const newRoot = cloneSubtree(scene, subtreeNodes(scene, id), id, n.parent);
  const root = scene.nodes[newRoot]!;
  for (const a of root.anchors) { a.x += 12; a.y -= 12; }
  return newRoot;
}

export function saveAsTemplate(scene: Scene, id: string, name: string): Template {
  const nodes = structuredClone(subtreeNodes(scene, id));
  const t: Template = { id: newId(), name, nodes, rootId: id };
  scene.templates.push(t);
  return t;
}

export function instantiate(scene: Scene, t: Template, parent: string | null): string {
  const root = cloneSubtree(scene, structuredClone(t.nodes), t.rootId, parent);
  if (!parent) { const r = scene.nodes[root]!; if (r.kind === "frame") r.global = true; }
  return root;
}

export function validateScene(s: unknown): Scene {
  const sc = s as Scene;
  if (!sc || typeof sc !== "object" || sc.version !== SCENE_VERSION || typeof sc.nodes !== "object" || !Array.isArray(sc.order)) throw new Error("not a version-1 scene file");
  for (const id of sc.order) if (!sc.nodes[id]) throw new Error(`scene order references missing node ${id}`);
  for (const n of Object.values(sc.nodes)) {
    if (!KINDS.includes(n.kind)) throw new Error(`unknown node kind '${n.kind}'`);
    if (n.parent && !sc.nodes[n.parent]) throw new Error(`node ${n.name} has a missing parent`);
  }
  sc.templates ??= [];
  return sc;
}
