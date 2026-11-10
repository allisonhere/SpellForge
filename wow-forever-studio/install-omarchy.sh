#!/usr/bin/env bash
# Checks build dependencies for WoW Forever Studio on Omarchy/Arch, explains what it would install, and
# installs ONLY after explicit confirmation. It never edits system configuration, dotfiles or services.
set -euo pipefail

need_pkgs=()   # pacman packages
notes=()

have_pkg() { pacman -Q "$1" >/dev/null 2>&1; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

echo "WoW Forever Studio: dependency check"
echo

for p in webkit2gtk-4.1 gtk3 libsoup3 librsvg openssl base-devel pkgconf; do
  if have_pkg "$p"; then printf '  [ok]      %s\n' "$p"; else printf '  [missing] %s\n' "$p"; need_pkgs+=("$p"); fi
done

if have_cmd cargo && have_cmd rustc; then printf '  [ok]      rust (%s)\n' "$(rustc --version)"
else printf '  [missing] rust toolchain\n'; have_pkg rustup || need_pkgs+=(rustup); notes+=("After installing rustup run: rustup default stable"); fi

if have_cmd node && have_cmd npm; then printf '  [ok]      node %s / npm %s\n' "$(node --version)" "$(npm --version)"
else printf '  [missing] node + npm\n'; need_pkgs+=(nodejs npm); fi

if have_cmd lua || have_cmd luac; then printf '  [ok]      lua (optional, only for your own addon tests)\n'
else printf '  [optional] lua not installed (not required)\n'; fi

if have_cmd lua-language-server; then printf '  [ok]      lua-language-server (optional)\n'
else printf '  [optional] lua-language-server not installed. The IDE works without it (built-in Lua parser).\n'; fi

echo
if [ ${#need_pkgs[@]} -eq 0 ]; then
  echo "All required packages are present."
else
  echo "Proposed command (needs sudo):"
  echo "    sudo pacman -S --needed ${need_pkgs[*]}"
  echo
  read -r -p "Run it now? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) sudo pacman -S --needed "${need_pkgs[@]}" ;;
    *) echo "Skipped. Nothing was installed." ;;
  esac
fi
for n in "${notes[@]:-}"; do [ -n "$n" ] && echo "Note: $n"; done

echo
echo "Next (one-time, needs internet only to fetch dependencies):"
echo "    npm ci && (cd src-tauri && cargo fetch)"
echo "Then everything works offline:  npm run tauri -- dev    |    ./scripts/build.sh"
