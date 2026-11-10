#!/usr/bin/env bash
# Proves the app does not need the network: builds with --offline, then launches the real binary inside an
# empty network namespace (no interfaces up, not even loopback) and checks it keeps running.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd src-tauri && cargo build --offline)
npm run build >/dev/null
BIN=src-tauri/target/debug/wow-forever-studio
unshare -rn sh -c 'if curl -sI -m 3 https://example.com >/dev/null 2>&1; then echo "network namespace is NOT isolated"; exit 2; fi; echo "network isolated: OK"'
unshare -rn "$BIN" >/dev/null 2>&1 &
pid=$!
sleep 8
if kill -0 "$pid" 2>/dev/null; then echo "app still running with no network: OK"; kill "$pid"; else echo "app exited early"; exit 1; fi
