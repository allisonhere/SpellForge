# AI creation studio

Describe an interface in the **Create** tab (Design view). The AI answers with *typed actions* that edit the scene; you watch the canvas
update live (Preview runs the simulation) and keep or undo each turn.

## Safety model
* **Off by default.** The master switch is in Settings; while off, no AI network request is ever made.
* **Local only in this build.** Providers (Ollama, LM Studio) may only connect to loopback addresses. This is enforced in Rust
  (`src-tauri/src/ai.rs::validate_endpoint`): `localhost`, `127.0.0.0/8`, `::1` only; no credentials, query strings or redirects.
  Spoofs such as `127.0.0.1.evil.com`, `evil.com@127.0.0.1` and `0.0.0.0` are tested and rejected. Cloud providers are **not implemented yet**.
* **The model never edits anything directly.** It returns JSON actions (`src/lib/ai/actions.ts`). A batch is validated against the
  real scene operations on a *copy* and applied all-or-nothing as **one undo step**; any error leaves the scene untouched and is sent back
  to the model for up to two repairs. Unknown ops/properties (including `Object.prototype` names such as `constructor`), out-of-range
  values, prototype-pollution tricks, anchor cycles, wrong parents, unsupported bindings and oversized scenes are rejected (`actions.test.ts`).
* **No tools.** No shell, no file access. The model sees only: the current scene, the supported vocabulary, templates, scenarios and
  preview findings (`prompt.ts`). Element text and names are marked as data, not instructions.
* **Outgoing payload guard**, in both TypeScript and Rust: refuses anything containing Blizzard interface source paths, local game-data
  paths, absolute home paths or API-key-shaped strings.
* **Honesty rules in the prompt:** Blizzard art is a placeholder in the preview; health text in combat is secret in the real game; bindings
  and repeaters are preview-only. The model is told not to claim pixel-perfect output.

## Using it with Ollama
`ollama serve`, `ollama pull <model>`, then Settings → AI → enable the assistant and the Ollama provider, **Refresh models**, pick one.
Output quality depends on the model; the validator bounds mistakes but cannot guarantee good design.

## Verified
* 41 frontend tests: action validation (valid/malformed/malicious), the full conversation loop against a scripted model including repair and
  giving up, one-turn-one-undo on the real designer store, prompt/context content, the payload guard.
* 8 Rust tests: loopback enforcement, SSE parsing, streaming against an in-process server, error paths, cancellation, no-redirect, payload guard.
* End to end in the real app against a scripted loopback model that deliberately makes a mistake first: the app streamed the reply, the
  validator rejected it, the app sent the errors back, applied the corrected actions, and the canvas ran the simulation.
* **Not yet verified with a real language model** (Ollama was not running here).

## Not built yet
Claude / OpenAI (Codex) / DeepSeek providers with OS-keyring key storage, consent and a payload preview (milestone 2); the icon pipeline
(milestones 3-4); AI-written event-wiring files with diff review (milestone 5).
