#!/usr/bin/env bash
# Runs a smoke-test scenario from tools/tests against the dev Zen (start it with tools/dev.sh).
# Linux counterpart of tools/test.ps1.
#
#   tools/test.sh seed | edit | drag | open | misc

set -euo pipefail

TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="${1:?usage: tools/test.sh <seed|edit|drag|open|misc>}"
tmp="$(mktemp --suffix=.js)"
trap 'rm -f "$tmp"' EXIT

if [ "$name" = seed ]; then
  cat "$TOOLS/tests/seed.js" > "$tmp"
else
  cat "$TOOLS/test-helpers.js" "$TOOLS/tests/$name.js" > "$tmp"
fi
node "$TOOLS/marionette.mjs" evalfile "$tmp"
