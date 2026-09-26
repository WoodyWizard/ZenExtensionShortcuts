#!/usr/bin/env bash
# Checks install.sh against fake Zen layouts in a temporary HOME (no real Zen needed).
#   bash tools/tests/install-linux.sh

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="$(mktemp -d)"
trap 'chmod -R u+w "$BASE" 2>/dev/null; rm -rf "$BASE"' EXIT
fails=0

check() {
  if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fails=$((fails + 1)); fi
}

fake_zen() {
  mkdir -p "$1"
  printf '[App]\nName=Zen\nVersion=1.22.3b\n' > "$1/application.ini"
  printf '#!/bin/sh\n' > "$1/zen"
  chmod +x "$1/zen"
}

fake_profiles() { # root release-dir twilight-dir
  mkdir -p "$1/$2" "$1/$3"
  printf '[Profile1]\nName=Default (release)\nIsRelative=1\nPath=%s\nDefault=1\n\n[Profile0]\nName=Default (twilight)\nIsRelative=1\nPath=%s\n\n[General]\nStartWithLastProfile=1\n' "$2" "$3" > "$1/profiles.ini"
  printf '[AAAA]\nDefault=%s\nLocked=1\n\n[BBBB]\nDefault=%s\nLocked=1\n' "$3" "$2" > "$1/installs.ini"
}

run() { # home, args...
  local home="$1"; shift
  HOME="$home" XDG_CONFIG_HOME= XDG_CACHE_HOME= PATH="$home/.local/bin:/usr/bin:/bin" \
    bash "$REPO/install.sh" "$@" > "$BASE/out.txt" 2>&1
}

echo "tarball install, profile in ~/.zen"
H="$BASE/t1"
fake_zen "$H/.tarball-installations/zen"
mkdir -p "$H/.local/bin" && ln -s "$H/.tarball-installations/zen/zen" "$H/.local/bin/zen"
fake_profiles "$H/.zen" "abcd.Default (release)" "wxyz.Default (twilight)"
mkdir -p "$H/.cache/zen/abcd.Default (release)/startupCache"
run "$H"; code=$?
check "exit 0" "[ $code = 0 ] || cat '$BASE/out.txt'"
check "config.js installed" "[ -f '$H/.tarball-installations/zen/config.js' ]"
check "config-prefs.js installed" "[ -f '$H/.tarball-installations/zen/defaults/pref/config-prefs.js' ]"
P="$H/.zen/abcd.Default (release)/chrome"
check "utils copied" "[ -f '$P/utils/boot.sys.mjs' ] && [ -f '$P/utils/chrome.manifest' ]"
check "script copied" "[ -f '$P/JS/zen-newtab-favorites.uc.js' ]"
check "style copied" "[ -f '$P/CSS/zen-newtab-favorites.uc.css' ]"
check "store copied" "[ -f '$P/resources/zen-newtab-favorites/store.sys.mjs' ]"
check "startup cache cleared" "[ ! -e '$H/.cache/zen/abcd.Default (release)/startupCache' ]"
check "twilight profile untouched" "[ ! -e '$H/.zen/wxyz.Default (twilight)/chrome' ]"

echo "second run keeps the loader"
run "$H"; code=$?
check "exit 0" "[ $code = 0 ]"
check "reports loader present" "grep -q 'already present' '$BASE/out.txt'"

echo "refuses while Zen runs (lock symlink with a live PID)"
sleep 30 & pid=$!
ln -s "127.0.0.1:+$pid" "$H/.zen/abcd.Default (release)/lock"
run "$H"; code=$?
check "exit non-zero" "[ $code != 0 ]"
check "says Zen is running" "grep -q 'Zen is running' '$BASE/out.txt'"
kill $pid 2>/dev/null
wait $pid 2>/dev/null
run "$H"; code=$?
check "stale lock is ignored" "[ $code = 0 ]"

