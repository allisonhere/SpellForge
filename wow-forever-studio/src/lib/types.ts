export type Severity = "error" | "warning" | "info" | "hint";
export type Confidence = "certain" | "sourced" | "snapshot-absence" | "heuristic";
export type Evidence = "static" | "needs-game-test";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  file: string | null;
  line: number;
  col: number;
  source: string;
  confidence: Confidence;
  evidence: Evidence;
}
export interface Symbol { name: string; kind: string; scope: string; file: string; line: number; col: number }
export interface TocEntry { line: number; raw: string; path: string; condition: string | null }
export interface Toc {
  file: string; interface: number[]; title: string | null; notes: string | null; author: string | null; version: string | null;
  savedVariables: string[]; savedVariablesPerCharacter: string[]; dependencies: string[]; optionalDeps: string[];
  loadOnDemand: boolean; icon: string | null; fields: Record<string, string>; entries: TocEntry[];
}
export interface ProjectInfo { nestedAddons: string[]; root: string; name: string; addonName: string; tocs: Toc[]; mainToc: string | null }
export interface FileEntry { path: string; isDir: boolean; size: number; isSymlink: boolean }
export interface Stats {
  luaFiles: number; xmlFiles: number; loadedFiles: number; unlistedFiles: number; symbols: number; apiCallsChecked: number; apiUnverified: number;
}
export interface Report { diagnostics: Diagnostic[]; stats: Stats; symbols: Symbol[]; apiBuild: string; scope: string }
export interface Installation { id: string; name: string; addonsDir: string }
export interface Hit { file: string; line: number; col: number; text: string }
export interface DeployPlan { destination: string; exists: boolean; files: number; bytes: number; isSymlink: boolean }
export interface DeployResult { destination: string; files: number; backup: string | null }
export interface PackageResult { path: string; files: number; bytes: number; skipped: string[] }
export interface Boot {
  settings: { recentProjects: string[]; lastProject: string | null; installations: Installation[]; ui: UiState | null; ai: { enabled: boolean; endpoint: string; model: string } };
  apiOrigin: string; apiBuild: string; detected: Installation[];
}
export interface UiState {
  leftWidth?: number; rightWidth?: number; bottomHeight?: number;
  showLeft?: boolean; showRight?: boolean; showBottom?: boolean;
  leftTab?: string; rightTab?: string; bottomTab?: string;
  view?: "code" | "design";
  preview?: boolean;
  scenarioId?: string;
  /** Testing hook: start the simulation at this speed on launch. Never written back. */
  autoplay?: number;
  /** Testing hook: send this prompt to the AI once on launch. Never written back. */
  autoprompt?: string;
  openFiles?: string[]; activeFile?: string | null;
  cursor?: Record<string, { line: number; col: number }>;
}

// API snapshot
export interface Param { n: string; t: string; i?: string; o?: 1; d?: string }
export interface ApiFunction { name: string; ns?: string | null; system?: string; sig?: string; doc?: string; args?: Param[]; rets?: Param[]; src: number; restricted?: boolean }
export interface ApiEvent { name: string; system: string; ns: string | null; payload: Param[]; doc?: string }
export interface ApiType { name: string; kind: string; system: string; ns: string | null; values?: [string, number][]; fields?: Param[] }
export interface ApiIndex {
  schema: number;
  meta: { build: string; version: string; interface: number; exportedAt: string; buildDate: string; sources: { file: string; origin: string; commit: string; license: string; kind: string; sha256: string }[]; counts: Record<string, number>; notes: string[] };
  namespaces: string[]; functions: ApiFunction[]; events: ApiEvent[]; types: ApiType[];
}
export interface CompatNote { id: string; names?: string[]; category: string; level: string; text: string; source: string }
export interface CompatNotes { notes: CompatNote[]; target: { interface: number[]; note: string } }

// Blizzard UI source registry (native UI subsystem)
export interface UiStatus { root: string; build: string; xmlFiles: number; addons: number; tocFiles: number; templates: number; virtualTemplates: number; parseErrors: number; loadOnDemandAddons: number; undefinedBases: string[]; unknownDirectives: string[]; missingTocFiles: number }
export interface UiHit { name: string; tag: string; isVirtual: boolean; file: string; line: number }
export interface XNode { tag: string; attrs: Record<string, string>; children: XNode[]; text: string; line: number }
export interface UiResolved { node: XNode; chain: string[]; missing: string[] }

// AI assistant (optional, off by default)
export interface AiProvider { id: string; name: string; kind: string; baseUrl: string; model: string; enabled: boolean; cloud: boolean }
export interface AiStatus { enabled: boolean; providers: AiProvider[] }
