#!/bin/bash
# Builds HeadroomGuard.app as a universal (Apple Silicon + Intel) binary.
#   ./build.sh            build build/HeadroomGuard.app
#   ./build.sh install    build, copy to /Applications and (re)launch
#   ./build.sh dmg        build and package build/HeadroomGuard-<version>.dmg
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" Resources/Info.plist)

swift build -c release --arch arm64 --arch x86_64
BIN=$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/HeadroomGuard

APP=build/HeadroomGuard.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/HeadroomGuard"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# Ad-hoc signature. For a notarized release, sign with a Developer ID instead:
#   codesign --force --options runtime --sign "Developer ID Application: ..." "$APP"
codesign --force --sign - "$APP"
echo "Built $APP ($VERSION, $(lipo -archs "$APP/Contents/MacOS/HeadroomGuard"))"

case "${1:-}" in
install)
    pkill -x HeadroomGuard 2>/dev/null || true
    sleep 0.5
    rm -rf /Applications/HeadroomGuard.app
    cp -R "$APP" /Applications/
    # Make Finder and the Dock pick up the new icon instead of a cached one.
    touch /Applications/HeadroomGuard.app
    # Desktop shortcut: double-click launches the app, or opens the dashboard if it is already running.
    ln -sfn /Applications/HeadroomGuard.app "$HOME/Desktop/Headroom Guard"
    open /Applications/HeadroomGuard.app
    echo "Installed and launched /Applications/HeadroomGuard.app (shortcut on Desktop)"
    ;;
dmg)
    DMG="build/HeadroomGuard-$VERSION.dmg"
    STAGE=build/dmg
    rm -rf "$STAGE" "$DMG"
    mkdir -p "$STAGE"
    cp -R "$APP" "$STAGE/"
    ln -s /Applications "$STAGE/Applications"
    hdiutil create -volname "Headroom Guard $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
    rm -rf "$STAGE"
    echo "Packaged $DMG ($(du -h "$DMG" | cut -f1))"
    ;;
esac
