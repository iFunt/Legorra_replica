#!/bin/bash
# Double-click in Finder: builds Headroom Guard, installs it to /Applications,
# puts a shortcut on your Desktop and launches it.
set -euo pipefail
cd "$(dirname "$0")"

if ! xcode-select -p >/dev/null 2>&1; then
    echo "Xcode command line tools are needed. A macOS installer will open; run this again when it finishes."
    xcode-select --install || true
    read -r -p "Press Return to close." _
    exit 1
fi

./build.sh install
echo
echo "Done. Click the red shield on your Desktop (or in Applications) to open Headroom Guard."
read -r -p "Press Return to close." _
