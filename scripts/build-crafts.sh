#!/usr/bin/env bash
# Puts the embedded editors into crafts/<app>/ (run on Linux CI; needs gh, node, unzip):
#  - WordCraft, GridCraft, CADCraft: the official web builds of the versions pinned in
#    package.json → "crafts", checked against the release's SHA256SUMS.txt;
#  - DeckCraft: built from its source at the pinned tag with OfficeStudio's host bridge
#    (crafts-patches/deckcraft/web.rs) — needs Rust with the wasm32 target and trunk.
# All four are MIT OR Apache-2.0, github.com/storytold.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/crafts}"
WORK="${CRAFTS_WORK:-$ROOT/.crafts-work}"
mkdir -p "$OUT" "$WORK"
ver() { node -p "require('$ROOT/package.json').crafts.$1"; }

for app in wordcraft gridcraft cadcraft; do
  v=$(ver $app)
  echo "== $app $v"
  d="$WORK/dl-$app-$v"
  rm -rf "$d"; mkdir -p "$d"
  gh release download "v$v" -R "storytold/$app" -D "$d" -p "$app-web-$v.zip" -p SHA256SUMS.txt
  (cd "$d" && grep " \*\?$app-web-$v.zip\$" SHA256SUMS.txt | sha256sum -c -)
  rm -rf "$OUT/$app" "$d/x"; mkdir -p "$OUT/$app"
  unzip -q "$d/$app-web-$v.zip" -d "$d/x"
  cp -R "$d/x/$app-web-$v/." "$OUT/$app/"
  echo "$v" > "$OUT/$app/VERSION"
done

app=deckcraft
v=$(ver $app)
echo "== $app $v (OfficeStudio build)"
src="$WORK/deckcraft-$v"
if [ ! -d "$src/.git" ]; then
  rm -rf "$src.tmp"; git clone -q --depth 1 --branch "v$v" https://github.com/storytold/deckcraft "$src.tmp"
  mkdir -p "$src"; cp -R "$src.tmp/." "$src/"; rm -rf "$src.tmp"
fi
if false; then
  git clone -q --depth 1 --branch "v$v" https://github.com/storytold/deckcraft "$src"
fi
cp "$ROOT/crafts-patches/deckcraft/web.rs" "$src/apps/deckcraft-web/src/web.rs"
grep -q '"MessageEvent"' "$src/apps/deckcraft-web/Cargo.toml" || sed -i 's/"CssStyleDeclaration"\]/"CssStyleDeclaration", "MessageEvent"]/' "$src/apps/deckcraft-web/Cargo.toml"
grep -q '"MessageEvent"' "$src/apps/deckcraft-web/Cargo.toml"
(cd "$src/apps/deckcraft-web" && CRAFT_FONTS_DIR="" trunk build --release)
rm -rf "$OUT/$app"; mkdir -p "$OUT/$app"
cp -R "$src/dist/web/." "$OUT/$app/"
cp "$src/LICENSE-MIT" "$src/LICENSE-APACHE" "$OUT/$app/"
echo "$v-officestudio" > "$OUT/$app/VERSION"
ls -la "$OUT"/*
du -sh "$OUT"/*
