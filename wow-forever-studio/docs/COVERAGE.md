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

## Designer coverage (Phase 2)

| Supported | Not supported yet |
|---|---|
| Frame, Button (label), Texture (solid colour or path), FontString, StatusBar | Cooldown, EditBox, ScrollFrame, CheckButton, Slider, Model, Line, MaskTexture, secure templates |
| Anchors (9 points, sibling or parent target), strata, level, draw layers, alpha, hidden | Texture coordinates/atlas, rotation, scale per frame, clip children, mouse/click scripts |
| Resolution + UI scale, grid/edge snapping, undo/redo, templates | Multi-select, align/distribute commands, copy/paste across scenes |
| Lua generation (CreateFrame/CreateTexture/CreateFontString/SetPoint…), XML generation | Event/script wiring (by design: that is hand-written code) |

Canvas caveats: fonts are system fonts, game textures are placeholders, button visuals are flat. XML output gives every element the global name `<Scene>_<name>`; top-level textures/font strings exist only in the Lua output. The generated code was syntax-checked with `luac`, **not executed in a game client**.

## Preview/simulation coverage (Phase 3)

**Simulated (unit state → bound widgets):** unit health, power (mana/rage/energy), casts (progress, interruptible vs not, interrupt + Kick cooldown), buffs/debuffs (apply, refresh, stack, expire), combat flag, deaths, target respawn, party (1–4) and raid (1–40) rosters with tank/healer/damage roles and class colours. Events emitted to the log: `PLAYER_ENTERING_WORLD`, `GROUP_ROSTER_UPDATE`, `PLAYER_REGEN_DISABLED/ENABLED`, `PLAYER_TARGET_CHANGED`, `UNIT_HEALTH`, `UNIT_POWER_UPDATE`, `UNIT_AURA`, `UNIT_SPELLCAST_START/STOP/SUCCEEDED/INTERRUPTED`, `SPELL_UPDATE_COOLDOWN`, `UNIT_DIED`, `PLAYER_DEAD`, `PARTY_KILL`.

**Binding vocabulary:** see `SUPPORT` in `src/lib/sim/bind.ts` (also listed in the Simulate tab). Anything else is rejected with `preview.unknown-stat`; kind mismatches give `preview.unsupported-binding`; missing units `preview.unit-missing`; nested repeaters `preview.nested-repeat`.

**Not simulated:** execution of addon Lua (no sandbox runtime yet), real fonts/textures/atlases/models, protected actions, taint, secure templates, click handling, combat log, threat, range/LoS, loot, chat, tooltips, Edit Mode, SavedVariables. The simulation is a stylised model: damage/heal amounts, timings and rosters are invented by the scenario, not derived from game data.

**Secret values:** health text bindings are flagged in combat. *Measured* (kit) for `player`/`target`; *inferred* for other units. Power text is not flagged because there is no evidence either way.

### Tempus templates: fidelity statement
Templates: **Tempus Player Frame**, **Tempus Target Frame**, **Tempus Unit Frame (compact)**. Source: `Modules/UnitFrames/UnitFrames.lua` and `Core/Style.lua` (read at Tempus `7bac2c2`, re-checked against `f637669`: no differences in these files). Geometry, offsets, colours, spacing and bindings are asserted by `src/lib/tempus.test.ts` against the numbers in the source.

| Reproduced (read from source) | Not reproduced |
|---|---|
| 230×44 frame, panel fill `{0.06, 0.068, 0.085, 0.92}`, **1px black edge and 3px/0.45 shadow** (`S.Backdrop`) | The *inner* border (`h.inner`), whose colour I did not read |
| Health `TOPLEFT/TOPRIGHT`, height `44−9−1 = 34`; power `BOTTOMLEFT/BOTTOMRIGHT` 9px; 1px separator 1px below health | Smooth-bar interpolation (the client's `StatusBarInterpolation`); our lag easing uses an assumed time constant of 0.35 s |
| Name `LEFT+5`, health text `RIGHT−5`, name right edge 6px before health text, power text `RIGHT−5` | Real fonts, real bar/glow textures (the glow is a soft red halo, not Tempus's sliced `glow` texture) |
| Class-coloured health, background 18% of class colour, power `{0.3,0.5,0.95}` | Health colour modes DARK / REACTION / GRADIENT; tapped / offline states |
| **Lag bar** (`S.LagBar`): red `{0.85,0.25,0.2,0.75}` behind health, jumps up on heals, eases down after damage | Kick-ready colouring, spark, flash on interrupt, fade timers |
| **Player low-health glow**: 14px, red `{1,0.12,0.08}` below 35%, ADD blend, `S.Pulse` 1→0.3 over 1.1 s, off when dead | The 3D/2D **portrait contents**: a game model cannot be rendered here. The 44×44 slot and the `height+1` shift of health/power are reproduced; it shows a "3D" placeholder |
| **Cast bar** (castbarHeight 18): `TOPLEFT +22,−6`, `TOPRIGHT 0,−6`, own backdrop; accent `{0.25,0.76,1}` fill, grey shield `{0.6,0.6,0.6,0.45}` for uninterruptible casts, spell name left+6, time right−6, 18×18 icon frame 4px left. Visible only while casting, children included | Real spell icon (placeholder), channel colour `{0.35,0.75,0.35}`, interrupted-red state |
| **Target auras**: 2 rows × 8 icons, 24px, spacing 3, debuffs 6px above the frame and buffs 3px above those, growing up | Real aura icons (tinted tiles), timers/stacks, sort/filter options, per-unit aura sizes |
| Default positions: player `CENTER −300,−180`, target `CENTER 300,−180` | Secure unit button, click-casting, tooltips, class power pips, scale |

They are a faithful *layout, colour and behaviour-of-the-visuals* model of three components, not a recreation of the Tempus runtime. Tempus's own use of `issecret`, `pcall` and `UnitHealthPercent(…, curve)` confirms the secret-value handling the preview warns about.
