# Compatibility target, evidence and coverage

## Confirmed target (and how well we know it)

| Claim | Evidence | Level |
|---|---|---|
| Interface number `16001`, product folder `_forever_` / `_classic_beta_` | forever-addon-kit README (measured in client 1.60.1.69893); Atraeau/WoW-Addons config + export (`interface: 16001`, build 70790); Tempus TOC declares `16001, 11508` | measured by two independent sources |
| Forever runs the **Retail** client API (`WOW_PROJECT_MAINLINE`, `C_*` namespaces), Classic globals such as `GetItemInfo`, `UnitAura`, `GetSpellInfo` absent | kit README; absence in the build-70790 snapshot agrees | measured |
| Midnight-style secret values (health/aura/cooldown numbers secret in combat) | kit README (solo open-world sample) | measured, narrow sample |
| `C_Secrets`, `C_RestrictedActions` exist | present in the bundled snapshot | confirmed present |
| Registering a non-existent event throws | kit README | measured |
| `ReloadUI()` protected | kit README | measured |
| Secure snippets fixed in 1.60.1.70009; SavedVariables not loaded on early builds | kit README (later-build status not re-measured) | **reported, unverified here** |
| Exact `C_Secrets` / combat-lockdown semantics per API | not extractable from the snapshot | **insufficient evidence**; the IDE does not claim per-API protection status |

Sources: `data/sources/SOURCES.json` (commits + SHA-256). Nothing here was verified against a running game client by this project.

### Snapshot caveats
* `wow-addons-api.json` is an export of Blizzard's in-client APIDocumentation. It documents **signatures**, not addon-callability or protection state.
* `forever-addon-kit-api.json` lists names only.
* A name present in the snapshot may still be protected, secret-valued, or restricted. A name absent may be undocumented rather than removed.

## Validation coverage (Phase 1)

| Check | Code | Confidence |
|---|---|---|
| Lua syntax | `lua.syntax` | certain |
| TOC: missing file / duplicate / case mismatch / bad interface / no interface | `toc.*` | certain |
| XML `Script`/`Include` missing, followed recursively | `xml.*` | certain |
| Asset under `Interface\AddOns\<name>\…` missing / case mismatch | `asset.*` | certain (static string only; runtime-built paths are skipped) |
| Folder ≠ TOC name, no 16001, no title, required deps | `toc.*` | certain / sourced |
| Removed Classic global, unguarded | `api.removed-global` | sourced |
| Same, but feature-detected | `api.feature-detected` | hint |
| `C_X.Y` not in snapshot namespace; unknown namespace; unknown event | `api.unknown-*` | snapshot-absence + needs-game-test |
| Unknown global call | `api.unknown-global` | info, snapshot-absence |
| `ReloadUI`, `UnitHealth*` secret risk, version-check trap, combat-log restriction | `wow.*` | sourced + needs-game-test |

Not implemented: scope-aware analysis, widget-method (`frame:SetFoo()`) validation (no widget method dataset), XML schema validation, taint analysis, argument-type checking, retail-portability CSV import.

## Preview/simulation coverage
None yet (Phase 3). The simulator, when built, will not claim to implement the WoW runtime; see ROADMAP.

## Real-world check
Against the Tempus checkout (78 TOC files, 127 Lua files): 0 errors; 210 API call sites checked, 2 unverified (`LibStub`, `GetMouseFocus`), 10 feature-detected legacy calls correctly downgraded, 4 secret-value notes.
