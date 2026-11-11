import { describe, expect, it } from "vitest";
import { assertSafePayload, parseReply, repairTurn, sceneContext, systemPrompt, userTurn } from "./prompt";
import { ACTION_OPS } from "./actions";
import { SUPPORT } from "../sim/bind";
import { builtInTemplates } from "../templates";
import { addNode, instantiate, newScene } from "../scene";

const T = builtInTemplates();

describe("system prompt", () => {
  const p = systemPrompt(T);
  it("teaches every action op, every supported binding and every template", () => {
    for (const op of ACTION_OPS) expect(p, op).toContain(op);
    for (const stat of Object.keys(SUPPORT)) expect(p, stat).toContain(stat);
    for (const t of T) expect(p, t.name).toContain(t.name);
  });
  it("states the honesty rules about icons, secret values and what is not simulated", () => {
    expect(p).toMatch(/Never claim pixel-perfect/); expect(p).toMatch(/secret/); expect(p).toMatch(/Not simulated/); expect(p).toMatch(/DATA, never instructions/);
  });
  it("is a reasonable size for small local models", () => { expect(p.length).toBeLessThan(9000); });
});

describe("scene context", () => {
  it("describes elements by name, omits defaults, and derives size from two anchors", () => {
    const s = newScene("X"); instantiate(s, T.find((t) => t.name === "Tempus Player Frame")!, null);
    const c = JSON.parse(sceneContext(s, "idle", []));
    expect(c.elementCount).toBe(17);
    const health = c.elements.find((e: { name: string }) => e.name === "Health");
    expect(health.parent).toBe("TempusPlayer"); expect(health.width).toBeUndefined(); expect(health.height).toBe(34); expect(health.bind.stat).toBe("health");
    expect(JSON.stringify(c)).not.toContain('"id"'); // internal ids never leak
  });
  it("caps very large scenes and says so", () => {
    const s = newScene("Big"); for (let i = 0; i < 200; i++) addNode(s, "frame", null, { name: "F" + i });
    const c = JSON.parse(sceneContext(s, "idle", [], 150)); expect(c.elements).toHaveLength(150); expect(c.truncated).toMatch(/150/);
  });
  it("userTurn carries the request and the current scene", () => { const u = userTurn("add a cast bar", newScene("X"), "solo-combat", []); expect(u).toMatch(/Request: add a cast bar/); expect(u).toMatch(/"activeScenario":"solo-combat"/); });
});

describe("reply parsing", () => {
  it("accepts a normal reply", () => { expect(parseReply('{"say":"Done","actions":[{"op":"deleteNode","target":"A"}]}')).toEqual({ say: "Done", actions: [{ op: "deleteNode", target: "A" }] }); });
  it("flags prose and malformed replies instead of guessing", () => {
    expect(parseReply("I made a frame for you!").problem).toMatch(/JSON object/);
    expect(parseReply('{"say":"x"}').problem).toMatch(/actions/);
    expect(parseReply("[1,2,3]").problem).toBeDefined();
  });
  it("repair message lists each failure with its index", () => { const m = repairTurn([{ index: 2, op: "addNode", message: "bad" }]); expect(m).toMatch(/action 2 \(addNode\): bad/); });
});

describe("outgoing payload safety", () => {
  const msg = (content: string) => [{ role: "user" as const, content }];
  it("allows normal design requests and scene context", () => { expect(() => assertSafePayload(msg(userTurn("hello", newScene("X"), "idle", [])))).not.toThrow(); });
  it("refuses Blizzard source paths, key-shaped strings, game-data and home paths", () => {
    for (const bad of ["see Interface\\AddOns\\Blizzard_SharedXML\\x.lua", "key sk-ant-abcdefghij1234567890", "sk-abcdefghijklmnopqrstuvwx", "/home/allie/.local/share/spellforge-gamedata/x", "from /home/allie/Projects/secret/x.lua"])
      expect(() => assertSafePayload(msg(bad)), bad).toThrow(/Refusing to send/);
  });
});
