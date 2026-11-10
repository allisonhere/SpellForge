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
 * NOT modelled yet: the 1px black border/shadow, lag bar, low-health glow, portrait, smooth bars, secure unit button.
 */
export const TEMPUS_UNIT_FRAME_ID = "builtin-tempus-unit-frame";

export function builtInTemplates(): Template[] {
  return [
    build("Tempus Unit Frame", (s) => {
      const root = addNode(s, "frame", null, { name: "TempusUnitFrame", width: 230, height: 44, color: [0.06, 0.068, 0.085, 0.92], anchors: [A("CENTER", "CENTER", -300, -180)], bind: { unit: "$unit", stat: "showIfExists" } });
      const hp = addNode(s, "statusbar", root.id, { name: "Health", height: 34, color: [0.1, 0.1, 0.12, 0.9], anchors: [A("TOPLEFT", "TOPLEFT"), A("TOPRIGHT", "TOPRIGHT")], bind: B("health", { colorBy: "class" }) });
      const pw = addNode(s, "statusbar", root.id, { name: "Power", height: 9, color: [0.05, 0.05, 0.07, 0.9], anchors: [A("BOTTOMLEFT", "BOTTOMLEFT"), A("BOTTOMRIGHT", "BOTTOMRIGHT")], bind: B("power") });
      addNode(s, "texture", root.id, { name: "PowerSep", height: 1, color: [0, 0, 0, 1], layer: "ARTWORK", anchors: [A("BOTTOMLEFT", "BOTTOMLEFT", 0, -1, hp.id), A("BOTTOMRIGHT", "BOTTOMRIGHT", 0, -1, hp.id)] });
      const ht = addNode(s, "fontstring", hp.id, { name: "HealthText", text: "182k | 82%", justify: "RIGHT", width: 90, height: 14, fontSize: 12, color: [1, 1, 1, 1], anchors: [A("RIGHT", "RIGHT", -5, 0)], bind: B("healthBoth") });
      addNode(s, "fontstring", hp.id, { name: "NameText", text: "Player Name", justify: "LEFT", height: 14, fontSize: 12, color: [1, 1, 1, 1], anchors: [A("LEFT", "LEFT", 5, 0), A("RIGHT", "LEFT", -6, 0, ht.id)], bind: B("name") });
      addNode(s, "fontstring", pw.id, { name: "PowerText", text: "100", justify: "RIGHT", width: 60, height: 9, fontSize: 9, color: [1, 1, 1, 1], anchors: [A("RIGHT", "RIGHT", -5, 0)], bind: B("powerCurrent") });
      return root.id;
    }, TEMPUS_UNIT_FRAME_ID),
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
