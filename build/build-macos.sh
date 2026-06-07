#!/usr/bin/env bash
# build-macos — concatenate src/macos modules into one self-contained dist/breathpause.js
# (SPEC §11). Zero dependencies: pure text concatenation + Node syntax check.
#
# Each module is a namespace IIFE (var Foo = (function(){...})()), so concatenation into one
# scope is collision-free. Node-only `require('./...')` import lines are stripped; the
# module.exports footers are harmless under osascript (typeof module === 'undefined').
set -eu
cd "$(dirname "$0")/.."

VERSION="${BP_VERSION:-}"  # release tag (e.g. v0.1.0); stamped into the header. Empty for dev builds.
SRC=src/macos
OUT=dist/breathpause.js
mkdir -p dist

# Order matters: a module's namespace must be defined before a later module references it.
FILES=(
  "$SRC/core/timefmt.js"
  "$SRC/core/breathing.js"
  "$SRC/core/pomodoro.js"
  "$SRC/core/eventlog.js"
  "$SRC/core/settings.js"
  "$SRC/core/strings.js"
  "$SRC/core/hotkeys.js"
  "$SRC/shell/storage.js"
  "$SRC/shell/sound.js"
  "$SRC/shell/window.js"
  "$SRC/shell/tray.js"
  "$SRC/shell/settingswindow.js"
  "$SRC/main.js"
)

{
  echo "// breathpause (macOS) — GENERATED bundle. Do not edit; edit src/macos/* and rebuild."
  echo "// Run with: osascript -l JavaScript dist/breathpause.js"
  [ -n "$VERSION" ] && echo "// Version: $VERSION"
  for f in "${FILES[@]}"; do
    [ -f "$f" ] || continue
    echo ""
    echo "// ===== $f ====="
    # Strip clean Node-only relative require imports: `var X = require('./y')`.
    # (settings.js uses a ternary `require` guard that intentionally does NOT match.)
    sed -E "/^[[:space:]]*(var|const|let)[[:space:]]+[A-Za-z0-9_]+[[:space:]]*=[[:space:]]*require\([[:space:]]*['\"]\.\//d" "$f"
  done
} > "$OUT"

echo "Wrote $OUT ($(wc -l < "$OUT") lines)"
node -c "$OUT" && echo "Syntax OK"
