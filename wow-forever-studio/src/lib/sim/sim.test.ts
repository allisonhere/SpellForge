import { describe, expect, it } from "vitest";
import { Sim, stateHash, TICK_MS } from "./engine";
import { BUILTIN_SCENARIOS, mergeScenarios } from "./scenarios";
import { checkScene, expandEntries, repeatCount, resolve, SUPPORT } from "./bind";
import { addNode, newScene } from "../scene";
import { solve } from "../layout";

const get = (id: string) => BUILTIN_SCENARIOS.find((s) => s.id === id)!;
const run = (id: string, ms: number, seed?: number) => { const sc = { ...get(id), ...(seed !== undefined ? { seed } : {}) }; const s = new Sim(sc); s.advance(ms); return s; };

describe("determinism", () => {
  it("same scenario + seed => identical state and event log, repeatedly", () => {
    for (const sc of BUILTIN_SCENARIOS) {
      const a = run(sc.id, 60000), b = run(sc.id, 60000);
      expect(stateHash(a.state), sc.id).toBe(stateHash(b.state));
      expect(a.state.log).toEqual(b.state.log);
    }
  });
  it("advancing in different chunk sizes gives the same result", () => {
    const a = run("party-5", 30000); const b = new Sim(get("party-5")); for (let i = 0; i < 300; i++) b.advance(TICK_MS);
    expect(stateHash(b.state)).toBe(stateHash(a.state));
  });
  it("different seeds diverge", () => { expect(stateHash(run("raid-40", 20000, 1).state)).not.toBe(stateHash(run("raid-40", 20000, 2).state)); });
});

describe("scenarios", () => {
  it("idle stays idle", () => { const s = run("idle", 30000); expect(s.state.inCombat).toBe(false); expect(s.state.units["player"]!.health).toBe(s.state.units["player"]!.maxHealth); });
  it("solo combat enters combat and hurts the player", () => {
    const s = run("solo-combat", 20000); expect(s.state.log.some((e) => e.name === "PLAYER_REGEN_DISABLED")).toBe(true);
    expect(s.state.units["player"]!.health).toBeLessThan(s.state.units["player"]!.maxHealth);
  });
  it("target casting produces casts, interrupts and a Kick cooldown", () => {
    const s = run("target-casting", 30000); const names = new Set(s.state.log.map((e) => e.name));
    for (const n of ["UNIT_SPELLCAST_START", "UNIT_SPELLCAST_INTERRUPTED", "SPELL_UPDATE_COOLDOWN"]) expect(names.has(n), n).toBe(true);
  });
  it("party has 5 players; raid has 40", () => {
    expect(Object.keys(run("party-5", 100).state.units).filter((u) => u.startsWith("party")).length).toBe(4);
    expect(Object.keys(run("raid-40", 100).state.units).filter((u) => u.startsWith("raid")).length).toBe(40);
  });
  it("low-health emergency starts at 18% and the player can die", () => {
    expect(run("low-health", 0).state.units["player"]!.health / 180000).toBeCloseTo(0.18, 2);
    const s = run("low-health", 90000); expect(s.state.log.some((e) => e.name === "PLAYER_DEAD"), "player should die within 90s of the emergency scenario").toBe(true);
  });
  it("aura activity applies and expires auras", () => {
    const s = run("aura-activity", 40000); const n = s.state.log.filter((e) => e.name === "UNIT_AURA").length; expect(n).toBeGreaterThan(10);
  });
  it("invariants hold for every scenario over a long run", () => {
    for (const sc of BUILTIN_SCENARIOS) {
      const s = new Sim(sc);
      for (let i = 0; i < 3000; i++) {
        s.step();
        for (const u of Object.values(s.state.units)) {
          expect(u.health).toBeGreaterThanOrEqual(0); expect(u.health).toBeLessThanOrEqual(u.maxHealth);
          expect(u.power).toBeGreaterThanOrEqual(0); expect(u.power).toBeLessThanOrEqual(u.maxPower);
          if (!u.alive) expect(u.cast).toBeNull();
        }
        if (i % 500 === 0) expect(Number.isFinite(s.state.rng)).toBe(true);
      }
    }
  });
  it("scene overrides merge onto built-ins", () => {
    const m = mergeScenarios([{ ...get("idle"), id: "idle", seed: 99 }, { ...get("idle"), id: "custom", name: "Custom" }]);
    expect(m.find((s) => s.id === "idle")!.seed).toBe(99); expect(m.some((s) => s.id === "custom")).toBe(true); expect(m.length).toBe(BUILTIN_SCENARIOS.length + 1);
  });
});

