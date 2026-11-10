# Third-party notices

**Runtime / build dependencies** (versions locked in `package-lock.json` and `src-tauri/Cargo.lock`): Tauri 2 (MIT/Apache-2.0), Svelte 5 (MIT), Vite (MIT), Monaco Editor (MIT, © Microsoft), `full_moon` (MPL-2.0: unmodified, used as a library), `zip`, `walkdir`, `serde`, `thiserror`, `directories` (MIT/Apache-2.0).

**Bundled data** (`data/sources/`, see `SOURCES.json` for commits and SHA-256):
* `forever-addon-kit-api.json` and the findings summarised in `data/compat-notes.json`: © 2026 Thunderz, **MIT** (license text included). https://github.com/Thunderz96/forever-addon-kit
* `wow-addons-api.json`: an export of Blizzard's client API documentation as published by https://github.com/Atraeau/WoW-Addons. That repository has no top-level license file; the data is Blizzard's. It is bundled for offline reference with attribution; if the owner or Blizzard objects it can be removed and the index rebuilt from a user-supplied export (the app supports importing snapshots).

World of Warcraft is a trademark of Blizzard Entertainment. This project is not affiliated with or endorsed by Blizzard.

Tempus (https://github.com/allisonhere/Tempus) is used only as an external, read-only test target and is not included.
