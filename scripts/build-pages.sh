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
# Cloudflare lets browsers keep JS/CSS for hours while HTML is always fresh, so a deploy
# could pair new HTML with old admin.js. Stamp local JS/CSS links with the commit so every
# deploy loads matching files.
version="${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || date +%s)}"
version="${version:0:12}"
find dist -name '*.html' -print0 | xargs -0 sed -i -E \
  "s#((src|href)=\"(\.\./|/)?(js|css)/[^\"?]+\.(js|css))\"#\1?v=${version}\"#g"
echo "dist: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
