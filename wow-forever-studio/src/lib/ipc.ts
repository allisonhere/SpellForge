import { invoke } from "@tauri-apps/api/core";
import type { UiHit, UiResolved, UiStatus, Boot, Diagnostic, Symbol, DeployPlan, DeployResult, FileEntry, Hit, Installation, PackageResult, ProjectInfo, Report, UiState } from "./types";

// The only bridge to the native side. No filesystem or shell plugin is exposed to the frontend.
export const ipc = {
  boot: () => invoke<Boot>("boot"),
  saveUi: (ui: UiState) => invoke<void>("save_ui", { ui }),
  pickProject: () => invoke<ProjectInfo | null>("pick_project"),
  openRecent: (path: string) => invoke<ProjectInfo>("open_recent", { path }),
  openNested: (path: string) => invoke<ProjectInfo>("open_nested", { path }),
  projectInfo: () => invoke<ProjectInfo>("project_info"),
  projectFiles: () => invoke<FileEntry[]>("project_files"),
  readFile: (path: string) => invoke<{ path: string; content: string; size: number }>("read_file", { path }),
  writeFile: (path: string, content: string) => invoke<void>("write_file", { path, content }),
  validate: () => invoke<Report>("validate_project"),
  checkBuffer: (path: string, content: string) => invoke<{ diagnostics: Diagnostic[]; symbols: Symbol[] }>("check_buffer", { path, content }),
  search: (query: string, caseSensitive: boolean, identifier: boolean) => invoke<Hit[]>("search_project", { query, caseSensitive, identifier }),
  importUiSource: () => invoke<UiStatus | null>("import_ui_source"),
  uiSourceStatus: () => invoke<UiStatus | null>("ui_source_status"),
  uiTemplateSearch: (query: string, limit = 80) => invoke<UiHit[]>("ui_template_search", { query, limit }),
  uiTemplateResolve: (name: string) => invoke<UiResolved>("ui_template_resolve", { name }),
  apiIndex: () => invoke<string>("api_index"),
  compatNotes: () => invoke<string>("compat_notes"),
  importApi: () => invoke<string | null>("import_api_snapshot"),
  resetApi: () => invoke<void>("reset_api_snapshot"),
  addInstallation: () => invoke<Installation[]>("add_installation"),
  removeInstallation: (id: string) => invoke<Installation[]>("remove_installation", { id }),
  packageProject: () => invoke<PackageResult | null>("package_project"),
  deployPlan: (installationId: string) => invoke<DeployPlan>("deploy_plan", { installationId }),
  deployApply: (installationId: string, confirmOverwrite: boolean) => invoke<DeployResult>("deploy_apply", { installationId, confirmOverwrite }),
  createAddon: (name: string, title: string, author: string) => invoke<ProjectInfo | null>("create_addon", { name, title, author }),
};
export const errText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
