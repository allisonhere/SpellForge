import { untrack } from "svelte";
import { ipc, errText } from "./ipc";
import { store } from "./store.svelte";
import { History } from "./history";
import { addNode, childrenOf, deleteNode, descendants, duplicate, instantiate, isContainer, newScene, reorder, saveAsTemplate, validateScene, type Kind, type Scene, type SceneNode, type Template } from "./scene";
import { setRect, solve, type Guide } from "./layout";
import { generate, isGenerated } from "./codegen";
import { builtInTemplates } from "./templates";
import { Sim, TICK_MS } from "./sim/engine";
import { BUILTIN_SCENARIOS, mergeScenarios, scenarioDefaults } from "./sim/scenarios";
import { checkScene } from "./sim/bind";
import type { Scenario } from "./sim/types";

export const RESOLUTIONS: [string, number, number][] = [["1280×720", 1280, 720], ["1920×1080", 1920, 1080], ["2560×1440", 2560, 1440], ["3440×1440 ultrawide", 3440, 1440], ["3840×2160", 3840, 2160]];
const sceneFile = (name: string) => `Design/${name}.scene.json`;

class Designer {
  scene = $state<Scene>(newScene());
  path = $state<string | null>(null);
  selection = $state<string | null>(null);
  dirty = $state(false);
  zoom = $state(0.5);
  fit = $state(true);
  snap = $state(true);
  grid = $state(8);
  showGrid = $state(true);
  showCode = $state(false);
  guides = $state<Guide[]>([]);
  history = new History<Scene>();
  historyTick = $state(0);
  private commitTimer: ReturnType<typeof setTimeout> | undefined;

  // ---- simulation (Phase 3) ----
  preview = $state(false);
  playing = $state(false);
  speed = $state(1);
  scenarioId = $state("solo-combat");
  sim = $state.raw<Sim>(new Sim(BUILTIN_SCENARIOS[1]!));
  simVersion = $state(0);
  scenarios = $derived(mergeScenarios(this.scene.scenarios));
  scenario = $derived<Scenario>(this.scenarios.find((x) => x.id === this.scenarioId) ?? this.scenarios[0]!);
  previewIssues = $derived(checkScene(this.scene, this.scenario));
  private raf = 0; private last = 0; private acc = 0;

  /** Restart the run. Safe to call from an $effect: it must not subscribe to the state it writes. */
  resetSim() { const sc = $state.snapshot(this.scenario) as Scenario; untrack(() => { this.sim = new Sim(sc); this.acc = 0; this.simVersion = this.simVersion + 1; }); }
  play() {
    if (this.playing) return;
    this.preview = true; this.playing = true; this.last = performance.now();
    const loop = (now: number) => {
      if (!this.playing) return;
      this.acc += Math.min(1000, now - this.last) * this.speed; this.last = now;
      const ticks = Math.floor(this.acc / TICK_MS);
      if (ticks > 0) { this.sim.advance(ticks * TICK_MS); this.acc -= ticks * TICK_MS; this.simVersion++; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); }
  stepOnce() { this.preview = true; this.pause(); this.sim.step(); this.simVersion++; }
  togglePreview() { this.preview = !this.preview; if (!this.preview) this.pause(); }
  /** Edit one parameter of the active scenario. Stored in the scene file as an override of the built-in. */
  setScenarioParam<K extends keyof Scenario>(key: K, value: Scenario[K]) {
    this.edit(() => {
      const list = (this.scene.scenarios ??= []);
      let o = list.find((x) => x.id === this.scenarioId);
      if (!o) { o = structuredClone($state.snapshot(this.scenario)) as Scenario; list.push(o); }
      o[key] = value;
    }, true);
  }
  resetScenarioOverride() { this.edit(() => { this.scene.scenarios = (this.scene.scenarios ?? []).filter((x) => x.id !== this.scenarioId || !scenarioDefaults(x.id)); }, true); }
  addCustomScenario(name: string) {
    this.edit(() => {
      const id = "custom-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scenario");
      (this.scene.scenarios ??= []).push({ ...(structuredClone($state.snapshot(this.scenario)) as Scenario), id, name: name || "Custom scenario", description: "Custom scenario based on " + this.scenario.name });
      this.scenarioId = id;
    }, true);
  }
  isOverridden = $derived(!!this.scene.scenarios?.some((x) => x.id === this.scenarioId));

  solved = $derived(solve(this.scene));
  generated = $derived(generate(this.scene));
  templates = $derived<Template[]>([...builtInTemplates(), ...this.scene.templates]);
  selected = $derived(this.selection ? this.scene.nodes[this.selection] ?? null : null);
  canUndo = $derived((this.historyTick, this.history.canUndo));
  canRedo = $derived((this.historyTick, this.history.canRedo));
  sceneFiles = $derived(store.files.filter((f) => !f.isDir && /^Design\/[^/]+\.scene\.json$/.test(f.path)).map((f) => f.path));

