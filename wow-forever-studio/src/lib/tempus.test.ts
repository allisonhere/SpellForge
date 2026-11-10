import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addNode, instantiate, newScene, type Scene } from "./scene";
import { solve } from "./layout";
import { builtInTemplates } from "./templates";
import { generate } from "./codegen";
import { Sim } from "./sim/engine";
import { BUILTIN_SCENARIOS } from "./sim/scenarios";
import { resolve, visibleChain, checkScene } from "./sim/bind";

const tpl = (n: string) => builtInTemplates().find((t) => t.name === n)!;
const sceneWith = (name: string) => { const s = newScene("T"); const root = instantiate(s, tpl(name), null); return { s, root, byName: (n: string) => Object.values(s.nodes).find((x) => x.name === n)! }; };
const get = (id: string) => BUILTIN_SCENARIOS.find((x) => x.id === id)!;

describe("Tempus Player Frame: geometry from UnitFrames.lua", () => {
  const { s, root, byName } = sceneWith("Tempus Player Frame");
  const r = solve(s).rects;
  const R = (n: string) => r.get(byName(n).id)!;
  it("frame is 230x44 with portrait slot 44x44 and health/power shifted by height+1", () => {
    expect([R("TempusPlayer").w, R("TempusPlayer").h]).toEqual([230, 44]);
    expect([R("Portrait").w, R("Portrait").h]).toEqual([44, 44]);
    const f = r.get(root)!;
    expect(R("Health").l - f.l).toBe(45); expect(R("Health").w).toBe(185); expect(R("Health").h).toBe(34);
    expect(R("Power").l - f.l).toBe(45); expect(R("Power").h).toBe(9); expect(R("Power").b).toBe(f.b);
  });
  it("1px separator sits 1px below the health bar; lag bar overlays health exactly", () => {
    expect(R("PowerSep").b + R("PowerSep").h).toBe(R("Health").b - 1 + 1); expect(R("PowerSep").h).toBe(1);
    expect(R("HealthLag")).toEqual(R("Health"));
  });
  it("name text spans from health-left+5 to 6px left of the health text (two-anchor width)", () => {
    expect(R("NameText").l).toBe(R("Health").l + 5);
    expect(R("NameText").l + R("NameText").w).toBe(R("HealthText").l - 6);
    expect(R("HealthText").l + R("HealthText").w).toBe(R("Health").l + R("Health").w - 5);
  });
  it("cast bar: 18px high, left = frame+22, right = frame edge, 6px below; icon 4px left of it", () => {
    const f = r.get(root)!;
    expect(R("CastBar").h).toBe(18); expect(R("CastBar").l - f.l).toBe(22); expect(R("CastBar").l + R("CastBar").w).toBe(f.l + f.w);
    expect(R("CastBar").b + R("CastBar").h).toBe(f.b - 6);
    expect(R("CastIconFrame").l + R("CastIconFrame").w).toBe(R("CastBar").l - 4); expect([R("CastIconFrame").w, R("CastIconFrame").h]).toEqual([18, 18]);
  });
  it("glow extends 14px beyond the frame, 1px black edge and 3px/0.45 shadow are modelled", () => {
    const f = r.get(root)!, g = R("LowGlow");
    expect([g.l, g.b, g.w, g.h]).toEqual([f.l - 14, f.b - 14, f.w + 28, f.h + 28]);
    expect(byName("TempusPlayer").border).toEqual({ size: 1, color: [0, 0, 0, 1] }); expect(byName("TempusPlayer").shadow).toEqual({ size: 3, alpha: 0.45 });
    expect(byName("LowGlow").pulse).toEqual({ high: 1, low: 0.3, period: 1.1 }); expect(byName("LowGlow").blend).toBe("ADD");
  });
});

describe("Tempus Target Frame auras", () => {
  const { s, root, byName } = sceneWith("Tempus Target Frame");
  const r = solve(s).rects;
  it("two rows of 8 x 24px icons, spacing 3, debuffs 6px above the frame and buffs 3px above those", () => {
    const f = r.get(root)!, deb = r.get(byName("Debuffs").id)!, buf = r.get(byName("Buffs").id)!;
    expect(deb.b).toBe(f.b + f.h + 6); expect(buf.b).toBe(deb.b + deb.h + 3);
    const icons = Object.values(s.nodes).filter((n) => /^Debuffs\d+$/.test(n.name));
    expect(icons.length).toBe(8);
    const xs = icons.map((n) => r.get(n.id)!.l).sort((a, b) => a - b); expect(xs[1]! - xs[0]!).toBe(27); expect(r.get(icons[0]!.id)!.w).toBe(24);
    expect(Object.values(s.nodes).filter((n) => /^Buffs\d+$/.test(n.name)).length).toBe(8);
  });
  it("binds target auras by slot and kind", () => {
    const d3 = byName("Debuffs3"), b1 = byName("Buffs1");
    expect(d3.bind).toMatchObject({ unit: "target", stat: "auraIcon", slot: 2, aura: "debuff" }); expect(b1.bind).toMatchObject({ slot: 0, aura: "buff" });
  });
});

