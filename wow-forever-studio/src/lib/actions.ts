import { ipc, errText } from "./ipc";
import { store } from "./store.svelte";
import { closeDoc, disposeAll, docs, openDoc, saveDoc } from "./monacoSetup";

export async function openProjectFlow(p: Promise<import("./types").ProjectInfo | null>) {
  try {
    const info = await p;
    if (!info) return;
    disposeAll();
    await store.loadProjectState(info);
    store.recent = (await ipc.boot()).settings.recentProjects;
    const mainLua = info.tocs.find((t) => t.file === info.mainToc)?.entries.find((e) => e.path.toLowerCase().endsWith(".lua"))?.path;
    if (mainLua) await openFile(mainLua);
  } catch (e) { store.fail(e); }
}
export const openFolder = () => openProjectFlow(ipc.pickProject());
export const openNested = (path: string) => openProjectFlow(ipc.openNested(path));
export const openRecent = (path: string) => openProjectFlow(ipc.openRecent(path));

export async function openFile(path: string, line?: number, col?: number) {
  try {
    await openDoc(path);
    if (!store.tabs.some((t) => t.path === path)) store.tabs.push({ path, dirty: false });
    store.active = path;
    if (line) store.goto(path, line, col ?? 1);
    store.persist();
  } catch (e) { store.fail(`${path}: ${errText(e)}`); }
}

export async function closeTab(path: string) {
  const t = store.tabs.find((x) => x.path === path);
  if (t?.dirty && !confirm(`${path} has unsaved changes. Close and discard them?`)) return;
  const i = store.tabs.findIndex((x) => x.path === path);
  store.tabs.splice(i, 1);
  closeDoc(path);
  if (store.active === path) store.active = store.tabs[Math.min(i, store.tabs.length - 1)]?.path ?? null;
  store.persist();
}

export async function saveActive() { if (store.active) { await saveDoc(store.active); await store.validate(true); } }
export async function saveAll() { for (const t of store.tabs.filter((t) => t.dirty)) await saveDoc(t.path); await store.validate(true); }

export async function packageNow() {
  if (!store.project) return;
  store.busy = "Packaging…";
  try {
    const r = await ipc.packageProject();
    if (r) store.say("ok", `Packaged ${r.files} files (${(r.bytes / 1024).toFixed(0)} KB) → ${r.path}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`);
  } catch (e) { store.fail(e); } finally { store.busy = ""; }
}

export async function findReferences(name: string) {
  try {
    const items = await ipc.search(name, true, true);
    store.hits = { title: `References to ${name}`, items };
    store.ui.showBottom = true; store.ui.bottomTab = "results";
  } catch (e) { store.fail(e); }
}

export function goToDefinition(name: string): boolean {
  const short = name.includes(":") || name.includes(".") ? name : name;
  const cands = store.symbols.filter((s) => s.name === short || s.name.endsWith(`.${short}`) || s.name.endsWith(`:${short}`));
  const best = cands.find((s) => s.scope === "global") ?? cands[0];
  if (!best) { store.say("info", `No project definition found for '${name}' (index is lexical; library or API symbols have no source here).`); return false; }
  void openFile(best.file, best.line, best.col);
  return true;
}

export const dirtyCount = () => store.tabs.filter((t) => t.dirty).length;
export const hasDocs = () => docs.size;

export interface Cmd { id: string; title: string; keys?: string; run: () => void | Promise<void>; when?: () => boolean }
export const commands: Cmd[] = [
  { id: "open", title: "Open Addon Folder…", keys: "Ctrl+O", run: openFolder },
  { id: "new", title: "New Addon…", run: () => { store.modal = "new"; } },
  { id: "save", title: "Save File", keys: "Ctrl+S", run: saveActive },
  { id: "saveAll", title: "Save All", keys: "Ctrl+Shift+S", run: saveAll },
  { id: "validate", title: "Validate Project", keys: "Ctrl+Shift+V", run: () => store.validate(), when: () => !!store.project },
  { id: "package", title: "Package Addon as ZIP…", run: packageNow, when: () => !!store.project },
  { id: "deploy", title: "Deploy to WoW Installation…", run: () => { store.modal = "deploy"; }, when: () => !!store.project },
  { id: "settings", title: "Settings: Installations & API Snapshot", keys: "Ctrl+,", run: () => { store.modal = "settings"; } },
  { id: "toggleLeft", title: "Toggle Left Sidebar", keys: "Ctrl+B", run: () => { store.ui.showLeft = !store.ui.showLeft; store.persist(); } },
  { id: "toggleRight", title: "Toggle Right Sidebar", keys: "Ctrl+Alt+B", run: () => { store.ui.showRight = !store.ui.showRight; store.persist(); } },
  { id: "toggleBottom", title: "Toggle Bottom Panel", keys: "Ctrl+J", run: () => { store.ui.showBottom = !store.ui.showBottom; store.persist(); } },
  { id: "clean", title: "Clean Workspace (hide all panels)", run: () => { store.ui.showLeft = store.ui.showRight = store.ui.showBottom = false; store.persist(); } },
  { id: "full", title: "Show All Panels", run: () => { store.ui.showLeft = store.ui.showRight = store.ui.showBottom = true; store.persist(); } },
  { id: "api", title: "Search API Documentation", keys: "Ctrl+Shift+A", run: () => { store.ui.showLeft = true; store.ui.leftTab = "api"; store.persist(); setTimeout(() => document.getElementById("api-q")?.focus(), 30); } },
  { id: "search", title: "Search in Project", keys: "Ctrl+Shift+F", run: () => { store.ui.showLeft = true; store.ui.leftTab = "search"; store.persist(); setTimeout(() => document.getElementById("proj-q")?.focus(), 30); } },
];
