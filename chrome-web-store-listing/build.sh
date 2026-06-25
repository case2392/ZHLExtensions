#!/usr/bin/env bash
# Renders every .svg under svg-sources/ to a PNG at its declared
# viewBox dimensions, dropping the result in this directory.
#
# Uses the headless Chromium that ships with the environment so
# nothing else needs to be installed. Re-run this script any time
# you tweak an SVG source.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
SRC="$DIR/svg-sources"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v chromium || command -v google-chrome || true)"
  [ -z "$CHROME" ] && { echo "no Chromium found"; exit 1; }
fi

for svg in "$SRC"/*.svg; do
  base="$(basename "$svg" .svg)"
  # Pull width/height from the viewBox so the screenshot matches the
  # canvas exactly. Falls back to the width/height attributes.
  read W H <<<"$(python3 - "$svg" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r'viewBox="([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)"', s)
if m: print(int(float(m.group(3))), int(float(m.group(4))))
else:
    mw = re.search(r'width="(\d+)', s); mh = re.search(r'height="(\d+)', s)
    print(int(mw.group(1)) if mw else 1280, int(mh.group(1)) if mh else 800)
PY
)"
  html="$TMP/$base.html"
  cat > "$html" <<HTML
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff;}svg{display:block;}</style></head>
<body>$(cat "$svg")</body></html>
HTML
  out="$DIR/${base}.png"
  "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --window-size="${W},${H}" --default-background-color=00000000 \
    --screenshot="$out" "file://$html" >/dev/null 2>&1
  echo "rendered $base.png (${W}x${H})"
done
