import { describe, expect, it } from "vitest";
import { runTurn, type Chat } from "./studio.svelte";
import { applyActions } from "./actions";
import { builtInTemplates } from "../templates";
import { designer } from "../designer.svelte";
import { newScene } from "../scene";

const T = builtInTemplates();
const script = (...replies: string[]) => { const calls: { role: string; content: string }[][] = []; let i = 0; const chat: Chat = async (m) => { calls.push(m.map((x) => ({ ...x }))); return replies[Math.min(i++, replies.length - 1)]!; }; return { chat, calls }; };
const deps = (chat: Chat, extra: Record<string, unknown> = {}) => {
  let scene = newScene("T");
  return { chat, applyBatch: (a: unknown) => { const r = applyActions(scene, a, T); if (!r.errors.length) scene = r.scene; return r; }, sceneContextArgs: () => ({ scene, scenario: "idle", issues: [] }), templates: T, history: [], get scene() { return scene; }, ...extra };
};
const GOOD = JSON.stringify({ say: "Added a panel.", actions: [{ op: "addNode", kind: "frame", name: "Panel", props: { width: 100, height: 40 } }] });
const BAD = JSON.stringify({ say: "Oops", actions: [{ op: "addNode", kind: "texture", name: "Loose" }] });

describe("runTurn with a scripted model", () => {
  it("applies a valid reply on the first attempt", async () => {
    const s = script(GOOD); const d = deps(s.chat);
    const r = await runTurn("make a panel", d);
    expect(r).toMatchObject({ say: "Added a panel.", attempts: 1 }); expect(r.applied!.created).toEqual(["Panel"]); expect(Object.keys(d.scene.nodes)).toHaveLength(1);
    expect(s.calls[0]![0]!.role).toBe("system"); expect(s.calls[0]!.at(-1)!.content).toMatch(/Request: make a panel/);
  });
  it("feeds validation errors back and succeeds on the retry", async () => {
    const s = script(BAD, GOOD); const d = deps(s.chat);
    const r = await runTurn("make a panel", d);
    expect(r.attempts).toBe(2); expect(r.applied!.created).toEqual(["Panel"]);
    const second = s.calls[1]!; expect(second.at(-1)!.content).toMatch(/None of your actions were applied/); expect(second.at(-1)!.content).toMatch(/must be inside a frame/);
    expect(second.at(-2)!.role).toBe("assistant");
  });
  it("recovers from a prose reply by asking for JSON", async () => {
    const s = script("Sure, I made you a lovely panel!", GOOD); const r = await runTurn("x", deps(s.chat));
    expect(r.attempts).toBe(2); expect(s.calls[1]!.at(-1)!.content).toMatch(/JSON object/); expect(r.applied).not.toBeNull();
  });
  it("gives up after repeated failures and leaves the scene untouched", async () => {
    const s = script(BAD, BAD, BAD, BAD); const d = deps(s.chat);
    const r = await runTurn("x", d);
    expect(r.applied).toBeNull(); expect(r.attempts).toBe(3); expect(r.failure).toMatch(/kept failing validation/); expect(Object.keys(d.scene.nodes)).toHaveLength(0);
  });
  it("a question with no actions is answered without touching the scene", async () => {
    const s = script(JSON.stringify({ say: "Health bars use the StatusBar widget.", actions: [] })); const r = await runTurn("how do health bars work?", deps(s.chat));
    expect(r.applied).toBeNull(); expect(r.failure).toBeUndefined(); expect(r.say).toMatch(/StatusBar/); expect(r.attempts).toBe(1);
  });
  it("never calls the model when the request would leak local data", async () => {
    const s = script(GOOD);
    await expect(runTurn("look at /home/allie/Projects/secret/addon.lua", deps(s.chat))).rejects.toThrow(/Refusing to send/);
    expect(s.calls).toHaveLength(0);
  });
  it("a cancelled turn applies nothing", async () => {
    const s = script(GOOD); const d = deps(s.chat, { isCancelled: () => true });
    const r = await runTurn("x", d); expect(r.failure).toBe("cancelled"); expect(Object.keys(d.scene.nodes)).toHaveLength(0);
  });
  it("trims long history to the last turns", async () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: "m" + i }));
    const s = script(GOOD); await runTurn("x", deps(s.chat, { history }));
    expect(s.calls[0]!.length).toBe(1 + 12 + 1);
  });
});

describe("proposals on the real designer store", () => {
  const actions = [
    { op: "addNode", kind: "frame", name: "Box", props: { width: 120, height: 40 } },
    { op: "addNode", kind: "statusbar", name: "Bar", parent: "Box", props: { height: 20 }, anchors: [{ point: "TOPLEFT", relPoint: "TOPLEFT" }, { point: "TOPRIGHT", relPoint: "TOPRIGHT" }], bind: { unit: "player", stat: "health" } },
  ];
  it("one AI turn is one undo step, reject restores the scene, accept keeps it", () => {
    designer.scene = newScene("S"); designer.history.clear(); designer.proposal = null;
    const r = designer.applyBatch(actions);
    expect(r.errors).toEqual([]); expect(Object.keys(designer.scene.nodes)).toHaveLength(2);
    expect(designer.proposal!.created).toEqual(["Box", "Bar"]); expect(designer.proposedNames.has("Bar")).toBe(true); expect(designer.preview).toBe(true);
    designer.rejectProposal();
    expect(Object.keys(designer.scene.nodes)).toHaveLength(0); expect(designer.proposal).toBeNull();
    designer.applyBatch(actions); designer.acceptProposal();
    expect(designer.proposal).toBeNull(); expect(Object.keys(designer.scene.nodes)).toHaveLength(2);
    designer.undo(); expect(Object.keys(designer.scene.nodes)).toHaveLength(0); // the whole turn undone in one step
  });
  it("an invalid batch changes nothing and creates no proposal", () => {
    designer.scene = newScene("S"); designer.history.clear(); designer.proposal = null;
    const r = designer.applyBatch([{ op: "addNode", kind: "texture" }]);
    expect(r.errors.length).toBe(1); expect(Object.keys(designer.scene.nodes)).toHaveLength(0); expect(designer.proposal).toBeNull(); expect(designer.canUndo).toBe(false);
  });
});
