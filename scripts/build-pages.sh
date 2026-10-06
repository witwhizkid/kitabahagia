#!/usr/bin/env bash
# Cloudflare Pages build: Pages has no ignore file, so copy only the public site into dist/.
# Leaves out everything .vercelignore lists (camera originals, supabase/, .claude/, ...), plus
# dotfiles, Vercel-only files, and functions/ (Pages reads that from the repo root itself).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist
mkdir dist
tar -cf - \
  --exclude-vcs --exclude='./.*' --exclude=./dist --exclude=./functions \
  --exclude=./vercel.json --exclude=./middleware.js \
  --exclude-from=.vercelignore \
  . | tar -xf - -C dist
# Each page gets style.css minus rules that can never match it (scripts/split-css.mjs); without
# Node the pages simply keep the full style.css.
if command -v node >/dev/null 2>&1; then node scripts/split-css.mjs dist; else echo "node missing: full style.css kept"; fi
# Beranda needs both render-blocking gates; serve them as one file so the first paint waits on
# one request instead of two (PageSpeed, Oct 2026). Sources stay separate in js/.
cat dist/js/curtain-gate.js dist/js/loader-gate.js > dist/js/home-gate.js
sed -i -E 's#<script src="js/curtain-gate\.js"></script>#<script src="js/home-gate.js"></script>#; /<script src="js\/loader-gate\.js"><\/script>/d' dist/index.html
grep -q 'js/home-gate.js' dist/index.html || { echo "home-gate swap failed"; exit 1; }
# Cloudflare lets browsers keep JS/CSS for hours while HTML is always fresh, so a deploy
# could pair new HTML with old admin.js. Stamp local JS/CSS links with the commit so every
# deploy loads matching files.
version="${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || date +%s)}"
version="${version:0:12}"
find dist -name '*.html' -print0 | xargs -0 sed -i -E \
  "s#((src|href)=\"(\.\./|/)?(js|css)/[^\"?]+\.(js|css))\"#\1?v=${version}\"#g"
echo "dist: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
