import { ipc, errText } from "./ipc";
import type { ApiIndex, CompatNote, Diagnostic, FileEntry, Hit, Installation, ProjectInfo, Report, Symbol, UiState } from "./types";
import type { ApiHit } from "./apiSearch";

export interface Tab { path: string; dirty: boolean }
export interface LogLine { t: number; level: "info" | "ok" | "warn" | "error"; text: string }

class Store {
  project = $state<ProjectInfo | null>(null);
  files = $state<FileEntry[]>([]);
  tabs = $state<Tab[]>([]);
  active = $state<string | null>(null);
  report = $state<Report | null>(null);
  bufferDiags = $state<Record<string, Diagnostic[]>>({});
  /** Preview/simulation findings from the designer (source "preview"). */
  designDiags = $state<Diagnostic[]>([]);
  symbols = $state<Symbol[]>([]);
  hits = $state<{ title: string; items: Hit[] } | null>(null);
  log = $state<LogLine[]>([]);
  recent = $state<string[]>([]);
  installations = $state<Installation[]>([]);
  detected = $state<Installation[]>([]);
  api = $state.raw<ApiIndex | null>(null);
  apiOrigin = $state("bundled");
  notes = $state.raw<CompatNote[]>([]);
  selectedApi = $state<ApiHit | null>(null);
  ui = $state<Required<Omit<UiState, "cursor" | "openFiles" | "activeFile" | "view" | "preview" | "scenarioId" | "autoplay">>>({
    leftWidth: 270, rightWidth: 320, bottomHeight: 220, showLeft: true, showRight: true, showBottom: true,
    leftTab: "explorer", rightTab: "toc", bottomTab: "problems",
  });
  cursor: Record<string, { line: number; col: number }> = {};
  /** Designer view state that is persisted with the workspace. */
  extra = $state<{ preview?: boolean; scenarioId?: string; autoplay?: number }>({});
  modal = $state<null | "settings" | "deploy" | "new" | "palette">(null);
  palettePrefix = $state("");
  busy = $state("");
  jump = $state<{ path: string; line: number; col: number; n: number } | null>(null);
  ready = $state(false);
  view = $state<"code" | "design">("code");

  say(level: LogLine["level"], text: string) {
    this.log.push({ t: Date.now(), level, text });
    if (this.log.length > 500) this.log.splice(0, 100);
  }
  toast = $state<{ text: string; level: "error" | "info" } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Errors must be visible even before a project is open (the Output panel only exists with a project). */
  fail(e: unknown) {
    const text = errText(e);
    this.say("error", text);
    this.toast = { text, level: "error" };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 12000);
  }

  allDiagnostics = $derived.by(() => {
    const out: Diagnostic[] = [];
    const fromReport = this.report?.diagnostics ?? [];
    // Live buffer diagnostics replace the stored (saved) result for that file.
    // A live buffer check covers lua/api/wow-lint findings for that file, so drop the stale saved copies. Structural findings (toc, asset, project) only come from the full report.
    for (const d of fromReport) if (!(d.file && d.file in this.bufferDiags && ["lua", "api", "wow-lint"].includes(d.source))) out.push(d);
    for (const ds of Object.values(this.bufferDiags)) out.push(...ds);
    out.push(...this.designDiags);
    return out;
  });
  counts = $derived({
    error: this.allDiagnostics.filter((d) => d.severity === "error").length,
    warning: this.allDiagnostics.filter((d) => d.severity === "warning").length,
    info: this.allDiagnostics.filter((d) => d.severity === "info").length,
  });

  async loadProjectState(info: ProjectInfo) {
    this.project = info;
    this.tabs = []; this.active = null; this.report = null; this.bufferDiags = {}; this.hits = null;
    this.files = await ipc.projectFiles();
    this.say("ok", `Opened ${info.name} (${this.files.filter((f) => !f.isDir).length} files, ${info.tocs.length} TOC)`);
    await this.validate(true);
  }
  async refreshFiles() { this.files = await ipc.projectFiles(); }
  async validate(quiet = false) {
    if (!this.project) return;
    this.busy = "Validating…";
    try {
      const r = await ipc.validate();
      this.report = r; this.symbols = r.symbols;
      this.project = await ipc.projectInfo();
      const c = r.diagnostics;
      this.say(c.some((d) => d.severity === "error") ? "warn" : "ok", `Validation: ${c.filter((d) => d.severity === "error").length} errors, ${c.filter((d) => d.severity === "warning").length} warnings, ${c.filter((d) => d.severity === "info" || d.severity === "hint").length} notes · ${r.stats.loadedFiles} loaded files · API build ${r.apiBuild}`);
      if (!quiet) this.ui.bottomTab = "problems";
    } catch (e) { this.fail(e); } finally { this.busy = ""; }
  }
  persistTimer: ReturnType<typeof setTimeout> | undefined;
  persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      const ui: UiState = { ...$state.snapshot(this.ui), view: this.view, preview: this.extra.preview, scenarioId: this.extra.scenarioId, openFiles: this.tabs.map((t) => t.path), activeFile: this.active, cursor: this.cursor };
      ipc.saveUi(ui).catch(() => {});
    }, 300);
  }
  goto(path: string, line = 1, col = 1) { this.jump = { path, line, col, n: (this.jump?.n ?? 0) + 1 }; }
}
export const store = new Store();
