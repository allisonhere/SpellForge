# Offline operation

**Contract:** after dependencies are fetched once, no feature requires a network.

* The webview is loaded from the app bundle (`frontendDist`). The CSP is `default-src 'self'`; `connect-src` allows only Tauri IPC. No CDN, remote font, analytics or update check exists.
* Monaco and its worker are bundled by Vite from `node_modules` (see `src/lib/monacoSetup.ts`).
* The API snapshot and compat notes are compiled into the binary (`include_str!`). An imported snapshot is stored in the app data dir.
* Dialogs are native (Rust). Packaging and deployment are local filesystem operations.
* Fonts are the system's UI/monospace stack; nothing is fetched.

## Online steps (build time only)

`npm ci`, `cargo fetch`, and (optionally) refreshing `data/sources/*` from the upstream repositories. These are **not** runtime dependencies.

## Verification performed

`scripts/verify-offline.sh` builds with `cargo build --offline`, then starts the real binary inside `unshare -rn` (a new network namespace: `lo` is DOWN, no other interface) after proving that `curl` cannot reach the internet from it. The app launched, restored its workspace, loaded the API snapshot and validated a 78-file TOC-driven addon (Tempus) in that namespace.

Not yet verified: a packaged release bundle (`.deb`/AppImage) launched on a machine that never had the dev toolchain.
