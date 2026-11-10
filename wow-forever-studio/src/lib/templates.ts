import { addNode, newScene, saveAsTemplate, type Scene, type Template } from "./scene";

function build(name: string, fn: (s: Scene) => string): Template {
  const s = newScene("tmp");
  const rootId = fn(s);
  const t = saveAsTemplate(s, rootId, name);
  t.builtIn = true;
  t.id = "builtin-" + name.toLowerCase().replace(/\W+/g, "-");
  return t;
}

export function builtInTemplates(): Template[] {
  return [
    build("Unit Frame", (s) => {
      const root = addNode(s, "frame", null, { name: "UnitFrame", width: 232, height: 64, color: [0.06, 0.07, 0.1, 0.92], anchors: [{ point: "CENTER", relTo: null, relPoint: "CENTER", x: 0, y: 0 }] });
      const hp = addNode(s, "statusbar", root.id, { name: "Health", width: 220, height: 30, value: 82, barColor: [0.25, 0.78, 0.35, 1], color: [0, 0, 0, 0.5], anchors: [{ point: "TOPLEFT", relTo: null, relPoint: "TOPLEFT", x: 6, y: -6 }] });
      addNode(s, "fontstring", hp.id, { name: "Name", text: "Player Name", justify: "LEFT", width: 150, height: 14, anchors: [{ point: "LEFT", relTo: null, relPoint: "LEFT", x: 6, y: 0 }] });
      addNode(s, "fontstring", hp.id, { name: "HealthText", text: "82%", justify: "RIGHT", width: 50, height: 14, color: [1, 1, 1, 1], anchors: [{ point: "RIGHT", relTo: null, relPoint: "RIGHT", x: -6, y: 0 }] });
      addNode(s, "statusbar", root.id, { name: "Power", width: 220, height: 12, value: 60, barColor: [0.25, 0.5, 0.95, 1], color: [0, 0, 0, 0.5], anchors: [{ point: "TOPLEFT", relTo: hp.id, relPoint: "BOTTOMLEFT", x: 0, y: -4 }] });
      return root.id;
    }),
    build("Cast Bar", (s) => {
      const root = addNode(s, "statusbar", null, { name: "CastBar", width: 240, height: 20, value: 45, barColor: [1, 0.75, 0.2, 1], color: [0.04, 0.04, 0.06, 0.9], anchors: [{ point: "CENTER", relTo: null, relPoint: "CENTER", x: 0, y: -160 }] });
      addNode(s, "fontstring", root.id, { name: "SpellName", text: "Fireball", justify: "LEFT", width: 170, height: 14, anchors: [{ point: "LEFT", relTo: null, relPoint: "LEFT", x: 6, y: 0 }] });
      addNode(s, "fontstring", root.id, { name: "Timer", text: "1.4", justify: "RIGHT", width: 40, height: 14, anchors: [{ point: "RIGHT", relTo: null, relPoint: "RIGHT", x: -6, y: 0 }] });
      return root.id;
    }),
    build("Aura Icon", (s) => {
      const root = addNode(s, "frame", null, { name: "AuraIcon", width: 36, height: 36, color: [0, 0, 0, 0.9], anchors: [{ point: "CENTER", relTo: null, relPoint: "CENTER", x: 0, y: 0 }] });
      addNode(s, "texture", root.id, { name: "Icon", width: 32, height: 32, anchors: [{ point: "CENTER", relTo: null, relPoint: "CENTER", x: 0, y: 0 }] });
      addNode(s, "fontstring", root.id, { name: "Timer", text: "12", width: 36, height: 12, fontSize: 11, outline: "OUTLINE", anchors: [{ point: "BOTTOM", relTo: null, relPoint: "BOTTOM", x: 0, y: 2 }], layer: "OVERLAY" });
      return root.id;
    }),
  ];
}
