#!/usr/bin/env bash
# Installs the Zen new tab favorites mod (and the fx-autoconfig loader) on Linux.
#
#   1. Copies fx-autoconfig's loader (config.js) into the Zen install folder, if it
#      is missing. Uses sudo when that folder is not writable (e.g. /opt).
#   2. Copies fx-autoconfig's profile part and the mod's JS/CSS into <profile>/chrome.
#   3. Clears the profile's startup cache so Zen picks up the new scripts.
#
# Zen must be closed while installing.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLATPAK_ID="app.zen_browser.zen"
FLATPAK_HOME="$HOME/.var/app/$FLATPAK_ID"

usage() {
  cat <<EOF
Usage: ./install.sh [--zen-dir DIR] [--profile DIR] [--skip-loader]

  --zen-dir DIR   Zen install folder (the one with application.ini).
                  Found automatically for the tarball script, AUR and Flatpak installs.
  --profile DIR   Profile folder. Defaults to the profile Zen starts with.
  --skip-loader   Do not touch the Zen install folder (config.js is already there).
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

ZEN_DIR=""
PROFILE=""
SKIP_LOADER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --zen-dir) ZEN_DIR="${2:?--zen-dir needs a value}"; shift 2 ;;
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --skip-loader) SKIP_LOADER=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

is_zen_dir() {
  [ -f "$1/application.ini" ] && { [ -x "$1/zen" ] || [ -x "$1/zen-bin" ]; }
}

