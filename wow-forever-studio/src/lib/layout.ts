// WoW anchor layout solver. Coordinates are WoW-style: origin bottom-left of UIParent, y grows upward.
import type { Anchor, Point, Scene, SceneNode } from "./scene";

export interface Rect { l: number; b: number; w: number; h: number }
export const right = (r: Rect) => r.l + r.w;
export const top = (r: Rect) => r.b + r.h;

export function uiSize(scene: Pick<Scene, "resolution" | "uiScale">): { w: number; h: number } {
  const s = scene.uiScale > 0 ? scene.uiScale : 1;
  return { w: scene.resolution.w / s, h: scene.resolution.h / s };
}

const hpart = (p: Point): "L" | "C" | "R" => (p.endsWith("LEFT") ? "L" : p.endsWith("RIGHT") ? "R" : "C");
const vpart = (p: Point): "T" | "C" | "B" => (p.startsWith("TOP") ? "T" : p.startsWith("BOTTOM") ? "B" : "C");

export function pointPos(r: Rect, p: Point): { x: number; y: number } {
  const hx = hpart(p), vy = vpart(p);
  return { x: hx === "L" ? r.l : hx === "R" ? right(r) : r.l + r.w / 2, y: vy === "B" ? r.b : vy === "T" ? top(r) : r.b + r.h / 2 };
}

export interface Solved { rects: Map<string, Rect>; errors: Map<string, string> }

export function solve(scene: Scene): Solved {
  const ui = uiSize(scene);
  const root: Rect = { l: 0, b: 0, w: ui.w, h: ui.h };
  const rects = new Map<string, Rect>();
  const errors = new Map<string, string>();
  const visiting = new Set<string>();

  const rectOf = (id: string): Rect => {
    const known = rects.get(id);
    if (known) return known;
    const n = scene.nodes[id];
    if (!n) return root;
    if (visiting.has(id)) { errors.set(id, "anchor cycle"); return { l: 0, b: 0, w: n.width, h: n.height }; }
    visiting.add(id);
    const parentRect = n.parent ? rectOf(n.parent) : root;
    const r = solveNode(n, parentRect, (rel) => (rel ? rectOf(rel) : parentRect));
    if (!n.anchors.length) errors.set(id, "no anchor: the client would not position this element");
    visiting.delete(id);
    rects.set(id, r);
    return r;
  };
  for (const id of scene.order) rectOf(id);
  return { rects, errors };
}

function solveNode(n: SceneNode, parentRect: Rect, relRect: (rel: string | null) => Rect): Rect {
  const hx: { part: "L" | "C" | "R"; x: number }[] = [];
  const vy: { part: "T" | "C" | "B"; y: number }[] = [];
  for (const a of n.anchors) {
    const t = pointPos(relRect(a.relTo), a.relPoint);
    hx.push({ part: hpart(a.point), x: t.x + a.x });
    vy.push({ part: vpart(a.point), y: t.y + a.y });
  }
  let l = parentRect.l, w = n.width;
  const L = hx.find((c) => c.part === "L"), R = hx.find((c) => c.part === "R"), C = hx.find((c) => c.part === "C");
  if (L && R) { l = L.x; w = Math.max(0, R.x - L.x); }
  else if (L) l = L.x;
  else if (R) l = R.x - w;
  else if (C) l = C.x - w / 2;
  let b = parentRect.b, h = n.height;
  const T = vy.find((c) => c.part === "T"), B = vy.find((c) => c.part === "B"), M = vy.find((c) => c.part === "C");
  if (T && B) { b = B.y; h = Math.max(0, T.y - B.y); }
  else if (B) b = B.y;
  else if (T) b = T.y - h;
  else if (M) b = M.y - h / 2;
  return { l, b, w, h };
}

/** Re-express `rect` for node `id` by rewriting anchor offsets (and size) so the solver reproduces it. */
export function setRect(scene: Scene, id: string, rect: Rect, solved: Solved) {
  const n = scene.nodes[id];
  if (!n) return;
  const ui = uiSize(scene);
  const root: Rect = { l: 0, b: 0, w: ui.w, h: ui.h };
  const parentRect = n.parent ? solved.rects.get(n.parent) ?? root : root;
  const twoH = n.anchors.some((a) => hpart(a.point) === "L") && n.anchors.some((a) => hpart(a.point) === "R");
  const twoV = n.anchors.some((a) => vpart(a.point) === "T") && n.anchors.some((a) => vpart(a.point) === "B");
  if (!twoH) n.width = Math.max(0, Math.round(rect.w));
  if (!twoV) n.height = Math.max(0, Math.round(rect.h));
  for (const a of n.anchors) {
    const rel = a.relTo ? solved.rects.get(a.relTo) ?? parentRect : parentRect;
    const target = pointPos(rel, a.relPoint);
    const mine = pointPos(rect, a.point);
    a.x = Math.round(mine.x - target.x);
    a.y = Math.round(mine.y - target.y);
  }
}

export type Guide = { axis: "x" | "y"; pos: number };

/** Snap a moving/resizing line set to sibling edges, then to the grid. Returns the adjustment and the guides to draw. */
export function snapAxis(values: number[], targets: number[], grid: number, threshold: number, gridOn: boolean): { delta: number; guide: number | null } {
  let best: { d: number; g: number } | null = null;
  for (const v of values) for (const t of targets) { const d = t - v; if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, g: t }; }
  if (best) return { delta: best.d, guide: best.g };
  if (gridOn && grid > 0) {
    const v = values[0] ?? 0;
    return { delta: Math.round(v / grid) * grid - v, guide: null };
  }
  return { delta: 0, guide: null };
}

export function edgeTargets(rects: Rect[], axis: "x" | "y"): number[] {
  const out: number[] = [];
  for (const r of rects) {
    if (axis === "x") out.push(r.l, r.l + r.w / 2, right(r));
    else out.push(r.b, r.b + r.h / 2, top(r));
  }
  return out;
}

export const defaultAnchor = (): Anchor => ({ point: "CENTER", relTo: null, relPoint: "CENTER", x: 0, y: 0 });
