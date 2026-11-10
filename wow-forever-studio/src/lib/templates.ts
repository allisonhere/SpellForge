import { addNode, newScene, saveAsTemplate, type Anchor, type Binding, type Point, type Scene, type Template } from "./scene";

const A = (point: Point, relPoint: Point, x = 0, y = 0, relTo: string | null = null): Anchor => ({ point, relTo, relPoint, x, y });
const B = (stat: string, extra: Partial<Binding> = {}): Binding => ({ unit: "$unit", stat, ...extra });

function build(name: string, fn: (s: Scene) => string, id?: string): Template {
  const s = newScene("tmp");
  const rootId = fn(s);
  const t = saveAsTemplate(s, rootId, name);
  t.builtIn = true;
  t.id = id ?? "builtin-" + name.toLowerCase().replace(/\W+/g, "-");
  return t;
}

/**
 * Geometry taken from Tempus Modules/UnitFrames/UnitFrames.lua (commit 7bac2c2) for a unit frame with no portrait:
 * 230x44 frame, health = TOPLEFT/TOPRIGHT, height = 44 - powerHeight(9) - 1 = 34, power = BOTTOMLEFT/BOTTOMRIGHT 9px,
 * 1px black separator 1px below the health bar, name LEFT+5, health text RIGHT-5, power text RIGHT-5, panel fill
 * {0.06, 0.068, 0.085, 0.92} (Core/Style.lua S.C.panel), class-coloured health with a background at 18% of that colour.
 * Also modelled: the S.Backdrop edge (1px black) and shadow (3px, alpha 0.45), the S.LagBar (red {0.85,0.25,0.2,0.75} behind health, easing),
 * the player low-health glow (red {1,0.12,0.08}, S.Pulse 1→0.3 over 1.1s), the castbar (UnitFrames.lua ~L494-545, 730-738), target auras
 * (24px, spacing 3, 8 per row, growing up) and the portrait slot (frame height x height, health/power shifted by height+1).
 * NOT modelled: the 3D/2D portrait *contents* (a game model cannot be rendered), the inner border, real glow/bar textures, smooth bars,
 * class power pips, secure unit button, health colour modes other than CLASS.
 */
export const TEMPUS_UNIT_FRAME_ID = "builtin-tempus-unit-frame";


const TEMPUS_PANEL: [number, number, number, number] = [0.06, 0.068, 0.085, 0.92];
const TEMPUS_ACCENT: [number, number, number, number] = [0.25, 0.76, 1, 1];
const EDGE = { size: 1, color: [0, 0, 0, 1] as [number, number, number, number] };
const SHADOW = { size: 3, alpha: 0.45 };

interface TempusOpts { name: string; unit: string; x: number; y: number; portrait: boolean; powerText: "powerCurrent" | "powerPct"; glow: boolean; castbar: boolean; auras: boolean }