is_flatpak_dir() {
  case "$1" in */flatpak/app/"$FLATPAK_ID"/*) return 0 ;; *) return 1 ;; esac
}

find_zen_dir() {
  local candidates=() bin path
  for bin in zen zen-browser zen-bin; do
    if path="$(command -v "$bin" 2>/dev/null)"; then
      candidates+=("$(dirname "$(readlink -f "$path")")")
    fi
  done
  candidates+=(
    "$HOME/.tarball-installations/zen"
    /opt/zen-browser-bin
    /opt/zen-browser
    /opt/zen
    /usr/lib/zen-browser
    /usr/lib/zen
    /usr/lib64/zen-browser
    "$HOME/.local/share/flatpak/app/$FLATPAK_ID/current/active/files/zen"
    "/var/lib/flatpak/app/$FLATPAK_ID/current/active/files/zen"
  )
  for path in "${candidates[@]}"; do
    if is_zen_dir "$path"; then
      echo "$path"
      return 0
    fi
  done
  return 1
}

profile_roots() {
  if [ -n "$ZEN_DIR" ] && is_flatpak_dir "$ZEN_DIR"; then
    echo "$FLATPAK_HOME/.zen"
    echo "$FLATPAK_HOME/zen"
    echo "$FLATPAK_HOME/config/zen"
  else
    echo "$HOME/.zen"
    echo "${XDG_CONFIG_HOME:-$HOME/.config}/zen"
  fi
}

# Prints the profile Zen starts with: the default of the (non-twilight) install
# from installs.ini, otherwise the Default=1 profile from profiles.ini.
find_default_profile() {
  local root rel
  while read -r root; do
    [ -f "$root/profiles.ini" ] || continue
    rel=""
    if [ -f "$root/installs.ini" ]; then
      rel="$(sed -n 's/^Default=\(.*\)$/\1/p' "$root/installs.ini" | tr -d '\r' | grep -v twilight | head -n 1 || true)"
    fi
    if [ -z "$rel" ]; then
      rel="$(tr -d '\r' < "$root/profiles.ini" | awk -F= '
        /^\[/ { if (path != "" && def == "1") { print path; exit } path = ""; def = "" }
        $1 == "Path" { path = substr($0, 6) }
        $1 == "Default" { def = $2 }
        END { if (path != "" && def == "1") print path }' | head -n 1)"
    fi
    if [ -n "$rel" ]; then
      case "$rel" in /*) echo "$rel" ;; *) echo "$root/$rel" ;; esac
      return 0
    fi
  done < <(profile_roots)
  return 1
}

# Zen keeps a "lock" symlink (-> "host:+PID") in the profile while it runs.
profile_in_use() {
  local target pid
  if [ -L "$1/lock" ]; then
    target="$(readlink "$1/lock")"
    pid="${target##*+}"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  # Flatpak runs Zen in its own PID namespace, so the PID above means nothing here;
  # look for the sandboxed app instead.
  case "$1" in
    "$FLATPAK_HOME"/*)
      if command -v flatpak >/dev/null 2>&1 && flatpak ps --columns=application 2>/dev/null | grep -qx "$FLATPAK_ID"; then
        return 0
      fi
      ;;
  esac
  return 1
}

install_loader() {
  local dir="$1" sudo=""
  local src="$ROOT/vendor/fx-autoconfig/program"
  if [ -f "$dir/config.js" ] && [ -f "$dir/defaults/pref/config-prefs.js" ]; then
    if grep -q "chrome.manifest" "$dir/config.js"; then
      echo "fx-autoconfig loader already present in $dir"
    else
      echo "Warning: $dir/config.js exists but is not fx-autoconfig's; leaving it alone." >&2
      echo "         Merge vendor/fx-autoconfig/program/config.js into it by hand." >&2
    fi
    return 0
  fi
  if is_flatpak_dir "$dir"; then
    echo "Flatpak Zen: the app folder is read-only and is replaced on every Zen update,"
    echo "so run ./install.sh again after each update."
  fi
  if [ ! -w "$dir" ] || { [ -d "$dir/defaults/pref" ] && [ ! -w "$dir/defaults/pref" ]; }; then
    command -v sudo >/dev/null 2>&1 || die "no write access to $dir and sudo is not available"
    echo "Installing fx-autoconfig loader into $dir (root rights needed)..."
    sudo=sudo
  else
    echo "Installing fx-autoconfig loader into $dir..."
  fi
  $sudo mkdir -p "$dir/defaults/pref"
  $sudo install -m 644 "$src/config.js" "$dir/config.js"
  $sudo install -m 644 "$src/defaults/pref/config-prefs.js" "$dir/defaults/pref/config-prefs.js"
}

# ---- main ------------------------------------------------------------------------

if [ "$SKIP_LOADER" = 0 ] && [ -z "$ZEN_DIR" ]; then
  ZEN_DIR="$(find_zen_dir)" || die "Zen install folder not found. Pass it with --zen-dir.
An AppImage is read-only: extract it with --appimage-extract and point --zen-dir at squashfs-root."
fi
if [ -n "$ZEN_DIR" ]; then
  is_zen_dir "$ZEN_DIR" || die "$ZEN_DIR does not look like a Zen install folder (no application.ini)"
fi

if [ -z "$PROFILE" ]; then
  PROFILE="$(find_default_profile)" || die "could not find a Zen profile. Start Zen once, or pass --profile."
fi
[ -d "$PROFILE" ] || die "profile folder not found: $PROFILE"
PROFILE="$(cd "$PROFILE" && pwd)"

if profile_in_use "$PROFILE"; then
  die "Zen is running. Close it and run the script again."
fi

# 1. Loader in the Zen install folder
if [ "$SKIP_LOADER" = 0 ]; then
  install_loader "$ZEN_DIR"
fi

# 2. Profile files
chrome="$PROFILE/chrome"
mkdir -p "$chrome/utils" "$chrome/JS" "$chrome/CSS" "$chrome/resources"
cp -f "$ROOT"/vendor/fx-autoconfig/utils/* "$chrome/utils/"
cp -f "$ROOT"/src/JS/* "$chrome/JS/"
cp -f "$ROOT"/src/CSS/* "$chrome/CSS/"
cp -Rf "$ROOT"/src/resources/. "$chrome/resources/"
echo "Copied mod files into $chrome"

# 3. Startup cache: in the profile for custom profiles, otherwise in the cache dir
name="$(basename "$PROFILE")"
for cache in \
  "$PROFILE/startupCache" \
  "${XDG_CACHE_HOME:-$HOME/.cache}/zen/$name/startupCache" \
  "$FLATPAK_HOME/cache/zen/$name/startupCache"; do
  if [ -d "$cache" ]; then
    rm -rf "$cache"
    echo "Cleared $cache"
  fi
done

echo "Done. Start Zen and press Ctrl+T."
