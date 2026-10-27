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
# (the Rust cache restores $src/target only, so look for the sources themselves)
if [ ! -d "$src/.git" ]; then
  rm -rf "$src.tmp"; git clone -q --depth 1 --branch "v$v" https://github.com/storytold/deckcraft "$src.tmp"
  mkdir -p "$src"; cp -R "$src.tmp/." "$src/"; rm -rf "$src.tmp"
fi
cp "$ROOT/crafts-patches/deckcraft/web.rs" "$src/apps/deckcraft-web/src/web.rs"
grep -q '"MessageEvent"' "$src/apps/deckcraft-web/Cargo.toml" || sed -i 's/"CssStyleDeclaration"\]/"CssStyleDeclaration", "MessageEvent"]/' "$src/apps/deckcraft-web/Cargo.toml"
grep -q '"MessageEvent"' "$src/apps/deckcraft-web/Cargo.toml"
# its interface in Russian: translation where egui lays text out (crafts-patches/egui), with a
# dictionary from the ArtCraft Russian catalogs and OfficeStudio's own rows
I18N_SHA=$(node -p "require('$ROOT/package.json').craftsI18n")
i18n="$WORK/craft-i18n-$I18N_SHA"
if [ ! -d "$i18n/locales" ]; then
  rm -rf "$i18n"; git init -q "$i18n"
  git -C "$i18n" fetch -q --depth 1 https://github.com/storytold/craft-i18n "$I18N_SHA"
  git -C "$i18n" checkout -q FETCH_HEAD
fi
python3 "$ROOT/crafts-patches/build-dict.py" "$i18n" "$WORK/ru.tsv"
for crate in epaint egui; do
  cv=$(awk -v n="$crate" '$0 == "name = \""n"\"" { getline; gsub(/version = |"/, ""); print; exit }' "$src/Cargo.lock")
  [ -n "$cv" ] || { echo "no $crate in Cargo.lock" >&2; exit 1; }
  rm -rf "$WORK/$crate-$cv"
  curl -fsSL "https://static.crates.io/crates/$crate/$crate-$cv.crate" | tar xz -C "$WORK"
  eval "${crate}_dir=$WORK/$crate-$cv"
done
python3 "$ROOT/crafts-patches/egui/apply.py" "$epaint_dir" "$egui_dir" "$WORK/ru.tsv"
python3 "$ROOT/crafts-patches/deckcraft/patch-sources.py" "$src"
python3 - "$src/Cargo.toml" "$epaint_dir" "$egui_dir" <<'PY'
import sys
p, ep, eg = sys.argv[1:4]
s = open(p, encoding='utf-8').read()
if '# OfficeStudio patch' not in s:
    rows = f'# OfficeStudio patch\nepaint = {{ path = "{ep}" }}\negui = {{ path = "{eg}" }}\n'
    s = s.replace('[patch.crates-io]\n', '[patch.crates-io]\n' + rows, 1) if '[patch.crates-io]\n' in s else s + '\n[patch.crates-io]\n' + rows
    open(p, 'w', encoding='utf-8').write(s)
PY
(cd "$src/apps/deckcraft-web" && CRAFT_FONTS_DIR="" trunk build --release)
rm -rf "$OUT/$app"; mkdir -p "$OUT/$app"
cp -R "$src/dist/web/." "$OUT/$app/"
cp "$src/LICENSE-MIT" "$src/LICENSE-APACHE" "$OUT/$app/"
echo "$v-officestudio" > "$OUT/$app/VERSION"
ls -la "$OUT"/*
du -sh "$OUT"/*
