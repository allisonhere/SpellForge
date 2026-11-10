# Native UI compatibility subsystem

Goal: use Blizzard's *real* interface definitions (FrameXML) and assets, not an HTML imitation. This document records what is
built, what was measured, what is assumed, and what is blocked.

## Status

| Stage | State |
|---|---|
| 1. Import + index Blizzard FrameXML (XML parser, template registry, TOC-driven load set, inheritance resolver) | **Done** (`src-tauri/src/uisource.rs`, UI tab) |
| 2. Real textures / atlases / fonts | **Blocked** (encrypted in the client; see below) |
| 3. Renderer driven by the resolved tree | Not started |
| 4. Sandboxed Lua execution of addon frame-building code (Tempus) | Not started |
| 5. Compatibility report; migrate the designer canvas onto the new render tree | Not started |

## Where the data comes from

* **Interface source (Lua/XML/TOC):** a local folder the user supplies containing `Interface/AddOns/...`. Tested with a checkout of
  Gethe/wow-ui-source, branch `forever`, whose `version.txt` is `1.60.1.70888`, identical to the installed client build. The file
  set matches the client's own file list (2,879 Lua / 1,262 XML / 350 TOC). Provenance of that mirror is not verified here (see "Legal").
* **Textures, atlases, fonts:** would have to come from the game client. **They cannot be read today** (next section).
* Nothing is bundled, copied into a project, committed, or redistributed. The importer is read-only.

## Finding: the client's interface files are encrypted in this beta

Opening `wowf` build 1.60.1.70888 with an open-source CASC reader works (8 s), but every Blizzard interface file, texture and font
is stored in BLTE *encrypted* blocks whose keys are not in the install; the reader returns zero-filled data. Measured:
4,489 of 4,489 interface source files blank, 6 of 6 sampled textures blank, 20 of 20 fonts blank. The retail product (`wow`
12.1.5.70783) shares the storage and is equally unreadable. SpellForge does **not** fetch or use decryption keys: decrypting content
Blizzard encrypted is circumvention of an access control, outside this project's remit. Unblocking this requires Blizzard to ship
the files unencrypted (commonly at launch) or the user to supply legitimately obtained, readable assets.

## How the importer decides what loads (measured, not assumed)

Blizzard's TOCs select files per game type and use path variables. Loading the whole tree mixes flavours (377 duplicate template
names). The importer follows the TOCs:

* `[AllowLoadGameType a, b]`, `[ExcludeLoadGameType a]`, `[AllowLoadTextLocale x]`, `[AllowLoad glue]`, `[AllowLoadEnvironment Global]`
  as trailing *or* leading directives; `[Family]\` and `[Game]\` path variables; case-insensitive file lookup (the source was authored on Windows).
* **Forever = game types {`camelot`, `mainline`}, `[Family]` = `Mainline`, `[Game]` = `Camelot`, locale `enUS`.** Evidence (real tree):

| Hypothesis | Addons | Files | Undefined inherited bases |
|---|---|---|---|
| `[Family]`=Classic / Shared | 256 | 2,333 / 2,302 | 88 (190 / 221 TOC files missing) |
| `[Family]`=Mainline, game type `camelot` only | 257 | 2,532 | 36 |
| **`[Family]`=Mainline, `camelot` also satisfies `mainline`** | **289** | **3,105** | **2** |

  Supporting facts: `PingAttributes.xml`/`ModelFrameTemplates.xml` are gated `[AllowLoadGameType mainline]` yet Forever's action bars
  and unit frames inherit from them; `Blizzard_MoneyFrame` is `AllowLoad: Both [AllowLoadGameType mainline]` with no `Camelot`
  folder; 128 TOC lines say `[ExcludeLoadGameType camelot]`. `tests/uisource_real.rs` fails if this regresses.
* Result for build 70888: 4,084 templates (3,448 virtual), 928 XML files, 0 parse errors, 0 missing TOC files, 2 undefined
  inherited bases (`ChatTabArtTemplate`, `FloatingChatFrameTemplate`: genuinely not defined in the supplied source).
* Not interpreted yet (shown in the UI and the status): `[Bootstrap]`, `[LoadIntoEnvironment]`.

## Inheritance merge rules

Applied by `uisource::merge`: attributes of the deriving element override; `mixin` accumulates; `Size` merges per attribute;
`Anchors` merge per `point`; keyed children (`parentKey` or `name`) override in place; `KeyValues` merge by `key`; layers merge by
level + sublevel; unkeyed regions/frames append; `Scripts` replace per handler.

**INFERRED, not yet verified against the client** (to be settled by the in-game exporter): same-`point` anchor replacement,
ignoring `inherit="prepend|append"` on script handlers, append for unkeyed regions, resolution order for multi-base `inherits`.
Legacy shapes (`<Size><AbsDimension>`, `<Offset><AbsDimension>`) are normalised.

## Compatibility report (what cannot be replicated outside the client)

Protected/secure execution and taint, secret values, combat lockdown, 3D models (`ModelScene`, `PlayerModel`, `DressUpModel`),
real texture and font rendering while assets are unreadable, animations driven by Lua, `Bootstrap`/environment loading semantics,
anything that depends on server data. The renderer must label each element *rendered / approximated / unsupported* with the reason.

## Plan for the remaining stages

1. **In-game exporter addon** (supported APIs only): dump the live frame tree, anchors, atlas names/texcoords and widget properties
   with `EnumerateFrames`, `GetPoint`, `C_Texture.GetAtlasInfo`, … to ground-truth the inferred merge rules and the atlas table
   without touching encrypted files.
2. **Sandboxed Lua runner**: in-process Lua 5.1 without `io`/`os`/`package`, instruction and memory limits, mock `CreateFrame` and widget API, so
   Tempus's own frame-building code produces the render tree. Never an unrestricted process.
3. **Renderer**: 2D sprite renderer over the resolved tree (layers, texcoords, nine-slice, blend modes). Assets come from, in order: user-supplied
   readable assets, the addon's own `media/` (Tempus ships TGAs), then clearly marked placeholders.
4. **Designer migration**: the current HTML canvas becomes a fallback until the new renderer reaches parity.

## Legal posture

All game data stays local. The UI source is user-supplied (the app does not download it) and is never written into a project or
repository. Gethe's `forever` branch is produced by an automation whose method for obtaining the files is not documented; treat it as
the user's own reference copy. If Blizzard or the mirror's owner objects, removing the folder is sufficient and the app keeps working.
