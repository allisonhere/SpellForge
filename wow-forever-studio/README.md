# WoW Forever Studio

An **offline-first desktop IDE for World of Warcraft: Forever addons** (Tauri 2 + Svelte 5 + Rust, Monaco bundled locally).
No accounts, no telemetry, no CDN, no online API. After the one-time dependency fetch, everything runs without a network.

> **Status: Phase 1 complete (working IDE foundation). Phases 2–4 (visual designer, simulation, local AI) are not implemented yet.**
> See [docs/ROADMAP.md](docs/ROADMAP.md) and [Limitations](#limitations).

## What works today (Phase 1)

| Area | Features |
|---|---|
| Projects | Open any addon folder, new-addon wizard, recent list, workspace restored on relaunch (tabs, active file, cursor, panel sizes/visibility) |
| Editor | Monaco (local), Lua/XML/TOC highlighting, save, tabs, dirty markers, command palette (`Ctrl+Shift+P`), quick open (`Ctrl+P`), symbols (`Ctrl+T`) |
| Language tooling | Live Lua syntax diagnostics (real parser), autocomplete + hover from the offline API index, event-name completion in `RegisterEvent("…")`, project go-to-definition (`F12`/`Ctrl+Click`), find references (`Shift+F12`), project-wide search, outline |
| TOC | Parser faithful to the client (`##` metadata, backslashes, `[conditions]`, BOM/CRLF), load-order view, dependency / saved-variable view, missing & duplicate & case-mismatched entries, XML `Script`/`Include` following |
| API intelligence | 12,372 functions, 1,816 events, 801 types, 284 namespaces (build 70790) with signatures where documented, provenance, and compatibility notes; import a newer snapshot from a local file |
| Validation | Syntax, TOC, file existence (incl. case-sensitivity), asset paths, API compatibility, WoW lints (secret values, protected `ReloadUI`, version-check trap, unknown events). Every finding says **how certain** it is and **whether only the real game can confirm it** |
| Packaging | ZIP with the correct top-level folder, honours `.pkgmeta` `ignore:`, never touches the source tree, skips symlinks |
| Deploy | To installations *you* add; overwrite requires explicit confirmation and always makes a backup first; staged swap; refuses symlink destinations and path escapes |

## Run it

```bash
./install-omarchy.sh          # checks deps, asks before installing anything
npm ci                        # one-time, needs internet
npm run tauri -- dev          # development window
./scripts/build.sh            # release binary: src-tauri/target/release/wow-forever-studio
```

Try it: **Open Addon Folder…** → pick `examples/HelloForever` (clean) or a real addon such as a checkout of
[Tempus](https://github.com/allisonhere/Tempus). Then *Validate*, *Package*, add a WoW installation under ⚙ Settings and *Deploy*.

## Tests

```bash
./scripts/check.sh                                   # svelte-check, vitest, clippy -D warnings, cargo test
TEMPUS_DIR=/path/to/Tempus cargo test --manifest-path src-tauri/Cargo.toml --test tempus -- --nocapture
./scripts/verify-offline.sh                          # launches the binary in an empty network namespace
```

Tempus is only ever read; the test asserts the source tree is byte-for-byte unchanged by validation and packaging.

## Honest about uncertainty

* API absence from the snapshot is reported as **"not in snapshot"**, never "unsupported". A name without a signature means *missing documentation*.
* Only names that a named source *measured as absent* on Forever (see `data/compat-notes.json`) are reported as confirmed removals, and calls guarded by an existence check (`if not UnitAura then`) are downgraded to a hint.
* Static analysis cannot see taint, secret values at runtime, or combat lockdown. Those findings carry a **needs game test** badge.
* The Lua symbol index is lexical (token-based), not a semantic analysis.

## Limitations

See [docs/COVERAGE.md](docs/COVERAGE.md). In short: no visual designer, simulator or AI assistant yet; no Lua Language Server integration yet (the built-in parser/index is used); configurable shortcuts are not yet user-editable; no automated UI-interaction tests (Rust + pure-logic tests only); Windows is designed for (path handling, installs, `windows_subsystem`) but untested.

## Docs

[Architecture](docs/ARCHITECTURE.md) · [Offline operation](docs/OFFLINE.md) · [Coverage & compatibility target](docs/COVERAGE.md) · [Security](docs/SECURITY.md) · [Roadmap](docs/ROADMAP.md) · [Third-party notices](THIRD_PARTY.md)
