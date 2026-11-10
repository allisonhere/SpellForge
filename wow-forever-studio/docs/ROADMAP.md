# Roadmap

**Phase 1: working IDE foundation — done** (see README). Remaining Phase-1 polish: in-app conversion of raw `api.json`; Lua Language Server (optional, local) bridge; editable shortcuts; Windows verification; packaged-bundle offline test; trimming unused Monaco languages (bundle is ~4 MB JS).

**Phase 2: visual design canvas — done** (see README). Follow-ups: multi-select + align/distribute, more widget kinds (Cooldown, EditBox, CheckButton), import an existing addon's frames into a scene, automated UI-interaction tests. Original scope: scene model + schema, hierarchy, inspector, drag/resize, WoW anchors (point/relativeTo/relativePoint/x/y), strata/layers, grid/guides, undo/redo, Lua + XML generation with fenced regions, templates/components, resolutions & UI scale. Acceptance: a real rendered component, not a mockup.

**Phase 3: simulation — done** (see README). Follow-ups: sandboxed Lua execution of addon code against the simulated state, a `lowHealth` glow in the Tempus template, more Tempus components (castbar, group frames, auras) imported from source, recorded-scenario import. Original scope: seeded deterministic state, scenarios (idle, solo combat, target casting, 5-man, 40-man raid, low-health, aura churn), status/cast/cooldown rendering, event bus, explicit supported-API table with warnings, side-by-side source/preview. First target: one accurately rendered Tempus component.

**Phase 4: advanced workflow** — local-only AI (LM Studio/Ollama/OpenAI-compatible on loopback, opt-in, diff review before apply, RAG over the API index and project), richer diagnostics, import of in-game Lua error logs, companion logging addon (supported APIs only), reusable templates.