/** One Tempus unit frame (UnitFrames.lua defaults: width 230, height 44, powerHeight 9, castbarHeight 18, auraSize 24). */
function tempusFrame(s: Scene, o: TempusOpts): string {
  const W = 230, H = 44, PH = 9, left = o.portrait ? H + 1 : 0;
  const u = o.unit;
  const root = addNode(s, "frame", null, { name: o.name, width: W, height: H, color: TEMPUS_PANEL, border: EDGE, shadow: SHADOW, anchors: [A("CENTER", "CENTER", o.x, o.y)], bind: { unit: u, stat: "showIfExists" } });
  if (o.glow) addNode(s, "texture", root.id, { name: "LowGlow", layer: "BACKGROUND", color: [1, 0.12, 0.08, 1], blend: "ADD", pulse: { high: 1, low: 0.3, period: 1.1 }, anchors: [A("TOPLEFT", "TOPLEFT", -14, 14), A("BOTTOMRIGHT", "BOTTOMRIGHT", 14, -14)], bind: { unit: u, stat: "lowHealth", threshold: 35 } });
  if (o.portrait) {
    const pf = addNode(s, "frame", root.id, { name: "Portrait", width: H, height: H, color: TEMPUS_PANEL, border: EDGE, anchors: [A("TOPLEFT", "TOPLEFT")] });
    addNode(s, "fontstring", pf.id, { name: "PortraitNote", text: "3D", width: H, height: 12, fontSize: 9, color: [0.45, 0.5, 0.62, 1], justify: "CENTER", anchors: [A("CENTER", "CENTER")] });
  }
  // Lag bar sits behind the health bar and owns the (class * 0.18) background, exactly as S.LagBar re-parents hp.bg.
  addNode(s, "statusbar", root.id, { name: "HealthLag", height: H - PH - 1, color: [0, 0, 0, 0], anchors: [A("TOPLEFT", "TOPLEFT", left, 0), A("TOPRIGHT", "TOPRIGHT")], bind: { unit: u, stat: "healthLag" } });
  const hp = addNode(s, "statusbar", root.id, { name: "Health", height: H - PH - 1, color: [0, 0, 0, 0], anchors: [A("TOPLEFT", "TOPLEFT", left, 0), A("TOPRIGHT", "TOPRIGHT")], bind: { unit: u, stat: "health", colorBy: "classBar" } });
  const pw = addNode(s, "statusbar", root.id, { name: "Power", height: PH, color: [0.05, 0.05, 0.07, 0.9], anchors: [A("BOTTOMLEFT", "BOTTOMLEFT", left, 0), A("BOTTOMRIGHT", "BOTTOMRIGHT")], bind: { unit: u, stat: "power" } });
  addNode(s, "texture", root.id, { name: "PowerSep", height: 1, color: [0, 0, 0, 1], layer: "ARTWORK", anchors: [A("BOTTOMLEFT", "BOTTOMLEFT", 0, -1, hp.id), A("BOTTOMRIGHT", "BOTTOMRIGHT", 0, -1, hp.id)] });
  const ht = addNode(s, "fontstring", hp.id, { name: "HealthText", text: "182k | 82%", justify: "RIGHT", width: 90, height: 14, fontSize: 12, color: [1, 1, 1, 1], anchors: [A("RIGHT", "RIGHT", -5, 0)], bind: { unit: u, stat: "healthBoth" } });
  addNode(s, "fontstring", hp.id, { name: "NameText", text: "Name", justify: "LEFT", height: 14, fontSize: 12, color: [1, 1, 1, 1], anchors: [A("LEFT", "LEFT", 5, 0), A("RIGHT", "LEFT", -6, 0, ht.id)], bind: { unit: u, stat: "name" } });
  addNode(s, "fontstring", pw.id, { name: "PowerText", text: "100", justify: "RIGHT", width: 60, height: 9, fontSize: 9, color: [1, 1, 1, 1], anchors: [A("RIGHT", "RIGHT", -5, 0)], bind: { unit: u, stat: o.powerText } });
  if (o.castbar) {
    const CH = 18;
    const cb = addNode(s, "frame", root.id, { name: "CastBar", height: CH, color: TEMPUS_PANEL, border: EDGE, shadow: SHADOW, anchors: [A("TOPLEFT", "BOTTOMLEFT", CH + 4, -6), A("TOPRIGHT", "BOTTOMRIGHT", 0, -6)], bind: { unit: u, stat: "showIfCasting" } });
    addNode(s, "statusbar", cb.id, { name: "CastFill", color: [0, 0, 0, 0], anchors: [A("TOPLEFT", "TOPLEFT"), A("BOTTOMRIGHT", "BOTTOMRIGHT")], bind: { unit: u, stat: "cast", fixedColor: TEMPUS_ACCENT } });
    addNode(s, "texture", cb.id, { name: "Shield", layer: "OVERLAY", color: [0.6, 0.6, 0.6, 0.45], anchors: [A("TOPLEFT", "TOPLEFT"), A("BOTTOMRIGHT", "BOTTOMRIGHT")], bind: { unit: u, stat: "castUninterruptible" } });
    const tm = addNode(s, "fontstring", cb.id, { name: "CastTime", text: "1.4", justify: "RIGHT", width: 36, height: 12, fontSize: 10, color: [1, 1, 1, 1], layer: "OVERLAY", anchors: [A("RIGHT", "RIGHT", -6, 0)], bind: { unit: u, stat: "castTime" } });
    addNode(s, "fontstring", cb.id, { name: "CastText", text: "Spell", justify: "LEFT", height: 12, fontSize: 10, color: [1, 1, 1, 1], layer: "OVERLAY", anchors: [A("LEFT", "LEFT", 6, 0), A("RIGHT", "LEFT", -4, 0, tm.id)], bind: { unit: u, stat: "castName" } });
    const ic = addNode(s, "frame", cb.id, { name: "CastIconFrame", width: CH, height: CH, color: [0.2, 0.22, 0.3, 1], border: EDGE, shadow: SHADOW, anchors: [A("RIGHT", "LEFT", -4, 0)] });
    void ic;
  }
  if (o.auras) {
    const SZ = 24, GAP = 3, PER = 8;
    const row = (name: string, kind: "buff" | "debuff", rel: string | null, dy: number) => {
      const fr = addNode(s, "frame", root.id, { name, width: W, height: SZ, color: [0, 0, 0, 0], anchors: [A("BOTTOMLEFT", "TOPLEFT", 0, dy, rel)] });
      for (let i = 0; i < PER; i++) addNode(s, "frame", fr.id, { name: `${name}${i + 1}`, width: SZ, height: SZ, color: [0.2, 0.22, 0.3, 1], border: EDGE, anchors: [A("BOTTOMLEFT", "BOTTOMLEFT", i * (SZ + GAP), 0)], bind: { unit: u, stat: "auraIcon", slot: i, aura: kind } });
      return fr;
    };
    const deb = row("Debuffs", "debuff", null, 6);
    row("Buffs", "buff", deb.id, GAP);
  }
  return root.id;
}