  /** Run a mutation as one undo step. Rapid edits (typing, nudging) coalesce. */
  edit(fn: () => void, quiet = false) {
    this.history.begin($state.snapshot(this.scene) as Scene);
    try { fn(); } catch (e) { store.say("warn", errText(e)); }
    this.dirty = true;
    clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commit(), quiet ? 0 : 450);
  }
  /** Drag support: begin once, mutate with `touch()`, then `commit()`. */
  begin() { clearTimeout(this.commitTimer); this.history.begin($state.snapshot(this.scene) as Scene); }
  touch() { this.dirty = true; }
  commit() { clearTimeout(this.commitTimer); this.history.commit($state.snapshot(this.scene) as Scene); this.historyTick++; this.guides = []; }

  undo() { this.commit(); const p = this.history.undo($state.snapshot(this.scene) as Scene); if (p) { this.scene = p; this.dirty = true; this.fixSelection(); this.historyTick++; } }
  redo() { this.commit(); const n = this.history.redo($state.snapshot(this.scene) as Scene); if (n) { this.scene = n; this.dirty = true; this.fixSelection(); this.historyTick++; } }
  private fixSelection() { if (this.selection && !this.scene.nodes[this.selection]) this.selection = null; }

  add(kind: Kind) {
    this.edit(() => {
      const sel = this.selected;
      const parent = sel && isContainer(sel.kind) ? sel.id : sel?.parent ?? null;
      if (!parent && kind !== "frame" && kind !== "statusbar" && kind !== "button") throw new Error("Textures and text need a frame: select or add a frame first.");
      const n = addNode(this.scene, kind, parent);
      this.selection = n.id;
    }, true);
  }
  addTemplate(t: Template) {
    this.edit(() => {
      const sel = this.selected;
      const parent = sel && isContainer(sel.kind) ? sel.id : null;
      this.selection = instantiate(this.scene, structuredClone($state.snapshot(t)) as Template, parent);
    }, true);
  }
  remove() { const id = this.selection; if (!id) return; this.edit(() => { deleteNode(this.scene, id); this.selection = null; }, true); }
  dup() { const id = this.selection; if (!id) return; this.edit(() => { this.selection = duplicate(this.scene, id); }, true); }
  z(delta: number) { const id = this.selection; if (id) this.edit(() => reorder(this.scene, id, delta), true); }
  makeTemplate(name: string) { const id = this.selection; if (id && name) this.edit(() => { saveAsTemplate(this.scene, id, name); }, true); }
  nudge(dx: number, dy: number) {
    const n = this.selected; if (!n) return;
    this.edit(() => { for (const a of n.anchors) { a.x += dx; a.y += dy; } });
  }
  /** Move a node under a new parent keeping its on-screen position. */
  reparent(id: string, newParent: string | null) {
    const n = this.scene.nodes[id];
    if (!n || n.parent === newParent || id === newParent) return;
    if (newParent && (descendants(this.scene, id).includes(newParent) || !isContainer(this.scene.nodes[newParent]!.kind))) { store.say("warn", "That element cannot be moved there."); return; }
    if (!newParent && n.kind !== "frame" && n.kind !== "statusbar" && n.kind !== "button") { store.say("warn", "Textures and text must stay inside a frame."); return; }
    const solved = this.solved;
    const rect = solved.rects.get(id);
    if (!rect) return;
    this.edit(() => {
      n.parent = newParent;
      n.anchors = [{ point: "BOTTOMLEFT", relTo: null, relPoint: "BOTTOMLEFT", x: 0, y: 0 }];
      // `solved` still holds every rect (including the new parent's), so offsets are computed against the new parent.
      setRect(this.scene, id, rect, solved);
      const k = this.scene.order.indexOf(id); this.scene.order.splice(k, 1); this.scene.order.push(id);
    }, true);
  }

  childrenOf = (id: string | null): SceneNode[] => childrenOf(this.scene, id);

  setResolution(w: number, h: number) { this.edit(() => { this.scene.resolution = { w, h }; }, true); }

  async newSceneFlow(name: string) {
    if (!store.project) return;
    const s = newScene(name.replace(/[^A-Za-z0-9_]/g, "_") || "MainUI");
    this.scene = s; this.path = sceneFile(s.name); this.selection = null; this.history.clear(); this.historyTick++; this.dirty = true;
    store.say("info", `New scene ${s.name} (not saved yet)`);
  }
  async load(path: string) {
    try {
      const f = await ipc.readFile(path);
      this.scene = validateScene(JSON.parse(f.content));
      this.path = path; this.selection = null; this.dirty = false; this.history.clear(); this.historyTick++;
      store.say("ok", `Loaded ${path}`);
    } catch (e) { store.fail(`${path}: ${errText(e)}`); }
  }
  async save(): Promise<boolean> {
    const path = this.path ?? sceneFile(this.scene.name);
    try {
      await ipc.writeFile(path, JSON.stringify($state.snapshot(this.scene), null, 2) + "\n");
      this.path = path; this.dirty = false; await store.refreshFiles();
      store.say("ok", `Saved ${path}`);
      return true;
    } catch (e) { store.fail(e); return false; }
  }
  /** Writes Generated/<Name>.lua and .xml. Refuses to overwrite a file that was not generated by this tool. */
  async generateFiles() {
    const g = this.generated;
    try {
      for (const [path, text] of [[g.luaPath, g.lua], [g.xmlPath, g.xml]] as const) {
        let existing: string | null = null;
        try { existing = (await ipc.readFile(path)).content; } catch { /* does not exist yet */ }
        if (existing !== null && !isGenerated(existing)) throw new Error(`${path} already exists and was not generated by WoW Forever Studio; refusing to overwrite your code. Rename the scene or move that file.`);
        await ipc.writeFile(path, text);
      }
      await this.save();
      await store.refreshFiles();
      for (const w of g.warnings) store.say("warn", `Design: ${w}`);
      const inToc = store.project?.tocs.some((t) => t.entries.some((e) => e.path.toLowerCase() === g.luaPath.toLowerCase()));
      store.say("ok", `Generated ${g.luaPath} and ${g.xmlPath}${inToc ? "" : `. Add "${g.luaPath.replace(/\//g, "\\")}" to your TOC (before the code that calls ns.UI.Create${g.luaPath.split("/")[1]?.replace(".lua", "")}()).`}`);
    } catch (e) { store.fail(e); }
  }
}
export const designer = new Designer();
