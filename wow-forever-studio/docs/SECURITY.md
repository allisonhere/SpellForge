# Security & sandbox notes

## Tauri surface
* Capabilities: `core:default` only. **No** `fs`, `shell`, `http`, `opener` or `dialog` permission is granted to the webview. Dialogs run in Rust.
* The webview can call only the commands in `lib.rs`; each re-validates its inputs.
* CSP: `default-src 'self'`; scripts from self only; `connect-src` = IPC only. Monaco workers are same-origin/blob.

## Filesystem
* `fsguard::resolve_within`: rejects `..`, absolute and prefix components, NUL; canonicalises the longest existing ancestor and requires it to remain inside the canonical project root (symlink escapes fail, tested).
* Writes: temp file + rename; refuse to write through a symlink; files > 5 MB or binary are not opened in the editor.
* Directory walking never follows symlinks; symlinks are shown (badge) and skipped by packaging/deploy.
* **Packaging** never writes inside the project; output path comes from a Rust save dialog.
* **Deploy**: only to `Interface/AddOns` folders the user added; addon folder name sanitised (no separators, no leading dot); destination symlink refused; existing install → explicit confirmation + backup copy in app data → staged copy → rename swap with rollback; overlap of source/destination refused.
* Approved project roots are persisted by Rust; `open_recent` accepts only those.

## Data & network
No telemetry, accounts or network calls. The AI settings schema exists (disabled); when implemented it must enforce loopback-only endpoints in Rust, not in the UI.

## Game protections
The IDE analyses and edits files only. It does not inject into, attach to, or automate the game, and nothing in it helps bypass protected actions, taint, secret values or combat lockdown. Lints exist to *steer authors toward* supported patterns.

## Untrusted addon code (future)
Addon Lua is never executed in Rust or an OS process. The planned simulator runs Lua in a WASM sandbox inside a Worker with no host bindings, instruction/time budgets, and an explicit mock table.

## Known gaps
* Imported API snapshots are size-limited (64 MB) and schema-checked but not signed.
* No sandboxed-process isolation for the webview beyond Tauri defaults.