export function builtInTemplates(): Template[] {
  return [
    build("Tempus Player Frame", (s) => tempusFrame(s, { name: "TempusPlayer", unit: "player", x: -300, y: -180, portrait: true, powerText: "powerCurrent", glow: true, castbar: true, auras: false }), "builtin-tempus-player-frame"),
    build("Tempus Target Frame", (s) => tempusFrame(s, { name: "TempusTarget", unit: "target", x: 300, y: -180, portrait: true, powerText: "powerPct", glow: false, castbar: true, auras: true }), "builtin-tempus-target-frame"),
    build("Tempus Unit Frame (compact)", (s) => tempusFrame(s, { name: "TempusUnitFrame", unit: "$unit", x: 0, y: 0, portrait: false, powerText: "powerCurrent", glow: false, castbar: false, auras: false }), TEMPUS_UNIT_FRAME_ID),
    build("Unit Frame", (s) => {
      const root = addNode(s, "frame", null, { name: "UnitFrame", width: 232, height: 64, color: [0.06, 0.07, 0.1, 0.92], anchors: [A("CENTER", "CENTER")] });
      const hp = addNode(s, "statusbar", root.id, { name: "Health", width: 220, height: 30, value: 82, color: [0, 0, 0, 0.5], anchors: [A("TOPLEFT", "TOPLEFT", 6, -6)], bind: { unit: "player", stat: "health", colorBy: "class" } });
      addNode(s, "fontstring", hp.id, { name: "Name", text: "Player Name", justify: "LEFT", width: 150, height: 14, anchors: [A("LEFT", "LEFT", 6, 0)], bind: { unit: "player", stat: "name" } });
      addNode(s, "fontstring", hp.id, { name: "HealthText", text: "82%", justify: "RIGHT", width: 50, height: 14, color: [1, 1, 1, 1], anchors: [A("RIGHT", "RIGHT", -6, 0)], bind: { unit: "player", stat: "healthPct" } });
      addNode(s, "statusbar", root.id, { name: "Power", width: 220, height: 12, value: 60, color: [0, 0, 0, 0.5], anchors: [A("TOPLEFT", "BOTTOMLEFT", 0, -4, hp.id)], bind: { unit: "player", stat: "power" } });
      return root.id;
    }),
    build("Cast Bar", (s) => {
      const root = addNode(s, "statusbar", null, { name: "CastBar", width: 240, height: 20, value: 45, color: [0.04, 0.04, 0.06, 0.9], anchors: [A("CENTER", "CENTER", 0, -160)], bind: { unit: "target", stat: "cast" } });
      addNode(s, "fontstring", root.id, { name: "SpellName", text: "Fireball", justify: "LEFT", width: 170, height: 14, anchors: [A("LEFT", "LEFT", 6, 0)], bind: { unit: "target", stat: "castName" } });
      addNode(s, "fontstring", root.id, { name: "Timer", text: "1.4", justify: "RIGHT", width: 40, height: 14, anchors: [A("RIGHT", "RIGHT", -6, 0)], bind: { unit: "target", stat: "castTime" } });
      return root.id;
    }),
    build("Aura Icon", (s) => {
      const root = addNode(s, "frame", null, { name: "AuraIcon", width: 36, height: 36, color: [0, 0, 0, 0.9], anchors: [A("CENTER", "CENTER")], bind: { unit: "player", stat: "auraIcon", slot: 0 } });
      addNode(s, "texture", root.id, { name: "Icon", width: 32, height: 32, anchors: [A("CENTER", "CENTER")], bind: { unit: "player", stat: "auraIcon", slot: 0, aura: "buff" } });
      addNode(s, "fontstring", root.id, { name: "Stacks", text: "2", width: 36, height: 12, fontSize: 11, outline: "OUTLINE", anchors: [A("BOTTOMRIGHT", "BOTTOMRIGHT", -1, 2)], layer: "OVERLAY", bind: { unit: "player", stat: "auraStacks", slot: 0, aura: "buff" } });
      return root.id;
    }),
    build("Party Frames (preview ×4)", (s) => {
      const root = addNode(s, "frame", null, { name: "PartyMember", width: 150, height: 40, color: [0.06, 0.068, 0.085, 0.92], anchors: [A("TOPLEFT", "TOPLEFT", 40, -300)], repeat: { kind: "party", count: 0, columns: 1, gapX: 4, gapY: 6 } });
      const hp = addNode(s, "statusbar", root.id, { name: "Health", height: 30, color: [0.1, 0.1, 0.12, 0.9], anchors: [A("TOPLEFT", "TOPLEFT"), A("TOPRIGHT", "TOPRIGHT")], bind: B("health", { colorBy: "class" }) });
      addNode(s, "fontstring", hp.id, { name: "Name", text: "Party Member", justify: "LEFT", width: 100, height: 12, fontSize: 11, anchors: [A("LEFT", "LEFT", 4, 0)], bind: B("name") });
      addNode(s, "fontstring", hp.id, { name: "Pct", text: "100%", justify: "RIGHT", width: 40, height: 12, fontSize: 11, anchors: [A("RIGHT", "RIGHT", -4, 0)], bind: B("healthPct") });
      addNode(s, "statusbar", root.id, { name: "Power", height: 8, color: [0.05, 0.05, 0.07, 0.9], anchors: [A("BOTTOMLEFT", "BOTTOMLEFT"), A("BOTTOMRIGHT", "BOTTOMRIGHT")], bind: B("power") });
      return root.id;
    }),
    build("Raid Frames (preview ×40)", (s) => {
      const root = addNode(s, "frame", null, { name: "RaidMember", width: 84, height: 34, color: [0.06, 0.068, 0.085, 0.92], anchors: [A("TOPLEFT", "TOPLEFT", 40, -40)], repeat: { kind: "raid", count: 0, columns: 8, gapX: 2, gapY: 2 } });
      const hp = addNode(s, "statusbar", root.id, { name: "Health", color: [0.1, 0.1, 0.12, 0.9], anchors: [A("TOPLEFT", "TOPLEFT"), A("BOTTOMRIGHT", "BOTTOMRIGHT")], bind: B("health", { colorBy: "class" }) });
      addNode(s, "fontstring", hp.id, { name: "Name", text: "Raider", justify: "CENTER", width: 80, height: 11, fontSize: 10, anchors: [A("CENTER", "CENTER")], bind: B("name") });
      return root.id;
    }),
  ];
}
