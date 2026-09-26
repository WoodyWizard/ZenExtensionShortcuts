#!/usr/bin/env bash
# Starts a separate Zen instance with a throwaway dev profile and Marionette enabled.
# Your normal Zen profile is not touched. Linux counterpart of tools/dev.ps1.
#
#   tools/dev.sh [--fresh]      --fresh deletes the dev profile first
#
# The Zen binary is taken from $ZEN_BIN, then `zen` on PATH, then the tarball install.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$ROOT/.dev/profile"

ZEN_BIN="${ZEN_BIN:-$(command -v zen || true)}"
[ -n "$ZEN_BIN" ] || ZEN_BIN="$HOME/.tarball-installations/zen/zen"
[ -x "$ZEN_BIN" ] || { echo "Zen binary not found; set ZEN_BIN" >&2; exit 1; }

# Stop a previous dev instance (only the one using the dev profile).
pkill -f -- "-profile $PROFILE_DIR" 2>/dev/null && sleep 1 || true

if [ "${1:-}" = "--fresh" ]; then
  rm -rf "$PROFILE_DIR"
fi
mkdir -p "$PROFILE_DIR"

cat > "$PROFILE_DIR/user.js" <<'EOF'
user_pref("zen.welcome-screen.seen", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.debugger.prompt-connection", false);
user_pref("app.update.auto", false);
user_pref("browser.urlbar.closeOnWindowBlur", false);
EOF

"$ROOT/install.sh" --profile "$PROFILE_DIR" --skip-loader

nohup "$ZEN_BIN" -no-remote -profile "$PROFILE_DIR" --marionette -remote-allow-system-access \
  >/dev/null 2>&1 &
echo "Dev Zen started with profile $PROFILE_DIR"
