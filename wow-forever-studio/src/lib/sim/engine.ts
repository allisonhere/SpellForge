// Deterministic WoW-flavoured state simulation. It models *unit state only* (health, power, auras, casts,
// cooldowns, combat flag) and emits the matching event names. It does NOT execute addon Lua and is not the WoW runtime.
import type { Rgba } from "../scene";
import { nextRng } from "./rng";
import type { Scenario, SimAura, SimEvent, SimState, SimUnit } from "./types";

export const TICK_MS = 100;
const LOG_CAP = 600;

export const CLASS_COLORS: Record<string, Rgba> = {
  WARRIOR: [0.78, 0.61, 0.43, 1], PALADIN: [0.96, 0.55, 0.73, 1], HUNTER: [0.67, 0.83, 0.45, 1], ROGUE: [1, 0.96, 0.41, 1],
  PRIEST: [1, 1, 1, 1], DEATHKNIGHT: [0.77, 0.12, 0.23, 1], SHAMAN: [0, 0.44, 0.87, 1], MAGE: [0.25, 0.78, 0.92, 1],
  WARLOCK: [0.53, 0.53, 0.93, 1], MONK: [0, 1, 0.6, 1], DRUID: [1, 0.49, 0.04, 1], DEMONHUNTER: [0.64, 0.19, 0.79, 1], EVOKER: [0.2, 0.58, 0.5, 1],
};
const CLASSES = Object.keys(CLASS_COLORS);
const NAMES = ["Aelindra", "Borric", "Caelum", "Dravenna", "Elowen", "Fenrik", "Galdor", "Hestia", "Ivarr", "Jessamine", "Kaelith", "Lorcan", "Mirelle", "Nerith", "Orsolya", "Perrin", "Quillon", "Rosalind", "Sorrel", "Tavish", "Ulric", "Vesper", "Wynn", "Xanthe", "Yorick", "Zephra"];
const BUFFS: [number, string, Rgba][] = [[21562, "Power Word: Fortitude", [1, 0.9, 0.5, 1]], [1459, "Arcane Intellect", [0.4, 0.6, 1, 1]], [6673, "Battle Shout", [0.9, 0.3, 0.2, 1]], [1126, "Mark of the Wild", [0.5, 0.9, 0.4, 1]], [774, "Rejuvenation", [0.9, 0.5, 0.9, 1]]];
const DEBUFFS: [number, string, Rgba][] = [[589, "Shadow Word: Pain", [0.6, 0.2, 0.7, 1]], [980, "Agony", [0.7, 0.3, 0.2, 1]], [703, "Garrote", [0.8, 0.8, 0.2, 1]], [8921, "Moonfire", [0.5, 0.6, 0.95, 1]]];

export class Sim {
  state: SimState;
  constructor(public scenario: Scenario) { this.state = initial(scenario); }

  private rand(): number { const r = nextRng(this.state.rng); this.state.rng = r.state; return r.value; }
  private range(a: number, b: number): number { return a + this.rand() * (b - a); }
  private pick<T>(arr: T[]): T { return arr[Math.floor(this.rand() * arr.length) % arr.length]!; }
  private emit(name: string, args = "") {
    const l = this.state.log; l.push({ t: this.state.t, name, args } satisfies SimEvent);
    if (l.length > LOG_CAP) l.splice(0, l.length - LOG_CAP);
  }

  advance(ms: number) { const n = Math.floor(ms / TICK_MS); for (let i = 0; i < n; i++) this.step(); }

  private groupUnits(): SimUnit[] {
    const s = this.state, sc = this.scenario;
    const ids = ["player"];
    if (sc.group === "party") for (let i = 1; i < Math.min(5, sc.groupSize); i++) ids.push(`party${i}`);
    if (sc.group === "raid") for (let i = 1; i <= Math.min(40, sc.groupSize); i++) ids.push(`raid${i}`);
    return ids.map((i) => s.units[i]!).filter(Boolean);
  }

  step() {
    const s = this.state, sc = this.scenario;
    s.t += TICK_MS; s.tick++;
    const t = s.t;

    // combat entry / respawn
    if (!s.inCombat && sc.startInCombatAtMs >= 0 && t >= sc.startInCombatAtMs && t >= s.respawnAt && s.units["target"]!.alive) {
      s.inCombat = true; this.emit("PLAYER_REGEN_DISABLED"); this.emit("PLAYER_TARGET_CHANGED", "target");
    }
    if (s.respawnAt > 0 && t >= s.respawnAt) {
      const tg = s.units["target"]!; tg.health = tg.maxHealth; tg.alive = true; s.respawnAt = 0;
      this.emit("PLAYER_TARGET_CHANGED", "target"); this.emit("UNIT_HEALTH", "target");
    }

    this.stepCasts(t);
    if (s.inCombat) this.stepCombat(t);
    this.stepAuras(t);
    this.stepPower(t);
    this.stepLag();
    for (const [k, cd] of Object.entries(s.cooldowns)) if (t >= cd.start + cd.duration) { delete s.cooldowns[k]; this.emit("SPELL_UPDATE_COOLDOWN", k); }
  }

