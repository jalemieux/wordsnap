#!/usr/bin/env bash
# Wraps the Safari build in the Xcode project Safari needs to load an extension. macOS with Xcode only.
#   scripts/safari-xcode.sh            builds dist-safari/ and (re)generates ../safari/WordSnap/
# Then open the project in Xcode and run it: the app registers the extension with Safari. For a build that is
# not signed with a developer certificate, enable Develop > Allow Unsigned Extensions in Safari first, then turn
# WordSnap on in Safari > Settings > Extensions.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v xcrun >/dev/null; then
  echo "safari-xcode: needs macOS with Xcode installed (xcrun not found)" >&2
  exit 1
fi
npm run build:safari
xcrun safari-web-extension-converter dist-safari \
  --project-location ../safari \
  --app-name WordSnap \
  --bundle-identifier com.jalemieux.wordsnap \
  --macos-only \
  --copy-resources \
  --no-open \
  --force
echo
echo "Next: open ../safari/WordSnap/WordSnap.xcodeproj, run the WordSnap target, then enable WordSnap in Safari > Settings > Extensions."
