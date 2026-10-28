#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DASH_DIR="$ROOT_DIR/dashboard"
ASSETS_DIR="$ROOT_DIR/app/assets"

cd "$DASH_DIR"
if [ ! -d "node_modules" ]; then
  npm ci
fi

npm run build

JS_BUNDLE="$(ls dist/assets/index-*.js | head -n 1)"
CSS_BUNDLE="$(ls dist/assets/index-*.css | head -n 1)"

./node_modules/.bin/esbuild "$JS_BUNDLE" \
  --bundle \
  --minify \
  --format=iife \
  --target=es2020 \
  --outfile="$ASSETS_DIR/app.js"

cp "$CSS_BUNDLE" "$ASSETS_DIR/styles.css"
cp public/manifest.json "$ASSETS_DIR/manifest.json"
cp public/icon-192.svg "$ASSETS_DIR/icon-192.svg"
cp public/icon-512.svg "$ASSETS_DIR/icon-512.svg"

echo "Dashboard assets built into $ASSETS_DIR"
