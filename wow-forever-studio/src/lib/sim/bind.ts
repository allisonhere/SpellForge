// Binding resolution, group/raid repeater expansion, and the *explicit* supported-preview subset.
import type { Binding, Kind, Rgba, Scene, SceneNode } from "../scene";
import type { Rect } from "../layout";
import { CLASS_COLORS, initial } from "./engine";
import type { Scenario, SimState, SimUnit } from "./types";

export interface Support { kinds: Kind[]; summary: string; secretInCombat?: boolean; note?: string }

/** Everything the preview can drive. Anything not listed here is NOT simulated and is reported, never silently ignored. */
export const SUPPORT: Record<string, Support> = {
  health: { kinds: ["statusbar"], summary: "Unit health as bar fill; colour by class or health threshold" },
  healthLag: { kinds: ["statusbar"], summary: "Lag bar: eases down behind the health bar after damage (Tempus S.LagBar)" },
  castUninterruptible: { kinds: ["texture", "frame"], summary: "Shown while the unit casts something that cannot be interrupted (Tempus shield overlay)" },
  power: { kinds: ["statusbar"], summary: "Mana / rage / energy as bar fill" },
  cast: { kinds: ["statusbar"], summary: "Cast progress; hidden when not casting; grey when uninterruptible" },
  auraTime: { kinds: ["statusbar"], summary: "Remaining duration of the aura in slot N (buff or debuff)" },
  name: { kinds: ["fontstring"], summary: "Unit name" },
  level: { kinds: ["fontstring"], summary: "Unit level" },
  healthPct: { kinds: ["fontstring"], summary: "Health percent text", secretInCombat: true },
  healthCurrent: { kinds: ["fontstring"], summary: "Current health text", secretInCombat: true },
  healthBoth: { kinds: ["fontstring"], summary: "Current | percent text", secretInCombat: true },
  powerCurrent: { kinds: ["fontstring"], summary: "Current power text" },
  powerPct: { kinds: ["fontstring"], summary: "Power percent text" },
  castName: { kinds: ["fontstring"], summary: "Spell being cast" },
  castTime: { kinds: ["fontstring"], summary: "Seconds remaining on the cast" },
  auraStacks: { kinds: ["fontstring"], summary: "Stack count of the aura in slot N" },
  auraIcon: { kinds: ["texture"], summary: "Placeholder icon tinted per aura; hidden when the slot is empty" },
  lowHealth: { kinds: ["texture", "frame"], summary: "Shown while health% is below the threshold (low-health glow)" },
  combat: { kinds: ["texture", "frame", "button", "statusbar", "fontstring"], summary: "Shown only while the player is in combat" },
  showIfExists: { kinds: ["frame", "button", "statusbar", "texture", "fontstring"], summary: "Shown only if the bound unit exists in the scenario" },
  showIfCasting: { kinds: ["frame", "button", "statusbar", "texture", "fontstring"], summary: "Shown only while the unit is casting" },
};
export const NOT_SIMULATED = [
  "Addon Lua is not executed: only bound widgets react to simulated state",
  "Real texture, atlas, model and font rendering",
  "Protected actions, taint, secure templates and click handling",
  "Combat log, threat, range, line of sight, loot, chat, tooltips",
  "Edit Mode, Blizzard frame behaviour, SavedVariables",
];
export const SIMULATED_EVENTS = ["PLAYER_ENTERING_WORLD", "GROUP_ROSTER_UPDATE", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_TARGET_CHANGED", "UNIT_HEALTH", "UNIT_POWER_UPDATE", "UNIT_AURA", "UNIT_SPELLCAST_START", "UNIT_SPELLCAST_STOP", "UNIT_SPELLCAST_SUCCEEDED", "UNIT_SPELLCAST_INTERRUPTED", "SPELL_UPDATE_COOLDOWN", "UNIT_DIED", "PLAYER_DEAD", "PARTY_KILL"];

export interface Resolved {
  visible: boolean; fill?: number; text?: string; barColor?: Rgba; bgColor?: Rgba; tint?: Rgba;
  /** measured = observed in the client by a cited source; inferred = we expect the same for other units. */
  secret?: "measured" | "inferred";
}

const abbr = (n: number): string => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
const POWER_COLORS = { MANA: [0.3, 0.5, 0.95, 1], RAGE: [0.9, 0.2, 0.2, 1], ENERGY: [1, 0.85, 0.2, 1] } as const;
export const unitColor = (u: SimUnit): Rgba => (u.hostile ? [0.85, 0.2, 0.2, 1] : CLASS_COLORS[u.class] ?? [0.6, 0.6, 0.6, 1]);
const thresholdColor = (pct: number): Rgba => (pct > 0.5 ? [0.25 + (1 - pct) * 1.5, 0.78, 0.3, 1] : [0.9, 0.2 + pct * 1.2, 0.2, 1]);

export function resolve(st: SimState, b: Binding, ctxUnit: string | null): Resolved {
  const id = b.unit === "$unit" ? ctxUnit ?? "player" : b.unit;
  const u = st.units[id];
  if (!u) return { visible: false };
  const pct = u.maxHealth > 0 ? u.health / u.maxHealth : 0;
  const auras = u.auras.filter((a) => (b.aura ? a.harmful === (b.aura === "debuff") : true));
  const secretKind = st.inCombat ? (id === "player" || id === "target" ? "measured" : "inferred") : undefined;
  switch (b.stat) {
    case "health": {
      const dead = !u.alive;
      const base = unitColor(u);
      let bar: Rgba = dead ? [0.35, 0.35, 0.35, 1] : base, bg: Rgba = dead ? [0.1, 0.1, 0.1, 0.9] : [base[0] * 0.18, base[1] * 0.18, base[2] * 0.18, 0.9];
      if (b.colorBy === "threshold" && !dead) { bar = thresholdColor(pct); bg = [0.08, 0.09, 0.11, 0.9]; }
      if (b.colorBy === "none") return { visible: true, fill: pct };
      if (b.colorBy === "classBar") return { visible: true, fill: pct, barColor: bar, bgColor: [0, 0, 0, 0] };
      return { visible: true, fill: pct, barColor: bar, bgColor: bg };
    }
    case "healthLag": {
      const dead = !u.alive, base = unitColor(u);
      return { visible: true, fill: u.maxHealth > 0 ? Math.max(u.lag, u.health) / u.maxHealth : 0, barColor: [0.85, 0.25, 0.2, 0.75], bgColor: dead ? [0.1, 0.1, 0.1, 0.9] : [base[0] * 0.18, base[1] * 0.18, base[2] * 0.18, 0.9] };
    }
    case "castUninterruptible": return { visible: !!u.cast && !u.cast.interruptible, tint: [0.6, 0.6, 0.6, 0.45] };
    case "power": return { visible: true, fill: u.maxPower > 0 ? u.power / u.maxPower : 0, barColor: [...POWER_COLORS[u.powerType]] as Rgba };
    case "cast": return u.cast ? { visible: true, fill: Math.min(1, (st.t - u.cast.start) / (u.cast.end - u.cast.start)), barColor: b.fixedColor ?? u.cast.color } : { visible: false, fill: 0 };
    case "auraTime": { const a = auras[b.slot ?? 0]; return a ? { visible: true, fill: Math.max(0, (a.expires - st.t) / a.duration), barColor: a.color } : { visible: false, fill: 0 }; }
    case "name": return { visible: true, text: u.name };
    case "level": return { visible: true, text: String(u.level) };
    case "healthPct": return { visible: true, text: `${Math.floor(pct * 100)}%`, secret: secretKind };
    case "healthCurrent": return { visible: true, text: abbr(u.health), secret: secretKind };
    case "healthBoth": return { visible: true, text: `${abbr(u.health)} | ${Math.floor(pct * 100)}%`, secret: secretKind };
    case "powerCurrent": return { visible: true, text: abbr(u.power) };
    case "powerPct": return { visible: true, text: `${Math.round(u.maxPower ? (u.power / u.maxPower) * 100 : 0)}%` };
    case "castName": return u.cast ? { visible: true, text: u.cast.spell } : { visible: false, text: "" };
    case "castTime": return u.cast ? { visible: true, text: Math.max(0, (u.cast.end - st.t) / 1000).toFixed(1) } : { visible: false, text: "" };
    case "auraStacks": { const a = auras[b.slot ?? 0]; return a ? { visible: a.stacks > 1, text: String(a.stacks) } : { visible: false, text: "" }; }
    case "auraIcon": { const a = auras[b.slot ?? 0]; return a ? { visible: true, tint: a.color } : { visible: false }; }
    case "lowHealth": return { visible: u.alive && pct * 100 < (b.threshold ?? 35), tint: [1, 0.12, 0.08, 1] };
    case "combat": return { visible: st.inCombat };
    case "showIfExists": return { visible: true };
    case "showIfCasting": return { visible: !!u.cast };
    default: return { visible: true };
  }
}

/** A child of a hidden or unbound-visible-false frame is not drawn either, exactly like the client. */
export function visibleChain(scene: Scene, nodeId: string, ctxUnit: string | null, st: SimState | null): boolean {
  for (let n: SceneNode | undefined = scene.nodes[nodeId]; n; n = n.parent ? scene.nodes[n.parent] : undefined) {
    if (n.hidden && n.id !== nodeId) return false;
    if (st && n.bind && !resolve(st, n.bind, ctxUnit).visible) return false;
  }
  return true;
}

// ---------------- repeaters ----------------
export interface Entry { key: string; id: string; copy: number; unit: string | null; rect: Rect; dim: boolean }

export function repeatCount(rep: NonNullable<SceneNode["repeat"]>, sc: Scenario | undefined): number {
  const max = rep.kind === "party" ? 4 : 40;
  if (rep.count > 0) return Math.min(max, rep.count);
  if (!sc) return 0;
  if (rep.kind === "party") return sc.group === "party" ? Math.min(4, Math.max(0, sc.groupSize - 1)) : 0;
  return sc.group === "raid" ? Math.min(40, sc.groupSize) : 0;
}

const repeatRoot = (scene: Scene, n: SceneNode): SceneNode | null => {
  for (let cur: SceneNode | undefined = n; cur; cur = cur.parent ? scene.nodes[cur.parent] : undefined) if (cur.repeat) return cur;
  return null;
};

/** One entry per drawn element. With `preview` off every node appears once (editing); with it on, repeaters expand into grids. */
export function expandEntries(scene: Scene, rects: Map<string, Rect>, preview: boolean, sc?: Scenario): Entry[] {
  const out: Entry[] = [];
  for (const id of scene.order) {
    const n = scene.nodes[id]; const r = rects.get(id);
    if (!n || !r) continue;
    const root = preview ? repeatRoot(scene, n) : null;
    if (!root) { out.push({ key: id, id, copy: 0, unit: null, rect: r, dim: false }); continue; }
    const rep = root.repeat!, rr = rects.get(root.id);
    if (!rr) continue;
    const count = repeatCount(rep, sc);
    if (count === 0) { out.push({ key: id, id, copy: 0, unit: null, rect: r, dim: true }); continue; }
    const cols = Math.max(1, rep.columns);
    for (let i = 0; i < count; i++) {
      const dx = (i % cols) * (rr.w + rep.gapX), dy = -Math.floor(i / cols) * (rr.h + rep.gapY);
      out.push({ key: `${id}#${i}`, id, copy: i, unit: `${rep.kind}${i + 1}`, rect: { l: r.l + dx, b: r.b + dy, w: r.w, h: r.h }, dim: false });
    }
  }
  return out;
}

// ---------------- preview validation ----------------
export interface PreviewIssue { severity: "error" | "warning" | "info"; code: string; message: string; nodeId?: string; confidence: "certain" | "sourced" | "heuristic"; evidence: "static" | "needs-game-test" }

export function checkScene(scene: Scene, sc: Scenario | undefined): PreviewIssue[] {
  const out: PreviewIssue[] = [];
  const units = sc ? new Set(Object.keys(initial(sc).units)) : new Set(["player", "target"]);
  let anyBind = false, anyRepeat = false;
  for (const n of Object.values(scene.nodes)) {
    if (n.repeat) {
      anyRepeat = true;
      if (!["frame", "button", "statusbar"].includes(n.kind)) out.push({ severity: "error", code: "preview.repeat-kind", message: `${n.name}: only frames can repeat`, nodeId: n.id, confidence: "certain", evidence: "static" });
      for (let p = n.parent ? scene.nodes[n.parent] : undefined; p; p = p.parent ? scene.nodes[p.parent] : undefined) if (p.repeat) out.push({ severity: "error", code: "preview.nested-repeat", message: `${n.name}: nested repeaters are not supported`, nodeId: n.id, confidence: "certain", evidence: "static" });
      if (sc && repeatCount(n.repeat, sc) === 0) out.push({ severity: "info", code: "preview.repeat-empty", message: `${n.name}: the scenario "${sc.name}" has no ${n.repeat.kind} members, so nothing is repeated`, nodeId: n.id, confidence: "certain", evidence: "static" });
    }
    const b = n.bind;
    if (!b) continue;
    anyBind = true;
    const sup = SUPPORT[b.stat];
    if (!sup) { out.push({ severity: "error", code: "preview.unknown-stat", message: `${n.name}: "${b.stat}" is not a supported preview binding`, nodeId: n.id, confidence: "certain", evidence: "static" }); continue; }
    if (!sup.kinds.includes(n.kind)) out.push({ severity: "warning", code: "preview.unsupported-binding", message: `${n.name}: "${b.stat}" can drive ${sup.kinds.join("/")} nodes, not ${n.kind}`, nodeId: n.id, confidence: "certain", evidence: "static" });
    if (b.unit !== "$unit" && !units.has(b.unit)) out.push({ severity: "info", code: "preview.unit-missing", message: `${n.name}: unit "${b.unit}" does not exist in the "${sc?.name ?? "current"}" scenario`, nodeId: n.id, confidence: "certain", evidence: "static" });
    if (b.unit === "$unit" && !(repeatRoot(scene, n))) out.push({ severity: "info", code: "preview.unit-placeholder", message: `${n.name}: "$unit" outside a repeater resolves to the player`, nodeId: n.id, confidence: "certain", evidence: "static" });
    if (sup.secretInCombat) out.push({ severity: "info", code: "preview.secret-text", message: `${n.name}: this preview shows ${b.stat} as plain text, but on Forever health values are secret in combat (measured for player/target by forever-addon-kit). Real addons must not compare or do arithmetic on them; Tempus drives such displays with UnitHealthPercent curves/widgets. Confirm in game.`, nodeId: n.id, confidence: "sourced", evidence: "needs-game-test" });
  }
  if (anyBind || anyRepeat) out.push({ severity: "info", code: "preview.not-generated", message: "Preview bindings and repeaters are simulation-only: they are not written into generated Lua/XML. Wire real events and unit APIs in your own code.", confidence: "certain", evidence: "static" });
  return out;
}
