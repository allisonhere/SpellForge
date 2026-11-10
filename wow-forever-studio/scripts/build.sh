#!/usr/bin/env bash
# Build the release binary (and Linux bundles if tooling is present). Works offline once deps are fetched.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run api:build
npm run build
if [ "${1:-}" = "--bundle" ]; then npx tauri build; else npx tauri build --no-bundle; fi
echo "Binary: src-tauri/target/release/wow-forever-studio"
