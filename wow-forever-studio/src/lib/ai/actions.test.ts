import { describe, expect, it } from "vitest";
import { applyActions, extractJson } from "./actions";
import { addNode, newScene, type Scene } from "../scene";
import { solve } from "../layout";
import { builtInTemplates } from "../templates";

const T = builtInTemplates();
const base = (): Scene => newScene("AI");
const ok = (scene: Scene, actions: unknown) => { const r = applyActions(scene, actions, T); expect(r.errors, JSON.stringify(r.errors)).toEqual([]); return r; };
const bad = (scene: Scene, actions: unknown) => { const r = applyActions(scene, actions, T); expect(r.errors.length).toBeGreaterThan(0); return r; };

describe("applyActions: happy path", () => {
  it("builds a small unit frame from actions and reports what it created", () => {
    const r = ok(base(), [
      { op: "addNode", kind: "frame", name: "Panel", props: { width: 200, height: 50, color: [0.1, 0.1, 0.12, 0.9], border: { size: 1, color: [0, 0, 0, 1] } }, anchors: [{ point: "CENTER", x: 0, y: 0 }] },
      { op: "addNode", kind: "statusbar", name: "Health", parent: "Panel", props: { height: 30 }, anchors: [{ point: "TOPLEFT", relPoint: "TOPLEFT" }, { point: "TOPRIGHT", relPoint: "TOPRIGHT" }], bind: { unit: "player", stat: "health", colorBy: "class" } },
      { op: "addNode", kind: "fontstring", name: "Name", parent: "Health", props: { text: "Player", justify: "LEFT", width: 120, height: 14 }, anchors: [{ point: "LEFT", relPoint: "LEFT", x: 5 }], bind: { unit: "player", stat: "name" } },
    ]);
    expect(r.created).toEqual(["Panel", "Health", "Name"]);
    const s = r.scene, health = Object.values(s.nodes).find((n) => n.name === "Health")!;
    expect(health.bind).toMatchObject({ stat: "health", colorBy: "class" });
    expect(solve(s).rects.get(health.id)!.w).toBe(200);
  });
  it("does not mutate the input scene", () => {
    const s = base(); const before = JSON.stringify(s);
    ok(s, [{ op: "addNode", kind: "frame", name: "A" }]);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("resolves names the batch created, including after a name collision", () => {
    const s = base(); addNode(s, "frame", null, { name: "Box" });
    const r = ok(s, [{ op: "addNode", kind: "frame", name: "Box" }, { op: "setProps", target: "Box", props: { width: 77 } }]);
    const boxes = Object.values(r.scene.nodes).filter((n) => n.name.startsWith("Box"));
    expect(boxes.map((b) => b.name).sort()).toEqual(["Box", "Box2"]);
    expect(boxes.find((b) => b.name === "Box2")!.width).toBe(77); // the alias points at the one this batch created
  });
  it("adds Tempus templates by name, repositions them, and can rename the root", () => {
    const r = ok(base(), [{ op: "addTemplate", template: "Tempus Player Frame", name: "MyPlayer", at: { x: 200, y: 300 } }]);
    const root = Object.values(r.scene.nodes).find((n) => n.name === "MyPlayer")!;
    expect(root.anchors[0]).toMatchObject({ point: "BOTTOMLEFT", x: 200, y: 300 });
    expect(Object.keys(r.scene.nodes).length).toBe(17);
    expect(r.created).toEqual(["MyPlayer"]);
  });
  it("sets a scenario with validated parameters and stores the override in the scene", () => {
    const r = ok(base(), [{ op: "setScenario", id: "party-5", params: { damageEveryMs: 400, seed: 7 } }]);
    expect(r.scenarioId).toBe("party-5");
    expect(r.scene.scenarios!.find((s) => s.id === "party-5")).toMatchObject({ damageEveryMs: 400, seed: 7 });
  });
  it("deleting a node reports the whole removed subtree", () => {
    const s = base(); const f = addNode(s, "frame", null, { name: "F" }); addNode(s, "texture", f.id, { name: "T" });
    const r = ok(s, [{ op: "deleteNode", target: "F" }]);
    expect(r.removed.sort()).toEqual(["F", "T"]); expect(Object.keys(r.scene.nodes)).toHaveLength(0);
  });
  it("reparenting keeps the element where it was on screen", () => {
    const s = base(); const a = addNode(s, "frame", null, { name: "A", width: 100, height: 100, anchors: [{ point: "BOTTOMLEFT", relTo: null, relPoint: "BOTTOMLEFT", x: 50, y: 60 }] });
    addNode(s, "frame", null, { name: "B", width: 400, height: 400, anchors: [{ point: "BOTTOMLEFT", relTo: null, relPoint: "BOTTOMLEFT", x: 10, y: 10 }] });
    const before = solve(s).rects.get(a.id)!;
    const r = ok(s, [{ op: "reparent", target: "A", parent: "B" }]);
    const na = Object.values(r.scene.nodes).find((n) => n.name === "A")!;
    expect(solve(r.scene).rects.get(na.id)).toEqual(before);
  });
});

describe("applyActions: all-or-nothing and untrusted input", () => {
  it("one bad action means nothing is applied, and the error names the action", () => {
    const s = base(); const before = JSON.stringify(s);
    const r = bad(s, [{ op: "addNode", kind: "frame", name: "Good" }, { op: "addNode", kind: "texture", name: "Orphan" }]);
    expect(r.errors[0]).toMatchObject({ index: 1, op: "addNode" }); expect(r.errors[0]!.message).toMatch(/must be inside a frame/);
    expect(JSON.stringify(r.scene)).toBe(before);
  });
  it("rejects unknown ops, including prototype-chain names", () => {
    for (const op of ["rm -rf", "__proto__", "constructor", "toString", "hasOwnProperty"]) { const r = bad(base(), [{ op }]); expect(r.errors[0]!.message).toMatch(/unknown op/); }
  });
  it("rejects prototype-pollution attempts in props and does not pollute Object", () => {
    const evil = JSON.parse('{"op":"addNode","kind":"frame","props":{"__proto__":{"polluted":true},"constructor":{"x":1}}}');
    bad(base(), [evil]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
  it("treats Object.prototype names as unknown, not as valid properties, stats or parameters", () => {
    for (const k of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
      const msg = (props: unknown) => bad(base(), [{ op: "addNode", kind: "frame", props }]).errors[0]!.message;
      expect(msg(JSON.parse(`{"${k}":1}`)), k).toMatch(/unknown property/);
    }
    const s = base(); addNode(s, "frame", null, { name: "F" }); addNode(s, "fontstring", s.nodes[Object.keys(s.nodes)[0]!]!.id, { name: "T" });
    expect(bad(s, [{ op: "setBinding", target: "T", bind: { stat: "constructor" } }]).errors[0]!.message).toMatch(/not supported/);
    expect(bad(base(), [{ op: "setScenario", id: "idle", params: { constructor: "x" } }]).errors[0]!.message).toMatch(/unknown scenario parameter/);
  });
  it("rejects unknown properties, wrong types and out-of-range numbers", () => {
    const f = (props: unknown) => bad(base(), [{ op: "addNode", kind: "frame", props }]).errors[0]!.message;
    expect(f({ evil: 1 })).toMatch(/unknown property/);
    expect(f({ width: "wide" })).toMatch(/must be a number/);
    expect(f({ width: 99999 })).toMatch(/between/);
    expect(f({ alpha: 2 })).toMatch(/between/);
    expect(f({ color: [1, 1, 1] })).toMatch(/\[r,g,b,a\]/);
    expect(f({ strata: "TOP_SECRET" })).toMatch(/one of/);
    expect(f({ text: "x".repeat(500) })).toMatch(/longer than/);
    expect(f({ text: "a\u0000b" })).toMatch(/control characters/);
  });
  it("rejects bindings that the preview cannot drive, with the supported list", () => {
    const s = base(); addNode(s, "frame", null, { name: "F" });
    expect(bad(s, [{ op: "addNode", kind: "texture", parent: "F", bind: { stat: "health" } }]).errors[0]!.message).toMatch(/can only drive statusbar/);
    expect(bad(s, [{ op: "addNode", kind: "fontstring", parent: "F", bind: { stat: "teleport" } }]).errors[0]!.message).toMatch(/not supported/);
    expect(bad(s, [{ op: "addNode", kind: "fontstring", parent: "F", bind: { stat: "name", unit: "raid99" } }]).errors[0]!.message).toMatch(/not a supported unit/);
  });
  it("rejects anchor cycles and self-anchoring", () => {
    const r = bad(base(), [
      { op: "addNode", kind: "frame", name: "A", anchors: [{ point: "CENTER" }] },
      { op: "addNode", kind: "frame", name: "B", anchors: [{ point: "LEFT", relTo: "A", relPoint: "RIGHT" }] },
      { op: "setAnchors", target: "A", anchors: [{ point: "LEFT", relTo: "B", relPoint: "RIGHT" }] },
    ]);
    expect(r.errors.map((e) => e.message).join()).toMatch(/cycle/);
    expect(bad(base(), [{ op: "addNode", kind: "frame", name: "S" }, { op: "setAnchors", target: "S", anchors: [{ point: "CENTER", relTo: "S" }] }]).errors[0]!.message).toMatch(/itself/);
  });
  it("refuses references to elements that do not exist and non-container parents", () => {
    expect(bad(base(), [{ op: "setProps", target: "Ghost", props: {} }]).errors[0]!.message).toMatch(/does not exist/);
    const s = base(); const f = addNode(s, "frame", null, { name: "F" }); addNode(s, "texture", f.id, { name: "Tex" });
    expect(bad(s, [{ op: "addNode", kind: "frame", parent: "Tex" }]).errors[0]!.message).toMatch(/only frame, button and statusbar/);
  });
  it("enforces size limits", () => {
    expect(bad(base(), Array.from({ length: 201 }, () => ({ op: "addNode", kind: "frame" }))).errors[0]!.message).toMatch(/at most 200/);
    const s = base(); for (let i = 0; i < 595; i++) addNode(s, "frame", null, { name: "N" + i });
    expect(bad(s, [{ op: "addTemplate", template: "Tempus Target Frame" }]).errors[0]!.message).toMatch(/limited to 600/);
  });
  it("validates scenario parameters", () => {
    expect(bad(base(), [{ op: "setScenario", id: "nope" }]).errors[0]!.message).toMatch(/does not exist/);
    expect(bad(base(), [{ op: "setScenario", id: "idle", params: { evil: 1 } }]).errors[0]!.message).toMatch(/unknown scenario parameter/);
    expect(bad(base(), [{ op: "setScenario", id: "idle", params: { group: "raid", groupSize: 99 } }]).errors[0]!.message).toMatch(/1 to 40/);
    expect(bad(base(), [{ op: "setScenario", id: "idle", params: { id: "hijack" } }]).errors[0]!.message).toMatch(/unknown scenario parameter/);
  });
  it("non-array and non-object payloads fail cleanly", () => {
    expect(applyActions(base(), "nope", T).errors[0]!.message).toMatch(/array/);
    expect(applyActions(base(), [null, 5, "x"], T).errors).toHaveLength(3);
  });
});

describe("extractJson", () => {
  it("reads fenced, raw and chatty replies", () => {
    expect(extractJson('Sure!\n```json\n{"say":"ok","actions":[]}\n```')).toEqual({ say: "ok", actions: [] });
    expect(extractJson('{"say":"raw"}')).toEqual({ say: "raw" });
    expect(extractJson('Here you go: {"say":"has } brace in \\"string\\" }","actions":[{"op":"x"}]} thanks')).toEqual({ say: 'has } brace in "string" }', actions: [{ op: "x" }] });
  });
  it("returns null for garbage and unterminated JSON", () => { expect(extractJson("no json here")).toBeNull(); expect(extractJson('{"say": "cut off')).toBeNull(); });
});