echo "foreign config.js is left alone"
H="$BASE/t2"
fake_zen "$H/.tarball-installations/zen"
echo '// someone else' > "$H/.tarball-installations/zen/config.js"
mkdir -p "$H/.tarball-installations/zen/defaults/pref" && touch "$H/.tarball-installations/zen/defaults/pref/config-prefs.js"
fake_profiles "$H/.zen" "p1.Default (release)" "p2.Default (twilight)"
run "$H"; code=$?
check "exit 0" "[ $code = 0 ]"
check "warns" "grep -q 'not fx-autoconfig' '$BASE/out.txt'"
check "not overwritten" "grep -q 'someone else' '$H/.tarball-installations/zen/config.js'"

echo "XDG profile root (~/.config/zen) and no installs.ini"
H="$BASE/t3"
fake_zen "$H/.tarball-installations/zen"
fake_profiles "$H/.config/zen" "x1.Default (release)" "x2.Default (twilight)"
rm "$H/.config/zen/installs.ini"
run "$H"; code=$?
check "exit 0" "[ $code = 0 ] || cat '$BASE/out.txt'"
check "Default=1 profile used" "[ -f '$H/.config/zen/x1.Default (release)/chrome/JS/zen-newtab-favorites.uc.js' ]"

echo "--profile and --skip-loader"
H="$BASE/t4"
mkdir -p "$H/custom/startupCache"
run "$H" --profile "$H/custom" --skip-loader; code=$?
check "exit 0" "[ $code = 0 ] || cat '$BASE/out.txt'"
check "files in custom profile" "[ -f '$H/custom/chrome/JS/zen-newtab-favorites.uc.js' ]"
check "profile-local startup cache cleared" "[ ! -e '$H/custom/startupCache' ]"

echo "Flatpak (user install)"
H="$BASE/t5"
fake_zen "$H/.local/share/flatpak/app/app.zen_browser.zen/current/active/files/zen"
fake_profiles "$H/.var/app/app.zen_browser.zen/.zen" "f1.Default (release)" "f2.Default (twilight)"
mkdir -p "$H/.var/app/app.zen_browser.zen/cache/zen/f1.Default (release)/startupCache"
run "$H"; code=$?
check "exit 0" "[ $code = 0 ] || cat '$BASE/out.txt'"
check "flatpak note shown" "grep -q 'Flatpak Zen' '$BASE/out.txt'"
check "loader in flatpak app dir" "[ -f '$H/.local/share/flatpak/app/app.zen_browser.zen/current/active/files/zen/config.js' ]"
check "flatpak profile used" "[ -f '$H/.var/app/app.zen_browser.zen/.zen/f1.Default (release)/chrome/JS/zen-newtab-favorites.uc.js' ]"
check "flatpak cache cleared" "[ ! -e '$H/.var/app/app.zen_browser.zen/cache/zen/f1.Default (release)/startupCache' ]"

echo "read-only install dir goes through sudo"
H="$BASE/t6"
fake_zen "$H/.tarball-installations/zen"
fake_profiles "$H/.zen" "s1.Default (release)" "s2.Default (twilight)"
chmod a-w "$H/.tarball-installations/zen"
mkdir -p "$H/.local/bin"
# Stand-in for sudo: records the call and makes the folder writable for this user.
cat > "$H/.local/bin/sudo" <<EOF
#!/bin/sh
echo "\$*" >> "$H/sudo.log"
chmod u+w "$H/.tarball-installations/zen"
exec "\$@"
EOF
chmod +x "$H/.local/bin/sudo"
run "$H"; code=$?
check "exit 0" "[ $code = 0 ] || cat '$BASE/out.txt'"
check "sudo used" "grep -q 'install -m 644' '$H/sudo.log'"
check "config.js installed" "[ -f '$H/.tarball-installations/zen/config.js' ]"

echo "no Zen at all"
H="$BASE/t7"
mkdir -p "$H"
run "$H"; code=$?
check "exit non-zero" "[ $code != 0 ]"
check "explains --zen-dir" "grep -q -- '--zen-dir' '$BASE/out.txt'"

echo
if [ $fails = 0 ]; then echo "all checks passed"; else echo "$fails check(s) failed"; exit 1; fi