describe("lag bar", () => {
  it("stays at the old value after damage, then eases down to health; heals snap up", () => {
    const sim = new Sim({ ...get("solo-combat"), damageEveryMs: 100, damagePctMin: 5, damagePctMax: 5, healEveryMs: 0, startInCombatAtMs: 100, targetDpsPctPerSec: 0 });
    sim.advance(300); const u = sim.state.units["player"]!;
    expect(u.lag).toBeGreaterThan(u.health); expect(u.lag).toBeLessThanOrEqual(u.maxHealth);
    const resolved = resolve(sim.state, { unit: "player", stat: "healthLag" }, null); expect(resolved.fill!).toBeGreaterThanOrEqual(u.health / u.maxHealth);
    expect(resolved.barColor).toEqual([0.85, 0.25, 0.2, 0.75]);
    const quiet = new Sim({ ...get("idle") }); quiet.state.units["player"]!.health = 50000; quiet.state.units["player"]!.lag = 180000; quiet.advance(10000);
    expect(Math.abs(quiet.state.units["player"]!.lag - 50000)).toBeLessThan(500);
    quiet.state.units["player"]!.health = 150000; quiet.advance(100); expect(quiet.state.units["player"]!.lag).toBe(150000);
  });
  it("lag never goes below health or above max across every scenario (invariant)", () => {
    for (const sc of BUILTIN_SCENARIOS) { const s = new Sim(sc); for (let i = 0; i < 1500; i++) { s.step(); for (const u of Object.values(s.state.units)) { expect(u.lag).toBeGreaterThanOrEqual(u.health - 1e-6); expect(u.lag).toBeLessThanOrEqual(u.maxHealth + 1e-6); } } }
  });
});

describe("visibility inherits like the client", () => {
  it("cast bar and all its children are hidden unless the unit is casting", () => {
    const { s, byName } = sceneWith("Tempus Target Frame");
    const idle = new Sim(get("idle")); idle.advance(500);
    expect(visibleChain(s, byName("CastText").id, null, idle.state)).toBe(false);
    expect(visibleChain(s, byName("CastIconFrame").id, null, idle.state)).toBe(false);
    const sim = new Sim(get("target-casting")); let seen = false;
    for (let i = 0; i < 400 && !seen; i++) { sim.step(); if (sim.state.units["target"]!.cast) seen = visibleChain(s, byName("CastText").id, null, sim.state); }
    expect(seen).toBe(true);
  });
  it("uninterruptible casts show the shield, interruptible ones do not", () => {
    const sim = new Sim(get("target-casting")); const seen = new Set<boolean>();
    for (let i = 0; i < 900; i++) { sim.step(); const c = sim.state.units["target"]!.cast; if (c) seen.add(resolve(sim.state, { unit: "target", stat: "castUninterruptible" }, null).visible === !c.interruptible); }
    expect([...seen]).toEqual([true]);
  });
});

describe("code generation of the Tempus templates", () => {
  const gen = (name: string) => generate((() => { const { s } = sceneWith(name); return s; })());
  const luacOk = (lua: string) => { const f = join(mkdtempSync(join(tmpdir(), "wfs-")), "t.lua"); writeFileSync(f, lua); try { execFileSync("luac", ["-p", f], { stdio: "pipe" }); } catch (e: any) { if (e.code === "ENOENT") return; throw new Error(String(e.stderr)); } };
  it("all three Tempus templates produce valid Lua", () => { for (const n of ["Tempus Player Frame", "Tempus Target Frame", "Tempus Unit Frame (compact)"]) luacOk(gen(n).lua); });
  it("emits edge, shadow and pulse; glow blends with ADD; preview-bound visuals start hidden", () => {
    const { lua, warnings } = gen("Tempus Player Frame");
    expect(lua).toContain('.edge.top = '); expect(lua).toContain('CreateTexture(nil, "BACKGROUND", nil, -8)'); expect(lua).toContain(':SetLooping("BOUNCE")'); expect(lua).toContain('SetFromAlpha(1); a:SetToAlpha(0.3); a:SetDuration(0.55)');
    expect(lua).toMatch(/LowGlow:SetBlendMode\("ADD"\)/); expect(lua).toContain("preview-bound (lowHealth): hidden until your own code shows it");
    expect(warnings.join()).toContain("border/shadow/pulse");
  });
  it("never calls SetBlendMode on a frame (frames do not have it)", () => {
    const s = newScene("B"); const f = addNode(s, "frame", null, {}); f.blend = "ADD"; f.shadow = { size: 2, alpha: 0.5 };
    const t = addNode(s, "texture", f.id, {}); t.shadow = { size: 2, alpha: 0.5 }; t.border = { size: 1, color: [0, 0, 0, 1] };
    const { lua } = generate(s);
    expect(lua).not.toContain("SetBlendMode"); expect(lua.match(/shadow = /g)?.length).toBe(1); // only the frame gets a shadow; textures cannot create textures
    luacOk(lua);
  });
  it("preview checks still warn that bindings are not generated", () => { expect(checkScene(sceneWith("Tempus Target Frame").s, get("solo-combat")).map((i) => i.code)).toContain("preview.not-generated"); });
});
