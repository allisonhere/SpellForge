import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addNode, deleteNode, duplicate, instantiate, newScene, reorder, saveAsTemplate, setName, validateScene, childrenOf } from "./scene";
import { solve, setRect, snapAxis, uiSize } from "./layout";
import { History } from "./history";
import { generate, isGenerated, emitOrder } from "./codegen";
import { builtInTemplates } from "./templates";

const A = (point: any, relPoint: any, x = 0, y = 0, relTo: string | null = null) => ({ point, relPoint, x, y, relTo });

describe("layout solver (WoW anchors, y up)", () => {
  it("places CENTER relative to UIParent", () => {
    const s = newScene(); const f = addNode(s, "frame", null, { width: 200, height: 100, anchors: [A("CENTER", "CENTER")] });
    expect(solve(s).rects.get(f.id)).toEqual({ l: 860, b: 490, w: 200, h: 100 });
  });
  it("TOPLEFT offset: positive y moves up, negative down", () => {
    const s = newScene(); const f = addNode(s, "frame", null, { width: 100, height: 50, anchors: [A("TOPLEFT", "TOPLEFT", 10, -20)] });
    expect(solve(s).rects.get(f.id)).toEqual({ l: 10, b: 1080 - 20 - 50, w: 100, h: 50 });
  });
  it("two anchors derive the size and ignore width/height like the client", () => {
    const s = newScene(); const p = addNode(s, "frame", null, { width: 300, height: 200, anchors: [A("BOTTOMLEFT", "BOTTOMLEFT", 100, 100)] });
    const c = addNode(s, "frame", p.id, { width: 5, height: 5, anchors: [A("TOPLEFT", "TOPLEFT", 10, -10), A("BOTTOMRIGHT", "BOTTOMRIGHT", -10, 10)] });
    expect(solve(s).rects.get(c.id)).toEqual({ l: 110, b: 110, w: 280, h: 180 });
  });
  it("anchors to a sibling's edge", () => {
    const s = newScene(); const p = addNode(s, "frame", null, { anchors: [A("BOTTOMLEFT", "BOTTOMLEFT")] });
    const a = addNode(s, "frame", p.id, { width: 50, height: 50, anchors: [A("BOTTOMLEFT", "BOTTOMLEFT", 20, 20)] });
    const b = addNode(s, "frame", p.id, { width: 30, height: 30, anchors: [A("LEFT", "RIGHT", 6, 0, a.id)] });
    const r = solve(s).rects; expect(r.get(b.id)!.l).toBe(20 + 50 + 6); expect(r.get(b.id)!.b).toBe(20 + 25 - 15);
  });
  it("UI scale changes the logical UIParent size", () => {
    const s = newScene(); s.uiScale = 0.5; expect(uiSize(s)).toEqual({ w: 3840, h: 2160 });
  });
  it("detects anchor cycles instead of hanging", () => {
    const s = newScene(); const p = addNode(s, "frame", null, {}); const a = addNode(s, "frame", p.id, {}); const b = addNode(s, "frame", p.id, {});
    s.nodes[a.id]!.anchors = [A("LEFT", "RIGHT", 0, 0, b.id)]; s.nodes[b.id]!.anchors = [A("LEFT", "RIGHT", 0, 0, a.id)];
    expect([...solve(s).errors.values()].join()).toContain("cycle");
  });
  it("setRect round-trips through the solver for single and double anchors", () => {
    const s = newScene(); const p = addNode(s, "frame", null, { width: 400, height: 300, anchors: [A("CENTER", "CENTER", 5, 5)] });
    const one = addNode(s, "frame", p.id, { width: 80, height: 40, anchors: [A("TOPRIGHT", "TOPRIGHT", -4, -4)] });
    const two = addNode(s, "frame", p.id, { anchors: [A("TOPLEFT", "TOPLEFT", 1, -1), A("BOTTOMRIGHT", "BOTTOMRIGHT", -1, 1)] });
    for (const id of [one.id, two.id]) {
      const solved = solve(s); const r = { ...solved.rects.get(id)! }; r.l += 37; r.b -= 11; if (id === one.id) { r.w += 20; }
      setRect(s, id, r, solved);
      expect(solve(s).rects.get(id)).toEqual(r);
    }
  });
  it("snaps to sibling edges, then grid", () => {
    expect(snapAxis([103], [100, 200], 8, 4, true)).toEqual({ delta: -3, guide: 100 });
    expect(snapAxis([53], [], 8, 4, true).delta).toBe(3);
    expect(snapAxis([53], [], 8, 4, false).delta).toBe(0);
  });
});

