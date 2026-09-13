#!/bin/bash -e
# Build the extension and sync it to the stable directory Chrome loads from.
#
# Usage:  bash load.sh [version]     (default version: 5.1.0.2)
#
# Setup (once): in chrome://extensions enable Developer Mode, "Load unpacked",
# and select  /Users/arno/dev/zotero-connector-ai
# After that, re-running this script and clicking the reload icon on the
# extension card is enough — never point Chrome at build/manifestv3 directly,
# because ./build.sh wipes that directory on every run and Chrome silently
# uninstalls unpacked extensions whose manifest goes missing.

LOAD_DIR=/Users/arno/dev/zotero-connector-ai
VERSION="${1:-5.1.0.2}"

cd "$(dirname "$0")"
./build.sh -v "$VERSION"

mkdir -p "$LOAD_DIR"
rsync -a --delete build/manifestv3/ "$LOAD_DIR"/

# Drop any sync-conflict duplicates ("name 2") if a cloud-sync tool ever
# touches the load directory
find "$LOAD_DIR" -depth -name "* 2" -exec rm -rf {} + 2>/dev/null || true

echo "Synced to $LOAD_DIR — reload the extension in chrome://extensions"