describe("bindings", () => {
  it("resolves health, class colour, cast progress and aura slots", () => {
    const s = run("target-casting", 8000); const st = s.state;
    const h = resolve(st, { unit: "player", stat: "health", colorBy: "class" }, null);
    expect(h.fill).toBeGreaterThan(0); expect(h.fill).toBeLessThanOrEqual(1); expect(h.barColor).toBeDefined();
    const cast = resolve(st, { unit: "target", stat: "cast" }, null); if (st.units["target"]!.cast) { expect(cast.visible).toBe(true); expect(cast.fill).toBeGreaterThanOrEqual(0); } else expect(cast.visible).toBe(false);
    expect(resolve(st, { unit: "nobody", stat: "health" }, null).visible).toBe(false);
  });
  it("flags health text as secret only in combat, measured for player/target", () => {
    const idle = run("idle", 1000).state; expect(resolve(idle, { unit: "player", stat: "healthPct" }, null).secret).toBeUndefined();
    const st = run("solo-combat", 3000).state; expect(st.inCombat).toBe(true);
    expect(resolve(st, { unit: "player", stat: "healthPct" }, null).secret).toBe("measured");
    expect(resolve(st, { unit: "$unit", stat: "healthPct" }, "party1").secret).toBeUndefined(); // no party1 in solo => unit missing
  });
  it("power text is not flagged (no evidence)", () => { expect(resolve(run("solo-combat", 3000).state, { unit: "player", stat: "powerCurrent" }, null).secret).toBeUndefined(); });
});

describe("repeaters", () => {
  const mk = () => { const s = newScene(); const f = addNode(s, "frame", null, { width: 100, height: 40, anchors: [{ point: "TOPLEFT", relTo: null, relPoint: "TOPLEFT", x: 10, y: -10 }] });
    f.repeat = { kind: "party", count: 0, columns: 1, gapX: 4, gapY: 6 }; const c = addNode(s, "fontstring", f.id, {}); return { s, f, c }; };
  it("edit mode shows each node once; preview expands to the scenario's group", () => {
    const { s } = mk(); const solved = solve(s);
    expect(expandEntries(s, solved.rects, false, get("party-5")).length).toBe(2);
    const e = expandEntries(s, solved.rects, true, get("party-5")); expect(e.length).toBe(8); expect(e.filter((x) => x.copy === 3).length).toBe(2);
  });
  it("places copies in a grid going downward and maps units", () => {
    const { s, f } = mk(); f.repeat!.columns = 2; const solved = solve(s);
    const roots = expandEntries(s, solved.rects, true, get("party-5")).filter((e) => e.id === f.id);
    expect(roots.map((e) => e.unit)).toEqual(["party1", "party2", "party3", "party4"]);
    expect(roots[1]!.rect.l - roots[0]!.rect.l).toBe(104); expect(roots[2]!.rect.b - roots[0]!.rect.b).toBe(-46); expect(roots[2]!.rect.l).toBe(roots[0]!.rect.l);
  });
  it("count 0 and a solo scenario leaves one dimmed copy; raid caps at 40", () => {
    const { s, f } = mk(); const e = expandEntries(s, solve(s).rects, true, get("idle")); expect(e.every((x) => x.dim)).toBe(true);
    expect(repeatCount({ kind: "raid", count: 99, columns: 5, gapX: 0, gapY: 0 }, undefined)).toBe(40); void f;
  });
});

describe("preview checks", () => {
  it("reports unsupported, unknown, missing-unit and secret cases honestly", () => {
    const s = newScene(); const f = addNode(s, "frame", null, {});
    const t = addNode(s, "fontstring", f.id, {}); t.bind = { unit: "player", stat: "healthPct" };
    const bad = addNode(s, "texture", f.id, {}); bad.bind = { unit: "player", stat: "health" };
    const unk = addNode(s, "fontstring", f.id, {}); unk.bind = { unit: "player", stat: "bogus" };
    const miss = addNode(s, "fontstring", f.id, {}); miss.bind = { unit: "raid7", stat: "name" };
    const codes = checkScene(s, get("solo-combat")).map((i) => i.code);
    for (const c of ["preview.secret-text", "preview.unsupported-binding", "preview.unknown-stat", "preview.unit-missing", "preview.not-generated"]) expect(codes, c).toContain(c);
    const secret = checkScene(s, get("solo-combat")).find((i) => i.code === "preview.secret-text")!; expect(secret.evidence).toBe("needs-game-test"); expect(secret.confidence).toBe("sourced");
  });
  it("rejects nested repeaters", () => {
    const s = newScene(); const a = addNode(s, "frame", null, {}); a.repeat = { kind: "raid", count: 0, columns: 5, gapX: 0, gapY: 0 };
    const b = addNode(s, "frame", a.id, {}); b.repeat = { kind: "party", count: 0, columns: 1, gapX: 0, gapY: 0 };
    expect(checkScene(s, get("raid-40")).map((i) => i.code)).toContain("preview.nested-repeat");
  });
  it("every supported stat names at least one node kind", () => { for (const [k, v] of Object.entries(SUPPORT)) expect(v.kinds.length, k).toBeGreaterThan(0); });
});