describe("scene operations", () => {
  it("rejects children under textures and keeps names unique", () => {
    const s = newScene(); const t = addNode(s, "texture", null, {});
    expect(() => addNode(s, "frame", t.id)).toThrow();
    const a = addNode(s, "frame", null, { name: "Box" }); const b = addNode(s, "frame", null, { name: "Box" });
    expect(a.name).toBe("Box"); expect(b.name).toBe("Box2"); setName(s, b.id, "Box"); expect(s.nodes[b.id]!.name).toBe("Box2");
  });
  it("deleting a node removes its subtree and repairs anchors", () => {
    const s = newScene(); const p = addNode(s, "frame", null, {}); const a = addNode(s, "frame", p.id, {}); const k = addNode(s, "texture", a.id, {}); const b = addNode(s, "frame", p.id, {});
    s.nodes[b.id]!.anchors = [A("LEFT", "RIGHT", 0, 0, a.id)];
    deleteNode(s, a.id);
    expect(s.nodes[a.id]).toBeUndefined(); expect(s.nodes[k.id]).toBeUndefined(); expect(s.nodes[b.id]!.anchors[0]!.relTo).toBeNull();
  });
  it("reorder changes z-order among siblings only", () => {
    const s = newScene(); const p = addNode(s, "frame", null, {}); const a = addNode(s, "frame", p.id, {}); const b = addNode(s, "frame", p.id, {});
    reorder(s, a.id, 1); expect(childrenOf(s, p.id).map((n) => n.id)).toEqual([b.id, a.id]);
  });
  it("duplicate and templates instantiate fresh ids/names with internal anchors remapped", () => {
    const s = newScene(); const t = builtInTemplates().find((x) => x.name === "Unit Frame")!;
    const r1 = instantiate(s, t, null), r2 = instantiate(s, t, null);
    expect(r1).not.toBe(r2);
    const names = Object.values(s.nodes).map((n) => n.name); expect(new Set(names).size).toBe(names.length);
    const power = Object.values(s.nodes).filter((n) => n.name.startsWith("Power"));
    for (const p of power) expect(s.nodes[p.anchors[0]!.relTo!]!.name).toMatch(/^Health/);
    expect(power[0]!.anchors[0]!.relTo).not.toBe(power[1]!.anchors[0]!.relTo);
    const d = duplicate(s, r1); expect(Object.keys(s.nodes).length).toBe(10 + 5);
    expect(saveAsTemplate(s, d, "mine").nodes.length).toBe(5);
  });
  it("validates scene files", () => {
    expect(() => validateScene({ version: 2 })).toThrow();
    const s = newScene(); addNode(s, "frame", null, {}); expect(validateScene(JSON.parse(JSON.stringify(s))).order.length).toBe(1);
  });
});

describe("history", () => {
  it("undo/redo with coalesced drags", () => {
    const h = new History<{ x: number }>(); const st = { x: 0 };
    h.begin(st); st.x = 1; st.x = 2; st.x = 3; expect(h.commit(st)).toBe(true);
    h.begin(st); expect(h.commit(st)).toBe(false);
    expect(h.undo(st)).toEqual({ x: 0 }); expect(h.canRedo).toBe(true); expect(h.redo({ x: 0 })).toEqual({ x: 3 });
    expect(h.canUndo).toBe(true);
  });
});

describe("code generation", () => {
  const sample = () => {
    const s = newScene("Demo UI"); for (const t of builtInTemplates()) instantiate(s, t, null);
    const btn = addNode(s, "button", s.order.map((i) => s.nodes[i]!).find((n) => n.name === "UnitFrame")!.id, { text: 'Say "hi"\\now' });
    void btn; return s;
  };
  it("is deterministic, marked as generated, and orders dependencies first", () => {
    const s = sample(); const a = generate(s), b = generate(s);
    expect(a.lua).toBe(b.lua); expect(isGenerated(a.lua)).toBe(true); expect(isGenerated(a.xml)).toBe(true);
    const order = emitOrder(s).map((i) => s.nodes[i]!.name); expect(order.indexOf("Health")).toBeLessThan(order.indexOf("Power"));
    expect(a.lua).toContain("function ns.UI.CreateDemo_UI(parent)");
    expect(a.luaPath).toBe("Generated/Demo_UI.lua");
  });
  it("escapes strings", () => { expect(generate(sample()).lua).toContain('SetText("Say \\"hi\\"\\\\now")'); });
  it("produces syntactically valid Lua (checked with luac -p)", () => {
    const dir = mkdtemp(); const f = join(dir, "gen.lua"); writeFileSync(f, generate(sample()).lua);
    try { execFileSync("luac", ["-p", f], { stdio: "pipe" }); } catch (e: any) { if (e.code === "ENOENT") return; throw new Error(String(e.stderr)); }
  });
  it("emits well-formed-looking XML with named anchors", () => {
    const x = generate(sample()).xml; expect(x).toMatch(/<Anchor point="TOPLEFT" relativeTo="Demo_UI_Health\d*" relativePoint="BOTTOMLEFT">/);
    const opens = (x.match(/<(Frame|StatusBar|Button|Layers|Layer|Anchors)[ >]/g) ?? []).length, closes = (x.match(/<\/(Frame|StatusBar|Button|Layers|Layer|Anchors)>/g) ?? []).length;
    expect(opens).toBe(closes);
  });
  it("warns about elements without anchors", () => {
    const s = newScene(); const f = addNode(s, "frame", null, {}); s.nodes[f.id]!.anchors = [];
    expect(generate(s).warnings.join()).toContain("no anchor");
  });
});
function mkdtemp() { return mkdtempSync(join(tmpdir(), "wfs-")); }
