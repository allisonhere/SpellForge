# Architecture

```
┌───────────────────────────── Svelte 5 + TypeScript (webview, sandboxed) ─────────────────────────────┐
│ App shell · Explorer · API browser · Search · Monaco editor · TOC/Docs/Outline · Problems/Output      │
│ store.svelte.ts (state)  monacoSetup.ts (language features)  apiSearch.ts (pure, tested)               │
└───────────────┬───────────────────────────────────────────────────────────────────────────────────────┘
                │  typed Tauri commands only (src/lib/ipc.ts) — no fs/shell/http plugin in the webview
┌───────────────▼────────────────────────────── Rust (src-tauri) ───────────────────────────────────────┐
│ lib.rs      commands + AppState (approved roots, open project, API snapshot, settings)                │
│ fsguard.rs  resolve_within(): `..`/absolute rejected, symlink escape rejected, canonical-prefix check │
│ toc.rs      TOC parser          lua.rs     tokenizer, lexical symbols/refs, full_moon syntax check     │
│ project.rs  file tree, TOC→XML→file resolution, asset check, API/WoW lints, Report                    │
│ api.rs      bundled + imported snapshot, compat notes       diag.rs  Diagnostic{severity,confidence,evidence} │
│ distribute.rs  package (zip) + deploy (plan → confirm → backup → staged swap)                          │
│ settings.rs  atomic JSON settings, installation discovery (candidates only)                            │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
data/forever-api-index.json   (built by scripts/build-api-index.mjs from data/sources/*, embedded in the binary)
data/compat-notes.json        (curated, every entry has level + source)
```

## Subsystems (from the brief) and status

| # | Subsystem | Status |
|---|---|---|
| 1 | Workspace & project management | **Done** (Phase 1) |
| 2 | Lua/XML editor & tooling | **Done** except Lua Language Server integration |
| 3 | Forever API intelligence | **Done** (offline index, import local snapshot). Raw `api.json` → index conversion is `npm run api:build`, not yet in-app |
| 4 | Visual interface designer | **Done** (Phase 2): `scene.ts`, `layout.ts`, `history.ts`, `codegen.ts`, `templates.ts`, `Designer/Canvas/Inspector/Hierarchy` |
| 5 | Preview & simulation | Planned (Phase 3) |
| 6 | Static analysis & validation | **Done** (Phase 1 scope) |
| 7 | Deployment & packaging | **Done** |
| 8 | Optional local AI | Planned (Phase 4); settings schema reserves loopback-only endpoint |

## Key decisions

* **Rust owns trust.** The webview never supplies a path that is not first validated against the open project root, and never chooses where the *first* approval comes from: native dialogs are opened from Rust (`pick_project`, `add_installation`, package save dialog). `open_recent` only accepts paths already approved.
* **Diagnostics carry epistemics.** `Confidence` (certain / sourced / snapshot-absence / heuristic) and `Evidence` (static / needs-game-test) are first-class and rendered in the UI.
* **Lexical index, real parser.** `full_moon` (Lua 5.1 grammar, which is what WoW embeds) provides authoritative syntax errors; a tolerant tokenizer powers symbols, references and API usage so partially-broken files still index.
* **Single source of truth for API data.** The Rust validator and the frontend (completion, hover, browser) read the same snapshot (`api_index` command), so what you see matches what is validated.
* **Reproducible metadata.** The index is generated deterministically from vendored source files whose SHA-256 and git commit are stored in the index and shown in Settings.

## Designer (Phase 2)

* **Scene model** (`src/lib/scene.ts`, JSON, `version: 1`): flat `nodes` map + creation `order` (= sibling z-order). Node = {kind, name, parent, anchors[], width/height, strata, level, layer, alpha, colour, text/font, texture, statusbar values}. Designer, generator and (later) simulator consume only this.
* **Layout solver** (`layout.ts`): WoW coordinates (origin bottom-left, y up). `solve()` resolves anchors recursively with cycle detection; `setRect()` is its inverse (rewrites anchor offsets so the solver reproduces a dragged/resized rect). Both are unit-tested including a round trip.
* **History** (`history.ts`): snapshot undo/redo with begin/commit coalescing for drags and typing.
* **Codegen** (`codegen.ts`): deterministic; emits parents and anchor targets first; escapes strings; output is checked with `luac -p` in tests. Writes only to `Generated/` files that carry the `@generated` marker.
* **Why separate generated files:** the safest way to *never* destroy hand-written code is to never share a file with it. Fenced in-file regions were considered and rejected for v1.

## Planned for Phase 3

* Simulator = deterministic seeded state machine + a restricted Lua sandbox (wasm Lua in a Worker, no host access); unimplemented/protected APIs return warnings, never silent success.