  private startCast(unit: SimUnit, spell: string, ms: number, interruptible: boolean) {
    unit.cast = { spell, start: this.state.t, end: this.state.t + ms, interruptible, channel: false, color: interruptible ? [1, 0.75, 0.2, 1] : [0.6, 0.6, 0.65, 1] };
    this.emit("UNIT_SPELLCAST_START", `${unit.id} ${spell}`);
  }

  private stepCasts(t: number) {
    const s = this.state, sc = this.scenario, target = s.units["target"]!, player = s.units["player"]!;
    for (const u of Object.values(s.units)) {
      if (u.cast && t >= u.cast.end) { this.emit("UNIT_SPELLCAST_SUCCEEDED", `${u.id} ${u.cast.spell}`); this.emit("UNIT_SPELLCAST_STOP", u.id); u.cast = null; }
    }
    if (target.cast && sc.interruptTargetCasts && target.cast.interruptible && !s.cooldowns["Kick"] && t - target.cast.start >= sc.targetCastTimeMs * 0.45) {
      this.emit("UNIT_SPELLCAST_INTERRUPTED", `target ${target.cast.spell}`); target.cast = null;
      s.cooldowns["Kick"] = { start: t, duration: 15000 }; this.emit("SPELL_UPDATE_COOLDOWN", "Kick");
    }
    const active = s.inCombat || sc.targetCastEveryMs > 0 && sc.startInCombatAtMs < 0;
    if (sc.targetCastEveryMs > 0 && active && target.alive && !target.cast && t % sc.targetCastEveryMs < TICK_MS && t >= sc.targetCastEveryMs) {
      const n = Math.floor(t / sc.targetCastEveryMs);
      this.startCast(target, sc.targetCastSpell, sc.targetCastTimeMs, sc.targetCastInterruptible && n % 2 === 1);
    }
    if (sc.playerCastEveryMs > 0 && player.alive && !player.cast && t % sc.playerCastEveryMs < TICK_MS && t >= sc.playerCastEveryMs) this.startCast(player, sc.playerCastSpell, sc.playerCastTimeMs, true);
  }

  private stepCombat(t: number) {
    const s = this.state, sc = this.scenario, target = s.units["target"]!, player = s.units["player"]!;
    // player damages target
    if (target.alive && sc.targetDpsPctPerSec > 0) {
      const before = target.health;
      target.health = Math.max(0, target.health - (target.maxHealth * sc.targetDpsPctPerSec / 100) * (TICK_MS / 1000));
      if (Math.floor(before / target.maxHealth * 100) !== Math.floor(target.health / target.maxHealth * 100)) this.emit("UNIT_HEALTH", "target");
      if (target.health <= 0) {
        target.alive = false; target.cast = null; this.emit("UNIT_HEALTH", "target"); this.emit("PARTY_KILL", "target");
        s.inCombat = false; this.emit("PLAYER_REGEN_ENABLED"); s.respawnAt = t + 4000;
        return;
      }
    }
    const group = this.groupUnits();
    if (sc.damageEveryMs > 0 && t % sc.damageEveryMs < TICK_MS) {
      const alive = group.filter((u) => u.alive);
      if (alive.length) {
        const victim = this.rand() < sc.damagePlayerBias && player.alive ? player : this.pick(alive);
        this.damage(victim, this.range(sc.damagePctMin, sc.damagePctMax));
        if (sc.group === "raid") { const extra = this.pick(alive); if (extra !== victim) this.damage(extra, this.range(sc.damagePctMin, sc.damagePctMax)); }
      }
    }
    if (sc.healEveryMs > 0 && t % sc.healEveryMs < TICK_MS) {
      const hurt = group.filter((u) => u.alive && u.health < u.maxHealth).sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth || a.id.localeCompare(b.id))[0];
      if (hurt) {
        const amt = hurt.maxHealth * this.range(sc.healPctMin, sc.healPctMax) / 100;
        hurt.health = Math.min(hurt.maxHealth, hurt.health + amt); this.emit("UNIT_HEALTH", hurt.id);
      }
    }
  }

  private damage(u: SimUnit, pct: number) {
    u.health = Math.max(0, u.health - u.maxHealth * pct / 100);
    this.emit("UNIT_HEALTH", u.id);
    if (u.health <= 0 && u.alive) {
      u.alive = false; u.cast = null; this.emit("UNIT_DIED", u.id);
      if (u.id === "player") this.emit("PLAYER_DEAD");
    }
  }

  private stepAuras(t: number) {
    const s = this.state, sc = this.scenario;
    for (const u of Object.values(s.units)) {
      const keep = u.auras.filter((a) => a.expires > t);
      if (keep.length !== u.auras.length) { u.auras = keep; this.emit("UNIT_AURA", u.id); }
    }
    if (sc.auraEveryMs > 0 && t % sc.auraEveryMs < TICK_MS) {
      const pool = [...this.groupUnits(), s.units["target"]!].filter((u) => u.alive);
      if (!pool.length) return;
      const u = this.pick(pool);
      const harmful = u.hostile ? this.rand() < 0.9 : this.rand() < 0.25;
      const [spellId, name, color] = harmful ? this.pick(DEBUFFS) : this.pick(BUFFS);
      const duration = harmful ? sc.debuffDurationMs : sc.buffDurationMs;
      const existing = u.auras.find((a) => a.spellId === spellId);
      if (existing) { existing.expires = t + duration; existing.duration = duration; existing.stacks = Math.min(5, existing.stacks + 1); }
      else u.auras.push({ spellId, name, harmful, stacks: 1, duration, expires: t + duration, color } satisfies SimAura);
      this.emit("UNIT_AURA", u.id);
    }
  }

  /** Lag bar: jumps up with heals, eases down after damage. The client's real easing is Enum.StatusBarInterpolation; tau is an approximation. */
  private stepLag() {
    const k = 1 - Math.exp(-(TICK_MS / 1000) / 0.35);
    for (const u of Object.values(this.state.units)) u.lag = u.health >= u.lag ? u.health : u.lag + (u.health - u.lag) * k;
  }

  private stepPower(t: number) {
    const p = this.state.units["player"]!;
    if (!p.alive) return;
    const before = Math.round(p.power);
    if (p.powerType === "RAGE") p.power = Math.max(0, Math.min(p.maxPower, p.power + (this.state.inCombat ? (this.rand() < 0.35 ? 8 : -1.5) : -3)));
    else if (p.powerType === "ENERGY") p.power = Math.min(p.maxPower, p.power + 1.0);
    else {
      const spend = p.cast && t - p.cast.start < TICK_MS + 1 ? p.maxPower * 0.04 : 0;
      p.power = Math.max(0, Math.min(p.maxPower, p.power - spend + p.maxPower * 0.0008));
    }
    if (Math.round(p.power) !== before) this.emit("UNIT_POWER_UPDATE", "player");
  }
}

