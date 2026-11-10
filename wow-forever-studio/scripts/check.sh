#!/usr/bin/env bash
# Full local gate: lint/typecheck + all tests. Optional: TEMPUS_DIR=/path/to/Tempus for the real-addon integration test.
set -euo pipefail
cd "$(dirname "$0")/.."
npx svelte-check --tsconfig ./tsconfig.json
npx vitest run
(cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test)
