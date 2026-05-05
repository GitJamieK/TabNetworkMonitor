#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DIST_DIR="$ROOT_DIR/dist"
COMMON_FILES="background.js popup.html popup.css popup.js PRIVACY.md LICENSE"

mkdir -p "$DIST_DIR/chrome" "$DIST_DIR/firefox"

for file in $COMMON_FILES; do
    cp "$ROOT_DIR/$file" "$DIST_DIR/chrome/$file"
    cp "$ROOT_DIR/$file" "$DIST_DIR/firefox/$file"
done

cp "$ROOT_DIR/manifest.json" "$DIST_DIR/chrome/manifest.json"
cp "$ROOT_DIR/manifest.firefox.json" "$DIST_DIR/firefox/manifest.json"

(
    cd "$DIST_DIR/chrome"
    zip -qr -FS "$DIST_DIR/tab-network-monitor-chrome.zip" manifest.json $COMMON_FILES
)

(
    cd "$DIST_DIR/firefox"
    zip -qr -FS "$DIST_DIR/tab-network-monitor-firefox.zip" manifest.json $COMMON_FILES
)

printf '%s\n' "Created:"
printf '%s\n' "$DIST_DIR/tab-network-monitor-chrome.zip"
printf '%s\n' "$DIST_DIR/tab-network-monitor-firefox.zip"