function makeUnit(id: string, name: string, cls: string, role: SimUnit["role"], maxHealth: number, extra: Partial<SimUnit> = {}): SimUnit {
  return { id, name, class: cls, role, level: 80, health: maxHealth, maxHealth, lag: maxHealth, power: 100, maxPower: 100, powerType: "MANA", alive: true, hostile: false, auras: [], cast: null, ...extra };
}

export function initial(sc: Scenario): SimState {
  const units: Record<string, SimUnit> = {};
  const pmax = sc.playerMaxHealth;
  units["player"] = makeUnit("player", "Playerone", "MAGE", "DAMAGER", pmax, { health: pmax * sc.playerHealthPct / 100, lag: pmax * sc.playerHealthPct / 100, powerType: sc.playerPowerType, power: sc.playerPowerPct, level: 80 });
  units["target"] = makeUnit("target", sc.targetName, "WARRIOR", "DAMAGER", sc.targetMaxHealth, { hostile: true });
  const roster = (prefix: string, n: number) => {
    for (let i = 1; i <= n; i++) {
      const role: SimUnit["role"] = i <= (prefix === "raid" ? 2 : 1) ? "TANK" : i % 5 === 0 || (prefix === "party" && i === 2) ? "HEALER" : "DAMAGER";
      const cls = role === "TANK" ? (i % 2 ? "WARRIOR" : "PALADIN") : role === "HEALER" ? CLASSES[(i * 3) % 4 === 0 ? 4 : 10]! : CLASSES[(i * 5) % CLASSES.length]!;
      const max = role === "TANK" ? 260000 : role === "HEALER" ? 150000 : 165000;
      units[`${prefix}${i}`] = makeUnit(`${prefix}${i}`, `${NAMES[(i * 7) % NAMES.length]}${i > NAMES.length ? i : ""}`, cls, role, max, { power: 60 + ((i * 17) % 40) });
    }
  };
  if (sc.group === "party") roster("party", Math.min(4, Math.max(0, sc.groupSize - 1)));
  if (sc.group === "raid") roster("raid", Math.min(40, Math.max(0, sc.groupSize)));
  return { t: 0, tick: 0, inCombat: false, units, cooldowns: {}, rng: sc.seed >>> 0, log: [{ t: 0, name: "PLAYER_ENTERING_WORLD", args: "" }, ...(sc.group !== "solo" ? [{ t: 0, name: "GROUP_ROSTER_UPDATE", args: sc.group }] : [])], respawnAt: 0 };
}

/** Stable fingerprint of the full simulation state, used to prove determinism. */
export function stateHash(st: SimState): string {
  const o = JSON.stringify([st.t, st.inCombat, st.rng, st.respawnAt, Object.values(st.units).map((u) => [u.id, +u.health.toFixed(3), +u.lag.toFixed(3), +u.power.toFixed(3), u.alive, u.auras.map((a) => [a.spellId, a.expires, a.stacks]), u.cast && [u.cast.spell, u.cast.end]]), st.cooldowns, st.log.length]);
  let h = 2166136261;
  for (let i = 0; i < o.length; i++) { h ^= o.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
